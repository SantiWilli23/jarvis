// Redacción de secretos: todo texto que entra a Pro (prompts, informes, diffs, logs) pasa por aquí.
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const KNOWN = /\b(sk-ant-[\w-]{10,}|sk-[A-Za-z0-9_-]{16,}|AIza[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[\w]{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|gsk_[A-Za-z0-9]{20,}|glpat-[\w-]{16,})\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/gi;
const ENVLINE = /^([ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|CREDENTIAL|AUTH)[A-Za-z0-9_]*[ \t]*[=:][ \t]*)(["']?)([^\s"'#]+)\2/gim;
const PASSWORDY = /\b(contrase[ñn]a|password|passwd|clave|secret|token|api[_ -]?key)(\s*(?:es|is|=|:)\s*)(["']?)([^\s"']{4,})\3/gi;
const LONG = /\b[A-Za-z0-9_-]{32,}\b/g;

export const MASK = "[SECRETO]";
const isSha = (s) => /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(s);
const entropy = (s) => { const f = {}; for (const c of s) f[c] = (f[c] || 0) + 1; return -Object.values(f).reduce((a, n) => a + (n / s.length) * Math.log2(n / s.length), 0); };
// Un secreto "largo" es una cadena aleatoria: mezcla letras y dígitos y con entropía alta. Los identificadores de
// código (snake_case, kebab-case, camelCase de palabras) NO se tocan: destrozarlos arruina el prompt.
export function looksSecret(s) {
  if (isSha(s) || !/[A-Za-z]/.test(s) || !/\d/.test(s) || s.includes("/")) return false;
  const partes = s.split(/[_-]/).filter(Boolean);
  if (partes.length >= 3 && partes.every((p) => /^[A-Za-z]+\d{0,3}$/.test(p))) return false; // snake/kebab de palabras
  if (/^[a-z]+(?:[A-Z][a-z]+){3,}\d{0,3}$/.test(s)) return false; // camelCase de palabras
  if (/^[0-9a-f]+$/i.test(s)) return true; // hex largo (token, md5...)
  return entropy(s) >= 4.0;
}

export function redact(text) {
  if (text == null) return text;
  let t = String(text);
  t = t.replace(PEM, `[CLAVE PRIVADA ${MASK}]`);
  t = t.replace(KNOWN, MASK).replace(BEARER, (_m, k) => `${k} ${MASK}`);
  t = t.replace(ENVLINE, (_m, pre, q) => `${pre}${q}${MASK}${q}`);
  t = t.replace(PASSWORDY, (_m, k, sep, q) => `${k}${sep}${q}${MASK}${q}`);
  t = t.replace(LONG, (s) => (looksSecret(s) ? MASK : s));
  return t;
}

// Archivos que nunca se incluyen en prompts ni en el diff guardado (solo su nombre).
export const isSensitivePath = (p) => {
  const f = String(p || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
  return f === ".env" || f.startsWith(".env.") || f.endsWith(".pem") || f.endsWith(".key") || f.endsWith(".p12") || f === "id_rsa" || f === "id_ed25519";
};

// Quita los trozos de diff de archivos sensibles y redacta el resto; recorta al máximo.
export function cleanDiff(diff, max = 200000) {
  let d = String(diff || "");
  if (/^diff --git /m.test(d)) {
    const parts = d.split(/^(?=diff --git )/m);
    d = parts.map((p) => {
      const m = p.match(/^diff --git a\/(.+?) b\/(.+)$/m);
      return m && (isSensitivePath(m[1]) || isSensitivePath(m[2])) ? `diff --git a/${m[1]} b/${m[2]}\n[contenido omitido: archivo sensible]\n` : p;
    }).join("");
  }
  d = redact(d);
  return d.length > max ? d.slice(0, max) + "\n[... recortado]" : d;
}
