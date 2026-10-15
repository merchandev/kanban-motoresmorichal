#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
bash scripts/backup-vps.sh
bash scripts/vps.sh config --quiet
bash scripts/vps.sh up -d --build --wait
bash scripts/vps.sh ps
