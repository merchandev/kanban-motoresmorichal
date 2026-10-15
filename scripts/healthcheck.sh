#!/usr/bin/env bash
set -Eeuo pipefail
URL="${1:?Uso: ./scripts/healthcheck.sh https://taller.dominio.com}"
echo "Comprobando $URL"
curl --fail --silent --show-error --max-time 12 "$URL/api/health"
printf '\n'
curl --fail --silent --show-error --location --output /dev/null --write-out 'Frontend HTTP %{http_code}\n' --max-time 12 "$URL/"
echo 'Comprobación básica completada (no sustituye pruebas de roles, BD y Kanban).'
