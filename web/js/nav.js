// Navegador de Claude: pinta la respuesta (nav.done). Todo lo leído de la web va con textContent, nunca como HTML.
const caja = () => document.querySelector(".say");

const SITIOS = { chatgpt: "ChatGPT", gemini: "Gemini", claude: "Claude", perplexity: "Perplexity", grok: "Grok", google: "Google", classroom: "Classroom", lirmi: "Lirmi" };
export const nombreSitio = (t) => String(t?.sitio_nombre || SITIOS[t?.sitio] || t?.sitio || "Navegador");
export const urlSegura = (u) => typeof u === "string" && /^https:\/\//i.test(u);

// Enlace con aspecto de botón; null si la dirección no es https.
export function botonEnlace(url, texto) {
  if (!urlSegura(url)) return null;
  const a = document.createElement("a");
  a.className = "boton"; a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = texto;
  return a;
}
// "Abrir en Pro": enlace interno #pro/<id>.
export function botonPro(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const a = document.createElement("a");
  a.className = "boton"; a.href = "#pro/" + n; a.textContent = "Abrir en Pro";
  return a;
}

export function limpiarFuentes() {
  caja()?.querySelector(".navfuentes")?.remove();
  caja()?.querySelector(".boton")?.remove();
  document.getElementById("txt")?.classList.remove("nav");
}

export function pintarNav(task) {
  const txt = document.getElementById("txt");
  if (!txt) return;
  txt.classList.add("nav");
  txt.textContent = task.respuesta || "";
  const abrir = botonEnlace(task.url_conversacion, "Abrir en " + nombreSitio(task));
  if (abrir) caja()?.append(abrir);
  const links = (task.fuentes || []).filter((f) => /^https?:\/\//i.test(f.url || ""));
  if (!links.length) return;
  const ul = document.createElement("ul");
  ul.className = "navfuentes";
  for (const f of links) {
    const a = document.createElement("a");
    a.href = f.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = f.titulo || f.url;
    const li = document.createElement("li");
    li.append(a); ul.append(li);
  }
  caja()?.append(ul);
}
