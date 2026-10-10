// Motor de alertas por correo. Cada 30 segundos revisa las reglas activas (las crea el administrador desde la web) y envía
// un correo cuando se cumplen. Cada aviso se manda una vez y no se repite hasta que pase el tiempo de espera de la regla
// (o, en los problemas con duración, hasta que se resuelvan), para no llenar la bandeja.
const pool = require('./db');
const mailer = require('./mailer');
const { esc, layout, button } = require('./mail-templates');
const { TZ, dayOf } = require('./partitions');

const TICK_MS = 30000;
const MIN_INTERVAL = { spike: 5 * 60000, firewall_blocks: 60000 }; // las consultas pesadas no corren cada 30 s
const RETRY_FAILED_MS = 5 * 60000;
const MAX_MAILS_PER_RULE_TICK = 10;

const KIND_LABEL = { wan_offline: 'Internet caído', ipsec_down: 'Túnel VPN caído', ip_conflict: 'Conflicto de IP', rogue_dhcp: 'Servidor DHCP intruso', arp_conflict: 'Conflicto ARP' };

const fmtTime = (d) => new Date(d).toLocaleString('es-PE', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
function human(secs) {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} días ${h % 24} h`;
}
const link = (path) => (process.env.APP_URL ? `${process.env.APP_URL}${path}` : null);

// ───────── Correo de una alerta ─────────
function alertMail(rule, c, type) {
  const resolved = type === 'resolved';
  const test = type === 'test';
  const title = resolved ? c.resolvedTitle : c.title;
  const lines = (resolved ? c.resolvedLines : c.lines) || [];
  const url = c.link ? link(c.link) : null;
  const subject = `[Omada Logs] ${test ? 'PRUEBA — ' : ''}${resolved ? 'Resuelto — ' : ''}${c.clientName ? `${c.clientName}: ` : ''}${title}`;
  const text = [
    test ? 'ESTE ES UN CORREO DE PRUEBA' : '', `${resolved ? 'Resuelto: ' : ''}${title}`, c.clientName ? `Cliente: ${c.clientName}` : '',
    ...lines.map(([k, v]) => `${k}: ${v}`), url ? `\nVer en Omada Logs: ${url}` : '', `\nRegla: ${rule.name}`,
  ].filter(Boolean).join('\n');
  const rows = lines.map(([k, v]) => `<tr><td style="padding:6px 12px;color:#52666a;width:140px;vertical-align:top">${esc(k)}</td><td style="padding:6px 12px">${esc(v)}</td></tr>`).join('');
  const html = layout({
    title: `${test ? '[PRUEBA] ' : ''}${resolved ? '✔ ' : ''}${title}`,
    body: `${c.clientName ? `<p style="margin:0 0 12px;color:#52666a">Cliente: <strong style="color:#14262a">${esc(c.clientName)}</strong></p>` : ''}
${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f7f9f8;border:1px solid #dfe5e2;border-radius:6px;width:100%">${rows}</table>` : ''}
${url ? button(url, 'Ver en Omada Logs') : ''}`,
    footer: `Regla: ${esc(rule.name)}. ${test ? 'Esto es solo una prueba; no hay ningún problema real.' : 'Recibes este aviso porque estás en la lista de esa regla.'}`,
  });
  return { subject, text, html };
}

async function deliver(rule, c, type) {
  const mail = alertMail(rule, c, type);
  let status = 'sent';
  let error = null;
  try {
    await mailer.send({ to: rule.recipients, ...mail });
  } catch (e) {
    status = 'failed';
    error = e.message;
  }
  await pool.query(
    `INSERT INTO alert_history (rule_id, rule_name, client_id, client_name, subject, type, status, error, recipients)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [rule.id, rule.name, c.clientId || null, c.clientName || null, mail.subject, type, status, error, rule.recipients]
  );
  if (status === 'sent' && type !== 'test') await pool.query('UPDATE alert_rules SET last_fired = now() WHERE id = $1', [rule.id]);
  return status === 'sent';
}

// ───────── Decidir qué avisos enviar ─────────
// candidates: [{ key, bad, once, clientId, clientName, title, lines, resolvedTitle, resolvedLines, link }]
async function settle(rule, candidates, { sweep = false } = {}) {
  const st = new Map((await pool.query('SELECT * FROM alert_state WHERE rule_id = $1', [rule.id])).rows.map((r) => [r.key, r]));
  const setState = (key, active, failed, sentNow) => pool.query(
    `INSERT INTO alert_state (rule_id, key, active, failed, last_sent) VALUES ($1, $2, $3, $4, ${sentNow ? 'now()' : 'NULL'})
     ON CONFLICT (rule_id, key) DO UPDATE SET active = EXCLUDED.active, failed = EXCLUDED.failed${sentNow ? ', last_sent = now()' : ''}`,
    [rule.id, key, active, failed]
  );
  let sent = 0;
  let failures = 0;
  const now = Date.now();

  for (const c of candidates) {
    const s = st.get(c.key);
    if (c.bad) {
      let send = false;
      if (!s) send = true;
      else if (s.active) send = !c.once && now - new Date(s.last_sent).getTime() >= rule.cooldown_min * 60000;
      else if (s.failed) send = now - new Date(s.last_sent).getTime() >= RETRY_FAILED_MS;
      else send = true; // el problema volvió a ocurrir después de resolverse
      if (send && sent < MAX_MAILS_PER_RULE_TICK) {
        sent += 1;
        const ok = await deliver(rule, c, 'alert');
        if (!ok) failures += 1;
        await setState(c.key, ok, !ok, true);
      }
    } else if (s && s.active) {
      await setState(c.key, false, false, false);
      if (rule.notify_resolved && c.resolvedTitle) await deliver(rule, c, 'resolved');
    }
  }
  if (sweep) {
    const keys = new Set(candidates.map((c) => c.key));
    for (const [key, s] of st) if (s.active && !keys.has(key)) await setState(key, false, false, false);
  }
  return { sent, failures };
}

// ───────── Cada tipo de regla ─────────
const scope = (rule, col) => (rule.client_id ? `AND ${col} = ${Number(rule.client_id)}` : '');

const EVAL = {
  // Un problema con duración (internet o VPN caída, conflicto de IP, DHCP intruso)
  async incident(rule) {
    const { kinds, minMinutes = 0 } = rule.params;
    const { rows } = await pool.query(
      `SELECT i.*, c.client_name FROM incidents i JOIN clients_ports c ON c.id = i.client_id
       WHERE i.kind = ANY($1::text[]) ${scope(rule, 'i.client_id')} AND (i.status = 'open' OR i.resolved_at > now() - interval '2 days')
       ORDER BY i.opened_at`,
      [kinds]
    );
    const out = [];
    for (const i of rows) {
      const base = { key: `inc:${i.id}`, once: true, clientId: i.client_id, clientName: i.client_name, link: `/clientes/${i.client_id}/incidentes` };
      if (i.status === 'open') {
        const secs = (Date.now() - new Date(i.opened_at).getTime()) / 1000;
        if (secs < minMinutes * 60) continue; // todavía no cumple el tiempo mínimo
        out.push({
          ...base, bad: true, title: i.title,
          lines: [['Tipo', KIND_LABEL[i.kind] || i.kind], ['Afecta a', i.key], ['Desde', fmtTime(i.opened_at)], ['Lleva', human(secs)], ['Avisos', String(i.event_count)]],
        });
      } else {
        out.push({
          ...base, bad: false, resolvedTitle: i.title,
          resolvedLines: [['Tipo', KIND_LABEL[i.kind] || i.kind], ['Terminó', fmtTime(i.resolved_at)], ['Duró', human((new Date(i.resolved_at) - new Date(i.opened_at)) / 1000)]],
        });
      }
    }
    return { candidates: out };
  },

  // Un cliente con el puerto encendido que dejó de enviar
  async client_silent(rule) {
    const minutes = rule.params.minutes || 15;
    const { rows } = await pool.query(
      `SELECT c.id, c.client_name, c.port_number, c.protocol, c.last_seen,
              GREATEST(COALESCE(c.last_seen, 'epoch'), COALESCE(c.activated_at, 'epoch'), c.created_at) AS ref
       FROM clients_ports c WHERE c.is_active ${scope(rule, 'c.id')}`
    );
    return {
      candidates: rows.map((c) => {
        const secs = (Date.now() - new Date(c.ref).getTime()) / 1000;
        return {
          key: `silent:${c.id}`, bad: secs >= minutes * 60, clientId: c.id, clientName: c.client_name, link: `/clientes/${c.id}`,
          title: `Sin señal desde hace ${human(secs)}`,
          lines: [['Puerto', `${c.port_number} ${c.protocol.toUpperCase()}`], ['Último log', c.last_seen ? fmtTime(c.last_seen) : 'nunca'], ['Umbral', `${minutes} min sin recibir`]],
          resolvedTitle: 'Volvió a recibir logs',
          resolvedLines: [['Puerto', `${c.port_number} ${c.protocol.toUpperCase()}`], ['Último log', c.last_seen ? fmtTime(c.last_seen) : '—']],
        };
      }),
    };
  },

  // Eventos nuevos que cumplen una severidad y/o un tipo
  async events(rule) {
    const { maxLevel = 4, modules = [] } = rule.params;
    const maxId = Number((await pool.query('SELECT COALESCE(max(id), 0) AS m FROM events')).rows[0].m);
    const { rows } = await pool.query(
      `SELECT e.client_id, c.client_name, e.module, e.summary, min(COALESCE(e.severity, 6)) AS sev, count(*) AS n, max(e.ts) AS last_ts
       FROM events e JOIN clients_ports c ON c.id = e.client_id
       WHERE e.id > $1 AND e.id <= $2 AND NOT e.pending AND COALESCE(e.severity, 6) <= $3
         AND (cardinality($4::text[]) = 0 OR e.module = ANY($4::text[])) ${scope(rule, 'e.client_id')}
       GROUP BY e.client_id, c.client_name, e.module, e.summary`,
      [rule.cursor_id, maxId, maxLevel, modules]
    );
    const candidates = rows.map((r) => ({
      key: `ev:${r.client_id}:${r.module}:${r.summary}`.slice(0, 300), bad: true, clientId: r.client_id, clientName: r.client_name,
      link: `/clientes/${r.client_id}/registros`, title: r.summary,
      lines: [['Tipo', r.module], ['Cuántas veces', String(r.n)], ['Último', fmtTime(r.last_ts)]],
    }));
    return {
      candidates,
      sweep: true,
      after: async () => {
        // Un aviso que falló se sigue reintentando durante 1 hora; pasado ese tiempo se da por perdido para no quedar atascado
        await pool.query("UPDATE alert_state SET failed = FALSE WHERE rule_id = $1 AND failed AND last_sent < now() - interval '60 minutes'", [rule.id]);
        const pending = await pool.query('SELECT 1 FROM alert_state WHERE rule_id = $1 AND failed LIMIT 1', [rule.id]);
        if (!pending.rowCount) await pool.query('UPDATE alert_rules SET cursor_id = $2 WHERE id = $1', [rule.id, maxId]);
      },
    };
  },

  // Muchos bloqueos del firewall desde un mismo origen
  async firewall_blocks(rule) {
    const { count = 20, minutes = 5 } = rule.params;
    const { rows } = await pool.query(
      `SELECT e.client_id, c.client_name, e.fields->>'src' AS src, count(*) AS n, max(e.ts) AS last_ts,
              (array_agg(DISTINCT e.fields->>'dst'))[1:3] AS dsts, (array_agg(DISTINCT e.fields->>'dport'))[1:5] AS ports
       FROM events e JOIN clients_ports c ON c.id = e.client_id
       WHERE e.module = 'firewall' AND NOT e.pending AND e.ts > now() - ($1 * interval '1 minute')
         AND lower(COALESCE(e.fields->>'action', '')) NOT LIKE 'allow%' ${scope(rule, 'e.client_id')}
       GROUP BY e.client_id, c.client_name, e.fields->>'src' HAVING count(*) >= $2`,
      [minutes, count]
    );
    return {
      sweep: true,
      candidates: rows.map((r) => ({
        key: `fwb:${r.client_id}:${r.src}`, bad: true, clientId: r.client_id, clientName: r.client_name, link: `/clientes/${r.client_id}/registros`,
        title: `${r.src} acumula ${r.n} bloqueos en ${minutes} min`,
        lines: [['Origen', r.src], ['Bloqueos', String(r.n)], ['Destinos', (r.dsts || []).join(', ')], ['Puertos', (r.ports || []).join(', ')], ['Último', fmtTime(r.last_ts)]],
      })),
    };
  },

  // Un equipo que nunca se había visto en la red. Los primeros 60 min de un cliente son de aprendizaje: ahí todo es "nuevo".
  async new_device(rule) {
    const { rows } = await pool.query(
      `SELECT d.*, c.client_name FROM client_devices d JOIN clients_ports c ON c.id = d.client_id
       JOIN (SELECT client_id, min(first_seen) AS learned FROM client_devices GROUP BY client_id) f ON f.client_id = d.client_id
       WHERE d.first_seen > $1 AND d.first_seen > f.learned + interval '60 minutes' ${scope(rule, 'd.client_id')}
       ORDER BY d.first_seen`,
      [rule.created_at]
    );
    return {
      candidates: rows.map((d) => ({
        key: `dev:${d.client_id}:${d.mac}`, bad: true, once: true, clientId: d.client_id, clientName: d.client_name, link: `/clientes/${d.client_id}/registros`,
        title: `Equipo nuevo en la red: ${d.mac}`,
        lines: [['MAC', d.mac], ['IP', d.ip || '—'], ['Visto por primera vez', fmtTime(d.first_seen)]],
      })),
    };
  },

  // Mucha más actividad de lo normal
  async spike(rule) {
    const { windowMin = 15, factor = 3, minEvents = 300 } = rule.params;
    const { rows } = await pool.query(
      `SELECT c.id, c.client_name,
              count(e.id) FILTER (WHERE e.ts > now() - ($1 * interval '1 minute')) AS cur,
              count(e.id) FILTER (WHERE e.ts <= now() - ($1 * interval '1 minute')) AS base
       FROM clients_ports c LEFT JOIN events e ON e.client_id = c.id AND e.ts > now() - interval '24 hours' AND NOT e.pending
       WHERE c.is_active ${scope(rule, 'c.id')} GROUP BY c.id, c.client_name`,
      [windowMin]
    );
    const windows = Math.max(1, (24 * 60 - windowMin) / windowMin);
    return {
      candidates: rows.map((r) => {
        const cur = Number(r.cur);
        const avg = Number(r.base) / windows;
        return {
          key: `spike:${r.id}`, bad: cur >= minEvents && cur >= factor * Math.max(avg, 1), clientId: r.id, clientName: r.client_name, link: `/clientes/${r.id}`,
          title: `Actividad ${avg >= 1 ? `${(cur / avg).toFixed(1)} veces` : 'muy'} por encima de lo normal`,
          lines: [[`Últimos ${windowMin} min`, `${cur.toLocaleString('es')} eventos`], ['Lo normal', `${Math.round(avg).toLocaleString('es')} cada ${windowMin} min`]],
          resolvedTitle: 'La actividad volvió a la normalidad', resolvedLines: [[`Últimos ${windowMin} min`, `${cur.toLocaleString('es')} eventos`]],
        };
      }),
    };
  },

  // Un resumen de las últimas 24 horas, una vez al día
  async daily_summary(rule) {
    const hour = rule.params.hour === undefined ? 8 : rule.params.hour;
    const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date())) % 24;
    if (nowHour < hour) return { candidates: [] };
    const { rows } = await pool.query(
      `SELECT c.id, c.client_name,
              count(e.id) AS total,
              count(e.id) FILTER (WHERE COALESCE(e.severity, 6) <= 3) AS errors,
              count(e.id) FILTER (WHERE e.severity = 4) AS warnings,
              (SELECT count(*) FROM incidents i WHERE i.client_id = c.id AND i.opened_at > now() - interval '24 hours') AS inc_new,
              (SELECT count(*) FROM incidents i WHERE i.client_id = c.id AND i.status = 'open') AS inc_open
       FROM clients_ports c LEFT JOIN events e ON e.client_id = c.id AND e.ts > now() - interval '24 hours' AND NOT e.pending
       WHERE true ${scope(rule, 'c.id')} GROUP BY c.id, c.client_name ORDER BY c.client_name`
    );
    const lines = rows.length
      ? rows.map((r) => [r.client_name, `${Number(r.total).toLocaleString('es')} eventos · ${r.errors} errores · ${r.warnings} avisos · ${r.inc_new} incidentes nuevos · ${r.inc_open} abiertos`])
      : [['Clientes', 'Todavía no hay clientes']];
    return {
      sweep: true,
      candidates: [{ key: `daily:${dayOf(new Date())}`, bad: true, once: true, title: 'Resumen de las últimas 24 horas', lines, link: '/' }],
    };
  },
};

// ───────── Ciclo ─────────
let running = false;
const lastRun = new Map();
let lastCleanup = 0;

async function tick({ force = false } = {}) {
  if (running) return;
  running = true;
  try {
    if (!mailer.isConfigured()) return; // sin correo no se evalúa nada, para no marcar avisos como enviados sin haberlos enviado
    const { rows: rules } = await pool.query('SELECT * FROM alert_rules WHERE enabled ORDER BY id');
    for (const rule of rules) {
      const min = MIN_INTERVAL[rule.kind] || 0;
      if (!force && Date.now() - (lastRun.get(rule.id) || 0) < min) continue;
      lastRun.set(rule.id, Date.now());
      try {
        const r = await EVAL[rule.kind](rule);
        const res = await settle(rule, r.candidates, { sweep: r.sweep });
        if (r.after) await r.after(res);
      } catch (e) {
        console.error(`Alerta «${rule.name}»:`, e.message);
      }
    }
    if (Date.now() - lastCleanup > 3600000) {
      lastCleanup = Date.now();
      await pool.query("DELETE FROM alert_history WHERE ts < now() - interval '90 days'");
    }
  } finally {
    running = false;
  }
}

// Correo de prueba de una regla, con datos de ejemplo
async function sendTest(rule) {
  const c = {
    clientName: 'Cliente de ejemplo', title: 'Así se verá este aviso', link: '/',
    lines: [['Regla', rule.name], ['Se envía a', rule.recipients.join(', ')], ['Tiempo entre avisos', `${rule.cooldown_min} min`]],
  };
  return deliver(rule, c, 'test');
}

function start() {
  const t = setInterval(() => tick().catch((e) => console.error('Alertas:', e.message)), TICK_MS);
  t.unref();
  return t;
}

module.exports = { start, tick, sendTest, KIND_LABEL };
