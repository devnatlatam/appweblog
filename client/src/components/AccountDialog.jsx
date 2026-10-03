import React, { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ROLES } from '../data/roles';
import { Dialog } from './ui';

// "Mi cuenta": cada persona cambia su nombre y su contraseña sin pedirle nada a un administrador
export default function AccountDialog({ onClose }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [nameErr, setNameErr] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [passErr, setPassErr] = useState('');
  const [busy, setBusy] = useState('');

  const saveName = async () => {
    setBusy('name'); setNameErr('');
    try {
      const d = await api('/auth/me', { method: 'PATCH', body: { name } });
      setUser((u) => ({ ...u, ...d.user }));
      toast('Nombre actualizado');
    } catch (e) { setNameErr(e.message); }
    setBusy('');
  };

  const savePass = async () => {
    setPassErr('');
    if (next.length < 10) return setPassErr('La contraseña nueva debe tener al menos 10 caracteres.');
    if (next !== again) return setPassErr('Las dos contraseñas nuevas no coinciden.');
    setBusy('pass');
    try {
      await api('/auth/change-password', { method: 'POST', body: { current, next } });
      toast('Contraseña actualizada');
      setCurrent(''); setNext(''); setAgain('');
    } catch (e) { setPassErr(e.message); }
    return setBusy('');
  };

  return (
    <Dialog title="Mi cuenta" variant="modal" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Cerrar</button>}>
      <div className="dialog-body">
        <dl className="fields">
          <dt>Correo</dt><dd>{user.email}</dd>
          <dt>Nivel de acceso</dt><dd>{ROLES[user.role].label}</dd>
        </dl>

        <div className="field">
          <label htmlFor="acn">Nombre</label>
          <div className="inline-field">
            <input id="acn" className="input" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setNameErr(''); }} />
            <button type="button" className="btn" onClick={saveName} disabled={busy === 'name' || !name.trim() || name.trim() === user.name}>Guardar</button>
          </div>
          {nameErr && <div className="form-error" role="alert">{nameErr}</div>}
        </div>

        <hr className="sep" />
        <h3>Cambiar mi contraseña</h3>
        {passErr && <div className="form-error" role="alert">{passErr}</div>}
        <div className="field"><label htmlFor="acc">Contraseña actual</label><input id="acc" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setPassErr(''); }} /></div>
        <div className="field"><label htmlFor="acx">Contraseña nueva</label><input id="acx" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setPassErr(''); }} /><span className="hint">Mínimo 10 caracteres.</span></div>
        <div className="field"><label htmlFor="acy">Repite la contraseña nueva</label><input id="acy" className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => { setAgain(e.target.value); setPassErr(''); }} /></div>
        <div><button type="button" className="btn btn--primary" onClick={savePass} disabled={busy === 'pass' || !current || !next}>Cambiar contraseña</button></div>
      </div>
    </Dialog>
  );
}
