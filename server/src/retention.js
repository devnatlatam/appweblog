// Borrado automático de logs: por antigüedad (X días) y/o cuando el disco supera X% de uso.
// Siempre se borran días completos, del más antiguo al más nuevo, y nunca el día de hoy.
const fs = require('fs');
const pool = require('./db');
const { getSetting, setSetting, audit } = require('./settings');
const { dayOf, listDays, dropDay } = require('./partitions');

const KEY = 'retention';
const DEFAULTS = { retentionDays: null, diskMaxPercent: null };

async function getRetention() {
  return { ...DEFAULTS, ...(await getSetting(KEY, {})) };
}

async function saveRetention(v) {
  await setSetting(KEY, { retentionDays: v.retentionDays, diskMaxPercent: v.diskMaxPercent });
}

// Disco donde vive PostgreSQL (se consulta una vez; si no se puede, el de la carpeta de la aplicación)
let diskPath = null;
async function dataDir() {
  if (diskPath) return diskPath;
  try {
    const { rows } = await pool.query('SHOW data_directory');
    if (rows[0].data_directory && fs.existsSync(rows[0].data_directory)) diskPath = rows[0].data_directory;
  } catch (e) { /* sin permiso para consultarlo */ }
  if (!diskPath) diskPath = process.env.DISK_PATH || process.cwd();
  return diskPath;
}

async function diskUsage() {
  const dir = await dataDir();
  const s = await fs.promises.statfs(dir);
  const total = s.blocks * s.bsize;
  const used = (s.blocks - s.bfree) * s.bsize;
  const avail = s.bavail * s.bsize;
  return { path: dir, totalBytes: total, usedBytes: used, percent: used + avail > 0 ? (used / (used + avail)) * 100 : 0 };
}

const shiftDay = (day, delta) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);

let running = false;

async function runRetention(userId = null) {
  if (running) return { dropped: [] };
  running = true;
  const dropped = [];
  try {
    const { retentionDays, diskMaxPercent } = await getRetention();
    const today = dayOf(new Date());
    let days = (await listDays()).map((d) => d.day).sort(); // del más antiguo al más nuevo

    if (retentionDays) {
      const oldest = shiftDay(today, -(retentionDays - 1)); // con 7 días se conservan hoy y los 6 anteriores
      for (const d of days.filter((x) => x < oldest)) {
        await dropDay(d);
        dropped.push({ day: d, reason: 'days' });
      }
      days = days.filter((x) => x >= oldest);
    }

    if (diskMaxPercent) {
      let usage = await diskUsage();
      const candidates = days.filter((x) => x < today);
      while (usage.percent >= diskMaxPercent && candidates.length) {
        const d = candidates.shift();
        await dropDay(d);
        dropped.push({ day: d, reason: 'disk' });
        usage = await diskUsage();
      }
    }
    if (dropped.length) await audit(userId, 'storage.purge', { dropped });
  } finally {
    running = false;
  }
  return { dropped };
}

function scheduleRetention() {
  const tick = () => runRetention().catch((e) => console.error('Retención:', e.message));
  tick();
  return setInterval(tick, 10 * 60 * 1000).unref();
}

module.exports = { getRetention, saveRetention, diskUsage, runRetention, scheduleRetention };
