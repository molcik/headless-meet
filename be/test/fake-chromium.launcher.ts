import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/** Stands in for ChromiumLauncher: no process, a child that tests can end. */
export class FakeChromiumLauncher {
  readonly launchedUrls: string[] = [];
  readonly children: EventEmitter[] = [];
  stopAllCalls = 0;
  failNextLaunch: Error | null = null;

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
