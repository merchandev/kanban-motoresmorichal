#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
./scripts/backup.sh
docker compose up -d --build --remove-orphans
docker compose ps
