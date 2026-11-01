# shellcheck shell=bash

user_linger_enabled() {
  local line
  line="$(loginctl show-user "$USER" -p Linger 2>/dev/null || true)"
  [[ "$line" == "Linger=yes" ]]
}

ensure_user_services_enabled() {
  local u failed=0
  for u in agent-bridge.service; do
    if [[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$u" ]]; then
      systemctl --user enable "$u" >/dev/null 2>&1 || failed=1
    fi
  done
  if [[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/cloudflared-bridge.service" ]]; then
    systemctl --user enable cloudflared-bridge.service >/dev/null 2>&1 || failed=1
  fi
  return "$failed"
}
