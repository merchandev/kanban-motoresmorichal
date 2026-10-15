#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
stamp="$(date +%Y%m%d-%H%M%S)"
db_tmp="backups/vps-db-$stamp.dump.partial"
files_tmp="backups/vps-uploads-$stamp.tgz.partial"
trap 'rm -f -- "$db_tmp" "$files_tmp"' EXIT
bash scripts/vps.sh exec -T db pg_dump -U tallerflow -d tallerflow -Fc > "$db_tmp"
bash scripts/vps.sh exec -T api tar -czf - -C /data/uploads . > "$files_tmp"
test -s "$db_tmp" && test -s "$files_tmp"
gzip -t "$files_tmp"
mv -- "$db_tmp" "backups/vps-db-$stamp.dump"
mv -- "$files_tmp" "backups/vps-uploads-$stamp.tgz"
echo "Backup VPS guardado: $stamp. BD y cargas se copian consecutivamente; para una copia coordinada, usar mantenimiento."
