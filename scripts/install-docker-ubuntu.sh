#!/usr/bin/env bash
# Ubuntu 24.04/22.04 — instala Docker Engine + Compose plugin con repositorio oficial.
set -Eeuo pipefail
if ! command -v apt-get >/dev/null; then echo 'Este script solo sirve para Ubuntu/Debian con apt. Revisar OS.'; exit 1; fi
. /etc/os-release
if [[ "$ID" != 'ubuntu' ]]; then echo 'Script validado para Ubuntu. Usa instrucciones Docker oficiales en otras distros.'; exit 1; fi
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
cat <<SRC | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
SRC
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
printf '\nDocker instalado. Usa sudo docker compose o abre una nueva sesión tras añadir tu usuario al grupo docker (equivale a acceso root).\n'
