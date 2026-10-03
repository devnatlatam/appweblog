import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ClientView from './pages/ClientView';
import Clients from './pages/Clients';
import Alerts from './pages/Alerts';
import Ports from './pages/Ports';
import Users from './pages/admin/Users';
import Roles from './pages/admin/Roles';
import Storage from './pages/admin/Storage';
import Mail from './pages/admin/Mail';
import Types from './pages/admin/Types';
import NotFound from './pages/NotFound';
import ChangePassword from './pages/ChangePassword';

// Protege una ruta por permiso. Sin permiso se muestra una pantalla clara, no una redirección muda.
function Guard({ perm, children }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <NotFound denied />;
  return children;
}

function Private({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.mustChangePassword) return <ChangePassword />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        element={
          <Private>
            <AppShell />
          </Private>
        }
      >
        <Route index element={<Guard perm="dashboard.view"><Dashboard /></Guard>} />
        <Route path="clientes" element={<Guard perm="ports.view"><Clients /></Guard>} />
        <Route path="clientes/:id/*" element={<Guard perm="ports.view"><ClientView /></Guard>} />
        <Route path="registros" element={<Navigate to="/clientes" replace />} />
        <Route path="en-vivo" element={<Navigate to="/clientes" replace />} />
        <Route path="puertos" element={<Guard perm="ports.view"><Ports /></Guard>} />
        <Route path="alertas" element={<Guard perm="alerts.view"><Alerts /></Guard>} />
        <Route path="admin/usuarios" element={<Guard perm="users.manage"><Users /></Guard>} />
        <Route path="admin/roles" element={<Guard perm="roles.manage"><Roles /></Guard>} />
        <Route path="admin/por-aprobar" element={<Guard perm="types.review"><Types /></Guard>} />
        <Route path="admin/correo" element={<Guard perm="settings.manage"><Mail /></Guard>} />
        <Route path="admin/almacenamiento" element={<Guard perm="storage.manage"><Storage /></Guard>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
