CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role          TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'operador', 'lector')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

-- Cada cliente (sitio/equipo) envía sus logs a un puerto propio. El puerto es su identificador.
-- La tabla de eventos (particionada por día) la crea src/partitions.js.
CREATE TABLE IF NOT EXISTS clients_ports (
  id           SERIAL PRIMARY KEY,
  client_name  TEXT NOT NULL,
  port_number  INTEGER NOT NULL CHECK (port_number BETWEEN 1 AND 65535),
  protocol     TEXT NOT NULL CHECK (protocol IN ('udp', 'tcp')),
  is_active    BOOLEAN NOT NULL DEFAULT FALSE,   -- encendido/apagado: el puerto se abre o se cierra
  allowed_ips  TEXT[],                           -- si se define, solo se aceptan logs de estas IP
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ,
  UNIQUE (port_number, protocol)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id       BIGSERIAL PRIMARY KEY,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action   TEXT NOT NULL,
  detail   JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log (ts DESC);

-- Solo para importar archivos de rsyslog con `npm run ingest`: hasta dónde se leyó cada archivo.
CREATE TABLE IF NOT EXISTS ingest_state (
  source_file TEXT PRIMARY KEY,
  byte_offset BIGINT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tipos de log que el sistema no reconocía. Cada uno espera la decisión de un administrador:
--   pending  = sus eventos se guardan pero no aparecen en las vistas normales
--   approved = se muestran con la categoría elegida
--   rejected = se descartan al llegar
CREATE TABLE IF NOT EXISTS log_types (
  id                 SERIAL PRIMARY KEY,
  client_id          INTEGER NOT NULL REFERENCES clients_ports(id) ON DELETE CASCADE,
  type_key           TEXT NOT NULL,
  label              TEXT NOT NULL,
  suggested_category TEXT NOT NULL,
  category           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  event_count        BIGINT NOT NULL DEFAULT 0,
  sample             TEXT,
  first_seen         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  UNIQUE (client_id, type_key)
);
CREATE INDEX IF NOT EXISTS log_types_status_idx ON log_types (status, last_seen DESC);

-- Reemplazado por el encendido/apagado de puertos
DROP TABLE IF EXISTS log_rules;

-- Problemas con inicio, fin y duración (internet caído, túnel VPN caído, conflicto de IP...). Los abre y cierra src/insights.js.
CREATE TABLE IF NOT EXISTS incidents (
  id              BIGSERIAL PRIMARY KEY,
  client_id       INTEGER NOT NULL REFERENCES clients_ports(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,        -- wan_offline, ipsec_down, ip_conflict, rogue_dhcp
  key             TEXT NOT NULL,        -- qué está afectado: WAN3, 10.10.0.33, 172.17.17.54...
  title           TEXT NOT NULL,
  severity        SMALLINT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  opened_at       TIMESTAMPTZ NOT NULL,
  last_seen       TIMESTAMPTZ NOT NULL,
  resolved_at     TIMESTAMPTZ,
  event_count     INTEGER NOT NULL DEFAULT 1,
  auto_close_secs INTEGER,              -- si se define, se cierra solo tras ese tiempo sin repetirse
  auto_closed     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS incidents_open_uq ON incidents (client_id, kind, key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS incidents_client_idx ON incidents (client_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status, opened_at DESC);

-- Desde qué IP pública ha enviado cada cliente (para avisar cuando cambia, por ejemplo al pasar a otro enlace)
CREATE TABLE IF NOT EXISTS client_ips (
  client_id  INTEGER NOT NULL REFERENCES clients_ports(id) ON DELETE CASCADE,
  ip         TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, ip)
);

-- Número de regla del firewall → nombre (lo informa el controlador al editar la ACL)
CREATE TABLE IF NOT EXISTS acl_names (
  entry_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Desde cuándo está encendido un puerto (para no alertar "sin señal" a un cliente que apenas se encendió)
ALTER TABLE clients_ports ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- Equipos que se han visto en la red de cada cliente (por su MAC), para avisar de equipos nuevos
CREATE TABLE IF NOT EXISTS client_devices (
  client_id  INTEGER NOT NULL REFERENCES clients_ports(id) ON DELETE CASCADE,
  mac        TEXT NOT NULL,
  ip         TEXT,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, mac)
);

-- Reglas de alerta por correo, creadas desde la web
CREATE TABLE IF NOT EXISTS alert_rules (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('incident', 'client_silent', 'events', 'firewall_blocks', 'new_device', 'spike', 'daily_summary')),
  client_id       INTEGER REFERENCES clients_ports(id) ON DELETE CASCADE,   -- NULL = todos los clientes
  params          JSONB NOT NULL DEFAULT '{}',
  recipients      TEXT[] NOT NULL,
  cooldown_min    INTEGER NOT NULL DEFAULT 60,        -- tiempo mínimo entre dos correos del mismo aviso
  notify_resolved BOOLEAN NOT NULL DEFAULT FALSE,     -- avisar también cuando el problema termina
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  cursor_id       BIGINT NOT NULL DEFAULT 0,          -- hasta qué evento ya revisó (reglas que miran eventos nuevos)
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fired      TIMESTAMPTZ
);

-- Qué avisos están activos en cada regla, para no repetir el mismo correo
CREATE TABLE IF NOT EXISTS alert_state (
  rule_id   INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  failed    BOOLEAN NOT NULL DEFAULT FALSE,
  last_sent TIMESTAMPTZ,
  PRIMARY KEY (rule_id, key)
);

-- Registro de cada correo enviado (o que falló)
CREATE TABLE IF NOT EXISTS alert_history (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  rule_id     INTEGER REFERENCES alert_rules(id) ON DELETE SET NULL,
  rule_name   TEXT NOT NULL,
  client_id   INTEGER,
  client_name TEXT,
  subject     TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('alert', 'resolved', 'test')),
  status      TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error       TEXT,
  recipients  TEXT[]
);
CREATE INDEX IF NOT EXISTS alert_history_ts_idx ON alert_history (ts DESC);
