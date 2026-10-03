import React, { useCallback, useEffect, useState } from 'react';
import { Save, Trash2, HardDrive, Info } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../context/ToastContext';
import { PageHead, Dialog, Empty } from '../../components/ui';

const fmt = (n) => n.toLocaleString('es');
function size(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('es', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

export default function Storage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [days, setDays] = useState('');
  const [percent, setPercent] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    api('/storage')
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data) return;
    setDays(data.settings.retentionDays ? String(data.settings.retentionDays) : '');
    setPercent(data.settings.diskMaxPercent ? String(data.settings.diskMaxPercent) : '');
    // solo al cargar por primera vez o tras guardar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data && data.settings.retentionDays, data && data.settings.diskMaxPercent]);

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      const d = await api('/storage/settings', {
        method: 'PUT',
        body: { retentionDays: days === '' ? null : Number(days), diskMaxPercent: percent === '' ? null : Number(percent) },
      });
      toast(d.dropped.length ? `Guardado. Se borraron ${d.dropped.length} día(s) antiguos.` : 'Configuración guardada');
      load();
    } catch (e) { setFormError(e.message); }
    setSaving(false);
  };

  const removeDay = async (d) => {
    try {
      await api(`/storage/days/${d.day}`, { method: 'DELETE' });
      toast(`Se borraron los logs del ${d.day}`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    setConfirm(null);
  };

  if (error) return <><PageHead title="Almacenamiento" /><div className="panel"><Empty title="No se pudo cargar" action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>{error}</Empty></div></>;
  if (!data) return <><PageHead title="Almacenamiento" /><div className="empty">Cargando…</div></>;

  const { disk, settings, today } = data;
  const level = disk ? (disk.percent >= 90 ? 'crit' : disk.percent >= 75 ? 'warn' : 'ok') : 'ok';
  const limitHit = disk && settings.diskMaxPercent && disk.percent >= settings.diskMaxPercent;

  return (
    <>
      <PageHead title="Almacenamiento">
        Cuánto espacio ocupan los logs y cuándo se borran. Los días se cuentan en la zona horaria {data.timezone}.
      </PageHead>

      <div className="storage-grid">
        <section className="panel">
          <div className="panel__head"><div><h2>Disco</h2><p>{disk ? disk.path : 'No disponible'}</p></div></div>
          <div className="panel__body">
            {disk ? (
              <>
                <div className="meter" role="img" aria-label={`Disco al ${disk.percent.toFixed(0)} por ciento`}>
                  <span className={`meter__fill meter__fill--${level}`} style={{ width: `${Math.min(100, disk.percent)}%` }} />
                  {settings.diskMaxPercent && <i className="meter__limit" style={{ left: `${settings.diskMaxPercent}%` }} title={`Límite ${settings.diskMaxPercent}%`} />}
                </div>
                <p className="meter__text"><strong>{disk.percent.toFixed(1)} %</strong> usado · {size(disk.usedBytes)} de {size(disk.totalBytes)}</p>
              </>
            ) : <p className="cell-sub">No se pudo leer el uso del disco.</p>}
            <p className="cell-sub" style={{ marginTop: 8 }}>Los logs ocupan <strong>{size(data.dbBytes)}</strong> en la base de datos.</p>
            {limitHit && (
              <div className="note note--warn" style={{ marginTop: 12 }}><Info size={18} aria-hidden="true" />
                <div><p>El disco ya supera el límite configurado. Se borrarán días antiguos hasta bajar de {settings.diskMaxPercent} %.</p></div></div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel__head"><div><h2>Borrado automático</h2><p>Deja un campo vacío para no usar esa regla.</p></div></div>
          <div className="panel__body storage-form">
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <div className="field">
              <label htmlFor="rd">Guardar los últimos</label>
              <div className="unit-input">
                <input id="rd" className="input mono" inputMode="numeric" value={days} placeholder="Sin límite"
                  onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                <span>días</span>
              </div>
              <span className="hint">Se cuentan hoy y los días anteriores. Lo más viejo se borra solo.</span>
            </div>
            <div className="field">
              <label htmlFor="dp">Borrar lo más antiguo si el disco supera</label>
              <div className="unit-input">
                <input id="dp" className="input mono" inputMode="numeric" value={percent} placeholder="Sin límite"
                  onChange={(e) => setPercent(e.target.value.replace(/\D/g, '').slice(0, 2))} />
                <span>% usado</span>
              </div>
              <span className="hint">Entre 50 y 95. Se borra un día completo a la vez, del más antiguo, hasta bajar del límite. Nunca se borra el día de hoy.</span>
            </div>
            <button type="button" className="btn btn--primary" onClick={save} disabled={saving}><Save size={18} /> Guardar y aplicar</button>
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel__head">
          <div><h2>Logs guardados por día</h2><p>Borrar un día elimina todos sus logs y libera el espacio al instante. No se puede deshacer.</p></div>
        </div>
        {data.days.length === 0 ? (
          <Empty icon={HardDrive} title="No hay logs guardados">Cuando lleguen logs, cada día aparecerá aquí.</Empty>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead><tr><th>Día</th><th>Eventos (aprox.)</th><th>Tamaño</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.day}>
                    <td><span className="cell-main">{dayLabel(d.day)}</span> {d.day === today && <span className="badge badge--accent badge--plain">Hoy</span>}<div className="cell-sub mono">{d.day}</div></td>
                    <td className="mono">{fmt(d.rows)}</td>
                    <td className="mono">{size(d.bytes)}</td>
                    <td><div className="row-actions"><button type="button" className="icon-btn" onClick={() => setConfirm(d)} aria-label={`Borrar los logs del ${d.day}`}><Trash2 size={18} /></button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirm && (
        <Dialog title="¿Borrar los logs de este día?" variant="modal" onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>Cancelar</button>
              <button type="button" className="btn btn--danger" onClick={() => removeDay(confirm)}>Borrar {confirm.day}</button>
            </>
          }>
          <div className="dialog-body">
            <p>Se borrarán todos los logs del <strong>{dayLabel(confirm.day)}</strong> (unos {fmt(confirm.rows)} eventos, {size(confirm.bytes)}).</p>
            {confirm.day === today && <div className="form-error">Es el día de hoy: también se borra lo que llegó hasta ahora.</div>}
            <p className="hint">Esta acción no se puede deshacer.</p>
          </div>
        </Dialog>
      )}
    </>
  );
}
