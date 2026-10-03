import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { ROLES, ROLE_PERMISSIONS } from '../data/roles';
import { api, tokenStore, setUnauthorizedHandler } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // Al abrir la app, recupera la sesión guardada
  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, [logout]);

  const login = useCallback(async (email, password) => {
    try {
      const d = await api('/auth/login', { method: 'POST', body: { email, password } });
      tokenStore.set(d.token);
      setUser(d.user);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, []);

  const value = useMemo(() => {
    const perms = user ? ROLE_PERMISSIONS[user.role] || [] : [];
    return {
      user,
      loading,
      login,
      logout,
      setUser,
      level: user ? ROLES[user.role].level : 0,
      can: (key) => perms.includes(key),
    };
  }, [user, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
