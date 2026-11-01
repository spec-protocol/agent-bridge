#!/usr/bin/env bash
# Cursor CLI falso para testes: imprime os argumentos recebidos.
echo "FAKE_AGENT cwd=$(pwd)"
i=0
for a in "$@"; do echo "ARG[$i]=$a"; i=$((i+1)); done
echo "BRIDGE_TOKEN_VISIBLE=${BRIDGE_TOKEN:-<unset>}"
if [[ "$*" == *"SLEEP_FOREVER"* ]]; then sleep 60; fi
if [[ "$*" == *"SLEEP_JOB_10"* ]]; then sleep 10; fi
if [[ "$*" == *"FAIL_PLEASE"* ]]; then echo "erro simulado" >&2; exit 3; fi
