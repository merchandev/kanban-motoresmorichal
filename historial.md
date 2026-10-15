# Historial del proyecto

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
