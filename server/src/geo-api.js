const crypto = require('crypto');
const express = require('express');
const pool = require('./db');
const { auth, need } = require('./middleware');
const { audit, getSetting, setSetting } = require('./settings');
const geo = require('./geo-countries');

const router = express.Router();
const guard = (perm) => [auth, need(perm)];

const newToken = () => crypto.randomBytes(24).toString('base64url'); // 192 bits: no se puede adivinar
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{20,64}$/;

// Freno para el formulario público (no exige sesión): 20 errores o envíos por IP cada 10 minutos.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 600000);
  hits.set(ip, list);
  return list.length >= 20;
}
const hit = (ip) => hits.set(ip, [...(hits.get(ip) || []), Date.now()]);

// ───────── Formulario público: se abre con el enlace único de cada cliente, sin iniciar sesión ─────────
async function loadByToken(req, res) {
  if (limited(req.ip)) { res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' }); return null; }
  const token = String(req.params.token || '');
  const { rows } = TOKEN_FORMAT.test(token)
    ? await pool.query(
      `SELECT g.*, c.client_name FROM geo_requests g JOIN clients_ports c ON c.id = g.client_id WHERE g.token = $1`, [token])
    : { rows: [] };
  if (!rows[0]) {
    hit(req.ip);
    res.status(404).json({ error: 'Este enlace no es válido o ya fue reemplazado. Pide uno nuevo a tu proveedor.' });
    return null;
  }
  return rows[0];
}

const publicShape = (r) => ({
  clientName: r.client_name,
  status: r.status,
  countries: r.countries || null, // respuesta guardada (si el enlace fue habilitado de nuevo, sirve para corregirla)
  contact: r.contact || '',
  submittedAt: r.submitted_at,
  recommended: geo.RECOMMENDED,
  catalog: geo.catalog,
});

router.get('/public/geo/:token', async (req, res) => {
  const row = await loadByToken(req, res);
  if (row) res.json(publicShape(row));
});

router.post('/public/geo/:token', async (req, res) => {
  const row = await loadByToken(req, res);
  if (!row) return;
  hit(req.ip); // cada envío cuenta para el límite
  if (row.status === 'submitted') {
    return res.status(409).json({ error: 'Esta solicitud ya fue enviada. Si necesitas cambiarla, pide a tu proveedor que la habilite de nuevo.', ...publicShape(row) });
  }

  const b = req.body || {};
  const contact = String(b.contact || '').trim();
  if (!contact || contact.length > 160) return res.status(400).json({ error: 'Escribe una persona de contacto, correo o teléfono (hasta 160 caracteres).' });
  if (!Array.isArray(b.countries)) return res.status(400).json({ error: 'No llegó la lista de países.' });
  const countries = [...new Set(b.countries.map(String))];
  const bad = countries.find((c) => !geo.isCountry(c));
  if (bad) return res.status(400).json({ error: `“${bad.slice(0, 40)}” no es un país de la lista.` });
  if (!countries.length) return res.status(400).json({ error: 'Marca al menos un país permitido. Si no, se bloquearía todo el mundo, incluido el suyo.' });
  countries.sort((a, c) => a.localeCompare(c, 'es'));

  // Condicional: si dos envíos llegan a la vez, solo el primero se guarda
  const { rows } = await pool.query(
    `UPDATE geo_requests
     SET status = 'submitted', countries = $2, contact = $3, submitted_at = now(), submitted_ip = $4, submissions = submissions + 1
     WHERE client_id = $1 AND status = 'pending' RETURNING *`,
    [row.client_id, countries, contact, req.ip]
  );
  if (!rows[0]) return res.status(409).json({ error: 'Esta solicitud ya fue enviada.' });
  await audit(null, 'geo.submit', { clientId: row.client_id, client: row.client_name, contact, ip: req.ip, countries });
  res.json(publicShape({ ...rows[0], client_name: row.client_name }));
});

// ───────── Administración: todos los usuarios ven las respuestas; quien gestiona clientes crea y habilita enlaces ─────────
const shapeAdmin = (r) => ({
  clientId: r.id,
  clientName: r.client_name,
  port: r.port_number,
  protocol: r.protocol,
  token: r.token || null,
  status: r.token ? r.status : 'none', // none = todavía sin enlace
  countries: r.countries || [],
  contact: r.contact || '',
  submittedAt: r.submitted_at || null,
  submittedIp: r.submitted_ip || null,
  submissions: r.submissions || 0,
  reopenedAt: r.reopened_at || null,
});

async function loadOne(clientId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.client_name, c.port_number, c.protocol, g.token, g.status, g.countries, g.contact, g.submitted_at,
            g.submitted_ip, g.submissions, g.reopened_at
     FROM clients_ports c LEFT JOIN geo_requests g ON g.client_id = c.id WHERE c.id = $1`, [clientId]);
  return rows[0] ? shapeAdmin(rows[0]) : null;
}

router.get('/geo', guard('ports.view'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.client_name, c.port_number, c.protocol, g.token, g.status, g.countries, g.contact, g.submitted_at,
            g.submitted_ip, g.submissions, g.reopened_at
     FROM clients_ports c LEFT JOIN geo_requests g ON g.client_id = c.id
     ORDER BY lower(c.client_name), c.port_number`);
  res.json({
    requests: rows.map(shapeAdmin),
    total: geo.TOTAL,
    ...(await baseUrls()),
    catalog: geo.catalog,
  });
});

// Dominio con el que se arman los enlaces para los clientes. Orden: el que se escribió en esta pantalla, luego APP_URL del
// servidor y, si no hay ninguno, la web usa la dirección desde la que se abrió el panel.
const BASE_KEY = 'geo.baseUrl';
async function baseUrls() {
  return { baseUrl: await getSetting(BASE_KEY, null), fallbackUrl: process.env.APP_URL || null };
}

router.put('/geo/settings', guard('settings.manage'), async (req, res) => {
  const raw = String((req.body || {}).baseUrl || '').trim();
  let value = null;
  if (raw) {
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch (e) { u = null; }
    if (!u || !/^https?:$/.test(u.protocol) || !u.hostname.includes('.') && u.hostname !== 'localhost') {
      return res.status(400).json({ error: 'Escribe un dominio válido, por ejemplo geo.tuempresa.com.' });
    }
    value = u.origin; // solo protocolo, dominio y puerto: sin rutas ni barra final
  }
  await setSetting(BASE_KEY, value);
  await audit(req.user.id, 'geo.settings', { baseUrl: value });
  res.json(await baseUrls());
});

const clientId = (req) => Number(req.params.clientId) || 0;

// Crea el enlace del cliente. Si ya tenía uno, lo devuelve igual (nunca hay dos por cliente).
router.post('/geo/:clientId/link', guard('ports.manage'), async (req, res) => {
  const id = clientId(req);
  const { rows: c } = await pool.query('SELECT client_name FROM clients_ports WHERE id = $1', [id]);
  if (!c[0]) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const ins = await pool.query(
    'INSERT INTO geo_requests (client_id, token, created_by) VALUES ($1, $2, $3) ON CONFLICT (client_id) DO NOTHING',
    [id, newToken(), req.user.id]
  );
  if (ins.rowCount) await audit(req.user.id, 'geo.link', { clientId: id, client: c[0].client_name });
  res.status(ins.rowCount ? 201 : 200).json({ request: await loadOne(id) });
});

// Vuelve a habilitar un enlace ya enviado: el cliente puede corregir su respuesta (parte de la anterior).
router.post('/geo/:clientId/reopen', guard('ports.manage'), async (req, res) => {
  const id = clientId(req);
  const { rows } = await pool.query(
    `UPDATE geo_requests SET status = 'pending', reopened_at = now(), reopened_by = $2
     WHERE client_id = $1 AND status = 'submitted' RETURNING client_id`, [id, req.user.id]);
  if (!rows[0]) return res.status(409).json({ error: 'Ese enlace no está enviado, o el cliente no tiene enlace.' });
  const request = await loadOne(id);
  await audit(req.user.id, 'geo.reopen', { clientId: id, client: request.clientName });
  res.json({ request });
});

// Cambia el enlace por uno nuevo: el anterior deja de funcionar (por si se compartió con quien no debía).
router.post('/geo/:clientId/regenerate', guard('ports.manage'), async (req, res) => {
  const id = clientId(req);
  const { rows } = await pool.query('UPDATE geo_requests SET token = $2 WHERE client_id = $1 RETURNING client_id', [id, newToken()]);
  if (!rows[0]) return res.status(404).json({ error: 'Ese cliente todavía no tiene enlace.' });
  const request = await loadOne(id);
  await audit(req.user.id, 'geo.regenerate', { clientId: id, client: request.clientName });
  res.json({ request });
});

module.exports = router;
