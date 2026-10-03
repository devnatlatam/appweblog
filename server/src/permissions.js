// Debe coincidir con client/src/data/roles.js. El servidor es quien manda: el cliente solo oculta opciones.
const LEVEL = { superadmin: 4, admin: 3, operador: 2, lector: 1 };

const PERMS = {
  superadmin: [
    'dashboard.view', 'logs.view', 'logs.raw', 'logs.ack', 'logs.export',
    'ports.view', 'ports.toggle', 'ports.manage', 'storage.manage', 'types.review', 'settings.manage',
    'alerts.view', 'alerts.manage', 'users.manage', 'roles.manage',
  ],
  admin: [
    'dashboard.view', 'logs.view', 'logs.raw', 'logs.ack', 'logs.export',
    'ports.view', 'ports.toggle', 'ports.manage', 'storage.manage', 'types.review', 'settings.manage',
    'alerts.view', 'alerts.manage', 'users.manage',
  ],
  // El operador enciende y apaga puertos ya creados, pero no crea ni borra clientes.
  operador: [
    'dashboard.view', 'logs.view', 'logs.raw', 'logs.ack', 'logs.export',
    'ports.view', 'ports.toggle', 'alerts.view',
  ],
  // El lector solo observa: no ve el mensaje original ni cambia nada.
  lector: ['dashboard.view', 'logs.view', 'ports.view'],
};

module.exports = { LEVEL, PERMS, ROLES: Object.keys(LEVEL) };
