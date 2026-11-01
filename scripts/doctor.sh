#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/journal-tunnel-url.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/persistence.sh"
cd "$INSTALL_DIR"

FAIL=0
ok() { echo "OK  $*"; }
bad() { echo "FAIL $*"; FAIL=1; }
OS="$(uname -s)"

echo "=== agent-bridge doctor ==="
echo "INSTALL_DIR=$INSTALL_DIR"
echo "OS=$OS"
if [[ "$OS" == Darwin ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lib/darwin-arch.sh"
  ok "arquitetura $(uname -m), Homebrew $(darwin_brew_prefix)"
fi
echo ""

for bin in node npm git; do
  if command -v "$bin" >/dev/null 2>&1; then ok "$bin $(command -v "$bin")"; else bad "$bin ausente"; fi
done

if command -v agent >/dev/null 2>&1; then
  ok "agent $(command -v agent) — $(agent --version 2>/dev/null | head -1 || true)"
else
  bad "agent ausente (Cursor CLI)"
fi

if [[ -f dist/index.js ]]; then ok "dist/index.js"; else bad "dist/index.js — rode ./scripts/install.sh"; fi

if [[ -f .env ]]; then
  if [[ "$OS" == Darwin ]]; then
    perm="$(stat -f '%Lp' .env 2>/dev/null || echo '?')"
  else
    perm="$(stat -c '%a' .env 2>/dev/null || echo '?')"
  fi
  ok ".env presente (chmod ${perm})"
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  if [[ -z "${BRIDGE_TOKEN:-}" || ${#BRIDGE_TOKEN} -lt 32 ]]; then
    bad "BRIDGE_TOKEN curto ou ausente"
  else
    ok "BRIDGE_TOKEN definido"
  fi
  if [[ -z "${REPOS:-}" ]]; then bad "REPOS ausente no .env"; else ok "REPOS definido"; fi
else
  bad ".env ausente"
fi

PORT="${PORT:-8787}"
HEALTH="$(curl -sf "http://127.0.0.1:${PORT}/healthz" 2>/dev/null || true)"
if [[ "$HEALTH" == *'"ok":true'* ]]; then
  ok "healthz http://127.0.0.1:${PORT}/healthz"
else
  if [[ "$OS" == Darwin ]]; then
    bad "healthz — bridge is not responding (./scripts/install.sh --launchd or npm start)"
  else
    bad "healthz — bridge is not responding (systemctl --user start agent-bridge?)"
  fi
fi

if [[ -n "${BRIDGE_TOKEN:-}" && "$HEALTH" == *ok* ]]; then
  RESP="$(curl -sf "http://127.0.0.1:${PORT}/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $BRIDGE_TOKEN" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null || true)"
  for tool in list_repos ask_cursor git_readonly read_file list_files start_ask_cursor get_job cancel_job list_bridge_audit; do
    if [[ "$RESP" == *"\"name\":\"$tool\""* ]]; then
      ok "tool $tool"
    else
      bad "tool $tool ausente na resposta MCP"
    fi
  done
  for tool in list_opencode_sessions start_ask_opencode; do
    if [[ "$RESP" == *"\"name\":\"$tool\""* ]]; then
      ok "tool $tool"
    else
      bad "tool $tool ausente na resposta MCP"
    fi
  done
  if [[ "$RESP" == *"\"name\":\"ask_opencode\""* ]]; then
    ok "tool ask_opencode (listada)"
  else
    bad "tool ask_opencode ausente na resposta MCP"
  fi

  LR="$(curl -sf "http://127.0.0.1:${PORT}/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $BRIDGE_TOKEN" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_repos","arguments":{}}}' 2>/dev/null || true)"
  if [[ -n "$LR" ]]; then
    if [[ "$LR" == *'"available": true'* || "$LR" == *'"available":true'* || "$LR" == *'\"available\": true'* || "$LR" == *'\"available\":true'* ]]; then
      ok "bridge reports OpenCode available (list_repos)"
    elif [[ "$LR" == *'"available": false'* || "$LR" == *'"available":false'* || "$LR" == *'\"available\": false'* || "$LR" == *'\"available\":false'* ]]; then
      OC_REASON="$(printf '%s' "$LR" | sed -n 's/.*"reason"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
      echo "INFO bridge reports OpenCode unavailable${OC_REASON:+: $OC_REASON}"
    else
      echo "INFO could not read opencode.available from list_repos"
    fi
  fi
fi

if [[ "${OPENCODE_DISABLE:-}" == "1" ]]; then
  echo "INFO OpenCode desabilitado no .env (OPENCODE_DISABLE=1)"
elif command -v opencode >/dev/null 2>&1 || [[ -n "${OPENCODE_BIN:-}" && -x "${OPENCODE_BIN}" ]] || [[ -x "$HOME/.opencode/bin/opencode" ]]; then
  echo "INFO OpenCode binary found locally (effective state: list_repos above, or restart the bridge)"
  OC_BIN="${OPENCODE_BIN:-}"
  if [[ -z "$OC_BIN" ]]; then
    OC_BIN="$(command -v opencode 2>/dev/null || true)"
  fi
  if [[ -z "$OC_BIN" && -x "$HOME/.opencode/bin/opencode" ]]; then
    OC_BIN="$HOME/.opencode/bin/opencode"
  fi
  if [[ -n "$OC_BIN" ]] && "$OC_BIN" agent list 2>/dev/null | grep -qE '^plan[[:space:]]'; then
    ok "OpenCode agente plan listado (ask_opencode usa --agent plan)"
  elif [[ -n "$OC_BIN" ]]; then
    echo "INFO plan agent missing from opencode agent list — ask_opencode stays unavailable until that is fixed"
  fi
  echo "INFO OPENCODE_AGENT must be plan (the only value the bridge allows)"
else
  echo "INFO opencode is not on PATH — ask_opencode returns unavailable (ok; the bridge uses Cursor)"
fi

report_tunnel_url() {
  local where="$1"
  n_dup="$(count_manual_quick_tunnels)"
  if [[ "$n_dup" -gt 1 ]]; then
    echo "INFO possible duplicate cloudflared ($n_dup processes with --url http://127.0.0.1:8787) — stop the manual tunnel"
  fi
  PUBLIC_URL="$(tunnel_base_from_journal cloudflared-bridge || true)"
  if [[ -n "$PUBLIC_URL" ]]; then
    echo "INFO URL MCP: ${PUBLIC_URL}/mcp  (ou: ./scripts/mcp-public-url.sh)"
    PHEALTH="$(curl -sf "${PUBLIC_URL}/healthz" 2>/dev/null || true)"
    if [[ "$PHEALTH" == *'"ok":true'* ]]; then ok "public healthz through the tunnel"; else bad "public healthz failed"; fi
  else
    echo "INFO trycloudflare URL not found ${where} — run ./scripts/mcp-public-url.sh after the service is up"
  fi
}

if [[ "$OS" == Darwin ]]; then
  DOMAIN="gui/$(id -u)"
  if launchctl print "${DOMAIN}/com.agent-bridge" >/dev/null 2>&1; then
    ok "launchd com.agent-bridge loaded"
  else
    echo "INFO launchd com.agent-bridge is not loaded (ok if you run it by hand)"
  fi
  if launchctl print "${DOMAIN}/com.agent-bridge.cloudflared" >/dev/null 2>&1; then
    ok "launchd com.agent-bridge.cloudflared loaded"
    report_tunnel_url "nos logs ~/Library/Logs/agent-bridge/"
  else
    echo "INFO cloudflared LaunchAgent is not loaded — see docs/public/README.md"
  fi
  echo "INFO on macOS the LaunchAgent starts at login and stops at logout"
else
  if systemctl --user is-active agent-bridge.service >/dev/null 2>&1; then
    ok "systemd agent-bridge active"
  else
    echo "INFO systemd agent-bridge is not active (ok if you run it by hand)"
  fi

  if systemctl --user is-active cloudflared-bridge.service >/dev/null 2>&1; then
    ok "systemd cloudflared-bridge active"
    report_tunnel_url "no journal"
  else
    echo "INFO cloudflared-bridge is not active — see docs/public/README.md"
  fi

  if systemctl --user is-enabled cloudflared-bridge.service >/dev/null 2>&1; then
    if user_linger_enabled; then
      ok "linger Linger=yes (logout/reboot)"
    else
      bad "Linger=no — rode ./scripts/enable-persistence.sh"
    fi
    if systemctl --user is-enabled agent-bridge.service >/dev/null 2>&1; then
      ok "agent-bridge enabled no boot"
    else
      bad "agent-bridge is not enabled — ./scripts/enable-persistence.sh"
    fi
    ok "cloudflared-bridge enabled no boot"
  fi
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "Result: all OK"
  exit 0
else
  echo "Result: there are failures — see docs/public/README.md"
  exit 1
fi
