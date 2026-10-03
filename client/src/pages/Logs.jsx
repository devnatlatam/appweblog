import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Download, SearchX, AlertCircle, X, Layers } from 'lucide-react';
import { api, apiDownload, qs } from '../api';
import { useEvents } from '../context/EventsContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { SEVERITIES, SEVERITY_ORDER } from '../data/severity';
import { moduleLabel, FILTER_MODULES } from '../data/catalog';
import EventDetail from '../components/EventDetail';
import { PageHead, SeverityBadge, Empty, timeShort } from '../components/ui';

const RANGES = [
  { v: 1, label: 'Última hora' },
  { v: 6, label: 'Últimas 6 horas' },
  { v: 24, label: 'Últimas 24 horas' },
  { v: 168, label: 'Últimos 7 días' },
];
const GROUPS = [
  { v: 0, label: 'Cada evento por separado' },
  { v: 60, label: 'Agrupar repetidos por minuto' },
  { v: 300, label: 'Agrupar repetidos cada 5 min' },
  { v: 900, label: 'Agrupar repetidos cada 15 min' },
  { v: 3600, label: 'Agrupar repetidos por hora' },
];
const PAGE = 40;
const POLL_MS = 5000;
const byNewest = (a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b.id - a.id);
const hhmm = (iso) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });

export default function Logs({ clientId = null, embedded = false }) {
  const { live, refresh } = useEvents();
  const { can } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const from = location.state || {};

  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [sev, setSev] = useState([]);
  const [module, setModule] = useState(from.module || '');
  const client = clientId ? String(clientId) : '';
  const [hours, setHours] = useState(24);
  const [pending, setPending] = useState(Boolean(from.pending));
  const [groupSecs, setGroupSecs] = useState(0);
  const [win, setWin] = useState(null); // { since, until } al abrir un grupo

  const [items, setItems] = useState([]);   // eventos (modo normal)
  const [groups, setGroups] = useState([]); // filas agrupadas (modo agrupado)
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const req = useRef(0);
  const grouped = groupSecs > 0;

  // Pequeña espera al escribir para no consultar en cada tecla
  useEffect(() => {
    const t = setTimeout(() => setQLive(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filterParams = {
    q: qLive, sev: sev.join(','), module, client, ack: pending ? '0' : '',
    ...(win ? { since: win.since, until: win.until } : { hours }),
  };

  const load = useCallback(() => {
    const id = req.current + 1;
    req.current = id;
    setLoading(true);
    api(`/events${qs({ ...filterParams, limit: PAGE, group: groupSecs || undefined })}`)
      .then((d) => {
        if (id !== req.current) return;
        if (d.grouped) setGroups(d.groups); else setItems(d.events);
        setHasMore(d.hasMore); setTotal(d.total || 0); setError('');
      })
      .catch((e) => { if (id === req.current) setError(e.message); })
      .finally(() => { if (id === req.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLive, sev.join(','), module, client, hours, pending, groupSecs, win && win.since]);

  useEffect(() => { setItems([]); setGroups([]); load(); }, [load]);

  const loadMore = () => {
    if (grouped) {
      api(`/events${qs({ ...filterParams, limit: PAGE, group: groupSecs, offset: groups.length })}`)
        .then((d) => { setGroups((l) => [...l, ...d.groups]); setHasMore(d.hasMore); })
        .catch((e) => toast(e.message, 'error'));
      return;
    }
    const last = items[items.length - 1];
    if (!last) return;
    api(`/events${qs({ ...filterParams, limit: PAGE, beforeTs: last.ts, beforeId: last.id })}`)
      .then((d) => { setItems((l) => [...l, ...d.events]); setHasMore(d.hasMore); })
      .catch((e) => toast(e.message, 'error'));
  };

  // En vivo. Modo normal: pide solo lo posterior al último id conocido. Modo agrupado: recarga la lista cada tanto.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => {
      if (grouped) { if (!win) load(); return; }
      const cur = itemsRef.current;
      if (!cur.length) { load(); return; }
      const maxId = Math.max(...cur.map((e) => e.id));
      const id = req.current;
      api(`/events${qs({ ...filterParams, limit: 200, after: maxId })}`)
        .then((d) => {
          if (id !== req.current || !d.events.length) return;
          if (d.hasMore) { load(); return; }
          setItems((l) => [...d.events, ...l].sort(byNewest));
          setTotal((n) => n + d.events.length);
        })
        .catch(() => {});
    }, grouped ? POLL_MS * 2 : POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, load, grouped]);

  const ack = async (ev) => {
    try {
      await api('/events/ack', { method: 'POST', body: { ids: [ev.id] } });
      setItems((l) => l.map((e) => (e.id === ev.id ? { ...e, acknowledged: true } : e)));
      toast('Evento marcado como revisado');
      setOpenId(null);
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  };

  // Abrir un grupo: vuelve a mostrar cada evento, limitado a esa ventana de tiempo y a ese mensaje
  const openGroup = (g) => {
    setWin({ since: g.bucket, until: g.until, label: `${hhmm(g.bucket)}–${hhmm(g.until)}` });
    setQ(g.summary); setQLive(g.summary);
    setModule(g.module);
    setGroupSecs(0);
  };

  const selected = openId ? items.find((e) => e.id === openId) : null;
  const toggleSev = (s) => setSev((l) => (l.includes(s) ? l.filter((x) => x !== s) : [...l, s]));
  const clear = () => { setQ(''); setQLive(''); setSev([]); setModule(''); setPending(false); setWin(null); };
  const hasFilters = q || sev.length || module || pending || win;

  const exportCsv = () => {
    apiDownload(`/events/export${qs(filterParams)}`, 'registros.csv')
      .then(() => toast('Archivo descargado'))
      .catch((e) => toast(e.message, 'error'));
  };

  const rows = grouped ? groups : items;
  const totalLabel = total > 10000 ? 'más de 10.000' : total.toLocaleString('es');
  const exportBtn = can('logs.export') && (
    <button type="button" className="btn" onClick={exportCsv} disabled={!items.length && !groups.length}><Download size={18} /> Exportar CSV</button>
  );

  return (
    <>
      {embedded ? (
        exportBtn && <div className="embedded-bar">{exportBtn}</div>
      ) : (
        <PageHead title="Registros" actions={exportBtn}>
          Cada línea que envían tus equipos, explicada. Abre un evento para ver qué significa.
        </PageHead>
      )}

      <section className="panel filters" aria-label="Filtros">
        <div className="filters__row">
          <div className="input-wrap filters__search">
            <Search size={18} aria-hidden="true" />
            <input className="input" type="search" placeholder="Buscar por texto, IP o dirección MAC" value={q}
              onChange={(e) => setQ(e.target.value)} aria-label="Buscar en registros" />
          </div>
          <select className="select filters__sel" value={hours} onChange={(e) => { setWin(null); setHours(Number(e.target.value)); }} aria-label="Período">
            {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
          <select className="select filters__sel" value={module} onChange={(e) => setModule(e.target.value)} aria-label="Tipo de log">
            <option value="">Todos los tipos</option>
            {FILTER_MODULES.map((m) => <option key={m} value={m}>{moduleLabel(m)}</option>)}
          </select>
          <select className="select filters__sel filters__sel--wide" value={groupSecs} onChange={(e) => setGroupSecs(Number(e.target.value))} aria-label="Agrupar repetidos">
            {GROUPS.map((g) => <option key={g.v} value={g.v}>{g.label}</option>)}
          </select>
        </div>
        <div className="filters__row filters__row--chips">
          <div className="chips" role="group" aria-label="Severidad">
            {SEVERITY_ORDER.map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={sev.includes(s)} onClick={() => toggleSev(s)}>
                {SEVERITIES[s].label}
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={pending} onClick={() => setPending(!pending)}>Sin revisar</button>
          </div>
          {hasFilters && <button type="button" className="btn btn--sm btn--ghost" onClick={clear}>Quitar filtros</button>}
        </div>
        {win && (
          <div className="win-chip">
            <Layers size={16} aria-hidden="true" />
            <span>Eventos de un grupo, entre las {win.label}</span>
            <button type="button" className="icon-btn" onClick={clear} aria-label="Volver a ver todo"><X size={16} /></button>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        {error ? (
          <Empty icon={AlertCircle} title="No se pudieron cargar los registros"
            action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>{error}</Empty>
        ) : loading && !rows.length ? (
          <div className="empty">Cargando registros…</div>
        ) : rows.length === 0 ? (
          <Empty icon={SearchX} title="Ningún registro coincide"
            action={hasFilters ? <button type="button" className="btn" onClick={clear}>Quitar filtros</button> : null}>
            Prueba con otro período o menos filtros.
          </Empty>
        ) : grouped ? (
          <>
            <div className="table-wrap logs-table">
              <table className="table">
                <thead>
                  <tr><th>Desde</th><th>Severidad</th><th>Qué pasó</th><th>Veces</th><th>Tipo</th></tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={`${g.bucket}|${g.clientId}|${g.module}|${g.summary}`} className={`row-click${g.acknowledged ? ' is-done' : ''}`} tabIndex={0}
                      onClick={() => openGroup(g)}
                      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openGroup(g); } }}>
                      <td className="mono nowrap">{timeShort(g.bucket).slice(0, 5)}</td>
                      <td><SeverityBadge severity={g.severity} /></td>
                      <td><div className="cell-main">{g.summary}</div></td>
                      <td className="mono nowrap"><span className="badge badge--plain badge--count">×{g.count.toLocaleString('es')}</span></td>
                      <td className="nowrap">{moduleLabel(g.module)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="log-cards">
              {groups.map((g) => (
                <li key={`${g.bucket}|${g.clientId}|${g.module}|${g.summary}`}>
                  <button type="button" className={`log-card sev-${g.severity}${g.acknowledged ? ' is-done' : ''}`} onClick={() => openGroup(g)}>
                    <span className="log-card__top"><SeverityBadge severity={g.severity} /><span className="mono">{timeShort(g.bucket).slice(0, 5)} · ×{g.count.toLocaleString('es')}</span></span>
                    <strong>{g.summary}</strong>
                    <span className="cell-sub">{moduleLabel(g.module)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="list-foot">
              <span>{groups.length.toLocaleString('es')} de {totalLabel} grupos · cada fila reúne los eventos iguales de ese tramo. Toca una para ver sus eventos.</span>
              {hasMore && <button type="button" className="btn btn--sm" onClick={loadMore}>Mostrar más</button>}
            </div>
          </>
        ) : (
          <>
            <div className="table-wrap logs-table">
              <table className="table">
                <thead>
                  <tr><th>Hora</th><th>Severidad</th><th>Qué pasó</th><th>Origen</th><th>Tipo</th></tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id} className={`row-click${e.acknowledged ? ' is-done' : ''}`} tabIndex={0}
                      onClick={() => setOpenId(e.id)}
                      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setOpenId(e.id); } }}>
                      <td className="mono nowrap">{timeShort(e.ts)}</td>
                      <td><SeverityBadge severity={e.severity} /></td>
                      <td>
                        <div className="cell-main">{e.summary}</div>
                        {e.aclName && <div className="cell-sub">Regla {e.aclName}</div>}
                      </td>
                      <td className="nowrap">{e.host || e.sourceIp}</td>
                      <td className="nowrap">{moduleLabel(e.module)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="log-cards">
              {items.map((e) => (
                <li key={e.id}>
                  <button type="button" className={`log-card sev-${e.severity}${e.acknowledged ? ' is-done' : ''}`} onClick={() => setOpenId(e.id)}>
                    <span className="log-card__top">
                      <SeverityBadge severity={e.severity} />
                      <span className="mono">{timeShort(e.ts)}</span>
                    </span>
                    <strong>{e.summary}</strong>
                    <span className="cell-sub">{e.host || e.sourceIp} · {moduleLabel(e.module)}{e.aclName ? ` · regla ${e.aclName}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="list-foot">
              <span>Mostrando {items.length.toLocaleString('es')} de {totalLabel}</span>
              {hasMore && <button type="button" className="btn btn--sm" onClick={loadMore}>Mostrar más</button>}
            </div>
          </>
        )}
      </section>

      {selected && <EventDetail event={selected} onClose={() => setOpenId(null)} onAck={ack} />}
    </>
  );
}
