// Envío de correo. La configuración vive en el .env (SMTP_*) y se edita desde la web; aquí se lee siempre al momento de enviar,
// así un cambio guardado en la web vale de inmediato.
const nodemailer = require('nodemailer');

const SECURITY = ['starttls', 'ssl', 'none'];

function getConfig(env = process.env) {
  return {
    host: (env.SMTP_HOST || '').trim(),
    port: Number(env.SMTP_PORT) || 587,
    security: SECURITY.includes(env.SMTP_SECURITY) ? env.SMTP_SECURITY : 'starttls',
    user: env.SMTP_USER || '',
    password: env.SMTP_PASSWORD || '',
    fromName: env.SMTP_FROM_NAME || 'Omada Logs',
    from: (env.SMTP_FROM || '').trim(),
  };
}

const isConfigured = (cfg = getConfig()) => Boolean(cfg.host && cfg.from);

let cache = { key: '', transport: null };
function transportFor(cfg) {
  const key = JSON.stringify(cfg);
  if (cache.key === key && cache.transport) return cache.transport;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.security === 'ssl',
    requireTLS: cfg.security === 'starttls',
    ignoreTLS: cfg.security === 'none',
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  cache = { key, transport };
  return transport;
}

// Mensajes que se entienden, en lugar del error técnico
function friendlyError(e, cfg) {
  const where = `${cfg.host}:${cfg.port}`;
  const code = e.code || '';
  const msg = String(e.message || '');
  if (code === 'EAUTH' || /Invalid login|authentication/i.test(msg)) return 'El servidor rechazó el usuario o la contraseña.';
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return `No se pudo conectar a ${where}: el servidor rechazó la conexión. Revisa el servidor y el puerto.`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN/.test(msg)) return `No se encontró el servidor “${cfg.host}”. Revisa que esté bien escrito.`;
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || /timeout|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg)) return `No hubo respuesta de ${where}. Revisa el servidor, el puerto y que el firewall del VPS permita salir a ese puerto.`;
  if (/certificate|self.signed|SSL|TLS|wrong version/i.test(msg)) return `Falló la conexión segura con ${where}. Revisa el tipo de seguridad (el puerto 465 suele ser SSL/TLS; el 587, STARTTLS).`;
  if (code === 'EENVELOPE' || /recipient|rejected/i.test(msg)) return `El servidor no aceptó el destinatario o el remitente: ${msg}`;
  return msg || 'No se pudo enviar el correo.';
}

async function verify(cfg = getConfig()) {
  if (!cfg.host) throw new Error('Falta el servidor de correo.');
  try {
    await transportFor(cfg).verify();
  } catch (e) {
    throw new Error(friendlyError(e, cfg));
  }
}

// message: { to: 'a@x.com' | ['a@x.com'], subject, text, html }
async function send(message, cfg = getConfig()) {
  if (!isConfigured(cfg)) throw new Error('El correo todavía no está configurado. Hazlo en Administración → Correo.');
  try {
    const info = await transportFor(cfg).sendMail({
      from: { name: cfg.fromName, address: cfg.from },
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return info;
  } catch (e) {
    throw new Error(friendlyError(e, cfg));
  }
}

module.exports = { getConfig, isConfigured, verify, send, SECURITY };
