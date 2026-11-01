#!/usr/bin/env bash
# Copy of .env outside the package. save updates ~/.agent-bridge/env.
# restore returns the copy only when the installation .env is missing.
# When executed directly, restores this installation's .env (Linux ExecStartPre).

env_backup_file() {
  printf '%s' "${HOME}/.agent-bridge/env"
}

save_env_backup() {
  local src="${1:-.env}" dest dir
  [[ -f "$src" ]] || return 0
  dest="$(env_backup_file)"
  dir="$(dirname "$dest")"
  mkdir -p "$dir"
  chmod 700 "$dir"
  cp "$src" "$dest"
  chmod 600 "$dest"
}

restore_env_backup() {
  local dest="${1:-.env}" src
  [[ -f "$dest" ]] && return 0
  src="$(env_backup_file)"
  [[ -f "$src" ]] || return 0
  cp "$src" "$dest"
  chmod 600 "$dest"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  INSTALL_DIR="${INSTALL_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
  restore_env_backup "$INSTALL_DIR/.env"
fi
