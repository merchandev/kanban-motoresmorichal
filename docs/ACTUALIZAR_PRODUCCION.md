# Actualizar desde la consola del VPS

Servidor confirmado por el propietario: `root@72.62.86.94` (srv1212736).
Proyecto existente: `/docker/kanban-motoresmorichal`, nombre Compose
`kanban-motoresmorichal`. El otro servidor, 72.61.77.167, contiene otros proyectos.

Desde tu equipo:

```sh
ssh root@72.62.86.94
```

En la consola del VPS, durante una ventana sin usuarios haciendo cambios:

```sh
(
  set -eu
  cd /docker/kanban-motoresmorichal
  command -v python3 >/dev/null
  command -v git >/dev/null
  docker compose version
  updater="$(mktemp /tmp/taller-update-XXXXXX.py)"
  trap 'rm -f "$updater"' EXIT
  curl --fail --location --show-error \
    https://raw.githubusercontent.com/merchandev/kanban-motoresmorichal/main/scripts/update-production.py \
    --output "$updater"
  python3 "$updater"
)
```

El actualizador requiere Linux, Python 3, Git, Docker Compose y los tres
contenedores actuales en ejecución. Se detiene si no reconoce sus volúmenes,
red o puerto. Conserva el puerto HTTP activo (sin ocupar 80/443), las credenciales
del entorno actual, el nombre del proyecto, la base y los archivos subidos.
Descarga el código en `.releases/` y compila API/web antes de sustituirlos.
No necesita que la carpeta original tenga `.git` o un archivo `.env`.

Antes del cambio guarda un dump PostgreSQL, los archivos subidos y configuración
de recuperación en `backups/`. Comprueba que ambos respaldos se pueden leer.
Son respaldos consecutivos, no una instantánea atómica: evitar escrituras durante
la actualización. Sustituye solo API y web; no recrea PostgreSQL ni borra volúmenes.
Si falla el arranque o la comprobación HTTP, intenta recuperar las imágenes
anteriores. Esta recuperación no revierte migraciones de base de datos; revisar
compatibilidad al preparar futuras versiones. El QR de esta versión usa una
migración aditiva.

Los archivos de configuración y respaldo contienen secretos: se crean con
permisos privados y están excluidos de Git. No publicarlos ni pegarlos en chats.
La actualización conserva las contraseñas existentes, no restablece usuarios.

Al terminar:

```sh
cat /docker/kanban-motoresmorichal/production-release.json
docker ps --filter label=com.docker.compose.project=kanban-motoresmorichal
docker logs --tail 50 kanban-motoresmorichal-api-1
```

`production-release.json` indica el commit, puerto, respaldo y Compose activo.
Para operaciones posteriores usar ese Compose o ejecutar otra vez el actualizador;
la carpeta original puede contener un Compose antiguo. No ejecutar `down -v`.
Abrir `http://72.62.86.94:PUERTO` usando el puerto informado, iniciar sesión y
descargar el QR del cliente en PNG/PDF. La dirección pública configurada para el
QR debe ser accesible desde el teléfono del cliente, no localhost.

El despliegue remoto no se ha ejecutado desde Codex: el servidor correcto rechazó
la autenticación facilitada. Estos comandos se ejecutan desde tu sesión autorizada.
