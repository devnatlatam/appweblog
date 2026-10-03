// Qué significa cada tipo de log y qué hacer. Los módulos que no estén aquí se muestran con su texto original.
const isPrivateMac = (mac) => typeof mac === 'string' && ['2', '6', 'a', 'e'].includes(mac[1] && mac[1].toLowerCase());

// Internet (WAN) y túneles VPN: los mismos mensajes los manda el router y los reenvía el controlador
function wanVpnInfo(e) {
  const s = e.summary;
  if (/sin conexión a internet/i.test(s)) {
    return {
      meaning: 'El router dejó de tener internet por esa salida (WAN). Si hay otra salida configurada, el tráfico puede estar pasando por ella.',
      action: 'Revisa el módem o el enlace de ese proveedor. Si se repite, pide al proveedor que revise la línea.',
    };
  }
  if (/volvió a tener conexión/i.test(s)) return { meaning: 'Esa salida a internet se recuperó.', action: null };
  if (/caído/i.test(s)) {
    return {
      meaning: 'El túnel VPN dejó de responder: la comunicación con la otra sede se corta hasta que se restablezca.',
      action: 'Revisa que la otra sede tenga internet y que su equipo VPN esté encendido. Si hay un túnel de respaldo, el router puede pasar a él.',
    };
  }
  if (/failover/i.test(s)) {
    return {
      meaning: 'El túnel VPN principal falló y el router cambió al túnel de respaldo para no perder la comunicación.',
      action: 'Averigua por qué cayó el principal. Mientras tanto, la comunicación depende del respaldo.',
    };
  }
  if (/establecido/i.test(s)) return { meaning: 'El túnel VPN volvió a funcionar.', action: null };
  if (/renovó la clave/i.test(s)) {
    return { meaning: 'Renovación normal de la clave de seguridad del túnel VPN. Pasa cada cierto tiempo y no requiere acción.', action: null };
  }
  if (/detección de caída/i.test(s)) {
    return { meaning: 'El router quedó vigilando si el otro extremo del túnel deja de responder.', action: null };
  }
  return null;
}

export const MODULE_INFO = {
  dhcp_server: {
    label: 'DHCP',
    meaning: (e) => (/intruso/i.test(e.summary)
      ? 'Otro equipo de la red está respondiendo como servidor DHCP. Los equipos pueden recibir de él una IP o una puerta de enlace equivocadas y quedar sin conexión.'
      : 'El router le entregó una dirección IP a un equipo de la red. Es normal cuando un equipo se conecta o renueva su dirección.'),
    action: (e) => (/intruso/i.test(e.summary)
      ? 'Ubica el equipo por su MAC y apaga su servidor DHCP (suele ser un router, repetidor o punto de acceso conectado por error).'
      : 'Si el mismo equipo aparece pidiendo su IP todo el tiempo, puede estar fallando al aceptarla o reconectándose sin parar.'),
  },
  ip_conflict: {
    label: 'Conflicto de IP',
    meaning: (e) => (/resolvi/i.test(e.summary)
      ? 'El conflicto de IP terminó: ya solo un equipo usa esa dirección.'
      : 'Dos equipos intentan usar la misma dirección IP al mismo tiempo. Ambos pueden perder la conexión de forma intermitente.'),
    action: (e) => {
      if (/resolvi/i.test(e.summary)) return null;
      const macs = [e.fields.mac1, e.fields.mac2];
      const priv = macs.filter(isPrivateMac).length;
      return 'Ubica los dos equipos por su MAC. Lo más común es que uno tenga una IP fija escrita a mano dentro del rango DHCP: cámbiala o reserva esa IP en el router.' +
        (priv ? ` ${priv === 2 ? 'Las dos MAC' : 'Una de las MAC'} parece una dirección Wi-Fi privada de celular, que puede cambiar con el tiempo.` : '');
    },
  },
  ipsec: { label: 'Túnel VPN (IPsec)', meaning: (e) => (wanVpnInfo(e) || {}).meaning, action: (e) => (wanVpnInfo(e) || {}).action || null },
  online_dection: { label: 'Conexión a internet', meaning: (e) => (wanVpnInfo(e) || {}).meaning, action: (e) => (wanVpnInfo(e) || {}).action || null },
  alerta_controlador: {
    label: 'Alerta del controlador',
    meaning: (e) => ((wanVpnInfo(e) || {}).meaning || 'El controlador Omada avisa de un evento de la red.') + ' Este aviso lo reenvía el controlador; el propio router suele mandar el mismo.',
    action: (e) => (wanVpnInfo(e) || {}).action || null,
  },
  cliente_ip: {
    label: 'Cambio de IP de origen',
    meaning: () => 'Este cliente empezó a enviar sus logs desde una IP pública distinta. Suele pasar cuando el router cambia de enlace (por ejemplo, a un respaldo como Starlink) o el proveedor le asigna otra IP.',
    action: () => 'Si el cliente tiene "Aceptar solo desde estas IP" o el firewall limita por IP, agrega la nueva: de lo contrario sus logs quedarán bloqueados.',
  },
  omada_audit: {
    label: 'Cambio de configuración',
    meaning: () => 'Alguien cambió una configuración en el controlador Omada. Abajo ves qué campo cambió y de qué valor a cuál.',
    action: () => 'Si no reconoces este cambio, confirma con quien administra el controlador quién lo hizo.',
  },
  firewall: {
    label: 'Firewall',
    meaning: (e) => (/bloqueado/i.test(e.summary)
      ? 'El firewall bloqueó este tráfico según una regla de acceso (ACL).'
      : 'El firewall dejó pasar este tráfico según una regla de acceso (ACL). Es actividad normal de la red.'),
    action: (e) => (/bloqueado/i.test(e.summary)
      ? 'Si se repite desde el mismo origen, identifica el equipo y revisa por qué intenta ese acceso.'
      : null),
  },
};

export const moduleLabel = (m) => (MODULE_INFO[m] ? MODULE_INFO[m].label : m);

// Tipos que se pueden elegir en el filtro de Registros
export const FILTER_MODULES = ['dhcp_server', 'ip_conflict', 'firewall', 'ipsec', 'online_dection', 'alerta_controlador', 'cliente_ip', 'omada_audit'];

export function interpret(e) {
  const info = MODULE_INFO[e.module];
  if (!info) return { meaning: 'Este tipo de log todavía no tiene una explicación. Se muestra el texto tal como lo envió el equipo.', action: null };
  return { meaning: info.meaning(e) || 'Sin explicación disponible para este mensaje.', action: info.action(e) };
}

export const FIELD_LABELS = {
  ip: 'Dirección IP', mac: 'MAC del equipo', mac1: 'MAC del equipo 1', mac2: 'MAC del equipo 2',
  action: 'Acción', src: 'Origen', dst: 'Destino', proto: 'Protocolo', sport: 'Puerto origen', dport: 'Puerto destino',
  srcMac: 'MAC de origen', dstMac: 'MAC de destino', rule: 'Regla (ACL)', gateway: 'Gateway',
  site: 'Sitio', operation: 'Operación original', network: 'Red',
  wan: 'Salida (WAN)', phase: 'Fase', local: 'IP local', remote: 'IP del otro extremo', intervalo: 'Intervalo (s)',
  principal: 'Túnel principal', secundario: 'Túnel de respaldo', equipo: 'Equipo', 'mac-equipo': 'MAC del equipo',
  nueva: 'IP nueva', anterior: 'IP anterior', 'anterior-visto': 'Anterior vista por última vez',
};

export const INCIDENT_KINDS = {
  wan_offline: 'Internet caído',
  ipsec_down: 'Túnel VPN caído',
  ip_conflict: 'Conflicto de IP',
  rogue_dhcp: 'Servidor DHCP intruso',
};

// "ER7206:" llega con los dos puntos de la etiqueta pegados; el nombre del equipo es solo "ER7206"
export const cleanHost = (h) => (h ? String(h).replace(/:$/, '') : h);

// Nombres de los puertos más comunes, para leer el firewall de un vistazo
export const PORT_NAMES = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 80: 'HTTP', 88: 'Kerberos', 110: 'POP3', 123: 'NTP',
  135: 'RPC', 143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 514: 'Syslog', 993: 'IMAPS', 1433: 'SQL Server',
  3268: 'Catálogo global AD', 3306: 'MySQL', 3389: 'Escritorio remoto', 5060: 'SIP', 5432: 'PostgreSQL', 8080: 'HTTP alterno',
};

// Qué significa cada tipo de incidente y qué hacer. Reciben el incidente y un aviso de ejemplo (el primero).
export const INCIDENT_INFO = {
  wan_offline: {
    meaning: (i) => `El router dejó de tener internet por la salida ${i.key} (WAN). Si hay otra salida configurada, el tráfico puede estar pasando por ella.`,
    action: () => 'Revisa el módem o el enlace de ese proveedor. Si se repite, pide al proveedor que revise la línea. Mientras dure, confirma que la salida de respaldo esté funcionando.',
  },
  ipsec_down: {
    meaning: (i) => `El túnel VPN que sale por ${i.key} dejó de responder: la comunicación con la otra sede se corta hasta que se restablezca.`,
    action: () => 'Revisa que la otra sede tenga internet y que su equipo VPN esté encendido. Si hay un túnel de respaldo, el router puede haber pasado a él: confirma que la comunicación funcione.',
  },
  ip_conflict: {
    meaning: (i) => `Dos equipos están usando la misma dirección IP (${i.key}). Ambos pueden perder la conexión de forma intermitente. El aviso se repite mientras el conflicto sigue.`,
    action: (i, sample) => MODULE_INFO.ip_conflict.action({ summary: '', fields: (sample && sample.fields) || {} }),
  },
  rogue_dhcp: {
    meaning: (i) => `Un equipo (${i.key}) está respondiendo como servidor DHCP sin que debiera. Los equipos pueden recibir de él una IP o una puerta de enlace equivocadas y quedar sin conexión.`,
    action: () => 'Ubica el equipo por su IP o MAC (ver "Datos del primer aviso") y apaga su servidor DHCP. Suele ser un router, repetidor o punto de acceso conectado por error.',
  },
};
