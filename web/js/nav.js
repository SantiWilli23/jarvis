// Navegador de Claude: pinta la respuesta (nav.done). Todo lo leído de la web va con textContent, nunca como HTML.
const caja = () => document.querySelector(".say");

export function limpiarFuentes() {
  caja()?.querySelector(".navfuentes")?.remove();
  document.getElementById("txt")?.classList.remove("nav");
}

export function pintarNav(task) {
  const txt = document.getElementById("txt");
  if (!txt) return;
  txt.classList.add("nav");
  txt.textContent = task.respuesta || "";
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
