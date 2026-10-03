const express = require('express');
const pool = require('./db');
const { auth, need } = require('./middleware');
const { PERMS } = require('./permissions');
const { sevKey, shape } = require('./shape');
const { incidentShape } = require('./incidents-api');

const router = express.Router();
const guard = (perm) => [auth, need(perm)];

const SEV_COND = {
  critical: 'e.severity <= 2',
  error: 'e.severity = 3',
  warning: 'e.severity = 4',
  info: '(e.severity >= 5 OR e.severity IS NULL)',
};
const SEV_CASE = "CASE WHEN severity <= 2 THEN 'critical' WHEN severity = 3 THEN 'error' WHEN severity = 4 THEN 'warning' ELSE 'info' END";
const FRESH = "ts >= now() - interval '24 hours' AND NOT pending";

function buildFilters(q) {
  const where = [];
  const params = [];
  const push = (v) => { params.push(v); return `$${params.length}`; };

  // Un rango exacto (desde/hasta) reemplaza al "últimas N horas". Sirve para abrir los eventos de un grupo.
  const since = q.since ? new Date(q.since) : null;
  const until = q.until ? new Date(q.until) : null;
  if (since && !Number.isNaN(since.getTime())) {
    where.push(`e.ts >= ${push(since)}`);
  } else {
    const hours = Math.min(Math.max(parseInt(q.hours, 10) || 24, 1), 24 * 365);
    where.push(`e.ts >= now() - make_interval(hours => ${push(hours)}::int)`);
  }
  if (until && !Number.isNaN(until.getTime())) where.push(`e.ts < ${push(until)}`);
  where.push('NOT e.pending'); // los tipos nuevos sin aprobar solo se ven en "Por aprobar"

  const sevs = String(q.sev || '').split(',').filter((s) => SEV_COND[s]);
  if (sevs.length) where.push(`(${sevs.map((s) => SEV_COND[s]).join(' OR ')})`);
  if (q.category) where.push(`e.category = ${push(String(q.category))}`);
  if (q.module) where.push(`e.module = ${push(String(q.module))}`);
  if (q.client && Number.isInteger(Number(q.client))) where.push(`e.client_id = ${push(Number(q.client))}`);
  if (q.ip) where.push(`e.source_ip LIKE ${push(`%${String(q.ip).trim().slice(0, 45).replace(/[\\%_]/g, '\\$&')}%`)}`);
  if (q.ack === '0') where.push('NOT e.acknowledged');

  const term = String(q.q || '').trim().slice(0, 100);
  if (term) {
    const p = push(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(e.summary ILIKE ${p} OR e.message ILIKE ${p} OR e.host ILIKE ${p} OR e.source_ip ILIKE ${p})`);
  }
  return { where, params, push };
}

const COLS = 'e.id, e.ts, e.source_ip, e.host, e.client_id, c.client_name, e.port, e.module, e.severity, e.category, e.summary, e.fields, e.message, e.raw, e.acknowledged, a.name AS acl_name';
// Para los eventos de firewall, "rule" es el número de la ACL; acl_names lo traduce a su nombre
const FROM = "events e LEFT JOIN clients_ports c ON c.id = e.client_id LEFT JOIN acl_names a ON a.entry_id = e.fields->>'rule'";

const GROUP_SECS = { 60: 60, 300: 300, 900: 900, 3600: 3600 };

// Eventos iguales (mismo cliente, tipo y mensaje) dentro de una misma ventana de tiempo, en una sola fila con su cantidad.
// Se guardan todos los eventos; esto solo cambia cómo se muestran.
async function listGrouped(req, res, secs) {
  const { where, params } = buildFilters(req.query);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const bucket = `to_timestamp(floor(extract(epoch FROM e.ts) / ${secs}) * ${secs})`;
  const w = where.join(' AND ');
  const { rows } = await pool.query(
    `SELECT ${bucket} AS bucket, e.client_id, max(c.client_name) AS client_name, e.module, e.summary, min(e.severity) AS severity,
            count(*) AS n, max(e.ts) AS last_ts, bool_and(e.acknowledged) AS acknowledged, max(e.category) AS category
     FROM events e LEFT JOIN clients_ports c ON c.id = e.client_id
     WHERE ${w}
     GROUP BY 1, e.client_id, e.module, e.summary
     ORDER BY 1 DESC, count(*) DESC
     LIMIT ${limit + 1} OFFSET ${offset}`,
    params
  );
  const out = {
    grouped: true,
    seconds: secs,
    hasMore: rows.length > limit,
    groups: rows.slice(0, limit).map((r) => ({
      bucket: r.bucket, until: new Date(new Date(r.bucket).getTime() + secs * 1000).toISOString(), lastTs: r.last_ts,
      clientId: r.client_id, clientName: r.client_name, module: r.module, summary: r.summary,
      level: r.severity, severity: sevKey(r.severity), category: r.category, count: Number(r.n), acknowledged: r.acknowledged,
    })),
  };
  if (offset === 0) {
    const c = await pool.query(
      `SELECT count(*) AS n FROM (SELECT 1 FROM events e WHERE ${w} GROUP BY ${bucket}, e.client_id, e.module, e.summary LIMIT 10001) t`,
      params
    );
    out.total = Number(c.rows[0].n);
  }
  res.json(out);
}

// ───────── Eventos ─────────
router.get('/events', guard('logs.view'), async (req, res) => {
  if (req.query.group !== undefined) {
    const secs = GROUP_SECS[Number(req.query.group)];
    if (!secs) return res.status(400).json({ error: 'Elige un agrupado válido: 1 min, 5 min, 15 min o 1 hora.' });
    return listGrouped(req, res, secs);
  }
  const { where, params, push } = buildFilters(req.query);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 200);
  const canRaw = PERMS[req.user.role].includes('logs.raw');

  const after = req.query.after !== undefined ? Number(req.query.after) : null;
  const beforeId = req.query.beforeId !== undefined ? Number(req.query.beforeId) : null;
  const beforeTs = req.query.beforeTs ? new Date(req.query.beforeTs) : null;
  if ((after !== null && !Number.isFinite(after)) || (beforeId !== null && !Number.isFinite(beforeId)) ||
      (beforeTs && Number.isNaN(beforeTs.getTime()))) {
    return res.status(400).json({ error: 'Parámetros de paginación no válidos.' });
  }

  const baseWhere = where.join(' AND ');
  const baseParams = params.slice();
  if (after !== null) where.push(`e.id > ${push(after)}`);
  if (beforeTs && beforeId !== null) where.push(`(e.ts, e.id) < (${push(beforeTs)}, ${push(beforeId)})`);

  const { rows } = await pool.query(
    `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')} ORDER BY e.ts DESC, e.id DESC LIMIT ${limit + 1}`,
    params
  );
  const out = { events: rows.slice(0, limit).map((r) => shape(r, canRaw)), hasMore: rows.length > limit };

  // Total solo en la primera página; se corta en 10.001 para no recorrer toda la tabla
  if (after === null && !beforeTs) {
    const c = await pool.query(`SELECT count(*) AS n FROM (SELECT 1 FROM events e WHERE ${baseWhere} LIMIT 10001) t`, baseParams);
    out.total = Number(c.rows[0].n);
  }
  res.json(out);
});

router.post('/events/ack', guard('logs.ack'), async (req, res) => {
  const { ids, clientId, module, summary } = req.body || {};
  let r;
  if (Array.isArray(ids) && ids.length) {
    const clean = ids.map(Number).filter(Number.isFinite).slice(0, 5000);
    r = await pool.query('UPDATE events SET acknowledged = TRUE WHERE id = ANY($1::bigint[]) AND NOT acknowledged', [clean]);
  } else if (module && summary) {
    // Marca todo un grupo (mismo cliente, tipo y mensaje) de las últimas 24 h, igual que la lista "Necesita atención"
    r = await pool.query(
      `UPDATE events SET acknowledged = TRUE
       WHERE client_id IS NOT DISTINCT FROM $1 AND module = $2 AND summary = $3 AND NOT acknowledged AND ${FRESH}`,
      [clientId ?? null, module, summary]
    );
  } else {
    return res.status(400).json({ error: 'Indica qué eventos marcar.' });
  }
  res.json({ updated: r.rowCount });
});

// Una celda que empieza con = + - @ se ejecutaría como fórmula al abrir el CSV en Excel. Los logs vienen de equipos
// externos, así que no son de fiar: se les antepone un apóstrofo para que se lean como texto.
const csvCell = (v) => {
  let s = String(v === null || v === undefined ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

router.get('/events/export', guard('logs.export'), async (req, res) => {
  const { where, params } = buildFilters(req.query);
  const canRaw = PERMS[req.user.role].includes('logs.raw');
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')} ORDER BY e.ts DESC, e.id DESC LIMIT 50000`,
    params
  );
  // En el firewall, las columnas que importan son otras: acción, origen, destino y puerto
  const fw = req.query.module === 'firewall';
  const head = [
    'Fecha (UTC)', 'Severidad', 'Tipo', 'Cliente', 'Puerto', 'IP origen',
    ...(fw ? ['Acción', 'Origen', 'Puerto origen', 'Destino', 'Puerto destino', 'Protocolo', 'Regla (ACL)'] : []),
    'Resumen', ...(canRaw ? ['Mensaje original'] : []),
  ];
  const lines = rows.map((r) => {
    const f = r.fields || {};
    return [
      new Date(r.ts).toISOString(), sevKey(r.severity), r.module, r.client_name, r.port, r.source_ip,
      ...(fw ? [f.action, f.src, f.sport, f.dst, f.dport, f.proto, r.acl_name || f.rule] : []),
      r.summary, ...(canRaw ? [r.message] : []),
    ].map(csvCell).join(',');
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="registros.csv"');
  res.send(`﻿${[head.map(csvCell).join(','), ...lines].join('\r\n')}`);
});

// ───────── Resumen ─────────
const SILENT_MIN = 15; // minutos sin recibir nada para considerar que un cliente perdió señal

router.get('/summary', guard('dashboard.view'), async (req, res) => {
  // Con ?client=ID el resumen es solo de ese cliente
  const cid = req.query.client !== undefined ? Number(req.query.client) : null;
  if (cid !== null && !Number.isInteger(cid)) return res.status(400).json({ error: 'Cliente no válido.' });
  const sc = cid !== null ? ' AND client_id = $1' : '';
  const sp = cid !== null ? [cid] : [];
  const [tot, cat, hourly, attention, pending, ports, incOpen, incList] = await Promise.all([
    pool.query(`SELECT ${SEV_CASE} AS sev, count(*) AS n FROM events WHERE ${FRESH}${sc} GROUP BY 1`, sp),
    pool.query(`SELECT category, count(*) AS n FROM events WHERE ${FRESH}${sc} GROUP BY 1 ORDER BY 2 DESC`, sp),
    pool.query(`SELECT date_trunc('hour', ts) AS h, ${SEV_CASE} AS sev, count(*) AS n FROM events WHERE ${FRESH}${sc} GROUP BY 1, 2`, sp),
    pool.query(
      `SELECT e.client_id, max(c.client_name) AS client_name, max(e.port) AS port, max(e.source_ip) AS source_ip, max(e.host) AS host,
              e.module, e.summary, min(e.severity) AS level, count(*) AS n, min(e.ts) AS first_ts, max(e.ts) AS last_ts
       FROM events e LEFT JOIN clients_ports c ON c.id = e.client_id
       WHERE e.severity <= 4 AND NOT e.acknowledged AND e.${FRESH}${sc.replace('client_id', 'e.client_id')}
       GROUP BY e.client_id, e.module, e.summary ORDER BY min(e.severity), max(e.ts) DESC LIMIT 8`,
      sp
    ),
    pool.query(
      `SELECT count(*) AS n FROM (SELECT 1 FROM events WHERE severity <= 4 AND NOT acknowledged AND ${FRESH}${sc}
                                  GROUP BY client_id, module, summary) t`,
      sp
    ),
    pool.query('SELECT is_active, last_seen FROM clients_ports'),
    pool.query(`SELECT count(*) AS n FROM incidents WHERE status = 'open'${sc}`, sp),
    pool.query(
      `SELECT i.*, c.client_name FROM incidents i JOIN clients_ports c ON c.id = i.client_id
       WHERE i.status = 'open'${sc} ORDER BY COALESCE(i.severity, 7), i.opened_at DESC LIMIT 6`,
      sp
    ),
  ]);

  const totals = { critical: 0, error: 0, warning: 0, info: 0 };
  tot.rows.forEach((r) => { totals[r.sev] = Number(r.n); });

  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  start.setTime(start.getTime() - 23 * 3600000);
  const buckets = Array.from({ length: 24 }, (_, i) => ({
    hour: new Date(start.getTime() + i * 3600000).toISOString(), critical: 0, error: 0, warning: 0, info: 0, total: 0,
  }));
  hourly.rows.forEach((r) => {
    const idx = Math.round((new Date(r.h).getTime() - start.getTime()) / 3600000);
    if (idx >= 0 && idx < 24) { buckets[idx][r.sev] += Number(r.n); buckets[idx].total += Number(r.n); }
  });

  const now = Date.now();
  const active = ports.rows.filter((p) => p.is_active);
  res.json({
    totals,
    total: Object.values(totals).reduce((a, b) => a + b, 0),
    byCategory: cat.rows.map((r) => ({ category: r.category, n: Number(r.n) })),
    hourly: buckets,
    attention: attention.rows.map((r) => ({
      clientId: r.client_id, clientName: r.client_name, port: r.port, sourceIp: r.source_ip, host: r.host,
      module: r.module, summary: r.summary,
      level: r.level, severity: sevKey(r.level), count: Number(r.n), firstTs: r.first_ts, lastTs: r.last_ts,
    })),
    pending: Number(pending.rows[0].n),
    incidents: { open: Number(incOpen.rows[0].n), list: incList.rows.map(incidentShape) },
    // Puertos encendidos y cuántos de ellos recibieron algo en los últimos minutos
    sources: {
      total: active.length,
      withSignal: active.filter((p) => p.last_seen && now - new Date(p.last_seen).getTime() < SILENT_MIN * 60000).length,
    },
  });
});

module.exports = router;
