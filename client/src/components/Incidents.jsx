import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, CircleAlert, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { INCIDENT_KINDS } from '../data/catalog';
import { Empty, dateLong } from './ui';
import IncidentDetail, { duration } from './IncidentDetail';

// Una fila de incidente: qué pasó, desde cuándo y cuánto duró (o cuánto lleva). Al tocarla se abre su detalle.
export function IncidentRow({ i, showClient, to, onOpen }) {
  const open = i.status === 'open';
  return (
    <li className={`incident${open ? '' : ' is-done'}`}>
      <button type="button" className="incident__btn" onClick={() => onOpen(i)} aria-label={`Ver el detalle: ${i.title}`}>
        <span className={`incident__icon incident__icon--${open ? i.severity : 'ok'}`}>
          {open ? <CircleAlert size={18} aria-hidden="true" /> : <CircleCheck size={18} aria-hidden="true" />}
        </span>
        <span className="incident__body">
          <strong>{i.title}</strong>
          <span className="cell-sub">
            {INCIDENT_KINDS[i.kind] || i.kind}
            {showClient && i.clientName ? ` · ${i.clientName}` : ''}
            {' · '}desde {dateLong(i.openedAt)}
            {i.eventCount > 1 ? ` · ${i.eventCount.toLocaleString('es')} avisos` : ''}
          </span>
        </span>
        <span className="incident__time">
          <span className={`badge badge--${open ? i.severity : 'ok'}`}>{open ? 'Abierto' : 'Resuelto'}</span>
          <span className="cell-sub">{open ? `lleva ${duration(i.durationSecs)}` : `duró ${duration(i.durationSecs)}${i.autoClosed ? ' (dejó de repetirse)' : ''}`}</span>
        </span>
        <ChevronRight size={18} className="incident__go" aria-hidden="true" />
      </button>
      {to && <Link to={to} className="incident__client" aria-label={`Ir al espacio de ${i.clientName || 'este cliente'}`}>Ir al cliente</Link>}
    </li>
  );
}

// Pestaña "Incidentes" de un cliente
export default function Incidents({ clientId }) {
  const [tab, setTab] = useState('open');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    api(`/incidents?client=${clientId}&status=${tab}&limit=100`)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message));
  }, [clientId, tab]);
  useEffect(() => {
    setData(null);
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <>
      <div className="chips" style={{ marginBottom: 14 }}>
        {[['open', 'Abiertos'], ['resolved', 'Resueltos']].map(([k, label]) => (
          <button key={k} type="button" className="chip" aria-pressed={tab === k} onClick={() => setTab(k)}>
            {label} {data && <span className="chip__n">{data.counts[k]}</span>}
          </button>
        ))}
      </div>
      <section className="panel">
        {error ? (
          <Empty title="No se pudo cargar" action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>{error}</Empty>
        ) : !data ? (
          <div className="empty">Cargando…</div>
        ) : data.incidents.length === 0 ? (
          <Empty icon={CircleCheck} title={tab === 'open' ? 'No hay incidentes abiertos' : 'Todavía no hay incidentes resueltos'}>
            {tab === 'open' ? 'Aquí aparecen los problemas que siguen activos: internet caído, túneles VPN caídos, conflictos de IP.' : 'Cuando un problema termine, quedará aquí con su duración.'}
          </Empty>
        ) : (
          <>
            <ul className="incidents">
              {data.incidents.map((i) => <IncidentRow key={i.id} i={i} onOpen={(x) => setOpenId(x.id)} />)}
            </ul>
            <p className="list-foot" style={{ justifyContent: 'flex-start' }}>Toca un incidente para ver qué pasó, qué significa y qué hacer.</p>
          </>
        )}
      </section>
      {openId && <IncidentDetail id={openId} onClose={() => { setOpenId(null); load(); }} />}
    </>
  );
}

// Lista corta para el resumen: los abiertos, con acceso a su detalle y al cliente
export function OpenIncidents({ list, total }) {
  const [openId, setOpenId] = useState(null);
  if (!list.length) return null;
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel__head">
        <div>
          <h2>Incidentes abiertos</h2>
          <p>{total} {total === 1 ? 'problema sigue' : 'problemas siguen'} activo{total === 1 ? '' : 's'}. Toca uno para ver qué pasa.</p>
        </div>
      </div>
      <div className="panel__body" style={{ paddingTop: 8 }}>
        <ul className="incidents">
          {list.map((i) => (
            <IncidentRow key={i.id} i={i} showClient onOpen={(x) => setOpenId(x.id)} to={i.clientId ? `/clientes/${i.clientId}/incidentes` : null} />
          ))}
        </ul>
      </div>
      {openId && <IncidentDetail id={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}
