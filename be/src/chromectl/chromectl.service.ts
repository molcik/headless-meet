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

export class QueueTimeoutError extends Error {
  constructor(readonly waitedMs: number) {
    super(`The call waited ${waitedMs} ms for other camera calls`);
    this.name = 'QueueTimeoutError';
  }
}

const MAX_NAME_LENGTH = 80;

/**
 * A call that waited this long for other calls is refused and changes nothing.
 * Wait plus one switch (stop up to 20 s, start check 2 s) stays below the
 * 60 s nginx proxy timeout, so the client never gets a 504 for a switch that still happens.
 */
export const MAX_QUEUE_WAIT_MS = 25_000;

/** Trims the name, removes control characters and line breaks, cuts it to 80 characters. */
export function cleanName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const cleaned = name.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g,
    ' ',
  );
  // Cut by code points, so an emoji at the limit is not split into a lone surrogate.
  const cut = Array.from(cleaned.trim())
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .trim();
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

      // Chromium that cannot start (no X server, profile lock) ends within a moment.
      // The exit handler above already set the state to idle.
      const exit = await exitWithin(child, this.launcher.startupCheckMs);
      if (exit) {
        const message = `Chromium exited right after the start (code=${exit.code}, signal=${exit.signal})`;
        this.logger.error(`join ${meetingCode} failed: ${message}`);
        throw new LaunchError(message);
      }

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

      if (!current) {
        // Without a code, also stop a Chromium that someone started by hand on the Pi desktop.
        // With a code, the caller asked for one meeting only, so a hand-started Chromium stays.
        if (!requestedCode) await this.launcher.stopAll();
        this.logger.log('leave: the camera was idle');
        return { result: 'was_idle' };
      }

      await this.launcher.stopAll();
      this.session = null;
      this.browser = null;
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
    const queuedAt = Date.now();
    const result = this.queue.then(() => {
      const waitedMs = Date.now() - queuedAt;
      if (waitedMs > MAX_QUEUE_WAIT_MS) {
        this.logger.warn(`call refused after ${waitedMs} ms in the queue`);
        throw new QueueTimeoutError(waitedMs);
      }
      return task();
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
}

/** Resolves with the exit of `child`, or with null when it still runs after `ms`. */
function exitWithin(
  child: ChildProcess,
  ms: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  return new Promise((resolve) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(null);
    }, ms);
    child.once('exit', onExit);
  });
}
