// Qué significa cada tipo de log y qué hacer. Los módulos que no estén aquí se muestran con su texto original.
const isPrivateMac = (mac) => typeof mac === 'string' && ['2', '6', 'a', 'e'].includes(mac[1] && mac[1].toLowerCase());

export const MODULE_INFO = {
  dhcp_server: {
    label: 'DHCP',
    meaning: () => 'El router le entregó una dirección IP a un equipo de la red. Es normal cuando un equipo se conecta o renueva su dirección.',
    action: () => 'Si el mismo equipo aparece pidiendo su IP todo el tiempo, puede estar fallando al aceptarla o reconectándose sin parar.',
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

export function interpret(e) {
  const info = MODULE_INFO[e.module];
  if (!info) return { meaning: 'Este tipo de log todavía no tiene una explicación. Se muestra el texto tal como lo envió el equipo.', action: null };
  return { meaning: info.meaning(e), action: info.action(e) };
}

export const FIELD_LABELS = {
  ip: 'Dirección IP', mac: 'MAC del equipo', mac1: 'MAC del equipo 1', mac2: 'MAC del equipo 2',
  action: 'Acción', src: 'Origen', dst: 'Destino', proto: 'Protocolo', sport: 'Puerto origen', dport: 'Puerto destino',
  srcMac: 'MAC de origen', dstMac: 'MAC de destino', rule: 'Regla (ACL)', gateway: 'Gateway',
  site: 'Sitio', operation: 'Operación original',
};
