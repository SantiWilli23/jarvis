// Comparación determinista informe vs. diff real (name-status y stat que manda el runner).
import { isSensitivePath } from "./redact.js";

const norm = (p) => String(p || "").trim().replace(/\/g, "/").replace(/^\.\//, "").replace(/^"|"$/g, "");

// Extrae rutas cambiadas de `git diff --name-status --stat -M` (y de cabeceras `diff --git`).
export function parseChanged(diff) {
  const set = new Set();
  for (const line of String(diff || "").split(/\r?\n/)) {
    let m = line.match(/^([AMDTUX]|[RC]\d*)\t(.+?)(?:\t(.+))?$/);
    if (m) { set.add(norm(m[3] || m[2])); continue; }
    m = line.match(/^ (.+?)\s+\|\s+(\d+|Bin)\b/);
    if (m) { const p = norm(m[1].replace(/^.*=> /, "").replace(/[{}]/g, "")); if (p && !p.includes("...")) set.add(p); continue; }
    m = line.match(/^diff --git a\/.+? b\/(.+)$/);
    if (m) set.add(norm(m[1]));
  }
  return [...set].filter(Boolean);
}

const same = (a, b) => a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
const AJENO = (p) => isSensitivePath(p) || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(p) || /^\.github\//.test(p);

export function check({ informe, diff }) {
  const real = parseChanged(diff);
  const dicho = (informe?.archivos_tocados || []).map(norm).filter(Boolean);
  const dijo_no_hizo = [], hizo_no_dijo = [], cambios_ajenos = [];
  for (const f of dicho) if (!real.some((r) => same(r, f))) dijo_no_hizo.push(`Dijo tocar ${f}, no aparece en el diff real`);
  for (const r of real) {
    if (dicho.some((f) => same(r, f))) continue;
    (AJENO(r) ? cambios_ajenos : hizo_no_dijo).push(AJENO(r) ? `${r} (cambio sensible no mencionado)` : `${r} modificado sin mencionarlo`);
  }
  if (!real.length && (informe?.dijo_hizo || []).length && !dicho.length && /^ok/i.test(informe?.resultado || "")) dijo_no_hizo.push("Dijo haber hecho cambios pero el diff real está vacío");
  if (/^fallo/i.test(informe?.resultado || "")) dijo_no_hizo.push(`El propio informe declara ${informe.resultado}`);
  return { dijo_no_hizo, hizo_no_dijo, cambios_ajenos, archivos_reales: real };
}

const ORDEN = ["aprobado", "corregir", "necesita_usuario"];
// Une la verificación de la IA con la determinista; el veredicto nunca mejora al más severo.
export function merge(det, ai) {
  const arr = (x) => (Array.isArray(x) ? x.map(String) : []);
  const uniq = (a) => [...new Set(a)];
  const v = { dijo_no_hizo: uniq([...det.dijo_no_hizo, ...arr(ai?.dijo_no_hizo)]), hizo_no_dijo: uniq([...det.hizo_no_dijo, ...arr(ai?.hizo_no_dijo)]), cambios_ajenos: uniq([...det.cambios_ajenos, ...arr(ai?.cambios_ajenos)]) };
  let sev = Math.max(0, ORDEN.indexOf(ai?.veredicto));
  if (!ai) sev = Math.max(sev, 1); // sin verificación legible de la IA no se aprueba solo
  if (v.dijo_no_hizo.length) sev = Math.max(sev, 1);
  if (v.cambios_ajenos.length && !ai) sev = Math.max(sev, 1);
  v.veredicto = ORDEN[sev];
  return v;
}
