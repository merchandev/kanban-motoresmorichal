# Historial del proyecto

## 2026-10-15 — Actualizador de producción y comprobación reproducible

- Motivo: actualizar la instalación existente desde la consola del VPS correcto
  (72.62.86.94), conservando configuración y datos incluso si el panel no deja un clon Git.
- Nuevo `scripts/update-production.py`: valida proyecto/red/volúmenes, mantiene el
  puerto HTTP activo y credenciales, compila antes del cambio, respalda PostgreSQL
  y uploads con comprobación de lectura, sustituye solo API/web y comprueba HTTP.
  Ante fallo intenta recuperar las imágenes anteriores. Bloquea actualizaciones
  simultáneas y conserva literalmente los dólares en configuración Compose.
- Nueva guía de consola, exclusión de archivos privados de actualización y prueba
  Docker automatizada: comprueba registros, archivos, contraseña, puerto, volúmenes,
  permanencia del contenedor PostgreSQL y lectura de los respaldos. Se añade a CI.
- Validación local: `npm run hooks:install`, `npm run check` y `npm test` correctos
  (12 pruebas aprobadas, 8 requieren dependencias o integración Docker).
  Docker Desktop no pudo iniciar en este equipo: la validación completa se delega
  al flujo CI del commit y su resultado debe consultarse antes de desplegar.
- Producción no actualizada desde este entorno: autenticación SSH rechazada en el
  VPS correcto. No se cambiaron datos ni servicios de servidores vecinos.

Las entradas describen cambios conocidos y sus verificaciones. No se atribuyen
pruebas ni despliegues que no se hayan ejecutado. Fechas en America/Caracas.

## Cómo se mantiene

1. Ejecutar `npm run hooks:install` al clonar este repositorio.
2. Documentar aquí el cambio funcional, motivo, comprobaciones y limitaciones.
3. Al crear un commit, `pre-commit` agrega y prepara automáticamente una
   entrada con fecha y lista de archivos del commit. No registra secretos.
4. CI exige que los nuevos cambios incluyan `historial.md`. `AGENTS.md` recuerda
   esta regla para trabajos posteriores. Un clon nuevo necesita instalar los hooks;
   Git no copia automáticamente la configuración local de hooks.

El registro automático enumera archivos; no sustituye la explicación funcional.
No reescribir entradas previas: añadir la corrección y su motivo.

## 2026-10-15 — Consolidación completa para GitHub y preparación del VPS

### Comparación con el remoto

- Base remota: `2e076c7f71e0393ab8110dc0354abe5a70545b84` (`main`, «Add files via upload»).
- El remoto solo contenía `.env`, `.env.example`, `.gitignore`, `README.md`,
  `compose.yaml` y `package.json`. No incluía el código que esos archivos describían.
- Se incorpora la implementación local completa: API, interfaz, formulario público,
  imágenes de marca, esquema, certificados públicos BCV, pruebas, scripts y documentación.
- Se conserva el commit remoto como antecesor; no hay force-push ni pérdida deliberada
  de historia. Se excluyen respaldos, dependencias, cargas y configuración secreta.
- Se retira `.env` del índice conservando el archivo local. La copia histórica remota
  exige rotación de cualquier credencial real que haya contenido; no se expone aquí.

### Funciones locales incorporadas

- Gestión de clientes, vehículos, agenda y OTs con seis estaciones; perfiles y permisos.
- Permisos por acción y validación de presupuesto, garantía, tareas, técnico, puesto,
  calidad, lavado y retorno antes de avanzar o cerrar.
- Movimientos encadenados en una transacción, identificador de operación para reintentos
  y selección explícita de tareas confirmadas.
- Mapa accesible desde clientes, vehículos y órdenes; historial por vehículo/día.
- Inventario y requisiciones; pedidos a proveedores con permisos por acción, estados,
  correcciones motivadas, responsable, destino y trazabilidad de transferencias.
- Autorregistro público por QR, autorización versionada, fotos opcionales, revisión de
  identidad por recepción, aceptación/rechazo y apertura opcional de OT.
- Reintentos de registro sin duplicar; control de concurrencia; comparación normalizada
  de identidad/placa y política de una OT abierta por vehículo.
- Fotografías decodificadas y recodificadas con Sharp, miniaturas, límites, limpieza en
  caso de error y retención de registros rechazados; descarga autenticada sin caché.
- Bandeja paginada con totales y antigüedad; dirección QR validada y compartida.
- Tasa BCV, presupuestos internos, reportes, CSV, auditoría y adjuntos privados.
- Se preserva la distribución original, tras revertir el experimento de ancho al 80%.

### Preparación técnica del despliegue

- `compose.vps.yaml` autónomo: proyecto/red/volúmenes exclusivos y un único puerto
  público configurable, `18090/TCP` por defecto; API y BD sin publicar; exclusión de
  Traefik y límites de recursos. El Compose local queda separado.
- Entorno VPS nuevo sin semilla demo, generador de claves y scripts de operación,
  respaldo y actualización específicos para ese proyecto.
- Lockfiles de API y web y Dockerfiles con `npm ci` para dependencias reproducibles.
- Sharp actualizado de 0.34.3 a 0.35.5 tras detectar avisos de severidad alta en su cadena nativa; la versión corregida se verifica con las pruebas de fotos e integración y `npm audit`.
- Runner de pruebas Docker compatible con Windows/Linux/macOS, serialización de los
  escenarios HTTP y comprobación de restauración de tablas y archivos por SHA-256.
- Corregida una precondición de la prueba de pedidos: el caso de estado repetido esperaba
  409 después de un bucle que dejaba la pieza en otro estado. Ahora fija `received`
  antes de repetir `received`; además, tres ediciones usaban POST en vez de PATCH. Se corrigen los métodos de las pruebas sin debilitar los permisos de la API.
- Ensayo local del perfil VPS con sus límites, redes y volúmenes, sin demo, login por proxy y puerto efímero en loopback; elimina únicamente los recursos de prueba.
- CI de compilación, integración, secretos e historial; hooks de historial y controles
  de archivos preparados; reglas para futuras modificaciones en `AGENTS.md`.

### Verificación y limitaciones

- La evidencia concreta de esta versión se registra en `docs/COMPARACION_LOCAL_REPO.md`.
- No hay despliegue remoto confirmado: falta autenticación SSH y comprobar puerto,
  firewall, capacidad y aislamiento en `72.61.77.167`.
- HTTP por IP no cifra los datos. El perfil preparado sirve para evaluación; los datos
  reales requieren HTTPS y credenciales nuevas.

## 2026-10-14 y 2026-10-15 — Antecedentes locales

- Se analizó el MVP, se corrigieron permisos/transiciones y se añadió acceso al mapa.
- Se probó el flujo de órdenes con PostgreSQL y una API separados, incluidos retrabajo,
  despacho simultáneo y restauración, según lo documentado en la sesión de trabajo.
- Se realizó y posteriormente se revirtió, a solicitud del usuario, el cambio global de
  responsive al 80% de ancho; se mantuvieron las correcciones funcionales.
- Se generaron dos informes de revisión, conservados en `docs/REVISION_Y_MEJORAS_2026-10-15*.md`.
- Se identificaron proyectos vecinos del VPS a partir de capturas; no se confirmó un
  inventario completo ni disponibilidad real de `18090` mediante acceso al servidor.

Estos antecedentes no implican que todas las funciones actuales existieran en el
primer MVP ni que se hayan desplegado en el VPS.

### Registro automático — 2026-10-15 11:45:50 (America/Caracas)

Archivos preparados para commit

- `D` — `.env`
- `A` — `.env.vps.example`
- `A` — `.gitattributes`
- `A` — `.githooks/pre-commit`
- `A` — `.github/workflows/ci.yml`
- `M` — `.gitignore`
- `A` — `AGENTS.md`
- `M` — `README.md`
- `A` — `api/.dockerignore`
- `A` — `api/Dockerfile`
- `A` — `api/certs/bcv-sectigo-chain.pem`
- `A` — `api/package-lock.json`
- `A` — `api/package.json`
- `A` — `api/src/bcv.cjs`
- `A` — `api/src/db.cjs`
- `A` — `api/src/index.cjs`
- `A` — `api/src/init.cjs`
- `A` — `api/src/media.cjs`
- `A` — `api/src/schema.sql`
- `A` — `api/src/shared.cjs`
- `A` — `api/src/util.cjs`
- `A` — `api/test/bcv.test.cjs`
- `A` — `api/test/media.test.cjs`
- `A` — `api/test/moves.test.cjs`
- `A` — `api/test/parts.test.cjs`
- `A` — `api/test/registro.test.cjs`
- `A` — `api/test/shared.test.cjs`
- `A` — `api/test/util.test.cjs`
- `A` — `api/test/workflow.test.cjs`
- `A` — `compose.vps.yaml`
- `A` — `docs/ARQUITECTURA.md`
- `A` — `docs/COMPARACION_LOCAL_REPO.md`
- `A` — `docs/DESPLIEGUE_IP_PUERTO.md`
- `A` — `docs/DESPLIEGUE_VPS.md`
- `A` — `docs/ENDPOINTS.md`
- `A` — `docs/ENDPOINTS_ACTUALES.md`
- `A` — `docs/QA.md`
- `A` — `docs/REVISION_Y_MEJORAS_2026-10-15.md`
- `A` — `docs/REVISION_Y_MEJORAS_2026-10-15_02.md`
- `M` — `package.json`
- `A` — `scripts/backup-vps.sh`
- `A` — `scripts/backup.sh`
- `A` — `scripts/check-staged.cjs`
- `A` — `scripts/check-syntax.cjs`
- `A` — `scripts/healthcheck.sh`
- `A` — `scripts/install-docker-ubuntu.sh`
- `A` — `scripts/install-hooks.cjs`
- `A` — `scripts/setup-vps.sh`
- `A` — `scripts/setup.sh`
- `A` — `scripts/test-flow.cjs`
- `A` — `scripts/test-flow.sh`
- `A` — `scripts/test-vps.cjs`
- `A` — `scripts/update-history.cjs`
- `A` — `scripts/update-vps.sh`
- `A` — `scripts/update.sh`
- `A` — `scripts/vps.sh`
- `A` — `web/.dockerignore`
- `A` — `web/Caddyfile`
- `A` — `web/Dockerfile`
- `A` — `web/index.html`
- `A` — `web/package-lock.json`
- `A` — `web/package.json`
- `A` — `web/public/logo-morichal.webp`
- `A` — `web/src/App.jsx`
- `A` — `web/src/Registro.jsx`
- `A` — `web/src/charts.jsx`
- `A` — `web/src/credits.js`
- `A` — `web/src/main.jsx`
- `A` — `web/src/styles.css`
- `A` — `web/vite.config.js`

<!-- staged:117fd0cbd7816f32c55545db3cea1dc3cde64455dd7bfdbc35b0b227e68439c0 -->

## 2026-10-15 — Corregir importación automática desde el panel VPS

- El panel seleccionó compose.yaml y falló porque el puerto 80 ya estaba ocupado.
- compose.yaml ahora publica únicamente HTTP_PORT (18090 por defecto), con base y API privadas, límites de recursos y descubrimiento Traefik desactivado. Se conservan las claves de volúmenes y el nombre predeterminado local; el panel mantiene su nombre de proyecto existente.
- HTTP usa COOKIE_SECURE=false por defecto y DEMO_PASSWORD deja de ser obligatorio sin demo. No se modifica la interfaz ni se cambian contraseñas existentes.
- La prueba VPS verifica ahora el archivo predeterminado usado por el panel; CI también ejecuta el perfil compose.vps.yaml explícito.
- Se documenta el reintento conservando proyecto, credenciales y volúmenes. El puerto remoto y el reintento aún requieren comprobación en el servidor.
- Validación local: npm run check y git diff --check aprobados; ambos perfiles arrancaron con tres servicios saludables, login HTTP, registro público y aislamiento correctos. La configuración de .env.example publica solo 18090/TCP.

### Registro automático — 2026-10-15 11:56:03 (America/Caracas)

Archivos preparados para commit

- `M` — `.env.example`
- `M` — `.github/workflows/ci.yml`
- `M` — `AGENTS.md`
- `M` — `README.md`
- `M` — `compose.yaml`
- `M` — `docs/DESPLIEGUE_IP_PUERTO.md`
- `M` — `scripts/test-vps.cjs`

<!-- staged:b08346d353aa54bf3d4815e4882beea358f8465d22bde8c962b9a76ecd8f1c5d -->

## 2026-10-15 — QR compartido para seguimiento del cliente

- Se añade un QR estable por cliente, accesible desde Clientes y desde cada uno de sus Vehículos. Un cliente con varios vehículos consulta todos los suyos y puede elegir uno. El mismo enlace funciona en visitas posteriores.
- Nueva vista pública /seguimiento con el mapa existente en modo consulta, estación y estado actual, entrega/anulación, actualización cada 30 segundos, errores y última consulta visible. No requiere cuenta interna.
- El enlace usa 256 bits aleatorios en el fragmento de la URL y viaja en una cabecera; no se acepta la placa como autorización ni se muestra información de otros clientes. Solo se publican identificación básica del vehículo y estado de su última orden, priorizando una abierta.
- Crear o renovar el QR requiere permiso people. La renovación invalida el enlace anterior y se registra en auditoría sin guardar el secreto en el evento. Clientes/vehículos en Borradores no se exponen. Respuestas sin caché y consultas limitadas.
- Se permite abrir, descargar e imprimir el QR. Se reutiliza la dirección pública central de Registro QR, con aviso si se intenta compartir localhost. Se conserva la interfaz existente fuera de estas acciones y la nueva página pública.
- Migración aditiva client_tracking, sin cambios de contraseñas ni eliminación de registros. La restauración también comprueba esta tabla.
- Validación: sintaxis CJS y build Docker del frontend aprobados; 20/20 pruebas completas con PostgreSQL/Sharp, incluida nueva integración de seguimiento; restauración verificada de 16 tablas y 9 archivos por SHA-256. Comprobación visual y CI se registran al completarse.
- No se ha desplegado esta función en el VPS desde este entorno.

## 2026-10-15 — Descargas del QR en PNG y PDF con guía para el cliente

- Se conservan los ajustes de responsive del usuario: cabeceras flexibles y campos táctiles de 16 px para evitar el zoom de iOS.
- Se termina el seguimiento público del cliente y sus vehículos, sin inicio de sesión y solo de consulta.
- Botones Descargar PNG y Descargar PDF, con logo Toyota Motores Morichal, QR, instrucciones, beneficios y condiciones de uso; la impresión reutiliza el mismo diseño. El texto también se consulta en la vista pública.
- Generación dentro del navegador, sin nuevas dependencias ni servicios de terceros. PNG de 2480x3508; PDF A4 de una página con imagen de alta resolución y enlace clicable sobre el QR. El PDF no tiene texto seleccionable.
- Validación real: descargas desde los botones en el navegador, PDF abierto con parser estricto y renderizado para inspección visual, ambos QR decodificados y comparados con el enlace esperado. Sin cortes ni superposiciones en el documento. Build del frontend y sintaxis aprobados.
- Producción: la IP indicada primero (72.61.77.167) corresponde a srv1190391 y no contiene el proyecto. El usuario aclaró que producción es 72.62.86.94; ese servidor responde pero rechazó la contraseña facilitada. No se realizaron cambios remotos. El despliegue queda pendiente de autenticar en el servidor correcto.

### Registro automático — 2026-10-15 12:52:46 (America/Caracas)

Archivos preparados para commit

- `M` — `README.md`
- `M` — `api/src/index.cjs`
- `M` — `api/src/schema.sql`
- `A` — `api/src/tracking.cjs`
- `A` — `api/test/tracking.test.cjs`
- `A` — `docs/SEGUIMIENTO_CLIENTE.md`
- `M` — `scripts/test-flow.cjs`
- `M` — `web/src/App.jsx`
- `A` — `web/src/Seguimiento.jsx`
- `M` — `web/src/main.jsx`
- `M` — `web/src/styles.css`
- `A` — `web/src/tracking-export.js`

<!-- staged:198208df94de89909bb5608c44528f3c99d71b9e631dedd6a0dc7914c2a7ba03 -->

### Registro automático — 2026-10-15 20:19:19 (America/Caracas)

Archivos preparados para commit

- `M` — `.github/workflows/ci.yml`
- `M` — `.gitignore`
- `M` — `README.md`
- `A` — `docs/ACTUALIZAR_PRODUCCION.md`
- `M` — `docs/DESPLIEGUE_IP_PUERTO.md`
- `A` — `scripts/test-updater.cjs`
- `A` — `scripts/update-production.py`

<!-- staged:232c1b9c5dcc1d24634308c85658b4cbba7db312eccf9c37b35025f8df88772a -->

### Ajuste de la prueba de actualización
- Se configura también DEMO_PASSWORD en el entorno QA para crear datos ficticios y comprobar su conservación; no se modifica la configuración de producción.


### Registro automático — 2026-10-15 20:20:30 (America/Caracas)

Archivos preparados para commit

- `M` — `README.md`
- `M` — `scripts/test-updater.cjs`

<!-- staged:c0d1171553849e7683744c986410b2bb26d1a728d8f493b2e948f34b6fc91adf -->

### Corrección de espera en la integración
- CI detectó una carrera: pg_isready por socket aceptaba el servidor temporal de initdb antes de escuchar TCP. La prueba ahora espera TCP en 127.0.0.1 antes de iniciar la API. El primer ensayo CI falló por ECONNREFUSED; se repetirá con esta corrección.


### Registro automático — 2026-10-15 20:21:27 (America/Caracas)

Archivos preparados para commit

- `M` — `scripts/test-flow.cjs`

<!-- staged:a8d52723eb28836fc400c7da552e5501d7c92824fad1b950ca4e0972ae8fc4ec -->

### Resultado verificado de CI — 2026-10-15
- Ejecución 38828941520 aprobada: sintaxis JS/Python, ambas imágenes Docker, 20/20 pruebas de integración, restauración de 16 tablas y 9 archivos por SHA-256, ambos perfiles Compose y prueba real del actualizador.
- El actualizador descargó y ejecutó 6d6bbfefcbbe9b72d9b29dd645fbc33bb444d047 en un proyecto QA aislado. Se comprobaron filas idénticas antes/después, archivos, contraseña, puerto, volúmenes y el mismo contenedor PostgreSQL; respaldos legibles y rutas HTTP correctas. Recursos QA eliminados al finalizar.
- La recuperación automática de imágenes está implementada, pero este ensayo comprueba el camino exitoso; no se simula un fallo de arranque. No se afirma despliegue real en el VPS.
- Evidencia: https://github.com/merchandev/kanban-motoresmorichal/actions/runs/38828941520
- Se corrigen los enlaces restantes al servidor anterior en la guía de despliegue.


### Registro automático — 2026-10-15 20:23:37 (America/Caracas)

Archivos preparados para commit

- `M` — `docs/DESPLIEGUE_IP_PUERTO.md`

<!-- staged:6a16aba60e2bb9aa83e1cdd155432e534fd23a9778fddbabb1ced642f1ac5ece -->
