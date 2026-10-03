import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, Lightbulb, ScrollText } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { INCIDENT_KINDS, INCIDENT_INFO, FIELD_LABELS, cleanHost } from '../data/catalog';
import { SeverityBadge, Dialog, Empty, dateLong, timeShort } from './ui';
import EventDetail from './EventDetail';

export function duration(secs) {
  if (secs < 60) return `${secs} s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  return `${Math.floor(h / 24)} días ${h % 24} h`;
}

// Qué pasa en un incidente: desde cuándo, a quién afecta, qué significa, qué hacer y los avisos que lo componen
export default function IncidentDetail({ id, onClose }) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ev, setEv] = useState(null);

  useEffect(() => {
    setData(null);
    api(`/incidents/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);

  // Al abrir un aviso se muestra su detalle; al cerrarlo se vuelve al incidente
  if (ev) {
    const ack = async (e) => {
      try {
        await api('/events/ack', { method: 'POST', body: { ids: [e.id] } });
        toast('Evento marcado como revisado');
        setEv(null);
      } catch (err) { toast(err.message, 'error'); }
    };
    return <EventDetail event={ev} onClose={() => setEv(null)} onAck={ack} />;
  }

  if (error || !data) {
    return (
      <Dialog title="Detalle del incidente" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Cerrar</button>}>
        <div className="dialog-body">{error ? <div className="form-error" role="alert">{error}</div> : <div className="empty">Cargando…</div>}</div>
      </Dialog>
    );
  }

  const { incident: i, opening, events, total } = data;
  const open = i.status === 'open';
  const info = INCIDENT_INFO[i.kind];
  const sample = opening || events[0];
  const meaning = info ? info.meaning(i, sample) : null;
  const action = info ? info.action(i, sample) : null;

  const goLogs = () => {
    const from = new Date(new Date(i.openedAt).getTime() - 60000).toISOString();
    const until = new Date(new Date(open ? Date.now() : i.resolvedAt).getTime() + 60000).toISOString();
    onClose();
    navigate(`/clientes/${i.clientId}/registros`, { state: { since: from, until, q: i.key } });
  };

  return (
    <Dialog title="Detalle del incidente" onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cerrar</button>
          {can('logs.view') && <button type="button" className="btn btn--primary" onClick={goLogs}><ScrollText size={18} /> Ver en Registros</button>}
        </>
      }>
      <div className="dialog-body">
        <div className="detail-top">
          <span className={`badge badge--${open ? i.severity : 'ok'}`}>{open ? 'Abierto' : 'Resuelto'}</span>
          <SeverityBadge severity={i.severity} />
          <span className="badge badge--plain">{INCIDENT_KINDS[i.kind] || i.kind}</span>
        </div>

        <div>
          <h3 className="detail-title">{i.title}</h3>
          <p className="cell-sub">{i.clientName}</p>
        </div>

        <dl className="fields">
          <dt>Afecta a</dt><dd className="mono">{i.key}</dd>
          <dt>Empezó</dt><dd>{dateLong(i.openedAt)}</dd>
          {open ? (
            <><dt>Estado</dt><dd>Sigue abierto: lleva <strong>{duration(i.durationSecs)}</strong></dd></>
          ) : (
            <>
              <dt>Terminó</dt><dd>{dateLong(i.resolvedAt)}</dd>
              <dt>Duró</dt><dd><strong>{duration(i.durationSecs)}</strong>{i.autoClosed ? ' (se cerró solo porque dejó de repetirse)' : ''}</dd>
            </>
          )}
          <dt>Avisos</dt><dd>{i.eventCount.toLocaleString('es')}{open && i.lastSeen ? `, el último ${dateLong(i.lastSeen)}` : ''}</dd>
        </dl>

        {meaning && (
          <div className="note"><Info size={18} aria-hidden="true" /><div><strong>Qué significa</strong><p>{meaning}</p></div></div>
        )}
        {action && (
          <div className="note note--action"><Lightbulb size={18} aria-hidden="true" /><div><strong>Qué hacer</strong><p>{action}</p></div></div>
        )}

        {opening && Object.keys(opening.fields).length > 0 && (
          <div>
            <h3 className="detail-sub">Datos del primer aviso</h3>
            <dl className="fields">
              {Object.entries(opening.fields).map(([k, v]) => (
                <React.Fragment key={k}><dt>{FIELD_LABELS[k] || k}</dt><dd className="mono">{String(v)}</dd></React.Fragment>
              ))}
            </dl>
          </div>
        )}

        <div>
          <h3 className="detail-sub">Qué pasó{total > 0 ? ` · ${events.length < total ? `últimos ${events.length} de ${total.toLocaleString('es')} avisos` : `${total} ${total === 1 ? 'aviso' : 'avisos'}`}` : ''}</h3>
          {events.length === 0 ? (
            <Empty title="No hay avisos para mostrar">Los eventos de este incidente ya no están guardados (borrado por días) o todavía no llegaron.</Empty>
          ) : (
            <ul className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <button type="button" className="timeline__item" onClick={() => setEv(e)}>
                    <span className="mono">{timeShort(e.ts)}</span>
                    <span>{e.summary}</span>
                    <span className="cell-sub">{cleanHost(e.host) || e.sourceIp}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {opening && events.length > 0 && total > events.length && (
            <p className="cell-sub" style={{ marginTop: 8 }}>
              El primero fue el {dateLong(opening.ts)}: <button type="button" className="link-btn" onClick={() => setEv(opening)}>ver ese aviso</button>.
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
