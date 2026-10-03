// Textos de los correos que envía el sistema.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Marco común: título, contenido y pie. Estilos en línea porque muchos programas de correo ignoran las hojas de estilo.
function layout({ title, body, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f1f4f2;font-family:Segoe UI,Arial,sans-serif;color:#14262a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dfe5e2;border-radius:10px">
<tr><td style="background:#0f2a30;color:#ffffff;padding:16px 24px;border-radius:10px 10px 0 0;font-weight:600">Omada Logs</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(title)}</h1>${body}</td></tr>
${footer ? `<tr><td style="padding:0 24px 20px;color:#52666a;font-size:13px">${footer}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

const button = (url, label) => `<p style="margin:20px 0"><a href="${esc(url)}" style="background:#138a96;color:#ffffff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">${esc(label)}</a></p>`;

// Acceso para un usuario nuevo, o clave nueva si un administrador la restableció
function credentialsMail({ name, email, password, url, reset }) {
  const first = String(name).split(' ')[0];
  const title = reset ? 'Tu contraseña fue restablecida' : `Bienvenido, ${first}`;
  const intro = reset
    ? 'Un administrador restableció tu contraseña. Usa esta contraseña temporal para entrar:'
    : 'Se creó tu acceso a Omada Logs. Entra con estos datos:';
  const text = [
    title, '', intro, '', `Correo: ${email}`, `Contraseña temporal: ${password}`, '',
    url ? `Entra aquí: ${url}` : '', 'Al entrar, el sistema te pedirá crear una contraseña propia.',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  const html = layout({
    title,
    body: `<p style="margin:0 0 12px">${esc(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f7f9f8;border:1px solid #dfe5e2;border-radius:6px;padding:4px 0;width:100%">
<tr><td style="padding:8px 16px;color:#52666a;width:150px">Correo</td><td style="padding:8px 16px"><strong>${esc(email)}</strong></td></tr>
<tr><td style="padding:8px 16px;color:#52666a">Contraseña temporal</td><td style="padding:8px 16px"><strong style="font-family:Consolas,monospace;font-size:16px">${esc(password)}</strong></td></tr></table>
${url ? button(url, 'Entrar a Omada Logs') : ''}`,
    footer: 'Al entrar, el sistema te pedirá crear una contraseña propia. Si no esperabas este correo, ignóralo.',
  });
  return { subject: reset ? 'Tu contraseña de Omada Logs fue restablecida' : 'Tu acceso a Omada Logs', text, html };
}

module.exports = { esc, layout, button, credentialsMail };
