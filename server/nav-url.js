// URL inicial de las tareas escolares: https y dentro de la lista blanca del sitio ("*.dominio" admite subdominios).
export function urlPermitidaEscolar(url, hosts = []) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  return hosts.some((h) => (h.startsWith("*.") ? u.hostname === h.slice(2) || u.hostname.endsWith(h.slice(1)) : u.hostname === h));
}
