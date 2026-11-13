import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Eye, Globe2, Link2, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PageHead, Empty, Dialog } from '../components/ui';

const when = (iso) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const STATUS = {
  none: { cls: 'plain', text: 'Sin enlace' },
  pending: { cls: 'warning', text: 'Esperando respuesta' },
  reopened: { cls: 'info', text: 'Habilitado de nuevo' },
  submitted: { cls: 'ok', text: 'Enviado' },
};
const statusOf = (r) => STATUS[r.status === 'pending' && r.submissions > 0 ? 'reopened' : r.status];

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'none', label: 'Sin enlace' },
  { key: 'pending', label: 'Esperando' },
  { key: 'submitted', label: 'Enviados' },
];

// Mismo formato que se pega en un correo o en el ticket para configurar el firewall
function asText(r, catalog, total) {
  const byContinent = catalog
    .map((c) => [c.name, c.countries.filter((p) => r.countries.includes(p))])
    .filter(([, list]) => list.length)
    .map(([name, list]) => `${name}: ${list.join(', ')}`);
  return [
    'SOLICITUD DE GEOBLOQUEO POR PAÍSES',
    `Empresa: ${r.clientName}`,
    `Contacto: ${r.contact || '(sin indicar)'}`,
    `Enviado: ${r.submittedAt ? when(r.submittedAt) : '(pendiente)'}`,
    '',
    `Países PERMITIDOS (${r.countries.length}):`,
    byContinent.join('\n') || '(ninguno)',
    '',
    `Todos los demás países (${total - r.countries.length}) se bloquean.`,
  ].join('\n');
}

function Detail({ r, catalog, total, onClose }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText(r, catalog, total));
      toast('Resultado copiado');
    } catch (e) { toast('No se pudo copiar. Selecciona el texto a mano.', 'error'); }
  };
  const isCurrent = r.status === 'submitted';
  return (
    <Dialog title={r.clientName} onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cerrar</button>
          <button type="button" className="btn btn--primary" onClick={copy}><Copy size={17} /> Copiar resultado</button>
        </>
      }>
      <div className="dialog-body">
        {!isCurrent && (
          <div className="note note--warn"><div><strong>Respuesta anterior</strong><p>El enlace se habilitó de nuevo: el cliente todavía no envía la corrección.</p></div></div>
        )}
        <dl className="fields">
          <dt>Contacto</dt><dd>{r.contact || '—'}</dd>
          <dt>Enviado</dt><dd>{r.submittedAt ? when(r.submittedAt) : '—'}{r.submittedIp && <span className="cell-sub"> · desde {r.submittedIp}</span>}</dd>
          <dt>Veces enviado</dt><dd>{r.submissions}</dd>
          <dt>Permitidos</dt><dd><strong>{r.countries.length}</strong> de {total} · se bloquean {total - r.countries.length}</dd>
        </dl>
        {catalog.map((c) => {
          const list = c.countries.filter((p) => r.countries.includes(p));
          if (!list.length) return null;
          return (
            <section key={c.name} className="geo-view">
              <h3>{c.name} <span className="cell-sub">{list.length} de {c.countries.length}</span></h3>
              <ul>{list.map((p) => <li key={p}>{p}</li>)}</ul>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}

export default function Geo() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('ports.manage');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState(null); // clientId abierto en el detalle
  const [ask, setAsk] = useState(null);   // confirmación pendiente
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/geo').then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // así todos ven las respuestas nuevas sin recargar
    return () => clearInterval(t);
  }, [load]);

  const merge = (request) => setData((d) => ({ ...d, requests: d.requests.map((x) => (x.clientId === request.clientId ? request : x)) }));
  const linkOf = (r) => `${data.baseUrl || window.location.origin}/geo/${r.token}`;

  const copyLink = async (r) => {
    const url = linkOf(r);
    try {
      await navigator.clipboard.writeText(url);
      toast(`Enlace de ${r.clientName} copiado`);
    } catch (e) { window.prompt('Copia el enlace:', url); }
  };

  const run = async (r, action, message) => {
    setBusy(true);
    try {
      const d = await api(`/geo/${r.clientId}/${action}`, { method: 'POST' });
      merge(d.request);
      setAsk(null);
      toast(message);
      return d.request;
    } catch (e) { toast(e.message, 'error'); setAsk(null); load(); return null; } finally { setBusy(false); }
  };

  const createLink = async (r) => {
    const made = await run(r, 'link', 'Enlace creado');
    if (made) copyLink(made).catch(() => {});
  };

  const counts = useMemo(() => {
    const c = { all: 0, none: 0, pending: 0, submitted: 0 };
    (data ? data.requests : []).forEach((r) => { c.all += 1; c[r.status] += 1; });
    return c;
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = norm(query.trim());
    return data.requests.filter((r) => (filter === 'all' || r.status === filter) && (!q || norm(r.clientName).includes(q) || String(r.port).includes(q)));
  }, [data, filter, query]);

  const detail = data && view ? data.requests.find((r) => r.clientId === view) : null;

  return (
    <>
      <PageHead title="Geobloqueo">
        Cada cliente recibe un enlace único para marcar los países desde los que necesita conectarse; todo lo demás se bloquea en el firewall. El cliente solo puede enviar una vez: si necesita corregir, habilítalo de nuevo desde aquí.
      </PageHead>

      {error ? (
        <div className="panel"><Empty title="No se pudo cargar" action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>{error}</Empty></div>
      ) : !data ? (
        <div className="empty">Cargando…</div>
      ) : (
        <>
          <div className="geo-filters">
            <div className="chips" role="tablist" aria-label="Estado">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" role="tab" className="chip" aria-pressed={filter === f.key} aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label} <span className="chip__n">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <div className="input-wrap geo-filters__search">
              <Search size={17} aria-hidden="true" />
              <input type="search" className="input" placeholder="Buscar cliente o puerto" aria-label="Buscar cliente o puerto" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          <div className="panel">
            {rows.length === 0 ? (
              <Empty icon={Globe2} title={data.requests.length ? 'Nada coincide con el filtro' : 'Todavía no hay clientes'}>
                {data.requests.length ? 'Prueba con otro estado o búsqueda.' : 'Crea clientes en “Gestionar clientes” y aquí podrás generar su enlace.'}
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Cliente</th><th>Estado</th><th>Países permitidos</th><th>Respuesta</th><th><span className="sr-only">Acciones</span></th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const st = statusOf(r);
                      return (
                        <tr key={r.clientId}>
                          <td><div className="cell-main">{r.clientName}</div><div className="cell-sub mono">Puerto {r.port} · {r.protocol.toUpperCase()}</div></td>
                          <td><span className={`badge badge--${st.cls}`}>{st.text}</span></td>
                          <td>{r.countries.length ? <><strong>{r.countries.length}</strong> <span className="cell-sub">de {data.total}</span></> : <span className="cell-sub">—</span>}</td>
                          <td>{r.submittedAt ? <><div>{when(r.submittedAt)}</div><div className="cell-sub">{r.contact}</div></> : <span className="cell-sub">—</span>}</td>
                          <td>
                            <div className="geo-actions">
                              {r.status === 'none' && manage && (
                                <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => createLink(r)}><Link2 size={16} /> Crear enlace</button>
                              )}
                              {r.token && manage && (
                                <button type="button" className="btn btn--sm" onClick={() => copyLink(r)}><Copy size={16} /> Copiar enlace</button>
                              )}
                              {r.countries.length > 0 && (
                                <button type="button" className="btn btn--sm" onClick={() => setView(r.clientId)}><Eye size={16} /> Ver respuesta</button>
                              )}
                              {r.status === 'submitted' && manage && (
                                <button type="button" className="btn btn--sm" onClick={() => setAsk({ r, action: 'reopen', title: 'Habilitar de nuevo', done: 'Habilitado: el cliente puede corregir su respuesta',
                                  text: `${r.clientName} podrá abrir su enlace, ver su respuesta anterior y enviar una corrección. Solo podrá enviar una vez más.`, label: 'Habilitar' })}>
                                  <RotateCcw size={16} /> Habilitar de nuevo
                                </button>
                              )}
                              {r.token && manage && (
                                <button type="button" className="btn btn--sm btn--ghost" title="Genera un enlace nuevo; el actual deja de funcionar"
                                  onClick={() => setAsk({ r, action: 'regenerate', title: 'Cambiar el enlace', done: 'Enlace nuevo generado: el anterior ya no funciona',
                                    text: `El enlace actual de ${r.clientName} dejará de funcionar y tendrás que enviarle el nuevo. Úsalo si el enlace llegó a quien no debía.`, label: 'Cambiar enlace' })}>
                                  <RefreshCw size={16} /> <span className="sr-only">Cambiar enlace de {r.clientName}</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {detail && <Detail r={detail} catalog={data.catalog} total={data.total} onClose={() => setView(null)} />}

      {ask && (
        <Dialog title={ask.title} variant="modal" onClose={() => !busy && setAsk(null)}
          footer={
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => setAsk(null)}>Cancelar</button>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(ask.r, ask.action, ask.done)}>{ask.label}</button>
            </>
          }>
          <div className="dialog-body"><p>{ask.text}</p></div>
        </Dialog>
      )}
    </>
  );
}
