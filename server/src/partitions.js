// La tabla `events` se particiona por día (zona horaria APP_TIMEZONE). Así borrar un día completo es un DROP:
// instantáneo y libera el espacio en disco de inmediato (un DELETE masivo no lo haría).
const pool = require('./db');

const TZ = process.env.APP_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

const dayOf = (date) => DAY_FMT.format(date); // 'YYYY-MM-DD' en la zona configurada
const nameOf = (day) => `events_${day.replace(/-/g, '')}`;
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const known = new Set();

async function ensurePartition(day) {
  if (known.has(day)) return;
  if (!isDay(day)) throw new Error(`Día no válido: ${day}`);
  const { rows } = await pool.query(
    `SELECT ($1::date)::timestamp AT TIME ZONE $2 AS lo, (($1::date) + 1)::timestamp AT TIME ZONE $2 AS hi`,
    [day, TZ]
  );
  const lo = new Date(rows[0].lo).toISOString();
  const hi = new Date(rows[0].hi).toISOString();
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${nameOf(day)} PARTITION OF events FOR VALUES FROM ('${lo}') TO ('${hi}')`);
  } catch (e) {
    if (e.code !== '42P07') throw e; // otro proceso la creó al mismo tiempo
  }
  known.add(day);
}

async function listDays() {
  const { rows } = await pool.query(
    `SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes, COALESCE(s.n_live_tup, 0) AS rows
     FROM pg_inherits i
     JOIN pg_class c ON c.oid = i.inhrelid
     JOIN pg_class p ON p.oid = i.inhparent AND p.relname = 'events'
     LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE c.relname ~ '^events_[0-9]{8}$'
     ORDER BY c.relname DESC`
  );
  return rows.map((r) => ({
    day: `${r.name.slice(7, 11)}-${r.name.slice(11, 13)}-${r.name.slice(13, 15)}`,
    bytes: Number(r.bytes),
    rows: Number(r.rows),
  }));
}

async function dropDay(day) {
  if (!isDay(day)) throw new Error('Día no válido.');
  await pool.query(`DROP TABLE IF EXISTS ${nameOf(day)}`);
  known.delete(day);
}

// Crea la tabla de eventos particionada. Si existe una versión anterior sin particiones, traslada sus filas.
async function setupEvents() {
  const exists = await pool.query("SELECT to_regclass('public.events') AS t");
  let legacy = false;
  if (exists.rows[0].t) {
    const part = await pool.query(
      "SELECT 1 FROM pg_partitioned_table WHERE partrelid = 'public.events'::regclass"
    );
    if (part.rowCount) {
      await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS type_key TEXT');
      await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS pending BOOLEAN NOT NULL DEFAULT FALSE');
      await pool.query('CREATE INDEX IF NOT EXISTS events_pending_idx ON events (client_id, type_key) WHERE pending');
      return { migrated: 0 };
    }
    legacy = true;
    await pool.query('ALTER TABLE events RENAME TO events_legacy');
    await pool.query('ALTER INDEX IF EXISTS events_ts_idx RENAME TO events_legacy_ts_idx');
    await pool.query('ALTER INDEX IF EXISTS events_source_ts_idx RENAME TO events_legacy_source_ts_idx');
    await pool.query('ALTER INDEX IF EXISTS events_module_idx RENAME TO events_legacy_module_idx');
    await pool.query('ALTER INDEX IF EXISTS events_attention_idx RENAME TO events_legacy_attention_idx');
  }

  await pool.query(`
    CREATE TABLE events (
      id           BIGSERIAL,
      ts           TIMESTAMPTZ NOT NULL,        -- hora en que el servidor recibió el mensaje
      device_ts    TIMESTAMP,                   -- hora que reporta el equipo (sin zona)
      source_ip    TEXT NOT NULL,               -- IP que envió el log
      host         TEXT,                        -- nombre del equipo, ej. ER7206
      client_id    INTEGER,                     -- cliente (puerto) por donde llegó; NULL si vino de un archivo importado
      port         INTEGER,                     -- puerto de escucha por el que entró
      module       TEXT NOT NULL,               -- dhcp_server, ip_conflict, firewall, otros...
      severity     SMALLINT,                    -- nivel syslog 0-7
      category     TEXT NOT NULL,
      summary      TEXT NOT NULL,
      fields       JSONB NOT NULL DEFAULT '{}',
      message      TEXT NOT NULL,
      raw          TEXT NOT NULL,
      acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
      type_key     TEXT,                        -- firma del tipo de log (módulo o firma de un tipo nuevo)
      pending      BOOLEAN NOT NULL DEFAULT FALSE, -- true = tipo nuevo esperando aprobación; no sale en las vistas normales
      PRIMARY KEY (ts, id)
    ) PARTITION BY RANGE (ts)`);
  await pool.query('CREATE INDEX events_id_idx ON events (id)');
  await pool.query('CREATE INDEX events_source_ts_idx ON events (source_ip, ts DESC)');
  await pool.query('CREATE INDEX events_client_ts_idx ON events (client_id, ts DESC)');
  await pool.query('CREATE INDEX events_module_idx ON events (module)');
  await pool.query('CREATE INDEX events_attention_idx ON events (ts DESC) WHERE severity <= 4 AND NOT acknowledged');
  await pool.query('CREATE INDEX events_pending_idx ON events (client_id, type_key) WHERE pending');

  let migrated = 0;
  if (legacy) {
    const days = await pool.query("SELECT DISTINCT to_char(ts AT TIME ZONE $1, 'YYYY-MM-DD') AS d FROM events_legacy", [TZ]);
    for (const r of days.rows) await ensurePartition(r.d);
    const res = await pool.query(
      `INSERT INTO events (ts, device_ts, source_ip, host, module, severity, category, summary, fields, message, raw, acknowledged)
       SELECT ts, device_ts, source_ip, host, module, severity, category, summary, fields, message, raw, acknowledged FROM events_legacy`
    );
    migrated = res.rowCount;
    await pool.query('DROP TABLE events_legacy');
  }
  await ensurePartition(dayOf(new Date()));
  return { migrated };
}

module.exports = { TZ, dayOf, ensurePartition, listDays, dropDay, setupEvents, isDay };
