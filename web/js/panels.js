// Paneles con datos reales de /api/status y del WebSocket.
// Todo texto que viene del servidor se inserta con textContent (nunca innerHTML).

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const hora = (ms) => new Date(ms).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

export function tickClock() {
  $("clock").textContent = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export function renderMemory(status) {
  if (!status) return;
  const m = status.memory;
  $("memtotal").textContent = m.total;
  $("mempriv").textContent = m.privadas;
  $("memrev").textContent = m.revision;
  $("membd").textContent = m.bd;
  $("memsync").textContent = m.ultima_sync_pc ? new Date(m.ultima_sync_pc).toLocaleString("es", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "nunca";
}

const motorDe = (q) => (q.engine === "gemini" ? "Gemini" : "Claude");
const etiqueta = (q) => (q.mode === "directo" ? `Directo a ${motorDe(q)}` : `Preparada · ${motorDe(q)}`);
const estadoDe = (q) => ({ pendiente: "en cola", por_revisar: "por revisar", reclamada: `enviada a ${motorDe(q)}`, en_curso: "en ejecución", fallida: "falló", rechazada: "sin permiso", interrumpida: "interrumpida" }[q.status] || q.status);
const REASIGNABLES = ["pendiente", "por_revisar", "fallida", "rechazada", "interrumpida"];

// onAction(kind, id): "borrar" | "enviar" | "claude" (Pasar a Claude)
export function renderQueue(status, onAction) {
  const box = $("queue");
  box.replaceChildren();
  const items = status?.queue?.items || [];
  $("qcount").textContent = items.length;
  if (!items.length) { box.append(el("div", "empty", "Cola vacía. El PC ya recibió todo.")); return; }
  for (const q of items) {
    const t = el("div", "task");
    t.append(el("span", "tag" + (q.mode === "directo" ? " direct" : "") + (q.engine === "gemini" ? " gemini" : ""), etiqueta(q)));
    t.append(el("p", "", q.text));
    const por = q.mode === "directo" ? "se envía tal cual" : `${q.pasos} pasos${q.por ? " · ordenada por " + q.por : ""}`;
    t.append(el("small", "", `${estadoDe(q)} · ${por} · ${hora(q.at)}`));
    if (q.res) t.append(el("small", "", q.res));
    if (REASIGNABLES.includes(q.status)) {
      const acts = el("div", "acts");
      if (q.engine === "gemini") { const c = el("button", "", "Pasar a Claude"); c.type = "button"; c.onclick = () => onAction("claude", q.id); acts.append(c); }
      if (q.status === "por_revisar") { const b = el("button", "", "Enviar al PC"); b.type = "button"; b.onclick = () => onAction("enviar", q.id); acts.append(b); }
      if (q.status === "pendiente" || q.status === "por_revisar") { const d = el("button", "", "Borrar"); d.type = "button"; d.onclick = () => onAction("borrar", q.id); acts.append(d); }
      t.append(acts);
    }
    box.append(t);
  }
}

// usedId: última conexión usada (persistente, solo una); working: true mientras trabaja (pulso).
export function renderConn(status, usedId, working = false) {
  const box = $("conn");
  box.replaceChildren();
  for (const c of status?.connections || []) {
    const used = !!usedId && c.id === usedId;
    const d = el("div", used ? (working ? "used active" : "used") : "");
    d.append(el("i", "dot" + (c.ok ? " on" : "")), el("span", "", c.nombre));
    box.append(d);
  }
}

export function renderPc(pc) {
  const on = !!pc?.online;
  $("pcdot").className = "dot " + (on ? "on" : "off");
  const t = pc?.current_task;
  $("pctext").textContent = !on ? "PC apagado · modo nube" : pc.paused ? "PC en línea · cola en pausa" : t ? `PC en línea · tarea #${t.seq}: ${t.preview || "trabajando"}`.slice(0, 80) : "PC en línea · esperando tareas";
}

// Tarjeta ámbar de permiso
export function showApproval(a) {
  $("permk").textContent = a ? "Claude pide permiso" : "";
  $("permcode").textContent = a?.summary || "";
  $("permp").textContent = a?.detail || "Esta acción necesita su aprobación.";
  $("perm").classList.toggle("show", !!a);
}
