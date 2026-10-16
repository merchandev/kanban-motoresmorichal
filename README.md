# TallerFlow — MVP de gestión web para taller automotriz

**Versión:** 1.0.0 · **Idioma:** Español · **Arquitectura:** React + Vite / Express / PostgreSQL / Caddy / Docker Compose.

Sistema web independiente. **No se integra ni depende de Infoauto u otro sistema.** Incluye inicio de sesión seguro por cookie HttpOnly y roles, clientes, vehículos, citas, órdenes, 6 estaciones Kanban, tareas, permisos, diagnóstico, presupuestos internos, inventario, solicitudes y despachos, garantías, calidad, retrabajos, lavado, entrega, archivos privados, bitácora y reportes CSV. Se incluyen datos **claramente ficticios** opcionales para una demostración.

> **Estado de validación:** consultar la evidencia de esta versión en `docs/COMPARACION_LOCAL_REPO.md`. Las comprobaciones locales se distinguen del despliegue real en VPS, pendiente de acceso SSH y verificación de puertos/recursos.

Para los **comandos SSH completos y en orden**, consulta [`docs/DESPLIEGUE_VPS.md`](docs/DESPLIEGUE_VPS.md).

## Despliegue de esta versión

Para el VPS compartido con otros proyectos, seguir **[Despliegue aislado por IP y puerto](docs/DESPLIEGUE_IP_PUERTO.md)**.
El panel que importa Git usa `compose.yaml`: ahora publica únicamente **18090/TCP** (configurable con `HTTP_PORT`), con red y volúmenes propios. Para scripts SSH se mantiene `compose.vps.yaml` con `.env.vps`. No combinar los dos archivos.
Las instrucciones históricas de dominio que siguen requieren adaptar expresamente los puertos para HTTPS; la configuración predeterminada sirve HTTP por IP.

- [Comparación con el repositorio remoto y validación](docs/COMPARACION_LOCAL_REPO.md).
- [Historial funcional y automático de cambios](historial.md).
- `npm run hooks:install`: instalar el historial automático de archivos por commit en cada clon.
- `npm run check`: sintaxis de todos los CJS de API, pruebas y scripts.
- `npm test`: pruebas unitarias; las que necesitan Sharp o PostgreSQL pueden omitirse fuera de Docker.
- `npm run test:flow`: suite completa con Sharp y PostgreSQL aislado; también verifica restauración.

`.env` no se distribuye. El commit remoto inicial lo incluía: retirar el archivo del árbol actual no lo borra de la historia. Generar claves nuevas y rotar cualquier clave histórica real usada en sistemas activos.

## 1. VPS recomendado

- Ubuntu 24.04 LTS o Debian 12, arquitectura x86_64/arm64.
- 2 vCPU, 4 GB RAM, al menos 25 GB SSD como punto de partida para demo pequeño.
- DNS `A` del subdominio apuntando a la IP del VPS si usas dominio.
- Puertos 22/TCP (idealmente solo desde tu IP), 80/TCP, 443/TCP y 443/UDP. **No** abrir 5432 ni 3001 públicamente.
- Docker Engine y Docker Compose Plugin instalados desde repositorios oficiales de Docker.

## 2. Referencia histórica: despliegue con dominio HTTPS

**Este procedimiento requiere adaptar el perfil para HTTPS.** El compose actual escucha HTTP en 18090 y no publica 443. Para el panel compartido seguir la guía por IP indicada arriba.

```bash
# En el VPS, tras instalar Docker y Compose:
sudo mkdir -p /opt/tallerflow
sudo chown "$USER":"$USER" /opt/tallerflow
cd /opt/tallerflow
# Copia/descomprime aquí el contenido del ZIP, no la carpeta padre doble.
unzip tallerflow-mvp.zip
cd tallerflow-mvp
chmod +x scripts/*.sh
./scripts/setup.sh taller.tudominio.com
# Guarda fuera del servidor las contraseñas que aparecen en la salida.
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=80 api web
```

Entra a `https://taller.tudominio.com`, correo `admin@tallerflow.local` y contraseña generada por `setup.sh`. Caddy obtiene y renueva el certificado TLS automáticamente cuando el DNS resuelve al VPS y los puertos están abiertos. El proceso **necesita acceso a Internet para descargar imágenes y dependencias npm**. Si el proyecto está en `/opt/tallerflow/tallerflow-mvp`, ajusta rutas a esa ubicación.

**IMPORTANTE:** al extraer el ZIP con `unzip tallerflow-mvp.zip`, contiene la carpeta `tallerflow-mvp/`. Puedes descomprimirlo donde prefieras y ejecutar comandos desde esa carpeta.

## 3. Despliegue de prueba SIN dominio (HTTP, solo para evaluación)

```bash
./scripts/setup.sh :80
docker compose up -d --build
```

Accede a `http://IP_DEL_VPS:18090`. El script configura `COOKIE_SECURE=false` para HTTP: **no ingreses datos reales ni contraseñas sensibles** en este modo. Para pasar a dominio/HTTPS edita `.env` (`SITE_ADDRESS=taller.tudominio.com`, `COOKIE_SECURE=true`) y reinicia: `docker compose up -d`. Caddy emitirá el certificado si el DNS y firewall lo permiten.

## 4. Usuarios demo

Cuando `SEED_DEMO=true` se crean registros ficticios una vez y usuarios con el mismo `DEMO_PASSWORD` aleatorio generado por `setup.sh`. Correos:

| Rol | Correo |
|---|---|
| Recepción | recepcion@tallerflow.local |
| Jefe de taller | jefe@tallerflow.local |
| Técnico | tecnico@tallerflow.local |
| Almacén | repuestos@tallerflow.local |
| Calidad | calidad@tallerflow.local |
| Lavado | lavado@tallerflow.local |
| Conductor | conductor@tallerflow.local |
| Garantías | garantias@tallerflow.local |
| Gerencia | gerencia@tallerflow.local |

Admin usa `ADMIN_PASSWORD` y puede crear nuevos usuarios. **En producción**, usar `.env` con `SEED_DEMO=false` antes del primer arranque en una base nueva, establecer contraseñas únicas, eliminar las cuentas demo y cambiar a datos reales solo después de probar respaldos, recuperación, permisos y controles operativos.

## 5. Flujo completo de ejemplo

1. Recepción: crea un cliente, registra vehículo, nueva OT con inspección. El operador recepcion@ puede avanzar a **Traslado**.
2. Conductor: entra como conductor@ y confirma llegada al taller -> **Taller**.
3. Jefe: entra como jefe@, abre OT, asigna técnico y bahía. Como mecánico o jefe agrega tareas, registra diagnóstico. Si necesita pieza, emite solicitud desde pestaña **Repuestos**.
4. Almacén: repuestos@ confirma despachos (descuenta inventario **una sola vez**), registra entradas mediante Ajustar stock, resuelve el bloqueo. Jefe termina cuando todas las tareas están completas -> **Calidad**.
5. Calidad: calidad@ aprueba o rechaza. Un rechazo crea una tarea de **retrabajo** y devuelve a Taller; una aprobación avanza a **Lavado**.
6. Lavado: lavado@ certifica y avanza a **Entrega**. Conductor: confirma retorno físico a recepción.
7. Recepción: recepcion@ registra destinatario y cierra la OT. Se guarda el historial y queda en reportes.

Para una OT **de garantía**, el coordinador de garantía debe crear/evaluar el expediente como elegible antes de que recepción la traslade. Esta elegibilidad es solo administrativa interna y **no es una interpretación legal** de una póliza.

## 6. Datos y seguridad

- **PostgreSQL** no publica puertos; volumen `pgdata` persistente.
- API privada en la red Compose; Caddy es el único servicio público.
- Contraseñas `bcrypt`, tokens aleatorios de sesión con SHA-256 en base de datos, cookie HttpOnly/SameSite Strict/Secure bajo HTTPS. Inicio de sesión limitado por IP.
- Permisos **verificados en la API**. Cada movimiento de orden y stock se registra en auditoría. Transacciones para movimientos de repuestos y cambios de estación.
- Archivos JPG, PNG, WebP y PDF de máximo 5 MB guardados en un volumen privado `uploads`, servidos **solo tras autenticar**, con `Content-Disposition: attachment`.
- No hay facturación fiscal, pasarela de pagos, envíos de correo ni mensajería externa. Los presupuestos son internos.
- El tablero se refresca automáticamente cada 30 segundos y manualmente. No es WebSocket en tiempo real.
- Los permisos y checklists son MVP: **revisar procesos y amenazas** antes de un piloto productivo con datos reales.

## 7. Operación del servidor

```bash
docker compose ps                         # Estado
docker compose logs -f --tail=100 api     # Errores del servidor
docker compose logs -f --tail=100 web     # Proxy HTTPS / frontend
./scripts/backup.sh                      # Backup BD + adjuntos
./scripts/update.sh                      # Backup + reconstruir y levantar
docker compose down                      # Parar sin borrar datos
```

**NO ejecutar** `docker compose down -v`, salvo que se desee perder los volúmenes de la base, archivos y certificados. En un entorno serio se requieren backups externos cifrados, prueba periódica de restauración y monitorización del almacenamiento.

### Restaurar la base en un entorno vacío de recuperación

```bash
# Extraer/colocar dump en directorio backups/ de forma segura.
docker compose cp backups/db-AAAA.dump db:/tmp/recovery.dump
docker compose exec db pg_restore -U tallerflow -d tallerflow --clean --if-exists /tmp/recovery.dump
# Para adjuntos, restaurar el .tgz dentro del volumen uploads, antes de usar la aplicación.
```

**No ejecutar restauración en el sistema activo** sin un proceso de mantenimiento; reemplaza registros y puede eliminar cambios actuales. Ensayar recuperación en otro VPS/volúmenes de prueba.

## 8. Desarrollo local

```bash
# Requiere PostgreSQL y Node.js 22+.
cd api && npm install && npm run init && npm start
# En otra terminal:
cd web && npm install && npm run dev
# Vite abre http://localhost:5173 y proxya /api a :3001.
```

Exportar variables `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (mínimo 12 caracteres), `DEMO_PASSWORD`, `SEED_DEMO`, `COOKIE_SECURE=false`, `UPLOAD_DIR` antes del `npm run init` y `npm start`. Para facilitarlo, usa Docker Compose también en local.

## 9. Estructura del proyecto

```
tallerflow-mvp/
├── api/
│   ├── src/{index.cjs,init.cjs,db.cjs,shared.cjs,schema.sql}
│   ├── test/shared.test.cjs
│   ├── Dockerfile
│   └── package.json
├── web/
│   ├── src/{main.jsx,App.jsx,styles.css}
│   ├── Caddyfile, Dockerfile, index.html, vite.config.js
│   └── package.json
├── scripts/{setup.sh,backup.sh,update.sh,healthcheck.sh,install-docker-ubuntu.sh}
├── docs/{ARQUITECTURA.md,ENDPOINTS.md,QA.md,DESPLIEGUE_VPS.md}
├── .env.example, compose.yaml, .gitignore
└── README.md
```

## 10. Alcance conocido / antes de producción

- Funciona como MVP de **una sola sede** y una sola moneda visual; los costos no emiten comprobantes legales.
- Roles básicos; la revisión de cobertura de garantía es manual.
- Agenda sin detección de doble reserva ni calendario de disponibilidad.
- Repuestos manejan despachos, entradas y ajustes, sin módulo completo de proveedores o órdenes de compra.
- Adjuntos privados sin antivirus integrado; implantar análisis antimalware y políticas de retención antes de usar documentos de clientes reales.
- Sin WebSockets, envío de notificaciones o firma digital legal. La entrega guarda nombre y evento, **no firma biométrica**.
- El módulo de usuarios no incluye recuperación automática por correo. Admin puede crear cuentas; restablecer contraseñas debe implementarse antes de operación real.
- La suite aislada cubre flujos HTTP/PostgreSQL y casos de concurrencia; no sustituye una prueba de carga ni la validación en el VPS. Ver `docs/QA.md` y la comparación de esta versión.

## Seguimiento del vehículo para el cliente

En **Clientes** o **Vehículos**, usar **QR cliente** para abrir, compartir, descargar o imprimir el mismo enlace de seguimiento del propietario. Si tiene varios vehículos, el cliente puede seleccionarlos. La vista pública muestra estación y estado sin iniciar sesión y se actualiza cada 30 segundos. [Uso y alcance](docs/SEGUIMIENTO_CLIENTE.md).
# Actualizar una instalación existente

Consulta [la guía de actualización desde consola](docs/ACTUALIZAR_PRODUCCION.md).

