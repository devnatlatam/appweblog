const pool = require('./db');

async function getSetting(key, fallback) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

async function setSetting(key, value) {
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, JSON.stringify(value)]
  );
}

// Registro de quién hizo qué (puertos, almacenamiento, borrados). Un fallo aquí nunca debe romper la acción principal.
async function audit(userId, action, detail = {}) {
  try {
    await pool.query('INSERT INTO audit_log (user_id, action, detail) VALUES ($1, $2, $3)', [userId, action, JSON.stringify(detail)]);
  } catch (e) {
    console.error('No se pudo registrar auditoría:', e.message);
  }
}

module.exports = { getSetting, setSetting, audit };
