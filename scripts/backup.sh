#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
stamp="$(date +%Y%m%d-%H%M%S)"
docker compose exec -T db pg_dump -U tallerflow -d tallerflow -Fc > "backups/db-${stamp}.dump"
# El volumen de adjuntos se respalda por separado.
docker compose exec -T api tar -czf - -C /data/uploads . > "backups/uploads-${stamp}.tgz"
chmod 600 "backups/db-${stamp}.dump" "backups/uploads-${stamp}.tgz"
echo "Copias creadas en backups/ para ${stamp}. Trasládalas a un almacenamiento externo cifrado."
