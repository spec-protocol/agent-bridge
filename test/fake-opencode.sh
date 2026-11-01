#!/usr/bin/env bash
# OpenCode CLI falso para testes: imprime os argumentos recebidos (subcomando run).
if [[ "$1" == "agent" && "$2" == "list" ]]; then
  echo "plan (primary)"
  exit 0
fi
if [[ "$1" == "session" && "$2" == "list" ]]; then
  echo "ses_fake001  demo session"
  exit 0
fi
echo "FAKE_OPENCODE cwd=$(pwd)"
i=0
for a in "$@"; do echo "ARG[$i]=$a"; i=$((i+1)); done
echo "BRIDGE_TOKEN_VISIBLE=${BRIDGE_TOKEN:-<unset>}"
if [[ "$*" == *"SLEEP_FOREVER"* ]]; then sleep 60; fi
if [[ "$*" == *"FAIL_PLEASE"* ]]; then echo "erro simulado opencode" >&2; exit 3; fi
prev=""
for a in "$@"; do
  if [[ "$prev" == "--format" && "$a" == "json" ]]; then
    echo '{"sessionID":"ses_test123","type":"text","text":"resposta simulada opencode"}'
    exit 0
  fi
  prev="$a"
done
echo "resposta simulada opencode"
