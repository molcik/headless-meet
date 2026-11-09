import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { FakeChromiumLauncher } from '../../test/fake-chromium.launcher';
import {
  ChromectlService,
  cleanName,
  LaunchError,
  MAX_QUEUE_WAIT_MS,
  QueueTimeoutError,
} from './chromectl.service';
import { ChromiumLauncher } from './chromium.launcher';

// Tests for the bugs in docs/specs/1-mcp-server/test-report.md.
// They were `it.failing` while the bugs existed (commit 69fb9d5). Round 2 fixed the bugs.

const A = 'abc-defg-hij';

/** Chromium that exits at once, for example "Missing X server" or a profile lock. */
class ExitAtOnceLauncher extends FakeChromiumLauncher {
  async launch(url: string): Promise<ChildProcess> {
    const child = (await super.launch(url)) as unknown as EventEmitter;
    setImmediate(() => child.emit('exit', 1, null));
    return child as ChildProcess;
  }
}

describe('ChromectlService, bugs from the test report', () => {
  // Bug 1: join reports "joined" although Chromium already ended.
  it('join fails with LaunchError when Chromium exits right after the start', async () => {
    const launcher = new ExitAtOnceLauncher();
    const service = new ChromectlService(
      launcher as unknown as ChromiumLauncher,
    );

    await expect(
      service.join({ meeting: A, source: 'mcp' }),
    ).rejects.toBeInstanceOf(LaunchError);
    expect(service.status()).toEqual({ state: 'idle' });
  });

  // Bug 2: leave with a meeting code stops a Chromium that the service does not track.
  it('leave with a meeting code does not stop Chromium when the camera is idle', async () => {
    const launcher = new FakeChromiumLauncher();
    const service = new ChromectlService(
      launcher as unknown as ChromiumLauncher,
    );

    const outcome = await service.leave({ meeting: A });

    expect(outcome).toEqual({ result: 'was_idle' });
    expect(launcher.stopAllCalls).toBe(0);
  });
});

describe('cleanName, bugs from the test report', () => {
  const loneSurrogate =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  // Bug 3: the cut at 80 UTF-16 units splits an emoji into a lone surrogate.
  it('does not split a character at the 80 character limit', () => {
    const name = 'a'.repeat(79) + '\u{1F600}' + 'b';

    const cleaned = cleanName(name);

    expect(cleaned).not.toMatch(loneSurrogate);
  });
});

// Round 2 of the test report: edge cases of the fixes.
describe('ChromectlService, round 2 of the test report', () => {
  let launcher: FakeChromiumLauncher;
  let service: ChromectlService;

  beforeEach(() => {
    launcher = new FakeChromiumLauncher();
    service = new ChromectlService(launcher as unknown as ChromiumLauncher);
  });

  // Bug 1 boundary: an exit after the startup check is a normal meeting end.
  it('join reports joined when Chromium exits after the startup check', async () => {
    await expect(
      service.join({ meeting: A, source: 'mcp' }),
    ).resolves.toMatchObject({ result: 'joined' });

    launcher.lastChild.emit('exit', 1, null);

    expect(service.status()).toEqual({ state: 'idle' });
  });

  // Bug 6: a refused leave must not stop the meeting of somebody else.
  it('a leave refused after a long wait in the queue does not stop Chromium', async () => {
    const start = 1_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const stopAll = launcher.stopAll.bind(launcher);
    jest.spyOn(launcher, 'stopAll').mockImplementationOnce(async () => {
      now.mockReturnValue(start + MAX_QUEUE_WAIT_MS + 1);
      await stopAll();
    });
    try {
      const first = service.join({ meeting: A, source: 'mcp' });
      const second = service.leave({});

      await expect(first).resolves.toMatchObject({ result: 'joined' });
      await expect(second).rejects.toBeInstanceOf(QueueTimeoutError);
      expect(launcher.stopAllCalls).toBe(1);
      expect(service.status()).toMatchObject({ meetingCode: A });
    } finally {
      now.mockRestore();
    }
  });
});

describe('cleanName, round 2 of the test report', () => {
  const loneSurrogate =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  // Bug 7: a lone surrogate in the input reaches the JSON of `status`.
  // `it.failing` until the bug is fixed.
  it.failing('removes a lone surrogate from the input', () => {
    expect(cleanName('Jana\uD83D')).not.toMatch(loneSurrogate);
    expect(cleanName('\uDE00Jana')).not.toMatch(loneSurrogate);
  });

  it('keeps a full emoji at the 80 character limit', () => {
    const name = 'a'.repeat(79) + '\u{1F600}' + 'b';

    expect(cleanName(name)).toBe('a'.repeat(79) + '\u{1F600}');
  });
});
