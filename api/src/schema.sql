CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin','manager','reception','chief','technician','parts','quality','wash','driver','warranty','auditor')),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS clients (id uuid PRIMARY KEY, name text NOT NULL, phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', document text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS vehicles (id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id), plate text NOT NULL UNIQUE,
 vin text NOT NULL DEFAULT '', brand text NOT NULL, model text NOT NULL, year int, mileage int NOT NULL DEFAULT 0,
 warranty_until date, next_service_km int, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_vehicles_client ON vehicles(client_id);
-- Un enlace compartido por cliente y sus vehículos; no concede acceso al panel.
CREATE TABLE IF NOT EXISTS client_tracking (
 client_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
 token text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS appointments (id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id), vehicle_id uuid NOT NULL REFERENCES vehicles(id),
 scheduled_at timestamptz NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','arrived','cancelled')),
 notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS orders (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, code text UNIQUE,
 client_id uuid NOT NULL REFERENCES clients(id), vehicle_id uuid NOT NULL REFERENCES vehicles(id), created_by uuid REFERENCES users(id),
 type text NOT NULL CHECK (type IN ('maintenance','repair','warranty','diagnostic','accessories')),
 station smallint NOT NULL DEFAULT 1 CHECK (station BETWEEN 1 AND 6),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
 substatus text NOT NULL DEFAULT 'pending', priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
 summary text NOT NULL, inspection text NOT NULL DEFAULT '', diagnosis text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 location text NOT NULL DEFAULT 'Recepción', bay text NOT NULL DEFAULT '', assigned_to uuid REFERENCES users(id),
 mileage_in int NOT NULL DEFAULT 0, estimated_finish timestamptz,
 blocked_reason text NOT NULL DEFAULT '', quote_amount numeric(12,2) NOT NULL DEFAULT 0, quote_approved boolean NOT NULL DEFAULT false,
 quality_ok boolean NOT NULL DEFAULT false, quality_note text NOT NULL DEFAULT '', wash_ok boolean NOT NULL DEFAULT false,
 wash_note text NOT NULL DEFAULT '', returned_ok boolean NOT NULL DEFAULT false, delivery_recipient text NOT NULL DEFAULT '',
 delivery_note text NOT NULL DEFAULT '', reworks int NOT NULL DEFAULT 0, closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(status,station);
CREATE INDEX IF NOT EXISTS idx_orders_vehicle ON orders(vehicle_id);
CREATE TABLE IF NOT EXISTS tasks (id uuid PRIMARY KEY, order_id bigint NOT NULL REFERENCES orders(id), description text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
 assigned_to uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), done_at timestamptz);
CREATE INDEX IF NOT EXISTS idx_tasks_order ON tasks(order_id);
CREATE TABLE IF NOT EXISTS inventory (id uuid PRIMARY KEY, sku text NOT NULL UNIQUE, name text NOT NULL,
 category text NOT NULL DEFAULT 'General', stock int NOT NULL DEFAULT 0 CHECK(stock >= 0),
 min_stock int NOT NULL DEFAULT 3 CHECK (min_stock>=0), unit_price numeric(12,2) NOT NULL DEFAULT 0 CHECK(unit_price>=0),
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS parts_requests (id uuid PRIMARY KEY, order_id bigint NOT NULL REFERENCES orders(id), item_id uuid NOT NULL REFERENCES inventory(id),
 quantity int NOT NULL CHECK (quantity>0), status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','fulfilled','rejected')),
 requested_by uuid REFERENCES users(id), fulfilled_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), fulfilled_at timestamptz);
CREATE INDEX IF NOT EXISTS idx_parts_requests_order ON parts_requests(order_id);
CREATE TABLE IF NOT EXISTS inventory_movements (id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES inventory(id), order_id bigint REFERENCES orders(id),
 delta int NOT NULL, reason text NOT NULL, actor_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS warranties (id uuid PRIMARY KEY, vehicle_id uuid NOT NULL REFERENCES vehicles(id),
 state text NOT NULL DEFAULT 'review' CHECK (state IN ('review','eligible','not_eligible')),
 policy text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', last_service_km int NOT NULL DEFAULT 0,
 reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_warranties_vehicle ON warranties(vehicle_id);
CREATE TABLE IF NOT EXISTS attachments (id uuid PRIMARY KEY, order_id bigint NOT NULL REFERENCES orders(id), stored_name text NOT NULL UNIQUE,
 original_name text NOT NULL, mime text NOT NULL, size int NOT NULL, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_events (id uuid PRIMARY KEY, order_id bigint REFERENCES orders(id), actor_id uuid REFERENCES users(id),
 event_type text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_audit_order ON audit_events(order_id,created_at);
-- Borradores: clientes y vehículos eliminados se conservan y pueden restaurarse.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
-- Tasa oficial del BCV (una fila por fecha valor) y montos cobrados al entregar en US$ y Bs.
CREATE TABLE IF NOT EXISTS exchange_rates (rate_date date PRIMARY KEY, usd numeric(18,8) NOT NULL CHECK (usd>0), eur numeric(18,8),
 source text NOT NULL DEFAULT 'BCV', set_by uuid REFERENCES users(id), fetched_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE orders ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_usd numeric(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_ves numeric(20,2);
-- Pedidos de piezas: rastreo desde el pedido al proveedor hasta la entrega en el departamento, ligado al vehículo y a su orden.
CREATE TABLE IF NOT EXISTS part_orders (id uuid PRIMARY KEY, seq bigserial UNIQUE, description text NOT NULL, part_number text NOT NULL DEFAULT '',
 quantity int NOT NULL DEFAULT 1 CHECK (quantity>0), supplier text NOT NULL DEFAULT '', department text NOT NULL,
 vehicle_id uuid REFERENCES vehicles(id), order_id bigint REFERENCES orders(id), responsible_id uuid REFERENCES users(id), requested_by uuid REFERENCES users(id),
 expected_at date, warranty boolean NOT NULL DEFAULT false, warranty_ref text NOT NULL DEFAULT '', carrier text NOT NULL DEFAULT '', tracking text NOT NULL DEFAULT '',
 cost_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost_usd>=0),
 status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','in_transit','received','delivered','cancelled')),
 delivered_to text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', received_at timestamptz, delivered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_part_orders_vehicle ON part_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_part_orders_order ON part_orders(order_id);
-- Fotos (perfil del cliente, vehículo y placa); el archivo vive en el volumen de cargas.
CREATE TABLE IF NOT EXISTS media (id uuid PRIMARY KEY, stored_name text NOT NULL UNIQUE, mime text NOT NULL, size int NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
-- Autorregistro de clientes por QR: queda pendiente hasta que recepción lo acepta (crea o enlaza cliente y vehículo) o lo rechaza.
CREATE TABLE IF NOT EXISTS client_registrations (id uuid PRIMARY KEY, seq bigserial UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
 name text NOT NULL, phone text NOT NULL, email text NOT NULL DEFAULT '', document text NOT NULL DEFAULT '',
 plate text NOT NULL, brand text NOT NULL, model text NOT NULL, year int, mileage int, problem text NOT NULL,
 profile_photo uuid REFERENCES media(id), vehicle_photo uuid REFERENCES media(id), plate_photo uuid REFERENCES media(id),
 client_id uuid REFERENCES clients(id), vehicle_id uuid REFERENCES vehicles(id), order_id bigint REFERENCES orders(id),
 review_note text NOT NULL DEFAULT '', reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_client_registrations_status ON client_registrations(status,created_at);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS photo_id uuid REFERENCES media(id);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS photo_id uuid REFERENCES media(id);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS plate_photo_id uuid REFERENCES media(id);
-- Cada evento guarda su hora real (no la del inicio de la transacción) para ordenar bien los pasos de un mismo guardado.
ALTER TABLE audit_events ALTER COLUMN created_at SET DEFAULT clock_timestamp();
-- Autorregistro (segunda revisión): miniaturas, autorización guardada, reintentos sin duplicar, identidad decidida y retención de fotos.
ALTER TABLE media ADD COLUMN IF NOT EXISTS thumb_name text;
ALTER TABLE media ADD COLUMN IF NOT EXISTS width int;
ALTER TABLE media ADD COLUMN IF NOT EXISTS height int;
ALTER TABLE client_registrations ADD COLUMN IF NOT EXISTS submission_key uuid;
ALTER TABLE client_registrations ADD COLUMN IF NOT EXISTS content_hash text NOT NULL DEFAULT '';
ALTER TABLE client_registrations ADD COLUMN IF NOT EXISTS consent_version text NOT NULL DEFAULT '';
ALTER TABLE client_registrations ADD COLUMN IF NOT EXISTS consent_text text NOT NULL DEFAULT '';
ALTER TABLE client_registrations ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE client_registrations ADD COLUMN IF NOT EXISTS relation text NOT NULL DEFAULT '';
ALTER TABLE client_registrations ADD COLUMN IF NOT EXISTS applied_updates jsonb NOT NULL DEFAULT '{}';
ALTER TABLE client_registrations ADD COLUMN IF NOT EXISTS photos_purged_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS client_registrations_submission_key ON client_registrations(submission_key);
-- Persona que trae el vehículo cuando no es el propietario (autorizado).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dropoff_name text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dropoff_phone text NOT NULL DEFAULT '';
-- Configuración compartida por todo el taller (por ejemplo, la dirección pública del QR).
CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value text NOT NULL, updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now());
-- Búsqueda de coincidencias por teléfono (últimos 10 dígitos) y cédula normalizada.
CREATE INDEX IF NOT EXISTS idx_clients_phone_key ON clients ((right(regexp_replace(phone,'\D','','g'),10)));
CREATE INDEX IF NOT EXISTS idx_clients_document_key ON clients ((regexp_replace(upper(document),'[^A-Z0-9]','','g')));
-- Una sola OT abierta por vehículo y una sola placa aunque cambien guiones o espacios. Si ya hubiera duplicados el índice
-- no se crea (queda un aviso en el registro de la base) y la API sigue impidiendo nuevos con bloqueos.
DO $$BEGIN
 IF NOT EXISTS (SELECT 1 FROM orders WHERE status='open' GROUP BY vehicle_id HAVING count(*)>1) THEN
  CREATE UNIQUE INDEX IF NOT EXISTS orders_one_open_per_vehicle ON orders(vehicle_id) WHERE status='open';
 ELSE RAISE NOTICE 'Hay vehículos con más de una OT abierta: no se crea orders_one_open_per_vehicle'; END IF;
 IF NOT EXISTS (SELECT 1 FROM vehicles GROUP BY regexp_replace(upper(plate),'[^A-Z0-9]','','g') HAVING count(*)>1) THEN
  CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plate_norm_key ON vehicles((regexp_replace(upper(plate),'[^A-Z0-9]','','g')));
 ELSE RAISE NOTICE 'Hay placas repetidas al normalizarlas: no se crea vehicles_plate_norm_key'; END IF;
END$$;
-- Movimientos encadenados (mapa, tablero, ficha): cada operación guardada, con todos sus pasos en una sola transacción.
-- Un reintento con el mismo id (respuesta perdida) devuelve el resultado guardado sin repetir pasos ni eventos.
CREATE TABLE IF NOT EXISTS order_operations (id uuid PRIMARY KEY, order_id bigint NOT NULL REFERENCES orders(id), actor_id uuid REFERENCES users(id),
 steps jsonb NOT NULL DEFAULT '[]', result jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_order_operations_order ON order_operations(order_id,created_at);
