import React, { useState } from 'react';
import { Plus, Mail, Send, Info } from 'lucide-react';
import { ALERT_RULES } from '../data/mock';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PageHead, SeverityBadge, Switch, Dialog } from '../components/ui';

export default function Alerts() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('alerts.manage');
  const [rules, setRules] = useState(ALERT_RULES);
  const [creating, setCreating] = useState(false);

  const toggle = (id, on) => {
    setRules((l) => l.map((r) => (r.id === id ? { ...r, enabled: on } : r)));
    toast(on ? 'Regla activada' : 'Regla desactivada', 'info');
  };

  return (
    <>
      <PageHead
        title="Alertas"
        actions={manage && <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Plus size={18} /> Nueva regla</button>}
      >
        Avisos automáticos por correo o Telegram cuando ocurre algo importante en la red.
        {!manage && ' Tu rol puede ver las reglas, pero no cambiarlas.'}
      </PageHead>

      <div className="note note--warn" role="note" style={{ marginBottom: 16 }}>
        <Info size={18} aria-hidden="true" />
        <div><strong>Vista previa</strong><p>Estas reglas son de ejemplo. Todavía no se envían correos; falta conectar el servidor de correo y elegir los tipos de alerta.</p></div>
      </div>

      <div className="rules">
        {rules.map((r) => (
          <article key={r.id} className={`panel rule${r.enabled ? '' : ' is-off'}`}>
            <div className="rule__main">
              <div className="rule__title">
                <h3>{r.name}</h3>
                <SeverityBadge severity={r.severity} />
              </div>
              <p className="cell-sub">{r.condition}</p>
              <div className="rule__meta">
                {r.channels.map((c) => (
                  <span key={c} className="badge badge--plain">{c === 'Correo' ? <Mail size={13} /> : <Send size={13} />} {c}</span>
                ))}
                <span className="cell-sub">Última vez: {r.lastFired}</span>
              </div>
            </div>
            <div className="rule__switch">
              <Switch checked={r.enabled} onChange={(v) => toggle(r.id, v)} label={`Activar regla ${r.name}`} />
              <span className="cell-sub">{r.enabled ? 'Activa' : 'Apagada'}</span>
            </div>
          </article>
        ))}
      </div>

      {creating && (
        <Dialog title="Nueva regla de alerta" variant="modal" onClose={() => setCreating(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setCreating(false)}>Cancelar</button>
              <button type="button" className="btn btn--primary" onClick={() => { setCreating(false); toast('Regla creada (demo)'); }}>Crear regla</button>
            </>
          }>
          <div className="dialog-body">
            <div className="field"><label htmlFor="rn">Nombre</label><input id="rn" className="input" placeholder="Ej. AP de bodega sin conexión" /></div>
            <div className="field"><label htmlFor="rc">Cuando ocurra</label>
              <select id="rc" className="select">
                <option>Un AP deja de responder</option><option>Se cae un enlace de internet</option>
                <option>Fallan varios inicios de sesión</option><option>Aparece un Wi-Fi desconocido</option>
              </select>
            </div>
            <div className="field"><label htmlFor="rs">Importancia</label>
              <select id="rs" className="select"><option>Crítico</option><option>Error</option><option>Aviso</option></select>
            </div>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Avisar por</legend>
              <label className="check"><input type="checkbox" defaultChecked /> Correo</label>
              <label className="check"><input type="checkbox" /> Telegram</label>
            </fieldset>
          </div>
        </Dialog>
      )}
    </>
  );
}
