// Reglas de ejemplo. La pantalla de alertas se conecta a la base en el siguiente paso.
export const ALERT_RULES = [
  { id: 'r1', name: 'Punto de acceso desconectado', condition: 'Un AP deja de responder más de 2 minutos', severity: 'critical', channels: ['Correo', 'Telegram'], enabled: true, lastFired: 'Hace 40 min' },
  { id: 'r2', name: 'Caída de internet', condition: 'WAN1 o WAN2 pasa a estado caído', severity: 'critical', channels: ['Correo', 'Telegram'], enabled: true, lastFired: 'Hace 6 h' },
  { id: 'r3', name: 'Intentos de acceso al controlador', condition: 'Más de 3 inicios de sesión fallidos en 5 minutos', severity: 'error', channels: ['Correo'], enabled: true, lastFired: 'Hace 2 h' },
  { id: 'r4', name: 'Red Wi-Fi desconocida', condition: 'Se detecta un AP no autorizado con señal mayor a -60 dBm', severity: 'warning', channels: ['Correo'], enabled: true, lastFired: 'Ayer' },
  { id: 'r5', name: 'Rango DHCP casi lleno', condition: 'Uso de un rango DHCP mayor al 90%', severity: 'warning', channels: ['Correo'], enabled: false, lastFired: 'Nunca' },
  { id: 'r6', name: 'Sobreconsumo PoE', condition: 'Un puerto del switch se apaga por exceso de energía', severity: 'error', channels: ['Telegram'], enabled: true, lastFired: 'Hace 1 h' },
];
