// Scripts DOM FIJOS del Navegador de Jarvis. Se inyectan con executeJavaScriptInIsolatedWorld.
// Reglas (se comprueban en test/browser-desktop.test.js):
//   - PREPARAR solo escribe el texto en la caja de entrada: no hace clic, no envía, no pulsa Enter.
//   - Nada de lo que leen es orden: devuelven datos planos. El texto de la página nunca se evalúa.
//   - Los selectores vienen de desktop/browser/selectors.json (calibrables por sitio). Los datos van como JSON.
// Cada función es autocontenida (sin cierres) para poder pasarla como texto a la página.

// Devuelve: "bloqueado" | "necesita_login" | "sesion_ok" | "sin_selector"
export function detectar(doc, sel) {
  const q = (s) => { try { return doc.querySelector(s); } catch { return null; } };
  const hay = (lista) => (lista || []).some((s) => q(s));
  const texto = String((doc.body && doc.body.innerText) || "").slice(0, 1500).toLowerCase();
  const titulo = String(doc.title || "").toLowerCase();
  const input = (sel.input || []).map(q).find(Boolean);
  // 1) Bloqueos estructurales: captcha, desafío de Cloudflare, 2FA y avisos de cuenta (selectores calibrables).
  if (hay(sel.bloqueo) || hay(sel.aviso)) return "bloqueado";
  // 2) Sin caja de entrada: se mira el texto de la página (si hay caja, una conversación sobre "captcha" no cuenta).
  if (!input) {
    const t = titulo + " " + texto;
    if (/captcha|verify you are human|verifica que eres humano|just a moment|un momento|checking your browser|cloudflare|two-factor|verification code|c[oó]digo de verificaci[oó]n|autenticaci[oó]n en dos pasos|account (suspended|locked)|cuenta (suspendida|bloqueada)|usage limit|l[ií]mite de uso/.test(t)) return "bloqueado";
    if (hay(sel.login) || q('input[type="password"]') || /log ?in|sign ?in|iniciar sesi[oó]n|acceder|continue with|continuar con/.test(t)) return "necesita_login";
    return "sin_selector";
  }
  return "sesion_ok";
}

// Escribe `texto` en la caja de entrada SIN enviarlo. Devuelve { ok, motivo }.
export function preparar(doc, sel, texto) {
  const el = (sel.input || []).map((s) => { try { return doc.querySelector(s); } catch { return null; } }).find(Boolean);
  if (!el) return { ok: false, motivo: "sin_caja" };
  el.focus && el.focus();
  const Ev = (doc.defaultView && doc.defaultView.Event) || Event;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "INPUT") {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, texto); else el.value = texto;
    el.dispatchEvent(new Ev("input", { bubbles: true }));
    el.dispatchEvent(new Ev("change", { bubbles: true }));
    return el.value === texto ? { ok: true } : { ok: false, motivo: "no_inserto" };
  }
  // Caja editable (contenteditable): se reemplaza el contenido y se avisa a la página.
  let hecho = false;
  try {
    const sel2 = doc.getSelection && doc.getSelection();
    if (sel2 && doc.createRange) { const r = doc.createRange(); r.selectNodeContents(el); sel2.removeAllRanges(); sel2.addRange(r); }
    hecho = !!(doc.execCommand && doc.execCommand("insertText", false, texto));
  } catch { hecho = false; }
  if (!hecho || String(el.innerText || el.textContent || "").trim() !== texto.trim()) {
    el.textContent = texto;
    el.dispatchEvent(new Ev("input", { bubbles: true }));
  }
  return String(el.innerText || el.textContent || "").trim() === texto.trim() ? { ok: true } : { ok: false, motivo: "no_inserto" };
}

// Lee el último mensaje de respuesta y si el sitio sigue generando. Solo datos planos.
export function leer(doc, sel) {
  const q = (s) => { try { return doc.querySelector(s); } catch { return null; } };
  const ocupado = (sel.ocupado || []).some((s) => q(s));
  let nodos = [];
  for (const s of sel.respuesta || []) { try { nodos = Array.from(doc.querySelectorAll(s)); } catch { nodos = []; } if (nodos.length) break; }
  const ultimo = nodos[nodos.length - 1];
  return { ocupado, n: nodos.length, texto: ultimo ? String(ultimo.innerText || ultimo.textContent || "").slice(0, 20000) : "" };
}

// Construye el texto de un script: la función + sus argumentos como JSON (nunca concatenando texto de páginas).
export const construir = (fn, ...args) => `(${fn.toString()})(document, ${args.map((a) => JSON.stringify(a)).join(", ")})`;
export const scriptDetectar = (sel) => construir(detectar, sel);
export const scriptPreparar = (sel, texto) => construir(preparar, sel, texto);
export const scriptLeer = (sel) => construir(leer, sel);
