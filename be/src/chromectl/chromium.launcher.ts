import { Injectable, Logger } from '@nestjs/common';
import { ChildProcess, execFile, spawn } from 'child_process';
import { EXTENSION_DIR } from '../paths';

const CHROMIUM_BIN = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium-browser';
const CHROMIUM_PROCESS_NAME = 'chromium-browser';
const STOP_TIMEOUT_MS = 10_000;

/**
 * The only code that starts or stops Chromium. Tests replace it with a fake.
 */
@Injectable()
export class ChromiumLauncher {
  private readonly logger = new Logger(ChromiumLauncher.name);

  launch(url: string): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        CHROMIUM_BIN,
        [
          url,
          '--use-fake-ui-for-media-stream',
          `--load-extension=${EXTENSION_DIR}`,
        ],
        {
          shell: false,
          stdio: ['ignore', 'inherit', 'inherit'],
          env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0' },
        },
      );
      child.once('spawn', () => resolve(child));
      child.once('error', reject);
    });
  }

  async stopAll(): Promise<void> {
    try {
      await run('killall', ['-q', '-w', '-s', 'TERM', CHROMIUM_PROCESS_NAME]);
    } catch (error) {
      if (isTimeout(error)) {
        this.logger.warn(
          `${CHROMIUM_PROCESS_NAME} did not stop in ${STOP_TIMEOUT_MS} ms, sending KILL`,
        );
        await run('killall', ['-q', '-s', 'KILL', CHROMIUM_PROCESS_NAME]).catch(
          (killError) => this.logUnlessNotFound(killError),
        );
        return;
      }
      this.logUnlessNotFound(error);
    }
  }

  private logUnlessNotFound(error: any): void {
    // killall exits with code 1 when no process matches.
    if (error?.code === 1) return;
    this.logger.error(`killall failed: ${error?.message ?? error}`);
  }
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: STOP_TIMEOUT_MS }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

function isTimeout(error: any): boolean {
  return error?.killed === true && error?.signal === 'SIGTERM';
}
