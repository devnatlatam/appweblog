// Incidentes: problemas con inicio, fin y duración. Los abre y cierra src/insights.js a partir de los logs.
const express = require('express');
const pool = require('./db');
const { auth, need } = require('./middleware');
const { sevKey } = require('./shape');

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

module.exports = router;
module.exports.incidentShape = incidentShape;
