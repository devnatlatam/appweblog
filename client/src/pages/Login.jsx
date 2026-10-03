import React, { useState } from 'react';
import { Activity, Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const SAMPLE_RAW = '<131>Oct  2 09:14:07 Omada [Oficina Central] [EAP610-Bodega:50-C7-BF-3A-01-A5] was disconnected. Heartbeat lost for 180s.';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await login(email, password);
    if (!res.ok) { setError(res.error); setBusy(false); }
  };

  return (
    <div className="login">
      <section className="login__story" aria-hidden="true">
        <div className="brand login__brand">
          <span className="brand__mark"><Activity size={20} /></span>
          <span className="brand__name">Omada Logs</span>
        </div>
        <div className="login__demo">
          <p className="login__lead">Lo que manda el controlador, en palabras que se entienden.</p>
          <div className="translate">
            <div className="translate__raw"><code>{SAMPLE_RAW}</code></div>
            <div className="translate__arrow" />
            <div className="translate__human">
              <span className="badge badge--critical">Crítico</span>
              <strong>EAP610-Bodega dejó de responder al controlador</strong>
              <p>Los usuarios de esa zona se quedan sin Wi-Fi. Revisa la energía PoE del puerto 7 y el cable hacia la bodega.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="login__form">
        <form onSubmit={submit} noValidate>
          <h1>Iniciar sesión</h1>
          <p className="login__sub">Entra con tu cuenta para ver los registros de la red.</p>

          {error && (
            <div className="form-error" role="alert"><AlertCircle size={18} style={{ flex: 'none', marginTop: 1 }} />{error}</div>
          )}

          <div className="field">
            <label htmlFor="email">Correo</label>
            <div className="input-wrap">
              <Mail size={18} aria-hidden="true" />
              <input id="email" className="input" type="email" autoComplete="username" placeholder="nombre@empresa.com"
                value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} required />
            </div>
          </div>

          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <div className="input-wrap">
              <Lock size={18} aria-hidden="true" />
              <input id="password" className="input" type={show ? 'text' : 'password'} autoComplete="current-password"
                value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} required />
              <button type="button" className="icon-btn reveal" onClick={() => setShow(!show)}
                aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn--primary btn--block" style={{ minHeight: 46 }} disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </section>
    </div>
  );
}
