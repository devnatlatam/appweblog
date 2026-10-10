// Incidentes: problemas con inicio, fin y duración. Los abre y cierra src/insights.js a partir de los logs.
const express = require('express');
const pool = require('./db');
const { auth, need } = require('./middleware');
const { sevKey, shape } = require('./shape');
const { PERMS } = require('./permissions');

const router = express.Router();

function incidentShape(r) {
  const end = r.status === 'resolved' ? new Date(r.resolved_at) : new Date();
  return {
    id: Number(r.id),
    clientId: r.client_id,
    clientName: r.client_name,
    kind: r.kind,
    key: r.key,
    title: r.title,
    level: r.severity,
    severity: sevKey(r.severity),
    status: r.status,
    openedAt: r.opened_at,
    lastSeen: r.last_seen,
    resolvedAt: r.resolved_at,
    durationSecs: Math.max(0, Math.round((end.getTime() - new Date(r.opened_at).getTime()) / 1000)),
    eventCount: r.event_count,
    autoClosed: r.auto_closed,
  };
}

router.get('/incidents', auth, need('dashboard.view'), async (req, res) => {
  const where = [];
  const params = [];
  const push = (v) => { params.push(v); return `$${params.length}`; };
  if (req.query.client !== undefined) {
    const id = Number(req.query.client);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Cliente no válido.' });
    where.push(`i.client_id = ${push(id)}`);
  }
  if (['open', 'resolved'].includes(req.query.status)) where.push(`i.status = ${push(req.query.status)}`);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const { rows } = await pool.query(
    `SELECT i.*, c.client_name FROM incidents i JOIN clients_ports c ON c.id = i.client_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY (i.status = 'open') DESC, i.opened_at DESC LIMIT ${limit}`,
    params
  );
  const counts = await pool.query(
    `SELECT status, count(*) AS n FROM incidents ${req.query.client !== undefined ? 'WHERE client_id = $1' : ''} GROUP BY 1`,
    req.query.client !== undefined ? [Number(req.query.client)] : []
  );
  const c = { open: 0, resolved: 0 };
  counts.rows.forEach((r) => { c[r.status] = Number(r.n); });
  res.json({ incidents: rows.map(incidentShape), counts: c });
});

// Qué eventos cuentan como parte de cada tipo de incidente (para mostrar "qué pasó" al abrirlo)
const STORY = {
  wan_offline: { modules: ['online_dection', 'alerta_controlador'], field: 'wan', like: ['%conexión a internet%'] },
  ipsec_down: { modules: ['ipsec', 'alerta_controlador'], field: 'wan', like: ['%caído%', '%establecido%'] },
  ip_conflict: { modules: ['ip_conflict'], field: 'ip', like: ['%'] },
  rogue_dhcp: { modules: ['dhcp_server', 'alerta_controlador'], field: 'ip', like: ['Servidor DHCP intruso%'] },
  arp_conflict: { modules: ['firewall'], field: 'ip', like: ['Conflicto ARP%'] },
};

// Detalle de un incidente: lo que lo abrió y los eventos que lo componen
router.get('/incidents/:id', auth, need('dashboard.view'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT i.*, c.client_name FROM incidents i JOIN clients_ports c ON c.id = i.client_id WHERE i.id = $1',
    [Number(req.params.id) || 0]
  );
  const i = rows[0];
  if (!i) return res.status(404).json({ error: 'Incidente no encontrado.' });

  const canRaw = PERMS[req.user.role].includes('logs.raw');
  const story = STORY[i.kind];
  let opening = null;
  let events = [];
  let total = 0;
  if (story) {
    // Una ventana con un minuto de margen alrededor del incidente
    const from = new Date(new Date(i.opened_at).getTime() - 60000);
    const end = i.status === 'resolved' ? i.resolved_at : new Date();
    const to = new Date(new Date(end).getTime() + 60000);
    const where = `e.client_id = $1 AND e.ts BETWEEN $2 AND $3 AND NOT e.pending AND e.module = ANY($4::text[])
                   AND e.fields->>'${story.field}' = $5 AND e.summary ILIKE ANY($6::text[])`;
    const params = [i.client_id, from, to, story.modules, i.key, story.like];
    const cols = `e.id, e.ts, e.source_ip, e.host, e.client_id, c.client_name, e.port, e.module, e.severity, e.category,
                  e.summary, e.fields, e.message, e.raw, e.acknowledged`;
    const from_ = 'events e LEFT JOIN clients_ports c ON c.id = e.client_id';
    const [first, latest, count] = await Promise.all([
      pool.query(`SELECT ${cols} FROM ${from_} WHERE ${where} ORDER BY e.ts ASC, e.id ASC LIMIT 1`, params),
      pool.query(`SELECT ${cols} FROM ${from_} WHERE ${where} ORDER BY e.ts DESC, e.id DESC LIMIT 40`, params),
      pool.query(`SELECT count(*) AS n FROM events e WHERE ${where}`, params),
    ]);
    opening = first.rows[0] ? shape(first.rows[0], canRaw) : null;
    events = latest.rows.map((r) => shape(r, canRaw));
    total = Number(count.rows[0].n);
  }
  res.json({ incident: incidentShape(i), opening, events, total });
});

module.exports = router;
module.exports.incidentShape = incidentShape;
