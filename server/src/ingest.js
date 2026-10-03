// Importa archivos que escribió rsyslog (LOGS_DIR/<ip>/<equipo>/<módulo>.log) a PostgreSQL. Sirve para cargar historial;
// la recepción en vivo la hace el colector de puertos del servidor (src/collector.js).
// Recuerda hasta qué byte leyó cada archivo, así puede apagarse y volver a encenderse sin repetir ni perder líneas.
// Uso: npm run ingest            (queda vigilando)
//      node src/ingest.js --once (lee lo pendiente y termina)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { parseLine } = require('./parser');
const { dayOf, ensurePartition } = require('./partitions');

const ROOT = path.resolve(process.env.LOGS_DIR || './logs');
const POLL_MS = Number(process.env.INGEST_POLL_MS) || 3000;
const BATCH = 500;

// _alertas.log repite líneas que ya están en los archivos por módulo; se omite para no duplicar.
const SKIP = new Set(['_alertas.log']);

function listLogFiles(dir) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listLogFiles(full));
    else if (e.name.endsWith('.log') && !SKIP.has(e.name)) out.push(full);
  }
  return out;
}

async function insertBatch(client, rel, rows) {
  if (!rows.length) return 0;
  const cols = 11;
  const params = [];
  const values = rows.map((r, i) => {
    params.push(r.ts, r.deviceTs, r.sourceIp, r.host, r.module, r.severity, r.category, r.summary,
      JSON.stringify(r.fields), r.message, r.raw);
    const b = i * cols;
    return `(${Array.from({ length: cols }, (_, k) => `$${b + k + 1}`).join(',')})`;
  });
  const res = await client.query(
    `INSERT INTO events (ts, device_ts, source_ip, host, module, severity, category, summary, fields, message, raw)
     VALUES ${values.join(',')}`,
    params
  );
  return res.rowCount;
}

async function processFile(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const size = fs.statSync(file).size;

  const st = await pool.query('SELECT byte_offset FROM ingest_state WHERE source_file = $1', [rel]);
  let offset = st.rows.length ? Number(st.rows[0].byte_offset) : 0;
  if (size < offset) offset = 0; // el archivo se rotó o se vació: empezar de nuevo
  if (size === offset) return { added: 0, skipped: 0 };

  const buf = Buffer.alloc(size - offset);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, offset); } finally { fs.closeSync(fd); }

  // Solo líneas completas: lo que quede sin salto de línea se lee en la próxima vuelta
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl === -1) return { added: 0, skipped: 0 };
  const chunk = buf.subarray(0, lastNl + 1);

  const rows = [];
  let skipped = 0;
  let pos = 0;
  while (pos < chunk.length) {
    const nl = chunk.indexOf(0x0a, pos);
    const line = chunk.toString('utf8', pos, nl);
    if (line.trim()) {
      const ev = parseLine(line);
      if (ev) rows.push({ ...ev, offset: offset + pos });
      else skipped += 1;
    }
    pos = nl + 1;
  }

  const client = await pool.connect();
  let added = 0;
  try {
    await client.query('BEGIN');
    for (const day of new Set(rows.map((r) => dayOf(r.ts)))) await ensurePartition(day);
    for (let i = 0; i < rows.length; i += BATCH) added += await insertBatch(client, rel, rows.slice(i, i + BATCH));
    await client.query(
      `INSERT INTO ingest_state (source_file, byte_offset) VALUES ($1, $2)
       ON CONFLICT (source_file) DO UPDATE SET byte_offset = EXCLUDED.byte_offset, updated_at = now()`,
      [rel, offset + chunk.length]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  if (skipped) console.warn(`  ${rel}: ${skipped} línea(s) con formato desconocido, omitidas`);
  return { added, skipped };
}

async function scan() {
  let added = 0;
  for (const f of listLogFiles(ROOT)) {
    try { added += (await processFile(f)).added; } catch (e) { console.error(`Error en ${f}: ${e.message}`); }
  }
  return added;
}

async function main() {
  console.log(`Leyendo logs de ${ROOT}`);
  const once = process.argv.includes('--once');
  let n = await scan();
  console.log(`${n} evento(s) nuevo(s).`);
  if (once) return pool.end();
  console.log(`Vigilando cambios cada ${POLL_MS / 1000} s. Ctrl+C para salir.`);
  const loop = async () => {
    try {
      n = await scan();
      if (n) console.log(`${new Date().toLocaleTimeString()}  +${n} evento(s)`);
    } catch (e) { console.error(e.message); }
    setTimeout(loop, POLL_MS);
  };
  setTimeout(loop, POLL_MS);
  return null;
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
