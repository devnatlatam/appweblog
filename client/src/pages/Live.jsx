import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Eraser, Search, Wifi, WifiOff } from 'lucide-react';
import { api, qs, tokenStore } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { moduleLabel } from '../data/catalog';
import { SEVERITIES } from '../data/severity';
import EventDetail from '../components/EventDetail';
import { PageHead, timeShort } from '../components/ui';

const ROW_H = 36;
const MAX_ROWS = 5000;      // lo más reciente que se conserva en pantalla
const OVERSCAN = 8;

// Conexión WebSocket con reconexión automática. Envía el token y los filtros actuales al conectar.
function useLiveSocket(filterRef, onEvents) {
  const [status, setStatus] = useState('connecting'); // connecting | open | closed
  const wsRef = useRef(null);
  const handler = useRef(onEvents);
  handler.current = onEvents;

  useEffect(() => {
    let closed = false;
    let retry = 1000;
    let timer = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      wsRef.current = ws;
      setStatus('connecting');
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: tokenStore.get(), filter: filterRef.current }));
      ws.onmessage = (m) => {
        let msg;
        try { msg = JSON.parse(m.data); } catch (e) { return; }
        if (msg.type === 'ready') { setStatus('open'); retry = 1000; }
        if (msg.type === 'events') handler.current(msg.events, msg.skipped || 0);
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus('closed');
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 10000);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); if (wsRef.current) wsRef.current.close(); };
  }, [filterRef]);

  const sendFilter = useCallback((filter) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'filter', filter }));
  }, []);

  return { status, sendFilter };
}

export default function Live({ clientId, embedded = false }) {
  const { can } = useAuth();
  const toast = useToast();
  const [ip, setIp] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [paused, setPaused] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [openId, setOpenId] = useState(null);

  const filter = useMemo(() => ({ ip: ip.trim(), client: clientId, q: q.trim() }), [ip, clientId, q]);
  const filterRef = useRef(filter);
  const pausedRef = useRef(false);
  const held = useRef([]);
  const box = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(520);
  const addedRef = useRef(0);

  const push = useCallback((evs, skip) => {
    if (skip) setSkipped((n) => n + skip);
    const incoming = evs.slice().reverse(); // más nuevo primero
    if (pausedRef.current) {
      held.current = [...incoming, ...held.current].slice(0, MAX_ROWS);
      setHeldCount(held.current.length);
      return;
    }
    addedRef.current = incoming.length;
    setRows((l) => [...incoming, ...l].slice(0, MAX_ROWS));
  }, []);

  const { status, sendFilter } = useLiveSocket(filterRef, push);

  // Al abrir la pantalla se muestran los últimos 50 para no empezar vacío
  useEffect(() => {
    api(`/events${qs({ limit: 50, hours: 24, client: clientId })}`).then((d) => {
      setRows((l) => (l.length ? l : d.events));
    }).catch(() => {});
  }, [clientId]);

  // Al cambiar un filtro la pantalla se limpia y solo entran los logs nuevos que coincidan
  const first = useRef(true);
  useEffect(() => {
    filterRef.current = filter;
    if (first.current) { first.current = false; return undefined; }
    const t = setTimeout(() => {
      sendFilter(filter);
      held.current = []; setHeldCount(0); setRows([]); setSkipped(0); setScrollTop(0);
      if (box.current) box.current.scrollTop = 0;
    }, 250);
    return () => clearTimeout(t);
  }, [filter, sendFilter]);

  const togglePause = () => {
    if (paused) {
      pausedRef.current = false;
      const pending = held.current;
      held.current = []; setHeldCount(0);
      if (pending.length) { addedRef.current = 0; setRows((l) => [...pending, ...l].slice(0, MAX_ROWS)); }
    } else {
      pausedRef.current = true;
    }
    setPaused(!paused);
  };

  const clear = () => { setRows([]); held.current = []; setHeldCount(0); setSkipped(0); setScrollTop(0); if (box.current) box.current.scrollTop = 0; };

  // Medir el alto visible
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    setViewH(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Si el usuario está leyendo más abajo, lo que llega arriba no debe mover lo que está viendo
  useLayoutEffect(() => {
    const el = box.current;
    if (el && el.scrollTop > 0 && addedRef.current) el.scrollTop += addedRef.current * ROW_H;
    addedRef.current = 0;
  }, [rows]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const visible = rows.slice(start, end);
  const selected = openId ? rows.find((r) => r.id === openId) : null;

  const ack = async (ev) => {
    try {
      await api('/events/ack', { method: 'POST', body: { ids: [ev.id] } });
      setRows((l) => l.map((e) => (e.id === ev.id ? { ...e, acknowledged: true } : e)));
      toast('Evento marcado como revisado');
      setOpenId(null);
    } catch (e) { toast(e.message, 'error'); }
  };

  const hasFilters = ip || q;

  return (
    <>
      {(() => {
        const controls = (
          <>
            <span className={`conn conn--${status}`} role="status">
              {status === 'open' ? <Wifi size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />}
              {status === 'open' ? 'Conectado' : status === 'connecting' ? 'Conectando…' : 'Reconectando…'}
            </span>
            <button type="button" className="btn" onClick={togglePause}>
              {paused ? <Play size={18} /> : <Pause size={18} />} {paused ? `Reanudar${heldCount ? ` (${heldCount.toLocaleString('es')} nuevos)` : ''}` : 'Pausar'}
            </button>
            <button type="button" className="btn" onClick={clear} disabled={!rows.length}><Eraser size={18} /> Limpiar</button>
          </>
        );
        return embedded ? <div className="embedded-bar">{controls}</div> : (
          <PageHead title="En vivo" actions={controls}>
            Los logs aparecen aquí apenas llegan. Al aplicar un filtro, la pantalla se limpia y solo verás lo nuevo que coincida.
          </PageHead>
        );
      })()}

      <section className="panel filters" aria-label="Filtros en vivo">
        <div className="filters__row">
          <div className="input-wrap filters__search">
            <Search size={18} aria-hidden="true" />
            <input className="input" type="search" placeholder="Palabra clave (DHCP, Allow, conflicto…)" value={q}
              onChange={(e) => setQ(e.target.value)} aria-label="Palabra clave" />
          </div>
          <input className="input filters__sel mono" placeholder="IP de origen" value={ip} onChange={(e) => setIp(e.target.value)} aria-label="IP de origen" />
          {hasFilters && <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setIp(''); setQ(''); }}>Quitar filtros</button>}
        </div>
      </section>

      <section className="panel console" style={{ marginTop: 14 }}>
        <div className="console__head" aria-hidden="true">
          <span>Hora</span><span>Nivel</span><span>Equipo</span><span>IP origen</span><span>Qué pasó</span>
        </div>
        <div className="console__body" ref={box} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} tabIndex={0} aria-label="Logs en vivo">
          {rows.length === 0 ? (
            <div className="console__empty">
              {status === 'open' ? 'Esperando logs nuevos…' : 'Conectando con el servidor…'}
            </div>
          ) : (
            <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
              {visible.map((e, i) => (
                <button key={e.id} type="button" className={`console__row sev-${e.severity}${e.acknowledged ? ' is-done' : ''}`}
                  style={{ top: (start + i) * ROW_H, height: ROW_H }} onClick={() => setOpenId(e.id)}>
                  <span className="mono">{timeShort(e.ts)}</span>
                  <span className={`lvl lvl--${e.severity}`} title={SEVERITIES[e.severity].label}>{SEVERITIES[e.severity].label}</span>
                  <span className="console__client">{e.host || '—'}</span>
                  <span className="mono console__ip">{e.sourceIp}</span>
                  <span className="console__msg">{e.summary} <small>{moduleLabel(e.module)}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="list-foot">
          <span>
            {rows.length.toLocaleString('es')} en pantalla{rows.length >= MAX_ROWS ? ` (se conservan los últimos ${MAX_ROWS.toLocaleString('es')})` : ''}
            {skipped > 0 && ` · ${skipped.toLocaleString('es')} no se mostraron por llegar demasiado rápido; están en Registros`}
          </span>
          {paused && <span className="badge badge--warning">En pausa</span>}
        </div>
      </section>

      {selected && can('logs.view') && <EventDetail event={selected} onClose={() => setOpenId(null)} onAck={ack} />}
    </>
  );
}
