// Transmisión en tiempo real por WebSocket. El navegador se identifica con su token y envía sus filtros;
// el servidor solo le manda los logs que coinciden (así no se satura la red ni el navegador).
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { SECRET } = require('./middleware');
const { PERMS } = require('./permissions');
const { shape } = require('./shape');

const MAX_PER_MESSAGE = 300;

function cleanFilter(f = {}) {
  return {
    ip: String(f.ip || '').trim().slice(0, 45),
    port: Number.isInteger(Number(f.port)) && Number(f.port) > 0 ? Number(f.port) : null,
    client: Number.isInteger(Number(f.client)) && Number(f.client) > 0 ? Number(f.client) : null,
    q: String(f.q || '').trim().toLowerCase().slice(0, 100),
  };
}

function matches(row, f, canRaw) {
  if (f.ip && !String(row.source_ip).includes(f.ip)) return false;
  if (f.port && row.port !== f.port) return false;
  if (f.client && row.client_id !== f.client) return false;
  if (f.q) {
    const hay = `${row.summary} ${row.module} ${row.host || ''} ${row.source_ip} ${row.client_name || ''}${canRaw ? ` ${row.message}` : ''}`.toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

function attachLive(server, collector) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  wss.on('connection', (ws) => {
    ws.state = { user: null, canRaw: false, filter: cleanFilter() };
    ws.alive = true;
    const authTimer = setTimeout(() => { if (!ws.state.user) ws.close(4001, 'Sin autenticar'); }, 10000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('close', () => clearTimeout(authTimer));
    ws.on('error', () => {});

    ws.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }

      if (msg.type === 'auth') {
        try {
          const payload = jwt.verify(String(msg.token || ''), SECRET);
          const { rows } = await pool.query('SELECT id, role, status, must_change_password FROM users WHERE id = $1', [payload.sub]);
          const u = rows[0];
          if (!u || u.status !== 'active' || u.must_change_password || !PERMS[u.role].includes('logs.view')) throw new Error('sin acceso');
          ws.state.user = { id: u.id, role: u.role };
          ws.state.canRaw = PERMS[u.role].includes('logs.raw');
          ws.state.filter = cleanFilter(msg.filter);
          clearTimeout(authTimer);
          send(ws, { type: 'ready' });
        } catch (e) {
          send(ws, { type: 'error', error: 'Sesión no válida.' });
          ws.close(4003, 'Sin acceso');
        }
        return;
      }
      if (!ws.state.user) return;
      if (msg.type === 'filter') {
        ws.state.filter = cleanFilter(msg.filter);
        send(ws, { type: 'filter-ok' });
      }
    });
  });

  collector.on('events', (rows) => {
    for (const ws of wss.clients) {
      const { user, filter, canRaw } = ws.state || {};
      if (!user) continue;
      const hit = rows.filter((r) => matches(r, filter, canRaw));
      if (!hit.length) continue;
      const skipped = Math.max(0, hit.length - MAX_PER_MESSAGE);
      send(ws, { type: 'events', skipped, events: hit.slice(-MAX_PER_MESSAGE).map((r) => shape(r, canRaw)) });
    }
  });

  // Mantener conexiones vivas y cerrar las muertas; revalidar que el usuario siga activo
  setInterval(async () => {
    const ids = [];
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
      if (ws.state && ws.state.user) ids.push(ws.state.user.id);
    }
    if (!ids.length) return;
    try {
      const { rows } = await pool.query('SELECT id, role, status FROM users WHERE id = ANY($1::int[])', [ids]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const ws of wss.clients) {
        if (!ws.state || !ws.state.user) continue;
        const u = byId.get(ws.state.user.id);
        if (!u || u.status !== 'active' || !PERMS[u.role].includes('logs.view')) { ws.close(4003, 'Sin acceso'); continue; }
        ws.state.user.role = u.role;
        ws.state.canRaw = PERMS[u.role].includes('logs.raw');
      }
    } catch (e) { /* se reintenta en la próxima vuelta */ }
  }, 30000).unref();

  return wss;
}

module.exports = { attachLive };
