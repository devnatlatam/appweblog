import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ScrollText, Cable, BellRing, Users, ShieldCheck, HardDrive, Mail, ChevronsUpDown,
  Menu, Sun, Moon, LogOut, Activity, Pause, Play, Radio, ListChecks,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { EventsProvider, useEvents } from '../context/EventsContext';
import { ROLES } from '../data/roles';
import AccountDialog from './AccountDialog';
import { api } from '../api';

const clientState = (c) => (c.listening ? 'on' : c.isActive ? 'err' : 'off');

// El menú arma una entrada por cada cliente: cada uno tiene su propio espacio con sus logs
function buildNav(clients, can) {
  const nav = [{ to: '/', label: 'Resumen general', icon: LayoutDashboard, perm: 'dashboard.view', end: true, badge: true, tab: true }];
  if (can('ports.view')) {
    nav.push({ group: 'Clientes' });
    clients.forEach((c) => nav.push({ to: `/clientes/${c.id}`, label: c.clientName, sub: `:${c.port}`, dot: clientState(c), perm: 'ports.view' }));
    nav.push({ to: '/puertos', label: can('ports.manage') ? 'Gestionar clientes' : 'Clientes y puertos', icon: Cable, perm: 'ports.view', tab: true });
  }
  nav.push({ to: '/alertas', label: 'Alertas', icon: BellRing, perm: 'alerts.view', tab: true });
  nav.push({ to: '/admin/por-aprobar', label: 'Por aprobar', icon: ListChecks, perm: 'types.review', typesBadge: true });
  nav.push({ group: 'Administración' });
  nav.push({ to: '/admin/usuarios', label: 'Usuarios', icon: Users, perm: 'users.manage' });
  nav.push({ to: '/admin/roles', label: 'Roles y permisos', icon: ShieldCheck, perm: 'roles.manage' });
  nav.push({ to: '/admin/almacenamiento', label: 'Almacenamiento', icon: HardDrive, perm: 'storage.manage' });
  nav.push({ to: '/admin/correo', label: 'Correo', icon: Mail, perm: 'settings.manage' });
  return nav;
}

const TITLES = {
  '/': 'Resumen general', '/puertos': 'Clientes y puertos', '/alertas': 'Alertas', '/admin/por-aprobar': 'Por aprobar',
  '/admin/usuarios': 'Usuarios', '/admin/roles': 'Roles y permisos', '/admin/almacenamiento': 'Almacenamiento', '/admin/correo': 'Correo',
};

const initials = (name) => name.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase();

function Shell() {
  const { user, logout, can } = useAuth();
  const { theme, toggle } = useTheme();
  const { live, setLive, pending } = useEvents();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const location = useLocation();
  const [clients, setClients] = useState([]);
  const [typesPending, setTypesPending] = useState(0);

  const loadClients = useCallback(() => {
    if (!can('ports.view')) return;
    api('/ports').then((d) => setClients(d.ports)).catch(() => {});
  }, [can]);
  useEffect(() => {
    loadClients();
    const t = setInterval(loadClients, 15000);
    window.addEventListener('clients-changed', loadClients);
    return () => { clearInterval(t); window.removeEventListener('clients-changed', loadClients); };
  }, [loadClients]);

  const loadTypes = useCallback(() => {
    if (!can('types.review')) return;
    api('/types/summary').then((d) => setTypesPending(d.pending)).catch(() => {});
  }, [can]);
  useEffect(() => {
    loadTypes();
    const t = setInterval(loadTypes, 15000);
    window.addEventListener('types-changed', loadTypes);
    return () => { clearInterval(t); window.removeEventListener('types-changed', loadTypes); };
  }, [loadTypes]);

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const items = buildNav(clients, can).filter((n) => n.group || can(n.perm));
  // Oculta el encabezado de grupo si no queda ningún enlace debajo
  const visible = items.filter((n, i) => !n.group || (items[i + 1] && !items[i + 1].group));
  const tabs = items.filter((n) => n.tab);

  return (
    <div className="shell">
      <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="Navegación principal">
        <NavLink to="/" className="brand">
          <span className="brand__mark"><Activity size={20} aria-hidden="true" /></span>
          <span className="brand__name">Omada Logs<span className="brand__sub">Monitoreo de red</span></span>
        </NavLink>

        <nav className="nav">
          {visible.map((n) =>
            n.group ? (
              <div key={n.group} className="nav__group">{n.group}</div>
            ) : (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}
              >
                {n.dot ? <span className={`dot dot--${n.dot}`} aria-hidden="true" /> : <n.icon size={19} aria-hidden="true" />}
                <span className="nav__label">{n.label}</span>
                {n.sub && <span className="nav__sub">{n.sub}</span>}
                {n.typesBadge && typesPending > 0 && (
                  <span className="nav__count nav__count--info" aria-label={`${typesPending} tipos de log por aprobar`}>{typesPending}</span>
                )}
                {n.badge && pending > 0 && (
                  <span className="nav__count" aria-label={`${pending} problemas sin revisar`}>{pending}</span>
                )}
              </NavLink>
            )
          )}
        </nav>

        <div className="sidebar__foot">
          <button type="button" className="me" onClick={() => setAccount(true)} aria-label="Mi cuenta: cambiar nombre o contraseña">
            <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
            <div>
              <div className="me__name">{user.name}</div>
              <div className="me__role">{ROLES[user.role].label}</div>
            </div>
            <ChevronsUpDown size={16} aria-hidden="true" className="me__chev" />
          </button>
          <button type="button" className="nav__link" style={{ width: '100%', background: 'none', border: 0 }} onClick={logout}>
            <LogOut size={19} aria-hidden="true" /> Cerrar sesión
          </button>
        </div>
      </aside>

      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu size={22} />
          </button>
          <span className="topbar__title">{location.pathname.startsWith('/clientes/') ? 'Cliente' : (TITLES[location.pathname] || 'Omada Logs')}</span>
          <span className="topbar__spacer" />
          <span className={`live${live ? '' : ' is-paused'}`}>
            <span className="live__dot" aria-hidden="true" />
            <span className="live__label">{live ? 'Recibiendo en vivo' : 'En pausa'}</span>
          </span>
          <button
            type="button" className="icon-btn" onClick={() => setLive(!live)}
            aria-label={live ? 'Pausar actualización en vivo' : 'Reanudar actualización en vivo'}
          >
            {live ? <Pause size={19} /> : <Play size={19} />}
          </button>
          <button
            type="button" className="icon-btn" onClick={toggle}
            aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>

      {account && <AccountDialog onClose={() => setAccount(false)} />}

      <nav className="tabbar" aria-label="Secciones">
        {tabs.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'is-active' : '')}>
            <n.icon size={21} aria-hidden="true" />
            {n.label}
          </NavLink>
        ))}
        <button
          type="button" onClick={() => setOpen(true)}
          style={{ background: 'none', border: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-dim)' }}
        >
          <Menu size={21} aria-hidden="true" /> Más
        </button>
      </nav>
    </div>
  );
}

export default function AppShell() {
  return (
    <EventsProvider>
      <Shell />
    </EventsProvider>
  );
}
