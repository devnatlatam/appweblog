// Colector syslog multipuerto. Cada cliente tiene un puerto (UDP o TCP); el puerto por el que entra un mensaje
// es lo que lo identifica. Los puertos se abren y se cierran en caliente, sin reiniciar el servidor.
const dgram = require('dgram');
const net = require('net');
const { EventEmitter } = require('events');
const pool = require('./db');
const { parseWire } = require('./wire');
const { dayOf, ensurePartition } = require('./partitions');

const MAX_PENDING_TYPES = 200;   // tipos nuevos que pueden esperar aprobación por cliente
const MAX_QUEUE = 200000;       // tope de mensajes en memoria si la base se atrasa
const FLUSH_MS = 300;           // cada cuánto se guarda y se emite lo recibido
const FLUSH_SIZE = 500;
const BATCH = 2000;
const MAX_MESSAGE = 64 * 1024;  // un mensaje syslog más grande se descarta
const MAX_TCP_BUFFER = 1024 * 1024;

function friendly(err, port) {
  if (err.code === 'EADDRINUSE') return `El puerto ${port} ya está en uso por otro programa.`;
  if (err.code === 'EACCES') return `Sin permiso para abrir el puerto ${port}. Los puertos menores a 1024 requieren permisos de administrador.`;
  return err.message;
}

const clean = (ip) => String(ip || '').replace(/^::ffff:/, '');

class Collector extends EventEmitter {
  constructor() {
    super();
    this.open = new Map();    // client id → { row, close }
    this.errors = new Map();  // client id → mensaje del último fallo al abrir
    this.types = new Map();   // 'clienteId|firma' → { id, status, category } de los tipos de log nuevos
    this.queue = [];
    this.overflow = 0;
    this.flushing = false;
    this.timer = null;
  }

  // Abre los puertos que estaban encendidos y arranca el guardado periódico
  async start() {
    const { rows } = await pool.query('SELECT * FROM clients_ports WHERE is_active ORDER BY id');
    for (const row of rows) {
      try { await this.openPort(row); } catch (e) { console.error(`Puerto ${row.port_number}/${row.protocol}: ${e.message}`); }
    }
    const t = await pool.query('SELECT id, client_id, type_key, status, category FROM log_types');
    t.rows.forEach((r) => this.setType(r.client_id, r.type_key, r));
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
  }

  // La API de aprobación avisa aquí para que la decisión valga de inmediato
  setType(clientId, typeKey, row) {
    this.types.set(`${clientId}|${typeKey}`, { id: row.id, status: row.status, category: row.category });
  }

  // Busca (o crea como pendiente) el tipo de cada mensaje desconocido del lote
  async resolveTypes(batch) {
    for (const b of batch) {
      if (b.ev.known) continue;
      let key = `${b.clientId}|${b.ev.typeKey}`;
      if (!this.types.has(key)) {
        // Tope por cliente: si ya hay muchísimos tipos esperando, los nuevos se agrupan para no inundar al administrador
        const pend = await pool.query("SELECT count(*) AS n FROM log_types WHERE client_id = $1 AND status = 'pending'", [b.clientId]);
        if (Number(pend.rows[0].n) >= MAX_PENDING_TYPES) {
          b.ev.typeKey = `${b.ev.module}:varios`;
          b.ev.typeLabel = `Otros mensajes de ${b.ev.module}`;
          key = `${b.clientId}|${b.ev.typeKey}`;
        }
      }
      if (!this.types.has(key)) {
        const r = await pool.query(
          `INSERT INTO log_types (client_id, type_key, label, suggested_category, category, sample)
           VALUES ($1, $2, $3, $4, $4, $5)
           ON CONFLICT (client_id, type_key) DO UPDATE SET last_seen = now()
           RETURNING id, status, category`,
          [b.clientId, b.ev.typeKey, b.ev.typeLabel || b.ev.typeKey, b.ev.category, b.ev.raw.slice(0, 2000)]
        );
        this.types.set(key, r.rows[0]);
      }
      b.type = this.types.get(key);
    }
  }

  async stop() {
    clearInterval(this.timer);
    for (const id of [...this.open.keys()]) this.closePort(id);
    await this.flush();
  }

  status(id) {
    return { listening: this.open.has(id), error: this.errors.get(id) || null };
  }

  // Abre el puerto de un cliente. Rechaza con un mensaje entendible si no se puede (puerto ocupado, sin permiso...).
  async openPort(row) {
    if (this.open.has(row.id)) return;
    try {
      const handle = row.protocol === 'tcp' ? await this.openTcp(row) : await this.openUdp(row);
      this.open.set(row.id, { row, close: handle });
      this.errors.delete(row.id);
    } catch (e) {
      const msg = friendly(e, row.port_number);
      this.errors.set(row.id, msg);
      throw new Error(msg);
    }
  }

  closePort(id) {
    const h = this.open.get(id);
    if (!h) return;
    try { h.close(); } catch (e) { /* ya estaba cerrado */ }
    this.open.delete(id);
    this.errors.delete(id);
  }

  // Actualiza el nombre y las IP permitidas de un puerto abierto sin cerrarlo
  refreshRow(row) {
    const h = this.open.get(row.id);
    if (h) h.row = row;
  }

  allowed(row, ip) {
    return !row.allowed_ips || row.allowed_ips.length === 0 || row.allowed_ips.includes(ip);
  }

  openUdp(row) {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: false });
      sock.once('error', reject);
      sock.on('message', (msg, rinfo) => {
        const h = this.open.get(row.id);
        const ip = clean(rinfo.address);
        if (!h || !this.allowed(h.row, ip) || msg.length > MAX_MESSAGE) return;
        this.accept(h.row, msg.toString('utf8'), ip);
      });
      sock.bind(row.port_number, '0.0.0.0', () => {
        sock.removeListener('error', reject);
        sock.on('error', (e) => console.error(`UDP ${row.port_number}: ${e.message}`));
        resolve(() => sock.close());
      });
    });
  }

  openTcp(row) {
    return new Promise((resolve, reject) => {
      const sockets = new Set();
      const server = net.createServer((socket) => {
        const ip = clean(socket.remoteAddress);
        const h = this.open.get(row.id);
        if (!h || !this.allowed(h.row, ip)) { socket.destroy(); return; }
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => socket.destroy());
        let buf = '';
        socket.on('data', (chunk) => {
          buf += chunk.toString('utf8');
          if (buf.length > MAX_TCP_BUFFER) { socket.destroy(); return; }
          // Dos formas de separar mensajes en TCP: "longitud mensaje" (RFC 6587) o un mensaje por línea
          for (;;) {
            const oc = buf.match(/^(\d{1,6}) /);
            if (oc) {
              const len = Number(oc[1]);
              const start = oc[0].length;
              if (buf.length < start + len) break;
              this.accept((this.open.get(row.id) || { row }).row, buf.slice(start, start + len), ip);
              buf = buf.slice(start + len);
            } else {
              const nl = buf.indexOf('\n');
              if (nl === -1) break;
              const line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (line.trim()) this.accept((this.open.get(row.id) || { row }).row, line, ip);
            }
          }
        });
      });
      server.once('error', reject);
      server.listen(row.port_number, '0.0.0.0', () => {
        server.removeListener('error', reject);
        server.on('error', (e) => console.error(`TCP ${row.port_number}: ${e.message}`));
        resolve(() => { server.close(); sockets.forEach((s) => s.destroy()); });
      });
    });
  }

  accept(row, text, ip) {
    const ev = parseWire(text, { sourceIp: ip, receivedAt: new Date() });
    if (!ev) return;
    if (this.queue.length >= MAX_QUEUE) { this.overflow += 1; return; }
    this.queue.push({ ev, clientId: row.id, clientName: row.client_name, port: row.port_number });
    if (this.queue.length >= FLUSH_SIZE) this.flush();
  }

  // Guarda lo recibido en la base y, ya con su id, lo emite a los visores en vivo
  async flush() {
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    const original = this.queue.splice(0, BATCH);
    let batch = original;
    try {
      await this.resolveTypes(batch);
      // Rechazado = se descarta. Aprobado = se muestra con la categoría elegida. Pendiente = se guarda sin mostrarse.
      const dropped = batch.filter((b) => b.type && b.type.status === 'rejected');
      batch = batch.filter((b) => !(b.type && b.type.status === 'rejected'));
      batch.forEach((b) => {
        b.pending = Boolean(b.type && b.type.status === 'pending');
        if (b.type && b.type.status === 'approved') b.ev.category = b.type.category;
      });
      const counts = new Map();
      [...batch, ...dropped].forEach((b) => { if (b.type) counts.set(b.type.id, (counts.get(b.type.id) || 0) + 1); });
      for (const [id, n] of counts) {
        await pool.query('UPDATE log_types SET event_count = event_count + $1, last_seen = now() WHERE id = $2', [n, id]);
      }
      if (!batch.length) return;
      for (const day of new Set(batch.map((b) => dayOf(b.ev.ts)))) await ensurePartition(day);
      const params = [];
      const values = batch.map((b, i) => {
        const e = b.ev;
        params.push(e.ts, e.deviceTs, e.sourceIp, e.host, b.clientId, b.port, e.module, e.severity, e.category,
          e.summary, JSON.stringify(e.fields), e.message, e.raw, e.typeKey, b.pending);
        const o = i * 15;
        return `(${Array.from({ length: 15 }, (_, k) => `$${o + k + 1}`).join(',')})`;
      });
      const res = await pool.query(
        `INSERT INTO events (ts, device_ts, source_ip, host, client_id, port, module, severity, category, summary, fields, message, raw, type_key, pending)
         VALUES ${values.join(',')} RETURNING id`,
        params
      );
      const seen = [...new Set(batch.map((b) => b.clientId))];
      pool.query('UPDATE clients_ports SET last_seen = now() WHERE id = ANY($1::int[])', [seen]).catch(() => {});

      const shown = batch.map((b, i) => ({ b, i })).filter(({ b }) => !b.pending);
      this.emit('events', shown.map(({ b, i }) => ({
        id: res.rows[i].id, ts: b.ev.ts, source_ip: b.ev.sourceIp, host: b.ev.host, client_id: b.clientId,
        client_name: b.clientName, port: b.port, module: b.ev.module, severity: b.ev.severity, category: b.ev.category,
        summary: b.ev.summary, fields: b.ev.fields, message: b.ev.message, raw: b.ev.raw, acknowledged: false,
      })));
    } catch (e) {
      console.error('No se pudo guardar un lote de logs, se reintenta:', e.message);
      this.queue.unshift(...original); // devolver al inicio para reintentar
      if (this.queue.length > MAX_QUEUE) this.queue.length = MAX_QUEUE;
    } finally {
      this.flushing = false;
    }
    if (this.overflow) { console.warn(`Se descartaron ${this.overflow} mensajes por cola llena.`); this.overflow = 0; }
  }
}

module.exports = new Collector();
