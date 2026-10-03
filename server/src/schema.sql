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
