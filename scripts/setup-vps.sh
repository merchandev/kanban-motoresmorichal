#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
if [[ -e .env.vps ]]; then echo '.env.vps ya existe: se conserva.'; exit 0; fi
port="${1:-18090}"
if ! [[ "$port" =~ ^[0-9]+$ ]] || ((port < 1024 || port > 65535)); then echo 'Puerto inválido: usa 1024–65535.' >&2; exit 1; fi
case "$port" in 3000|8088|18025) echo 'Ese puerto aparece ocupado en el inventario conocido.' >&2; exit 1;; esac
command -v openssl >/dev/null
umask 077
db_pass="$(openssl rand -hex 24)"
admin_pass="$(openssl rand -hex 24)"
cat > .env.vps <<EOF
COMPOSE_PROJECT_NAME=tallerflow-morichal
HTTP_PORT=$port
BIND_IP=0.0.0.0
POSTGRES_PASSWORD=$db_pass
ADMIN_EMAIL=admin@tallerflow.local
ADMIN_PASSWORD=$admin_pass
SEED_DEMO=false
DEMO_PASSWORD=
COOKIE_SECURE=false
DB_MEMORY_LIMIT=512m
API_MEMORY_LIMIT=1024m
WEB_MEMORY_LIMIT=128m
EOF
chmod 600 .env.vps
echo 'Entorno nuevo generado en .env.vps (600). Guarda las claves en un gestor seguro.'
echo 'No se ha abierto ningún puerto ni iniciado ningún servicio.'
