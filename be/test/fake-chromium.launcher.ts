import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/** Stands in for ChromiumLauncher: no process, a child that tests can end. */
export class FakeChromiumLauncher {
  readonly launchedUrls: string[] = [];
  readonly children: EventEmitter[] = [];
  stopAllCalls = 0;
  failNextLaunch: Error | null = null;
  /** The next child exits at once, like Chromium without an X server. */
  exitAtStartNextLaunch = false;
  /** Short, so tests do not wait the real 2 s. */
  readonly startupCheckMs = 20;

  async launch(url: string): Promise<ChildProcess> {
    await Promise.resolve();
    if (this.failNextLaunch) {
      const error = this.failNextLaunch;
      this.failNextLaunch = null;
      throw error;
    }
    const child = new EventEmitter();
    this.launchedUrls.push(url);
    this.children.push(child);
    if (this.exitAtStartNextLaunch) {
      this.exitAtStartNextLaunch = false;
      setImmediate(() => child.emit('exit', 1, null));
    }
    return child as ChildProcess;
  }

  async stopAll(): Promise<void> {
    this.stopAllCalls++;
    await Promise.resolve();
  }

  get lastChild(): EventEmitter {
    return this.children[this.children.length - 1];
  }
}
