#!/usr/bin/env bash
# Prints the public MCP URL (quick tunnel via cloudflared-bridge).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/journal-tunnel-url.sh"

UNIT="${CLOUDFLARED_UNIT:-cloudflared-bridge}"

tunnel_active() {
  if [[ "$(uname -s)" == Darwin ]]; then
    if launchctl print "gui/$(id -u)/com.agent-bridge.cloudflared" >/dev/null 2>&1; then
      return 0
    fi
    if [[ -n "$(manual_quick_tunnel_processes)" ]]; then
      return 0
    fi
    return 1
  fi
  if systemctl --user is-active "${UNIT}.service" >/dev/null 2>&1; then
    return 0
  fi
  # Fallback: a sandbox or IDE without a D-Bus user session can still see the process or the journal.
  if [[ -n "$(manual_quick_tunnel_processes)" ]]; then
    return 0
  fi
  return 1
}

if ! tunnel_active; then
  echo "Error: cloudflared tunnel is not active for 127.0.0.1:8787" >&2
  echo "Veja docs/public/README.md" >&2
  exit 1
fi

BASE="$(tunnel_base_from_journal "$UNIT" || true)"
if [[ -z "$BASE" ]]; then
  if [[ "$(uname -s)" == Darwin ]]; then
    echo "Error: trycloudflare URL not found in ~/Library/Logs/agent-bridge/." >&2
  else
    echo "Error: trycloudflare URL not found in the ${UNIT} journal." >&2
    echo "Aguarde alguns segundos ou: journalctl --user -u ${UNIT} --no-pager | tail -20" >&2
  fi
  exit 1
fi

echo "${BASE}/mcp"
