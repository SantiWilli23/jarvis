// Barra lateral del escritorio: secciones Estudiar y Chats (Jarvis y Pro las maneja pro.js) y el cajón "Más".
const $ = (id) => document.getElementById(id);
const SECCIONES = ["estudiar", "chats"];
let activa = null;

const avisar = (vista) => window.dispatchEvent(new CustomEvent("jarvis:vista", { detail: { vista } })); // chats.js y estudiar.js cargan al abrirse
function marcar(id, si) { const t = $(id); t.setAttribute("aria-selected", String(si)); t.tabIndex = si ? 0 : -1; }

function cerrarSeccion() {
  if (!activa) return;
  $("vista-" + activa).hidden = true; marcar("tab-" + activa, false);
  activa = null; avisar("clasico");
}
function abrirSeccion(nombre) {
  if (!activa) $("tab-clasico").click(); // pro.js sale de Pro y apaga su micrófono
  for (const n of SECCIONES) { $("vista-" + n).hidden = n !== nombre; marcar("tab-" + n, n === nombre); }
  $("vista-clasico").hidden = true; $("vista-pro").hidden = true; $("pro-motivos").hidden = true;
  marcar("tab-clasico", false); marcar("tab-pro", false);
  activa = nombre; avisar(nombre);
}
for (const n of SECCIONES) $("tab-" + n).addEventListener("click", () => abrirSeccion(n));
// Si pro.js muestra Jarvis o Pro (pestaña, o enlace #pro/<id>), la sección propia se cierra.
const obs = new MutationObserver(() => { if (!$("vista-clasico").hidden || !$("vista-pro").hidden) cerrarSeccion(); });
for (const id of ["vista-clasico", "vista-pro"]) obs.observe($(id), { attributes: true, attributeFilter: ["hidden"] });

// Teclado de la barra vertical (en captura: así no actúa el de pestañas horizontales de pro.js).
const rail = document.querySelector(".rail");
rail.addEventListener("keydown", (e) => {
  const tabs = [...rail.querySelectorAll('[role="tab"]')], i = tabs.indexOf(e.target);
  const paso = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (i < 0 || (!paso && e.key !== "Home" && e.key !== "End")) return;
  e.preventDefault(); e.stopPropagation();
  const t = e.key === "Home" ? tabs[0] : e.key === "End" ? tabs.at(-1) : tabs[(i + paso + tabs.length) % tabs.length];
  t.focus(); t.click();
}, true);

/* ---------- Más ---------- */
const fondo = [rail, $("main"), $("envivo")];
function mas(abrir) {
  if ($("mas").hidden !== abrir) return;
  $("mas").hidden = !abrir; $("masscrim").hidden = !abrir;
  $("masbtn").setAttribute("aria-expanded", String(abrir));
  for (const x of fondo) x.inert = abrir;
  (abrir ? $("mascerrar") : $("masbtn")).focus();
}
$("masbtn").addEventListener("click", () => mas(true));
$("mascerrar").addEventListener("click", () => mas(false));
$("masscrim").addEventListener("click", () => mas(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") mas(false); });
new MutationObserver(() => { if (!$("login").hidden) mas(false); }).observe($("login"), { attributes: true, attributeFilter: ["hidden"] });

// Insignia: cuántas tareas hay en la cola (visible con "Más" cerrado). Los permisos salen en su propia tarjeta.
function insignia() {
  const n = Number($("qcount").textContent) || 0;
  $("masbadge").textContent = n; $("masbadge").hidden = !n;
}
new MutationObserver(insignia).observe($("qcount"), { childList: true, characterData: true, subtree: true });
insignia();
