const express = require('express');
const pool = require('./db');
const { auth, need } = require('./middleware');
const { audit } = require('./settings');
const { TZ, dayOf, listDays, dropDay, isDay } = require('./partitions');
const { getRetention, saveRetention, diskUsage, runRetention } = require('./retention');

const router = express.Router();
const guard = [auth, need('storage.manage')];

router.get('/storage', guard, async (req, res) => {
  const [days, settings, disk, dbSize] = await Promise.all([
    listDays(),
    getRetention(),
    diskUsage().catch(() => null),
    pool.query('SELECT pg_database_size(current_database()) AS bytes'),
  ]);
  res.json({
    timezone: TZ,
    today: dayOf(new Date()),
    disk,
    dbBytes: Number(dbSize.rows[0].bytes),
    settings,
    days,
  });
});

router.put('/storage/settings', guard, async (req, res) => {
  const b = req.body || {};
  const num = (v, min, max, label) => {
    if (v === null || v === undefined || v === '') return { value: null };
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) return { error: `${label} debe ser un número entero entre ${min} y ${max}.` };
    return { value: n };
  };
  const d = num(b.retentionDays, 1, 3650, 'Los días de retención');
  if (d.error) return res.status(400).json({ error: d.error });
  const p = num(b.diskMaxPercent, 50, 95, 'El porcentaje de disco');
  if (p.error) return res.status(400).json({ error: p.error });

  await saveRetention({ retentionDays: d.value, diskMaxPercent: p.value });
  await audit(req.user.id, 'storage.settings', { retentionDays: d.value, diskMaxPercent: p.value });
  const result = await runRetention(req.user.id); // aplica de inmediato
  res.json({ settings: await getRetention(), dropped: result.dropped });
});

// Borrado manual de un día completo. Es definitivo.
router.delete('/storage/days/:day', guard, async (req, res) => {
  const day = req.params.day;
  if (!isDay(day)) return res.status(400).json({ error: 'Día no válido.' });
  const days = await listDays();
  const found = days.find((x) => x.day === day);
  if (!found) return res.status(404).json({ error: 'No hay logs guardados de ese día.' });
  await dropDay(day);
  await audit(req.user.id, 'storage.delete-day', { day, rows: found.rows, bytes: found.bytes });
  res.json({ ok: true, day });
});

module.exports = router;
