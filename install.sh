#!/bin/bash
# Installs headless-meet from this cloned repo. Safe to run again.
# Usage: sudo ./install.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="${SUDO_USER:-pi}"

if [[ $EUID -ne 0 ]]; then
  echo "Run this script as root: sudo ./install.sh" >&2
  exit 1
fi

echo "==> Installing system packages"
# --no-upgrade: never upgrade a Chromium that is already installed. Chromium 137
# and later can block --load-extension, and the extension clicks "Ask to join".
# Raspberry Pi OS 12 (bookworm) package name. On Raspberry Pi OS 13 it is "chromium".
apt-get update
apt-get install -y --no-upgrade nginx nodejs npm chromium-browser

for part in be fe; do
  echo "==> Building $part as $RUN_USER"
  (cd "$REPO_DIR/$part" && sudo -u "$RUN_USER" -H npm ci && sudo -u "$RUN_USER" -H npm run build)
done

echo "==> Configuring nginx"
install -m 644 "$REPO_DIR/nginx.conf" /etc/nginx/sites-available/headless-meet
ln -sfn /etc/nginx/sites-available/headless-meet /etc/nginx/sites-enabled/headless-meet
# The new site is the default_server. The file in sites-available stays as it is.
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  rm /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl reload-or-restart nginx

echo "==> Installing headless-meet.service"
sed -e "s|@REPO_DIR@|$REPO_DIR|g" -e "s|@RUN_USER@|$RUN_USER|g" \
  "$REPO_DIR/headless-meet.service" > /etc/systemd/system/headless-meet.service
systemctl daemon-reload
systemctl reenable headless-meet
systemctl restart headless-meet

echo
echo "Done."
echo "  Web UI:     http://webcam.local"
echo "  MCP server: http://webcam.local/mcp"
echo "  Guide:      http://webcam.local/mcp/guide"
