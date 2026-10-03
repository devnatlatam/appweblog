// Reglas de alerta por correo: se crean, editan y apagan desde la web.
const express = require('express');
const pool = require('./db');
const { auth, need } = require('./middleware');
const mailer = require('./mailer');
const alerts = require('./alerts');
const { audit } = require('./settings');

const router = express.Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INCIDENT_KINDS = Object.keys(alerts.KIND_LABEL);

const int = (v, min, max, def) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};
const num = (v, min, max, def) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
};

// Valida y limpia los parámetros según el tipo de regla
const PARAMS = {
  incident(p) {
    const kinds = (Array.isArray(p.kinds) ? p.kinds : []).filter((k) => INCIDENT_KINDS.includes(k));
    if (!kinds.length) return { error: 'Elige al menos un tipo de problema.' };
    const minMinutes = int(p.minMinutes, 0, 1440, 0);
    if (Number.isNaN(minMinutes)) return { error: 'El tiempo mínimo debe estar entre 0 y 1440 minutos.' };
    return { value: { kinds, minMinutes } };
  },
  client_silent(p) {
    const minutes = int(p.minutes, 2, 1440, 15);
    if (Number.isNaN(minutes)) return { error: 'Los minutos sin señal deben estar entre 2 y 1440.' };
    return { value: { minutes } };
  },
  events(p) {
    const maxLevel = int(p.maxLevel, 0, 7, 4);
    if (Number.isNaN(maxLevel)) return { error: 'Elige una severidad válida.' };
    const modules = (Array.isArray(p.modules) ? p.modules : []).filter((m) => /^[a-z_]{1,40}$/.test(m)).slice(0, 20);
    return { value: { maxLevel, modules } };
  },
  firewall_blocks(p) {
    const count = int(p.count, 1, 100000, 20);
    const minutes = int(p.minutes, 1, 1440, 5);
    if (Number.isNaN(count) || Number.isNaN(minutes)) return { error: 'Revisa la cantidad de bloqueos y los minutos.' };
    return { value: { count, minutes } };
  },
  new_device() { return { value: {} }; },
  spike(p) {
    const windowMin = int(p.windowMin, 5, 120, 15);
    const factor = num(p.factor, 1.5, 100, 3);
    const minEvents = int(p.minEvents, 10, 1000000, 300);
    if (Number.isNaN(windowMin) || Number.isNaN(factor) || Number.isNaN(minEvents)) return { error: 'Revisa los datos del pico de actividad.' };
    return { value: { windowMin, factor, minEvents } };
  },
  daily_summary(p) {
    const hour = int(p.hour, 0, 23, 8);
    if (Number.isNaN(hour)) return { error: 'La hora debe estar entre 0 y 23.' };
    return { value: { hour } };
  },
};

function parseRule(b, existing) {
  const kind = b.kind !== undefined ? b.kind : existing && existing.kind;
  if (!PARAMS[kind]) return { error: 'Elige cuándo se debe enviar la alerta.' };
  const name = String(b.name !== undefined ? b.name : (existing && existing.name) || '').trim();
  if (!name || name.length > 80) return { error: 'Ponle un nombre a la regla (hasta 80 caracteres).' };

  const recRaw = b.recipients !== undefined ? b.recipients : existing && existing.recipients;
  const recipients = [...new Set((Array.isArray(recRaw) ? recRaw : String(recRaw || '').split(/[\s,;]+/)).map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) return { error: 'Agrega al menos un correo para recibir el aviso.' };
  if (recipients.length > 20) return { error: 'Máximo 20 destinatarios por regla.' };
  const bad = recipients.find((r) => !EMAIL.test(r));
  if (bad) return { error: `“${bad}” no es un correo válido.` };

  const cooldown = int(b.cooldownMin !== undefined ? b.cooldownMin : existing && existing.cooldown_min, 1, 10080, 60);
  if (Number.isNaN(cooldown)) return { error: 'El tiempo entre avisos debe estar entre 1 minuto y 7 días.' };

  const clientId = b.clientId !== undefined ? (b.clientId === null || b.clientId === '' ? null : Number(b.clientId)) : existing && existing.client_id;
  if (clientId !== null && clientId !== undefined && !Number.isInteger(clientId)) return { error: 'Cliente no válido.' };

  const p = PARAMS[kind](b.params !== undefined ? b.params : (existing && existing.params) || {});
  if (p.error) return { error: p.error };
  return {
    value: {
      name, kind, recipients, cooldown, clientId: clientId === undefined ? null : clientId, params: p.value,
      notifyResolved: b.notifyResolved !== undefined ? b.notifyResolved === true : Boolean(existing && existing.notify_resolved),
      enabled: b.enabled !== undefined ? b.enabled === true : existing ? existing.enabled : true,
    },
  };
}

const shape = (r, stats = {}) => ({
  id: r.id, name: r.name, kind: r.kind, clientId: r.client_id, clientName: r.client_name || null, params: r.params,
  recipients: r.recipients, cooldownMin: r.cooldown_min, notifyResolved: r.notify_resolved, enabled: r.enabled,
  lastFired: r.last_fired, createdAt: r.created_at, sent24h: stats.sent24h || 0, failed24h: stats.failed24h || 0,
});

router.get('/alerts', auth, need('alerts.view'), async (req, res) => {
  const [rules, stats] = await Promise.all([
    pool.query('SELECT r.*, c.client_name FROM alert_rules r LEFT JOIN clients_ports c ON c.id = r.client_id ORDER BY r.id'),
    pool.query(`SELECT rule_id, count(*) FILTER (WHERE status = 'sent') AS sent, count(*) FILTER (WHERE status = 'failed') AS failed
                FROM alert_history WHERE ts > now() - interval '24 hours' AND type <> 'test' GROUP BY 1`),
  ]);
  const by = Object.fromEntries(stats.rows.map((r) => [r.rule_id, { sent24h: Number(r.sent), failed24h: Number(r.failed) }]));
  res.json({ rules: rules.rows.map((r) => shape(r, by[r.id])), smtpConfigured: mailer.isConfigured() });
});

router.get('/alerts/history', auth, need('alerts.view'), async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const { rows } = await pool.query('SELECT * FROM alert_history ORDER BY ts DESC LIMIT $1', [limit]);
  res.json({
    history: rows.map((h) => ({
      id: Number(h.id), ts: h.ts, ruleId: h.rule_id, ruleName: h.rule_name, clientName: h.client_name, subject: h.subject,
      type: h.type, status: h.status, error: h.error, recipients: h.recipients,
    })),
  });
});

router.post('/alerts', auth, need('alerts.manage'), async (req, res) => {
  const p = parseRule(req.body || {}, null);
  if (p.error) return res.status(400).json({ error: p.error });
  const v = p.value;
  // Una regla nueva solo mira los eventos que lleguen desde ahora, no el historial
  const cursor = Number((await pool.query('SELECT COALESCE(max(id), 0) AS m FROM events')).rows[0].m);
  try {
    const { rows } = await pool.query(
      `INSERT INTO alert_rules (name, kind, client_id, params, recipients, cooldown_min, notify_resolved, enabled, cursor_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [v.name, v.kind, v.clientId, JSON.stringify(v.params), v.recipients, v.cooldown, v.notifyResolved, v.enabled, cursor, req.user.id]
    );
    await audit(req.user.id, 'alert.create', { id: rows[0].id, name: v.name, kind: v.kind });
    res.status(201).json({ rule: shape(rows[0]) });
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ error: 'El cliente elegido ya no existe.' });
    throw e;
  }
});

async function load(req, res) {
  const { rows } = await pool.query('SELECT r.*, c.client_name FROM alert_rules r LEFT JOIN clients_ports c ON c.id = r.client_id WHERE r.id = $1', [Number(req.params.id) || 0]);
  if (!rows[0]) { res.status(404).json({ error: 'Regla no encontrada.' }); return null; }
  return rows[0];
}

router.patch('/alerts/:id', auth, need('alerts.manage'), async (req, res) => {
  const cur = await load(req, res);
  if (!cur) return;
  const p = parseRule(req.body || {}, cur);
  if (p.error) return res.status(400).json({ error: p.error });
  const v = p.value;
  try {
    const { rows } = await pool.query(
      `UPDATE alert_rules SET name = $1, kind = $2, client_id = $3, params = $4, recipients = $5, cooldown_min = $6,
              notify_resolved = $7, enabled = $8 WHERE id = $9 RETURNING *`,
      [v.name, v.kind, v.clientId, JSON.stringify(v.params), v.recipients, v.cooldown, v.notifyResolved, v.enabled, cur.id]
    );
    // Si cambió lo que mide, los avisos anteriores ya no aplican
    if (cur.kind !== v.kind || JSON.stringify(cur.params) !== JSON.stringify(v.params) || cur.client_id !== v.clientId) {
      await pool.query('DELETE FROM alert_state WHERE rule_id = $1', [cur.id]);
    }
    await audit(req.user.id, 'alert.update', { id: cur.id, name: v.name, enabled: v.enabled });
    res.json({ rule: shape({ ...rows[0], client_name: cur.client_name }) });
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ error: 'El cliente elegido ya no existe.' });
    throw e;
  }
});

router.delete('/alerts/:id', auth, need('alerts.manage'), async (req, res) => {
  const cur = await load(req, res);
  if (!cur) return;
  await pool.query('DELETE FROM alert_rules WHERE id = $1', [cur.id]);
  await audit(req.user.id, 'alert.delete', { id: cur.id, name: cur.name });
  res.json({ ok: true });
});

router.post('/alerts/:id/test', auth, need('alerts.manage'), async (req, res) => {
  const cur = await load(req, res);
  if (!cur) return;
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Primero configura el correo en Administración → Correo.' });
  const ok = await alerts.sendTest(cur);
  if (!ok) {
    const last = await pool.query("SELECT error FROM alert_history WHERE rule_id = $1 AND type = 'test' ORDER BY ts DESC LIMIT 1", [cur.id]);
    return res.status(400).json({ error: (last.rows[0] && last.rows[0].error) || 'No se pudo enviar la prueba.' });
  }
  res.json({ ok: true, recipients: cur.recipients });
});

module.exports = router;
