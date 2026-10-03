import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Trash2, SlidersHorizontal } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../context/ToastContext';
import { moduleLabel } from '../../data/catalog';
import { PageHead, Empty, SeverityBadge, Dialog, timeAgo } from '../../components/ui';
import SeverityRuleDialog from '../../components/SeverityRuleDialog';

export default function Severity() {
  const toast = useToast();
  const location = useLocation();
  const [rules, setRules] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(location.state && location.state.create ? location.state.create : null);
  const [del, setDel] = useState(null);

  const load = useCallback(() => {
    api('/severity-rules').then((d) => { setRules(d.rules); setError(''); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    try {
      await api(`/severity-rules/${del.id}`, { method: 'DELETE' });
      toast('Regla eliminada. Los eventos nuevos vuelven a su severidad original.');
      setDel(null);
      load();
    } catch (e) { toast(e.message, 'error'); setDel(null); }
  };

  return (
    <>
      <PageHead title="Severidad"
        actions={<button type="button" className="btn btn--primary" onClick={() => setForm({})}><Plus size={18} /> Nueva regla</button>}>
        Decide con qué severidad se guarda cada tipo de aviso. Por ejemplo, bajar a Info el cambio de IP de origen si en tu red es normal.
      </PageHead>

      <section className="panel">
        {error ? (
          <Empty title="No se pudieron cargar las reglas" action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>{error}</Empty>
        ) : !rules ? (
          <div className="empty">Cargando…</div>
        ) : rules.length === 0 ? (
          <Empty icon={SlidersHorizontal} title="Aún no cambiaste ninguna severidad"
            action={<button type="button" className="btn btn--primary" onClick={() => setForm({})}><Plus size={18} /> Nueva regla</button>}>
            Cada tipo de log trae una severidad por defecto. También puedes cambiarla desde el detalle de cualquier evento.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Tipo de log</th><th>Cliente</th><th>Si el mensaje contiene</th><th>Severidad</th><th>Creada</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td><div className="cell-main">{moduleLabel(r.module)}</div></td>
                    <td>{r.clientName || 'Todos'}</td>
                    <td>{r.match ? <span className="mono">{r.match}</span> : <span className="cell-sub">Cualquiera</span>}</td>
                    <td><SeverityBadge severity={r.severity} /></td>
                    <td className="nowrap"><span className="cell-sub">{timeAgo(r.createdAt)}{r.createdBy ? ` · ${r.createdBy}` : ''}</span></td>
                    <td><button type="button" className="icon-btn" onClick={() => setDel(r)} aria-label="Eliminar regla"><Trash2 size={18} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && <SeverityRuleDialog initial={form} onClose={() => setForm(null)} onSaved={load} />}
      {del && (
        <Dialog title="Eliminar regla" variant="modal" onClose={() => setDel(null)}
          footer={<><button type="button" className="btn" onClick={() => setDel(null)}>Cancelar</button><button type="button" className="btn btn--danger" onClick={remove}>Eliminar</button></>}>
          <div className="dialog-body">
            <p>Los avisos de «{moduleLabel(del.module)}» nuevos dejarán de guardarse como <strong>{del.severity === 'critical' ? 'crítico' : del.severity === 'error' ? 'error' : del.severity === 'warning' ? 'aviso' : 'info'}</strong> y vuelven a su severidad original. Los ya guardados conservan la que tienen.</p>
          </div>
        </Dialog>
      )}
    </>
  );
}
