#!/usr/bin/env bash
# Writes systemd --user unit files with absolute paths from this install.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
USER_SYSTEMD="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
STOP_MANUAL=0
for arg in "$@"; do
  case "$arg" in
    --stop-manual-tunnel) STOP_MANUAL=1 ;;
    -h|--help)
      echo "Usage: $0 [--stop-manual-tunnel]"
      echo "  --stop-manual-tunnel  stops a manual cloudflared (--url http://127.0.0.1:8787) before starting the unit"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/journal-tunnel-url.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/cloudflared-warn.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/sed-inplace.sh"

if [[ "$(uname -s)" == Darwin ]]; then
  echo "Error: setup-systemd.sh is Linux only. On macOS use ./scripts/install.sh --launchd" >&2
  exit 1
fi

NODE="$(command -v node)"
CLOUDFLARED=""
for c in "$HOME/.local/bin/cloudflared" /usr/local/bin/cloudflared /usr/bin/cloudflared; do
  if [[ -x "$c" ]]; then CLOUDFLARED="$c"; break; fi
done

if [[ -z "$NODE" ]]; then
  echo "Error: node not found on PATH." >&2
  exit 1
fi
if [[ ! -f "$INSTALL_DIR/dist/index.js" ]]; then
  echo "Error: $INSTALL_DIR/dist/index.js does not exist. Run ./scripts/install.sh first." >&2
  exit 1
fi
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  echo "Error: $INSTALL_DIR/.env does not exist." >&2
  exit 1
fi
if [[ -z "$CLOUDFLARED" ]]; then
  echo "Warning: cloudflared not found. Install it or download it to ~/.local/bin (see docs/public/README.md)." >&2
  echo "Continuing with agent-bridge.service only..." >&2
fi

mkdir -p "$USER_SYSTEMD"

# Paths with spaces need quotes in systemd unit files.
cat > "$USER_SYSTEMD/agent-bridge.service" <<UNIT
[Unit]
Description=agent-bridge (MCP -> Cursor CLI)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStartPre=$INSTALL_DIR/scripts/lib/env-backup.sh
EnvironmentFile=$INSTALL_DIR/.env
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE $INSTALL_DIR/dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
UNIT

# Paths with spaces: backslash-escape (quoted WorkingDirectory breaks on some systemd)
if [[ "$INSTALL_DIR" == *" "* ]]; then
  ESC_DIR="$(printf '%s' "$INSTALL_DIR" | sed 's/ /\\ /g')"
  sed_inplace \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$ESC_DIR|" \
    -e "s|^ExecStartPre=.*|ExecStartPre=$ESC_DIR/scripts/lib/env-backup.sh|" \
    -e "s|^EnvironmentFile=.*|EnvironmentFile=$ESC_DIR/.env|" \
    -e "s|^ExecStart=.*|ExecStart=$NODE \"$INSTALL_DIR/dist/index.js\"|" \
    "$USER_SYSTEMD/agent-bridge.service"
fi

echo "Wrote: $USER_SYSTEMD/agent-bridge.service"

if [[ -n "$CLOUDFLARED" ]]; then
  cat > "$USER_SYSTEMD/cloudflared-bridge.service" <<UNIT
[Unit]
Description=Cloudflare Tunnel for agent-bridge
After=agent-bridge.service network-online.target
Wants=agent-bridge.service

[Service]
Type=simple
ExecStart=$CLOUDFLARED tunnel --no-autoupdate --url http://127.0.0.1:8787
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
  echo "Wrote: $USER_SYSTEMD/cloudflared-bridge.service"
fi

systemctl --user daemon-reload
systemctl --user enable --now agent-bridge.service
if [[ -n "$CLOUDFLARED" ]]; then
  if [[ "$STOP_MANUAL" -eq 1 ]]; then
    stop_manual_quick_tunnels
  else
    warn_if_manual_quick_tunnel
  fi
  systemctl --user enable --now cloudflared-bridge.service
fi

echo ""
echo "Services are active. Logs:"
echo "  journalctl --user -u agent-bridge -f"
if [[ -n "$CLOUDFLARED" ]]; then
  echo "  journalctl --user -u cloudflared-bridge -f"
  echo "URL MCP (quick tunnel):"
  echo "  ./scripts/mcp-public-url.sh"
fi
echo ""
echo "Persistence (logout and reboot):"
echo "  ./scripts/enable-persistence.sh"
"$SCRIPT_DIR/enable-persistence.sh" 2>/dev/null || true
