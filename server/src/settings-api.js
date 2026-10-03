// Configuración del correo de salida desde la web. Se guarda en el archivo .env (SMTP_*) y se aplica al instante.
const express = require('express');
const { auth, need } = require('./middleware');
const { updateEnv } = require('./envfile');
const mailer = require('./mailer');
const { audit } = require('./settings');

const router = express.Router();
const guard = [auth, need('settings.manage')];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;

function publicConfig() {
  const c = mailer.getConfig();
  return {
    host: c.host, port: c.port, security: c.security, user: c.user, hasPassword: Boolean(c.password),
    fromName: c.fromName, from: c.from, configured: mailer.isConfigured(c), appUrl: process.env.APP_URL || '',
  };
}

// Lo que llega del formulario + lo que ya estaba guardado. Una contraseña vacía significa "dejar la que está".
function merge(body, current) {
  const b = body || {};
  const host = String(b.host !== undefined ? b.host : current.host).trim();
  const port = Number(b.port !== undefined ? b.port : current.port);
  const security = b.security !== undefined ? b.security : current.security;
  const user = String(b.user !== undefined ? b.user : current.user).trim();
  const password = b.password ? String(b.password) : current.password;
  const fromName = String(b.fromName !== undefined ? b.fromName : current.fromName).trim().slice(0, 80);
  const from = String(b.from !== undefined ? b.from : current.from).trim();
  let appUrl = String(b.appUrl !== undefined ? b.appUrl : (process.env.APP_URL || '')).trim().replace(/\/+$/, '');

  if (!HOST.test(host) || host.length > 253) return { error: 'Escribe el servidor de correo, por ejemplo smtp.tu-empresa.com.' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'El puerto debe ser un número entre 1 y 65535.' };
  if (!mailer.SECURITY.includes(security)) return { error: 'Elige el tipo de seguridad de la conexión.' };
  if (!EMAIL.test(from)) return { error: 'Escribe el correo desde el que se enviarán los avisos.' };
  if (user && !password) return { error: 'Escribe la contraseña del usuario de correo.' };
  if (/[\r\n\0]/.test(`${user}${password}${fromName}`)) return { error: 'Los datos no pueden tener saltos de línea.' };
  if (appUrl && !/^https?:\/\/[^\s]+$/i.test(appUrl)) return { error: 'La dirección de la web debe empezar con http:// o https://.' };
  return { value: { host, port, security, user, password: user ? password : '', fromName: fromName || 'Omada Logs', from }, appUrl };
}

router.get('/settings/smtp', guard, (req, res) => res.json({ smtp: publicConfig() }));

router.put('/settings/smtp', guard, async (req, res) => {
  const m = merge(req.body, mailer.getConfig());
  if (m.error) return res.status(400).json({ error: m.error });
  const c = m.value;
  try {
    updateEnv({
      SMTP_HOST: c.host,
      SMTP_PORT: String(c.port),
      SMTP_SECURITY: c.security,
      SMTP_USER: c.user || null,
      SMTP_PASSWORD: c.user ? c.password : null, // sin usuario no se guarda contraseña
      SMTP_FROM_NAME: c.fromName,
      SMTP_FROM: c.from,
      APP_URL: m.appUrl || null,
    }, { heading: '# Correo de salida y dirección de la web. Se editan desde la web: Administración → Correo.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  await audit(req.user.id, 'settings.smtp', { host: c.host, port: c.port, security: c.security, user: c.user, from: c.from });
  res.json({ smtp: publicConfig() });
});

// Envía un correo de prueba con los datos del formulario, sin guardarlos
const lastTest = new Map();
router.post('/settings/smtp/test', guard, async (req, res) => {
  const to = String((req.body || {}).to || '').trim();
  if (!EMAIL.test(to)) return res.status(400).json({ error: 'Escribe a qué correo enviar la prueba.' });
  if (Date.now() - (lastTest.get(req.user.id) || 0) < 3000) return res.status(429).json({ error: 'Espera unos segundos antes de otra prueba.' });
  lastTest.set(req.user.id, Date.now());

  const m = merge(req.body, mailer.getConfig());
  if (m.error) return res.status(400).json({ error: m.error });
  try {
    await mailer.send({
      to,
      subject: 'Prueba de correo — Omada Logs',
      text: 'Si lees esto, el correo de Omada Logs está bien configurado. Ya puede enviar alertas y accesos de usuarios.',
      html: '<p>Si lees esto, el correo de <strong>Omada Logs</strong> está bien configurado.</p><p>Ya puede enviar alertas y accesos de usuarios.</p>',
    }, m.value);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await audit(req.user.id, 'settings.smtp-test', { to });
  res.json({ ok: true });
});

module.exports = router;
