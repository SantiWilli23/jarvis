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

export function renderModels(status, activeId) {
  const box = $("models");
  box.replaceChildren();
  if (!status) return;
  $("keyless").textContent = status.keyless ? "sin claves · pruebas" : "";
  const filas = status.providers.filter((p) => p.en_cadena || p.estado !== "apagado");
  for (const p of filas) box.append(modelRow(p, activeId === p.id || p.activo && !activeId));
  for (const p of status.puestos) {
    box.append(modelRow({ nombre: p.nombre, rol: p.rol, estado: p.pc ? (p.estado === "activo" ? "activo" : "pc_apagado") : "apagado" }, false));
  }
}

function modelRow(p, active) {
  const tope = p.limite_dia;
  const pct = tope ? Math.min(100, Math.round((p.usado_dia / tope) * 100)) : 0;
  const dead = p.estado === "pausado";
  const off = p.estado === "apagado" || p.estado === "sin_clave" || p.estado === "pc_apagado";
  const row = el("div", "model" + (active ? " active" : "") + (dead ? " dead" : "") + (off ? " off" : ""));
  const r1 = el("div", "row");
  let derecha;
  if (p.estado === "pausado") derecha = p.pausado_hasta ? `pausado hasta ${hora(p.pausado_hasta)}` : "límite";
  else if (p.estado === "sin_clave") derecha = "sin clave";
  else if (p.estado === "apagado") derecha = "apagado";
  else if (p.estado === "pc_apagado") derecha = "PC apagado";
  else derecha = tope ? `${p.usado_dia} / ${tope}` : `${p.usado_dia} hoy`;
  r1.append(el("span", "", p.nombre), el("span", dead ? "pause" : "", derecha));
  row.append(r1, el("div", "role", p.rol || ""));
  const bar = el("div", "bar"), fill = el("i", pct > 85 || dead ? "warn" : "");
  fill.style.width = (dead ? 100 : pct) + "%";
  bar.append(fill); row.append(bar);
  return row;
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

export function renderConn(status) {
  const box = $("conn");
  box.replaceChildren();
  for (const c of status?.connections || []) {
    const d = el("div");
    d.append(el("i", "dot" + (c.ok ? " on" : "")), document.createTextNode(c.nombre));
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

// Panel "Voz": consumo de Gemini TTS (pedidos) y MiniMax (caracteres) del día.
export function renderVoice(status) {
  const box = $("voz");
  if (!box) return;
  box.replaceChildren();
  const v = status?.voz;
  if (!v) return;
  const fila = (nombre, activo, usado, tope, unidad) => {
    const row = el("div", "model" + (activo ? "" : " off"));
    const r1 = el("div", "row");
    r1.append(el("span", "", nombre), el("span", "", activo ? `${usado} / ${tope} ${unidad}` : "apagado"));
    const bar = el("div", "bar"), fill = el("i", tope && usado / tope > 0.85 ? "warn" : "");
    fill.style.width = (tope ? Math.min(100, Math.round((usado / tope) * 100)) : 0) + "%";
    bar.append(fill); row.append(r1, bar);
    return row;
  };
  box.append(fila("Gemini TTS", v.gemini.activo, v.gemini.usado, v.gemini.tope, "hoy"),
             fila("MiniMax", v.minimax.activo, v.minimax.usado_caracteres, v.minimax.tope_caracteres, "caract."));
}
