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

const TAGS = { directo: "Directo a Claude", preparar: "Preparada" };
const ESTADOS = { pendiente: "en cola", por_revisar: "por revisar", reclamada: "enviada a Claude", en_curso: "en ejecución" };

// onAction(kind, id): "borrar" | "enviar"
export function renderQueue(status, onAction) {
  const box = $("queue");
  box.replaceChildren();
  const items = status?.queue?.items || [];
  $("qcount").textContent = items.length;
  if (!items.length) { box.append(el("div", "empty", "Cola vacía. Claude ya recibió todo.")); return; }
  for (const q of items) {
    const t = el("div", "task");
    t.append(el("span", "tag" + (q.mode === "directo" ? " direct" : ""), TAGS[q.mode] || q.mode));
    t.append(el("p", "", q.text));
    const por = q.mode === "directo" ? "se envía tal cual" : `${q.pasos} pasos${q.por ? " · ordenada por " + q.por : ""}`;
    t.append(el("small", "", `${ESTADOS[q.status] || q.status} · ${por} · ${hora(q.at)}`));
    if (q.status === "pendiente" || q.status === "por_revisar") {
      const acts = el("div", "acts");
      if (q.status === "por_revisar") { const b = el("button", "", "Enviar al PC"); b.type = "button"; b.onclick = () => onAction("enviar", q.id); acts.append(b); }
      const d = el("button", "", "Borrar"); d.type = "button"; d.onclick = () => onAction("borrar", q.id); acts.append(d);
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
