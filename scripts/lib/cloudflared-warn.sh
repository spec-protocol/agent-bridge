# shellcheck shell=bash
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/journal-tunnel-url.sh"

warn_if_manual_quick_tunnel() {
  local n
  n="$(count_manual_quick_tunnels)"
  if [[ "$n" -eq 0 ]]; then
    return 0
  fi
  echo "WARNING: $n manual cloudflared process(es) point at http://127.0.0.1:8787." >&2
  manual_quick_tunnel_processes >&2
  echo "Stop the manual tunnel before starting cloudflared-bridge (avoids a duplicate or confusing URL)." >&2
  echo "Opcional: ./scripts/setup-systemd.sh --stop-manual-tunnel" >&2
}

stop_manual_quick_tunnels() {
  local pids
  pids="$(pgrep -f 'cloudflared tunnel.*--url http://127.0.0.1:8787' 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    echo "Nenhum cloudflared manual quick tunnel encontrado."
    return 0
  fi
  echo "Encerrando cloudflared manual: $pids"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
}
