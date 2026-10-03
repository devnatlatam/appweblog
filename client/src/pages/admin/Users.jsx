import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, UserPlus, Pencil, Ban, RotateCcw, KeyRound, Copy, Trash2, MailCheck, MailWarning } from 'lucide-react';
import { api } from '../../api';
import { ROLES, ROLE_ORDER } from '../../data/roles';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PageHead, RoleBadge, Dialog, Empty, timeAgo } from '../../components/ui';

function statusOf(u) {
  if (u.status === 'disabled') return { label: 'Desactivado', cls: 'plain' };
  if (u.mustChangePassword) return { label: 'Clave pendiente', cls: 'info' };
  return { label: 'Activo', cls: 'ok' };
}

function MailOption({ checked, onChange, configured }) {
  return (
    <div>
      <label className="check">
        <input type="checkbox" checked={checked && configured} disabled={!configured} onChange={(e) => onChange(e.target.checked)} />
        <span>Enviar el acceso por correo</span>
      </label>
      {!configured && <p className="hint">El correo todavía no está configurado (Administración → Correo). Podrás copiar la contraseña y entregarla tú.</p>}
    </div>
  );
}

function UserForm({ user, onClose, onSave, myLevel, mailConfigured }) {
  const [name, setName] = useState(user ? user.name : '');
  const [email, setEmail] = useState(user ? user.email : '');
  const [role, setRole] = useState(user ? user.role : 'lector');
  const [sendEmail, setSendEmail] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Nadie puede asignar un rol por encima del suyo
  const allowed = ROLE_ORDER.filter((r) => ROLES[r].level <= myLevel);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave({ name, email, role, ...(user ? {} : { sendEmail: sendEmail && mailConfigured }) });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={user ? 'Editar usuario' : 'Nuevo usuario'} variant="modal" onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn--primary" disabled={!name || !email || busy} onClick={submit}>
            {user ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </>
      }>
      <div className="dialog-body">
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="field"><label htmlFor="un">Nombre</label><input id="un" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="ue">Correo</label><input id="ue" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="ur">Nivel de acceso</label>
          <select id="ur" className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {allowed.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
          </select>
          <span className="hint">{ROLES[role].description}</span>
        </div>
        {!user && (
          <>
            <p className="hint">Se generará una contraseña temporal. La persona deberá cambiarla en su primer ingreso.</p>
            <MailOption checked={sendEmail} onChange={setSendEmail} configured={mailConfigured} />
          </>
        )}
      </div>
    </Dialog>
  );
}

function ResetDialog({ user, mailConfigured, onClose, onDone }) {
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    try { await onDone(user, sendEmail && mailConfigured); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Dialog title="Generar contraseña nueva" variant="modal" onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn--primary" onClick={go} disabled={busy}>Generar contraseña</button>
        </>
      }>
      <div className="dialog-body">
        {error && <div className="form-error" role="alert">{error}</div>}
        <p>La contraseña actual de <strong>{user.name}</strong> dejará de servir. Se generará una temporal y tendrá que cambiarla al entrar.</p>
        <MailOption checked={sendEmail} onChange={setSendEmail} configured={mailConfigured} />
      </div>
    </Dialog>
  );
}

function TempPassword({ info, onClose }) {
  const toast = useToast();
  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(info.password).then(() => toast('Contraseña copiada'));
  };
  const mail = info.email;
  return (
    <Dialog title="Contraseña temporal" variant="modal" onClose={onClose}
      footer={<button type="button" className="btn btn--primary" onClick={onClose}>Listo</button>}>
      <div className="dialog-body">
        {mail && mail.sent && (
          <div className="note note--ok"><MailCheck size={18} aria-hidden="true" /><div><strong>Enviada por correo</strong><p>Se envió a {info.address}.</p></div></div>
        )}
        {mail && !mail.sent && mail.error && (
          <div className="note note--warn"><MailWarning size={18} aria-hidden="true" /><div><strong>No se pudo enviar el correo</strong><p>{mail.error} Entrégale la contraseña tú.</p></div></div>
        )}
        <p>Esta es la contraseña temporal de <strong>{info.name}</strong> ({info.address}). Solo se muestra ahora; si se pierde, genera otra.</p>
        <div className="temp-pass">
          <code className="mono">{info.password}</code>
          <button type="button" className="btn btn--sm" onClick={copy}><Copy size={16} /> Copiar</button>
        </div>
      </div>
    </Dialog>
  );
}

export default function Users() {
  const { user: me, level } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [mailConfigured, setMailConfigured] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [form, setForm] = useState(null); // null | 'new' | user
  const [temp, setTemp] = useState(null);
  const [resetFor, setResetFor] = useState(null);
  const [delFor, setDelFor] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api('/users')
      .then((d) => { setUsers(d.users); setMailConfigured(Boolean(d.mailConfigured)); setLoadError(''); })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return users.filter((u) => (!role || u.role === role) && (!t || `${u.name} ${u.email}`.toLowerCase().includes(t)));
  }, [users, q, role]);

  const replace = (u) => setUsers((l) => l.map((x) => (x.id === u.id ? u : x)));

  const save = async (data) => {
    if (form === 'new') {
      const d = await api('/users', { method: 'POST', body: data });
      setUsers((l) => [...l, d.user]);
      setTemp({ name: d.user.name, address: d.user.email, password: d.tempPassword, email: data.sendEmail ? d.email : null });
    } else {
      const d = await api(`/users/${form.id}`, { method: 'PATCH', body: data });
      replace(d.user);
      toast('Cambios guardados');
    }
    setForm(null);
  };

  const setStatus = async (u, status) => {
    try {
      const d = await api(`/users/${u.id}`, { method: 'PATCH', body: { status } });
      replace(d.user);
      toast(status === 'disabled' ? `${u.name} fue desactivado` : `${u.name} fue reactivado`, 'info');
    } catch (e) { toast(e.message, 'error'); }
  };

  const reset = async (u, sendEmail) => {
    const d = await api(`/users/${u.id}/reset-password`, { method: 'POST', body: { sendEmail } });
    replace(d.user);
    setResetFor(null);
    setTemp({ name: u.name, address: u.email, password: d.tempPassword, email: sendEmail ? d.email : null });
  };

  const remove = async (u) => {
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      setUsers((l) => l.filter((x) => x.id !== u.id));
      toast(`${u.name} fue eliminado`);
    } catch (e) { toast(e.message, 'error'); }
    setDelFor(null);
  };

  // Solo se gestiona a quien tenga un nivel igual o menor al propio, y nunca a uno mismo
  const editable = (u) => ROLES[u.role].level <= level && u.id !== me.id;

  return (
    <>
      <PageHead title="Usuarios"
        actions={<button type="button" className="btn btn--primary" onClick={() => setForm('new')}><UserPlus size={18} /> Nuevo usuario</button>}>
        Quién puede entrar y con qué nivel de acceso. Los accesos se crean aquí y se pueden enviar por correo.
      </PageHead>

      <div className="filters__row" style={{ marginBottom: 16 }}>
        <div className="input-wrap filters__search">
          <Search size={18} aria-hidden="true" />
          <input className="input" type="search" placeholder="Buscar por nombre o correo" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Buscar usuarios" />
        </div>
        <select className="select filters__sel" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rol">
          <option value="">Todos los roles</option>
          {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
        </select>
      </div>

      <section className="panel">
        {loadError ? (
          <Empty title="No se pudo cargar la lista" action={<button type="button" className="btn" onClick={load}>Reintentar</button>}>
            {loadError}
          </Empty>
        ) : loading ? (
          <div className="empty">Cargando usuarios…</div>
        ) : (
          <div className="table-wrap users-table">
            <table className="table">
              <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {list.map((u) => {
                  const st = statusOf(u);
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="user-cell">
                          <span className="avatar avatar--sm" aria-hidden="true">{u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                          <div><div className="cell-main">{u.name}{u.id === me.id && ' (tú)'}</div><div className="cell-sub">{u.email}</div></div>
                        </div>
                      </td>
                      <td><RoleBadge role={u.role} /></td>
                      <td><span className={`badge badge--${st.cls}`}>{st.label}</span></td>
                      <td className="cell-sub">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Nunca'}</td>
                      <td>
                        {editable(u) && (
                          <div className="row-actions">
                            <button type="button" className="icon-btn" onClick={() => setForm(u)} aria-label={`Editar a ${u.name}`}><Pencil size={18} /></button>
                            <button type="button" className="icon-btn" onClick={() => setResetFor(u)} aria-label={`Generar contraseña nueva para ${u.name}`}><KeyRound size={18} /></button>
                            {u.status === 'disabled' ? (
                              <button type="button" className="icon-btn" onClick={() => setStatus(u, 'active')} aria-label={`Reactivar a ${u.name}`}><RotateCcw size={18} /></button>
                            ) : (
                              <button type="button" className="icon-btn" onClick={() => setStatus(u, 'disabled')} aria-label={`Desactivar a ${u.name}`}><Ban size={18} /></button>
                            )}
                            <button type="button" className="icon-btn" onClick={() => setDelFor(u)} aria-label={`Eliminar a ${u.name}`}><Trash2 size={18} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && <UserForm user={form === 'new' ? null : form} myLevel={level} mailConfigured={mailConfigured} onClose={() => setForm(null)} onSave={save} />}
      {resetFor && <ResetDialog user={resetFor} mailConfigured={mailConfigured} onClose={() => setResetFor(null)} onDone={reset} />}
      {temp && <TempPassword info={temp} onClose={() => setTemp(null)} />}
      {delFor && (
        <Dialog title="¿Eliminar este usuario?" variant="modal" onClose={() => setDelFor(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDelFor(null)}>Cancelar</button>
              <button type="button" className="btn btn--danger" onClick={() => remove(delFor)}>Eliminar usuario</button>
            </>
          }>
          <div className="dialog-body">
            <p><strong>{delFor.name}</strong> ({delFor.email}) ya no podrá entrar. Esta acción no se puede deshacer.</p>
            <p className="hint">Si solo quieres impedirle el acceso por un tiempo, usa “Desactivar”.</p>
          </div>
        </Dialog>
      )}
    </>
  );
}
