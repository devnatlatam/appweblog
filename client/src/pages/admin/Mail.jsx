import React, { useEffect, useState } from 'react';
import { Save, Send, MailCheck, MailX, Eye, EyeOff } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PageHead } from '../../components/ui';

// Atajos para los servicios más comunes; solo rellenan el formulario
const PRESETS = [
  { label: 'Gmail', host: 'smtp.gmail.com', port: 587, security: 'starttls', note: 'Gmail pide una “contraseña de aplicación”, no la contraseña normal de la cuenta.' },
  { label: 'Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'starttls', note: 'En Microsoft 365 el administrador debe permitir el envío SMTP autenticado para esa cuenta.' },
];
const DEFAULT_PORT = { starttls: 587, ssl: 465, none: 25 };

export default function Mail() {
  const { user } = useAuth();
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [f, setF] = useState({ host: '', port: '587', security: 'starttls', user: '', password: '', fromName: 'Omada Logs', from: '', appUrl: '' });
  const [show, setShow] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [to, setTo] = useState(user.email);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, text }

  useEffect(() => {
    api('/settings/smtp')
      .then(({ smtp }) => {
        setF({ host: smtp.host, port: String(smtp.port), security: smtp.security, user: smtp.user, password: '', fromName: smtp.fromName, from: smtp.from, appUrl: smtp.appUrl });
        setHasPassword(smtp.hasPassword);
        setConfigured(smtp.configured);
        setLoaded(true);
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setError(''); setTestResult(null); };

  const setSecurity = (e) => {
    const security = e.target.value;
    // Si el puerto era el habitual del tipo anterior, se cambia al habitual del nuevo
    const usual = Object.values(DEFAULT_PORT).map(String);
    setF({ ...f, security, port: usual.includes(f.port) ? String(DEFAULT_PORT[security]) : f.port });
  };

  const preset = (p) => { setF({ ...f, host: p.host, port: String(p.port), security: p.security }); setNote(p.note); setError(''); };

  const body = () => ({ ...f, port: Number(f.port) });

  const save = async () => {
    setSaving(true); setError('');
    try {
      const { smtp } = await api('/settings/smtp', { method: 'PUT', body: body() });
      setHasPassword(smtp.hasPassword); setConfigured(smtp.configured);
      setF((x) => ({ ...x, password: '', appUrl: smtp.appUrl }));
      toast('Correo guardado. Ya está en uso, no hace falta reiniciar.');
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      await api('/settings/smtp/test', { method: 'POST', body: { ...body(), to } });
      setTestResult({ ok: true, text: `Listo: se envió un correo de prueba a ${to}. Revisa la bandeja (y el correo no deseado).` });
    } catch (e) { setTestResult({ ok: false, text: e.message }); }
    setTesting(false);
  };

  if (loadError) return <><PageHead title="Correo" /><div className="form-error">{loadError}</div></>;
  if (!loaded) return <><PageHead title="Correo" /><div className="empty">Cargando…</div></>;

  return (
    <>
      <PageHead title="Correo de salida">
        Desde aquí salen las alertas y los accesos de usuarios nuevos. Se guarda en el archivo <code>.env</code> del servidor y se aplica al instante, sin reiniciar.
      </PageHead>

      <div className="settings">
        <section className="panel">
          <div className="panel__head">
            <div><h2>Servidor de correo</h2><p>Los datos que te da tu proveedor de correo (SMTP).</p></div>
            <span className={`badge badge--${configured ? 'ok' : 'warning'}`}>{configured ? <><MailCheck size={14} /> Configurado</> : <><MailX size={14} /> Sin configurar</>}</span>
          </div>
          <div className="panel__body mail-form">
            <div className="chips" aria-label="Rellenar con un servicio común">
              {PRESETS.map((p) => <button key={p.label} type="button" className="chip" onClick={() => preset(p)}>{p.label}</button>)}
            </div>
            {note && <p className="hint">{note}</p>}
            {error && <div className="form-error" role="alert">{error}</div>}

            <div className="form-grid">
              <div className="field form-grid__wide">
                <label htmlFor="mh">Servidor</label>
                <input id="mh" className="input mono" value={f.host} placeholder="smtp.tu-empresa.com" onChange={set('host')} autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="mp">Puerto</label>
                <input id="mp" className="input mono" inputMode="numeric" value={f.port} onChange={(e) => { setF({ ...f, port: e.target.value.replace(/\D/g, '').slice(0, 5) }); setError(''); }} />
              </div>
              <div className="field">
                <label htmlFor="ms">Seguridad</label>
                <select id="ms" className="select" value={f.security} onChange={setSecurity}>
                  <option value="starttls">STARTTLS (puerto 587)</option>
                  <option value="ssl">SSL/TLS (puerto 465)</option>
                  <option value="none">Ninguna (puerto 25)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="mu">Usuario <span className="hint">(opcional)</span></label>
                <input id="mu" className="input" value={f.user} placeholder="avisos@tu-empresa.com" onChange={set('user')} autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="mw">Contraseña</label>
                <div className="input-wrap">
                  <input id="mw" className="input" type={show ? 'text' : 'password'} value={f.password} autoComplete="new-password"
                    placeholder={hasPassword ? '••••••••  (guardada; escribe otra para cambiarla)' : ''} onChange={set('password')} />
                  <button type="button" className="icon-btn reveal" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="mf">Correo remitente</label>
                <input id="mf" className="input" type="email" value={f.from} placeholder="avisos@tu-empresa.com" onChange={set('from')} />
                <span className="hint">Es el que verá quien reciba los avisos.</span>
              </div>
              <div className="field">
                <label htmlFor="mn">Nombre del remitente</label>
                <input id="mn" className="input" value={f.fromName} onChange={set('fromName')} />
              </div>
              <div className="field form-grid__wide">
                <label htmlFor="ma">Dirección de esta web <span className="hint">(opcional)</span></label>
                <input id="ma" className="input mono" value={f.appUrl} placeholder="https://logs.tu-empresa.com" onChange={set('appUrl')} />
                <span className="hint">Se usa para los enlaces de los correos. Si la dejas vacía, los accesos de usuarios usan la dirección desde la que estás entrando y las alertas no llevan enlace.</span>
              </div>
            </div>

            <div><button type="button" className="btn btn--primary" onClick={save} disabled={saving}><Save size={18} /> {saving ? 'Guardando…' : 'Guardar'}</button></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head"><div><h2>Probar el envío</h2><p>Usa los datos de arriba, estén guardados o no.</p></div></div>
          <div className="panel__body mail-form">
            <div className="field">
              <label htmlFor="mt">Enviar una prueba a</label>
              <input id="mt" className="input" type="email" value={to} onChange={(e) => { setTo(e.target.value); setTestResult(null); }} />
            </div>
            {testResult && <div className={testResult.ok ? 'note note--ok' : 'form-error'} role="status">{testResult.text}</div>}
            <div><button type="button" className="btn" onClick={test} disabled={testing || !to}><Send size={18} /> {testing ? 'Enviando…' : 'Enviar correo de prueba'}</button></div>
          </div>
        </section>
      </div>
    </>
  );
}
