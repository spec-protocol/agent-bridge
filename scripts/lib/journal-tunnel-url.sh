# shellcheck shell=bash
# Shared functions (sourced from scripts/*.sh).

tunnel_base_from_journal() {
  local unit="${1:-cloudflared-bridge}"
  if [[ "$(uname -s)" == Darwin ]]; then
    local logdir="${HOME}/Library/Logs/agent-bridge"
    { cat "$logdir/cloudflared.log" "$logdir/cloudflared.err.log" 2>/dev/null || true; } \
      | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true
    return 0
  fi
  journalctl --user -u "$unit" --no-pager 2>/dev/null \
    | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1
}

# Linhas pgrep de cloudflared quick tunnel para 127.0.0.1:8787 (exceto vazias).
manual_quick_tunnel_processes() {
  pgrep -af cloudflared 2>/dev/null | grep -F -- '--url http://127.0.0.1:8787' || true
}

count_manual_quick_tunnels() {
  local lines
  lines="$(manual_quick_tunnel_processes)"
  if [[ -z "$lines" ]]; then
    echo 0
    return
  fi
  echo "$lines" | wc -l
}
