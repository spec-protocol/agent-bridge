#!/usr/bin/env bash
# Writes the user LaunchAgents. They start at login and stop at logout.
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo "Error: setup-launchd.sh is macOS only. On Linux use ./scripts/setup-systemd.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib/darwin-arch.sh"
AGENTS="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/agent-bridge"
DOMAIN="gui/$(id -u)"
NODE="$(darwin_native_node)" || exit 1

xml_escape() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  printf '%s' "$s"
}

boot_plist() {
  local label="$1"
  local plist="$2"
  if launchctl print "${DOMAIN}/${label}" >/dev/null 2>&1; then
    launchctl bootout "${DOMAIN}/${label}" >/dev/null 2>&1 || true
  fi
  launchctl bootstrap "$DOMAIN" "$plist"
  launchctl enable "${DOMAIN}/${label}" >/dev/null 2>&1 || true
}

if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  echo "Error: native node not found." >&2
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
if [[ ! -x "$SCRIPT_DIR/run-bridge.sh" ]]; then
  chmod +x "$SCRIPT_DIR/run-bridge.sh"
fi

mkdir -p "$AGENTS" "$LOG_DIR"

RUNNER="$(xml_escape "$SCRIPT_DIR/run-bridge.sh")"
NODE_XML="$(xml_escape "$NODE")"
INSTALL_XML="$(xml_escape "$INSTALL_DIR")"
LOG_XML="$(xml_escape "$LOG_DIR")"
PATH_VALUE="$(xml_escape "$(darwin_service_path)")"

cat > "${AGENTS}/com.agent-bridge.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agent-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNNER}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${INSTALL_XML}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${PATH_VALUE}</string>
    <key>AGENT_BRIDGE_NODE</key>
    <string>${NODE_XML}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_XML}/bridge.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_XML}/bridge.err.log</string>
</dict>
</plist>
EOF
echo "Wrote: ${AGENTS}/com.agent-bridge.plist"
boot_plist "com.agent-bridge" "${AGENTS}/com.agent-bridge.plist"

CLOUDFLARED="$(ensure_cloudflared || true)"
if [[ -z "$CLOUDFLARED" ]]; then
  echo "Warning: a native cloudflared did not become available. Continuing with com.agent-bridge only." >&2
else
  CF_XML="$(xml_escape "$CLOUDFLARED")"
  cat > "${AGENTS}/com.agent-bridge.cloudflared.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agent-bridge.cloudflared</string>
  <key>ProgramArguments</key>
  <array>
    <string>${CF_XML}</string>
    <string>tunnel</string>
    <string>--no-autoupdate</string>
    <string>--url</string>
    <string>http://127.0.0.1:8787</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_XML}/cloudflared.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_XML}/cloudflared.err.log</string>
</dict>
</plist>
EOF
  echo "Wrote: ${AGENTS}/com.agent-bridge.cloudflared.plist"
  boot_plist "com.agent-bridge.cloudflared" "${AGENTS}/com.agent-bridge.cloudflared.plist"
fi

echo ""
echo "LaunchAgents loaded. They start at login and stop at logout."
echo "Logs: ${LOG_DIR}/"
echo "URL MCP (quick tunnel): ./scripts/mcp-public-url.sh"
