import React, { useEffect, useRef } from 'react';
import { X, Inbox } from 'lucide-react';
import { SEVERITIES } from '../data/severity';
import { ROLES } from '../data/roles';

export function SeverityBadge({ severity }) {
  return <span className={`badge badge--${severity}`}>{SEVERITIES[severity].label}</span>;
}

export function RoleBadge({ role }) {
  return <span className="badge badge--accent badge--plain">{ROLES[role].label}</span>;
}

export function PageHead({ title, children, actions }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

export function Empty({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="empty">
      <Icon size={36} aria-hidden="true" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <span className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span aria-hidden="true" />
    </span>
  );
}

// Panel lateral (escritorio) / hoja inferior (móvil) o modal centrado.
export function Dialog({ title, onClose, children, footer, variant = 'drawer' }) {
  const ref = useRef(null);

  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    if (ref.current) ref.current.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (prev && prev.focus) prev.focus();
    };
  }, [onClose]);

  const Box = variant === 'modal' ? 'modal' : 'drawer';
  return (
    <div
      className={`overlay${variant === 'modal' ? ' overlay--center' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={Box} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </div>
        {children}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function timeShort(iso) {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function timeAgo(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'Hace unos segundos';
  const m = Math.floor(s / 60);
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  return `Hace ${Math.floor(h / 24)} d`;
}

export function dateLong(iso) {
  return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
