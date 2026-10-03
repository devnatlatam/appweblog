import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

const ToastContext = createContext(null);
const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const id = useRef(0);

  const push = useCallback((message, type = 'success') => {
    id.current += 1;
    const t = { id: id.current, message, type };
    setToasts((list) => [...list, t]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), 3600);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div key={t.id} className={`toast toast--${t.type}`}>
              <Icon size={18} aria-hidden="true" />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
