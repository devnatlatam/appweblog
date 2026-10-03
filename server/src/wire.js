// Interpreta un mensaje syslog tal como llega por la red (UDP/TCP), sin el prefijo que agregaba rsyslog.
// Acepta RFC 3164 ("<13>Oct  2 14:51:44 host tag: msg"), RFC 5424 ("<13>1 2026-10-02T14:51:44Z host app - - - msg")
// o texto sin cabecera. Reconoce estas familias:
//   · router Omada:   "dhcp_server<5>: [OMADA]..."   (el tipo y la severidad vienen dentro del mensaje)
//   · controlador:    "2026-10-02 20:08:16 SITIO - - - {json con \"operation\"}"   (auditoría de cambios)
//   · controlador:    "2026-10-02 23:42:23 SITIO - - - [gateway:NOMBRE:MAC]: texto"  (alertas reenviadas)
//   · cualquier otra cosa: queda como tipo desconocido y espera aprobación (ver classify.js)
const { MODULES, RELAY, INCIDENT_SEVERITY, stripTag } = require('./parser');
const { guessCategory, skeleton } = require('./classify');

const OMADA = /([a-z_]+)<([0-7])>:\s?(.*)$/s;
const OMADA_TAG = /([A-Za-z0-9_.-]+):\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s+[a-z_]+<[0-7]>:/;
const DEVICE_TS = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s+[a-z_]+<[0-7]>:/;
const H3164 = /^[A-Z][a-z]{2}\s+\d{1,2}\s\d{2}:\d{2}:\d{2}\s(\S+)\s(.*)$/s;
const H5424 = /^\d\s\S+\s(\S+)\s(\S+)\s\S+\s\S+\s(?:-|\[.*?\])\s?(.*)$/s;
const AUDIT = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s+(.+?)\s+-\s+-\s+-\s+(\{[\s\S]*\})\s*$/;
const RELAY_RE = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s+(.+?)\s+-\s+-\s+-\s+(?:\[gateway:([^:\]]+):([^\]]+)\]:\s*)?([^{].*)$/s;

const VERBS = {
  edited: 'se editó', added: 'se agregó', deleted: 'se eliminó', created: 'se creó', updated: 'se actualizó',
  enabled: 'se activó', disabled: 'se desactivó', removed: 'se quitó', renamed: 'se renombró', modified: 'se modificó',
};

const short = (v) => {
  if (v === undefined) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

// Compara el valor anterior y el nuevo que manda el controlador y devuelve solo lo que cambió
function diffDetails(details) {
  const out = {};
  try {
    const a = JSON.parse(details.oldValue);
    const b = JSON.parse(details.newValue);
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'id');
    let n = 0;
    for (const k of keys) {
      if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
      if (n >= 8) break;
      out[`cambio.${k}`] = `${short(a[k])} → ${short(b[k])}`;
      n += 1;
    }
  } catch (e) { /* sin detalle comparable */ }
  return out;
}

// El firewall nombra cada regla con un número (entryId). El controlador, al editarla, dice cómo se llama.
function aclFrom(op, details) {
  try {
    if (!/^Gateway ACL /.test(op)) return null;
    const nv = JSON.parse(details.newValue);
    if (nv && nv.entryId && nv.name) return { entryId: String(nv.entryId), name: String(nv.name) };
  } catch (e) { /* sin datos de la regla */ }
  return null;
}

// Auditoría del controlador Omada. Devuelve null si el mensaje no tiene esa forma.
function parseAudit(body) {
  const m = body.match(AUDIT);
  if (!m) return null;
  let json;
  try { json = JSON.parse(m[4]); } catch (e) { return null; }
  if (!json || typeof json.operation !== 'string') return null;

  const op = json.operation.trim();
  const t = op.match(/^(.*?)\s+(edited|added|deleted|created|updated|enabled|disabled|removed|renamed|modified)\s+successfully(?:\s+in\s+(.+?))?\.?$/i);
  const acl = json.details ? aclFrom(op, json.details) : null;
  return {
    deviceTs: `${m[1]} ${m[2]}`,
    category: t ? 'Configuración' : 'Controlador',
    summary: t
      ? `Configuración: ${VERBS[t[2].toLowerCase()]} ${t[1]}${t[3] ? ` (${t[3]})` : ''}`
      : `Controlador: ${op.replace(/\.$/, '')}`,
    fields: { site: m[3], operation: op, ...(json.details ? diffDetails(json.details) : {}) },
    message: op,
    acl,
  };
}

// Alertas que el controlador reenvía como texto. Se interpretan igual que las del router.
function parseRelay(body) {
  const m = body.match(RELAY_RE);
  if (!m) return null;
  const r = RELAY(m[6]);
  if (!r) return null;
  return {
    deviceTs: `${m[1]} ${m[2]}`,
    category: r.category,
    summary: r.summary,
    fields: { site: m[3], ...(m[4] ? { equipo: m[4], 'mac-equipo': m[5] } : {}), ...r.fields },
    message: m[6],
    incident: r.incident,
  };
}

// Un problema que abre un incidente sube de severidad (ver INCIDENT_SEVERITY)
function severityFor(sev, incident) {
  if (incident && incident.action === 'open' && INCIDENT_SEVERITY[incident.kind] !== undefined) {
    return Math.min(sev === null || sev === undefined ? 7 : sev, INCIDENT_SEVERITY[incident.kind]);
  }
  return sev;
}

function parseWire(text, { sourceIp, receivedAt = new Date() }) {
  let body = String(text).replace(/\0/g, '').replace(/[\r\n]+$/, '');
  if (!body.trim()) return null;
  const raw = body;

  let pri = null;
  const p = body.match(/^<(\d{1,3})>(.*)$/s);
  if (p) { pri = Number(p[1]); body = p[2]; }

  let host = null;
  const h5 = body.match(H5424);
  const h3 = h5 ? null : body.match(H3164);
  if (h5) {
    host = h5[1] !== '-' ? h5[1] : null;
    body = h5[3];
  } else if (h3) {
    host = h3[1].replace(/:$/, ''); // "ER7206:" es la etiqueta del equipo; los dos puntos no son parte del nombre
    body = h3[2];
  }

  const base = { ts: receivedAt, sourceIp, host, raw };
  const sevFromPri = pri !== null ? pri & 7 : null;

  // 1) Controlador: auditoría con JSON
  const audit = parseAudit(body);
  if (audit) {
    return { ...base, module: 'omada_audit', severity: sevFromPri, ...audit, typeKey: 'omada_audit', known: true };
  }

  // 2) Controlador: alertas reenviadas en texto
  const relay = parseRelay(body);
  if (relay) {
    return { ...base, module: 'alerta_controlador', severity: severityFor(sevFromPri, relay.incident), ...relay, typeKey: 'alerta_controlador', known: true };
  }

  // 3) Router Omada: "modulo<n>: mensaje"
  const tag = body.match(OMADA_TAG);
  if (tag) base.host = tag[1];
  const o = body.match(OMADA);
  const message = o ? o[3] : body;
  const module = o ? o[1] : 'otros';
  const severity = o ? Number(o[2]) : sevFromPri;
  const dts = body.match(DEVICE_TS);
  const common = { ...base, module, deviceTs: dts ? `${dts[1]} ${dts[2]}` : null, message };

  const known = MODULES[module] ? MODULES[module](message) : null;
  if (known) {
    return {
      ...common,
      severity: severityFor(severity, known.incident),
      category: known.category,
      summary: known.summary,
      fields: known.fields,
      incident: known.incident,
      typeKey: module,
      known: true,
    };
  }

  // 4) Desconocido: se agrupa por firma, se sugiere una categoría y queda pendiente de aprobación
  const sk = skeleton(stripTag(message));
  return {
    ...common,
    severity,
    category: guessCategory(`${module} ${message}`),
    summary: (stripTag(message) || 'Mensaje sin contenido').slice(0, 300),
    fields: {},
    typeKey: `${module}:${sk}`.toLowerCase().slice(0, 160),
    typeLabel: sk || module,
    known: false,
  };
}

module.exports = { parseWire };
