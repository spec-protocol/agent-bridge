#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT="${XDG_DATA_HOME:-$HOME/.local/share}/agent-bridge/audit.jsonl"
if [[ -n "${BRIDGE_AUDIT_DIR:-}" ]]; then
  AUDIT="${BRIDGE_AUDIT_DIR}/audit.jsonl"
fi
LIMIT="${1:-20}"
if [[ ! -f "$AUDIT" ]]; then
  echo "Arquivo ausente: $AUDIT (BRIDGE_AUDIT=1?)"
  exit 1
fi
tail -n "$LIMIT" "$AUDIT"
