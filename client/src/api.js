const KEY = 'omadalogs.token';

export const tokenStore = {
  get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
  set(t) { try { localStorage.setItem(KEY, t); } catch (e) { /* sin almacenamiento */ } },
  clear() { try { localStorage.removeItem(KEY); } catch (e) { /* sin almacenamiento */ } },
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body } = {}) {
  const token = tokenStore.get();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('No se pudo conectar con el servidor. Revisa que la API esté encendida.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 401 en una pantalla distinta al login = la sesión venció
    if (res.status === 401 && token && path !== '/auth/login') onUnauthorized();
    throw new Error(data.error || 'Ocurrió un error inesperado.');
  }
  return data;
}

// Descarga un archivo (por ejemplo el CSV de registros) enviando la sesión
export async function apiDownload(path, filename) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo descargar el archivo.');
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
