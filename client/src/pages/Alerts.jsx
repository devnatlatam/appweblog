import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Send, Mail, BellRing, TriangleAlert, CircleCheck, CircleX } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { INCIDENT_KINDS, FILTER_MODULES, moduleLabel } from '../data/catalog';
import { PageHead, Switch, Dialog, Empty, timeAgo, dateLong } from '../components/ui';

const KINDS = {
  incident: { title: 'Un problema con duración', desc: 'Internet o VPN caída, conflicto de IP o servidor DHCP intruso. Avisa al empezar y, si quieres, al terminar.' },
  client_silent: { title: 'Un cliente deja de enviar logs', desc: 'El puerto está encendido pero no llega nada durante varios minutos: equipo apagado, sin internet…' },
  events: { title: 'Llega un evento importante', desc: 'Por severidad y/o tipo: errores, cambios de configuración, cambio de IP de origen…' },
  firewall_blocks: { title: 'Muchos bloqueos del firewall', desc: 'Un mismo origen acumula varios bloqueos en poco tiempo: puede ser un escaneo o un equipo infectado.' },
  new_device: { title: 'Aparece un equipo nuevo en la red', desc: 'Un equipo que nunca se había visto (por su MAC). Los primeros 60 minutos de un cliente son de aprendizaje.' },
  spike: { title: 'Pico de actividad', desc: 'Llegan muchos más logs de lo normal en poco tiempo.' },
  daily_summary: { title: 'Resumen diario', desc: 'Un correo al día con lo ocurrido en las últimas 24 horas.' },
};
const HAS_RESOLVED = ['incident', 'client_silent', 'spike'];
const COOLDOWNS = [[15, '15 minutos'], [30, '30 minutos'], [60, '1 hora'], [180, '3 horas'], [360, '6 horas'], [1440, '24 horas']];
const LEVELS = [[2, 'Solo críticos'], [3, 'Errores y críticos'], [4, 'Avisos, errores y críticos'], [7, 'Cualquier evento']];
const MIN_MIN = [[0, 'Desde que empieza'], [5, 'Si dura más de 5 min'], [15, 'Si dura más de 15 min'], [30, 'Si dura más de 30 min'], [60, 'Si dura más de 1 hora']];
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

function describe(r) {
  const p = r.params;
  switch (r.kind) {
    case 'incident': return `${p.kinds.map((k) => INCIDENT_KINDS[k] || k).join(', ')}${p.minMinutes ? ` · si dura más de ${p.minMinutes} min` : ''}`;
    case 'client_silent': return `Más de ${p.minutes} min sin recibir logs`;
    case 'events': return `${(LEVELS.find((l) => l[0] === p.maxLevel) || [0, `Nivel ${p.maxLevel}`])[1]}${p.modules.length ? ` · ${p.modules.map(moduleLabel).join(', ')}` : ' · de cualquier tipo'}`;
    case 'firewall_blocks': return `${p.count} bloqueos en ${p.minutes} min desde un mismo origen`;
    case 'new_device': return 'MAC que no se había visto antes';
    case 'spike': return `${p.factor} veces lo normal y al menos ${p.minEvents} eventos en ${p.windowMin} min`;
    case 'daily_summary': return `Todos los días desde las ${hh(p.hour)}`;
    default: return '';
  }
}

const DEFAULTS = {
  incident: { kinds: ['wan_offline', 'ipsec_down'], minMinutes: 0 },
  client_silent: { minutes: 15 },
  events: { maxLevel: 3, modules: [] },
  firewall_blocks: { count: 20, minutes: 5 },
  new_device: {},
  spike: { windowMin: 15, factor: 3, minEvents: 300 },
  daily_summary: { hour: 8 },
};

function RuleForm({ rule, clients, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(rule);
  const [kind, setKind] = useState(rule ? rule.kind : 'incident');
  const [name, setName] = useState(rule ? rule.name : '');
  const [params, setParams] = useState(rule ? rule.params : DEFAULTS.incident);
  const [clientId, setClientId] = useState(rule && rule.clientId ? String(rule.clientId) : '');
  const [recipients, setRecipients] = useState(rule ? rule.recipients.join(', ') : '');
  const [cooldown, setCooldown] = useState(rule ? rule.cooldownMin : 60);
  const [notifyResolved, setNotifyResolved] = useState(rule ? rule.notifyResolved : true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pickKind = (k) => { setKind(k); setParams(DEFAULTS[k]); setError(''); };
  const setP = (k, v) => setParams((p) => ({ ...p, [k]: v }));
  const toggleIn = (key, val) => setParams((p) => ({ ...p, [key]: p[key].includes(val) ? p[key].filter((x) => x !== val) : [...p[key], val] }));
  const numP = (k, min, max) => (e) => setP(k, e.target.value === '' ? '' : Math.min(max, Math.max(min, Number(e.target.value.replace(/[^\d.]/g, '')) || min)));

  const submit = async () => {
    setBusy(true); setError('');
    const body = { name, kind, params, clientId: clientId ? Number(clientId) : null, recipients, cooldownMin: Number(cooldown), notifyResolved: HAS_RESOLVED.includes(kind) && notifyResolved };
    try {
      const d = editing ? await api(`/alerts/${rule.id}`, { method: 'PATCH', body }) : await api('/alerts', { method: 'POST', body });
      toast(editing ? 'Regla guardada' : 'Regla creada');
      onSaved(d.rule);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Dialog title={editing ? 'Editar regla' : 'Nueva regla de alerta'} onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn--primary" disabled={busy || !name || !recipients} onClick={submit}>{editing ? 'Guardar cambios' : 'Crear regla'}</button>
        </>
      }>
      <div className="dialog-body">
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="an">Nombre de la regla</label>
          <input id="an" className="input" value={name} maxLength={80} placeholder="Ej. Internet caído en la sede" onChange={(e) => setName(e.target.value)} />
        </div>

        <fieldset className="kinds">
          <legend className="label">Avisar cuando…</legend>
          {Object.entries(KINDS).map(([k, v]) => (
            <label key={k} className={`kind${kind === k ? ' is-on' : ''}`}>
              <input type="radio" name="kind" checked={kind === k} onChange={() => pickKind(k)} />
              <span><strong>{v.title}</strong><small>{v.desc}</small></span>
            </label>
          ))}
        </fieldset>

        {kind === 'incident' && (
          <div className="subform">
            <span className="label">Qué problemas</span>
            {Object.entries(INCIDENT_KINDS).map(([k, label]) => (
              <label key={k} className="check"><input type="checkbox" checked={params.kinds.includes(k)} onChange={() => toggleIn('kinds', k)} /><span>{label}</span></label>
            ))}
            <div className="field"><label htmlFor="am">Cuándo avisar</label>
              <select id="am" className="select" value={params.minMinutes} onChange={(e) => setP('minMinutes', Number(e.target.value))}>
                {MIN_MIN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span className="hint">Útil para no recibir avisos de cortes de pocos segundos.</span>
            </div>
          </div>
        )}
        {kind === 'client_silent' && (
          <div className="subform"><div className="field"><label htmlFor="as">Minutos sin recibir logs</label>
            <input id="as" className="input mono" inputMode="numeric" value={params.minutes} onChange={numP('minutes', 2, 1440)} /></div></div>
        )}
        {kind === 'events' && (
          <div className="subform">
            <div className="field"><label htmlFor="al">Severidad</label>
              <select id="al" className="select" value={params.maxLevel} onChange={(e) => setP('maxLevel', Number(e.target.value))}>
                {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <span className="label">Tipos de log <span className="hint">(ninguno marcado = todos)</span></span>
            <div className="checks-grid">
              {FILTER_MODULES.map((m) => (
                <label key={m} className="check"><input type="checkbox" checked={params.modules.includes(m)} onChange={() => toggleIn('modules', m)} /><span>{moduleLabel(m)}</span></label>
              ))}
            </div>
          </div>
        )}
        {kind === 'firewall_blocks' && (
          <div className="subform form-grid">
            <div className="field"><label htmlFor="ac">Bloqueos</label><input id="ac" className="input mono" inputMode="numeric" value={params.count} onChange={numP('count', 1, 100000)} /></div>
            <div className="field"><label htmlFor="am2">En (minutos)</label><input id="am2" className="input mono" inputMode="numeric" value={params.minutes} onChange={numP('minutes', 1, 1440)} /></div>
          </div>
        )}
        {kind === 'spike' && (
          <div className="subform form-grid">
            <div className="field"><label htmlFor="aw">Ventana (min)</label><input id="aw" className="input mono" inputMode="numeric" value={params.windowMin} onChange={numP('windowMin', 5, 120)} /></div>
            <div className="field"><label htmlFor="af">Veces lo normal</label><input id="af" className="input mono" inputMode="decimal" value={params.factor} onChange={numP('factor', 1.5, 100)} /></div>
            <div className="field form-grid__wide"><label htmlFor="ae">Y al menos (eventos)</label><input id="ae" className="input mono" inputMode="numeric" value={params.minEvents} onChange={numP('minEvents', 10, 1000000)} />
              <span className="hint">Evita falsas alarmas cuando casi no hay actividad.</span></div>
          </div>
        )}
        {kind === 'daily_summary' && (
          <div className="subform"><div className="field"><label htmlFor="ah">Enviar a partir de las</label>
            <select id="ah" className="select" value={params.hour} onChange={(e) => setP('hour', Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select></div></div>
        )}

        <div className="field">
          <label htmlFor="acl">De qué cliente</label>
          <select id="acl" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={kind === 'daily_summary' && false}>
            <option value="">Todos los clientes</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.clientName} (:{c.port})</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="ar">Correos que reciben el aviso</label>
          <textarea id="ar" className="input textarea" rows={2} value={recipients} placeholder="jefe@empresa.com, soporte@empresa.com" onChange={(e) => setRecipients(e.target.value)} />
          <span className="hint">Separa varios con coma o espacio. Máximo 20.</span>
        </div>

        {kind !== 'daily_summary' && (
          <div className="field">
            <label htmlFor="ad">Tiempo mínimo entre dos avisos iguales</label>
            <select id="ad" className="select" value={cooldown} onChange={(e) => setCooldown(e.target.value)}>
              {COOLDOWNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="hint">Evita llenar la bandeja si el problema sigue ahí.</span>
          </div>
        )}
        {HAS_RESOLVED.includes(kind) && (
          <label className="check"><input type="checkbox" checked={notifyResolved} onChange={(e) => setNotifyResolved(e.target.checked)} /><span>Avisar también cuando el problema termine</span></label>
        )}
      </div>
    </Dialog>
  );
}

function History() {
  const [list, setList] = useState(null);
  useEffect(() => { api('/alerts/history?limit=100').then((d) => setList(d.history)).catch(() => setList([])); }, []);
  if (!list) return <div className="empty">Cargando…</div>;
  if (!list.length) return <section className="panel"><Empty icon={Mail} title="Todavía no se ha enviado ningún aviso">Cuando una regla se cumpla, cada correo quedará registrado aquí.</Empty></section>;
  const TYPE = { alert: '', resolved: 'Resuelto', test: 'Prueba' };
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Cuándo</th><th>Regla</th><th>Asunto</th><th>Estado</th></tr></thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.id}>
                <td className="nowrap cell-sub">{dateLong(h.ts)}</td>
                <td><div className="cell-main">{h.ruleName}</div>{TYPE[h.type] && <span className="badge badge--plain">{TYPE[h.type]}</span>}</td>
                <td>{h.subject}<div className="cell-sub">Para: {(h.recipients || []).join(', ')}</div></td>
                <td>
                  {h.status === 'sent'
                    ? <span className="badge badge--ok"><CircleCheck size={13} /> Enviado</span>
                    : <><span className="badge badge--critical"><CircleX size={13} /> Falló</span><div className="cell-sub">{h.error}</div></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Alerts() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('alerts.manage');
  const [tab, setTab] = useState('rules');
  const [rules, setRules] = useState(null);
  const [smtp, setSmtp] = useState(true);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // null | 'new' | rule
  const [delFor, setDelFor] = useState(null);

  const load = useCallback(() => {
    api('/alerts').then((d) => { setRules(d.rules); setSmtp(d.smtpConfigured); setError(''); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    api('/ports').then((d) => setClients(d.ports)).catch(() => {});
  }, [load]);

  const toggle = async (r, enabled) => {
    try {
      const d = await api(`/alerts/${r.id}`, { method: 'PATCH', body: { enabled } });
      setRules((l) => l.map((x) => (x.id === r.id ? { ...x, ...d.rule } : x)));
      toast(enabled ? 'Regla activada' : 'Regla apagada', 'info');
    } catch (e) { toast(e.message, 'error'); }
  };
  const sendTest = async (r) => {
    try { const d = await api(`/alerts/${r.id}/test`, { method: 'POST' }); toast(`Prueba enviada a ${d.recipients.join(', ')}`); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (r) => {
    try { await api(`/alerts/${r.id}`, { method: 'DELETE' }); setRules((l) => l.filter((x) => x.id !== r.id)); toast('Regla eliminada'); } catch (e) { toast(e.message, 'error'); }
    setDelFor(null);
  };
  const saved = (r) => { setForm(null); load(); return r; };

  return (
    <>
      <PageHead title="Alertas"
        actions={manage && <button type="button" className="btn btn--primary" onClick={() => setForm('new')}><Plus size={18} /> Nueva regla</button>}>
        Avisos por correo cuando pasa algo importante. Cada regla dice qué vigilar, de qué cliente y a quién avisar.
        {!manage && ' Tu rol puede ver las reglas, pero no cambiarlas.'}
      </PageHead>

      {!smtp && rules && (
        <div className="note note--warn" role="status" style={{ marginBottom: 16 }}>
          <TriangleAlert size={18} aria-hidden="true" />
          <div><strong>El correo no está configurado</strong>
            <p>Mientras tanto, ninguna regla enviará avisos. {can('settings.manage') ? <Link to="/admin/correo">Configurar el correo</Link> : 'Pide a un administrador que lo configure en Administración → Correo.'}</p></div>
        </div>
      )}

      <div className="chips" style={{ marginBottom: 14 }}>
        <button type="button" className="chip" aria-pressed={tab === 'rules'} onClick={() => setTab('rules')}>Reglas {rules && <span className="chip__n">{rules.length}</span>}</button>
        <button type="button" className="chip" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Avisos enviados</button>
      </div>

      {tab === 'history' ? <History /> : error ? (
        <div className="panel"><Empty title="No se pudieron cargar las reglas" action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>{error}</Empty></div>
      ) : !rules ? <div className="empty">Cargando…</div> : rules.length === 0 ? (
        <div className="panel">
          <Empty icon={BellRing} title="Aún no hay reglas"
            action={manage ? <button type="button" className="btn btn--primary" onClick={() => setForm('new')}><Plus size={18} /> Crear la primera</button> : null}>
            {manage ? 'Crea una regla para recibir un correo cuando se caiga el internet, un cliente deje de enviar logs, o llegue un error.' : 'Un administrador debe crear las reglas.'}
          </Empty>
        </div>
      ) : (
        <div className="rules">
          {rules.map((r) => (
            <article key={r.id} className={`panel rule${r.enabled ? '' : ' is-off'}`}>
              <div className="rule__main">
                <div className="rule__title">
                  <h3>{r.name}</h3>
                  <span className="badge badge--accent badge--plain">{r.clientName || 'Todos los clientes'}</span>
                </div>
                <p className="cell-sub"><strong>{KINDS[r.kind].title}.</strong> {describe(r)}</p>
                <div className="rule__meta">
                  <span className="badge badge--plain"><Mail size={13} /> {r.recipients.length === 1 ? r.recipients[0] : `${r.recipients.length} destinatarios`}</span>
                  <span className="cell-sub">Último aviso: {r.lastFired ? timeAgo(r.lastFired).toLowerCase() : 'ninguno'}</span>
                  {(r.sent24h > 0 || r.failed24h > 0) && <span className="cell-sub">24 h: {r.sent24h} enviados{r.failed24h ? `, ${r.failed24h} fallidos` : ''}</span>}
                </div>
              </div>
              {manage && (
                <div className="rule__actions">
                  <button type="button" className="icon-btn" onClick={() => sendTest(r)} aria-label={`Enviar correo de prueba de ${r.name}`} title="Enviar prueba"><Send size={18} /></button>
                  <button type="button" className="icon-btn" onClick={() => setForm(r)} aria-label={`Editar ${r.name}`}><Pencil size={18} /></button>
                  <button type="button" className="icon-btn" onClick={() => setDelFor(r)} aria-label={`Eliminar ${r.name}`}><Trash2 size={18} /></button>
                  <span className="rule__switch"><Switch checked={r.enabled} onChange={(v) => toggle(r, v)} label={`Activar la regla ${r.name}`} /><span className="cell-sub">{r.enabled ? 'Activa' : 'Apagada'}</span></span>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {form && <RuleForm rule={form === 'new' ? null : form} clients={clients} onClose={() => setForm(null)} onSaved={saved} />}
      {delFor && (
        <Dialog title="¿Eliminar esta regla?" variant="modal" onClose={() => setDelFor(null)}
          footer={<><button type="button" className="btn" onClick={() => setDelFor(null)}>Cancelar</button><button type="button" className="btn btn--danger" onClick={() => remove(delFor)}>Eliminar regla</button></>}>
          <div className="dialog-body"><p>Se dejará de avisar a {delFor.recipients.join(', ')}. Los avisos ya enviados se conservan en el historial.</p></div>
        </Dialog>
      )}
    </>
  );
}
