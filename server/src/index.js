require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { LEVEL, ROLES } = require('./permissions');
const { SECRET, auth, authAny, need } = require('./middleware');

const app = express();
app.use(express.json());
app.use(cors({ origin: ['http://localhost:5173'] }));

// Freno simple contra fuerza bruta: 8 intentos fallidos por IP cada 10 minutos.
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 600000);
  attempts.set(ip, list);
  return list.length >= 8;
}

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, status: u.status,
  mustChangePassword: u.must_change_password, lastLoginAt: u.last_login_at,
});

const tempPassword = () => crypto.randomBytes(9).toString('base64url');
const validEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// ───────── Sesión ─────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Escribe tu correo y contraseña.' });
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera 10 minutos.' });

  const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [String(email).trim()]);
  const u = rows[0];
  const ok = u && u.password_hash && (await bcrypt.compare(String(password), u.password_hash));
  if (!ok) {
    attempts.get(req.ip).push(Date.now());
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }
  if (u.status === 'disabled') return res.status(403).json({ error: 'Esta cuenta está desactivada. Pide a un administrador que la active.' });

  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  const token = jwt.sign({ sub: u.id }, SECRET, { expiresIn: '8h' });
  res.json({ token, user: publicUser(u) });
});

app.get('/api/auth/me', authAny, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/change-password', authAny, async (req, res) => {
  const { current, next } = req.body || {};
  if (typeof next !== 'string' || next.length < 10) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 10 caracteres.' });
  if (!(await bcrypt.compare(String(current || ''), req.user.password_hash))) {
    return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  }
  if (next === current) return res.status(400).json({ error: 'La contraseña nueva debe ser distinta de la actual.' });
  const hash = await bcrypt.hash(next, 12);
  const { rows } = await pool.query(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2 RETURNING *',
    [hash, req.user.id]
  );
  res.json({ user: publicUser(rows[0]) });
});

// ───────── Usuarios ─────────
// Regla de niveles: solo se gestiona a quien tenga un nivel igual o menor al propio, y nunca a uno mismo.
const canManage = (actor, target) => LEVEL[target.role] <= LEVEL[actor.role] && target.id !== actor.id;

app.get('/api/users', auth, need('users.manage'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
  res.json({ users: rows.map(publicUser) });
});

app.post('/api/users', auth, need('users.manage'), async (req, res) => {
  const { name, email, role } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Escribe el nombre.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'El correo no es válido.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Elige un rol válido.' });
  if (LEVEL[role] > LEVEL[req.user.role]) return res.status(403).json({ error: 'No puedes asignar un rol superior al tuyo.' });

  const dup = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email.trim()]);
  if (dup.rowCount) return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });

  const password = tempPassword();
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, status, must_change_password)
     VALUES ($1, $2, $3, $4, 'active', TRUE) RETURNING *`,
    [String(name).trim(), email.trim(), await bcrypt.hash(password, 12), role]
  );
  res.status(201).json({ user: publicUser(rows[0]), tempPassword: password });
});

async function loadTarget(req, res) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [Number(req.params.id) || 0]);
  const target = rows[0];
  if (!target) { res.status(404).json({ error: 'Usuario no encontrado.' }); return null; }
  if (!canManage(req.user, target)) { res.status(403).json({ error: 'No puedes modificar a este usuario.' }); return null; }
  return target;
}

app.patch('/api/users/:id', auth, need('users.manage'), async (req, res) => {
  const target = await loadTarget(req, res);
  if (!target) return;
  const name = req.body.name !== undefined ? String(req.body.name).trim() : target.name;
  const email = req.body.email !== undefined ? String(req.body.email).trim() : target.email;
  const role = req.body.role !== undefined ? req.body.role : target.role;
  const status = req.body.status !== undefined ? req.body.status : target.status;

  if (!name) return res.status(400).json({ error: 'Escribe el nombre.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'El correo no es válido.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Elige un rol válido.' });
  if (!['active', 'disabled'].includes(status)) return res.status(400).json({ error: 'Estado no válido.' });
  if (LEVEL[role] > LEVEL[req.user.role]) return res.status(403).json({ error: 'No puedes asignar un rol superior al tuyo.' });
  if (email.toLowerCase() !== target.email.toLowerCase()) {
    const dup = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [email, target.id]);
    if (dup.rowCount) return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
  }
  const { rows } = await pool.query(
    'UPDATE users SET name = $1, email = $2, role = $3, status = $4 WHERE id = $5 RETURNING *',
    [name, email, role, status, target.id]
  );
  res.json({ user: publicUser(rows[0]) });
});

app.post('/api/users/:id/reset-password', auth, need('users.manage'), async (req, res) => {
  const target = await loadTarget(req, res);
  if (!target) return;
  const password = tempPassword();
  const { rows } = await pool.query(
    'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2 RETURNING *',
    [await bcrypt.hash(password, 12), target.id]
  );
  res.json({ user: publicUser(rows[0]), tempPassword: password });
});

app.use('/api', require('./events-api'));
app.use('/api', require('./ports-api'));
app.use('/api', require('./storage-api'));
app.use('/api', require('./types-api'));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const collector = require('./collector');
const { attachLive } = require('./live');
const { scheduleRetention } = require('./retention');
const { setupEvents } = require('./partitions');

const port = process.env.PORT || 4000;
const server = http.createServer(app);
attachLive(server, collector);

async function main() {
  await setupEvents(); // deja lista la tabla de eventos del día
  await collector.start();
  // Que el firewall refleje los puertos encendidos desde el arranque (si el servidor se reinició, por ejemplo)
  require('./firewall').sync().catch((e) => console.error('Firewall:', e.message));
  scheduleRetention();
  // HOST=127.0.0.1 en producción: la API solo la ve nginx, no internet
  const listenArgs = process.env.HOST ? [port, process.env.HOST] : [port];
  server.listen(...listenArgs, () => console.log(`API escuchando en http://${process.env.HOST || 'localhost'}:${port}`));
}

main().catch((e) => { console.error('No se pudo iniciar:', e.message); process.exit(1); });
