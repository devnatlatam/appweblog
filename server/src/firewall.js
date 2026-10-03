// Abre y cierra puertos en el firewall del servidor (ufw) según los clientes encendidos.
//
// La web NO ejecuta comandos de firewall ni tiene permisos de administrador. Solo escribe la lista de puertos que deben
// estar abiertos en un archivo; un programa aparte con permisos de administrador (deploy/syslogweb-fw-sync, lanzado por
// systemd al cambiar el archivo) la valida y aplica las reglas, y deja el resultado en un archivo de estado.
//
// Se activa con FIREWALL_DRIVER=ufw. Sin eso (por ejemplo en desarrollo en Windows) no hace nada: el firewall se administra a mano.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./db');

const enabled = () => (process.env.FIREWALL_DRIVER || 'none').toLowerCase() === 'ufw';
const dir = () => process.env.FIREWALL_DIR || '/var/lib/syslogweb';
const timeoutMs = () => Number(process.env.FIREWALL_TIMEOUT_MS) || 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FirewallError extends Error {}

async function readStatus() {
  try { return JSON.parse(await fs.promises.readFile(path.join(dir(), 'firewall.status'), 'utf8')); } catch (e) { return null; }
}

async function doSync() {
  const { rows } = await pool.query(
    'SELECT port_number, protocol, allowed_ips FROM clients_ports WHERE is_active ORDER BY port_number, protocol'
  );
  const token = crypto.randomBytes(8).toString('hex');
  const lines = rows.map((r) => `${r.protocol} ${r.port_number} ${r.allowed_ips && r.allowed_ips.length ? r.allowed_ips.join(',') : 'any'}`);
  const body = ['# syslogweb: puertos que deben estar abiertos', `# token=${token}`, ...lines, '# end'].join('\n') + '\n';
  try {
    await fs.promises.writeFile(path.join(dir(), 'firewall.desired'), body, { mode: 0o644 });
  } catch (e) {
    throw new FirewallError(`No se pudo escribir la lista de puertos del firewall (${e.code || e.message}).`);
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs()) {
    const st = await readStatus();
    if (st && st.token === token) {
      if (st.ok) return { managed: true };
      throw new FirewallError(`El firewall rechazó el cambio: ${(st.errors || []).join(' ') || 'error desconocido'}`);
    }
    await sleep(250);
  }
  throw new FirewallError('El firewall del servidor no respondió. Revisa que el servicio syslogweb-fw esté activo.');
}

// Las sincronizaciones se hacen de una en una
let chain = Promise.resolve();
function sync() {
  if (!enabled()) return Promise.resolve({ managed: false });
  const run = chain.then(doSync, doSync);
  chain = run.catch(() => {});
  return run;
}

module.exports = { enabled, sync, FirewallError };
