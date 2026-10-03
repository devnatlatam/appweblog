import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, CircleAlert, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { INCIDENT_KINDS } from '../data/catalog';
import { SeverityBadge, Empty, dateLong } from './ui';

export function duration(secs) {
  if (secs < 60) return `${secs} s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  return `${Math.floor(h / 24)} días ${h % 24} h`;
}

// Una fila de incidente: qué pasó, desde cuándo y cuánto duró (o cuánto lleva)
export function IncidentRow({ i, showClient, to }) {
  const open = i.status === 'open';
  return (
    <li className={`incident${open ? '' : ' is-done'}`}>
      <span className={`incident__icon incident__icon--${open ? i.severity : 'ok'}`}>
        {open ? <CircleAlert size={18} aria-hidden="true" /> : <CircleCheck size={18} aria-hidden="true" />}
      </span>
      <div className="incident__body">
        <strong>{i.title}</strong>
        <span className="cell-sub">
          {INCIDENT_KINDS[i.kind] || i.kind}
          {showClient && i.clientName ? ` · ${i.clientName}` : ''}
          {' · '}desde {dateLong(i.openedAt)}
          {i.eventCount > 1 ? ` · ${i.eventCount.toLocaleString('es')} avisos` : ''}
        </span>
      </div>
      <div className="incident__time">
        <span className={`badge badge--${open ? i.severity : 'ok'}`}>{open ? 'Abierto' : 'Resuelto'}</span>
        <span className="cell-sub">{open ? `lleva ${duration(i.durationSecs)}` : `duró ${duration(i.durationSecs)}${i.autoClosed ? ' (dejó de repetirse)' : ''}`}</span>
      </div>
      {to && <Link to={to} className="icon-btn" aria-label="Ver incidentes del cliente"><ChevronRight size={20} /></Link>}
    </li>
  );
}

// Pestaña "Incidentes" de un cliente
export default function Incidents({ clientId }) {
  const [tab, setTab] = useState('open');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

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
          <ul className="incidents">
            {data.incidents.map((i) => <IncidentRow key={i.id} i={i} />)}
          </ul>
        )}
      </section>
    </>
  );
}

// Lista corta para el resumen: los abiertos, con un enlace al cliente
export function OpenIncidents({ list, total }) {
  if (!list.length) return null;
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel__head">
        <div>
          <h2>Incidentes abiertos</h2>
          <p>{total} {total === 1 ? 'problema sigue' : 'problemas siguen'} activo{total === 1 ? '' : 's'}</p>
        </div>
      </div>
      <div className="panel__body" style={{ paddingTop: 8 }}>
        <ul className="incidents">
          {list.map((i) => (
            <IncidentRow key={i.id} i={i} showClient to={i.clientId ? `/clientes/${i.clientId}/incidentes` : null} />
          ))}
        </ul>
      </div>
    </section>
  );
}
