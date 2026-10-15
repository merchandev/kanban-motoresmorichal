# Despliegue aislado del taller en el VPS

## Alcance y estado

Servidor previsto: `72.61.77.167`. Puerto candidato: `18090/TCP`.
El puerto no está confirmado libre: las capturas mostraban 3000, 8088, 18025, 25 y 587,
pero no constituyen el inventario completo del servidor. El acceso SSH no ha podido
autenticarse desde este entorno. El usuario reportó un despliegue parcial desde el panel:
base y API saludables, web bloqueada por el puerto 80. La corrección remota aún no se
ha ejecutado desde este entorno; no se han tocado proyectos vecinos.

Para scripts SSH usar `compose.vps.yaml`; al importar Git desde el panel,
`compose.yaml` también publica únicamente HTTP_PORT (18090 por defecto).
No combinar ambos archivos. API 3001 y PostgreSQL 5432 quedan sin publicar.
Los tres servicios llevan `traefik.enable=false`, sin modificar los Traefik existentes.

## Reintentar desde el panel tras el conflicto del puerto 80

El registro del 15/10 muestra que el panel clona el repositorio y elige automáticamente
`compose.yaml`. El fallo ocurrió al publicar el puerto 80; la base y la API ya estaban
saludables. La configuración predeterminada corregida publica solo 18090/TCP.

1. Comprobar que el puerto 18090 esté libre con las consultas siguientes.
2. Actualizar/reimplementar el proyecto existente `kanban-motoresmorichal` desde
   `main`, conservando exactamente su nombre y los valores de POSTGRES_PASSWORD,
   ADMIN_EMAIL y ADMIN_PASSWORD usados en el primer intento. No crear otro proyecto.
3. Configurar `HTTP_PORT=18090`, `COOKIE_SECURE=false` y `SEED_DEMO=false`.
   No se necesita DEMO_PASSWORD si no se generan datos demo. No borrar volúmenes.
4. Confirmar tres servicios saludables y abrir `http://IP_DEL_VPS:18090`.
   Si el puerto está ocupado, elegir otro libre mediante HTTP_PORT; no detener al ocupante.

Mantener la contraseña PostgreSQL original: editar la variable no cambia la contraseña
de una base ya inicializada. El despliegue anterior pudo crear usuarios/datos según
sus variables; SEED_DEMO=false evita nuevas semillas, pero no elimina registros previos.
No se ha ejecutado este reintento remoto desde el entorno local.

## 1. Comprobar el servidor antes de instalar

Consultas de lectura desde la consola del VPS:

```bash
docker compose version
docker compose ls --all
docker ps -a --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
ss -lntup
free -h
df -h
```

Comprobar que `18090/TCP` no esté ocupado ni asignado a un contenedor detenido,
que el nombre `tallerflow-morichal` no corresponda a otro proyecto y que haya
recursos suficientes. No reiniciar Docker ni cambiar puertos, redes o servicios
existentes. Los límites predeterminados del taller suman hasta 1664 MiB de RAM;
no son una reserva de capacidad del host. Ajustarlos según recursos y carga real.

## 2. Obtener una versión concreta

Requisitos: Git, Node.js 22+, OpenSSL, Docker Engine y Compose v2 con `--wait`.

```bash
git clone https://github.com/merchandev/kanban-motoresmorichal.git /opt/tallerflow-morichal
cd /opt/tallerflow-morichal
git rev-parse HEAD
npm run hooks:install
bash scripts/setup-vps.sh 18090
```

El generador conserva un `.env.vps` ya existente y nunca copia las claves de `.env`.
Genera credenciales nuevas, sin cuentas demo. No publica ni imprime las claves.
Guardar las credenciales de `.env.vps` en un gestor seguro, sin subir el archivo.
Para una versión aprobada, usar su SHA con `git checkout SHA_APROBADO`.

**Incidencia previa del repositorio:** el commit `2e076c7` contenía `.env`.
Aunque se retira de la versión actual, permanece en la historia remota. Cualquier
clave real contenida allí debe considerarse expuesta y rotarse donde se haya usado.
No reutilizarla para PostgreSQL, administración o cuentas de otro sistema.
No se ha reescrito el historial remoto ni se han cambiado contraseñas de sistemas activos.

## 3. Validar y levantar únicamente el taller

```bash
npm run check
npm test
# Base y contenedores desechables; ejecuta también integración y restauración:
npm run test:flow

bash scripts/vps.sh config --quiet
bash scripts/vps.sh up -d --build --wait
bash scripts/vps.sh ps
bash scripts/vps.sh logs --tail=60 api web
```

Solo si se decidió exponer el servicio, habilitar **únicamente** el nuevo puerto TCP
en el firewall del VPS y en el panel del proveedor. No sustituir ni reiniciar las
reglas existentes. Este paso modifica el servidor y requiere haber completado
las comprobaciones anteriores.

Acceso previsto: `http://72.61.77.167:18090`.

```bash
curl --fail http://127.0.0.1:18090/api/health
curl --fail -I http://127.0.0.1:18090/registro
```

Comprobar también acceso desde fuera del servidor y desde un teléfono antes de
imprimir el QR. Entrar como administrador y configurar la dirección pública
`http://72.61.77.167:18090` en Registro de clientes: se guarda centralmente y la
ruta `/registro` se normaliza automáticamente.

El perfil por IP es HTTP y usa `COOKIE_SECURE=false`: no cifra los datos ni las
fotos. Es un perfil de evaluación; antes de datos reales se necesita configurar
HTTPS y comprobar cookies seguras. Eso no queda resuelto por elegir otro puerto.

## 4. Persistencia, respaldo y actualización

Volúmenes previstos: `tallerflow-morichal_pgdata`, `tallerflow-morichal_uploads`,
`tallerflow-morichal_caddy_data` y `tallerflow-morichal_caddy_config`; red propia
`tallerflow-morichal_backend`. Mantener el mismo nombre de proyecto en actualizaciones.
Cambiarlo crea otro conjunto de volúmenes y puede aparentar una instalación vacía.

```bash
bash scripts/backup-vps.sh
# Tras revisar y aprobar el commit publicado:
git pull --ff-only origin main
bash scripts/update-vps.sh
```

El respaldo incluye base, adjuntos y fotos. Se crean archivos parciales y solo se
renombran al terminar. Para consistencia entre BD y archivos durante actividad,
coordinar una ventana de mantenimiento y probar la restauración en otra base.
No ejecutar `down -v`, limpiezas globales, `docker system prune` ni operaciones sobre
los otros proyectos. El script de actualización no usa `--remove-orphans`.

Si un despliegue falla: guardar el error sin secretos, corregirlo en local, ejecutar
las comprobaciones, actualizar `historial.md`, hacer commit y push y después
actualizar solo el taller. Un cambio de esquema puede requerir un procedimiento
de recuperación de BD; volver a una imagen anterior no revierte el esquema.

## 5. Datos existentes

No se borran duplicados durante la inicialización. Si hay placas equivalentes o
varias OTs abiertas por vehículo de una versión anterior, el esquema emite un aviso
y omite el índice único correspondiente. Revisar esos avisos y resolver los datos
con un procedimiento aprobado; no usar una limpieza automática en producción.
