// Edita valores del archivo .env sin tocar el resto (otras variables, comentarios, orden).
// Lo usa la pantalla de configuración del correo: lo que se guarda en la web queda escrito en el .env y se aplica en caliente.
const fs = require('fs');
const path = require('path');

const envPath = () => process.env.ENV_FILE || path.join(__dirname, '..', '.env');

// Cómo escribir un valor para que dotenv lo lea idéntico. Con comillas simples no se interpreta nada.
function quote(value) {
  const s = String(value);
  if (/[\r\n\0]/.test(s)) throw new Error('El valor no puede tener saltos de línea.');
  if (s === '') return "''";
  if (/^[A-Za-z0-9_./:@+-]+$/.test(s)) return s;
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"') && !s.includes('\\')) return `"${s}"`;
  if (!s.includes('`')) return `\`${s}\``;
  throw new Error('El valor no puede tener a la vez comillas simples, comillas dobles y acentos graves.');
}

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

// updates: { CLAVE: 'valor' } para poner o cambiar, { CLAVE: null } para quitar
function updateEnv(updates, { heading } = {}) {
  const file = envPath();
  const exists = fs.existsSync(file);
  const text = exists ? fs.readFileSync(file, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const done = new Set();

  const lines = text === '' ? [] : text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const m = line.match(KEY_LINE);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      done.add(m[1]);
      if (updates[m[1]] !== null) out.push(`${m[1]}=${quote(updates[m[1]])}`);
    } else {
      out.push(line);
    }
  }
  const missing = Object.keys(updates).filter((k) => !done.has(k) && updates[k] !== null);
  if (missing.length) {
    while (out.length && out[out.length - 1] === '') out.pop();
    if (out.length) out.push('');
    if (heading) out.push(heading);
    missing.forEach((k) => out.push(`${k}=${quote(updates[k])}`));
  }
  const body = `${out.join(eol)}${eol}`;

  // Se escribe a un archivo temporal y se renombra: si algo falla a medias, el .env original queda intacto.
  const mode = exists ? fs.statSync(file).mode & 0o777 : 0o600;
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, body, { mode });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) { /* ya no está */ }
    throw new Error(`No se pudo escribir el archivo .env (${e.code || e.message}). Revisa que el servicio tenga permiso de escritura sobre él.`);
  }

  // Lo escrito vale de inmediato, sin reiniciar
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) delete process.env[k]; else process.env[k] = String(v);
  }
}

module.exports = { updateEnv, envPath };
