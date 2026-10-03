import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { ArrowLeft, Cable, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Switch, Empty, timeAgo } from '../components/ui';
import Dashboard from './Dashboard';
import Live from './Live';
import Logs from './Logs';
import Incidents from '../components/Incidents';

// Espacio propio de un cliente: su resumen, su vista en vivo y sus registros. Nada de otros clientes.
export default function ClientView() {
  const { id } = useParams();
  const cid = Number(id);
  const { can } = useAuth();
  const toast = useToast();
  const [port, setPort] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | missing | error
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api('/ports')
      .then((d) => {
        const found = d.ports.find((p) => p.id === cid);
        setPort(found || null);
        setState(found ? 'ok' : 'missing');
      })
      .catch((e) => { setError(e.message); setState((s) => (s === 'ok' ? s : 'error')); });
  }, [cid]);

  useEffect(() => {
    setState('loading');
    setPort(null);
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async (active) => {
    try {
      const d = await api(`/ports/${cid}/toggle`, { method: 'POST', body: { active } });
      setPort((p) => ({ ...p, ...d.port }));
      window.dispatchEvent(new Event('clients-changed'));
      if (d.warning) toast(d.warning, 'error');
      else toast(active ? `Puerto ${port.port} encendido` : `Puerto ${port.port} apagado: dejó de recibir`, active ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); load(); }
  };

  if (state === 'loading') return <div className="empty">Cargando…</div>;
  if (state === 'error') return <div className="panel"><Empty title="No se pudo cargar el cliente" action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>{error}</Empty></div>;
  if (state === 'missing') {
    return (
      <div className="panel" style={{ maxWidth: 520, margin: '40px auto' }}>
        <Empty icon={Cable} title="Este cliente no existe" action={<Link className="btn btn--primary" to="/clientes">Ver clientes</Link>}>
          Pudo haber sido eliminado por un administrador.
        </Empty>
      </div>
    );
  }

  const status = port.listening ? { cls: 'ok', text: 'Recibiendo' } : port.isActive ? { cls: 'critical', text: 'No pudo abrir el puerto' } : { cls: 'plain', text: 'Apagado' };

  return (
    <>
      <Link to="/clientes" className="back-link"><ArrowLeft size={16} aria-hidden="true" /> Clientes</Link>

      <header className="client-head">
        <div>
          <h1>{port.clientName}</h1>
          <p className="client-head__meta">
            <span className="mono">Puerto {port.port} · {port.protocol.toUpperCase()}</span>
            <span className={`badge badge--${status.cls}`}>{status.text}</span>
            <span className="cell-sub">Último log: {port.lastSeen ? timeAgo(port.lastSeen).toLowerCase() : 'nunca'}</span>
          </p>
          {port.sourceIps && port.sourceIps.length > 0 && (
            <p className="client-head__ips cell-sub">
              Envía desde <strong className="mono">{port.sourceIps[0].ip}</strong>
              {port.sourceIps.length > 1 && <> · antes: {port.sourceIps.slice(1).map((x) => x.ip).join(', ')}</>}
            </p>
          )}
        </div>
        {can('ports.toggle') && (
          <label className="client-head__switch">
            <Switch checked={port.isActive} onChange={toggle} label={`Recibir logs de ${port.clientName}`} />
            <span>{port.isActive ? 'Recibiendo' : 'Apagado'}</span>
          </label>
        )}
      </header>

      {port.isActive && !port.listening && port.error && (
        <div className="note note--warn" style={{ marginBottom: 14 }}><TriangleAlert size={18} aria-hidden="true" /><div><strong>El puerto no se pudo abrir</strong><p>{port.error}</p></div></div>
      )}
      {!port.isActive && (
        <div className="note" style={{ marginBottom: 14 }}>
          <Cable size={18} aria-hidden="true" />
          <div><strong>Este puerto está apagado</strong><p>No se recibe ni se guarda nada nuevo de {port.clientName}. {can('ports.toggle') ? 'Enciéndelo con el interruptor de arriba.' : 'Un operador o administrador puede encenderlo.'}</p></div>
        </div>
      )}

      <nav className="tabs" aria-label={`Secciones de ${port.clientName}`}>
        <NavLink to={`/clientes/${cid}`} end className={({ isActive }) => (isActive ? 'is-active' : '')}>Resumen</NavLink>
        {can('logs.view') && <NavLink to={`/clientes/${cid}/en-vivo`} className={({ isActive }) => (isActive ? 'is-active' : '')}>En vivo</NavLink>}
        {can('logs.view') && <NavLink to={`/clientes/${cid}/registros`} className={({ isActive }) => (isActive ? 'is-active' : '')}>Registros</NavLink>}
        {can('dashboard.view') && (
          <NavLink to={`/clientes/${cid}/incidentes`} className={({ isActive }) => (isActive ? 'is-active' : '')}>
            Incidentes{port.openIncidents > 0 && <span className="tab-count">{port.openIncidents}</span>}
          </NavLink>
        )}
      </nav>

      <Routes>
        <Route index element={can('dashboard.view') ? <Dashboard key={cid} clientId={cid} embedded /> : null} />
        <Route path="en-vivo" element={can('logs.view') ? <Live key={cid} clientId={cid} embedded /> : null} />
        <Route path="registros" element={can('logs.view') ? <Logs key={cid} clientId={cid} embedded /> : null} />
        <Route path="incidentes" element={can('dashboard.view') ? <Incidents key={cid} clientId={cid} /> : null} />
      </Routes>
    </>
  );
}
