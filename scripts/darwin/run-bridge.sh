#!/usr/bin/env bash
# launchd does not read EnvironmentFile. This wrapper loads .env and execs Node.
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$INSTALL_DIR/scripts/lib/env-backup.sh"
restore_env_backup "$INSTALL_DIR/.env"
# shellcheck disable=SC1091
set -a
source "$INSTALL_DIR/.env"
set +a

NODE="${AGENT_BRIDGE_NODE:-}"
if [[ -z "$NODE" ]]; then
  NODE="$(command -v node || true)"
fi
if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  echo "agent-bridge: node not found (AGENT_BRIDGE_NODE)." >&2
  exit 1
fi

exec "$NODE" "$INSTALL_DIR/dist/index.js"
