import React, { useState } from 'react';
import { Lock, AlertCircle, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function ChangePassword() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 10) return setError('La contraseña nueva debe tener al menos 10 caracteres.');
    if (next !== again) return setError('Las dos contraseñas nuevas no coinciden.');
    setBusy(true);
    try {
      const d = await api('/auth/change-password', { method: 'POST', body: { current, next } });
      setUser(d.user);
      toast('Contraseña actualizada');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login__form" style={{ gridColumn: '1 / -1' }}>
        <form onSubmit={submit} noValidate>
          <span className="stat__icon stat__icon--info"><ShieldCheck size={22} aria-hidden="true" /></span>
          <h1>Crea tu contraseña</h1>
          <p className="login__sub">
            Hola, {user.name.split(' ')[0]}. Entraste con una contraseña temporal. Elige una propia para continuar.
          </p>

          {error && <div className="form-error" role="alert"><AlertCircle size={18} style={{ flex: 'none', marginTop: 1 }} />{error}</div>}

          <div className="field">
            <label htmlFor="cur">Contraseña temporal</label>
            <div className="input-wrap"><Lock size={18} aria-hidden="true" />
              <input id="cur" className="input" type="password" autoComplete="current-password" value={current}
                onChange={(e) => { setCurrent(e.target.value); setError(''); }} required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="new">Contraseña nueva</label>
            <div className="input-wrap"><Lock size={18} aria-hidden="true" />
              <input id="new" className="input" type="password" autoComplete="new-password" value={next}
                onChange={(e) => { setNext(e.target.value); setError(''); }} required />
            </div>
            <span className="hint">Mínimo 10 caracteres.</span>
          </div>
          <div className="field">
            <label htmlFor="again">Repite la contraseña nueva</label>
            <div className="input-wrap"><Lock size={18} aria-hidden="true" />
              <input id="again" className="input" type="password" autoComplete="new-password" value={again}
                onChange={(e) => { setAgain(e.target.value); setError(''); }} required />
            </div>
          </div>

          <button type="submit" className="btn btn--primary btn--block" style={{ minHeight: 46 }} disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar contraseña'}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={logout}>Cerrar sesión</button>
        </form>
      </section>
    </div>
  );
}
