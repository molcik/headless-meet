# Use the Man Cave webcam from your AI assistant

## 1. What the camera does

The webcam in the Man Cave room can join a Google Meet meeting on command. Your AI assistant (Claude,
GitHub Copilot or another MCP client) sends the command over the office network. The camera joins as the
guest "Meeting Room", and someone in the meeting must admit it.

The camera only executes commands. It has no calendar and no Google account. It cannot see if someone
admitted it, or if the meeting already ended inside Meet. Your assistant reads your calendar and decides
when to join and when to leave.

## 2. The address of the camera

| What | Address |
|---|---|
| MCP server | `http://webcam.local/mcp` |
| This guide | `http://webcam.local/mcp/guide` |
| Web UI | `http://webcam.local` |

If `webcam.local` does not resolve on your computer, use the IP address instead:
`http://192.168.1.181/mcp`. The camera is reachable only from the office network.

The server uses the Streamable HTTP transport. It needs no login, no API key and no session.

## 3. Set-up

Use one of the set-ups below. Each set-up ends with the same check: ask your assistant
"What is the camera doing?". The assistant calls the `status` tool and tells you "The camera is idle."
or the meeting the camera is in.

### 3.1 Claude Code

1. Run this command in a terminal:

   ```sh
   claude mcp add --transport http --scope user webcam http://webcam.local/mcp
   ```

2. Run `claude mcp list`. The line for `webcam` must end with `Connected`.
3. Start `claude` and ask: "What is the camera doing?".

To remove the server later, run `claude mcp remove --scope user webcam`.

### 3.2 Claude Desktop

Claude Desktop cannot use "Custom connectors" for the camera. Claude connects to custom connectors from
the Anthropic cloud, and the cloud cannot reach the office network. Use the local bridge `mcp-remote`
instead. It needs Node.js on your computer (`node --version` must work).

1. Open Claude Desktop, then Settings, then Developer, then "Edit Config".
2. Add the `webcam` entry to `claude_desktop_config.json`. Keep the other entries in the file.

   ```json
   {
     "mcpServers": {
       "webcam": {
         "command": "npx",
         "args": ["-y", "mcp-remote", "http://webcam.local/mcp", "--allow-http", "--transport", "http-only"]
       }
     }
   }
   ```

   `--allow-http` is necessary, because the camera uses HTTP and not HTTPS.
3. Quit Claude Desktop completely and start it again.
4. Ask: "What is the camera doing?".

### 3.3 VS Code with GitHub Copilot

1. Open the command palette and run "MCP: Add Server".
2. Select the type "HTTP".
3. Enter the URL `http://webcam.local/mcp` and the name `webcam`.
4. Open Copilot Chat in Agent mode and ask: "What is the camera doing?".

You can also write the configuration by hand. In `~/.copilot/mcp-config.json`:

```json
{ "mcpServers": { "webcam": { "type": "http", "url": "http://webcam.local/mcp" } } }
```

In VS Code, the workspace file `.vscode/mcp.json` uses the key `servers` instead of `mcpServers`.

### 3.4 Another MCP client

| Setting | Value |
|---|---|
| Transport | Streamable HTTP (not the old HTTP+SSE transport) |
| URL | `http://webcam.local/mcp` |
| Authentication | none |
| Session | none (stateless server) |

Check from a terminal:

```sh
curl -s http://webcam.local/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The answer lists the tools `join`, `leave` and `status`.

## 4. Tools

| Tool | Arguments | What it does |
|---|---|---|
| `join` | `meeting` (required): Meet link or code like `abc-defg-hij`. `force` (optional, default `false`). `requestedBy` (optional): your name. | Opens the meeting on the camera. If the camera is in another meeting, the call is refused and tells you which meeting and since when. With `force: true` the camera leaves that meeting and joins yours. Use `force` only on purpose. |
| `leave` | `meeting` (optional): Meet link or code. | Closes the meeting. With `meeting`, the camera leaves only if it is in that meeting. This protects the meetings of other people. Without arguments, the camera leaves whatever meeting it is in. If the camera is idle, the call succeeds and says so. |
| `status` | none | Tells you if the camera is idle or in a meeting: meeting code, start time and who started it. |

Notes:

1. The camera accepts only Google Meet. Links like `https://meet.google.com/abc-defg-hij?authuser=0` from
   Google Calendar are fine. Meet nicknames (`meet.google.com/my-room`) and `lookup/` links do not work,
   because the camera joins as a guest.
2. Times are in UTC (for example `2026-11-09T09:02:11.000Z`). Your assistant converts them for you.
3. `status` shows "in a meeting" from `join` until `leave`. It does not change if the meeting ends inside Meet.
4. The web UI (`http://webcam.local`) always switches the camera, without a warning.

## 5. Automation prompt

Paste the prompt below into your assistant. Replace `<your name>` with your name. The prompt is written
for a check that repeats every 5 minutes. It needs no memory between runs.

```text
You control the Man Cave room webcam with the MCP tools of the server "webcam".
Do this check now:

1. Read my calendar from 10 minutes ago until 10 minutes from now. Find my events in the room "Man Cave"
   that have a Google Meet link.
2. If such an event starts in the next 2 minutes or runs now:
   - Call the webcam tool status.
   - If the camera is idle, call join with the Meet link of the event and requestedBy set to "<your name>".
   - If the camera is already in this meeting, do nothing.
   - If the camera is in another meeting, do not use force. Tell me which meeting it is in and who started it.
3. If such an event ended in the last 10 minutes and status shows its meeting code, call leave with
   meeting set to that code.
4. If nothing applies, do nothing and answer only "No camera action".
```

## 6. How to run the automation

The automation must run on a computer in the office network, because only that network can reach the
camera. Cloud schedulers (claude.ai, Cowork, Claude Code cloud routines) cannot reach the camera.

Options:

1. Claude Code, in a session that stays open: `/loop 5m <the prompt from section 5>`.
2. A local `cron` or `launchd` job that runs `claude -p "<the prompt from section 5>"` every 5 minutes
   during working hours. Your assistant needs access to your calendar in that set-up (for example an MCP
   server or connector for Google Calendar).

Example `crontab` line (Monday to Friday, 8:00 to 18:55). Save the prompt in `~/webcam-prompt.txt` first.
`claude -p` cannot ask you for permission, so `--allowedTools` must allow the camera tools (`mcp__webcam`)
and the tools of your calendar server (replace `mcp__<calendar>` with its name from `claude mcp list`):

```text
*/5 8-18 * * 1-5 cd ~ && claude -p "$(cat ~/webcam-prompt.txt)" --allowedTools "mcp__webcam mcp__<calendar>" >> ~/webcam-automation.log 2>&1
```

In cron, `claude` may not be on the `PATH`. Use the full path from `which claude`.

If your computer sleeps or leaves the office, the automation stops. Somebody must then use the web UI or
ask an assistant by hand.

## 7. Troubleshooting

| Problem | What to do |
|---|---|
| `webcam.local` does not resolve | Use `http://192.168.1.181/mcp`. Some Windows set-ups and VPN clients do not resolve `.local` names. |
| The tool list is empty or the server shows "Failed to connect" | Check that you are in the office network. Open `http://webcam.local/mcp/guide` in a browser. If the guide does not open, the camera is off or not reachable. |
| Claude Desktop shows no tools | Check that `node --version` works. Check that the config has `--allow-http`. Restart Claude Desktop completely. |
| `join` says the camera is busy | Somebody else uses the camera. Ask them, or call `join` with `force: true` if you are sure. |
| `join` says the camera could not start Chromium | Chromium on the camera ended at once, for example right after a reboot. Wait a minute and call `join` again. |
| `join` or `leave` says the camera is busy with other requests | Several assistants called the camera at the same time. Nothing was changed. Call again in a minute. |
| The camera joined but nobody sees it | Somebody in the meeting must admit "Meeting Room". The camera cannot see this. |
| The meeting ended but `status` still shows it | Call `leave` with the meeting code. |
