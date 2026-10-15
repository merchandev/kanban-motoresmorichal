# Control de calidad antes del piloto

## Prueba de integración reproducible

Ejecutar `npm run test:flow` (Windows/Linux/macOS) o `bash scripts/test-flow.sh` con Docker disponible. Construye una API de prueba,
crea PostgreSQL en memoria y usa cuentas ficticias en una red separada, sin leer `.env`
ni modificar los volúmenes existentes. Al terminar elimina los contenedores y la red.
Ejecuta los escenarios HTTP en serie para evitar interferencias entre pruebas que comparten la base. Comprueba el ciclo completo por HTTP, permisos por acción, bloqueos, presupuestos,
despacho simultáneo, retrabajo, lavado, retorno, cierre, adjuntos, tasas futuras y
restauración de 15 tablas y archivos (adjuntos, fotos y miniaturas) comparados por SHA-256.

Las pruebas unitarias siguen disponibles mediante `npm test`; la prueba HTTP se omite
por defecto y solo se habilita en el entorno desechable con `TF_INTEGRATION=1`.

## Verificaciones automáticas que sí se pudieron realizar durante el empaquetado

- `node --check api/src/index.cjs`
- `node --check api/src/init.cjs`
- `node --test api/test/*.test.cjs`
- Análisis sintáctico de JSX con TypeScript CLI disponible (sin resolver dependencias).

## Pruebas pendientes obligatorias en VPS

1. `docker compose config --quiet` y `docker compose up -d --build` sin fallos.
2. `curl -I https://DOMINIO` (Caddy) y `curl https://DOMINIO/api/health` (`ok`).
3. Ingresar como administrador, luego probar cada usuario por rol. Verificar un rol sin permiso recibe HTTP 403 incluso llamando directamente a la API.
4. Crear cliente, vehículo, OT con inspección y anexar PNG/PDF. Recargar: la información debe persistir.
5. Mover la OT de estación 1 a 2 y a 3. Asignar técnico, crear tres tareas, marcar completadas.
6. Solicitar repuesto sin stock: esperar bloqueo. Ajustar stock (+5) como almacén; despachar (−1) y verificar que el siguiente despacho de la misma solicitud falla con HTTP 409.
7. Ir a calidad, rechazar con causa; confirmar regreso a taller y existencia de tarea de retrabajo. Completarla y reenviar a calidad.
8. Aprobar calidad, completar lavado, confirmar retorno y entregar; verificar eventos y datos de recepción.
9. Intentar saltarse estaciones o entregar sin lavado: HTTP 409/400. Intentar modificar orden entregada: error.
10. Guardar datos, reiniciar `docker compose restart`, confirmar persistencia de órdenes y adjuntos.
11. Exportar CSV de reportes y comprobar codificación UTF-8, columnas y apertura segura.
12. Hacer respaldo, restaurar en **servidor de prueba**, verificar datos y archivos. Probar expiración de sesión.
13. Revisar interfaz a 1366×768, móvil 390×844 y tableta 820×1180. Tablas pueden desplazarse horizontalmente.
14. Ejecutar análisis de dependencias (`npm audit`) en el VPS con conectividad y corregir vulnerabilidades antes de exponer datos reales.
15. Probar carga simultánea: dos operadores intentando despachar la última unidad; stock nunca negativo.

## Seguridad adicional para operación productiva

- Auditoría de roles y amenazas con datos del cliente real; antifraude y controles para pagos (no implementados).
- Políticas de conservación de archivos, privacidad, consentimientos e inspección antivirus de documentos.
- Recuperación de contraseña administrada, notificaciones internas y observabilidad.
- Auditoría de autorización documental de garantías y cumplimiento legal local.
