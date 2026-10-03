import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api';

const EventsContext = createContext(null);
const POLL_MS = 8000;

// Resumen de las últimas 24 h, que se refresca solo mientras "en vivo" esté activo.
export function EventsProvider({ children }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);

  const refresh = useCallback(() => {
    api('/summary')
      .then((d) => { setSummary(d); setError(''); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    if (!live) return undefined;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [live, refresh]);

  const value = useMemo(
    () => ({ summary, error, live, setLive, refresh, pending: summary ? summary.pending : 0 }),
    [summary, error, live, refresh]
  );
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export const useEvents = () => useContext(EventsContext);
