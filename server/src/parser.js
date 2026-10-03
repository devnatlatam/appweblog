// Convierte una línea de syslog del router (vía rsyslog) en un evento estructurado.
//
//   2026-10-02T14:51:44+00:00 179.7.94.149 ER7206: 2026-10-02 14:51:44 dhcp_server<5>: [OMADA]DHCP Server allocated ...
//   └ hora del receptor ┘     └ origen ┘    └ equipo ┘ └ hora del equipo ┘ └ módulo<nivel> ┘ └ mensaje ┘
const LINE = /^(\S+)\s+(\S+)\s+([^\s:]+):\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+([a-z_]+)<([0-7])>:\s?(.*)$/;
const MAC = '[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}';

const stripTag = (m) => m.replace(/^\[OMADA\]/, '').replace(/^\[MARK\]/, '').trim();
const stripDot = (s) => s.replace(/\.$/, '');

// Catálogo de módulos conocidos. Cada uno devuelve { category, summary, fields } o null si no reconoce el mensaje.
// Los módulos que no estén aquí se guardan igual (categoría "Otros") con su texto original.
const MODULES = {
  dhcp_server(msg) {
    const m = msg.match(new RegExp(`allocated IP address (\\S+) for the \\[client:(${MAC})\\]`));
    if (!m) return null;
    return {
      category: 'Red',
      summary: `El servidor DHCP asignó ${m[1]} al equipo ${m[2].toLowerCase()}`,
      fields: { ip: m[1], mac: m[2].toLowerCase() },
    };
  },

  ip_conflict(msg) {
    // La IP confiable va al final ("conflicted ip: X."). La que aparece al principio viene pegada a otro número.
    const used = msg.match(new RegExp(`client\\[(${MAC})\\]\\s+client\\[(${MAC})\\].*?used conflicted ip:\\s*(\\S+)`));
    if (used) {
      const ip = stripDot(used[3]);
      return {
        category: 'Red',
        summary: `Dos equipos están usando la misma IP ${ip}`,
        fields: { ip, mac1: used[1].toLowerCase(), mac2: used[2].toLowerCase() },
      };
    }
    const resolved = msg.match(/conflicted ip resolved:\s*(\S+)/);
    if (resolved) {
      const ip = stripDot(resolved[1]);
      return { category: 'Red', summary: `Se resolvió el conflicto de la IP ${ip}`, fields: { ip } };
    }
    return null;
  },
};

const PORTS = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 80: 'HTTP', 110: 'POP3', 123: 'NTP',
  143: 'IMAP', 161: 'SNMP', 443: 'HTTPS', 445: 'SMB', 514: 'Syslog', 993: 'IMAPS', 1433: 'SQL Server',
  3306: 'MySQL', 3389: 'Escritorio remoto', 5432: 'PostgreSQL', 5060: 'SIP', 8080: 'HTTP alterno',
};

// Mensajes de ACL: "[ACL]GATEWAY=..,DESC=..,ACTION=Allow,SRC_MAC=..,DST_MAC=..,SRC=..,DST=..,PROTO=UDP,Sport=..,Dport=.."
MODULES.firewall = (msg) => {
  if (!msg.startsWith('[ACL]')) return null;
  const kv = {};
  msg.slice(5).split(',').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) kv[p.slice(0, i)] = p.slice(i + 1);
  });
  if (!kv.ACTION || !kv.SRC || !kv.DST) return null;

  const action = kv.ACTION;
  const verb = /^allow/i.test(action) ? 'Permitido' : /^(deny|drop|block|reject)/i.test(action) ? 'Bloqueado' : action;
  const service = PORTS[kv.Dport] ? ` (${PORTS[kv.Dport]})` : '';
  const dport = kv.Dport ? `:${kv.Dport}` : '';
  return {
    category: 'Firewall',
    summary: `${verb} ${kv.PROTO || ''} de ${kv.SRC} a ${kv.DST}${dport}${service}`.replace(/\s+/g, ' '),
    fields: {
      action,
      src: kv.SRC,
      dst: kv.DST,
      proto: kv.PROTO,
      sport: kv.Sport ? Number(kv.Sport) : undefined,
      dport: kv.Dport ? Number(kv.Dport) : undefined,
      srcMac: kv.SRC_MAC ? kv.SRC_MAC.toLowerCase() : undefined,
      dstMac: kv.DST_MAC ? kv.DST_MAC.toLowerCase() : undefined,
      rule: kv.DESC,
      gateway: kv.GATEWAY,
    },
  };
};

function parseLine(line) {
  const raw = line.replace(/\r$/, '');
  const m = raw.match(LINE);
  if (!m) return null;

  const [, receivedAt, sourceIp, host, deviceTs, module, sev, message] = m;
  const ts = new Date(receivedAt);
  if (Number.isNaN(ts.getTime())) return null;

  const known = MODULES[module] ? MODULES[module](message) : null;
  return {
    ts,
    deviceTs,
    sourceIp,
    host,
    module,
    severity: Number(sev),
    category: known ? known.category : 'Otros',
    summary: known ? known.summary : stripTag(message),
    fields: known ? known.fields : {},
    message,
    raw,
  };
}

module.exports = { parseLine, MODULES, stripTag };
