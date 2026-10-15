#!/usr/bin/env bash
# Siempre opera solo el archivo autónomo y el entorno del taller.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
env_file="${TALLER_ENV_FILE:-.env.vps}"
if [[ ! -f "$env_file" ]]; then echo "Falta $env_file; genera el entorno con scripts/setup-vps.sh" >&2; exit 1; fi
exec docker compose --env-file "$env_file" -f compose.vps.yaml "$@"
