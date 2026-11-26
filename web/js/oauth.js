// Consentimiento OAuth del conector MCP. Todo por fetch del mismo origen.
const $ = (id) => document.getElementById(id);
const pedido = Object.fromEntries(new URLSearchParams(location.search));
const BASE = { "x-requested-with": "jarvis" };
let csrf = "";
let conToken = true;

function cabeceras() {
  const h = { ...BASE };
  try { const t = conToken && localStorage.getItem("jarvis_token"); if (t) h.authorization = `Bearer ${t}`; } catch { /* sin almacenamiento */ }
  return h;
}

async function cargar() {
  const url = `/oauth/info${location.search}`;
  conToken = true;
  let r = await fetch(url, { headers: cabeceras(), cache: "no-store" });
  // Un token guardado ya caducado no debe tapar una cookie válida.
  if (r.status === 401) { conToken = false; r = await fetch(url, { headers: cabeceras(), cache: "no-store" }); }
  $("login").hidden = r.status !== 401;
  $("consent").hidden = !r.ok;
  if (r.status === 401) { $("msg").textContent = "Inicie sesión para continuar."; return; }
  if (!r.ok) { $("msg").textContent = "La solicitud de conexión no es válida."; return; }
  const d = await r.json();
  csrf = d.csrf;
  $("cliente").textContent = d.cliente; $("cid").textContent = d.client_id; $("redir").textContent = d.redirect_uri;
  $("msg").textContent = "";
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/api/auth/login", { method: "POST", headers: { ...BASE, "content-type": "application/json" }, body: JSON.stringify({ password: $("pw").value, deviceName: "Autorizar conector" }) });
  $("pw").value = "";
  if (!r.ok) { $("msg").textContent = r.status === 429 ? "Demasiados intentos; espere un rato." : "Contraseña incorrecta."; return; }
  await cargar();
});

async function decidir(aprobar) {
  $("si").disabled = $("no").disabled = true;
  const r = await fetch("/oauth/approve", { method: "POST", headers: { ...cabeceras(), "content-type": "application/json" }, body: JSON.stringify({ ...pedido, csrf, aprobar }) });
  if (!r.ok) { $("msg").textContent = "No se pudo completar. Recargue la página."; return; }
  location.assign((await r.json()).redirect);
}
$("si").addEventListener("click", () => decidir(true));
$("no").addEventListener("click", () => decidir(false));
cargar().catch(() => { $("msg").textContent = "No hay conexión con Jarvis."; });
