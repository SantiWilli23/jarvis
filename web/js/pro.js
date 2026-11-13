// Modo Pro: chat de tres (usuario, Claude, Gemini). Contrato en docs/PRO.md (§4 endpoints, §8 eventos ws).
// Las funciones de render son puras (devuelven HTML escapado) y se prueban sin navegador.
import { api, getToken, decideApproval, pendingApprovals } from "./api.js";

export const MOTIVOS = {
  pc_apagado: "El PC está apagado o sin conexión.",
  claude_no_listo: "Claude no está listo en el PC.",
  gemini_sin_login: "Gemini no tiene la sesión iniciada en el PC.",
  sin_repos_git: "No hay ningún repositorio git en las carpetas permitidas.",
};
export const AUTORES = { usuario: "Usted", jarvis: "Jarvis", claude: "Claude", gemini: "Gemini" };
export const ESTADOS = {
  planeando: "Planeando", esperando_aprobacion: "Esperando su aprobación", programando: "Programando", verificando: "Verificando",
  corrigiendo: "Corrigiendo", coordinando: "Jarvis coordina", conversando: "Esperando su respuesta", hecha: "Hecha", necesita_usuario: "Necesita su decisión", fallida: "Fallida", cancelada: "Cancelada",
};
const VIVOS = new Set(["coordinando", "planeando", "programando", "verificando", "corrigiendo"]);
export const MAX_CORR = 2;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const lista = (a) => (Array.isArray(a) ? a : []);

export const motivosTexto = (pro) => lista(pro?.motivos).map((m) => MOTIVOS[m] || m);
export const rondaViva = (r) => !!r && VIVOS.has(r.status);

// Qué motor y modelo trabaja ahora (tabla de modelos de PRO.md §2). `ultimo` = autor del último delta.
export function trabajador(ronda, ultimo) {
  if (!rondaViva(ronda)) return null;
  const prog = ronda.programmer || "claude";
  const ver = ronda.verifier || (prog === "claude" ? "gemini" : "claude");
  const m = (e, rol) => (e === "claude" ? (rol === "programar" ? "sonnet" : "opus") : (rol === "programar" ? "gemini-3.8-flash-medium" : "gemini-3.8-flash-high"));
  if (ronda.status === "coordinando") return { engine: "jarvis", modelo: "gpt-oss-120b", rol: "coordina" };
  if (ronda.status === "planeando") { const e = ultimo === "gemini" || ultimo === "claude" ? ultimo : prog; return { engine: e, modelo: m(e, "planear"), rol: "planea" }; }
  if (ronda.status === "verificando") return { engine: ver, modelo: m(ver, "verificar"), rol: "verifica" };
  return { engine: prog, modelo: m(prog, "programar"), rol: ronda.status === "corrigiendo" ? "corrige" : "programa" };
}

function cuerpo(msg) {
  const m = msg.meta || {};
  for (const k of ["body", "informe", "verificacion"]) if (m[k] && typeof m[k] === "object") return m[k];
  try { const j = JSON.parse(msg.text); if (j && typeof j === "object") return j; } catch { /* texto normal */ }
  return null;
}
const ul = (a, cls) => (lista(a).length ? `<ul class="${cls || ""}">${lista(a).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");

export function renderInforme(b) {
  b = b || {};
  return `<div class="rep"><h4>Informe de quien programó</h4>
    ${lista(b.dijo_hizo).length ? `<p class="lbl">Dice que hizo</p>${ul(b.dijo_hizo)}` : ""}
    ${lista(b.archivos_tocados).length ? `<p class="lbl">Archivos tocados</p>${ul(b.archivos_tocados, "mono")}` : ""}
    ${lista(b.comandos).length ? `<p class="lbl">Comandos</p>${ul(b.comandos, "mono")}` : ""}
    ${b.resultado ? `<p class="res">Resultado: <b>${esc(b.resultado)}</b></p>` : ""}</div>`;
}
export function renderVerificacion(b) {
  b = b || {};
  const sec = (clave, titulo, cls) => (lista(b[clave]).length ? `<div class="hl ${cls}"><p class="lbl">${titulo}</p>${ul(b[clave])}</div>` : "");
  const v = String(b.veredicto || "").split(/\s/)[0];
  const limpio = !lista(b.dijo_no_hizo).length && !lista(b.hizo_no_dijo).length && !lista(b.cambios_ajenos).length;
  return `<div class="rep ver"><h4>Verificación del otro motor${v ? ` <span class="veredicto v-${esc(v)}">${esc(b.veredicto)}</span>` : ""}</h4>
    ${sec("dijo_no_hizo", "Dijo y no hizo", "h-nohizo")}${sec("hizo_no_dijo", "Hizo y no dijo", "h-nodijo")}${sec("cambios_ajenos", "Cambios ajenos al pedido", "h-ajeno")}
    ${limpio ? '<p class="ok">Lo dicho coincide con lo cambiado.</p>' : ""}</div>`;
}
// Diff: líneas name-status (M\tarchivo) y --stat.
export function renderDiff(diff) {
  if (!diff) return '<p class="vacio">Sin diff.</p>';
  const lineas = String(diff).split("\n").map((l) => {
    const m = /^([AMDRCT]\d*)\t(.+)$/.exec(l);
    if (m) return `<div class="df df-${esc(m[1][0])}"><b>${esc(m[1])}</b> ${esc(m[2])}</div>`;
    if (/\|\s+\d+/.test(l) || /files? changed/.test(l)) return `<div class="df st">${esc(l)}</div>`;
    return l.trim() ? `<div class="df">${esc(l)}</div>` : "";
  });
  return `<div class="diff" role="group" aria-label="Diff real del repositorio">${lineas.join("")}</div>`;
}

// Conversación entre IAs (consultas de Jarvis a Claude/Gemini): plegada; el pedido original nunca se pliega.
export function renderConsulta(msg) {
  const n = AUTORES[msg.author] || msg.author, quien = msg.meta?.pregunta ? `Jarvis pregunta a ${AUTORES[msg.meta.a] || msg.meta.a}` : `${n} responde a Jarvis`;
  return `<details class="msg a-${esc(msg.author)} k-consulta" data-id="${esc(msg.id ?? "")}"><summary>${esc(quien)} (consulta, solo lectura)</summary><div class="txt">${esc(msg.text)}</div></details>`;
}
export function renderPropuesta(msg, viva) {
  const m = msg.meta || {}, rid = esc(msg.round_id ?? "");
  const btn = (motor, txt, cls) => `<button type="button" class="${cls}" data-act="iniciar" data-round="${rid}" data-motor="${esc(motor)}">${txt}</button>`;
  const otro = m.programador === "claude" ? "gemini" : "claude";
  return `<article class="msg a-jarvis k-propuesta" data-id="${esc(msg.id ?? "")}"><header><b class="who">Jarvis propone</b></header><div class="txt">${esc(msg.text)}</div>
    <p class="lbl">Programa ${esc(AUTORES[m.programador] || m.programador)} · verifica ${esc(AUTORES[m.verificador] || m.verificador)}</p>${m.nota ? `<p class="lbl">Nota del coordinador: ${esc(m.nota)}</p>` : ""}
    ${viva ? `<div class="btns">${btn(m.programador, "Aprobar propuesta", "yes")}${btn(otro, "Cambiar: programa " + (AUTORES[otro] || otro), "")}</div>` : ""}</article>`;
}

export function renderMensaje(msg, { propuestaViva = false } = {}) {
  const a = msg.author || "jarvis", n = AUTORES[a] || a, k = msg.kind || "texto";
  if (k === "consulta") return renderConsulta(msg);
  if (k === "propuesta") return renderPropuesta(msg, propuestaViva);
  let inner;
  if (k === "informe") inner = renderInforme(cuerpo(msg) || {});
  else if (k === "verificacion") inner = renderVerificacion(cuerpo(msg) || {});
  else if (k === "plan") inner = `<span class="tag">Plan</span><div class="txt">${esc(msg.text)}</div>`;
  else inner = `<div class="txt">${esc(msg.text)}</div>`;
  const jid = msg.meta?.job_id;
  const verDiff = (k === "informe" || k === "verificacion") && jid ? `<button type="button" class="mini" data-act="diff" data-job="${esc(jid)}">Ver diff</button><div class="diffbox" data-diffbox="${esc(jid)}"></div>` : "";
  return `<article class="msg a-${esc(a)} k-${esc(k)}" data-id="${esc(msg.id ?? "")}"><header><b class="who">${esc(n)}</b></header>${inner}${verDiff}</article>`;
}
export function renderVivo(v) {
  return `<article class="msg a-${esc(v.author)} k-vivo" aria-busy="true"><header><b class="who working">${esc(AUTORES[v.author] || v.author)}</b></header><div class="txt">${esc(v.text)}</div></article>`;
}

export function renderRonda(r, msgs, aprobaciones) {
  if (!r) return "";
  const plan = [...(msgs || [])].reverse().find((m) => m.kind === "plan" && (!m.round_id || m.round_id === r.id));
  const btn = (accion, txt, cls) => `<button type="button" class="${cls || ""}" data-act="decidir" data-accion="${accion}" data-round="${esc(r.id)}">${txt}</button>`;
  let h = `<div class="round st-${esc(r.status)}"><div class="rh"><b>${esc(ESTADOS[r.status] || r.status)}</b><span class="cnt" aria-label="Correcciones automáticas usadas">Correcciones ${Number(r.corrections) || 0}/${MAX_CORR}</span></div>`;
  if (r.summary) h += `<p class="sum">${esc(r.summary)}</p>`;
  if (r.status === "esperando_aprobacion") {
    h += `<label for="plan-edit">Plan (puede editarlo antes de aprobar)</label><textarea id="plan-edit" rows="6" maxlength="8000">${esc(plan?.text || "")}</textarea>
      <div class="btns">${btn("aprobar", "Aprobar y programar", "yes")}${btn("rechazar", "Rechazar")}</div>`;
  } else if (r.status === "necesita_usuario" || r.status === "hecha") {
    h += `<div class="btns">${btn("aprobar", "Aceptar ronda (commit local)", "yes")}</div>
      <label for="corr-text">Pedir corrección (reinicia el contador de ${MAX_CORR})</label><textarea id="corr-text" rows="3" maxlength="4000" placeholder="¿Qué hay que corregir?"></textarea>
      <div class="btns">${btn("corregir", "Pedir corrección")}</div>`;
  }
  if (rondaViva(r)) h += `<div class="btns"><button type="button" data-act="cancelar" data-round="${esc(r.id)}">Cancelar ronda</button></div>`;
  for (const a of aprobaciones || []) h += renderAprobacion(a);
  return h + "</div>";
}
export function renderAprobacion(a) {
  return `<div class="apr" role="alertdialog" aria-label="Aprobación de comando"><div class="k">${esc(a.summary || a.kind || "Permiso")}</div><code>${esc(a.detail || "")}</code>
    <div class="btns"><button type="button" data-act="aprobacion" data-id="${esc(a.id)}" data-ok="0">Rechazar</button><button type="button" class="yes" data-act="aprobacion" data-id="${esc(a.id)}" data-ok="1">Aprobar</button></div></div>`;
}
export function renderBloqueo(pro) {
  const m = motivosTexto(pro);
  return `<p class="blk-t">Modo Pro no disponible</p>${m.length ? `<ul>${m.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p>Sin conexión con el servidor.</p>"}`;
}
export function renderHilos(hilos, actual) {
  if (!hilos.length) return '<p class="vacio">Aún no hay hilos. Cree uno eligiendo un repositorio.</p>';
  return hilos.map((t) => `<button type="button" class="hilo${t.id === actual ? " sel" : ""}" data-act="hilo" data-id="${esc(t.id)}" aria-current="${t.id === actual}"><b>${esc(t.title || "Hilo " + t.id)}</b><span>${esc(String(t.repo || "").split(/[\\/]/).pop())}</span></button>`).join("");
}

/* ---------------- UI (solo navegador) ---------------- */
const S = { coord: null, pro: null, repos: [], hilos: [], actual: null, msgs: [], rondas: [], vivos: new Map(), ultimo: null, aprobs: [], error: "", cargado: false };
const $ = (id) => document.getElementById(id);
const ronda = () => [...S.rondas].sort((a, b) => b.id - a.id)[0] || null;
const errTexto = (e) => (e.status === 409 ? "Modo Pro no está habilitado ahora mismo." : e.status === 422 ? "Ese mensaje es privado y no puede ir a Pro." : e.status === 503 || e.status === 502 ? "El PC está apagado o el servidor dormido; reintente en unos segundos." : e.message || "Error");

async function cargarEstado() {
  try {
    const st = await api("/status");
    S.pro = st.pro || { habilitado: false, motivos: [] };
    const caps = st.pc?.capabilities || st.pro?.capabilities || {};
    S.repos = lista(caps.repos).length ? caps.repos : lista(st.pro?.repos);
    S.error = "";
    S.coord = await api("/pro/coordinador").catch(() => S.coord);
  } catch (e) { S.pro = S.pro || { habilitado: false, motivos: [] }; S.error = e.status === 401 ? "" : "No hay conexión con el servidor (puede estar despertando)."; }
  pestanas();
}
async function cargarHilos() {
  try { S.hilos = (await api("/pro/threads")).threads || []; } catch (e) { S.hilos = []; if (e.status !== 404) S.error = errTexto(e); }
  if (!S.actual && S.hilos[0]) await abrirHilo(S.hilos[0].id); else pintar();
}
async function abrirHilo(id) {
  try {
    const r = await api(`/pro/threads/${id}`);
    S.actual = r.thread || { id }; S.msgs = r.messages || []; S.rondas = r.rounds || []; S.vivos.clear(); S.error = "";
    try { S.aprobs = ((await pendingApprovals()).approvals || []).filter((a) => a.pro_job_id); } catch { S.aprobs = []; }
  } catch (e) { S.error = errTexto(e); }
  pintar();
}

function pestanas() {
  const tp = $("tab-pro"); if (!tp) return;
  const ok = !!S.pro?.habilitado;
  tp.setAttribute("aria-disabled", String(!ok));
  tp.classList.toggle("off", !ok);
  tp.title = ok ? "" : motivosTexto(S.pro).join(" ");
  const box = $("pro-motivos");
  box.innerHTML = ok ? "" : renderBloqueo(S.pro);
  if (ok) box.hidden = true;
  pintar();
}

function pintar() {
  const el = $("pro-main"); if (!el) return;
  const ok = !!S.pro?.habilitado, r = ronda(), sin = !S.actual;
  $("pro-aviso").textContent = S.error; $("pro-aviso").hidden = !S.error;
  $("pro-hilos").innerHTML = renderHilos(S.hilos, S.actual?.id);
  $("pro-repo").innerHTML = S.repos.map((p) => `<option value="${esc(p)}">${esc(String(p).split(/[\\/]/).pop())}</option>`).join("") || '<option value="">(sin repos)</option>';
  let h = sin ? '<p class="vacio">Elija o cree un hilo para hablar con Claude y Gemini.</p>' : (S.msgs.length || S.vivos.size ? "" : '<p class="vacio">Hilo vacío. Describa la tarea: se planea, usted aprueba, se programa y el otro motor verifica.</p>');
  const viva = r?.status === "conversando" ? [...S.msgs].reverse().find((m) => m.kind === "propuesta" && m.round_id === r.id)?.id : null;
  h += S.msgs.map((m) => renderMensaje(m, { propuestaViva: m.id === viva })).join("") + [...S.vivos.values()].map(renderVivo).join("");
  const abajo = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  el.innerHTML = h; if (abajo) el.scrollTop = el.scrollHeight;
  const t = trabajador(r, S.ultimo);
  $("pro-work").hidden = !t;
  $("pro-work").innerHTML = t ? `<span class="who working">${esc(AUTORES[t.engine])}</span> ${esc(t.rol)} · ${esc(t.modelo)}` : "";
  document.body.classList.toggle("pro-working", !!t);
  const keep = [$("plan-edit")?.value, $("corr-text")?.value];
  $("pro-round").innerHTML = renderRonda(r, S.msgs, S.aprobs);
  if (keep[0] && $("plan-edit")) $("plan-edit").value = keep[0];
  if (keep[1] && $("corr-text")) $("corr-text").value = keep[1];
  const puede = ok && !sin;
  const co = S.coord, sw = $("pro-coord");
  if (sw) { sw.checked = !!co?.activo; sw.disabled = !ok; $("pro-coord-txt").textContent = co && co.activo && !co.disponible ? "Jarvis coordina (sin clave de Groq: modo clásico)" : "Jarvis coordina"; }
  $("pro-send").disabled = !puede; $("pro-in").disabled = !puede;
  $("pro-in").placeholder = !ok ? "Pro no disponible" : sin ? "Cree un hilo primero" : "Describa la tarea…";
}

async function decidir(id, accion, text) {
  try { await api(`/pro/rounds/${id}/decision`, { method: "POST", body: { accion, ...(text ? { text } : {}) } }); S.error = ""; } catch (e) { S.error = errTexto(e); }
  if (S.actual) abrirHilo(S.actual.id);
}

function onClick(e) {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act;
  if (act === "hilo") abrirHilo(Number(b.dataset.id));
  else if (act === "decidir") {
    const accion = b.dataset.accion;
    const txt = accion === "aprobar" ? $("plan-edit")?.value.trim() : accion === "corregir" ? $("corr-text")?.value.trim() : "";
    if (accion === "corregir" && !txt) { $("corr-text")?.focus(); return; }
    decidir(b.dataset.round, accion, txt);
  } else if (act === "iniciar") api(`/pro/rounds/${b.dataset.round}/iniciar`, { method: "POST", body: { motor: b.dataset.motor } }).catch((x) => { S.error = errTexto(x); }).then(() => S.actual && abrirHilo(S.actual.id));
  else if (act === "cancelar") api(`/pro/rounds/${b.dataset.round}/cancel`, { method: "POST", body: {} }).catch((x) => { S.error = errTexto(x); pintar(); });
  else if (act === "aprobacion") decideApproval(Number(b.dataset.id), b.dataset.ok === "1").catch(() => {}).then(() => { S.aprobs = S.aprobs.filter((a) => String(a.id) !== b.dataset.id); pintar(); });
  else if (act === "diff") {
    const box = document.querySelector(`[data-diffbox="${b.dataset.job}"]`); if (!box) return;
    if (box.innerHTML) { box.innerHTML = ""; return; }
    box.textContent = "Cargando…";
    api(`/pro/jobs/${b.dataset.job}`).then((j) => { box.innerHTML = renderDiff(j.diff ?? j.job?.diff); }).catch((x) => { box.textContent = errTexto(x); });
  }
}

async function nuevoHilo(ev) {
  ev.preventDefault();
  const repo = $("pro-repo-txt").value.trim() || $("pro-repo").value;
  if (!repo) { S.error = "Elija un repositorio."; return pintar(); }
  try {
    const r = await api("/pro/threads", { method: "POST", body: { title: $("pro-title").value.trim() || undefined, repo } });
    $("pro-title").value = ""; $("pro-repo-txt").value = "";
    S.hilos = (await api("/pro/threads")).threads || S.hilos;
    await abrirHilo((r.thread || r).id);
  } catch (e) { S.error = errTexto(e); pintar(); }
}
async function enviar(ev) {
  ev.preventDefault();
  const text = $("pro-in").value.trim(); if (!text || !S.actual) return;
  $("pro-in").value = "";
  try { await api(`/pro/threads/${S.actual.id}/messages`, { method: "POST", body: { text } }); S.error = ""; } catch (e) { S.error = errTexto(e); $("pro-in").value = text; }
  abrirHilo(S.actual.id);
}

export function onWsPro(m) {
  if (!m || !m.type) return;
  if (m.type === "pro.status") { S.pro = { habilitado: !!m.habilitado, motivos: m.motivos || [] }; pestanas(); return; }
  if (m.type === "pc.status" || m.type === "providers.update") { cargarEstado(); return; }
  if (m.type === "approval.request" && m.approval?.pro_job_id) { S.aprobs = [...S.aprobs.filter((a) => a.id !== m.approval.id), m.approval]; pintar(); return; }
  if (m.type === "approval.resolved" && m.approval) { S.aprobs = S.aprobs.filter((a) => a.id !== m.approval.id); pintar(); return; }
  if (!m.type.startsWith("pro.")) return;
  if (!S.actual || (m.thread_id && m.thread_id !== S.actual.id)) { if (S.cargado) cargarHilos(); return; }
  if (m.type === "pro.delta") {
    const v = S.vivos.get(m.job_id) || { author: m.author, text: "" };
    v.text += m.text || ""; S.vivos.set(m.job_id, v); S.ultimo = m.author; pintar();
  } else if (m.type === "pro.message" && m.message) {
    for (const [k, v] of S.vivos) if (v.author === m.message.author) S.vivos.delete(k);
    if (!S.msgs.some((x) => x.id === m.message.id)) S.msgs.push(m.message);
    pintar();
  } else if (m.type === "pro.round" && m.round) {
    const i = S.rondas.findIndex((x) => x.id === m.round.id);
    if (i >= 0) S.rondas[i] = { ...S.rondas[i], ...m.round }; else S.rondas.push(m.round);
    pintar();
  }
}

function seleccionar(pro) {
  const tc = $("tab-clasico"), tp = $("tab-pro");
  if (pro && tp.getAttribute("aria-disabled") === "true") { $("pro-motivos").hidden = false; return; }
  tc.setAttribute("aria-selected", String(!pro)); tp.setAttribute("aria-selected", String(pro));
  tc.tabIndex = pro ? -1 : 0; tp.tabIndex = pro ? 0 : -1;
  $("vista-clasico").hidden = pro; $("vista-pro").hidden = !pro;
  try { localStorage.setItem("jarvis_pestana", pro ? "pro" : "clasico"); } catch { /* modo privado */ }
  if (pro) { if (!S.cargado) { S.cargado = true; cargarHilos(); } pintar(); }
}

function init() {
  if (!$("vista-pro")) return;
  $("tab-clasico").addEventListener("click", () => seleccionar(false));
  $("tab-pro").addEventListener("click", () => seleccionar(true));
  $("tablist").addEventListener("keydown", (e) => {
    if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
      const pro = e.key === "ArrowRight" || e.key === "End"; e.preventDefault();
      if (pro && $("tab-pro").getAttribute("aria-disabled") === "true") { $("pro-motivos").hidden = false; return; }
      seleccionar(pro); (pro ? $("tab-pro") : $("tab-clasico")).focus();
    }
  });
  $("vista-pro").addEventListener("click", onClick);
  $("pro-newform").addEventListener("submit", nuevoHilo);
  $("pro-form").addEventListener("submit", enviar);
  $("pro-coord")?.addEventListener("change", (e) => api("/pro/coordinador", { method: "POST", body: { activo: e.target.checked } }).then((c) => { S.coord = c; pintar(); }).catch((x) => { S.error = errTexto(x); cargarEstado(); }));
  const vistos = new WeakSet(); // main.js y ws.js despachan el mismo objeto: se procesa una sola vez
  window.addEventListener("jarvis:ws", (e) => { const d = e.detail; if (d && typeof d === "object") { if (vistos.has(d)) return; vistos.add(d); } onWsPro(d); });
  const arranque = () => cargarEstado().then(() => {
    let g = ""; try { g = localStorage.getItem("jarvis_pestana"); } catch { /* sin storage */ }
    if (g === "pro" && S.pro?.habilitado) seleccionar(true);
  });
  if (getToken()) arranque();
  setInterval(() => { if (getToken() && !document.hidden) cargarEstado(); }, 30000);
}
if (typeof document !== "undefined" && document.getElementById) init();
