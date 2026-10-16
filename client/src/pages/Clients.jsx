import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, Settings2, ScrollText, Radio, CircleAlert, Cable, TriangleAlert, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { PageHead, Empty, timeAgo } from '../components/ui';
import { groupClients } from '../data/clientGroups';

const SILENT_MS = 15 * 60000; // sin recibir nada durante este tiempo = "sin señal"
const POLL_MS = 15000;
const fmt = (n) => (n || 0).toLocaleString('es');

// El estado de un cliente, en una palabra, y qué tan urgente es (menor = primero)
function stateOf(p) {
  if (p.isActive && !p.listening) return { key: 'error', label: 'Error de puerto', cls: 'critical', rank: 1 };
  if (!p.isActive) return { key: 'off', label: 'Apagado', cls: 'plain', rank: 6 };
  if (!p.lastSeen) return { key: 'waiting', label: 'Esperando logs', cls: 'info', rank: 4 };
  if (Date.now() - new Date(p.lastSeen).getTime() > SILENT_MS) return { key: 'silent', label: 'Sin señal', cls: 'warning', rank: 3 };
  return { key: 'ok', label: 'Recibiendo', cls: 'ok', rank: 5 };
}

// Eventos por hora de las últimas 24 horas; en rojo las horas con errores
function Spark({ hourly, errors }) {
  const max = Math.max(1, ...hourly);
  return (
    <div className="spark" role="img" aria-label="Eventos por hora en las últimas 24 horas">
      {hourly.map((n, i) => (
        <span key={i} className={n === 0 ? 'is-zero' : errors[i] > 0 ? 'is-err' : ''} style={n === 0 ? undefined : { height: `${Math.max(8, (n / max) * 100)}%` }} />
      ))}
    </div>
  );
}

function ClientCard({ p, ov, can, name = p.clientName }) {
  const st = stateOf(p);
  const hourly = ov ? ov.hourly : Array(24).fill(0);
  const errs = ov ? ov.hourlyErrors : Array(24).fill(0);
  const base = `/clientes/${p.id}`;
  return (
    <article className={`panel client-card client-card--${st.key}${p.openIncidents ? ' has-incidents' : ''}`}>
      <header className="client-card__head">
        <div className="client-card__title">
          <h3><Link to={base} className="client-card__link" aria-label={p.clientName}>{name}</Link></h3>
          <p className="mono cell-sub">Puerto {p.port} · {p.protocol.toUpperCase()}</p>
        </div>
        <span className={`badge badge--${st.cls}`}>{st.label}</span>
      </header>

      {p.isActive && !p.listening && p.error && <p className="port-error"><TriangleAlert size={14} aria-hidden="true" /> {p.error}</p>}

      <Spark hourly={hourly} errors={errs} />

      <dl className="client-card__stats">
        <div><dt>Eventos (24 h)</dt><dd>{fmt(ov ? ov.total24h : p.events24h)}</dd></div>
        <div><dt>Errores</dt><dd className={ov && ov.errors24h ? 'is-bad' : ''}>{fmt(ov ? ov.errors24h : 0)}</dd></div>
        <div><dt>Avisos</dt><dd>{fmt(ov ? ov.warnings24h : 0)}</dd></div>
      </dl>

      <div className="client-card__meta">
        <span className="cell-sub">Último log: {p.lastSeen ? timeAgo(p.lastSeen).toLowerCase() : 'nunca'}</span>
        {p.sourceIps && p.sourceIps[0] && <span className="cell-sub">Envía desde <span className="mono">{p.sourceIps[0].ip}</span></span>}
        {p.openIncidents > 0 && (
          <span className="client-card__inc"><CircleAlert size={15} aria-hidden="true" /> {p.openIncidents} {p.openIncidents === 1 ? 'incidente abierto' : 'incidentes abiertos'}</span>
        )}
      </div>

      <footer className="client-card__actions">
        {can('logs.view') && <Link to={`${base}/registros`} className="btn btn--sm"><ScrollText size={16} /> Registros</Link>}
        {can('logs.view') && <Link to={`${base}/en-vivo`} className="btn btn--sm"><Radio size={16} /> En vivo</Link>}
        {can('dashboard.view') && p.openIncidents > 0 && <Link to={`${base}/incidentes`} className="btn btn--sm btn--danger"><CircleAlert size={16} /> Incidentes</Link>}
      </footer>
    </article>
  );
}

const isIssue = (r) => r.st.key === 'error' || r.st.key === 'silent' || r.p.openIncidents > 0;

function GroupSection({ name, items, can, open, onToggle }) {
  const receiving = items.filter((x) => x.item.st.key === 'ok' || x.item.st.key === 'waiting').length;
  const issues = items.filter((x) => isIssue(x.item)).length;
  const off = items.filter((x) => x.item.st.key === 'off').length;
  return (
    <section className={`client-group${issues ? ' has-issues' : ''}`}>
      <button type="button" className="client-group__head" aria-expanded={open} onClick={onToggle}>
        <ChevronRight size={18} aria-hidden="true" className="client-group__chev" />
        <h2>{name}</h2>
        <span className="cell-sub">{items.length} {items.length === 1 ? 'sede' : 'sedes'}</span>
        <span className="client-group__stats">
          <span className="badge badge--ok">{receiving} recibiendo</span>
          {issues > 0 && <span className="badge badge--critical">{issues} con problemas</span>}
          {off > 0 && <span className="badge badge--plain">{off} {off === 1 ? 'apagada' : 'apagadas'}</span>}
        </span>
      </button>
      {open && (
        <div className="client-grid">
          {items.map((x) => <ClientCard key={x.item.p.id} p={x.item.p} ov={x.item.ov} can={can} name={x.label} />)}
        </div>
      )}
    </section>
  );
}

const FILTERS = [
  ['all', 'Todos'],
  ['issues', 'Con problemas'],
  ['ok', 'Recibiendo'],
  ['off', 'Apagados'],
];

export default function Clients() {
  const { can } = useAuth();
  const [ports, setPorts] = useState(null);
  const [overview, setOverview] = useState({});
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [closed, setClosed] = useState(() => new Set()); // grupos plegados

  const load = useCallback(() => {
    Promise.all([api('/ports'), api('/clients/overview')])
      .then(([p, o]) => { setPorts(p.ports); setOverview(o.clients); setError(''); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const rows = useMemo(() => (ports || []).map((p) => ({ p, st: stateOf(p), ov: overview[p.id] })), [ports, overview]);

  const counts = useMemo(() => {
    return {
      all: rows.length,
      issues: rows.filter(isIssue).length,
      ok: rows.filter((r) => r.st.key === 'ok' || r.st.key === 'waiting').length,
      off: rows.filter((r) => r.st.key === 'off').length,
      incidents: rows.reduce((n, r) => n + (r.p.openIncidents || 0), 0),
    };
  }, [rows]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (t && !`${r.p.clientName} ${r.p.port}`.toLowerCase().includes(t)) return false;
        if (filter === 'issues') return isIssue(r);
        if (filter === 'ok') return r.st.key === 'ok' || r.st.key === 'waiting';
        if (filter === 'off') return r.st.key === 'off';
        return true;
      })
      // Lo que necesita atención primero: error de puerto, incidentes abiertos, sin señal…
      .sort((a, b) => {
        const ra = a.p.openIncidents > 0 && a.st.rank > 1 ? 2 : a.st.rank;
        const rb = b.p.openIncidents > 0 && b.st.rank > 1 ? 2 : b.st.rank;
        return ra - rb || a.p.clientName.localeCompare(b.p.clientName, 'es');
      });
  }, [rows, q, filter]);

  // Los clientes con el mismo prefijo ("FONDESURCO - …") se muestran juntos; un grupo va donde está su sede más urgente.
  // Los clientes sueltos seguidos comparten una misma grilla.
  const blocks = useMemo(() => {
    const out = [];
    groupClients(shown, (r) => r.p.clientName, rows).forEach((e) => {
      if (e.group) out.push(e);
      else if (out.length && out[out.length - 1].singles) out[out.length - 1].singles.push(e.item);
      else out.push({ singles: [e.item] });
    });
    return out;
  }, [shown, rows]);
  const toggleGroup = (g) => setClosed((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  const manage = can('ports.manage');

  return (
    <>
      <PageHead title="Clientes"
        actions={(
          <>
            {manage && <Link to="/puertos" className="btn"><Settings2 size={18} /> Gestionar clientes</Link>}
            {manage && <Link to="/puertos" state={{ create: true }} className="btn btn--primary"><Plus size={18} /> Nuevo cliente</Link>}
          </>
        )}>
        Cada cliente tiene su propio espacio con sus logs. Toca uno para entrar, o ve directo a sus registros o al vivo.
      </PageHead>

      {error && !ports ? (
        <div className="panel"><Empty title="No se pudieron cargar los clientes" action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>{error}</Empty></div>
      ) : !ports ? (
        <div className="empty">Cargando…</div>
      ) : ports.length === 0 ? (
        <div className="panel">
          <Empty icon={Cable} title="Aún no hay clientes"
            action={manage ? <Link to="/puertos" state={{ create: true }} className="btn btn--primary"><Plus size={18} /> Crear el primer cliente</Link> : null}>
            {manage ? 'Crea un cliente, asígnale un puerto y apunta su equipo a este servidor.' : 'Un administrador debe crear el primer cliente.'}
          </Empty>
        </div>
      ) : (
        <>
          <div className="clients-summary">
            <div className="panel"><strong>{counts.all}</strong><span>{counts.all === 1 ? 'cliente' : 'clientes'}</span></div>
            <div className="panel"><strong className="is-ok">{counts.ok}</strong><span>recibiendo</span></div>
            <div className="panel"><strong className={counts.issues ? 'is-bad' : ''}>{counts.issues}</strong><span>con problemas</span></div>
            <div className="panel"><strong className={counts.incidents ? 'is-bad' : ''}>{counts.incidents}</strong><span>{counts.incidents === 1 ? 'incidente abierto' : 'incidentes abiertos'}</span></div>
          </div>

          <div className="filters__row" style={{ margin: '16px 0' }}>
            <div className="input-wrap filters__search">
              <Search size={18} aria-hidden="true" />
              <input className="input" type="search" placeholder="Buscar por nombre o puerto" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar clientes" />
            </div>
            <div className="chips" role="group" aria-label="Filtrar por estado">
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label} <span className="chip__n">{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="panel"><Empty icon={Search} title="Ningún cliente coincide" action={<button type="button" className="btn" onClick={() => { setQ(''); setFilter('all'); }}>Quitar filtros</button>}>Prueba con otro nombre o estado.</Empty></div>
          ) : (
            <div className="client-blocks">
              {blocks.map((b) => (b.group ? (
                <GroupSection key={`g:${b.group}`} name={b.group} items={b.items} can={can} open={!closed.has(b.group)} onToggle={() => toggleGroup(b.group)} />
              ) : (
                <div key={`s:${b.singles[0].p.id}`} className="client-grid">
                  {b.singles.map((r) => <ClientCard key={r.p.id} p={r.p} ov={r.ov} can={can} />)}
                </div>
              )))}
            </div>
          )}
        </>
      )}
    </>
  );
}
