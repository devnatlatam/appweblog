// Análisis de lo que ya se guardó. Corre después de guardar cada lote, así que un fallo aquí nunca pierde ni duplica logs.
//  · Incidentes: problemas con inicio, fin y duración (internet caído, túnel VPN caído, conflicto de IP...).
//  · IP de origen: avisa cuando un cliente empieza a enviar desde una IP que no había usado antes.
//  · Nombres de ACL: el firewall solo dice el número de la regla; el controlador dice cómo se llama.
const pool = require('./db');

const aclNames = new Map();   // número de regla → nombre
const clientIps = new Map();  // cliente → Map(ip → última vez vista, en ms)
const persisted = new Map();  // 'cliente|ip' → última vez que se guardó en la base (para no escribir en cada lote)
const PERSIST_EVERY_MS = 60 * 1000;
const devices = new Map();    // 'cliente|mac' → última vez que se guardó en la base

async function load() {
  const a = await pool.query('SELECT entry_id, name FROM acl_names');
  a.rows.forEach((r) => aclNames.set(r.entry_id, r.name));
  const c = await pool.query('SELECT client_id, ip, last_seen FROM client_ips');
  c.rows.forEach((r) => {
    if (!clientIps.has(r.client_id)) clientIps.set(r.client_id, new Map());
    clientIps.get(r.client_id).set(r.ip, new Date(r.last_seen).getTime());
    persisted.set(`${r.client_id}|${r.ip}`, Date.now());
  });
  const d = await pool.query('SELECT client_id, mac FROM client_devices');
  d.rows.forEach((r) => devices.set(`${r.client_id}|${r.mac}`, Date.now()));
}

// ───────── Equipos de la red de cada cliente ─────────
// La MAC sale del DHCP ("asignó una IP a este equipo") o del firewall (MAC de origen del tráfico).
async function trackDevices(stored) {
  const seen = new Map();
  for (const { b } of stored) {
    if (b.pending) continue;
    const f = b.ev.fields || {};
    const mac = b.ev.module === 'dhcp_server' ? f.mac : b.ev.module === 'firewall' ? f.srcMac : null;
    if (!mac || !/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) continue;
    seen.set(`${b.clientId}|${mac}`, { clientId: b.clientId, mac, ip: b.ev.module === 'dhcp_server' ? f.ip : f.src });
  }
  const now = Date.now();
  for (const [key, d] of seen) {
    if (!devices.has(key)) {
      devices.set(key, now);
      await pool.query('INSERT INTO client_devices (client_id, mac, ip) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [d.clientId, d.mac, d.ip || null]);
    } else if (now - devices.get(key) > PERSIST_EVERY_MS * 5) {
      devices.set(key, now);
      await pool.query('UPDATE client_devices SET last_seen = now(), ip = COALESCE($3, ip) WHERE client_id = $1 AND mac = $2', [d.clientId, d.mac, d.ip || null]);
    }
  }
}

const aclName = (entryId) => (entryId === undefined || entryId === null ? null : aclNames.get(String(entryId)) || null);

// ───────── Incidentes ─────────
async function applyIncident(b) {
  const inc = b.ev.incident;
  const ts = b.ev.ts;
  if (inc.action === 'open') {
    // "open" abre el incidente o, si ya está abierto, lo mantiene vivo y suma el aviso
    const upd = await pool.query(
      `UPDATE incidents SET last_seen = $4, event_count = event_count + 1,
              severity = LEAST(COALESCE(severity, 7), COALESCE($5, 7))
       WHERE client_id = $1 AND kind = $2 AND key = $3 AND status = 'open'`,
      [b.clientId, inc.kind, inc.key, ts, b.ev.severity]
    );
    if (!upd.rowCount) {
      await pool.query(
        `INSERT INTO incidents (client_id, kind, key, title, severity, opened_at, last_seen, auto_close_secs)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
         ON CONFLICT (client_id, kind, key) WHERE status = 'open' DO NOTHING`,
        [b.clientId, inc.kind, inc.key, b.ev.summary, b.ev.severity, ts, inc.autoCloseSecs || null]
      );
    }
  } else if (inc.action === 'resolve') {
    await pool.query(
      `UPDATE incidents SET status = 'resolved', resolved_at = $4, last_seen = $4
       WHERE client_id = $1 AND kind = $2 AND key = $3 AND status = 'open'`,
      [b.clientId, inc.kind, inc.key, ts]
    );
  }
}

// Los problemas que se repiten (conflicto de IP, DHCP intruso) se cierran solos cuando dejan de repetirse
async function autoClose() {
  await pool.query(
    `UPDATE incidents SET status = 'resolved', resolved_at = last_seen, auto_closed = TRUE
     WHERE status = 'open' AND auto_close_secs IS NOT NULL AND last_seen < now() - (auto_close_secs * interval '1 second')`
  );
}

// ───────── Nombres de ACL ─────────
async function saveAcl(acl) {
  if (aclNames.get(acl.entryId) === acl.name) return;
  aclNames.set(acl.entryId, acl.name);
  await pool.query(
    `INSERT INTO acl_names (entry_id, name) VALUES ($1, $2)
     ON CONFLICT (entry_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
    [acl.entryId, acl.name]
  );
}

// ───────── IP de origen de cada cliente ─────────
function ago(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} días`;
}

async function trackIps(stored, collector) {
  const byClient = new Map();
  for (const { b } of stored) {
    const c = byClient.get(b.clientId) || { name: b.clientName, port: b.port, ips: new Set() };
    c.ips.add(b.ev.sourceIp);
    byClient.set(b.clientId, c);
  }
  const touch = [];
  const now = Date.now();
  for (const [clientId, info] of byClient) {
    let known = clientIps.get(clientId);
    if (!known) { known = new Map(); clientIps.set(clientId, known); }
    for (const ip of info.ips) {
      const key = `${clientId}|${ip}`;
      if (!known.has(ip)) {
        const others = [...known.entries()].sort((x, y) => y[1] - x[1]);
        known.set(ip, now);
        persisted.set(key, now);
        await pool.query('INSERT INTO client_ips (client_id, ip) VALUES ($1, $2) ON CONFLICT DO NOTHING', [clientId, ip]);
        if (others.length) {
          const [prevIp, prevMs] = others[0];
          const text = `Nueva IP de origen: ${ip} (antes enviaba desde ${prevIp}, vista por última vez hace ${ago(now - prevMs)})`;
          await collector.storeSynthetic(
            { clientId, clientName: info.name, port: info.port },
            {
              ts: new Date(), deviceTs: null, sourceIp: ip, host: null, module: 'cliente_ip', severity: 4,
              category: 'Conectividad', summary: text, message: text, raw: `(generado por el sistema) ${text}`,
              fields: { nueva: ip, anterior: prevIp, 'anterior-visto': new Date(prevMs).toISOString() },
              typeKey: 'cliente_ip', known: true,
            }
          );
        }
      } else {
        known.set(ip, now);
        if (now - (persisted.get(key) || 0) > PERSIST_EVERY_MS) { persisted.set(key, now); touch.push([clientId, ip]); }
      }
    }
  }
  if (touch.length) {
    await pool.query(
      `UPDATE client_ips SET last_seen = now() FROM unnest($1::int[], $2::text[]) AS t(c, i)
       WHERE client_ips.client_id = t.c AND client_ips.ip = t.i`,
      [touch.map((t) => t[0]), touch.map((t) => t[1])]
    );
  }
}

// `stored` es [{ b, id }] con lo recién guardado, en orden de llegada
async function process(stored, collector) {
  for (const { b } of stored) {
    if (b.pending) continue;
    if (b.ev.incident) await applyIncident(b);
    if (b.ev.acl) await saveAcl(b.ev.acl);
  }
  await trackIps(stored, collector);
  await trackDevices(stored);
}

module.exports = { load, process, autoClose, aclName };
