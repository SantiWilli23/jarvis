// Comparación de nombres de playlist: sin tildes ni palabras vacías, por palabras y distancia de edición.
const VACIAS = new Set(["mi", "mis", "lista", "listas", "playlist", "playlists", "de", "del", "la", "el", "las", "los", "una", "un", "reproduccion"]);
export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
export const palabras = (s) => norm(s).split(" ").filter((w) => w && !VACIAS.has(w));

export function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const parecida = (a, b) => a === b || lev(a, b) <= (Math.min(a.length, b.length) >= 7 ? 2 : Math.min(a.length, b.length) >= 4 ? 1 : 0);

// names: [{id, titulo}]. Devuelve { mejor, parecidas: [3 más cercanas] }. `mejor` solo si TODAS las palabras pedidas coinciden.
export function bestMatch(names, query) {
  const q = palabras(query);
  if (!q.length) return { mejor: null, parecidas: [] };
  const pts = names.map((n) => {
    const w = palabras(n.titulo);
    const cubiertas = q.filter((x) => w.some((y) => parecida(x, y))).length;
    const extra = w.length - cubiertas;
    const d = lev(q.join(" "), w.join(" ")) / Math.max(q.join(" ").length, w.join(" ").length, 1);
    return { n, cubiertas, extra, score: cubiertas / q.length - d * 0.01 - extra * 0.001 };
  });
  pts.sort((a, b) => b.score - a.score);
  const completo = pts.filter((p) => p.cubiertas === q.length);
  return { mejor: completo[0]?.n || null, parecidas: pts.slice(0, 3).filter((p) => p.cubiertas > 0 || p.score > -0.5).map((p) => p.n) };
}
