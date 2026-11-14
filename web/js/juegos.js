// Juegos: botones discretos de acceso rápido y apertura de pestaña para la orden "abre <juego>" (sin IA).
// Misma lista que server/games.js (una prueba comprueba que coinciden).
export const JUEGOS = [
  { id: "futotal", nombre: "Futotal", url: "https://football-quiz-nod2.onrender.com" },
  { id: "ski", nombre: "Ski Beta", url: "https://santiwilli23.github.io/ski-beta/" },
];
const root = () => (typeof document === "undefined" ? null : document.getElementById("juegos"));

function enlace(j) {
  const a = document.createElement("a");
  a.className = "juego-btn"; a.textContent = j.nombre; a.href = j.url; a.target = "_blank"; a.rel = "noopener noreferrer";
  return a;
}
function pintar(lista) {
  const r = root(); if (!r) return;
  r.replaceChildren(...lista.map(enlace));
}
pintar(JUEGOS);

if (typeof window !== "undefined") window.addEventListener("jarvis:juego", (ev) => {
  const d = ev.detail || {};
  const lista = d.juegos?.length ? d.juegos : JUEGOS;
  pintar(lista); // los botones quedan como respaldo si el navegador bloquea la pestaña automática
  for (const a of d.acciones || []) {
    if (a.tipo !== "abrir_url" || !/^https:\/\//.test(a.url || "")) continue;
    try { window.open(a.url, "_blank", "noopener,noreferrer"); } catch { /* bloqueado: queda el botón */ }
  }
});
