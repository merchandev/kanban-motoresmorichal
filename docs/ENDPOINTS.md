# API privada v1 (misma URL del frontend bajo `/api`)

> Esta tabla conserva el alcance inicial del MVP. Consultar [ENDPOINTS_ACTUALES.md](ENDPOINTS_ACTUALES.md) para el inventario de esta versión, incluidos registro público, movimientos y piezas.

Autenticación basada en cookie HttpOnly y rechazo de solicitudes mutables desde Origin de otro host. Respuestas JSON salvo descarga de archivo/CSV. Las rutas exigen sesión excepto login y health.

| Método | Ruta | Uso | Permiso |
|---|---|---|---|
| POST | /auth/login | Inicio de sesión | Público |
| GET | /auth/me | Identidad | Sesión |
| POST | /auth/logout | Salida | Sesión |
| POST | /auth/password | Actualizar contraseña | Sesión |
| GET/POST | /clients | Lista / alta | read / people |
| PATCH | /clients/:id | Editar | people |
| GET/POST | /vehicles | Lista / alta | read / people |
| PATCH | /vehicles/:id | Kilometraje y garantía | people |
| GET/POST | /appointments | Lista / alta | read / orders |
| PATCH | /appointments/:id | Estado | orders |
| GET/POST | /orders | Lista / alta | read / orders |
| GET | /orders/:id | Expediente con tareas, piezas, archivos, eventos | read |
| POST | /orders/:id/assign | Asignar puesto/técnico | assign |
| PATCH | /orders/:id/notes | Diagnóstico | work |
| POST | /orders/:id/tasks | Agregar tarea | work |
| PATCH | /tasks/:id | Avance de tarea | work |
| POST | /orders/:id/block | Pausa con motivo | work |
| POST | /orders/:id/unblock | Desbloqueo condicionado | work |
| POST | /orders/:id/quote | Presupuesto/registro aprobación | quote |
| POST | /orders/:id/transition | Cambiar estación | Permiso según acción |
| POST | /orders/:id/move | Movimiento encadenado en una sola transacción (presupuesto, desbloqueo, asignación, tareas y transiciones) | Permiso de cada paso |
| GET/POST | /inventory | Catálogo / nuevo | read / inventory |
| POST | /inventory/:id/adjust | Ajustar entradas/salidas | inventory |
| GET | /parts-requests | Requisiciones | read |
| POST | /orders/:id/parts | Solicitar pieza | parts |
| POST | /parts-requests/:id/fulfill | Despachar pieza | Almacén, admin o gerencia |
| POST | /parts-requests/:id/reject | Rechazar pieza | Almacén, admin o gerencia |
| GET/POST | /warranties | Consulta / alta | read / warranty |
| PATCH | /warranties/:id | Evaluar expediente | warranty |
| POST | /orders/:id/attachments | Subir archivo `file` multipart | orders |
| GET | /attachments/:id | Descargar protegido | read |
| GET/POST | /users | Lista / alta | read / admin |
| PATCH | /users/:id | Cambiar rol/acceso/nombre | admin |
| GET | /reports | Métricas | reports |
| GET | /reports/orders.csv | Exportación | reports |
| GET | /audit | Bitácora | audit |
| GET | /vehicles/:id/history | Historial completo del vehículo (eventos de órdenes, piezas y registro) | read |
| GET/POST | /part-orders | Pedidos de piezas (cada uno con `actions` del usuario) / registrar pedido | read / `request` |
| PATCH | /part-orders/:id | Editar datos; cambiar vehículo u orden es una transferencia con `reason` | `edit` (entregada o cancelada: `correct` con `reason`) |
| POST | /part-orders/:id/status | Cambiar estado (en tránsito, recibida, entregada, cancelada) | Según el cambio (ver matriz) |
| GET | /part-orders/:id/events | Bitácora de la pieza | read |
| GET | /public/registration-config | Texto y versión vigentes de la autorización del formulario | Público |
| POST | /public/registrations | Autorregistro por QR (multipart, fotos `profile_photo`, `vehicle_photo`, `plate_photo`) | Público, con límites |
| GET | /registrations | Bandeja paginada: `status`, `q`, `limit` (≤100), `offset`; devuelve `total` y `counts` | people |
| GET | /registrations/summary | Pendientes y últimos registros (para el contador y los avisos) | people |
| GET | /registrations/:id | Detalle con candidatos por placa, teléfono y cédula | people |
| POST | /registrations/:id/accept | Aceptar con identidad explícita (`new`, `existing`, `owner`, `authorized`) | people |
| POST | /registrations/:id/reject | Rechazar con motivo | people |
| GET | /media/:id | Foto protegida (`?size=thumb` para miniatura), sin caché | read |
| GET/PUT | /settings/registration-url | Dirección pública del QR para todo el taller | people / admin o gerencia |

**Autorregistro por QR.** `POST /public/registrations` exige `consent=true` y la `consent_version` vigente (se guardan versión, texto y hora). Una `submission_key` (UUID) hace el envío idempotente: repetirla con el mismo contenido devuelve el mismo código; con otro contenido, 409. Las fotos se decodifican en el servidor (JPEG, PNG o WebP; máx. 6 MB cada una, 12 MB en total y 40 MP), se guardan re-codificadas sin metadatos y con miniatura. Límites configurables por entorno: `REGISTRATION_BURST_PER_MIN` (6), `REGISTRATION_PER_HOUR` (60), `REGISTRATION_PARALLEL` (3), `MEDIA_QUOTA_MB` (5120) y `REG_REJECTED_PHOTO_DAYS` (30); solo cuentan los envíos aceptados.

**Aceptar un registro.** Si la placa ya existe, `identity` debe ser `owner` (se aplican solo los campos de `updates`: `name`, `phone`, `email`, `document`, `photo`) o `authorized` (no cambia la ficha del propietario; la persona queda en `orders.dropoff_name`). Sin placa conocida, `existing` con `client_id` de un candidato, o `new`. `vehicle_updates` admite `photo`, `plate_photo` y `mileage`. Hay una sola OT abierta por vehículo (índice único parcial `orders_one_open_per_vehicle`) y una placa por vehículo aunque cambien guiones o espacios (`vehicles_plate_norm_key`).

**Conservación de fotos.** Cada 6 horas se quitan las fotos de los registros rechazados con más de `REG_REJECTED_PHOTO_DAYS` días y se borran las fotos que ya no usa ninguna ficha ni registro. Las de registros aceptados se conservan como evidencia.

**Movimiento encadenado.** `POST /orders/:id/move` recibe `{operation_id (UUID), from, to, steps}`; cada paso es `{kind:'quote', amount}`, `{kind:'unblock', reason}`, `{kind:'assign', assigned_to, bay}`, `{kind:'tasks', task_ids, work_done}` o una transición `{action, note, station}` (`to_transfer`, `to_workshop`, `to_quality`, `quality_pass`, `quality_reject`, `wash_complete`, `revert`). Todos los pasos se aplican en una transacción con las mismas validaciones que las rutas sueltas: si uno falla no se guarda ninguno. Repetir el mismo `operation_id` devuelve el resultado guardado (`repeated: true`) sin repetir pasos ni eventos. La API responde 409 si la orden ya no está en `from`, si cambió el monto o el bloqueo confirmados, si hay tareas pendientes que no estaban en `task_ids` o si el plan no termina en `to`. Cada evento del movimiento lleva `operation` en su detalle.

**Pedidos de piezas: permisos y estados.** Gerencia y administración pueden todo. `request` (registrar): mecánico, jefe de taller, almacén y garantías. `edit`, `transit` (en tránsito) y `cancel`: almacén y garantías. `receive` (recepción) y `deliver` (entrega al departamento): almacén. Garantías solo actúa sobre piezas por garantía. Cambios ordinarios: pedida → en tránsito, recibida o cancelada; en tránsito → recibida o cancelada; recibida → entregada o cancelada. Cualquier otro (volver atrás, reabrir una entregada o cancelada, entregar sin recepción) es `correct`: solo gerencia o administración, con `note` obligatoria; la bitácora guarda en `previous` la recepción o entrega anteriores. `/auth/me` devuelve `part_actions` y cada pedido de `GET /part-orders` trae `actions: {edit, status:[{to, action}]}`, que la página Piezas usa para mostrar sus botones. Cambiar el vehículo o la orden registra `part.transferred` (origen, destino, estado y motivo), visible en el historial de ambos vehículos y en la orden anterior; el historial de un vehículo incluye la trayectoria completa de las piezas que tiene o tuvo.

Acciones de transición: `to_transfer`, `to_workshop`, `to_quality`, `quality_pass` (nota), `quality_reject` (nota), `wash_complete` (nota), `return_confirm`, `deliver` (destinatario), `cancel` (motivo, gerencia/admin).

**NOTA:** `POST /auth/password` requiere `previous` y `next`, contraseña nueva de mínimo 12 caracteres. Los errores retornan `{ "error": "mensaje" }`.
