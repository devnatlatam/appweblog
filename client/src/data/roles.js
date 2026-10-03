// Niveles de acceso. Un nivel mayor incluye siempre todo lo del nivel menor.
export const ROLES = {
  superadmin: {
    label: 'Superadmin',
    level: 4,
    description: 'Control total. Gestiona administradores, puertos, almacenamiento y usuarios.',
  },
  admin: {
    label: 'Administrador',
    level: 3,
    description: 'Crea clientes y puertos, aprueba los tipos de log nuevos, configura el borrado de logs y gestiona usuarios.',
  },
  operador: {
    label: 'Operador',
    level: 2,
    description: 'Ve y filtra los logs, los marca como revisados, exporta y enciende o apaga los puertos ya creados.',
  },
  lector: {
    label: 'Lector',
    level: 1,
    description: 'Solo observa: ve los logs en vivo, el resumen y los filtros, sin poder modificar nada.',
  },
};

export const ROLE_ORDER = ['superadmin', 'admin', 'operador', 'lector'];

export const PERMISSION_GROUPS = [
  {
    group: 'Monitoreo',
    items: [
      { key: 'dashboard.view', label: 'Ver resumen de la red' },
      { key: 'logs.view', label: 'Ver registros y el visor en vivo' },
      { key: 'logs.raw', label: 'Ver el mensaje original del syslog' },
      { key: 'logs.ack', label: 'Marcar eventos como revisados' },
      { key: 'logs.export', label: 'Exportar registros' },
    ],
  },
  {
    group: 'Puertos de recepción',
    items: [
      { key: 'ports.view', label: 'Ver los clientes, sus puertos y su estado' },
      { key: 'ports.toggle', label: 'Encender y apagar puertos' },
      { key: 'ports.manage', label: 'Crear, editar y eliminar clientes y puertos' },
    ],
  },
  {
    group: 'Almacenamiento',
    items: [
      { key: 'storage.manage', label: 'Configurar el borrado automático y borrar logs por día' },
    ],
  },
  {
    group: 'Clasificación de logs',
    items: [
      { key: 'types.review', label: 'Aprobar o rechazar los tipos de log nuevos' },
    ],
  },
  {
    group: 'Alertas',
    items: [
      { key: 'alerts.view', label: 'Ver reglas de alerta' },
      { key: 'alerts.manage', label: 'Crear y editar reglas de alerta' },
    ],
  },
  {
    group: 'Administración',
    items: [
      { key: 'users.manage', label: 'Gestionar usuarios' },
      { key: 'roles.manage', label: 'Ver roles y permisos' },
    ],
  },
];

export const ROLE_PERMISSIONS = {
  superadmin: PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key)),
  admin: [
    'dashboard.view', 'logs.view', 'logs.raw', 'logs.ack', 'logs.export',
    'ports.view', 'ports.toggle', 'ports.manage', 'storage.manage', 'types.review',
    'alerts.view', 'alerts.manage', 'users.manage',
  ],
  operador: ['dashboard.view', 'logs.view', 'logs.raw', 'logs.ack', 'logs.export', 'ports.view', 'ports.toggle', 'alerts.view'],
  lector: ['dashboard.view', 'logs.view', 'ports.view'],
};
