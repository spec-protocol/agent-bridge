#!/usr/bin/env bash
# Starts services, gets the MCP URL, and prints the prompt to paste into Grok Bot.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$INSTALL_DIR"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/journal-tunnel-url.sh"

PROMPT_ONLY=0
URL_OVERRIDE=""
MAX_WAIT="${GROK_RECONNECT_WAIT_SEC:-60}"
INTERVAL=2
OS="$(uname -s)"

usage() {
  echo "Usage: $0 [--prompt-only] [--url https://host/mcp]" >&2
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-only) PROMPT_ONLY=1; shift ;;
    --url)
      URL_OVERRIDE="${2:-}"
      [[ -n "$URL_OVERRIDE" ]] || { echo "Error: --url requires a value" >&2; exit 1; }
      shift 2
      ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
done

# BRIDGE_MCP_URL in the local .env (not versioned) — public URL only, never the token
if [[ -z "$URL_OVERRIDE" && -f .env ]]; then
  line="$(grep -E '^BRIDGE_MCP_URL=' .env 2>/dev/null | tail -1 || true)"
  if [[ -n "$line" ]]; then
    URL_OVERRIDE="${line#BRIDGE_MCP_URL=}"
    URL_OVERRIDE="${URL_OVERRIDE#\"}"
    URL_OVERRIDE="${URL_OVERRIDE%\"}"
  fi
fi

print_grok_block() {
  local mcp_url="$1"
  local version guide
  version="$(INSTALL_DIR="$INSTALL_DIR" node -e 'const fs=require("fs"); const p=process.env.INSTALL_DIR; const j=JSON.parse(fs.readFileSync(p+"/package.json","utf8")); process.stdout.write(String(j.version));')"
  guide="https://unpkg.com/@spec-protocol/agent-bridge@${version}/docs/public/grok.md"
  echo "--- PASTE INTO GROK ---"
  echo "Connect the Streamable HTTP MCP at this URL: ${mcp_url}"
  echo "Follow this guide and finish the connection: ${guide}"
  echo "The BRIDGE_TOKEN did not change. Paste it only in the protected field."
  echo "--- END ---"
}

normalize_mcp_url() {
  local u="$1"
  u="${u%/}"
  if [[ "$u" != */mcp ]]; then
    u="${u}/mcp"
  fi
  echo "$u"
}

start_darwin() {
  local domain="gui/$(id -u)"
  local agents="${HOME}/Library/LaunchAgents"
  if [[ ! -f "${agents}/com.agent-bridge.plist" ]]; then
    echo "Error: launchd is not configured — run ./scripts/darwin/setup-launchd.sh or ./scripts/install.sh --launchd" >&2
    exit 1
  fi
  if ! launchctl print "${domain}/com.agent-bridge" >/dev/null 2>&1; then
    launchctl bootstrap "$domain" "${agents}/com.agent-bridge.plist"
  fi
  launchctl kickstart "${domain}/com.agent-bridge" >/dev/null 2>&1 || true
  if [[ -f "${agents}/com.agent-bridge.cloudflared.plist" ]]; then
    if ! launchctl print "${domain}/com.agent-bridge.cloudflared" >/dev/null 2>&1; then
      launchctl bootstrap "$domain" "${agents}/com.agent-bridge.cloudflared.plist"
    fi
    launchctl kickstart "${domain}/com.agent-bridge.cloudflared" >/dev/null 2>&1 || true
  else
    echo "WARNING cloudflared LaunchAgent is missing — see docs/public/README.md" >&2
  fi
  echo "WARNING on macOS the LaunchAgent stops at logout. This version has no linger equivalent." >&2
}

start_linux() {
  local bridge_unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/agent-bridge.service"
  local cf_unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/cloudflared-bridge.service"

  if [[ ! -f "$bridge_unit" ]]; then
    echo "Error: systemd is not configured — run ./scripts/setup-systemd.sh or ./scripts/install.sh --systemd" >&2
    exit 1
  fi

  systemctl --user start agent-bridge.service 2>/dev/null || true
  if [[ -f "$cf_unit" ]]; then
    systemctl --user start cloudflared-bridge.service 2>/dev/null || true
  else
    echo "WARNING cloudflared-bridge.service is missing — see docs/public/README.md" >&2
  fi

  if [[ -x "$SCRIPT_DIR/enable-persistence.sh" ]]; then
    "$SCRIPT_DIR/enable-persistence.sh" --check-only >/dev/null 2>&1 || {
      echo "WARNING linger is off — services may stop after logout or reboot. Run: ./scripts/enable-persistence.sh" >&2
    }
  fi
}

MCP_URL=""
if [[ -n "$URL_OVERRIDE" ]]; then
  MCP_URL="$(normalize_mcp_url "$URL_OVERRIDE")"
else
  if [[ "$PROMPT_ONLY" -eq 1 ]]; then
    echo "Error: --prompt-only requires --url or BRIDGE_MCP_URL= in .env" >&2
    exit 1
  fi

  if [[ "$OS" == Darwin ]]; then
    start_darwin
  else
    start_linux
  fi

  elapsed=0
  while [[ "$elapsed" -lt "$MAX_WAIT" ]]; do
    base="$(tunnel_base_from_journal cloudflared-bridge 2>/dev/null || true)"
    if [[ -n "$base" ]]; then
      MCP_URL="${base}/mcp"
      break
    fi
    sleep "$INTERVAL"
    elapsed=$((elapsed + INTERVAL))
  done

  if [[ -z "$MCP_URL" ]]; then
    if [[ "$OS" == Darwin ]]; then
      echo "Error: trycloudflare URL not found within ${MAX_WAIT}s. See ~/Library/Logs/agent-bridge/cloudflared.err.log" >&2
    else
      echo "Error: trycloudflare URL not found within ${MAX_WAIT}s. Check: systemctl --user status cloudflared-bridge" >&2
    fi
    exit 1
  fi
fi

base_health="${MCP_URL%/mcp}"
if ! curl -sf "${base_health}/healthz" >/dev/null 2>&1; then
  echo "WARNING public healthz failed at ${base_health}/healthz (tunnel still starting?)" >&2
fi

print_grok_block "$MCP_URL"
