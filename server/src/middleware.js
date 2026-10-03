require('dotenv').config({ quiet: true });
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { PERMS } = require('./permissions');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('Falta JWT_SECRET en server/.env');

// Carga al usuario desde la base en cada petición: si lo desactivan o le bajan el rol, aplica de inmediato.
async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Sesión vencida. Inicia sesión de nuevo.' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
  if (!rows[0] || rows[0].status !== 'active') return res.status(401).json({ error: 'Sesión no válida.' });
  if (rows[0].must_change_password) return res.status(403).json({ error: 'Debes crear tu contraseña antes de continuar.' });
  req.user = rows[0];
  next();
}

// auth sin exigir el cambio de contraseña (la pantalla de cambio lo necesita)
async function authAny(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Sesión vencida. Inicia sesión de nuevo.' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
  if (!rows[0] || rows[0].status !== 'active') return res.status(401).json({ error: 'Sesión no válida.' });
  req.user = rows[0];
  next();
}

const need = (perm) => (req, res, next) => {
  if (!PERMS[req.user.role].includes(perm)) return res.status(403).json({ error: 'No tienes permiso para hacer esto.' });
  next();
};

module.exports = { SECRET, auth, authAny, need };
