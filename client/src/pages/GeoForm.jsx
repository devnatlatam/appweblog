import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Activity, CheckCircle2, Lock, Search, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { Dialog } from '../components/ui';

const draftKey = (token) => `geobloqueo.${token}`;
const readDraft = (token) => { try { return JSON.parse(localStorage.getItem(draftKey(token))); } catch (e) { return null; } };
const writeDraft = (token, v) => { try { localStorage.setItem(draftKey(token), JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
const clearDraft = (token) => { try { localStorage.removeItem(draftKey(token)); } catch (e) { /* sin almacenamiento */ } };

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const when = (iso) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Página pública (sin iniciar sesión): el cliente marca los países desde los que necesita recibir conexiones.
// El enlace es único por cliente y solo admite un envío, salvo que un administrador lo habilite otra vez.
export default function GeoForm() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [contact, setContact] = useState('');
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const apply = useCallback((d) => {
    // Se lee el borrador antes de tocar el estado: el efecto que lo guarda no debe pisarlo con valores vacíos
    const draft = d.status === 'submitted' ? null : readDraft(token);
    if (d.status === 'submitted') clearDraft(token);
    setSel(new Set(d.status === 'submitted' ? (d.countries || []) : (draft ? draft.countries : (d.countries || d.recommended))));
    setContact(d.status === 'submitted' ? (d.contact || '') : (draft ? draft.contact : (d.contact || '')));
    setData(d);
  }, [token]);

  useEffect(() => {
    api(`/public/geo/${token}`).then(apply).catch((e) => setError(e.message));
  }, [token, apply]);

  const pending = data && data.status === 'pending';
  useEffect(() => {
    if (pending) writeDraft(token, { countries: [...sel], contact });
  }, [pending, token, sel, contact]);

  const total = useMemo(() => (data ? data.catalog.reduce((n, c) => n + c.countries.length, 0) : 0), [data]);

  const toggle = (name) => setSel((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const setMany = (names, on) => setSel((s) => { const n = new Set(s); names.forEach((x) => (on ? n.add(x) : n.delete(x))); return n; });

  const send = async () => {
    setBusy(true);
    setFormError('');
    try {
      const d = await api(`/public/geo/${token}`, { method: 'POST', body: { countries: [...sel], contact } });
      setConfirm(false);
      apply(d);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setFormError(e.message);
      if (e.message.includes('ya fue enviada')) api(`/public/geo/${token}`).then(apply).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Shell>
        <div className="panel geo-msg">
          <TriangleAlert size={36} aria-hidden="true" />
          <h1>No se pudo abrir el formulario</h1>
          <p>{error}</p>
        </div>
      </Shell>
    );
  }
  if (!data) return <Shell><div className="empty">Cargando…</div></Shell>;

  const submitted = data.status === 'submitted';
  const q = norm(query.trim());
  const canSend = contact.trim().length > 0 && sel.size > 0;

  return (
    <Shell>
      <header className="geo-head">
        <p className="geo-head__for">Solicitud de geobloqueo para</p>
        <h1>{data.clientName}</h1>
        {!submitted && (
          <p>Marque los países desde los que su empresa necesita recibir conexiones. Todos los países que quede sin marcar se bloquearán en el firewall. Su avance se guarda en este navegador mientras trabaja; al terminar, presione <strong>Enviar</strong>.</p>
        )}
      </header>

      {submitted && (
        <div className="note note--ok geo-banner">
          <CheckCircle2 size={20} aria-hidden="true" />
          <div>
            <strong>Respuesta enviada el {when(data.submittedAt)}</strong>
            <p><Lock size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Ya no se puede modificar desde este enlace. Si necesita hacer un cambio, pida a su proveedor que lo habilite de nuevo.</p>
          </div>
        </div>
      )}

      <div className="geo-layout">
        <main>
          {!submitted && (
            <div className="geo-tools">
              <div className="input-wrap">
                <Search size={17} aria-hidden="true" />
                <input type="search" className="input" placeholder="Buscar país" aria-label="Buscar país" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <button type="button" className="btn" onClick={() => setSel(new Set(data.recommended))}>Marcar recomendados</button>
              <button type="button" className="btn" onClick={() => setSel(new Set())}>Desmarcar todo</button>
            </div>
          )}

          {data.catalog.map((cont) => {
            const shown = cont.countries.filter((c) => (submitted ? sel.has(c) : !q || norm(c).includes(q)));
            if (!shown.length) return null;
            const chosen = cont.countries.filter((c) => sel.has(c)).length;
            return (
              <details key={cont.name} className="panel geo-cont" open>
                <summary>
                  <span className="geo-cont__name">{cont.name}</span>
                  <span className={`geo-cont__n${chosen ? ' has' : ''}`}>{chosen} de {cont.countries.length}</span>
                </summary>
                {!submitted && (
                  <div className="geo-cont__actions">
                    <button type="button" className="btn btn--sm" onClick={() => setMany(cont.countries, true)}>Marcar todos</button>
                    <button type="button" className="btn btn--sm" onClick={() => setMany(cont.countries, false)}>Desmarcar</button>
                  </div>
                )}
                <div className="geo-grid">
                  {shown.map((c) => (
                    <label key={c} className={`geo-country${sel.has(c) ? ' on' : ''}${submitted ? ' is-locked' : ''}`}>
                      <input type="checkbox" checked={sel.has(c)} disabled={submitted} onChange={() => toggle(c)} />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
              </details>
            );
          })}
          {!submitted && q && !data.catalog.some((cont) => cont.countries.some((c) => norm(c).includes(q))) && (
            <div className="empty">No hay países que coincidan con la búsqueda.</div>
          )}
        </main>

        <aside className="panel geo-side">
          <div className="geo-tiles">
            <div className="geo-tile geo-tile--allow"><b>{sel.size}</b><span>países permitidos</span></div>
            <div className="geo-tile geo-tile--deny"><b>{total - sel.size}</b><span>países bloqueados</span></div>
          </div>
          <div className="field">
            <label htmlFor="geo-contact">Persona de contacto, correo o teléfono</label>
            <input id="geo-contact" className="input" value={contact} maxLength={160} disabled={submitted}
              placeholder="Ej. Ana Torres, ana@empresa.pe" onChange={(e) => setContact(e.target.value)} />
          </div>
          {!submitted && (
            <>
              <button type="button" className="btn btn--primary btn--block" disabled={!canSend} onClick={() => { setFormError(''); setConfirm(true); }}>Enviar</button>
              <p className="hint geo-hint">
                {!sel.size ? 'Marque al menos un país.' : !contact.trim() ? 'Escriba un contacto para poder enviar.' : 'Una vez enviado no podrá cambiarlo desde este enlace.'}
                {' '}Los recomendados son Perú, Estados Unidos, Canadá y Reino Unido.
              </p>
            </>
          )}
        </aside>
      </div>

      {confirm && (
        <Dialog title="¿Enviar la solicitud?" variant="modal" onClose={() => !busy && setConfirm(false)}
          footer={
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirm(false)}>Volver a revisar</button>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={send}>{busy ? 'Enviando…' : 'Sí, enviar'}</button>
            </>
          }>
          <div className="dialog-body">
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <p>Se permitirán <strong>{sel.size}</strong> {sel.size === 1 ? 'país' : 'países'} y se bloquearán los otros <strong>{total - sel.size}</strong>.</p>
            <p>Después de enviar <strong>no podrá modificar</strong> la selección. Solo su proveedor puede volver a habilitarla.</p>
          </div>
        </Dialog>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="geo-page">
      <div className="geo-brand"><span className="brand__mark"><Activity size={18} aria-hidden="true" /></span> Omada Logs</div>
      {children}
    </div>
  );
}
