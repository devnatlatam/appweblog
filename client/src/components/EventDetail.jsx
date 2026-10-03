import React from 'react';
import { CheckCheck, Copy, Lightbulb, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { interpret, moduleLabel, FIELD_LABELS } from '../data/catalog';
import { SeverityBadge, Dialog, dateLong } from './ui';

export default function EventDetail({ event, onClose, onAck }) {
  const { can } = useAuth();
  const toast = useToast();
  const { meaning, action } = interpret(event);

  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(event.raw).then(() => toast('Mensaje copiado'));
  };

  return (
    <Dialog
      title="Detalle del evento"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cerrar</button>
          {can('logs.ack') && !event.acknowledged && (
            <button type="button" className="btn btn--primary" onClick={() => onAck(event)}><CheckCheck size={18} /> Marcar como revisado</button>
          )}
        </>
      }
    >
      <div className="dialog-body">
        <div className="detail-top">
          <SeverityBadge severity={event.severity} />
          <span className="badge badge--plain">{moduleLabel(event.module)}</span>
          {event.acknowledged && <span className="badge badge--ok">Revisado</span>}
        </div>

        <div>
          <h3 className="detail-title">{event.summary}</h3>
          <p className="cell-sub">{dateLong(event.ts)} · {event.clientName ? `${event.clientName} (puerto ${event.port})` : (event.host || event.sourceIp)}</p>
        </div>

        <div className="note">
          <Info size={18} aria-hidden="true" />
          <div><strong>Qué significa</strong><p>{meaning}</p></div>
        </div>

        {action && (
          <div className="note note--action">
            <Lightbulb size={18} aria-hidden="true" />
            <div><strong>Qué hacer</strong><p>{action}</p></div>
          </div>
        )}

        {Object.keys(event.fields).length > 0 && (
          <div>
            <h3 className="detail-sub">Datos extraídos</h3>
            <dl className="fields">
              {Object.entries(event.fields).map(([k, v]) => (
                <React.Fragment key={k}><dt>{FIELD_LABELS[k] || (k.startsWith('cambio.') ? `Cambió: ${k.slice(7)}` : k)}</dt><dd className="mono">{k === 'rule' && event.aclName ? `${event.aclName} (${String(v)})` : String(v)}</dd></React.Fragment>
              ))}
            </dl>
          </div>
        )}

        {event.raw && (
          <div>
            <div className="detail-sub-row">
              <h3 className="detail-sub">Mensaje original (syslog)</h3>
              <button type="button" className="btn btn--sm btn--ghost" onClick={copy}><Copy size={16} /> Copiar</button>
            </div>
            <pre className="raw">{event.raw}</pre>
          </div>
        )}
      </div>
    </Dialog>
  );
}
