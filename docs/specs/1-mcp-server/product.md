# MCP server for the webcam (issue #1)

Agreed with Filip on 9. 11. 2026 (Google Chat).

## Goal

Anyone in the office can let their own AI assistant (Claude, GitHub Copilot or another MCP client) send the
webcam into their Google Meet meetings in the Man Cave room. The camera only executes commands. The automation
(reading the calendar, deciding when to join) runs on the user's side, in the user's assistant.

## Users and scenarios

1. Setup. Jana opens the guide on the camera (`http://webcam.local/...`, exact path set by the architect).
   She follows it and adds the camera MCP server to Claude Code. Claude lists the camera tools.
2. Automation. Jana gives her assistant the prompt from the guide. Before each of her meetings in Man Cave
   with a Meet link, her assistant calls `join` with the link. After the meeting it calls `leave`.
3. Manual use. Petr writes to Claude: "connect the camera to meet.google.com/abc-defg-hij". Claude calls `join`.
4. Busy camera. The camera is in Jana's meeting. Petr's assistant calls `join`. The camera refuses and says
   which meeting it is in and since when. Petr can force the switch on purpose.
5. Status. Anyone asks "what is the camera doing?". The assistant calls `status`.

## Decisions

- Access: anyone on the local network. No login, no accounts. The camera is not reachable from the internet.
- The camera has no calendar access and no Google credentials.
- Admission stays manual. The camera joins Meet as a guest and someone in the meeting admits it.
- Only Google Meet. Zoom and Teams are out of scope.
- The existing web UI (`http://webcam.local`) and the endpoints `/api/join/:meetingId`, `/api/end` keep working.

## Acceptance criteria

1. An MCP client on the local network connects to the camera MCP server over HTTP and lists the tools
   `join`, `leave`, `status`. Verified with Claude Code (`claude mcp add --transport http ...`).
2. `join` accepts a full Meet URL or a meeting code (`abc-defg-hij`). Any other input is refused with a clear
   message. No input can run a shell command or open a non-Meet URL on the camera.
3. After `join`, Chromium on the camera opens the meeting with the webcam and microphone allowed, as the web UI
   does today. `status` shows the meeting code and the join time.
4. `join` while the camera is in another meeting is refused with the current meeting and its start time.
   `join` with an explicit force flag leaves the current meeting and joins the new one.
5. `leave` closes the meeting. `leave` when the camera is idle succeeds and says the camera was idle.
6. `status` returns: idle or in a meeting, meeting code, start time, who started it if the client sent a name.
7. The guide is one Markdown file. The camera serves it on the local network and the repo contains it.
   It has setup steps for Claude Code, Claude Desktop, VS Code with GitHub Copilot, and a generic MCP client.
   It has a ready prompt for the automation: find my meetings in Man Cave with a Meet link, join at the start,
   leave at the end. Verified by following the guide with Claude Code on a second machine.
8. The MCP server runs on the Pi under the existing `headless-meet.service` and starts after a reboot.
   `install.sh` installs everything that is needed.
9. The web UI and `/api/join`, `/api/end` work as before.

## Out of scope

- Calendar reading on the camera, a schedule or a queue of meetings on the camera.
- Login, user accounts, internet access, an own Workspace account for the camera.
- Zoom, Teams, other meeting services.
- Changes to the web UI design.
