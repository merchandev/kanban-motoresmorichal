# Inventario actual de rutas

Generado a partir de `api/src/index.cjs` el 15 de octubre de 2026.
Las capacidades de órdenes y piezas se definen en `api/src/shared.cjs` y se devuelven con la identidad de sesión. La columna indica el middleware visible; las reglas por rol, estado, identidad y operación se comprueban además dentro del controlador.

| Método | Ruta | Acceso inicial |
|---|---|---|
| GET | `/health` | Público |
| GET | `/api/health` | Público |
| POST | `/api/auth/login` | Público |
| GET | `/api/public/registration-config` | Público |
| POST | `/api/public/registrations` | Público |
| GET | `/api/auth/me` | Sesión; ver comprobaciones del controlador |
| POST | `/api/auth/logout` | Sesión; ver comprobaciones del controlador |
| POST | `/api/auth/password` | Sesión; ver comprobaciones del controlador |
| GET | `/api/users` | Sesión + `read` |
| POST | `/api/users` | Sesión + `admin` |
| PATCH | `/api/users/:id` | Sesión + `admin` |
| GET | `/api/clients` | Sesión + `read` |
| POST | `/api/clients` | Sesión + `people` |
| PATCH | `/api/clients/:id` | Sesión + `people` |
| GET | `/api/vehicles` | Sesión + `read` |
| POST | `/api/vehicles` | Sesión + `people` |
| PATCH | `/api/vehicles/:id` | Sesión + `people` |
| DELETE | `/api/clients/:id` | Sesión + `people` |
| DELETE | `/api/vehicles/:id` | Sesión + `people` |
| GET | `/api/trash` | Sesión + `people` |
| POST | `/api/clients/:id/restore` | Sesión + `people` |
| POST | `/api/vehicles/:id/restore` | Sesión + `people` |
| DELETE | `/api/clients/:id/purge` | Sesión + `admin` |
| DELETE | `/api/vehicles/:id/purge` | Sesión + `admin` |
| GET | `/api/vehicles/:id/history` | Sesión + `read` |
| GET | `/api/part-orders` | Sesión + `read` |
| GET | `/api/part-orders/:id/events` | Sesión + `read` |
| POST | `/api/part-orders` | Sesión; ver comprobaciones del controlador |
| PATCH | `/api/part-orders/:id` | Sesión; ver comprobaciones del controlador |
| POST | `/api/part-orders/:id/status` | Sesión; ver comprobaciones del controlador |
| GET | `/api/media/:id` | Sesión + `read` |
| GET | `/api/settings/registration-url` | Sesión + `people` |
| PUT | `/api/settings/registration-url` | Sesión + `people` |
| GET | `/api/registrations/summary` | Sesión + `people` |
| GET | `/api/registrations` | Sesión + `people` |
| GET | `/api/registrations/:id` | Sesión + `people` |
| POST | `/api/registrations/:id/accept` | Sesión + `people` |
| POST | `/api/registrations/:id/reject` | Sesión + `people` |
| GET | `/api/appointments` | Sesión + `read` |
| POST | `/api/appointments` | Sesión + `orders` |
| PATCH | `/api/appointments/:id` | Sesión + `orders` |
| GET | `/api/orders` | Sesión + `read` |
| GET | `/api/orders/:id` | Sesión + `read` |
| POST | `/api/orders` | Sesión + `orders` |
| POST | `/api/orders/:id/assign` | Sesión + `assign` |
| PATCH | `/api/orders/:id/notes` | Sesión + `work` |
| POST | `/api/orders/:id/tasks` | Sesión + `work` |
| PATCH | `/api/tasks/:id` | Sesión + `work` |
| POST | `/api/orders/:id/block` | Sesión + `work` |
| POST | `/api/orders/:id/unblock` | Sesión + `work` |
| POST | `/api/orders/:id/quote` | Sesión + `quote` |
| POST | `/api/orders/:id/transition` | Sesión; ver comprobaciones del controlador |
| POST | `/api/orders/:id/move` | Sesión; ver comprobaciones del controlador |
| GET | `/api/inventory` | Sesión + `read` |
| POST | `/api/inventory` | Sesión + `inventory` |
| POST | `/api/inventory/:id/adjust` | Sesión + `inventory` |
| GET | `/api/parts-requests` | Sesión + `read` |
| POST | `/api/orders/:id/parts` | Sesión + `parts` |
| POST | `/api/parts-requests/:id/fulfill` | Sesión; ver comprobaciones del controlador |
| POST | `/api/parts-requests/:id/reject` | Sesión; ver comprobaciones del controlador |
| GET | `/api/warranties` | Sesión + `read` |
| POST | `/api/warranties` | Sesión + `warranty` |
| PATCH | `/api/warranties/:id` | Sesión + `warranty` |
| POST | `/api/orders/:id/attachments` | Sesión + `orders` |
| GET | `/api/attachments/:id` | Sesión + `read` |
| GET | `/api/audit` | Sesión + `audit` |
| GET | `/api/exchange-rate` | Sesión + `read` |
| POST | `/api/exchange-rate/refresh` | Sesión + `read` |
| PUT | `/api/exchange-rate` | Sesión; ver comprobaciones del controlador |
| GET | `/api/reports/finance` | Sesión + `reports` |
| GET | `/api/reports` | Sesión + `reports` |
| GET | `/api/reports/orders.csv` | Sesión + `reports` |

Total: 72 rutas. Mantener este inventario sincronizado cuando se añadan rutas.
