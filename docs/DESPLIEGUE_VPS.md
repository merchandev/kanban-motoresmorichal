# Despliegue VPS — Comandos en orden

> Para el VPS compartido por IP y puerto, usar [DESPLIEGUE_IP_PUERTO.md](DESPLIEGUE_IP_PUERTO.md). Este documento conserva el perfil histórico con dominio y puertos 80/443; no ejecutarlo sobre los proyectos existentes.

## A. Configurar Ubuntu 24.04 desde SSH

```bash
ssh usuario@IP_DEL_VPS
sudo apt update && sudo apt upgrade -y
sudo apt install -y unzip curl openssl ufw
```

Si Docker no está instalado, desde carpeta del proyecto ejecutar `./scripts/install-docker-ubuntu.sh`, que usa repositorios oficiales. Antes de poner el servidor en producción, configurar usuario sin contraseña SSH, llaves, firewall, actualizaciones de seguridad y acceso SSH limitado a tu IP. **No cerrar puerto SSH en UFW hasta verificar conectividad.**

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status
```

## B. Transferir el ZIP al VPS desde tu equipo

```bash
scp tallerflow-mvp.zip usuario@IP_DEL_VPS:/home/usuario/
```

En el servidor:

```bash
sudo mkdir -p /opt/tallerflow
sudo chown "$USER":"$USER" /opt/tallerflow
mv ~/tallerflow-mvp.zip /opt/tallerflow/
cd /opt/tallerflow
unzip tallerflow-mvp.zip
cd tallerflow-mvp
chmod +x scripts/*.sh
```

## C. Dominio, configuración y arranque

Apuntar `taller.tudominio.com` mediante registro DNS A a la IP. Luego:

```bash
./scripts/setup.sh taller.tudominio.com
# Guarda contraseñas de salida en un gestor seguro.
sudo docker compose config --quiet
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs -f --tail=100 api web
```

Acceder a `https://taller.tudominio.com` y entrar como `admin@tallerflow.local`. Si `docker compose` funciona sin sudo, puedes omitir `sudo`; no es necesario agregar el usuario a grupo docker para desplegar.

## D. Verificaciones y operación

```bash
./scripts/healthcheck.sh https://taller.tudominio.com
sudo docker compose logs --tail=100 api
sudo docker compose logs --tail=100 web
```

**Backup (si Docker requiere sudo):** los scripts `backup.sh`/`update.sh` ejecutan `docker compose` sin sudo. Puedes correrlos con `sudo ./scripts/backup.sh` (pero no usar un .env accesible por terceros). Alternativamente instala una cuenta operadora autorizada para Docker. El grupo `docker` da control elevado del host; úsalo con cuidado.

## E. Actualizaciones

```bash
cd /opt/tallerflow/tallerflow-mvp
sudo ./scripts/backup.sh
sudo docker compose up -d --build
sudo docker compose ps
```

El primer respaldo de prueba debe restaurarse en otra instancia, no en producción.

## F. Diagnóstico

- Certificado falla: verificar DNS A, puertos 80/443 y `SITE_ADDRESS` sin `http://`.
- Login no persiste: comprobar `COOKIE_SECURE=true` con HTTPS; para pruebas HTTP usar `false`.
- Docker falla al descargar dependencias: revisar DNS/salida a internet del VPS.
- API reinicia: `docker compose logs api`; puede deberse a contraseña de admin inferior a 12 caracteres, o DB no disponible.
- Datos demo: si `SEED_DEMO=true` pero faltan 7 órdenes, verificar `DEMO_PASSWORD` de 12+ caracteres.
- Reset destructivo: **NO** ejecutar `docker compose down -v` salvo borrado intencional total de datos.

## G. Requisitos antes de clientes reales

Quitar semilla demo en nuevas instancias, eliminar usuarios demo, usar dominio HTTPS, credenciales individuales, políticas de retención, backup externo, monitorización y pruebas completas `docs/QA.md`. Es un MVP de una sola sede y no sustituye certificaciones legales o controles de contabilidad fiscal.
