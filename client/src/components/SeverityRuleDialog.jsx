import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../context/ToastContext';
import { FILTER_MODULES, moduleLabel } from '../data/catalog';
import { SEVERITIES, SEVERITY_ORDER } from '../data/severity';
import { Dialog } from './ui';

// Cambiar la severidad con la que se guarda un tipo de log. Se usa desde el detalle de un evento y desde la pantalla de reglas.
export default function SeverityRuleDialog({ initial = {}, onClose, onSaved }) {
  const toast = useToast();
  const [clients, setClients] = useState([]);
  const [module, setModule] = useState(initial.module || FILTER_MODULES[0]);
  const [clientId, setClientId] = useState(initial.clientId ? String(initial.clientId) : '');
  const [match, setMatch] = useState(initial.match || '');
  const [severity, setSeverity] = useState(initial.severity || 'info');
  const [applyStored, setApplyStored] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api('/ports').then((d) => setClients(d.ports)).catch(() => {}); }, []);

  const modules = FILTER_MODULES.includes(module) ? FILTER_MODULES : [module, ...FILTER_MODULES];

  const save = async () => {
    setBusy(true); setError('');
    try {
      const r = await api('/severity-rules', { method: 'POST', body: { module, clientId: clientId || null, match, severity, applyStored } });
      toast(applyStored ? `Regla guardada. Se cambiaron ${r.changed.toLocaleString('es')} eventos ya guardados.` : 'Regla guardada. Vale para los eventos nuevos.');
      onSaved && onSaved();
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Dialog title="Cambiar la severidad" variant="modal" onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>Guardar regla</button>
        </>
      }>
      <div className="dialog-body">
        {error && <div className="form-error" role="alert">{error}</div>}
        <p className="hint">Los avisos que cumplan esto se guardarán con la severidad que elijas. Sirve para bajar el ruido de lo que es normal o subir lo que para ti es grave.</p>

        <div className="field">
          <label htmlFor="sr-mod">Tipo de log</label>
          <select id="sr-mod" className="select" value={module} onChange={(e) => setModule(e.target.value)}>
            {modules.map((m) => <option key={m} value={m}>{moduleLabel(m)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sr-cli">Cliente</label>
          <select id="sr-cli" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Todos los clientes</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.clientName}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sr-match">Solo si el mensaje contiene <span className="hint">(opcional)</span></label>
          <input id="sr-match" className="input" value={match} maxLength={120} placeholder="Ej. Bloqueado"
            onChange={(e) => setMatch(e.target.value)} />
          <span className="hint">Si lo dejas vacío, vale para todos los mensajes de ese tipo.</span>
        </div>
        <div className="field">
          <span className="label" id="sr-sev">Severidad nueva</span>
          <div className="chips" role="group" aria-labelledby="sr-sev">
            {SEVERITY_ORDER.map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={severity === s} onClick={() => setSeverity(s)}>{SEVERITIES[s].label}</button>
            ))}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={applyStored} onChange={(e) => setApplyStored(e.target.checked)} />
          <span>Cambiar también los eventos ya guardados</span>
        </label>
        <p className="hint">Si hay otra regla más específica (de un cliente o con texto), esa gana. Cambiar lo ya guardado no se puede deshacer, pero puedes crear otra regla con la severidad que quieras.</p>
      </div>
    </Dialog>
  );
}
