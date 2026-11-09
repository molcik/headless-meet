import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import {
  CameraBusyError,
  ChromectlService,
  LaunchError,
  MeetingSession,
  NotInThatMeetingError,
} from '../chromectl/chromectl.service';
import { InvalidMeetingError } from '../chromectl/meeting-code';
import { REPO_ROOT } from '../paths';

export const GUIDE_URL = 'http://webcam.local/mcp/guide';

const { version } = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'be', 'package.json'), 'utf8'),
);

const INSTRUCTIONS =
  'Controls the webcam in the Man Cave room. The camera joins Google Meet meetings as the guest ' +
  "'Meeting Room'. Someone in the meeting must admit it, and the camera cannot see if that happened. " +
  `Setup guide and automation prompt: ${GUIDE_URL}`;

/**
 * Builds the MCP server with the tools `join`, `leave` and `status`.
 * It keeps no state: the service owns the camera state.
 */
export function buildMcpServer(service: ChromectlService): McpServer {
  const server = new McpServer(
    { name: 'headless-meet', version },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    'join',
    {
      title: 'Send the webcam into a Google Meet meeting',
      description:
        "Opens a Google Meet meeting on the Man Cave room webcam. The camera joins as the guest 'Meeting Room'. " +
        'Someone in the meeting must admit it. The camera cannot see if it was admitted. ' +
        'If the camera is already in another meeting, the call is refused. ' +
        'Set force to true only if the user explicitly wants to take over the camera.',
      inputSchema: {
        meeting: z
          .string()
          .describe(
            'Google Meet link (https://meet.google.com/abc-defg-hij) or meeting code (abc-defg-hij). Max 200 characters.',
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            'Leave the current meeting and join this one. Use only when the user explicitly asks for it. Default false.',
          ),
        requestedBy: z
          .string()
          .optional()
          .describe(
            'Name of the person you act for. Other users see it in status.',
          ),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ meeting, force, requestedBy }) => {
      try {
        const outcome = await service.join({
          meeting,
          force: force === true,
          startedBy: requestedBy ?? null,
          source: 'mcp',
        });
        if (outcome.result === 'already_in_meeting') {
          const { session } = outcome;
          return ok(
            `The camera is already in meeting ${session.meetingCode} since ${session.startedAt}.`,
            outcome,
          );
        }
        const replaced = outcome.replaced
          ? ` It left meeting ${outcome.replaced.meetingCode} first.`
          : '';
        return ok(
          `The camera is opening meeting ${outcome.session.meetingCode}. ` +
            `Someone in the meeting must admit 'Meeting Room'.${replaced}`,
          outcome,
        );
      } catch (error) {
        if (error instanceof CameraBusyError) {
          return refuse(
            `${describeSession(error.current)}. Ask the user before you call join again with force=true.`,
            { error: 'busy', current: error.current },
          );
        }
        if (error instanceof LaunchError) {
          return refuse(
            `The camera could not start Chromium: ${error.message}.`,
            { error: 'launch_failed', message: error.message },
          );
        }
        return refuseInvalidOrRethrow(error);
      }
    },
  );

  server.registerTool(
    'leave',
    {
      title: 'Take the webcam out of the meeting',
      description:
        'Closes the meeting on the Man Cave room webcam. ' +
        'Pass meeting to leave only that meeting: if the camera is in a different meeting, nothing changes. ' +
        'Without meeting, the camera leaves whatever meeting it is in.',
      inputSchema: {
        meeting: z
          .string()
          .optional()
          .describe(
            'Google Meet link or code of the meeting to leave. Recommended, so you never end the meeting of another person.',
          ),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ meeting }) => {
      try {
        const outcome = await service.leave({ meeting });
        if (outcome.result === 'was_idle') {
          return ok('The camera was idle. Nothing to do.', outcome);
        }
        return ok(
          `The camera left meeting ${outcome.session.meetingCode}.`,
          outcome,
        );
      } catch (error) {
        if (error instanceof NotInThatMeetingError) {
          const current = error.current;
          return refuse(
            `The camera is not in meeting ${error.requestedCode}. ` +
              `It is in ${current.meetingCode} (started by ${current.startedBy ?? 'unknown'}). Nothing was changed.`,
            { error: 'not_in_that_meeting', current },
          );
        }
        return refuseInvalidOrRethrow(error);
      }
    },
  );

  server.registerTool(
    'status',
    {
      title: 'Show what the webcam is doing',
      description:
        'Shows if the Man Cave room webcam is idle or in a meeting: meeting code, start time (UTC) and who started it. ' +
        'The camera cannot see if it was admitted or if the meeting already ended inside Meet.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const status = service.status();
      if (status.state === 'idle') return ok('The camera is idle.', status);
      return ok(
        `${describeSession(status)}. The camera cannot see if it was admitted or if the meeting already ended.`,
        status,
      );
    },
  );

  return server;
}

function describeSession(session: MeetingSession): string {
  return (
    `The camera is in meeting ${session.meetingCode} since ${session.startedAt}, ` +
    `started by ${session.startedBy ?? 'unknown'} (${session.source})`
  );
}

function ok(text: string, structuredContent: object): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: { ...structuredContent },
  };
}

function refuse(text: string, structuredContent: object): CallToolResult {
  return { ...ok(text, structuredContent), isError: true };
}

function refuseInvalidOrRethrow(error: unknown): CallToolResult {
  if (error instanceof InvalidMeetingError) {
    return refuse(error.message, {
      error: 'invalid_meeting',
      message: error.message,
    });
  }
  throw error;
}
