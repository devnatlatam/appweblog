import React from 'react';
import { Link } from 'react-router-dom';
import { Lock, Compass } from 'lucide-react';
import { Empty } from '../components/ui';

export default function NotFound({ denied }) {
  return (
    <div className="panel" style={{ maxWidth: 520, margin: '40px auto' }}>
      <Empty
        icon={denied ? Lock : Compass}
        title={denied ? 'No tienes acceso a esta sección' : 'Esta página no existe'}
        action={<Link className="btn btn--primary" to="/">Volver al resumen</Link>}
      >
        {denied
          ? 'Tu nivel de acceso no incluye esta sección. Si la necesitas, pide a un administrador que cambie tu rol.'
          : 'Revisa la dirección o vuelve al resumen.'}
      </Empty>
    </div>
  );
}
