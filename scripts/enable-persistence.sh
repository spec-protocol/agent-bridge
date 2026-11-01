#!/usr/bin/env bash
# Habilita linger (logout/reboot) e confirma units systemd --user enabled.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(uname -s)" == Darwin ]]; then
  exec "$SCRIPT_DIR/darwin/enable-persistence.sh" "$@"
fi

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/persistence.sh"

CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    -h|--help)
      echo "Usage: $0 [--check-only]"
      echo "  Habilita loginctl linger e garante agent-bridge/cloudflared-bridge enabled."
      echo "  --check-only  diagnose only (exit 1 if linger is off)"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

FAIL=0

if user_linger_enabled; then
  echo "OK  linger is on (Linger=yes)"
else
  echo "WARNING linger is off — user services stop on logout or reboot without a session."
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    echo "Rode: sudo loginctl enable-linger $USER"
    exit 1
  fi
  if command -v sudo >/dev/null 2>&1; then
    echo "Tentando: sudo loginctl enable-linger $USER"
    if sudo loginctl enable-linger "$USER" 2>/dev/null; then
      if user_linger_enabled; then
        echo "OK  linger enabled"
      fi
    fi
  fi
  if ! user_linger_enabled; then
    echo "Execute uma vez (pede senha):"
    echo "  sudo loginctl enable-linger $USER"
    FAIL=1
  fi
fi

if ! ensure_user_services_enabled; then
  echo "WARNING could not enable every unit — run ./scripts/setup-systemd.sh"
  FAIL=1
else
  echo "OK  systemd --user units enabled (agent-bridge, cloudflared if present)"
fi

for u in agent-bridge.service cloudflared-bridge.service; do
  if [[ ! -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$u" ]]; then
    continue
  fi
  if systemctl --user is-enabled "$u" >/dev/null 2>&1; then
    echo "OK  $u is-enabled"
  else
    echo "FAIL $u exists but is not enabled"
    FAIL=1
  fi
done

echo ""
echo "Details: docs/public/README.md (logout, reboot, Grok URL after reboot with a quick tunnel)"

exit "$FAIL"
