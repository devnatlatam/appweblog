import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Cable, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Link } from 'react-router-dom';
import { PageHead, Switch, Dialog, Empty, timeAgo } from '../components/ui';

const changed = () => window.dispatchEvent(new Event('clients-changed'));

const fmt = (n) => n.toLocaleString('es');

function PortForm({ port, onClose, onSaved, firewallManaged }) {
  const toast = useToast();
  const editing = Boolean(port);
  const [name, setName] = useState(port ? port.clientName : '');
  const [num, setNum] = useState(port ? String(port.port) : '');
  const [protocol, setProtocol] = useState(port ? port.protocol : 'udp');
  const [ips, setIps] = useState(port ? port.allowedIps.join(', ') : '');
  const [activate, setActivate] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = editing && port.isActive; // no se cambia el puerto mientras está abierto

  const submit = async () => {
    setBusy(true);
    setError('');
    const body = { clientName: name, port: Number(num), protocol, allowedIps: ips, ...(editing ? {} : { activate }) };
    try {
      const d = editing
        ? await api(`/ports/${port.id}`, { method: 'PATCH', body })
        : await api('/ports', { method: 'POST', body });
      if (d.warning) toast(d.warning, 'error');
      else if (editing) toast('Cambios guardados');
      else toast(activate ? `Cliente creado: el puerto ${d.port.port} ya recibe${firewallManaged ? ' y está abierto en el firewall' : ''}` : 'Cliente creado. Enciende su puerto cuando quieras empezar a recibir.');
      onSaved(d.port);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={editing ? 'Editar cliente' : 'Nuevo cliente'} variant="modal" onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn--primary" disabled={!name || !num || busy} onClick={submit}>
            {editing ? 'Guardar cambios' : 'Crear cliente'}
          </button>
        </>
      }>
      <div className="dialog-body">
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="pn">Nombre del cliente</label>
          <input id="pn" className="input" value={name} placeholder="Ej. Oficina Central" maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pp">Puerto</label>
            <input id="pp" className="input mono" inputMode="numeric" value={num} placeholder="514" disabled={locked}
              onChange={(e) => setNum(e.target.value.replace(/\D/g, '').slice(0, 5))} />
          </div>
          <div className="field">
            <label htmlFor="ppr">Protocolo</label>
            <select id="ppr" className="select" value={protocol} disabled={locked} onChange={(e) => setProtocol(e.target.value)}>
              <option value="udp">UDP</option>
              <option value="tcp">TCP</option>
            </select>
          </div>
        </div>
        {locked && <p className="hint">Apaga el puerto para cambiar su número o protocolo.</p>}
        <div className="field">
          <label htmlFor="pi">Aceptar solo desde estas IP <span className="hint">(opcional)</span></label>
          <input id="pi" className="input mono" value={ips} placeholder="179.7.94.149, 190.10.20.30" onChange={(e) => setIps(e.target.value)} />
          <span className="hint">Si lo dejas vacío, se acepta cualquier IP. Indicar las IP del cliente evita que alguien más envíe logs falsos a este puerto.{firewallManaged && ' También se aplican en el firewall del servidor.'}</span>
        </div>
        {!editing && (
          <label className="check">
            <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
            <span>Encender ahora{firewallManaged ? ' (abre el puerto en el firewall)' : ''}</span>
          </label>
        )}
        {!firewallManaged && <p className="hint">El firewall de este servidor no lo administra la aplicación: abre el puerto tú en el firewall para que lleguen los logs.</p>}
      </div>
    </Dialog>
  );
}

export default function Ports() {
  const { can } = useAuth();
  const toast = useToast();
  const canToggle = can('ports.toggle');
  const canManage = can('ports.manage');
  const [ports, setPorts] = useState(null);
  const [firewallManaged, setFirewallManaged] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // null | 'new' | port
  const [confirmDel, setConfirmDel] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    api('/ports').then((d) => { setPorts(d.ports); setFirewallManaged(Boolean(d.firewallManaged)); setError(''); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async (p, active) => {
    setBusyId(p.id);
    try {
      const d = await api(`/ports/${p.id}/toggle`, { method: 'POST', body: { active } });
      setPorts((l) => l.map((x) => (x.id === p.id ? { ...x, ...d.port } : x)));
      changed();
      if (d.warning) toast(d.warning, 'error');
      else toast(active ? `Puerto ${p.port} encendido${firewallManaged ? ' y abierto en el firewall' : ''}: ya recibe logs de ${p.clientName}` : `Puerto ${p.port} apagado${firewallManaged ? ' y cerrado en el firewall' : ''}`, active ? 'success' : 'info');
    } catch (e) {
      toast(e.message, 'error');
      load();
    }
    setBusyId(null);
  };

  const remove = async (p) => {
    try {
      const d = await api(`/ports/${p.id}`, { method: 'DELETE' });
      if (d.warning) toast(d.warning, 'error');
      setPorts((l) => l.filter((x) => x.id !== p.id));
      changed();
      toast(`Cliente ${p.clientName} eliminado`);
    } catch (e) { toast(e.message, 'error'); }
    setConfirmDel(null);
  };

  const saved = (p) => {
    setPorts((l) => (l.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? { ...x, ...p } : x)) : [...l, p]));
    setForm(null);
    changed();
  };

  return (
    <>
      <PageHead title="Clientes y puertos"
        actions={canManage && <button type="button" className="btn btn--primary" onClick={() => setForm('new')}><Plus size={18} /> Nuevo cliente</button>}>
        Cada cliente envía sus logs a un puerto propio, y ese puerto lo identifica. Entra a un cliente para ver solo sus logs. Encender un puerto lo abre{firewallManaged ? ' (también en el firewall del servidor)' : ''}; apagarlo lo cierra: no se recibe ni se guarda nada de ese cliente.
        {!canToggle && ' Tu rol puede ver el estado, pero no cambiarlo.'}
      </PageHead>

      <section className="panel">
        {error ? (
          <Empty title="No se pudo cargar" action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>{error}</Empty>
        ) : !ports ? (
          <div className="empty">Cargando…</div>
        ) : ports.length === 0 ? (
          <Empty icon={Cable} title="Aún no hay clientes"
            action={canManage ? <button type="button" className="btn btn--primary" onClick={() => setForm('new')}><Plus size={18} /> Nuevo cliente</button> : null}>
            {canManage ? 'Crea el primero, asígnale un puerto y apunta su equipo a este servidor.' : 'Un administrador debe crear el primer cliente.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table ports-table">
              <thead>
                <tr><th>Cliente</th><th>Puerto</th><th>Eventos (24 h)</th><th>Último log</th><th>Recibir</th>{canManage && <th><span className="sr-only">Acciones</span></th>}</tr>
              </thead>
              <tbody>
                {ports.map((p) => (
                  <tr key={p.id} className={p.isActive ? '' : 'rule-off'}>
                    <td>
                      <div className="cell-main"><Link to={`/clientes/${p.id}`} className="client-link">{p.clientName}</Link></div>
                      <div className="cell-sub">{p.allowedIps.length ? `Solo desde ${p.allowedIps.join(', ')}` : 'Acepta cualquier IP'}</div>
                    </td>
                    <td className="mono nowrap">{p.port} <span className="badge badge--plain">{p.protocol.toUpperCase()}</span></td>
                    <td className="mono">{fmt(p.events24h)}</td>
                    <td className="cell-sub nowrap">{p.lastSeen ? timeAgo(p.lastSeen) : 'Nunca'}</td>
                    <td>
                      {canToggle ? (
                        <span className="switch-cell">
                          <Switch checked={p.isActive} onChange={(on) => !busyId && toggle(p, on)} label={`Recibir logs de ${p.clientName} en el puerto ${p.port}`} />
                          <span className="cell-sub">{p.isActive ? (p.listening ? 'Recibiendo' : 'Sin abrir') : 'Apagado'}</span>
                        </span>
                      ) : (
                        <span className={`badge badge--${p.listening ? 'ok' : 'plain'}`}>{p.listening ? 'Recibiendo' : 'Apagado'}</span>
                      )}
                      {p.isActive && !p.listening && p.error && (
                        <div className="port-error"><TriangleAlert size={14} aria-hidden="true" /> {p.error}</div>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        <div className="row-actions">
                          <button type="button" className="icon-btn" onClick={() => setForm(p)} aria-label={`Editar a ${p.clientName}`}><Pencil size={18} /></button>
                          <button type="button" className="icon-btn" onClick={() => setConfirmDel(p)} aria-label={`Eliminar a ${p.clientName}`}><Trash2 size={18} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && <PortForm port={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={saved} firewallManaged={firewallManaged} />}
      {confirmDel && (
        <Dialog title="¿Eliminar este cliente?" variant="modal" onClose={() => setConfirmDel(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDel(null)}>Cancelar</button>
              <button type="button" className="btn btn--danger" onClick={() => remove(confirmDel)}>Eliminar cliente</button>
            </>
          }>
          <div className="dialog-body">
            <p>Se cerrará el puerto <strong>{confirmDel.port}</strong> y se quitará a <strong>{confirmDel.clientName}</strong> de la lista.</p>
            <p className="hint">Los logs que ya se guardaron no se borran.</p>
          </div>
        </Dialog>
      )}
    </>
  );
}
