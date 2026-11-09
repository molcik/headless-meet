# MCP server for the webcam: test report (issue #1)

Tested commit: `41196d1` on `feat/1-mcp-server`. Date: 9. 11. 2026. Tester: Arthur Dent.
New tests for the bugs: commit `69fb9d5` (`be/src/chromectl/chromectl.service.findings.spec.ts`).

Result: criteria 1 to 7 and 9 pass. Criterion 8 is not checked on the Pi, because the camera is in live use.
I found 1 medium bug, 5 low bugs and 3 notes. No bug lets input run a command or open a non-Meet URL.

## 1. Test environment

| Item | Value |
|---|---|
| Pi-like stack | Docker `node:18.19.0-bookworm`, npm 9.2.0, nginx 1.22.1, psmisc `killall` 23.6, repo `nginx.conf`, `run.sh` as user `pi`, nginx on `localhost:8280` |
| Fake Chromium | `/usr/bin/chromium-browser` is a bash wrapper that runs `exec`, as on the Pi. The process name is `chromium-browse`, so `killall` really stops it. It logs its arguments. |
| Native run | macOS, Node 26.9.0, BE on port 3201 with `CHROMIUM_BIN` set to a fake script |
| MCP clients | Claude Code 2.1.301 (`claude mcp add --transport http --scope local`), `mcp-remote` 0.16.5 (the Claude Desktop bridge), `curl`, Python JSON-RPC scripts |
| Web UI | Chrome (Playwright), iPhone 13 emulation and desktop 1280 × 800, through nginx |
| Pi (read only) | Node 18.19.0, npm 9.2.0, bash 5.2.15, Chromium 125, `/usr/bin/chromium-browser` runs `exec` (line 226), `sites-enabled/default` is a link, `KillMode=control-group` |

## 2. Automatic tests

| Check | macOS, Node 26 | Docker, Node 18.19 |
|---|---|---|
| `npx jest` (unit) at `41196d1` | 57 passed | 57 passed |
| `jest --config ./test/jest-e2e.json` | 19 passed | 19 passed |
| `eslint` (without `--fix`), `npm run build` (BE) | OK | OK |
| `npm run build` (FE) | not run | OK |
| Unit tests with the new findings tests (`69fb9d5`) | 60 passed | 60 passed |

## 3. Acceptance criteria

| # | Result | Evidence |
|---|---|---|
| 1 | Pass | `claude mcp list` shows `webcam: http://localhost:8280/mcp (HTTP) - ✔ Connected`. `tools/list` gives `join`, `leave`, `status` through Claude Code, `curl` and `mcp-remote`. |
| 2 | Pass | 66 bad and good inputs through MCP `join` with `force: true` (section 4.1). All shell, flag, scheme, host, homoglyph, zero-width, control character and length attacks give `invalid_meeting`. Chromium got only `https://meet.google.com/<code>`. `/tmp/pwned` was not created. Wrong types (`meeting: 123`, `force: "true"`) give an MCP input validation error. |
| 3 | Pass, with bug 1 | The fake Chromium got exactly `https://meet.google.com/abc-defg-hij --use-fake-ui-for-media-stream --load-extension=/home/pi/hm/be/src/chromectl/chrome-extension`. `status` shows the code and `startedAt`. Bug 1: `join` reports success also when Chromium ends at once. Real Chromium and Meet are not tested. |
| 4 | Pass | Claude Code as Petr: the refusal text names `abc-defg-hij`, the start time and "Jana (mcp)". With `force: true` the camera switched. One Chromium process ran after the switch. |
| 5 | Pass | `leave` gives `left` and stops the process. `leave` when idle gives `was_idle` and "The camera was idle. Nothing to do." |
| 6 | Pass, with bug 3 | `status` gives `state`, `meetingCode`, `meetingUrl`, `startedAt` (UTC), `startedBy`, `source`. Line breaks in `requestedBy` become spaces. A 20 000 character name is cut to 80 characters. |
| 7 | Pass, with bugs 4 and 5 | `GET /mcp/guide` through nginx is `text/plain; charset=utf-8` and identical to `docs/mcp-guide.md` (`diff` is empty). The guide has set-ups for Claude Code, Claude Desktop, VS Code with Copilot and a generic client. I followed section 3.1 step by step (section 5). The `mcp-remote` arguments from section 3.2 work. VS Code was not tested (not installed). |
| 8 | Not checked on the Pi | The task forbids changes on the Pi. Checked instead: `nginx -t` with the repo `nginx.conf` on nginx 1.22.1. `run.sh` starts BE and FE. `kill <BE PID>` makes `run.sh` exit with code 1. The unit template and `install.sh` were reviewed. Reboot and `install.sh` on the Pi are open. |
| 9 | Pass | Through nginx: `/api/join/abc-defg-hij` and `/api/join/ABCDEFGHIJ` give 200 `Joining meeting...`. `/api/end` gives 200 `Shuting down meeting...`. `x;reboot`, `$(reboot)` and an `evil.com` link give 400. Web UI in Chrome, mobile and desktop: Join gives `source: "web"`, End gives `idle`, `x;reboot` shows "Bad Request". No horizontal scroll on the phone. `fe/` has no change. |

## 4. Attacks and edge cases

### 4.1 Input to `join`

Refused (`invalid_meeting`), a selection: `abc-defg-hij; reboot`, `$(touch /tmp/pwned)`, `` `id` ``, `abc-defg-hij|sh`,
`--headless`, `-abc-defg-hij`, `--renderer-cmd-prefix=/bin/sh abc-defg-hij`, `javascript:alert(1)`,
`JAVASCRIPT://meet.google.com/abc-defg-hij`, `data:`, `file:`, `ftp:`, `chrome:`, `view-source:`, `intent:`,
`https://meet.google.com.evil.com/...`, `https://meet.google.com@evil.com/...`, `https://evil.com\@meet.google.com/...`,
`https://meet.google.com./...`, `https://meet.google.com//abc-defg-hij`, `.../abc-defg-hij/`, `.../abc-defg-hij%0a`,
Cyrillic `а`, Cyrillic `ј`, Kelvin sign `K`, Unicode hyphen, full-width letters, zero-width space, NUL, line break,
right-to-left override, empty, spaces only, 201 characters, 100 000 characters.

Accepted, and the URL is rebuilt from the code: `https://evil.com@meet.google.com/abc-defg-hij`,
`https://meet.google.com:8443/...`, `https://meet%2egoogle.com/...`, `...?x="><script>`, `...#--headless`,
`﻿abc-defg-hij`, 500 spaces around a code. This is safe, because Chromium never gets the input.

### 4.2 Concurrency and Chromium

| Case | Result |
|---|---|
| 8 parallel `join` for 8 meetings, no `force` | 1 `joined`, 7 `busy`, 1 launch |
| 8 parallel `join` with `force` | 8 `joined` one after the other in 16.4 s. 1 process at the end. |
| `join` with force, `leave`, `join`, `leave` with a code, in parallel | State and processes match the last call. 0 processes at the end. |
| Chromium crashes during a meeting (`kill -SEGV`) | `status` becomes `idle`. The next `join` works without `force`. |
| Chromium ends at once after the start | Bug 1 |
| `leave` with Jana's code after Petr's force switch | Refused (`not_in_that_meeting`). Petr's meeting stays. |

### 4.3 HTTP and MCP protocol

| Request | Result |
|---|---|
| `GET /mcp`, `DELETE /mcp` | 405, JSON-RPC `-32000` |
| `POST /mcp` with `Content-Type: text/plain` or a form body (cross-site page) | 415. A cross-site page cannot call the tools without a preflight. `OPTIONS` gives 404. |
| Without `Accept: text/event-stream` | 406 |
| Body larger than 100 kB | 413 |
| Unknown tool | `isError: true`, "Tool reboot not found" |
| JSON-RPC batch, notification | 200 with two results, 202 |
| Broken JSON | 400 with a NestJS body, not JSON-RPC `-32700` (note 1) |

## 5. Guide and automation prompt

I followed the guide as a new user on the Mac against the Docker stack. Differences: the URL
`http://localhost:8280/mcp` instead of `http://webcam.local/mcp`, and `--scope local` instead of `--scope user`.

1. Section 3.1, steps 1 to 3: `claude mcp add` and `claude mcp list` worked. "What is the camera doing?" called `status`.
2. Section 3.2: `npx -y mcp-remote <url> --allow-http --transport http-only` gave `initialize`, three tools and `status`.
3. Section 3.4: the `curl` command lists the three tools.
4. Section 5 and 6: I ran the prompt unchanged with `claude -p "$(cat prompt.txt)" --allowedTools "mcp__webcam mcp__cal"`.
   `mcp__cal` is a fake calendar MCP server. Its `list_events` works like the Google Calendar API.

| Scenario | Model | Result |
|---|---|---|
| A. Jana's event in Man Cave starts in 1 minute, camera idle | Opus | `join` with the link and `requestedBy: "Jana"`. Correct. |
| B. Jana's event ended 1 minute ago, camera in it | Opus, Haiku (2 runs) | `leave` with `meeting: "jan-abcd-efg"`. The second Haiku run did nothing, because the camera was idle. Correct. |
| C. Jana's event ended, Petr took the camera with `force` | Opus | "No camera action". Petr's meeting stays. Correct. |
| D. Back-to-back: Jana's event A ended 30 s ago, her event B starts | Opus | `leave` A, then `join` B. Correct. |

The prompt does what it should, and `leave` with `meeting` does not close the meeting of another person.
All models read the calendar from 10 minutes ago, not from now as step 1 says (bug 4).

## 6. Bugs

### Bug 1 (medium): `join` reports "joined" when Chromium ends at once

`ChromectlService.join` sets `in_meeting` and returns `joined` when the process starts (`spawn` event).
If Chromium ends a moment later, the exit handler sets `idle`. The caller already got the success message.

Reproduction (Docker stack):

1. Make the fake Chromium end with code 3 at the start (`touch /tmp/crash-now`).
2. Call MCP `join` with `qqq-wwww-eee` and `force: true`.
3. Result: `isError: false`, "The camera is opening meeting qqq-wwww-eee...". `status` 1 s later: `idle`.
4. `GET /api/join/rrr-tttt-yyy` gives 200 `Joining meeting...`, and `status` is `idle`.

On the Pi this happens when Chromium cannot start, for example before the desktop session runs after a boot
("Missing X server"), or with a profile lock. The first Claude Code run showed it: the model said that the camera
joined, and then that the status was idle. The assistant tells the user a wrong result. The automation repairs it
at the next run, 5 minutes later. Proposal: wait about 2 s after `spawn`. If the process ended, throw `LaunchError`.
Test: `join fails with LaunchError when Chromium exits right after the start`.

### Bug 2 (low): `leave` with a meeting code stops a Chromium that the camera does not track

When the state is `idle`, `leave({ meeting })` still calls `stopAll()`. This stops every `chromium-browser`
process, also one that someone started by hand on the Pi desktop.

Reproduction: start `/usr/bin/chromium-browser https://meet.google.com/han-dsta-rtd` by hand in the container
(state stays `idle`). Call `leave` with `meeting: "jan-abcd-efg"`. Result: `was_idle`, and the hand-started
Chromium is gone.

Architecture section 4.2 asks for `stopAll()` when idle, but the guide says: "With `meeting`, the camera leaves
only if it is in that meeting. This protects the meetings of other people." Proposal: call `stopAll()` when idle
only if `meeting` is missing. Test: `leave with a meeting code does not stop Chromium when the camera is idle`.

### Bug 3 (low): `cleanName` can split a character

`cleanName` cuts the name at 80 UTF-16 code units. An emoji at position 80 becomes a lone surrogate.

Reproduction: `join` with `requestedBy` = 79 × `a` + `😀` + `b`. The JSON answer of `status` contains `"\ud83d"`.
A strict client fails: Python `print` of the result raised `UnicodeEncodeError`. Claude Code shows the name as
"an unreadable user ID". Proposal: cut by code points (`Array.from(name).slice(0, 80).join('')`).
Test: `does not split a character at the 80 character limit`.

### Bug 4 (low): the automation prompt reads the wrong time window

Step 1 says "Read my calendar from now until 10 minutes from now". Step 3 needs events that "ended in the last
10 minutes". These events are not in the window of step 1. Opus and Haiku widened the window by themselves, and
Opus wrote: "Your step 1 only covers now to 10 minutes ahead, but step 3 needs events that already ended, so I also
checked back to 10 minutes ago." Another model can follow step 1 literally and never call `leave`.
The same text is in architecture section 8, item 5. Proposal: "Read my calendar from 10 minutes ago until
10 minutes from now."

### Bug 5 (low): the VS Code text in the guide is partly wrong

Guide section 3.3 says: "The older `.vscode/mcp.json` format uses the key `servers`." The VS Code documentation
(MCP configuration reference, 9. 11. 2026) shows `.vscode/mcp.json` and the user profile `mcp.json` with `servers`
as the current VS Code format. `~/.copilot/mcp-config.json` with `mcpServers` is the portable Copilot format. Both
work. Proposal: "In VS Code, the workspace file `.vscode/mcp.json` uses the key `servers` instead of `mcpServers`."

### Bug 6 (low): queued calls can get a 504 from nginx, and the camera still switches

The service runs `join` and `leave` one after the other. nginx waits 60 s for an answer (`proxy_read_timeout`
default). A switch can take 10 s or more when `killall -w` reaches its 10 s limit.

Reproduction: in the first Docker run every switch took 10.2 s (a zombie process that my set-up left made
`killall -w` wait). 8 parallel `join` calls with `force` gave `HTTP 504 Gateway Time-out` to a client. The BE still
ran the queued switch after the 504. The client sees an error, but the camera changed. On the Pi this needs several
parallel calls and a slow Chromium stop, so it is rare. Proposal: set `proxy_read_timeout 120s` in `location /mcp`,
or refuse a call that waited for the lock for more than about 30 s.

## 7. Notes (no change necessary)

1. Broken JSON in `POST /mcp` gives the NestJS 400 body, not JSON-RPC `-32700`. The SDK clients handle it.
2. `claude -p` without stdin waits 3 s and writes "Warning: no stdin data received in 3s" to the log. The guide cron
   line can add `< /dev/null`.
3. The web UI sends the input without encoding. A full Meet link gives "Not Found". This was the same before this
   issue (out of scope).

## 8. Not tested

1. Real Chromium 125 and Google Meet on the Pi: admission, video and audio, `killall -w` time with real Chromium.
2. Criterion 8 on the Pi: `sudo ./install.sh`, the new unit, reboot, `systemctl` restart after a BE crash.
3. The guide on a second computer in the office network with `webcam.local` (mDNS). I used one Mac and `localhost`.
4. Claude Desktop itself and VS Code with Copilot. Only the `mcp-remote` bridge was tested.
5. The automation with a real Google Calendar.

## 9. Round 2 (kolo 2)

Tested commit: `634ec02` on `feat/1-mcp-server`. Date: 9. 11. 2026. Tester: Arthur Dent.
New tests: commit `fac604e` (`be/src/chromectl/chromectl.service.findings.spec.ts`).

Result: bugs 1 to 6 are fixed. Criteria 1 to 7 and 9 pass again. I found 1 new low bug (bug 7) and 6 notes.
Verdict: ready for approval. Bug 7 is low and can wait for a follow-up.

### 9.1 Test environment

| Item | Value |
|---|---|
| Pi-like stack | Own image from `git archive 634ec02`: Docker `node:18.19.0-bookworm`, nginx 1.22.1 with the repo `nginx.conf`, psmisc `killall`, `run.sh` as user `pi`, `docker run --init`, nginx on `localhost:8281` |
| Fake Chromium | `/usr/bin/chromium-browser` is a bash wrapper with `exec`, as on the Pi. It starts a C program with the process name `chromium-browse`. Files in `/tmp/fake` make it exit with code 3 at once, exit after N ms, or wait N s after `SIGTERM`. |
| Native run | macOS, Node 26.9.0, BE on port 3211 |
| Clients | Claude Code 2.1.301 (`claude mcp add --transport http --scope local`), Python JSON-RPC scripts, `curl`, Playwright 1.65 (iPhone 13 and desktop 1280 × 800) |

Container set-up lesson: without `--init`, PID 1 in the container is `su`. It does not reap zombie processes, and
`killall -w` waits its full 10 s for a zombie. This explains the 10.2 s switches in round 1 (bug 6). On the Pi,
systemd reaps the processes.

### 9.2 Automatic tests

| Check | macOS, Node 26 | Docker, Node 18.19 |
|---|---|---|
| `npx jest` (unit) at `634ec02` | 61 passed | 61 passed |
| `jest --config ./test/jest-e2e.json` | 23 passed | 23 passed |
| `eslint` without `--fix`, `npm run build` (BE and FE) | OK | OK |
| Unit tests with the new tests (`fac604e`) | 65 passed (1 `it.failing` for bug 7) | 65 passed |

### 9.3 Bugs 1 to 6

| Bug | Status | Evidence (own reproduction from section 6) |
|---|---|---|
| 1 | Fixed | Fake exits with code 3: MCP `join` gives `isError: true`, `launch_failed`, "The camera could not start Chromium: Chromium exited right after the start (code=3, signal=null)." `status` is `idle`. `/api/join/rrr-tttt-yyy` gives 500. Exit after 1.5 s gives `launch_failed`. Exit after 2.5 s gives `joined`, and `status` becomes `idle` (boundary, as designed). Claude Code (Haiku) told the user that the camera could not start Chromium and that the status is idle. |
| 2 | Fixed | Hand-started Chromium in the container, state `idle`. `leave` with `jan-abcd-efg` gives `was_idle`, the process lives. `leave` without arguments and `/api/end` stop it. MCP `join` stops it before the start. |
| 3 | Fixed | `requestedBy` = 79 × `a` + `😀` + `b` gives `startedBy` = 79 × `a` + `😀`. The raw JSON of `status` has no `\ud83d`. Flag emoji, family emoji with ZWJ and 50 × `e` + combining accent do not give a lone surrogate. |
| 4 | Fixed | `GET /mcp/guide` through nginx, line 130: "Read my calendar from 10 minutes ago until 10 minutes from now." Architecture section 8 has the same text. |
| 5 | Fixed | Guide line 82: "In VS Code, the workspace file `.vscode/mcp.json` uses the key `servers` instead of `mcpServers`." |
| 6 | Fixed | Fake waits 5 s after `SIGTERM`, 8 parallel `join` with `force` through nginx: 4 `joined`, 4 `queue_timeout`, all HTTP 200, longest answer 33.1 s, 1 process at the end. Fake ignores `SIGTERM` (stop needs the `KILL` after 10 s), 4 `join` and 4 `leave` in parallel: longest answer 36 s, no 504, 0 processes after the last `leave`. Web UI path: 4 parallel `/api/join` and `/api/end` give 200, 200, 200, 503, and 503 for `/api/end`. Claude Code under load got "The camera is busy with other requests. Nothing was changed. Try again in a minute." |

### 9.4 Regression

| # | Result | Evidence |
|---|---|---|
| 1 | Pass | `claude mcp list`: `webcam-t2: http://localhost:8281/mcp (HTTP) - ✔ Connected`. Claude Code lists `join`, `leave`, `status`. |
| 2 | Pass | 37 bad inputs (the list of section 4.1 plus `../` paths, CRLF and `/lookup/abc`) give `invalid_meeting`. 9 good inputs give `joined`. The launch log has only `https://meet.google.com/abc-defg-hij --use-fake-ui-for-media-stream --load-extension=/home/pi/hm/be/src/chromectl/chrome-extension`. `/tmp/pwned` does not exist. Wrong types give `-32602`. |
| 3 | Pass | Same arguments as in round 1. `status` shows the code and `startedAt`. |
| 4 | Pass | Busy refusal names `jan-abcd-efg`, the start time and "Jana (mcp)". `force` switches, 1 process. Jana's `leave` with her code after Petr's switch gives `not_in_that_meeting`. |
| 5 | Pass | `leave` gives `left`, idle `leave` gives `was_idle`. |
| 6 | Pass, with bug 7 | Fields as in round 1. |
| 7 | Pass | `GET /mcp/guide` through nginx is `text/plain; charset=utf-8` and identical to `docs/mcp-guide.md`. Second machine not tested (section 8). |
| 8 | Not checked on the Pi | `install.sh`, `run.sh`, `nginx.conf` and the unit template did not change in round 2. The stack starts with `run.sh` and the repo `nginx.conf`. |
| 9 | Pass | Playwright, iPhone 13 and desktop: Join gives 200 and `source: "web"`, End gives `idle`, `x;reboot` shows "Error: Bad Request". No horizontal scroll. |

Concurrency: 8 parallel `join` without `force` from idle give 1 `joined` and 7 `busy`. `kill -SEGV` during a meeting
gives `idle`, and the next `join` works without `force`.

Time cost of the bug 1 fix: `join` from idle takes 2.1 s (was 0.1 s). A switch and `/api/join` take 4.1 s, because
`killall -w` needs about 2 s and the start check 2 s.

### 9.5 New bug

#### Bug 7 (low): a lone surrogate in `requestedBy` still reaches `status`

Bug 3 is fixed for the cut at 80. But `cleanName` does not remove a lone surrogate that the client sends itself.
The JSON of `status` then has the same broken character as in bug 3.

Reproduction (Docker stack):

1. Call MCP `join` with `meeting: "jan-abcd-efg"`, `force: true` and `requestedBy: "Jana\ud83d"` (JSON escape).
2. Call `status` with `curl`.
3. Result: the raw JSON has `"startedBy":"Jana\ud83d"`. Python `s.encode("utf-8")` raises `UnicodeEncodeError`.

One broken client can break the `status` answer for all other clients until the next `join` or `leave`.
Proposal: in `cleanName`, remove lone surrogates, for example `.replace(/\p{Surrogate}/gu, '')`.
`String.prototype.toWellFormed` does not exist in Node 18. Test: `removes a lone surrogate from the input`
(`it.failing` in `fac604e`).

### 9.6 Notes (no change necessary)

4. During the 2 s start check, `status` already shows `in_meeting`. When the check fails, `status` becomes `idle`.
   A parallel `join` waits in the queue and is not refused, so only a reader of `status` sees the short wrong state.
5. The queue limit counts per call. A later call can run while earlier calls are refused: with Claude Code under
   load, calls 3 and 4 got `queue_timeout`, and the later Claude Code call joined. A refused call changes nothing,
   so the result is correct, but the order is not first come, first served.
6. A refused call gets `queue_timeout` when its turn comes, not at 25 s. I saw 25 s to 36 s. The maximum is about
   25 s plus one switch (about 12 s with the `KILL` path). This is below the 60 s of nginx.
7. Web UI: when Chromium cannot start, the page shows "Error: Internal Server Error" (generic 500 body). The End
   button ignores the answer, so a 503 from `/api/end` shows nothing. The web UI was like this before (out of scope).
8. `leave` with the code of a meeting that someone started by hand gives `was_idle`, and that Chromium stays. This is
   the intended result of the bug 2 fix. Only `leave` without arguments or `/api/end` stops it.
9. Implementation decision 3 (Chromium hands the URL to an old instance and exits with 0) is not reproducible with
   `killall -w`. If it happens after a stop time-out, the camera runs an untracked meeting, and with the bug 2 fix
   only `leave` without arguments stops it.

### 9.7 Not tested in round 2

1. The Pi itself. SSH as `pi` with my key was refused (`Permission denied (publickey,password)`), and the task forbids
   changes. Real Chromium 125: how long a failed start takes, and if a normal start can exit within 2 s.
2. Items 2 to 5 of section 8 are still open.
