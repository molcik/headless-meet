export class InvalidMeetingError extends Error {
  constructor(input: string) {
    super(
      `Not a Google Meet meeting: "${input.slice(0, 60)}". ` +
        'Use a link like https://meet.google.com/abc-defg-hij or a code like abc-defg-hij.',
    );
    this.name = 'InvalidMeetingError';
  }
}

export interface ParsedMeeting {
  meetingCode: string;
  meetingUrl: string;
}

const MAX_INPUT_LENGTH = 200;
const MEET_HOST = 'meet.google.com';
const MEETING_CODE = /^([a-z]{3})-?([a-z]{4})-?([a-z]{3})$/i;

/**
 * Turns a Meet link or a meeting code into a normalised code and a URL that is
 * built only from that code. User input never reaches Chromium.
 */
export function parseMeeting(input: string): ParsedMeeting {
  const raw = typeof input === 'string' ? input : '';
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INPUT_LENGTH) {
    throw new InvalidMeetingError(raw);
  }

  const candidate = looksLikeUrl(trimmed) ? codeFromUrl(trimmed, raw) : trimmed;

  const match = MEETING_CODE.exec(candidate);
  if (!match) throw new InvalidMeetingError(raw);

  const meetingCode = match.slice(1, 4).join('-').toLowerCase();
  return { meetingCode, meetingUrl: `https://${MEET_HOST}/${meetingCode}` };
}

function looksLikeUrl(input: string): boolean {
  return input.includes('/') || input.includes('.');
}

function codeFromUrl(input: string, raw: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
    ? input
    : `https://${input}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidMeetingError(raw);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidMeetingError(raw);
  }
  if (url.hostname.toLowerCase() !== MEET_HOST) {
    throw new InvalidMeetingError(raw);
  }

  // "/abc-defg-hij" gives one segment. "/a/b" and "/abc-defg-hij/" give two.
  const segments = url.pathname.split('/').slice(1);
  if (segments.length !== 1) throw new InvalidMeetingError(raw);
  return segments[0];
}
