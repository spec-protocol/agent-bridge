#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$INSTALL_DIR"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/sed-inplace.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/env-backup.sh"

OS="$(uname -s)"
WITH_SYSTEMD=0
WITH_LAUNCHD=0
SKIP_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --systemd)
      if [[ "$OS" == Darwin ]]; then
        echo "Error: on macOS use ./scripts/install.sh --launchd" >&2
        exit 1
      fi
      WITH_SYSTEMD=1
      ;;
    --launchd)
      if [[ "$OS" != Darwin ]]; then
        echo "Error: --launchd is macOS only. On Linux use ./scripts/install.sh --systemd" >&2
        exit 1
      fi
      WITH_LAUNCHD=1
      ;;
    --skip-tests) SKIP_TESTS=1 ;;
    -h|--help)
      echo "Usage: $0 [--systemd | --launchd] [--skip-tests]"
      echo "  --systemd   Linux: starts agent-bridge and cloudflared under systemd --user"
      echo "  --launchd   macOS: starts LaunchAgents at login"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' not found on PATH." >&2
    exit 1
  fi
}

need node
need npm
need git
need openssl

if ! command -v agent >/dev/null 2>&1; then
  echo "Warning: 'agent' (Cursor CLI) is not on PATH. Install it and run 'agent login'." >&2
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Error: Node.js >= 18 is required (current: $(node -v))." >&2
  exit 1
fi

echo "==> npm install"
npm install
echo "==> npm run build"
npm run build

if [[ "$SKIP_TESTS" -eq 0 ]]; then
  echo "==> npm test"
  npm test
fi

if [[ ! -f .env ]]; then
  echo "==> Creating .env from .env.example"
  cp .env.example .env
  TOKEN="$(openssl rand -hex 32)"
  if grep -q '^BRIDGE_TOKEN=' .env; then
    sed_inplace "s/^BRIDGE_TOKEN=.*/BRIDGE_TOKEN=$TOKEN/" .env
  else
    echo "BRIDGE_TOKEN=$TOKEN" >> .env
  fi
  if [[ "$OS" == Darwin ]]; then
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/lib/darwin-arch.sh"
  fi
  if command -v agent >/dev/null 2>&1; then
    agent_path="$(command -v agent)"
    if [[ "$OS" == Darwin ]] && ! darwin_binary_ok "$agent_path"; then
      echo "Warning: agent at ${agent_path} is not native to $(uname -m). AGENT_BIN was left empty." >&2
    else
      agent_repl="$(printf '%s' "$agent_path" | sed 's/[&|\\]/\\&/g')"
      sed_inplace "s|^AGENT_BIN=.*|AGENT_BIN=${agent_repl}|" .env
    fi
  fi
  chmod 600 .env
  echo "Edit REPOS= and optionally CURSOR_MODEL= in .env before exposing the tunnel."
else
  echo "==> .env already exists (kept)"
  chmod 600 .env 2>/dev/null || true
fi

save_env_backup "$INSTALL_DIR/.env"

if [[ "$WITH_SYSTEMD" -eq 1 ]]; then
  "$SCRIPT_DIR/setup-systemd.sh"
fi

if [[ "$WITH_LAUNCHD" -eq 1 ]]; then
  "$SCRIPT_DIR/darwin/setup-launchd.sh"
fi

home_dir="${HOME}/.agent-bridge"
mkdir -p "$home_dir"
chmod 700 "$home_dir"
printf '%s\n' "$INSTALL_DIR" > "${home_dir}/home"
chmod 600 "${home_dir}/home"

echo ""
echo "Install finished at: $INSTALL_DIR"
if [[ "$OS" == Darwin ]]; then
  echo "Next: edit .env and run ./scripts/doctor.sh"
  echo "The LaunchAgent starts at login and stops at logout."
else
  echo "Next: edit .env, ./scripts/enable-persistence.sh, ./scripts/doctor.sh"
fi
echo "After reboot: ./scripts/grok-reconnect.sh"
