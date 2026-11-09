# MCP server for the webcam: implementation (issue #1)

Input: `product.md` and `architecture.md` in this folder (commit 5eb07da).
Branch: `feat/1-mcp-server`. Status: implemented and tested on a laptop. Not deployed to the Pi.

Decisions from Filip on the open questions (9. 11. 2026):

1. The guide and the tool messages are in English.
2. The web UI switches the camera without a warning, as before.
3. The guide gives `http://192.168.1.181` as the fallback for `webcam.local`.

## 1. What is done

| Area | Files |
|---|---|
| Input validation (section 2.5) | `be/src/chromectl/meeting-code.ts` |
| Chromium start and stop without a shell (section 4.1) | `be/src/chromectl/chromium.launcher.ts`. `launch.sh` and `end.sh` are deleted. |
| One owner of the camera state, lock, exit handling (sections 2.3, 2.4, 2.6, 4.2) | `be/src/chromectl/chromectl.service.ts` |
| REST endpoints on the new service (section 2.8) | `be/src/chromectl/chromectl.controller.ts`, `chromectl.module.ts` |
| MCP tools `join`, `leave`, `status` (section 3) | `be/src/mcp/mcp.tools.ts` |
| `POST /mcp`, 405 for `GET`/`DELETE /mcp`, `GET /mcp/guide` (sections 2.1, 3.4) | `be/src/mcp/mcp.controller.ts`, `mcp.module.ts`, `be/src/app.module.ts` |
| Paths (section 2.10) | `be/src/paths.ts` |
| Guide (section 8) | `docs/mcp-guide.md` |
| nginx, service, start and install scripts (sections 2.9, 6) | `nginx.conf`, `headless-meet.service` (template), `run.sh`, `install.sh` |
| Tests (section 7.1) | `be/src/chromectl/*.spec.ts`, `be/test/mcp.e2e-spec.ts`, `be/test/fake-chromium.launcher.ts` |
| README | Section "Use it from your AI assistant", clone URL, install steps |

Dependencies: `@modelcontextprotocol/sdk` 1.32.2 and `zod` 3.25.76. TypeScript stays at 5.3.3. The build works
without a TypeScript upgrade.

## 2. Differences from the architecture

Each difference is the smallest change that solves a problem found during the work.

1. **Node 18 has no global `crypto` (blocker found in tests).** The architecture says SDK 1.x works on Node 18.
   It installs, but `POST /mcp` fails with `ReferenceError: crypto is not defined`. The SDK transport calls
   `crypto.randomUUID()` for every request. Fix: `be/src/mcp/webcrypto.polyfill.ts` sets `globalThis.crypto`
   from `require('crypto').webcrypto` when it is missing. On Node 20 and later it does nothing. The e2e test
   imports it first, because the SDK client needs it too.
2. **`install.sh` uses `apt-get install --no-upgrade` and runs `apt-get update` first.** On the Pi the installed
   Chromium is 125, and the apt candidate is 156. Without `--no-upgrade`, `install.sh` upgrades Chromium. Chromium
   137 and later can block `--load-extension`, and then the auto-click on "Ask to join" stops (risk 4). With
   `--no-upgrade`, apt installs only missing packages. `apt-get update` lets a fresh system find the packages.
3. **`install.sh` removes `sites-enabled/default` only if it is a symbolic link.** On the Pi it is a link to
   `sites-available/default` (checked on 9. 11. 2026). The hand-edited file in `sites-available` stays.
4. **`install.sh` uses `systemctl reenable` and `systemctl reload-or-restart nginx`.** `reenable` replaces the old
   link to `/lib/systemd/system/headless-meet.service`. `reload-or-restart` also works when nginx does not run.
5. **Deployment check `pgrep -x chromium-browser` (section 7.2, step 1) never matches.** Linux keeps only 15
   characters of a process name (`chromium-browse`). Use `pgrep -f /usr/lib/chromium-browser/chromium-browser`.
   `killall chromium-browser` is not affected: psmisc `killall` compares the first 15 characters.
6. **`PORT` environment variable in `be/src/main.ts`.** The default stays 3001. It lets a developer run a second
   instance next to another service. The Pi does not set it.
7. **`be/tsconfig.json` includes `test/**/*`.** Without it, `npm run lint` fails on every file in `test/`.
   This was already broken before this issue. `tsconfig.build.json` still excludes `test/`, so `dist/` is the same.
8. **`join` and `leave` parse the meeting before they take the lock.** Invalid input never waits for another
   call. The result is the same.
9. **`requestedBy` is cleaned in the service (`cleanName`), not in the MCP layer.** All callers get the same rule.
10. **`GET /api/join/:meetingId` now answers after Chromium started** (up to about 15 s, section 10 risk 9).
    Before, it answered at once. This is necessary for the 400 and 500 codes in section 3.4. The web UI shows
    "Loading..." during the wait, as before.
11. **The `status` tool description also says that the camera cannot see admission or the end of a meeting.**
    Reason: Claude Code gives the model the `structuredContent` JSON of a successful call, not the text. The
    sentence in the text of `status` does not reach the model in Claude Code. Error results keep their text.
12. **The guide adds `--allowedTools "mcp__webcam ..."` to the `claude -p` cron example.** `claude -p` cannot
    ask for permission, so the tool calls fail without it. Put the prompt before `--allowedTools`: the flag
    takes all following words as tool names.
13. Not done: the optional rename of the `be` package from `chartizard` (section 4). It changes the lockfile and
    has no effect.

## 3. Tests and checks

Results on 9. 11. 2026:

| Check | Result |
|---|---|
| Unit tests (`npm test` in `be/`), macOS, Node 26 | 57 passed |
| E2e tests (`npm run test:e2e`), macOS, Node 26 | 19 passed |
| Unit, e2e, lint, build in Docker `node:18.19.0-bookworm` with npm 9.2.0 (the Pi versions), after `npm ci` | 57 and 19 passed, lint and build OK |
| `npm run lint`, `npm run build` (BE), `npm run build` (FE) | OK |
| `bash -n` and `shellcheck` 0.11 on `run.sh`, `install.sh` | no findings |
| `nginx -t` with `nginx.conf` in Docker `nginx:1.22` (the Pi version) | OK |
| `run.sh` in Docker Node 18: BE and FE start, `kill <BE PID>` makes `run.sh` exit with code 1 | OK |
| Production build in Docker Node 18 with psmisc `killall` 23.6: join, force switch, leave | One fake Chromium process at a time. 0 after `leave`. The exit of the old process does not reset the new session. |

E2e tests cover: tool list, product scenarios 3, 4 and 5, `leave` with another meeting, double `join`, invalid
input (nothing starts), launch failure, `/api/join` with `source: "web"`, `/api/join` 400 and 500, `/api/end`,
405 for `GET` and `DELETE /mcp`, `/mcp/guide`, and a plain JSON-RPC `tools/list` (the `curl` check from the guide).

Manual run on the Mac with a real client (fake Chromium script, BE on 3101, FE on 3100, `nginx:1.22` in Docker
on 8180 with the repo `nginx.conf`):

1. `claude mcp add --transport http --scope local webcam http://localhost:8180/mcp` and `claude mcp list` show
   `✔ Connected`.
2. `claude -p` called `status`, `join` by link with `requestedBy`, `join` of another meeting (refused with the
   current meeting and time), `status`, `leave` of the other meeting (refused), `leave` of the right meeting,
   `status`. All results match section 3.
3. The guide check "What is the camera doing?" and the scenario 3 sentence "Connect the camera to
   meet.google.com/abc-defg-hij" worked. The model told the user that someone must admit "Meeting Room".
4. The fake Chromium got exactly `https://meet.google.com/abc-defg-hij --use-fake-ui-for-media-stream
   --load-extension=<repo>/be/src/chromectl/chrome-extension`.
5. When the fake Chromium process ended, `status` became `idle`.
6. Web UI: Join, End, and invalid input (`x;reboot` shows "Error: Bad Request") work through the proxy.
   `status` showed `source: "web"` after Join and `idle` after End.

Not checked: the guide on a second machine (acceptance criterion 7), Claude Desktop and VS Code set-ups, the
automation prompt with a real calendar, a real Chromium and Google Meet. These need the Pi or another computer.

### How to check it yourself

1. In `be/`: `npm ci`, `npm test`, `npm run test:e2e`, `npm run lint`, `npm run build`.
2. Make a fake browser: `printf '#!/bin/sh\nexec sleep 3600\n' > /tmp/fake-chromium && chmod +x /tmp/fake-chromium`.
3. Start the BE: `PORT=3101 CHROMIUM_BIN=/tmp/fake-chromium node dist/main`.
4. Run `claude mcp add --transport http --scope local webcam-dev http://localhost:3101/mcp`.
5. Ask Claude Code: "What is the camera doing?".
6. Remove the server: `claude mcp remove --scope local webcam-dev`. Stop the BE and the fake browser by PID.

On macOS `killall` has no `-w`, so `leave` does not stop the fake browser. This is expected for a dev run.

## 4. Known limitations

1. The camera cannot see admission or the end of a meeting inside Meet. `status` shows `in_meeting` until
   `leave`, the next forced `join`, or the end of the Chromium process.
2. No authentication. Anyone on the local network can start, switch and end meetings (section 10, risk 5).
3. Claude Desktop needs Node.js and `mcp-remote` on the laptop. Custom connectors cannot reach the LAN.
4. The automation needs a computer in the office network. Cloud schedulers cannot reach the camera.
5. A BE crash or a service restart ends a live meeting (Chromium is in the service cgroup).
6. `join` and `leave` can take up to about 15 s, because `killall -w` waits for Chromium to stop.
7. Node 18 is end-of-life. The polyfill (difference 1) is necessary until the Pi gets Node 20.
8. The web UI shows "Loading..." for up to 60 s after Join. This is the existing frontend code.

## 5. Deployment on the Pi

Only in a time window agreed with Filip. A service restart ends a live meeting.

1. Make sure that no meeting runs: `pgrep -f /usr/lib/chromium-browser/chromium-browser` must print nothing.
2. Back up: `cp -a ~/Documents/headless-meet ~/Documents/headless-meet.bak-2024`.
3. Back up nginx: `sudo cp /etc/nginx/sites-available/default ~/nginx-default.bak`.
4. In `~/Documents/headless-meet`, run `git fetch origin`.
5. Run `git checkout -B master origin/master` (after the merge of this branch). Do not use `git pull`.
6. Run `sudo ./install.sh`. It takes several minutes: `npm ci` and the Next.js build run on the Pi.
7. Check that Chromium is still 125: `chromium-browser --version`.
8. Check: `systemctl status headless-meet` shows `/etc/systemd/system/headless-meet.service` and `run.sh`.
9. Remove the old untracked `start.sh` only after the new unit runs.
10. Do the checks in architecture section 7.2 (steps 1 to 8). For the PID in step 8, use `systemctl status headless-meet`.

Rollback:

1. Restore the folder from `~/Documents/headless-meet.bak-2024`.
2. Run `sudo rm /etc/nginx/sites-enabled/headless-meet`.
3. Run `sudo ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default`.
4. Run `sudo rm /etc/systemd/system/headless-meet.service`.
5. Run `sudo systemctl daemon-reload && sudo systemctl reenable headless-meet`.
6. Run `sudo systemctl reload nginx && sudo systemctl restart headless-meet`.
