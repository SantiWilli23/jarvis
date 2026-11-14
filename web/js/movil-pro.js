// Pro web en el móvil (/m): hilos web, repo y rama, mensaje, prompt, copiar y abrir, candidatos y estado. Sin modo local.
// Todo el HTML sale de pro-web.js (escapado); aquí solo hay cableado.
import { api, getToken } from "./api.js";
import { esc, renderRondaWeb, renderRamaSelect, opcionesRepos, opcionesRamas, ramaPorDefecto, motivosWebTexto, webHabilitado, createWebCtl, errWeb, nombreDestino } from "./pro-web.js";

const $ = (id) => document.getElementById(id);
const S = { pro: null, repos: [], ramas: [], ramasHilo: [], hilos: [], actual: null, msgs: [], rondas: [], envios: [], error: "", abierto: false };
const ronda = () => [...S.rondas].sort((a, b) => b.id - a.id)[0] || null;
const ramasUrl = (full) => { const [o, r] = String(full).split("/"); return `/github/repos/${encodeURIComponent(o)}/${encodeURIComponent(r)}/branches`; };
const AUTOR = { usuario: "Usted", jarvis: "Jarvis" };

const ctl = createWebCtl({
  api, nav: navigator, win: window, doc: document, root: () => $("mpro-round"),
  hilo: () => ({ id: S.actual?.id, envios: S.envios }),
  recargar: () => (S.actual ? abrir(S.actual.id) : pintar()), error: (t) => { S.error = t; pintar(); },
});

export const renderHilosM = (hilos, actual) => (hilos.length
  ? hilos.map((t) => `<button type="button" class="hilo${t.id === actual ? " sel" : ""}" data-m="hilo" data-id="${esc(t.id)}"><b>${esc(t.title || "Hilo " + t.id)}</b><small>${esc(t.gh_repo || "")}${t.gh_rama ? " · " + esc(t.gh_rama) : ""}</small></button>`).join("")
  : '<p class="note">Aún no hay hilos. Cree uno eligiendo repositorio y rama.</p>');
export const renderMensajesM = (msgs) => msgs.filter((m) => m.kind !== "resultado").map((m) => `<div class="pm a-${esc(m.author)}"><b>${esc(AUTOR[m.author] || nombreDestino(m.author))}</b><div>${esc(m.text)}</div></div>`).join("");

async function estado() {
  try {
    const ps = await api("/pro/status"); S.pro = ps; S.error = "";
    if (webHabilitado(ps) && !S.repos.length) S.repos = (await api("/github/repos")).repos || [];
  } catch (e) { S.error = errWeb(e); }
}
async function ramasDe(full) { S.ramas = []; if (full?.includes("/")) { try { S.ramas = (await api(ramasUrl(full))).branches || []; } catch (e) { S.error = errWeb(e); } } }
async function hilos() { try { S.hilos = ((await api("/pro/threads")).threads || []).filter((t) => t.modo === "web"); } catch (e) { S.hilos = []; S.error = errWeb(e); } }
async function abrir(id) {
  try {
    const r = await api(`/pro/threads/${id}`);
    S.actual = r.thread || { id }; S.msgs = r.messages || []; S.rondas = r.rounds || []; S.envios = r.envios || []; S.error = "";
    S.ramasHilo = S.actual.gh_repo ? ((await api(ramasUrl(S.actual.gh_repo)).catch(() => ({}))).branches || []) : [];
  } catch (e) { S.error = errWeb(e); }
  pintar();
}

function pintar() {
  if (!$("mpro-round")) return;
  const ok = webHabilitado(S.pro), mot = ok ? [] : motivosWebTexto(S.pro);
  const aviso = S.error || mot.join(" ") || (S.pro ? "" : "Cargando…");
  $("mpro-aviso").textContent = aviso; $("mpro-aviso").hidden = !aviso;
  $("mpro-hilos").innerHTML = renderHilosM(S.hilos, S.actual?.id);
  $("mpro-newform").hidden = !ok;
  if (ok) {
    $("mpro-repo").innerHTML = opcionesRepos(S.repos, $("mpro-repo").value);
    $("mpro-rama").innerHTML = opcionesRamas(S.ramas, S.ramas.find((b) => b.name === $("mpro-rama").value)?.name || ramaPorDefecto(S.repos, $("mpro-repo").value));
  }
  const m = $("mpro-msgs"), abajo = m.scrollTop + m.clientHeight >= m.scrollHeight - 40;
  m.innerHTML = S.actual ? renderMensajesM(S.msgs) || '<p class="note">Hilo vacío. Cuente qué quiere hacer.</p>' : "";
  if (abajo) m.scrollTop = m.scrollHeight;
  const guardados = [...$("mpro-round").querySelectorAll("textarea")].map((t) => [t.id, t.value]);
  $("mpro-round").innerHTML = S.actual ? renderRamaSelect(S.actual, S.ramasHilo) + renderRondaWeb(ronda(), { thread: S.actual, msgs: S.msgs, envios: S.envios, web: S.pro?.web, estado: ctl.estado }) : "";
  for (const [id, v] of guardados) { const t = id && document.getElementById(id); if (t && !t.readOnly && v && v !== t.defaultValue) t.value = v; }
  const puede = ok && !!S.actual && ronda()?.status !== "traduciendo";
  $("mpro-in").disabled = !puede; $("mpro-send").disabled = !puede;
}

export async function proAbrir() {
  if (!getToken()) return;
  S.abierto = true; pintar();
  await estado();
  if (webHabilitado(S.pro)) { await ramasDe($("mpro-repo").value || S.repos[0]?.full_name); await hilos(); }
  pintar();
  if (!S.actual && S.hilos[0]) abrir(S.hilos[0].id);
}
export const proCerrar = () => { S.abierto = false; };

$("sh-pro").addEventListener("click", (e) => {
  const w = e.target.closest("[data-w]");
  if (w) { ctl.clic(w); return; } // síncrono: copiar y abrir debe ocurrir dentro del gesto del toque
  const h = e.target.closest("[data-m=hilo]");
  if (h) abrir(Number(h.dataset.id));
});
$("mpro-round").addEventListener("change", (e) => { if (e.target.dataset?.wChange === "rama") ctl.cambiarRama(e.target.value); });
$("mpro-repo").addEventListener("change", async () => { await ramasDe($("mpro-repo").value); $("mpro-rama").innerHTML = opcionesRamas(S.ramas, ramaPorDefecto(S.repos, $("mpro-repo").value)); });
$("mpro-newform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const gh_repo = $("mpro-repo").value, gh_rama = $("mpro-rama").value;
  if (!gh_repo || !gh_rama) { S.error = "Elija un repositorio y una rama."; return pintar(); }
  try {
    const r = await api("/pro/threads", { method: "POST", body: { modo: "web", gh_repo, gh_rama, title: $("mpro-title").value.trim() || undefined } });
    $("mpro-title").value = ""; await hilos(); await abrir((r.thread || r).id);
  } catch (x) { S.error = errWeb(x); pintar(); }
});
$("mpro-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("mpro-in").value.trim(); if (!text || !S.actual) return;
  $("mpro-in").value = "";
  try { await api(`/pro/threads/${S.actual.id}/messages`, { method: "POST", body: { text } }); S.error = ""; } catch (x) { S.error = errWeb(x); $("mpro-in").value = text; }
  abrir(S.actual.id);
});
window.addEventListener("jarvis:ws", (ev) => {
  const m = ev.detail;
  if (!S.abierto || !m?.type?.startsWith("pro.") || m.type === "pro.status") return;
  if (S.actual && (!m.thread_id || m.thread_id === S.actual.id)) abrir(S.actual.id);
});
