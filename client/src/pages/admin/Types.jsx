import React, { useCallback, useEffect, useState } from 'react';
import { Check, X, RotateCcw, ChevronDown, ChevronUp, ListChecks, Sparkles } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../context/ToastContext';
import { PageHead, Empty, timeAgo, dateLong } from '../../components/ui';

const fmt = (n) => n.toLocaleString('es');
const TABS = [
  { key: 'pending', label: 'Por aprobar' },
  { key: 'approved', label: 'Aprobados' },
  { key: 'rejected', label: 'Rechazados' },
];

function Samples({ id }) {
  const [list, setList] = useState(null);
  useEffect(() => { api(`/types/${id}/samples`).then((d) => setList(d.samples)).catch(() => setList([])); }, [id]);
  if (!list) return <p className="cell-sub">Cargando ejemplos…</p>;
  if (!list.length) return <p className="cell-sub">No hay ejemplos guardados.</p>;
  return (
    <ul className="samples">
      {list.map((s) => (
        <li key={s.id}>
          <span className="cell-sub">{dateLong(s.ts)} · {s.sourceIp}</span>
          <pre className="raw">{s.raw}</pre>
        </li>
      ))}
    </ul>
  );
}

function TypeCard({ t, categories, tab, onDone }) {
  const toast = useToast();
  const [category, setCategory] = useState(t.category);
  const [label, setLabel] = useState(t.label);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (action, body, message) => {
    setBusy(true);
    try {
      await api(`/types/${t.id}/${action}`, { method: 'POST', body });
      toast(message);
      onDone();
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  return (
    <article className="panel type-card">
      <div className="type-card__top">
        <span className="badge badge--accent badge--plain">{t.clientName}</span>
        <span className="cell-sub">{fmt(t.eventCount)} {t.eventCount === 1 ? 'mensaje' : 'mensajes'} · primero {timeAgo(t.firstSeen).toLowerCase()} · último {timeAgo(t.lastSeen).toLowerCase()}</span>
      </div>

      {tab === 'pending' ? (
        <div className="type-card__form">
          <div className="field">
            <label htmlFor={`l${t.id}`}>Cómo se llama este tipo de log</label>
            <input id={`l${t.id}`} className="input" value={label} maxLength={140} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`c${t.id}`}>Categoría <span className="hint">(sugerida: {t.suggestedCategory})</span></label>
            <select id={`c${t.id}`} className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div>
          <h3>{t.label}</h3>
          <p className="cell-sub">Categoría: {t.category}</p>
        </div>
      )}

      <button type="button" className="btn btn--sm btn--ghost type-card__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {open ? 'Ocultar ejemplos' : 'Ver ejemplos reales'}
      </button>
      {open && <Samples id={t.id} />}
      {!open && t.sample && <pre className="raw raw--sample">{t.sample}</pre>}

      <div className="type-card__actions">
        {tab === 'pending' && (
          <>
            <button type="button" className="btn btn--danger" disabled={busy}
              onClick={() => run('reject', {}, 'Tipo rechazado: ya no se guardarán esos mensajes')}><X size={18} /> Rechazar</button>
            <button type="button" className="btn btn--primary" disabled={busy || !label.trim()}
              onClick={() => run('approve', { category, label }, 'Tipo aprobado: ya aparece en los registros')}><Check size={18} /> Aprobar</button>
          </>
        )}
        {tab !== 'pending' && (
          <button type="button" className="btn" disabled={busy}
            onClick={() => run('reopen', {}, 'Volvió a la lista por aprobar')}><RotateCcw size={18} /> Volver a revisar</button>
        )}
      </div>
    </article>
  );
}

export default function Types() {
  const [tab, setTab] = useState('pending');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api(`/types?status=${tab}`)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message));
  }, [tab]);
  useEffect(() => {
    setData(null);
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load]);

  const done = () => { load(); window.dispatchEvent(new Event('types-changed')); };

  return (
    <>
      <PageHead title="Por aprobar">
        Cuando llega un tipo de log que el sistema no conocía, se agrupa y se le sugiere una categoría. Mientras no lo apruebes, esos mensajes se guardan pero no aparecen en los registros de los clientes.
      </PageHead>

      <div className="chips" role="tablist" aria-label="Estado" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" className="chip" aria-pressed={tab === t.key} aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label} {data && <span className="chip__n">{data.counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {error ? (
        <div className="panel"><Empty title="No se pudo cargar" action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>{error}</Empty></div>
      ) : !data ? (
        <div className="empty">Cargando…</div>
      ) : data.types.length === 0 ? (
        <div className="panel">
          <Empty icon={tab === 'pending' ? Sparkles : ListChecks} title={tab === 'pending' ? 'No hay nada por aprobar' : 'Aquí no hay nada todavía'}>
            {tab === 'pending' ? 'Cuando algún equipo envíe un tipo de log nuevo, aparecerá aquí con una categoría sugerida.' : 'Los tipos que decidas aparecerán en esta lista.'}
          </Empty>
        </div>
      ) : (
        <div className="type-list">
          {data.types.map((t) => <TypeCard key={`${t.id}-${t.status}`} t={t} categories={data.categories} tab={tab} onDone={done} />)}
        </div>
      )}
    </>
  );
}
