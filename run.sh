#!/bin/bash
# Starts the backend (port 3001) and the frontend (port 3000).
# When one of them exits, the script exits with code 1 and systemd restarts
# the whole service. The web UI never runs without the backend.
# This script does not build. Run install.sh to build.

set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

(cd "$REPO_DIR/be" && exec node dist/main) &
(cd "$REPO_DIR/fe" && exec npm run start) &

wait -n
echo "headless-meet: a process exited with code $?, stopping the service" >&2
exit 1
