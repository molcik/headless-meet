import { Injectable, Logger } from '@nestjs/common';
import { ChildProcess } from 'child_process';
import { ChromiumLauncher } from './chromium.launcher';
import { parseMeeting } from './meeting-code';

export type Source = 'mcp' | 'web';

export interface MeetingSession {
  meetingCode: string;
  meetingUrl: string;
  startedAt: string;
  startedBy: string | null;
  source: Source;
}

export type CameraStatus =
  | { state: 'idle' }
  | ({ state: 'in_meeting' } & MeetingSession);

export interface JoinRequest {
  meeting: string;
  force?: boolean;
  startedBy?: string | null;
  source: Source;
}

export type JoinResult =
  | {
      result: 'joined';
      session: MeetingSession;
      replaced: MeetingSession | null;
    }
  | { result: 'already_in_meeting'; session: MeetingSession };

export interface LeaveRequest {
  meeting?: string;
}

export type LeaveResult =
  | { result: 'left'; session: MeetingSession }
  | { result: 'was_idle' };

export class CameraBusyError extends Error {
  constructor(readonly current: MeetingSession) {
    super(`The camera is in meeting ${current.meetingCode}`);
    this.name = 'CameraBusyError';
  }
}

export class NotInThatMeetingError extends Error {
  constructor(
    readonly requestedCode: string,
    readonly current: MeetingSession,
  ) {
    super(`The camera is not in meeting ${requestedCode}`);
    this.name = 'NotInThatMeetingError';
  }
}

export class LaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaunchError';
  }
}

const MAX_NAME_LENGTH = 80;

/** Trims the name, removes control characters and line breaks, cuts it to 80 characters. */
export function cleanName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const cleaned = name.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g,
    ' ',
  );
  const cut = cleaned.trim().slice(0, MAX_NAME_LENGTH).trim();
  return cut.length > 0 ? cut : null;
}

/**
 * The only owner of the camera state. The web UI controller and the MCP tools
 * both call this service. `join` and `leave` run one at a time.
 */
@Injectable()
export class ChromectlService {
  private readonly logger = new Logger(ChromectlService.name);

  private session: MeetingSession | null = null;
  private browser: ChildProcess | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly launcher: ChromiumLauncher) {}

  status(): CameraStatus {
    return this.session
      ? { state: 'in_meeting', ...this.session }
      : { state: 'idle' };
  }

  async join(request: JoinRequest): Promise<JoinResult> {
    // Parse before the lock: invalid input never waits for another call.
    const { meetingCode, meetingUrl } = parseMeeting(request.meeting);
    const force = request.force === true;
    const startedBy = cleanName(request.startedBy);

    return this.exclusive(async (): Promise<JoinResult> => {
      const current = this.session;
      if (current && !force) {
        if (current.meetingCode === meetingCode) {
          return { result: 'already_in_meeting', session: { ...current } };
        }
        throw new CameraBusyError({ ...current });
      }

      await this.launcher.stopAll();
      this.session = null;
      this.browser = null;

      let child: ChildProcess;
      try {
        child = await this.launcher.launch(meetingUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`join ${meetingCode} failed: ${message}`);
        throw new LaunchError(message);
      }

      const session: MeetingSession = {
        meetingCode,
        meetingUrl,
        startedAt: new Date().toISOString(),
        startedBy,
        source: request.source,
      };
      this.session = session;
      this.browser = child;
      child.once('exit', (code, signal) =>
        this.onBrowserExit(child, code, signal),
      );

      this.logger.log(
        `join ${meetingCode} startedBy=${startedBy ?? '-'} source=${request.source}` +
          ` replaced=${current?.meetingCode ?? '-'}`,
      );
      return { result: 'joined', session: { ...session }, replaced: current };
    });
  }

  async leave(request: LeaveRequest = {}): Promise<LeaveResult> {
    const requestedCode =
      request.meeting !== undefined
        ? parseMeeting(request.meeting).meetingCode
        : null;

    return this.exclusive(async (): Promise<LeaveResult> => {
      const current = this.session;
      if (current && requestedCode && current.meetingCode !== requestedCode) {
        throw new NotInThatMeetingError(requestedCode, { ...current });
      }

      // Also stops a Chromium that someone started by hand on the Pi desktop.
      await this.launcher.stopAll();
      this.session = null;
      this.browser = null;

      if (!current) {
        this.logger.log('leave: the camera was idle');
        return { result: 'was_idle' };
      }
      this.logger.log(`leave ${current.meetingCode}`);
      return { result: 'left', session: current };
    });
  }

  private onBrowserExit(
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    // An old process can exit after a force switch. It must not reset the new session.
    if (this.browser !== child) return;
    this.logger.log(
      `Chromium exited (code=${code}, signal=${signal}), meeting ${this.session?.meetingCode} is over`,
    );
    this.session = null;
    this.browser = null;
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
