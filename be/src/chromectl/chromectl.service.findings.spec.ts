import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { FakeChromiumLauncher } from '../../test/fake-chromium.launcher';
import { ChromectlService, cleanName, LaunchError } from './chromectl.service';
import { ChromiumLauncher } from './chromium.launcher';

// Tests for the bugs in docs/specs/1-mcp-server/test-report.md.
// Each test uses `it.failing`: it passes while the bug exists.
// After the fix, Jest reports it as failed. Then change `it.failing` to `it`.

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
  it.failing(
    'join fails with LaunchError when Chromium exits right after the start',
    async () => {
      const launcher = new ExitAtOnceLauncher();
      const service = new ChromectlService(
        launcher as unknown as ChromiumLauncher,
      );

      await expect(
        service.join({ meeting: A, source: 'mcp' }),
      ).rejects.toBeInstanceOf(LaunchError);
      expect(service.status()).toEqual({ state: 'idle' });
    },
  );

  // Bug 2: leave with a meeting code stops a Chromium that the service does not track.
  it.failing(
    'leave with a meeting code does not stop Chromium when the camera is idle',
    async () => {
      const launcher = new FakeChromiumLauncher();
      const service = new ChromectlService(
        launcher as unknown as ChromiumLauncher,
      );

      const outcome = await service.leave({ meeting: A });

      expect(outcome).toEqual({ result: 'was_idle' });
      expect(launcher.stopAllCalls).toBe(0);
    },
  );
});

describe('cleanName, bugs from the test report', () => {
  const loneSurrogate =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  // Bug 3: the cut at 80 UTF-16 units splits an emoji into a lone surrogate.
  it.failing('does not split a character at the 80 character limit', () => {
    const name = 'a'.repeat(79) + '\u{1F600}' + 'b';

    const cleaned = cleanName(name);

    expect(cleaned).not.toMatch(loneSurrogate);
  });
});
