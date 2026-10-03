// Aprobación de tipos de log nuevos. Solo administradores.
const express = require('express');
const pool = require('./db');
const { auth, need } = require('./middleware');
const collector = require('./collector');
const { audit } = require('./settings');
const { CATEGORIES } = require('./classify');

const router = express.Router();
const guard = [auth, need('types.review')];

const shape = (r) => ({
  id: r.id,
  clientId: r.client_id,
  clientName: r.client_name,
  typeKey: r.type_key,
  label: r.label,
  suggestedCategory: r.suggested_category,
  category: r.category,
  status: r.status,
  eventCount: Number(r.event_count),
  sample: r.sample,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
});

const SELECT = `SELECT t.*, c.client_name FROM log_types t JOIN clients_ports c ON c.id = t.client_id`;

router.get('/types/summary', guard, async (req, res) => {
  const { rows } = await pool.query("SELECT count(*) AS n FROM log_types WHERE status = 'pending'");
  res.json({ pending: Number(rows[0].n) });
});

router.get('/types', guard, async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const [list, counts] = await Promise.all([
    pool.query(`${SELECT} WHERE t.status = $1 ORDER BY t.last_seen DESC LIMIT 500`, [status]),
    pool.query('SELECT status, count(*) AS n FROM log_types GROUP BY 1'),
  ]);
  const c = { pending: 0, approved: 0, rejected: 0 };
  counts.rows.forEach((r) => { c[r.status] = Number(r.n); });
  res.json({ types: list.rows.map(shape), counts: c, categories: CATEGORIES });
});

// Últimos mensajes de un tipo, para decidir con ejemplos reales
router.get('/types/:id/samples', guard, async (req, res) => {
  const { rows: t } = await pool.query('SELECT client_id, type_key FROM log_types WHERE id = $1', [Number(req.params.id) || 0]);
  if (!t[0]) return res.status(404).json({ error: 'Tipo no encontrado.' });
  const { rows } = await pool.query(
    'SELECT id, ts, source_ip, summary, raw FROM events WHERE client_id = $1 AND type_key = $2 ORDER BY ts DESC LIMIT 5',
    [t[0].client_id, t[0].type_key]
  );
  res.json({ samples: rows.map((r) => ({ id: Number(r.id), ts: r.ts, sourceIp: r.source_ip, summary: r.summary, raw: r.raw })) });
});

async function load(req, res) {
  const { rows } = await pool.query(`${SELECT} WHERE t.id = $1`, [Number(req.params.id) || 0]);
  if (!rows[0]) { res.status(404).json({ error: 'Tipo no encontrado.' }); return null; }
  return rows[0];
}

// Aprobar: sus eventos pasan a verse con la categoría elegida, y los que lleguen después también
router.post('/types/:id/approve', guard, async (req, res) => {
  const t = await load(req, res);
  if (!t) return;
  const category = String((req.body || {}).category || t.category);
  const label = String((req.body || {}).label || t.label).trim().slice(0, 140) || t.label;
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Elige una categoría de la lista.' });

  const client = await pool.connect();
  let shown = 0;
  try {
    await client.query('BEGIN');
    await client.query(
      "UPDATE log_types SET status = 'approved', category = $1, label = $2, decided_by = $3, decided_at = now() WHERE id = $4",
      [category, label, req.user.id, t.id]
    );
    const r = await client.query(
      'UPDATE events SET pending = FALSE, category = $1 WHERE client_id = $2 AND type_key = $3 AND pending',
      [category, t.client_id, t.type_key]
    );
    shown = r.rowCount;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  collector.setType(t.client_id, t.type_key, { id: t.id, status: 'approved', category });
  await audit(req.user.id, 'type.approve', { id: t.id, client: t.client_name, label, category, events: shown });
  res.json({ ok: true, shown });
});

// Rechazar: se borran los eventos pendientes de ese tipo y los que lleguen después se descartan
router.post('/types/:id/reject', guard, async (req, res) => {
  const t = await load(req, res);
  if (!t) return;
  const client = await pool.connect();
  let removed = 0;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE log_types SET status = 'rejected', decided_by = $1, decided_at = now() WHERE id = $2", [req.user.id, t.id]);
    const r = await client.query('DELETE FROM events WHERE client_id = $1 AND type_key = $2 AND pending', [t.client_id, t.type_key]);
    removed = r.rowCount;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  collector.setType(t.client_id, t.type_key, { id: t.id, status: 'rejected', category: t.category });
  await audit(req.user.id, 'type.reject', { id: t.id, client: t.client_name, label: t.label, removed });
  res.json({ ok: true, removed });
});

// Volver a dejarlo pendiente (por ejemplo, un tipo rechazado por error)
router.post('/types/:id/reopen', guard, async (req, res) => {
  const t = await load(req, res);
  if (!t) return;
  await pool.query("UPDATE log_types SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = $1", [t.id]);
  collector.setType(t.client_id, t.type_key, { id: t.id, status: 'pending', category: t.category });
  await audit(req.user.id, 'type.reopen', { id: t.id, client: t.client_name, label: t.label });
  res.json({ ok: true });
});

module.exports = router;
