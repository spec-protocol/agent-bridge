#!/usr/bin/env bash
# macOS has no linger. Confirms the user LaunchAgents are loaded.
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo "Error: this script is macOS only." >&2
  exit 1
fi

CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    -h|--help)
      echo "Usage: $0 [--check-only]"
      echo "  Confirma os LaunchAgents. No macOS eles param no logout."
      echo "  --check-only  diagnose only (exit 1 if the bridge is not loaded)"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

DOMAIN="gui/$(id -u)"
AGENTS="${HOME}/Library/LaunchAgents"
FAIL=0

loaded() {
  launchctl print "${DOMAIN}/$1" >/dev/null 2>&1
}

if [[ ! -f "${AGENTS}/com.agent-bridge.plist" ]]; then
  echo "FAIL plist ausente. Rode ./scripts/install.sh --launchd"
  exit 1
fi

if [[ "$CHECK_ONLY" -eq 0 ]]; then
  if ! loaded "com.agent-bridge"; then
    launchctl bootstrap "$DOMAIN" "${AGENTS}/com.agent-bridge.plist"
  fi
  launchctl enable "${DOMAIN}/com.agent-bridge" >/dev/null 2>&1 || true
  if [[ -f "${AGENTS}/com.agent-bridge.cloudflared.plist" ]] && ! loaded "com.agent-bridge.cloudflared"; then
    launchctl bootstrap "$DOMAIN" "${AGENTS}/com.agent-bridge.cloudflared.plist"
    launchctl enable "${DOMAIN}/com.agent-bridge.cloudflared" >/dev/null 2>&1 || true
  fi
fi

if loaded "com.agent-bridge"; then
  echo "OK  com.agent-bridge loaded"
else
  echo "FAIL com.agent-bridge is not loaded"
  FAIL=1
fi

if [[ -f "${AGENTS}/com.agent-bridge.cloudflared.plist" ]]; then
  if loaded "com.agent-bridge.cloudflared"; then
    echo "OK  com.agent-bridge.cloudflared loaded"
  else
    echo "FAIL com.agent-bridge.cloudflared is not loaded"
    FAIL=1
  fi
fi

echo "INFO on macOS the LaunchAgent starts at login and stops at logout. There is no linger."
exit "$FAIL"
