// Reglas para cambiar la severidad de un tipo de log (por ejemplo, "cambio de IP de origen" de Aviso a Info).
// Se aplican al guardar cada evento y, si el administrador lo pide, también a lo ya guardado.
const express = require('express');
const pool = require('./db');
const { auth, need } = require('./middleware');
const { audit } = require('./settings');

const router = express.Router();
const guard = [auth, need('types.review')];

// Los cuatro niveles que ve el usuario → el número guardado
const LEVELS = { critical: 2, error: 3, warning: 4, info: 6 };
const levelKey = (n) => (n <= 2 ? 'critical' : n === 3 ? 'error' : n === 4 ? 'warning' : 'info');

let rules = []; // en memoria: se consultan en cada evento que llega

// Cuanto más específica, más prioridad: cliente concreto (2) y texto concreto (1)
const score = (r) => (r.client_id ? 2 : 0) + (r.match ? 1 : 0);

async function load() {
  const { rows } = await pool.query('SELECT id, module, client_id, match, severity FROM severity_rules ORDER BY id');
  rules = rows.map((r) => ({ ...r, lower: r.match ? r.match.toLowerCase() : null, score: score(r) }));
}

const matches = (r, ev, clientId) => r.module === ev.module
  && (!r.client_id || r.client_id === clientId)
  && (!r.lower || String(ev.summary || '').toLowerCase().includes(r.lower));

// Cambia ev.severity si alguna regla coincide (gana la más específica; a igual especificidad, la más nueva)
function apply(ev, clientId) {
  let best = null;
  for (const r of rules) if (matches(r, ev, clientId) && (!best || r.score >= best.score)) best = r;
  if (best) ev.severity = best.severity;
  return ev;
}

const likeEscape = (s) => s.replace(/[\\%_]/g, '\\$&');

// Cambia lo ya guardado, sin pisar lo que decida otra regla más específica
async function applyStored(rule) {
  const params = [rule.severity, rule.module];
  const where = ['module = $2', 'severity IS DISTINCT FROM $1'];
  if (rule.client_id) { params.push(rule.client_id); where.push(`client_id = $${params.length}`); }
  if (rule.match) { params.push(`%${likeEscape(rule.match)}%`); where.push(`summary ILIKE $${params.length}`); }
  for (const o of rules) {
    if (o.id === rule.id || o.module !== rule.module || o.score <= score(rule)) continue;
    if (rule.client_id && o.client_id && o.client_id !== rule.client_id) continue;
    const cond = [];
    if (o.client_id) { params.push(o.client_id); cond.push(`client_id = $${params.length}`); }
    if (o.match) { params.push(`%${likeEscape(o.match)}%`); cond.push(`summary ILIKE $${params.length}`); }
    if (cond.length) where.push(`NOT (${cond.join(' AND ')})`);
  }
  const r = await pool.query(`UPDATE events SET severity = $1 WHERE ${where.join(' AND ')}`, params);
  return r.rowCount;
}

const shape = (r) => ({
  id: r.id, module: r.module, clientId: r.client_id, clientName: r.client_name, match: r.match,
  severity: levelKey(r.severity), createdBy: r.created_by_name, createdAt: r.created_at,
});

router.get('/severity-rules', guard, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, c.client_name, u.name AS created_by_name FROM severity_rules s
     LEFT JOIN clients_ports c ON c.id = s.client_id LEFT JOIN users u ON u.id = s.created_by ORDER BY s.created_at DESC`
  );
  res.json({ rules: rows.map(shape) });
});

// Crear una regla (o cambiar la severidad de una igual que ya exista)
router.post('/severity-rules', guard, async (req, res) => {
  const b = req.body || {};
  const module = String(b.module || '').trim().slice(0, 60);
  const level = LEVELS[b.severity];
  const clientId = b.clientId ? Number(b.clientId) : null;
  const match = String(b.match || '').trim().slice(0, 120) || null;
  if (!module) return res.status(400).json({ error: 'Elige el tipo de log.' });
  if (level === undefined) return res.status(400).json({ error: 'Elige una severidad: crítico, error, aviso o info.' });
  if (clientId !== null) {
    const c = await pool.query('SELECT 1 FROM clients_ports WHERE id = $1', [clientId]);
    if (!c.rowCount) return res.status(400).json({ error: 'Ese cliente no existe.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO severity_rules (module, client_id, match, severity, created_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (module, COALESCE(client_id, 0), COALESCE(lower(match), ''))
     DO UPDATE SET severity = EXCLUDED.severity, created_by = EXCLUDED.created_by, created_at = now()
     RETURNING *`,
    [module, clientId, match, level, req.user.id]
  );
  await load();
  let changed = 0;
  if (b.applyStored) changed = await applyStored(rows[0]);
  await audit(req.user.id, 'severity.set', { module, clientId, match, severity: b.severity, changed });
  res.status(201).json({ ok: true, changed });
});

router.delete('/severity-rules/:id', guard, async (req, res) => {
  const { rows } = await pool.query('DELETE FROM severity_rules WHERE id = $1 RETURNING module, client_id, match, severity', [Number(req.params.id) || 0]);
  if (!rows[0]) return res.status(404).json({ error: 'Regla no encontrada.' });
  await load();
  await audit(req.user.id, 'severity.delete', rows[0]);
  res.json({ ok: true });
});

module.exports = router;
module.exports.load = load;
module.exports.apply = apply;
