import React from 'react';
import { Check, Minus } from 'lucide-react';
import { ROLES, ROLE_ORDER, PERMISSION_GROUPS, ROLE_PERMISSIONS } from '../../data/roles';
import { PageHead } from '../../components/ui';

const COLS = ROLE_ORDER.slice().reverse(); // de menor a mayor acceso

export default function Roles() {
  return (
    <>
      <PageHead title="Roles y permisos">
        Cada nivel incluye lo del nivel anterior. Así se ve qué puede hacer cada rol.
      </PageHead>

      <div className="role-cards">
        {COLS.map((r) => (
          <article key={r} className="panel role-card">
            <span className="badge badge--accent badge--plain">Nivel {ROLES[r].level}</span>
            <h3>{ROLES[r].label}</h3>
            <p className="cell-sub">{ROLES[r].description}</p>
          </article>
        ))}
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="table-wrap">
          <table className="table matrix">
            <thead>
              <tr>
                <th>Permiso</th>
                {COLS.map((r) => <th key={r} className="matrix__col">{ROLES[r].label}</th>)}
              </tr>
            </thead>
            {PERMISSION_GROUPS.map((g) => (
              <tbody key={g.group}>
                <tr className="matrix__group"><td colSpan={COLS.length + 1}>{g.group}</td></tr>
                {g.items.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    {COLS.map((r) => {
                      const has = ROLE_PERMISSIONS[r].includes(p.key);
                      return (
                        <td key={r} className="matrix__col">
                          {has ? <Check size={18} className="yes" aria-label="Permitido" /> : <Minus size={18} className="no" aria-label="No permitido" />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>
    </>
  );
}
