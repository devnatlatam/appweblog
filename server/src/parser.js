// Convierte una línea de syslog del router (vía rsyslog) en un evento estructurado.
//
//   2026-10-02T14:51:44+00:00 179.7.94.149 ER7206: 2026-10-02 14:51:44 dhcp_server<5>: [OMADA]DHCP Server allocated ...
//   └ hora del receptor ┘     └ origen ┘    └ equipo ┘ └ hora del equipo ┘ └ módulo<nivel> ┘ └ mensaje ┘
//
// Cada interpretación devuelve { category, summary, fields } y, si el mensaje abre o cierra un problema con duración,
// también `incident: { kind, key, action: 'open' | 'resolve', autoCloseSecs? }`.
const LINE = /^(\S+)\s+(\S+)\s+([^\s:]+):\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+([a-z_]+)<([0-7])>:\s?(.*)$/;
const MAC = '[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}';

// El router pega "[MARK]" y un "55" a la clave del problema ("WAN355", "10.10.0.3355"). Aquí no se usa la clave pegada.
const stripTag = (m) => m.replace(/^\[OMADA\]/, '').replace(/^\[MARK\]/, '').trim();
const stripDot = (s) => s.replace(/\.$/, '');

// "WAN3", "WAN/LAN3" → "WAN3"
const wanName = (s) => { const d = (String(s).match(/\d+/) || [''])[0]; return d ? `WAN${d}` : String(s).trim(); };

// Severidad mínima (número menor = más grave) para los problemas que abren un incidente.
// El router los marca como "aviso" (5), pero una WAN caída o un túnel caído merecen aparecer en "Necesita tu atención".
const INCIDENT_SEVERITY = { wan_offline: 3, ipsec_down: 3, rogue_dhcp: 4 };

function dhcpAllocated(msg) {
  // El router a veces deja un espacio antes del corchete: "[client:70:4c:a5:38:a7:b2 ]"
  const m = msg.match(new RegExp(`allocated IP address (\\S+) for the \\[client:(${MAC})\\s*\\]`));
  if (!m) return null;
  return {
    category: 'Red',
    summary: `El servidor DHCP asignó ${m[1]} al equipo ${m[2].toLowerCase()}`,
    fields: { ip: m[1], mac: m[2].toLowerCase() },
  };
}

function rogueDhcp(msg) {
  const m = msg.match(new RegExp(`Rogue DHCP server \\(ip:([\\d.]+),\\s*mac:(${MAC})\\)\\s*is detected in (.+?)\\.?\\s*$`, 'i'));
  if (!m) return null;
  const mac = m[2].toLowerCase();
  return {
    category: 'Seguridad',
    summary: `Servidor DHCP intruso detectado en ${m[3]}: ${m[1]} (${mac})`,
    fields: { ip: m[1], mac, network: m[3] },
    incident: { kind: 'rogue_dhcp', key: m[1], action: 'open', autoCloseSecs: 90 * 60 },
  };
}

function onlineDetection(msg) {
  const m = msg.match(/The online detection result of \[([^\]]+)\] was (offline|online)/i);
  if (!m) return null;
  const wan = wanName(m[1]);
  const offline = m[2].toLowerCase() === 'offline';
  return {
    category: 'Conectividad',
    summary: offline ? `${wan} sin conexión a internet` : `${wan} volvió a tener conexión a internet`,
    fields: { wan },
    incident: { kind: 'wan_offline', key: wan, action: offline ? 'open' : 'resolve' },
  };
}

const PEERS = '\\(Peers=([^<)]+)<->([^,)]+)';

function ipsecRekey(msg) {
  const m = msg.match(new RegExp(`(\\w+): Lifetime of the SA created in phase (\\d) of IKE negotiation expired\\.\\s*${PEERS}`));
  if (!m) return null;
  return {
    category: 'VPN',
    summary: `Túnel IPsec en ${wanName(m[1])}: se renovó la clave de seguridad (fase ${m[2]})`,
    fields: { wan: wanName(m[1]), phase: Number(m[2]), local: m[3], remote: m[4] },
  };
}

function ipsecFailover(msg) {
  const m = msg.match(/IPsec failover from Primary IPsec (\S+) to Secondary IPsec (\S+?)\.?\s*$/);
  if (!m) return null;
  return {
    category: 'VPN',
    summary: `Failover de IPsec: pasó del túnel «${m[1]}» al secundario «${m[2]}»`,
    fields: { principal: m[1], secundario: m[2] },
  };
}

function ipsecUp(msg) {
  const m = msg.match(new RegExp(`(\\w+): Set up IPsec connection successfully\\.\\s*${PEERS}`));
  if (!m) return null;
  const wan = wanName(m[1]);
  return {
    category: 'VPN',
    summary: `Túnel IPsec en ${wan} establecido con ${m[3]}`,
    fields: { wan, local: m[2], remote: m[3] },
    incident: { kind: 'ipsec_down', key: wan, action: 'resolve' },
  };
}

function ipsecDpdOn(msg) {
  const m = msg.match(new RegExp(`(\\w+): Enable DPD successfully\\.\\s*\\(DPD-Interval=(\\d+),\\s*Peers=([^<)]+)<->([^)]+)`));
  if (!m) return null;
  return {
    category: 'VPN',
    summary: `Túnel IPsec en ${wanName(m[1])}: detección de caída activada (cada ${m[2]} s)`,
    fields: { wan: wanName(m[1]), intervalo: Number(m[2]), local: m[3], remote: m[4] },
  };
}

function ipsecDown(msg) {
  const m = msg.match(new RegExp(`(\\w+): DPD detection times out\\. IPsec connection was disconnected\\.\\s*${PEERS}`));
  if (!m) return null;
  const wan = wanName(m[1]);
  return {
    category: 'VPN',
    summary: `Túnel IPsec en ${wan} caído: el otro extremo (${m[3]}) no responde`,
    fields: { wan, local: m[2], remote: m[3] },
    incident: { kind: 'ipsec_down', key: wan, action: 'open' },
  };
}

const first = (...fns) => (msg) => { for (const f of fns) { const r = f(msg); if (r) return r; } return null; };
const IPSEC = first(ipsecRekey, ipsecFailover, ipsecUp, ipsecDpdOn, ipsecDown);
// Mensajes de alerta que el controlador reenvía en texto ("[gateway:NOMBRE:MAC]: ..."): se reconocen por su contenido
const RELAY = first(onlineDetection, IPSEC, rogueDhcp);

// Catálogo de módulos conocidos. Cada uno devuelve la interpretación o null si no reconoce el mensaje.
// Los módulos o mensajes que no estén aquí se guardan igual y esperan aprobación (ver classify.js).
const MODULES = {
  dhcp_server: first(dhcpAllocated, rogueDhcp),

  ip_conflict(msg) {
    // La IP confiable va al final ("conflicted ip: X."). La que aparece al principio viene pegada a otro número.
    const used = msg.match(new RegExp(`client\\[(${MAC})\\]\\s+client\\[(${MAC})\\].*?used conflicted ip:\\s*(\\S+)`));
    if (used) {
      const ip = stripDot(used[3]);
      return {
        category: 'Red',
        summary: `Dos equipos están usando la misma IP ${ip}`,
        fields: { ip, mac1: used[1].toLowerCase(), mac2: used[2].toLowerCase() },
        // Se repite cada minuto mientras dura. Se cierra solo si pasan 15 minutos sin repetirse.
        incident: { kind: 'ip_conflict', key: ip, action: 'open', autoCloseSecs: 15 * 60 },
      };
    }
    const resolved = msg.match(/conflicted ip resolved:\s*(\S+)/);
    if (resolved) {
      const ip = stripDot(resolved[1]);
      return { category: 'Red', summary: `Se resolvió el conflicto de la IP ${ip}`, fields: { ip } };
    }
    return null;
  },

  ipsec: IPSEC,
  online_dection: onlineDetection, // así se escribe el módulo en Omada
};

// DDNS No-IP: "WAN5: No-IP DDNS logining succeeded, username is X." / "WAN5: No-IP DDNS registeration/update succeeded. IP and host  are bound."
MODULES.noip = (msg) => {
  const login = msg.match(/(\w+): No-IP DDNS logining succeeded, username is (\S+?)\.?\s*$/i);
  if (login) {
    const wan = wanName(login[1]);
    return { category: 'Conectividad', summary: `${wan}: sesión correcta en el servicio DDNS No-IP (usuario ${login[2]})`, fields: { wan, usuario: login[2] } };
  }
  const upd = msg.match(/(\w+): No-IP DDNS registeration\/update succeeded\.\s*([\d.]+) and (\S+)\s+are bound/i);
  if (upd) {
    const wan = wanName(upd[1]);
    return { category: 'Conectividad', summary: `${wan}: DDNS actualizado, ${upd[3]} apunta a ${upd[2]}`, fields: { wan, ip: upd[2], dominio: upd[3] } };
  }
  return null;
};

// VPN de acceso remoto (SSL VPN): inicio y cierre de sesión de usuarios, y mensajes de la conexión
MODULES.sslvpn = (msg) => {
  const s = msg.match(/SSL VPN client (login|logout), account=([^,\s]+), loginIP=([\d.]+), virtualIP=([\d.]+)/i);
  if (s) {
    const login = s[1].toLowerCase() === 'login';
    return {
      category: 'VPN',
      summary: `${login ? 'Inició' : 'Cerró'} sesión en la VPN ${s[2]} desde ${s[3]} (IP virtual ${s[4]})`,
      fields: { usuario: s[2], 'ip-origen': s[3], 'ip-virtual': s[4] },
    };
  }
  const t = msg.match(/SSL VPN TLS: Initial packet from \[AF_INET\]([\d.]+):(\d+)/i);
  if (t) return { category: 'VPN', summary: `Intento de conexión a la VPN desde ${t[1]}:${t[2]}`, fields: { 'ip-origen': t[1], puerto: Number(t[2]) } };
  if (/SSL VPN peer is inactive/i.test(msg)) return { category: 'VPN', summary: 'La VPN cerró una conexión por inactividad', fields: {} };
  return null;
};

const PORTS = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 80: 'HTTP', 88: 'Kerberos', 110: 'POP3', 123: 'NTP',
  135: 'RPC', 143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 514: 'Syslog', 993: 'IMAPS', 1433: 'SQL Server',
  3268: 'Catálogo global AD', 3306: 'MySQL', 3389: 'Escritorio remoto', 5432: 'PostgreSQL', 5060: 'SIP', 8080: 'HTTP alterno',
};

// ARP: el router avisa cuando un equipo usa una IP que tiene reservada otra MAC, y cuando sospecha de un ataque.
// Las MAC vienen con guiones ("00-17-61-12-F8-A6"); el "55" pegado al inicio del mensaje no es parte de ellas.
const ARP_MAC = '[0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5}';
const dashMac = (s) => s.replace(/-/g, ':').toLowerCase();

function arpConflict(msg) {
  const m = msg.match(new RegExp(
    `detected ARP conflict and dropped (\\d+) packets?\\.\\s*\\(Packet=([\\d.]+):(${ARP_MAC}),\\s*Bind-Rule=([\\d.]+):(${ARP_MAC})\\)`, 'i'));
  if (!m) return null;
  const n = Number(m[1]);
  return {
    category: 'Seguridad',
    summary: `Conflicto ARP en ${m[2]}: el equipo ${dashMac(m[3])} usa una IP reservada para ${dashMac(m[5])} (${n} ${n === 1 ? 'paquete descartado' : 'paquetes descartados'})`,
    fields: { ip: m[2], mac: dashMac(m[3]), 'mac-reservada': dashMac(m[5]), paquetes: n },
    // Se repite mientras dura. Se cierra solo si pasan 15 minutos sin repetirse.
    incident: { kind: 'arp_conflict', key: m[2], action: 'open', autoCloseSecs: 15 * 60 },
  };
}

function arpAttack(msg) {
  if (!/Detected suspected ARP attack/i.test(msg)) return null;
  return { category: 'Seguridad', summary: 'El router detectó paquetes ARP sospechosos de un ataque', fields: {} };
}

// Mensajes de ACL: "[ACL]GATEWAY=..,DESC=..,ACTION=Allow,SRC_MAC=..,DST_MAC=..,SRC=..,DST=..,PROTO=UDP,Sport=..,Dport=.."
MODULES.firewall = (msg) => {
  if (!msg.startsWith('[ACL]')) return arpConflict(msg) || arpAttack(msg);
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

module.exports = { parseLine, MODULES, RELAY, INCIDENT_SEVERITY, stripTag };
