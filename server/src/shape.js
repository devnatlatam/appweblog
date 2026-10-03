// Severidad syslog (0-7) → los cuatro niveles que muestra la web
const sevKey = (n) => (n === null || n === undefined || n >= 5 ? 'info' : n <= 2 ? 'critical' : n === 3 ? 'error' : 'warning');

// Fila de la base (con client_name unido) → objeto para la web. Sin permiso de ver el original, se omite el mensaje crudo.
function shape(row, canRaw) {
  return {
    id: Number(row.id),
    ts: row.ts,
    sourceIp: row.source_ip,
    host: row.host,
    clientId: row.client_id,
    clientName: row.client_name || null,
    port: row.port,
    module: row.module,
    level: row.severity,
    severity: sevKey(row.severity),
    category: row.category,
    summary: row.summary,
    fields: row.fields,
    acknowledged: row.acknowledged,
    ...(canRaw ? { message: row.message, raw: row.raw } : {}),
  };
}

module.exports = { sevKey, shape };
