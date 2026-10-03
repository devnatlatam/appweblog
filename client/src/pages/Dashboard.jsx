import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Activity, TriangleAlert, ShieldAlert, ChevronRight, CheckCircle2, CheckCheck, OctagonAlert } from 'lucide-react';
import { useEvents } from '../context/EventsContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api';
import { SEVERITY_ORDER, SEVERITIES } from '../data/severity';
import { moduleLabel } from '../data/catalog';
import { PageHead, SeverityBadge, Empty, timeAgo } from '../components/ui';
import { OpenIncidents } from '../components/Incidents';

function Stat({ icon: Icon, label, value, note, tone }) {
  return (
    <div className="panel stat">
      <span className={`stat__icon stat__icon--${tone}`}><Icon size={20} aria-hidden="true" /></span>
      <div>
        <div className="stat__value">{value}</div>
        <div className="stat__label">{label}</div>
        {note && <div className="stat__note">{note}</div>}
      </div>
    </div>
  );
}

const hourLabel = (iso) => String(new Date(iso).getHours()).padStart(2, '0');
const fmt = (n) => n.toLocaleString('es');

function HourChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div className="chart" role="img" aria-label="Eventos por hora en las últimas 24 horas">
      <div className="chart__bars">
        {data.map((d, i) => (
          <div key={d.hour} className="chart__col" title={`${hourLabel(d.hour)}:00 — ${fmt(d.total)} eventos`}>
            <div className="chart__stack" style={{ height: `${(d.total / max) * 100}%` }}>
              {SEVERITY_ORDER.slice().reverse().map((s) =>
                d[s] ? <span key={s} className={`seg seg--${s}`} style={{ flexGrow: d[s] }} /> : null
              )}
            </div>
            <span className="chart__tick">{i % 3 === 0 ? hourLabel(d.hour) : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Resumen de un solo cliente: se consulta aparte y se refresca solo
function useClientSummary(clientId) {
  const { live } = useEvents();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    if (!clientId) return;
    api(`/summary?client=${clientId}`).then((d) => { setSummary(d); setError(''); }).catch((e) => setError(e.message));
  }, [clientId]);
  useEffect(() => {
    if (!clientId) return undefined;
    refresh();
    if (!live) return undefined;
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [clientId, live, refresh]);
  return { summary, error, refresh };
}

export default function Dashboard({ clientId = null, embedded = false }) {
  const general = useEvents();
  const scoped = useClientSummary(clientId);
  const { summary, error, refresh } = clientId ? scoped : general;
  const { can } = useAuth();
  const toast = useToast();

  if (!summary) {
    return (
      <>
        {!embedded && <PageHead title="Resumen general" />}
        {error ? (
          <div className="panel"><Empty title="No se pudo cargar el resumen" action={<button type="button" className="btn" onClick={refresh}>Reintentar</button>}>{error}</Empty></div>
        ) : <div className="empty">Cargando…</div>}
      </>
    );
  }

  const { totals, total, byCategory, hourly, attention, pending, sources, incidents } = summary;
  const maxCat = Math.max(1, ...byCategory.map((c) => c.n));

  const markGroup = async (g) => {
    try {
      await api('/events/ack', { method: 'POST', body: { clientId: g.clientId, module: g.module, summary: g.summary } });
      toast('Marcado como revisado');
      refresh();
      general.refresh();
    } catch (e) { toast(e.message, 'error'); }
  };

  const logsLink = (g) => (g.clientId ? `/clientes/${g.clientId}/registros` : null);

  return (
    <>
      {!embedded && (
        <PageHead title="Resumen general">
          Qué pasó en las últimas 24 horas en todos los clientes y qué necesita tu atención. Para ver los logs de uno en particular, entra a su espacio desde el menú.
        </PageHead>
      )}

      <div className="grid-stats">
        {clientId ? (
          <Stat icon={OctagonAlert} tone={totals.critical + totals.error ? 'crit' : 'ok'} label="Críticos y errores (24 h)" value={fmt(totals.critical + totals.error)} />
        ) : (
          <Stat icon={Radio} tone={sources.withSignal === sources.total ? 'ok' : 'warn'} label="Clientes con señal"
            value={`${sources.withSignal} de ${sources.total}`} note="Puertos encendidos que recibieron logs en los últimos 15 min" />
        )}
        <Stat icon={Activity} tone="info" label="Eventos recibidos (24 h)" value={fmt(total)} />
        <Stat icon={ShieldAlert} tone={pending ? 'crit' : 'ok'} label="Problemas por revisar" value={pending}
          note="Errores y avisos sin marcar" />
        <Stat icon={TriangleAlert} tone="warn" label="Avisos (24 h)" value={fmt(totals.warning)} />
      </div>

      <div className="grid-main">
        <section className="panel">
          <div className="panel__head">
            <div>
              <h2>Eventos por hora</h2>
              <p>{fmt(total)} eventos en las últimas 24 horas</p>
            </div>
            <div className="legend">
              {SEVERITY_ORDER.map((s) => (
                <span key={s}><i className={`seg seg--${s}`} />{SEVERITIES[s].label} {fmt(totals[s])}</span>
              ))}
            </div>
          </div>
          <div className="panel__body"><HourChart data={hourly} /></div>
        </section>

        <section className="panel">
          <div className="panel__head"><h2>Por categoría</h2></div>
          <div className="panel__body">
            {byCategory.length === 0 ? <p className="cell-sub">Sin eventos en las últimas 24 horas.</p> : (
              <ul className="bars">
                {byCategory.map((c) => (
                  <li key={c.category}>
                    <span>{c.category}</span>
                    <span className="bars__track"><span style={{ width: `${(c.n / maxCat) * 100}%` }} /></span>
                    <span className="mono">{fmt(c.n)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {incidents && <OpenIncidents list={incidents.list} total={incidents.open} />}

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel__head">
          <div>
            <h2>Necesita tu atención</h2>
            <p>Errores y avisos que nadie ha marcado como revisados, agrupados por problema</p>
          </div>
        </div>
        <div className="panel__body" style={{ paddingTop: 8 }}>
          {attention.length === 0 ? (
            <div className="empty" style={{ padding: '28px 0' }}>
              <CheckCircle2 size={32} />
              <h3>Todo revisado</h3>
              <p>No hay errores ni avisos pendientes.</p>
            </div>
          ) : (
            <ul className="attention attention--groups">
              {attention.map((g) => (
                <li key={`${g.clientId}|${g.module}|${g.summary}`}>
                  <SeverityBadge severity={g.severity} />
                  <div>
                    <strong>{g.summary}</strong>
                    <span>
                      {clientId ? moduleLabel(g.module) : `${g.clientName || g.host || g.sourceIp} · ${moduleLabel(g.module)}`}
                      {g.count > 1 ? ` · se repitió ${fmt(g.count)} veces, la última ${timeAgo(g.lastTs).toLowerCase()}` : ` · ${timeAgo(g.lastTs).toLowerCase()}`}
                    </span>
                  </div>
                  <div className="attention__actions">
                    {can('logs.ack') && (
                      <button type="button" className="btn btn--sm" onClick={() => markGroup(g)}><CheckCheck size={16} /> Revisado</button>
                    )}
                    {can('logs.view') && logsLink(g) && (
                      <Link to={logsLink(g)} state={{ module: g.module, pending: true }} className="icon-btn" aria-label="Ver en registros"><ChevronRight size={20} /></Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
