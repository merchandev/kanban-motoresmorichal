# Arquitectura y reglas del dominio

**Monolito modular para MVP de una sede**: navegador React ↔ Caddy HTTPS ↔ Express API (red interna) ↔ PostgreSQL (red interna), con volumen privado para adjuntos. Código de UI separado de persistencia. No se conecta a software externo.

## Seis estaciones

1. **Recepción**: OT con inspección. Para garantía, expediente declarado elegible. Recepción transfiere.
2. **Traslado**: conductor confirma llegada al taller.
3. **Taller**: jefe asigna técnico/puesto, checklist, diagnóstico, solicitudes, presupuestos internos. No se avanza con bloqueos, tareas pendientes, ausencia de técnico o solicitudes de piezas pendientes.
4. **Calidad**: calidad aprueba con nota o rechaza con nota. El rechazo crea tarea y devuelve a estación 3.
5. **Lavado**: responsable certifica con nota.
6. **Entrega**: conductor confirma retorno; recepción anota destinatario y cierra, siempre que calidad, lavado y retorno estén confirmados.

Estados transversales (`substatus`) NO son columnas Kanban: `pending`, `active`, `waiting_parts`, `waiting_approval`, `waiting_bay`, `paused`, `rework`, `ready`.

## Entidades

- users, sessions
- clients, vehicles, appointments
- orders, tasks, audit_events, attachments
- inventory, parts_requests, inventory_movements
- warranties

Las relaciones están implementadas en `api/src/schema.sql`. Todas las escrituras parametrizan valores SQL; los eventos de OT/stock se registran. Las operaciones de despacho se protegen con transacciones y condición `stock >= quantity`. El número OT proviene de identidad de PostgreSQL, por lo que puede haber saltos después de fallos o anulaciones; **no se reciclan códigos** para preservar trazabilidad.

## Consideraciones de despliegue

- Caddy emite certificados con dominio válido; para HTTP en pruebas `COOKIE_SECURE=false`.
- Los `*.local` son cuentas de demo, no correos reales.
- `.env` contiene secretos: permiso 600, nunca commit.
- Separar entornos demo/piloto/producción; evitar datos reales en demo.
- Se recomienda respaldar BD y adjuntos a un destino externo cifrado, añadir métricas de errores, escaneo de vulnerabilidades y plan de actualizaciones.
