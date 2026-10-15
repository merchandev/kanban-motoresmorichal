#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
if [[ -e .env ]]; then echo 'Ya existe .env: no se modificará.'; exit 0; fi
if ! command -v openssl >/dev/null; then echo 'Se requiere openssl'; exit 1; fi
ADDRESS="${1:-:80}"
if [[ "$ADDRESS" == ":80" || "$ADDRESS" == "http://"* ]]; then SECURE=false; else SECURE=true; fi
umask 077
DB_PASS="$(openssl rand -hex 24)"
ADMIN_PASS="$(openssl rand -hex 18)"
DEMO_PASS="$(openssl rand -hex 16)"
cat > .env <<EOT
SITE_ADDRESS=${ADDRESS}
COOKIE_SECURE=${SECURE}
POSTGRES_PASSWORD=${DB_PASS}
ADMIN_EMAIL=admin@tallerflow.local
ADMIN_PASSWORD=${ADMIN_PASS}
DEMO_PASSWORD=${DEMO_PASS}
SEED_DEMO=true
EOT
chmod 600 .env
printf '\nArchivo .env generado con credenciales aleatorias.\nUsuario admin: admin@tallerflow.local\nContraseña admin: %s\nContraseña de usuarios demo: %s\n\n' "$ADMIN_PASS" "$DEMO_PASS"
echo 'ADVERTENCIA: guarda las contraseñas en un gestor seguro. No publiques .env.'
