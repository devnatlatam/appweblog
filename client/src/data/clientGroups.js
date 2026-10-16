// Agrupa los clientes por la parte del nombre antes de " - ": "FONDESURCO - ACARI" y "FONDESURCO - APLAO" forman el
// grupo FONDESURCO, con las sedes ACARI y APLAO. Solo se agrupa si al menos dos clientes comparten esa parte; los demás
// quedan sueltos con su nombre completo. Los grupos se ubican donde aparece su primer cliente, así se respeta el orden.
const SEP = ' - ';

export function prefixOf(name) {
  const i = name.indexOf(SEP);
  if (i <= 0) return null;
  const g = name.slice(0, i).trim();
  return g && name.slice(i + SEP.length).trim() ? g : null;
}

// list: los clientes a mostrar. all: todos (para decidir los grupos aunque un filtro deje un solo cliente de uno).
// Devuelve [{ group, items: [{ item, label }] } | { item, label }]
export function groupClients(list, nameOf = (c) => c.clientName, all = list) {
  const count = new Map();
  all.forEach((c) => {
    const g = prefixOf(nameOf(c));
    if (g) count.set(g.toLowerCase(), (count.get(g.toLowerCase()) || 0) + 1);
  });
  const out = [];
  const byKey = new Map();
  list.forEach((c) => {
    const name = nameOf(c);
    const g = prefixOf(name);
    const key = g && g.toLowerCase();
    if (key && count.get(key) > 1) {
      let entry = byKey.get(key);
      if (!entry) {
        entry = { group: g, items: [] };
        byKey.set(key, entry);
        out.push(entry);
      }
      entry.items.push({ item: c, label: name.slice(name.indexOf(SEP) + SEP.length).trim() });
    } else {
      out.push({ item: c, label: name });
    }
  });
  return out;
}
