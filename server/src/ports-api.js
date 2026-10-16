const express = require('express');
const pool = require('./db');
const { auth, need } = require('./middleware');
const collector = require('./collector');
const { audit } = require('./settings');
const firewall = require('./firewall');

const router = express.Router();
const guard = (perm) => [auth, need(perm)];

// Puertos que usa la propia aplicación: no se pueden asignar a un cliente
const RESERVED = new Set([Number(process.env.PORT) || 4000, 4000, 5173, 5432]);
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function parseBody(b, partial = false) {
  const out = {};
  if (!partial || b.clientName !== undefined) {
    const name = String(b.clientName || '').trim();
    if (!name || name.length > 80) return { error: 'Escribe el nombre del cliente (hasta 80 caracteres).' };
    out.clientName = name;
  }
  if (!partial || b.port !== undefined) {
    const port = Number(b.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'El puerto debe ser un número entre 1 y 65535.' };
    if (RESERVED.has(port)) return { error: `El puerto ${port} lo usa la propia aplicación. Elige otro.` };
    out.port = port;
  }
  if (!partial || b.protocol !== undefined) {
    if (!['udp', 'tcp'].includes(b.protocol)) return { error: 'Elige el protocolo: UDP o TCP.' };
    out.protocol = b.protocol;
  }
  if (b.allowedIps !== undefined) {
    const list = (Array.isArray(b.allowedIps) ? b.allowedIps : String(b.allowedIps).split(/[\s,;]+/)).map((s) => s.trim()).filter(Boolean);
    const bad = list.find((ip) => !IPV4.test(ip));
    if (bad) return { error: `“${bad}” no es una dirección IP válida.` };
    out.allowedIps = list.length ? [...new Set(list)] : null;
  }
  return { value: out };
}

const shapePort = (r, extra = {}) => ({
  id: r.id,
  clientName: r.client_name,
  port: r.port_number,
  protocol: r.protocol,
  isActive: r.is_active,
  allowedIps: r.allowed_ips || [],
  lastSeen: r.last_seen,
  createdAt: r.created_at,
  ...collector.status(r.id),
  ...extra,
});

// Encender: abre el puerto en la aplicación, lo marca activo y lo abre en el firewall.
// Si algo falla, deja todo como estaba.
async function turnOn(row) {
  await collector.openPort(row); // lanza si el puerto está ocupado o no hay permiso
  await pool.query('UPDATE clients_ports SET is_active = TRUE, activated_at = now() WHERE id = $1', [row.id]);
  try {
    await firewall.sync();
  } catch (e) {
    collector.closePort(row.id);
    await pool.query('UPDATE clients_ports SET is_active = FALSE WHERE id = $1', [row.id]);
    firewall.sync().catch(() => {}); // intentar volver a un estado consistente
    throw new Error(`El puerto se pudo abrir en la aplicación, pero no en el firewall. ${e.message}`);
  }
  const { rows } = await pool.query('SELECT * FROM clients_ports WHERE id = $1', [row.id]);
  return rows[0];
}

// Apagar: cierra el puerto y retira su regla del firewall. Si el firewall falla, el puerto queda apagado igual y se avisa.
async function turnOff(row) {
  collector.closePort(row.id);
  const { rows } = await pool.query('UPDATE clients_ports SET is_active = FALSE WHERE id = $1 RETURNING *', [row.id]);
  let warning = null;
  try {
    await firewall.sync();
  } catch (e) {
    warning = `El puerto se apagó, pero no se pudo cerrar en el firewall. ${e.message}`;
  }
  return { row: rows[0], warning };
}

router.get('/ports', guard('ports.view'), async (req, res) => {
  const [ports, counts, ips, inc] = await Promise.all([
    pool.query('SELECT * FROM clients_ports ORDER BY port_number, protocol'),
    pool.query("SELECT client_id, count(*) AS n FROM events WHERE ts >= now() - interval '24 hours' AND NOT pending AND client_id IS NOT NULL GROUP BY 1"),
    pool.query('SELECT client_id, ip, first_seen, last_seen FROM client_ips ORDER BY last_seen DESC'),
    pool.query("SELECT client_id, count(*) AS n FROM incidents WHERE status = 'open' GROUP BY 1"),
  ]);
  const n24 = Object.fromEntries(counts.rows.map((r) => [r.client_id, Number(r.n)]));
  const openInc = Object.fromEntries(inc.rows.map((r) => [r.client_id, Number(r.n)]));
  const ipsBy = {};
  ips.rows.forEach((r) => { (ipsBy[r.client_id] = ipsBy[r.client_id] || []).push({ ip: r.ip, firstSeen: r.first_seen, lastSeen: r.last_seen }); });
  res.json({
    ports: ports.rows.map((r) => shapePort(r, { events24h: n24[r.id] || 0, openIncidents: openInc[r.id] || 0, sourceIps: (ipsBy[r.id] || []).slice(0, 6) })),
    firewallManaged: firewall.enabled(), // true = la web abre y cierra los puertos en el firewall
  });
});

router.post('/ports', guard('ports.manage'), async (req, res) => {
  const p = parseBody(req.body || {});
  if (p.error) return res.status(400).json({ error: p.error });
  const v = p.value;
  try {
    const { rows } = await pool.query(
      `INSERT INTO clients_ports (client_name, port_number, protocol, allowed_ips, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [v.clientName, v.port, v.protocol, v.allowedIps || null, req.user.id]
    );
    await audit(req.user.id, 'port.create', { id: rows[0].id, client: v.clientName, port: v.port, protocol: v.protocol });

    // "Encender ahora": el cliente nace con su puerto abierto. Si no se puede, el cliente se crea igual, apagado, y se avisa.
    let created = rows[0];
    let warning = null;
    if ((req.body || {}).activate === true) {
      try {
        created = await turnOn(created);
        await audit(req.user.id, 'port.on', { id: created.id, client: created.client_name, port: created.port_number, protocol: created.protocol });
      } catch (e) {
        warning = `El cliente se creó, pero el puerto quedó apagado. ${e.message}`;
      }
    }
    res.status(201).json({ port: shapePort(created, { events24h: 0 }), warning });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: `Ya existe un cliente en el puerto ${v.port}/${v.protocol.toUpperCase()}.` });
    throw e;
  }
});

// Importación masiva: crea muchos clientes de una vez (por ejemplo, las sedes copiadas de una hoja de cálculo).
// Todo o nada: si una fila tiene un problema no se crea ninguna, y se devuelve qué fila falló.
const IMPORT_MAX = 500;

router.post('/ports/import', guard('ports.manage'), async (req, res) => {
  const b = req.body || {};
  if (!['udp', 'tcp'].includes(b.protocol)) return res.status(400).json({ error: 'Elige el protocolo: UDP o TCP.' });
  if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'No hay filas para importar.' });
  if (b.items.length > IMPORT_MAX) return res.status(400).json({ error: `Se pueden importar hasta ${IMPORT_MAX} clientes a la vez.` });

  const problems = [];
  const values = [];
  const seen = new Map();
  b.items.forEach((it, row) => {
    const p = parseBody({ ...(it || {}), protocol: b.protocol });
    if (p.error) return problems.push({ row, error: p.error });
    if (seen.has(p.value.port)) return problems.push({ row, error: `El puerto ${p.value.port} se repite en la lista.` });
    seen.set(p.value.port, row);
    values.push(p.value);
  });
  const { rows: taken } = await pool.query(
    'SELECT client_name, port_number FROM clients_ports WHERE protocol = $1 AND port_number = ANY($2::int[])',
    [b.protocol, [...seen.keys()]]
  );
  taken.forEach((t) => problems.push({ row: seen.get(t.port_number), error: `El puerto ${t.port_number} ya es de “${t.client_name}”.` }));
  if (problems.length) {
    problems.sort((a, c) => a.row - c.row);
    return res.status(400).json({ error: `Hay ${problems.length} fila${problems.length === 1 ? '' : 's'} con problemas. No se creó ningún cliente.`, problems });
  }

  const client = await pool.connect();
  let created;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO clients_ports (client_name, port_number, protocol, allowed_ips, created_by)
       SELECT v.name, v.port, $3, CASE WHEN v.ips = '' THEN NULL ELSE string_to_array(v.ips, ',') END, $4
       FROM unnest($1::text[], $2::int[], $5::text[]) AS v(name, port, ips)
       RETURNING *`,
      [values.map((v) => v.clientName), values.map((v) => v.port), b.protocol, req.user.id, values.map((v) => (v.allowedIps || []).join(','))]
    );
    await client.query('COMMIT');
    created = rows;
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Otro usuario acaba de ocupar uno de esos puertos. Revisa la lista y vuelve a intentar.' });
    throw e;
  } finally {
    client.release();
  }
  await audit(req.user.id, 'port.import', { count: created.length, protocol: b.protocol, ports: created.map((r) => r.port_number) });

  // "Encender ahora": se abren todos en la aplicación y el firewall se sincroniza una sola vez al final.
  const warnings = [];
  if (b.activate === true) {
    const opened = [];
    for (const row of created) {
      try {
        await collector.openPort(row);
        opened.push(row.id);
      } catch (e) {
        warnings.push(`${row.client_name} (${row.port_number}): ${e.message}`);
      }
    }
    if (opened.length) {
      await pool.query('UPDATE clients_ports SET is_active = TRUE, activated_at = now() WHERE id = ANY($1::int[])', [opened]);
      try {
        await firewall.sync();
        await audit(req.user.id, 'port.on', { ids: opened, via: 'import' });
      } catch (e) {
        opened.forEach((id) => collector.closePort(id));
        await pool.query('UPDATE clients_ports SET is_active = FALSE WHERE id = ANY($1::int[])', [opened]);
        firewall.sync().catch(() => {});
        warnings.push(`Los clientes se crearon, pero quedaron apagados: no se pudieron abrir en el firewall. ${e.message}`);
      }
    }
  }
  const { rows: final } = await pool.query('SELECT * FROM clients_ports WHERE id = ANY($1::int[]) ORDER BY port_number', [created.map((r) => r.id)]);
  res.status(201).json({ ports: final.map((r) => shapePort(r, { events24h: 0 })), warnings });
});

router.patch('/ports/:id', guard('ports.manage'), async (req, res) => {
  const { rows: cur } = await pool.query('SELECT * FROM clients_ports WHERE id = $1', [Number(req.params.id) || 0]);
  const row = cur[0];
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const p = parseBody(req.body || {}, true);
  if (p.error) return res.status(400).json({ error: p.error });
  const v = p.value;
  const movesPort = (v.port !== undefined && v.port !== row.port_number) || (v.protocol !== undefined && v.protocol !== row.protocol);
  if (movesPort && row.is_active) return res.status(409).json({ error: 'Apaga el puerto antes de cambiar su número o protocolo.' });
  try {
    const { rows } = await pool.query(
      `UPDATE clients_ports SET client_name = $1, port_number = $2, protocol = $3, allowed_ips = $4 WHERE id = $5 RETURNING *`,
      [v.clientName ?? row.client_name, v.port ?? row.port_number, v.protocol ?? row.protocol,
        v.allowedIps !== undefined ? v.allowedIps : row.allowed_ips, row.id]
    );
    collector.refreshRow(rows[0]);
    // Si el puerto está encendido y cambiaron las IP permitidas, el firewall debe reflejarlo
    if (row.is_active && JSON.stringify(row.allowed_ips || []) !== JSON.stringify(rows[0].allowed_ips || [])) {
      try {
        await firewall.sync();
      } catch (e) {
        const back = await pool.query('UPDATE clients_ports SET allowed_ips = $1 WHERE id = $2 RETURNING *', [row.allowed_ips, row.id]);
        collector.refreshRow(back.rows[0]);
        firewall.sync().catch(() => {});
        return res.status(409).json({ error: `No se cambiaron las IP permitidas: ${e.message}` });
      }
    }
    await audit(req.user.id, 'port.update', { id: row.id, changes: v });
    res.json({ port: shapePort(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un cliente con ese puerto y protocolo.' });
    throw e;
  }
});

// Encender = abrir el puerto y empezar a recibir. Apagar = cerrarlo: el tráfico deja de aceptarse.
router.post('/ports/:id/toggle', guard('ports.toggle'), async (req, res) => {
  if (typeof (req.body || {}).active !== 'boolean') return res.status(400).json({ error: 'Indica si el puerto queda encendido o apagado.' });
  const { rows: cur } = await pool.query('SELECT * FROM clients_ports WHERE id = $1', [Number(req.params.id) || 0]);
  const row = cur[0];
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado.' });

  let updated;
  let warning = null;
  if (req.body.active) {
    try {
      updated = await turnOn(row);
    } catch (e) {
      return res.status(409).json({ error: e.message });
    }
  } else {
    const off = await turnOff(row);
    updated = off.row;
    warning = off.warning;
  }
  await audit(req.user.id, req.body.active ? 'port.on' : 'port.off', { id: row.id, client: row.client_name, port: row.port_number, protocol: row.protocol, warning });
  res.json({ port: shapePort(updated), warning });
});

router.delete('/ports/:id', guard('ports.manage'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM clients_ports WHERE id = $1 RETURNING *', [Number(req.params.id) || 0]);
  if (!rows[0]) return res.status(404).json({ error: 'Cliente no encontrado.' });
  collector.closePort(rows[0].id);
  let warning = null;
  try {
    await firewall.sync();
  } catch (e) {
    warning = `El cliente se eliminó, pero no se pudo cerrar su puerto en el firewall. ${e.message}`;
  }
  await audit(req.user.id, 'port.delete', { id: rows[0].id, client: rows[0].client_name, port: rows[0].port_number });
  res.json({ ok: true, warning });
});

// Actividad de las últimas 24 horas de cada cliente (para la pantalla "Clientes"): eventos por hora y cuántos fueron errores o avisos.
// Se calcula una vez cada pocos segundos y se comparte entre todos los que miran la pantalla.
let overviewCache = { at: 0, data: null };

router.get('/clients/overview', guard('ports.view'), async (req, res) => {
  if (overviewCache.data && Date.now() - overviewCache.at < 10000) return res.json(overviewCache.data);

  const { rows } = await pool.query(
    `SELECT client_id, date_trunc('hour', ts) AS h, count(*) AS n,
            count(*) FILTER (WHERE COALESCE(severity, 6) <= 3) AS errors,
            count(*) FILTER (WHERE severity = 4) AS warnings
     FROM events
     WHERE ts >= now() - interval '24 hours' AND NOT pending AND client_id IS NOT NULL
     GROUP BY 1, 2`
  );
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  start.setTime(start.getTime() - 23 * 3600000);

  const clients = {};
  rows.forEach((r) => {
    const c = clients[r.client_id] || (clients[r.client_id] = {
      hourly: Array(24).fill(0), hourlyErrors: Array(24).fill(0), total24h: 0, errors24h: 0, warnings24h: 0,
    });
    const idx = Math.round((new Date(r.h).getTime() - start.getTime()) / 3600000);
    if (idx >= 0 && idx < 24) {
      c.hourly[idx] += Number(r.n);
      c.hourlyErrors[idx] += Number(r.errors);
    }
    c.total24h += Number(r.n);
    c.errors24h += Number(r.errors);
    c.warnings24h += Number(r.warnings);
  });

  overviewCache = { at: Date.now(), data: { start: start.toISOString(), clients } };
  res.json(overviewCache.data);
});

module.exports = router;
