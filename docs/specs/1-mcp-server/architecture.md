# MCP server for the webcam: architecture (issue #1)

Input: `product.md` in this folder (agreed with Filip on 9. 11. 2026).
Status: proposal for the developer. Nothing in this document is implemented yet.

## 1. Facts this design depends on

These facts come from the repo (`master` 667d883) and from a read-only check of the Pi on 9. 11. 2026.

| Item | Value |
|---|---|
| OS | Raspberry Pi OS, Debian 12 bookworm, aarch64, 4 GB RAM, hostname `webcam` |
| Display | Wayfire with Xwayland on `:0` (`/home/pi/.Xauthority`) |
| Node.js | 18.19.0 (Debian package), npm 9.2.0 |
| Chromium | 125.0.6422.133. `/usr/bin/chromium-browser` is a wrapper script that ends with `exec`, so the spawned PID is the Chromium main process. Process name: `chromium-browser`. |
| nginx | 1.22.1. Active site: hand-edited `/etc/nginx/sites-enabled/default` (`default_server`, `/` to :3000, `/api/` to :3001). The repo `nginx.conf` is not installed. |
| Service | `headless-meet.service`, enabled, `User=pi`, `KillMode=control-group`, `ExecStart=/bin/bash /home/pi/Documents/headless-meet/start.sh` |
| Deployed code | `/home/pi/Documents/headless-meet`, local `master` at 8c0fa25 (2024-08-03). GitHub `master` was force-pushed since then, so the Pi history is not an ancestor of `origin/master`. |
| Deployed BE | Module `src/puppeteer/*` (same logic as `src/chromectl/*` in the repo). `app.module.ts` also loads `ConfigModule`. |
| Deployed start | `start.sh` (not in the repo) runs `npm install` and `npm run build` for BE and FE at every boot, then `node dist/main &` and `npm run start` for FE. |
| Clock | NTP synchronised. Time zone `Europe/London`, not `Europe/Prague`. |

Consequences:

1. Chromium is a child of the BE node process and is in the service cgroup. A service restart kills Chromium and ends a live meeting.
2. If the BE node process crashes today, systemd does not see it, because `start.sh` keeps FE in the foreground. The web UI then stays up without a backend.
3. The repo is not deployable as it is: `headless-meet.service` calls `start.sh`, which the repo does not contain. `install.sh` has broken syntax (`apt install nginx, node, ...`, `-depth 1`), clones to `~/headless-meet` while the unit uses `~/Documents/headless-meet`, and links a file name that does not exist (`webcam.local` instead of `webcam`).
4. MCP SDK v2 (`@modelcontextprotocol/server` 2.x) needs Node 20 or later. The Pi has Node 18.

## 2. Decisions

### 2.1 Transport: Streamable HTTP, stateless, JSON responses

- Use the Streamable HTTP transport of the current MCP specification. Do not use the old HTTP+SSE transport.
- Run the transport in stateless mode (`sessionIdGenerator: undefined`) with `enableJsonResponse: true`. The tools are short request/response calls. Nothing needs server-to-client streaming or a session.
- `POST /mcp` handles JSON-RPC. `GET /mcp` and `DELETE /mcp` return HTTP 405 with a JSON-RPC error body (the pattern from the SDK stateless example).
- Create one `McpServer` and one transport per HTTP request, as the SDK stateless example does. Creation is cheap. This avoids request ID collisions between clients.
- No authentication. This follows `product.md` ("anyone on the local network").

### 2.2 SDK and dependencies

- Add `@modelcontextprotocol/sdk@^1.32` (1.32.2 is the latest v1, `engines.node >= 18`). Do not use SDK v2: it needs Node 20.
- Add `zod@^3.25` and import from `'zod'`. Zod 4 needs TypeScript 5.5 or later, and the BE lockfile has TypeScript 5.4.5. If `nest build` fails on SDK or zod types, bump the dev dependency `typescript` to `^5.5`. Do not change anything else for this.
- The BE compiles to CommonJS with classic module resolution. This works with SDK v1: the SDK has `typesVersions` for types and an `exports` map with a `require` branch for runtime. Import paths: `@modelcontextprotocol/sdk/server/mcp.js` and `@modelcontextprotocol/sdk/server/streamableHttp.js`.
- Add no other runtime dependencies.

### 2.3 One owner of the camera state

`ChromectlService` becomes the only owner of the camera state and the only code that starts or stops Chromium. The REST controller (web UI) and the MCP tools both call this service. There is no second state store, no file, and no database.

The OS boundary moves into a separate injectable class `ChromiumLauncher`. Tests replace it with a fake. `launch.sh` and `end.sh` are deleted. Node starts Chromium directly with `spawn` and an argument array (no shell).

### 2.4 State model

```ts
type Source = 'mcp' | 'web';

interface MeetingSession {
  meetingCode: string;      // normalised, e.g. "abc-defg-hij"
  meetingUrl: string;       // "https://meet.google.com/abc-defg-hij"
  startedAt: string;        // ISO 8601 UTC, e.g. "2026-11-09T09:02:11.000Z"
  startedBy: string | null; // name sent by the MCP client, null if none
  source: Source;
}

type CameraStatus =
  | { state: 'idle' }
  | ({ state: 'in_meeting' } & MeetingSession);
```

Rules:

1. The state is in memory. After a BE start the state is `idle`. This is correct, because a service start also kills Chromium (cgroup), and section 2.9 makes a BE crash restart the whole service.
2. `in_meeting` means "the camera opened this meeting in Chromium". The camera cannot see if someone admitted it, or if the meeting ended inside Meet. The tool descriptions and the guide say this.
3. When the tracked Chromium process exits for any reason (crash, someone closes it, `leave`), the state becomes `idle`. The exit handler compares the process handle with the current one. An exit of an old process after a force switch must not reset the new session.
4. Times are UTC ISO strings. The Pi time zone is `Europe/London`, and the users are in `Europe/Prague`. The assistant converts the time for the user.
5. There is no `joining` state. Admission is manual and the camera cannot detect it, so a third state adds no information.

### 2.5 Input validation (removes the shell injection risk)

New pure module `be/src/chromectl/meeting-code.ts`:

```ts
export class InvalidMeetingError extends Error {}
export function parseMeeting(input: string): { meetingCode: string; meetingUrl: string };
```

Algorithm:

1. Trim the input. If it is empty or longer than 200 characters, reject it.
2. If the input contains `/` or `.`, treat it as a URL. Add `https://` if there is no scheme. Parse it with `new URL()`. The scheme must be `http` or `https`. The host, in lower case, must be exactly `meet.google.com`. The path must be exactly one segment. Ignore the query string and the fragment (Calendar adds `?authuser=0` or `?hs=122`).
3. The code (the input itself, or the path segment) must match `/^[a-z]{3}-?[a-z]{4}-?[a-z]{3}$/i`.
4. Normalise the code to lower case with dashes: `abc-defg-hij`.
5. Build the URL only from the normalised code: `https://meet.google.com/${meetingCode}`. Never pass the user input to Chromium.

Error message: `Not a Google Meet meeting: "<input, max 60 chars>". Use a link like https://meet.google.com/abc-defg-hij or a code like abc-defg-hij.`

Effects:

- No shell is involved (`spawn`, `shell: false`, argument array). Input cannot run a command.
- The URL host is a constant. Input cannot open a non-Meet URL.
- The code cannot start with `-`, so it cannot become a Chromium flag.
- The REST path `/api/join/:meetingId` uses the same function. It still accepts the codes that people type today (`abc-defg-hij`, `abcdefghij`, upper case). It now returns HTTP 400 with the message instead of HTTP 500.
- Meet nicknames (`meet.google.com/my-room`) and `lookup/...` links are refused. They only work for signed-in Workspace users, and the camera joins as a guest.

### 2.6 `force` and concurrency

- `force: true` means: stop whatever Chromium runs, then launch the requested meeting. This is also true when the requested meeting is the current one (the user can use it to reload a stuck lobby).
- `join` without `force` for the meeting that already runs returns `already_in_meeting` and does nothing. An automation that calls `join` twice is safe.
- `join` without `force` while another meeting runs is refused with the current session.
- The service runs `join` and `leave` one at a time with a promise-chain lock. Two parallel `join` calls cannot both launch. `status` does not take the lock and returns the current snapshot.

### 2.7 `leave` protects other people's meetings (addition to `product.md`)

`leave` gets an optional `meeting` argument. If it is present and the camera is in a different meeting, `leave` refuses and returns the current session.

Reason: Jana's automation calls `leave` at the end of her meeting. If Petr force-switched the camera to his meeting before that, a plain `leave` would end Petr's meeting. The guide prompt always passes `meeting`. A plain `leave` without arguments still works as acceptance criterion 5 describes.

### 2.8 Web UI and REST

- No change in `fe/`.
- `GET /api/join/:meetingId` calls `join({ meeting, force: true, source: 'web', startedBy: null })`. This keeps today's behaviour: the web UI always switches the camera. It returns the same string `"Joining meeting..."`.
- `GET /api/end` calls `leave({})`. It returns the same string `"Shuting down meeting..."`. Keep the typo: this issue does not change the REST responses.
- `status` shows web UI meetings with `source: "web"` and `startedBy: null`.
- Known side effect: the web UI can end a meeting that an assistant started, without a warning. This is today's behaviour and `product.md` asks to keep it. See open question 2.

### 2.9 Paths, nginx, service

- nginx: add one block `location /mcp` that proxies to `http://localhost:3001` with `proxy_http_version 1.1`, `proxy_buffering off` and `proxy_set_header Host 127.0.0.1`. It covers `/mcp` (MCP endpoint) and `/mcp/guide` (guide). Add `default_server` to the `listen` lines, so access by IP also works.
- MCP endpoint for clients: `http://webcam.local/mcp`.
- Guide URL: `http://webcam.local/mcp/guide`.
- `run.sh` starts BE and FE as background jobs and runs `wait -n`. When one of them exits, the script exits with code 1, and systemd restarts the service (`Restart=on-failure`, `RestartSec=5`). A BE crash then ends a live meeting, but the camera never stays in a state where the web UI works and the API does not.
- `run.sh` does not build. `install.sh` builds. The boot no longer depends on npm and the internet.
- `headless-meet.service` becomes a template with `@REPO_DIR@` and `@RUN_USER@`. `install.sh` writes it to `/etc/systemd/system/` with `sed`. The unit then always points to the folder where the repo really is.

### 2.10 The guide

- File: `docs/mcp-guide.md` (one Markdown file, in the repo).
- `GET /mcp/guide` in the BE reads the file at each request and returns it as `text/plain; charset=utf-8`. Browsers show it as text, and assistants can fetch it. If the file is missing, the endpoint returns HTTP 500. The BE does not read it at start, so a missing guide never stops the web UI.
- Why the BE and not nginx: nginx runs as `www-data` and cannot read `/home/pi` (mode `drwx------`). Why the BE and not Next.js `public/`: the BE sets a content type that browsers display.
- Path resolution: new file `be/src/paths.ts` exports `REPO_ROOT = path.resolve(__dirname, '..', '..')`. This is correct from `be/src` (tests, ts-node) and from `be/dist` (production). The guide is `REPO_ROOT/docs/mcp-guide.md`. The Chrome extension is `REPO_ROOT/be/src/chromectl/chrome-extension`. This removes the `$(pwd)` dependency of `launch.sh`.
- The MCP server sends a short `instructions` text in `initialize` that names the guide URL.

### 2.11 How each client connects (checked on 9. 11. 2026)

| Client | Method | Note |
|---|---|---|
| Claude Code | `claude mcp add --transport http --scope user webcam http://webcam.local/mcp` | Direct HTTP. Check with `claude mcp list` or `/mcp`. |
| Claude Desktop | `claude_desktop_config.json`: `{"mcpServers":{"webcam":{"command":"npx","args":["-y","mcp-remote","http://webcam.local/mcp","--allow-http","--transport","http-only"]}}}` | "Custom connectors" do not work: Claude connects to them from Anthropic's cloud, which cannot reach the office LAN (Claude help center, "Get started with custom connectors using remote MCP", section "Network requirements"). The local bridge `mcp-remote` needs Node.js on the laptop. `--allow-http` is required for HTTP to a non-loopback host. |
| VS Code, GitHub Copilot | `~/.copilot/mcp-config.json`: `{"mcpServers":{"webcam":{"type":"http","url":"http://webcam.local/mcp"}}}` or the command "MCP: Add Server", type HTTP | Direct HTTP. The older `.vscode/mcp.json` format uses `servers` instead of `mcpServers`. |
| Generic client | Streamable HTTP, URL `http://webcam.local/mcp`, no auth, no session | |

If `webcam.local` does not resolve (some Windows set-ups), the guide tells the user to use the IP address of the Pi. See open question 4.

## 3. API contract of the MCP tools

All tools return:

- `content`: one text item with one or two English sentences for the model.
- `structuredContent`: the object in the tables below.
- `isError: true` for a refusal or a failure. The model then sees the message and can tell the user.

The tools do not declare `outputSchema`. This keeps error results simple and avoids SDK validation of error objects.

The server name is `headless-meet`, version from `be/package.json`.

### 3.1 `join`

Title: "Send the webcam into a Google Meet meeting".
Annotations: `destructiveHint: true` (with `force` it ends another meeting), `idempotentHint: true`, `openWorldHint: false`.

Description (text for the model): "Opens a Google Meet meeting on the Man Cave room webcam. The camera joins as the guest 'Meeting Room'. Someone in the meeting must admit it. The camera cannot see if it was admitted. If the camera is already in another meeting, the call is refused. Set force to true only if the user explicitly wants to take over the camera."

Input (zod raw shape):

| Field | Type | Required | Rule |
|---|---|---|---|
| `meeting` | string | yes | 1 to 200 characters. Full Meet URL or code. Section 2.5. |
| `force` | boolean | no, default `false` | Section 2.6. |
| `requestedBy` | string | no | Name of the person the assistant acts for. Trim, remove control characters and line breaks, cut to 80 characters. Empty after cleaning means `null`. |

Results:

| Case | `isError` | `structuredContent` | Text |
|---|---|---|---|
| Joined | false | `{ result: "joined", session: MeetingSession, replaced: MeetingSession \| null }` | "The camera is opening meeting abc-defg-hij. Someone in the meeting must admit 'Meeting Room'." When `replaced` is set, add: "It left meeting xyz-abcd-efg first." |
| Same meeting, no force | false | `{ result: "already_in_meeting", session: MeetingSession }` | "The camera is already in meeting abc-defg-hij since <startedAt>." |
| Busy | true | `{ error: "busy", current: MeetingSession }` | "The camera is in meeting xyz-abcd-efg since <startedAt>, started by <startedBy or 'unknown'> (<source>). Ask the user before you call join again with force=true." |
| Invalid input | true | `{ error: "invalid_meeting", message }` | The message from section 2.5. |
| Launch failed | true | `{ error: "launch_failed", message }` | "The camera could not start Chromium: <message>." The state stays `idle`. |

### 3.2 `leave`

Title: "Take the webcam out of the meeting".
Annotations: `destructiveHint: true`, `idempotentHint: true`, `openWorldHint: false`.

Input:

| Field | Type | Required | Rule |
|---|---|---|---|
| `meeting` | string | no | If present: parse it with section 2.5. Leave only if the camera is in this meeting. |

Results:

| Case | `isError` | `structuredContent` | Text |
|---|---|---|---|
| Left | false | `{ result: "left", session: MeetingSession }` | "The camera left meeting abc-defg-hij." |
| Was idle | false | `{ result: "was_idle" }` | "The camera was idle. Nothing to do." |
| Other meeting | true | `{ error: "not_in_that_meeting", current: MeetingSession }` | "The camera is not in meeting abc-defg-hij. It is in xyz-abcd-efg (started by ...). Nothing was changed." |
| Invalid `meeting` | true | `{ error: "invalid_meeting", message }` | Section 2.5. |

### 3.3 `status`

Title: "Show what the webcam is doing".
Annotations: `readOnlyHint: true`, `openWorldHint: false`.
Input: none.
Result: `isError: false`, `structuredContent: CameraStatus` (section 2.4).
Text: "The camera is idle." or "The camera is in meeting abc-defg-hij since <startedAt>, started by <startedBy or 'unknown'> (<source>). The camera cannot see if it was admitted or if the meeting already ended."

### 3.4 Other HTTP endpoints

| Method and path (BE) | Through nginx | Result |
|---|---|---|
| `POST /mcp` | `http://webcam.local/mcp` | MCP JSON-RPC |
| `GET /mcp`, `DELETE /mcp` | same | 405, JSON-RPC error `-32000` "Method not allowed." |
| `GET /mcp/guide` | `http://webcam.local/mcp/guide` | 200, `text/plain; charset=utf-8`, content of `docs/mcp-guide.md` |
| `GET /api/join/:meetingId` | unchanged | 200 `"Joining meeting..."`, 400 for invalid input, 500 for launch failure |
| `GET /api/end` | unchanged | 200 `"Shuting down meeting..."` |

## 4. Files and modules

| File | Change |
|---|---|
| `be/src/paths.ts` | New. `REPO_ROOT`, `GUIDE_PATH`, `EXTENSION_DIR`. |
| `be/src/chromectl/meeting-code.ts` | New. `parseMeeting`, `InvalidMeetingError`. Pure, no Nest. |
| `be/src/chromectl/chromium.launcher.ts` | New. `@Injectable() ChromiumLauncher` with `launch(url): Promise<ChildProcess>` and `stopAll(): Promise<void>`. Only file that touches processes. |
| `be/src/chromectl/chromectl.service.ts` | Rewrite. State, lock, `join`, `leave`, `status`, exit handling. Error classes `CameraBusyError`, `NotInThatMeetingError`, `LaunchError`. |
| `be/src/chromectl/chromectl.controller.ts` | Change. Delegate to the new service methods. Map `InvalidMeetingError` to `BadRequestException`. Keep paths and return strings. |
| `be/src/chromectl/chromectl.module.ts` | Change. Add `ChromiumLauncher` to providers. Keep the `ChromectlService` export. |
| `be/src/chromectl/launch.sh`, `end.sh` | Delete. |
| `be/src/mcp/mcp.tools.ts` | New. `buildMcpServer(service: ChromectlService): McpServer`. Registers the three tools and maps service results and errors to section 3. No state here. |
| `be/src/mcp/mcp.controller.ts` | New. `@Controller('mcp')`: `@Post()` handles MCP, `@Get()` and `@Delete()` return 405, `@Get('guide')` returns the guide. |
| `be/src/mcp/mcp.module.ts` | New. Imports `ChromectlModule`. |
| `be/src/app.module.ts` | Change. Import `McpModule`. |
| `be/package.json`, `be/package-lock.json` | Add `@modelcontextprotocol/sdk`, `zod`. Rename the package from `chartizard` to `headless-meet-be` (optional, cosmetic). |
| `be/test/app.e2e-spec.ts` | Delete. It tests a `GET /` that does not exist. |
| `be/test/mcp.e2e-spec.ts` | New. Section 7. |
| `be/src/**/*.spec.ts` | New unit tests. Section 7. |
| `docs/mcp-guide.md` | New. The guide. Section 8. |
| `nginx.conf` | Change. `default_server`, `location /mcp`. |
| `run.sh` | Rewrite. Section 2.9. |
| `headless-meet.service` | Rewrite as template. Section 2.9. |
| `install.sh` | Rewrite. Section 6. |
| `README.md` | Add a short "Use it from your AI assistant" section with the guide URL. Fix the clone URL and the install steps. |

### 4.1 `ChromiumLauncher` details

```ts
const CHROMIUM_BIN = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium-browser';
const CHROMIUM_PROCESS_NAME = 'chromium-browser';
```

`launch(url)`:

1. `spawn(CHROMIUM_BIN, [url, '--use-fake-ui-for-media-stream', `--load-extension=${EXTENSION_DIR}`], { shell: false, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0' } })`. The flags are the same as in `launch.sh` today. Do not add flags in this issue.
2. Resolve on the `spawn` event. Reject on the `error` event (for example `ENOENT`). The service turns the rejection into `LaunchError`.

`stopAll()`:

1. Run `execFile('killall', ['-q', '-w', '-s', 'TERM', CHROMIUM_PROCESS_NAME], { timeout: 10_000 })`.
2. If it times out, run `execFile('killall', ['-q', '-s', 'KILL', CHROMIUM_PROCESS_NAME])`.
3. Ignore exit code 1 (no process found). Log other errors and continue.

This is the same kill method as `end.sh` today (by exact process name), plus a wait. The wait is important: Chromium has a profile singleton lock. If the old instance is still alive, a new launch hands the URL to the old instance and exits at once. Today's `launch.sh` has this race.

Use `killall` by exact name, not `pkill -f` with a pattern.

### 4.2 `ChromectlService` sequence

`join({ meeting, force, startedBy, source })` inside the lock:

1. `parseMeeting(meeting)`. On error, throw `InvalidMeetingError`.
2. If the state is `in_meeting`:
   1. Same code and `force` is false: return `already_in_meeting`.
   2. Different code and `force` is false: throw `CameraBusyError(current)`.
   3. Otherwise keep `replaced = current`.
3. `await launcher.stopAll()`. Always do this, also when the state is `idle`. This removes a Chromium that someone started by hand on the Pi desktop.
4. Set the state to `idle` and clear the tracked process.
5. `child = await launcher.launch(meetingUrl)`. On error, log it and throw `LaunchError`. The state stays `idle`.
6. Store `child` and set the state to `in_meeting` with `startedAt = new Date().toISOString()`.
7. `child.once('exit', ...)`: if `child` is still the tracked process, set the state to `idle` and log the code and signal.
8. Log one line: action, code, `startedBy`, `source`, `replaced`.

`leave({ meeting })` inside the lock:

1. If `meeting` is present, parse it. If the state is `in_meeting` with another code, throw `NotInThatMeetingError(current)`.
2. If the state is `idle`: still call `stopAll()` (removes a hand-started Chromium, as `end.sh` does today) and return `was_idle`.
3. Otherwise call `stopAll()`, set the state to `idle`, and return `left` with the old session.

## 5. Data flow

```
Assistant (Claude Code, VS Code, mcp-remote for Claude Desktop)
  │ POST http://webcam.local/mcp  (JSON-RPC, Streamable HTTP)
  ▼
nginx :80 ── location /mcp ──► NestJS BE :3001 McpController
                                   │ buildMcpServer(service) per request
                                   ▼
Browser web UI ── /api/join, /api/end ──► ChromectlController
                                   │
                                   ▼
                         ChromectlService (state + lock, single source of truth)
                                   │
                                   ▼
                         ChromiumLauncher ── spawn / killall ──► Chromium on DISPLAY :0
                                                                   │ content script clicks "Ask to join"
                                                                   ▼
                                                              Google Meet (manual admission)
```

## 6. `install.sh` (target behaviour)

Run it from the cloned repo with `sudo ./install.sh`. It must be safe to run again.

1. `set -euo pipefail`.
2. `REPO_DIR` is the folder of the script. `RUN_USER` is `${SUDO_USER:-pi}`.
3. `apt-get install -y nginx nodejs npm chromium-browser`. (On Raspberry Pi OS 13 the package is `chromium`. Add a comment. Do not support both in this issue.)
4. As `RUN_USER`: `npm ci` and `npm run build` in `be/`, then in `fe/`.
5. Copy `nginx.conf` to `/etc/nginx/sites-available/headless-meet`. Link it in `sites-enabled`. Remove the `sites-enabled/default` link. Run `nginx -t`, then `systemctl reload nginx`.
6. Write the unit from the template to `/etc/systemd/system/headless-meet.service` with `sed`. On the Pi this file overrides `/lib/systemd/system/headless-meet.service`.
7. `systemctl daemon-reload`, `systemctl enable headless-meet`, `systemctl restart headless-meet`.
8. Print the URLs `http://webcam.local`, `http://webcam.local/mcp`, `http://webcam.local/mcp/guide`.

Do not clone and do not `rm -rf` anything in `install.sh`. The current script deletes `~/headless-meet`.

## 7. Tests

### 7.1 Without Chromium (CI and the developer laptop)

Unit tests with Jest (existing set-up, `testRegex: .*\.spec\.ts$`):

1. `meeting-code.spec.ts`, table test.
   - Accept: `abc-defg-hij`, `ABC-DEFG-HIJ`, `abcdefghij`, `meet.google.com/abc-defg-hij`, `https://meet.google.com/abc-defg-hij?authuser=0&hs=122`, `http://meet.google.com/abc-defg-hij#x`, input with spaces around it. All give `abc-defg-hij`.
   - Refuse: empty, 201 characters, `abc-defg-hij; reboot`, `$(reboot)`, `` `id` ``, `abc-defg-hij && rm -rf /`, `--headless`, `-abc-defg-hij`, `https://evil.com/abc-defg-hij`, `https://meet.google.com.evil.com/abc-defg-hij`, `https://evil.com/?u=meet.google.com/abc-defg-hij`, `https://meet.google.com/abc-defg-hij/extra`, `https://meet.google.com/lookup/abc`, `javascript:alert(1)`, `file:///etc/passwd`, `ftp://meet.google.com/abc-defg-hij`, `аbc-defg-hij` (Cyrillic а), `abc-defg-hi`, `abc_defg_hij`.
2. `chromectl.service.spec.ts` with a `FakeChromiumLauncher`. The fake returns an `EventEmitter` as the child and counts `stopAll` calls. Test:
   - join when idle gives `joined` and `status` shows the session.
   - join of another meeting without force throws `CameraBusyError` with the current session, and `stopAll` is not called.
   - join with force gives `joined` with `replaced`.
   - join of the same meeting without force gives `already_in_meeting` and does not launch.
   - join of the same meeting with force launches again.
   - leave when idle gives `was_idle`. leave when busy gives `left`.
   - leave with another meeting throws `NotInThatMeetingError` and does not stop Chromium.
   - child `exit` sets the state to `idle`.
   - `exit` of the old child after a force switch does not change the new session.
   - two parallel `join` calls for different meetings: one `joined`, one `CameraBusyError`, one launch.
   - launcher rejects: `LaunchError`, state `idle`.
3. `test/mcp.e2e-spec.ts`: start the Nest app with `overrideProvider(ChromiumLauncher).useValue(fake)` and `app.listen(0)`. Use the SDK `Client` with `StreamableHTTPClientTransport`:
   - `listTools` returns exactly `join`, `leave`, `status`.
   - The flows from `product.md` scenarios 3, 4 and 5, with `isError` and `structuredContent` checks.
   - `GET /api/join/abc-defg-hij` with supertest, then MCP `status` shows `source: "web"`.
   - `GET /api/join/x;reboot` returns 400.
   - `GET /mcp` returns 405. `GET /mcp/guide` returns 200 `text/plain` and contains `claude mcp add`.

Manual check on a laptop:

1. Make a fake browser script, for example `/tmp/fake-chromium` with `#!/bin/sh` and `exec sleep 3600`.
2. Start the BE: `CHROMIUM_BIN=/tmp/fake-chromium npm run start:dev` in `be/`.
3. Add the server: `claude mcp add --transport http webcam-dev http://localhost:3001/mcp`.
4. Or use `npx @modelcontextprotocol/inspector` with `http://localhost:3001/mcp`.

On macOS `killall` has no `-w`. `stopAll` logs the error and continues. This is acceptable for a dev run only.

### 7.2 On the Pi

The camera is used in live meetings. Every step that restarts the service or Chromium needs a time window agreed with Filip.

Deployment (first time, migration from the 2024 checkout):

1. Agree a time window with Filip. Check that no meeting runs: `pgrep -x chromium-browser` must print nothing.
2. Back up: `cp -a ~/Documents/headless-meet ~/Documents/headless-meet.bak-2024` and `sudo cp /etc/nginx/sites-enabled/default ~/nginx-default.bak`.
3. In `~/Documents/headless-meet`: `git fetch origin`, then `git checkout -B master origin/master` (after the merge of this branch). The local history is old and was force-pushed over. Do not use `git pull`.
4. Remove the old untracked `start.sh` only after the new unit runs.
5. Run `sudo ./install.sh`.

Rollback: restore the backup folder and `/etc/nginx/sites-enabled/default`, remove `/etc/systemd/system/headless-meet.service`, run `systemctl daemon-reload`, reload nginx, restart the service.

Checks:

1. `curl -s http://webcam.local/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` lists three tools.
2. On a second machine, follow `docs/mcp-guide.md` for Claude Code (acceptance criterion 7).
3. Join a test meeting by link. Admit "Meeting Room". Check video and audio. Call `status`.
4. From a second assistant, call `join` for a second test meeting. Check the refusal. Call it with `force=true`. Check the switch.
5. Call `leave` with the first meeting code. Check the refusal. Call `leave` with the right code.
6. Use the web UI join and End. Check `status` after each.
7. Run `sudo reboot`. After the boot check the web UI, `/mcp` and `/mcp/guide` (acceptance criterion 8).
8. Stop the BE process by PID (`kill <pid of node dist/main>`). Check that systemd restarts the whole service within about 10 s.

## 8. The guide `docs/mcp-guide.md` (content outline)

1. What the camera does, in three sentences. Admission is manual. The camera cannot see admission or the end of a meeting.
2. MCP URL `http://webcam.local/mcp`. Fallback: the IP address of the Pi.
3. Set-up for Claude Code, Claude Desktop (local bridge, with the reason), VS Code with Copilot, and a generic client. Use the commands from section 2.11. Each set-up ends with a check: "ask the assistant: what is the camera doing?".
4. Tool reference: `join`, `leave`, `status`, in short.
5. Automation prompt, ready to paste. It is written for a check that repeats every 5 minutes, so it works without memory between runs:
   - Read my calendar for now plus 10 minutes. Find events in the room "Man Cave" that have a Google Meet link.
   - If such an event starts within 2 minutes or runs now, call `status`. If the camera is idle, call `join` with the link and `requestedBy` set to my name. If the camera is in another meeting, do not use `force`. Tell me.
   - If such an event ended in the last 10 minutes and `status` shows its code, call `leave` with `meeting` set to that code.
6. How to run the automation. It must run on the user's computer in the office network. Options: Claude Code `/loop 5m <prompt>` in an open session, or a local `cron` or `launchd` job with `claude -p "<prompt>"` every 5 minutes during working hours. Cloud schedulers (claude.ai, Cowork, Claude Code cloud routines) cannot reach the camera.
7. Troubleshooting: `webcam.local` does not resolve, the tool list is empty, the camera is busy.

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Someone ends the meeting inside Meet | Chromium stays open on the "You left" page. `status` still shows `in_meeting` until `leave` or the next `join` with `force`. The automation prompt calls `leave` at the end. |
| Nobody admits the camera | `status` shows `in_meeting`. The tool text says that admission is not visible. |
| Chromium crashes | The `exit` event sets `idle`. The next `join` works without `force`. |
| Service restart or reboot | Chromium dies with the cgroup. The state starts as `idle`. This matches reality. |
| Chromium started by hand on the Pi desktop | The state is `idle`. The next `join` or `leave` stops it with `stopAll`. |
| Two assistants call `join` at the same moment | The lock runs them one after the other. The second gets `busy`. |
| Jana's `leave` after Petr's force switch | With `meeting` set, the call is refused. Without `meeting`, Petr's meeting ends (as `product.md` describes). |
| Automation calls `join` again for a running meeting | `already_in_meeting`, nothing happens. |
| `startedBy` contains text like "ignore previous instructions" | It is cut to 80 characters without line breaks and appears only as a data field. Other assistants read it. This is a small prompt-injection risk. Accepted. |
| Input is a Calendar link with query parameters | Accepted. The query is ignored. |
| Meet nickname or `lookup/` link | Refused with the standard message. |

## 10. Risks

1. **Deployment touches a live camera.** The service restart kills Chromium. Deploy only in an agreed window (section 7.2).
2. **Pi checkout is on a rewritten history.** `git pull` fails or merges old commits. Use `git checkout -B master origin/master` after a backup.
3. **Node 18 is end-of-life.** SDK v1 still supports it. SDK v2 does not. A Node upgrade is a separate issue.
4. **Chromium updates.** Chromium 137 and later block `--load-extension` in some builds. If `apt upgrade` installs such a version, the auto-click on "Ask to join" stops working. This is not new in this issue, but the MCP automation depends on it more. Consider `apt-mark hold chromium-browser` as a separate decision.
5. **No authentication.** Anyone in the LAN can start, switch and end meetings. A web page open in a LAN browser can already call `GET /api/join` today (cross-site GET). `POST /mcp` needs `Content-Type: application/json`, so a cross-site page needs a CORS preflight, which the BE does not answer. DNS rebinding can bypass this. Impact: the camera opens a Meet meeting as a guest and someone must admit it. Accepted under the `product.md` decision.
6. **Claude Desktop needs Node.js and `mcp-remote`** on the user's laptop. Custom connectors cannot reach a LAN server.
7. **The automation needs a local scheduler.** Cloud-run assistants cannot reach the camera. Users without a laptop in the office at meeting time cannot automate.
8. **`webcam.local` resolution** depends on mDNS on the client.
9. **`killall -w` can block up to 10 s** inside the lock. `join` and `leave` then answer in up to about 15 s. This is inside the default nginx and client timeouts.

## 11. What does not change

- `fe/` (all files).
- The Chrome extension (`be/src/chromectl/chrome-extension/*`) and the Chromium flags.
- The paths, methods and return strings of `/api/join/:meetingId` and `/api/end`.
- Ports: BE 3001, FE 3000, nginx 80.
- The unit name `headless-meet.service` and the service user `pi`.

## 12. Differences from `product.md` and open questions

Differences (proposals, not blockers):

1. `leave` gets an optional `meeting` argument (section 2.7). Plain `leave` works as specified.
2. Claude Desktop can use the camera only through the local bridge `mcp-remote`, not through "custom connectors" (section 2.11).
3. Scenario 2 (automation) works only with an assistant that runs on a computer in the office network. The guide says this (section 8, item 6).
4. "Who started it" comes only from the optional `requestedBy` argument. In stateless MCP the server does not see the client name in a tool call.

Open questions for Filip:

1. Language of the guide and of the tool messages. Proposal: English (public repo, MIT licence). Alternative: guide in Czech, tool messages in English.
2. Should the web UI "Join" keep switching the camera without a warning when an assistant started the meeting? Proposal: yes for this issue (`product.md` says "as before"). A warning in the web UI is a design change and out of scope.
3. Deployment window on the Pi, and who admits the camera in the two test meetings.
4. Does the Pi have a fixed IP address (DHCP reservation) that the guide can print as a fallback for `webcam.local`?

## 13. Plan for the developer

Each step ends with green tests. Commit after each step.

1. Add `@modelcontextprotocol/sdk@^1.32` and `zod@^3.25` to `be/`. Run `npm run build`. If types fail, bump `typescript` to `^5.5`.
2. Add `be/src/paths.ts`.
3. Write `meeting-code.ts` and `meeting-code.spec.ts` (section 7.1, item 1).
4. Write `chromium.launcher.ts` (section 4.1).
5. Rewrite `chromectl.service.ts` (sections 2.4, 2.6, 4.2). Write `chromectl.service.spec.ts` with the fake launcher.
6. Change `chromectl.controller.ts` and `chromectl.module.ts` (section 2.8). Delete `launch.sh` and `end.sh`.
7. Write `be/src/mcp/*` (sections 2.1, 3, 3.4). Import `McpModule` in `app.module.ts`.
8. Replace `test/app.e2e-spec.ts` with `test/mcp.e2e-spec.ts` (section 7.1, item 3). Run `npm test` and `npm run test:e2e`.
9. Run the manual laptop check with the fake browser and Claude Code (section 7.1).
10. Write `docs/mcp-guide.md` (section 8).
11. Change `nginx.conf`, rewrite `run.sh`, `headless-meet.service` and `install.sh` (sections 2.9, 6). Check them with `bash -n` and `shellcheck`.
12. Update `README.md`.
13. Open the pull request for issue #1. Do not deploy to the Pi without the agreed window (section 7.2).
