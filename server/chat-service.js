// Lógica de una conversación: la comparten /api/chat y /api/shortcut.
import { all, get, run } from "./db/client.js";
import { detectDirect } from "./queue/direct.js";
import { detectPedidoGemini } from "./router/pedido.js";
import { classify } from "./router/classify.js";
import { parsePhoneIntent, phoneReply } from "./phone/intents.js";
import { getModo } from "./settings.js";
import { detectDestino, stripDestino, parsePcIntent, interpretWithModel, pcReply, pcError } from "./pc/intents.js";

// Modo Chat: solo conversar. Sin búsqueda web, sin acciones ni tareas para el PC o el teléfono.
const PROMPT_MODO_CHAT = "\n\nMODO CHAT: el señor eligió que solo converse. Responda únicamente con texto: no busque en la web, no use herramientas ni ofrezca acciones (correo, calendario, Spotify, WhatsApp, teléfono) y no prepare ni encole tareas para el PC. Si le piden algo así, explique con amabilidad que está en modo Chat y que puede cambiarlo a IA en Configuración.";

const MSG_SIN_CUOTA = "Mis proveedores gratuitos llegaron a su límite por ahora, señor. Lo reintento en cuanto se reinicien. Si quiere, puede pedírselo a Gemini con /gemini.";

const MOTORES = ["auto", "flash", "gemini", "claude"]; // lista cerrada del selector del chat

export function createChatService({ db, router, privacy, search, tasks, prepare, bus, phone = null, pc = null, persona = "", webSearch = null, agent = null, now = () => Date.now() }) {
  async function ensureConversation(userId, id, firstText) {
    if (id) {
      const c = await get(db, "SELECT id FROM conversations WHERE id=? AND user_id=?", [id, userId]);
      if (c) return Number(c.id);
    }
    const r = await run(db, "INSERT INTO conversations (user_id, title, created_at) VALUES (?,?,?)", [userId, String(firstText).slice(0, 60), now()]);
    return r.id;
  }
  const saveMsg = (userId, conv, role, content, provider, priv) =>
    run(db, "INSERT INTO messages (user_id, conversation_id, role, content, provider, private, created_at) VALUES (?,?,?,?,?,?,?)",
      [userId, conv, role, content, provider || null, priv ? 1 : 0, now()]);
  const state = (userId, s, extra = {}) => bus?.emit("state", { userId, state: s, ...extra });

  return {
    // ¿El texto es privado? (marca, clasificador o notas privadas). Se usa ANTES de encolar algo.
    async checkPrivate({ userId, text, flagPrivate = false }) {
      const cls = classify(String(text ?? ""), { flagPrivate });
      const found = await search.search({ userId, query: String(text ?? ""), k: 4, tokenBudget: 600, includePrivate: true });
      return privacy.isPrivateMessage({ flag: flagPrivate, classification: cls, notes: found.notes });
    },
    async handle({ userId, text, conversationId, flagPrivate = false, source = "texto", engine = "auto", origen = null }) {
      const motor = MOTORES.includes(engine) ? engine : "auto";
      const chatSolo = (await getModo(db, userId)) === "chat"; // el servidor decide, no el cliente
      let original = String(text ?? "");
      if (!original.trim()) return { status: "vacio", reply: "No le oí nada, señor." };
      const conv = await ensureConversation(userId, conversationId, original);
      state(userId, "thinking");

      // 1) Directo a Claude: se guarda el texto exacto, sin modelo. "/gemini ..." (o "díselo a Gemini:") ya no encola:
      // se quita el prefijo y el texto se contesta normal, con el proveedor gemini (API) primero.
      let d = chatSolo ? { direct: false } : detectDirect(original);
      let prefer = null;
      if (d.direct && d.engine === "gemini") {
        if (!d.text.trim()) { state(userId, "idle"); return { status: "vacio", conversationId: conv, reply: "¿Qué quiere preguntarle a Gemini, señor?" }; }
        original = d.text; prefer = "gemini"; d = { direct: false };
      }
      if (!d.direct) {
        const pg = detectPedidoGemini(original);
        if (pg.pedido) { original = pg.text; prefer = "gemini"; }
        else if (motor === "gemini") prefer = "gemini";
      }
      if (d.direct) {
        if (!d.text.length) { state(userId, "idle"); return { status: "vacio", conversationId: conv, reply: "¿Qué quiere que le diga a Claude, señor?" }; }
        const task = await tasks.create({ userId, rawText: d.text, mode: "directo", engine: d.engine, header: { source } });
        const reply = `Anotado, señor. Lo dejé en cola, palabra por palabra, y se lo entrego a Claude en cuanto encienda su PC.`;
        await saveMsg(userId, conv, "user", original, null, false);
        await saveMsg(userId, conv, "assistant", reply, "cola", false);
        bus?.emit("chat.done", { userId, text: reply, provider: "cola" });
        state(userId, "speaking");
        return { status: "tarea", conversationId: conv, reply, task: { id: task.id, seq: task.seq, sha256: task.sha256, engine: task.engine } };
      }

      // 1b) Orden fija para el teléfono ("enciende la linterna", "brillo al 30"): sin modelo
      // Las órdenes del PC compiten con las del teléfono: si la frase nombra un dispositivo gana ese; si es ambigua
      // ("sube el volumen"), gana el dispositivo desde el que habla el señor (origen). Sin modelo salvo el respaldo tipado.
      const destino = !chatSolo ? detectDestino(original) : null;
      const textoOrden = destino ? stripDestino(original) : original;
      let pcI = !chatSolo && pc && destino !== "telefono" ? parsePcIntent(textoOrden, { apps: pc.config.apps || [], destino }) : null;
      let pi = !chatSolo && phone && !flagPrivate && destino !== "pc" ? parsePhoneIntent(textoOrden, phone.config) : null;
      if (pcI && pi) { if (origen === "pc") pi = null; else pcI = null; }
      if (!pcI && !pi && !chatSolo && pc && destino === "pc" && textoOrden.length <= 140) {
        // Respaldo: el modelo (Groq primero) elige de la lista cerrada; lo privado solo a proveedores permitidos.
        pcI = await interpretWithModel({ router, pc, userId, text: textoOrden, isPrivate: flagPrivate || classify(original).private });
      }
      if (pcI) {
        const out = await pc.create({ userId, action: pcI.action, params: pcI.params, source });
        const reply = out.ok ? pcReply(out.item) : pcError(out.error);
        await saveMsg(userId, conv, "user", original, null, flagPrivate);
        await saveMsg(userId, conv, "assistant", reply, "pc", flagPrivate);
        bus?.emit("chat.done", { userId, text: reply, provider: "pc" });
        state(userId, "speaking");
        return { status: "pc", conversationId: conv, reply, pc: out.ok ? { id: out.item.id, status: out.item.status } : { error: out.error } };
      }
      if (pi) {
        const out = await phone.create({ userId, action: pi.action, args: pi.args, source });
        if (out.ok) {
          const reply = phoneReply(out.item);
          await saveMsg(userId, conv, "user", original, null, false);
          await saveMsg(userId, conv, "assistant", reply, "telefono", false);
          bus?.emit("chat.done", { userId, text: reply, provider: "telefono" });
          state(userId, "speaking");
          return { status: "telefono", conversationId: conv, reply, phone: { id: out.item.id, status: out.item.status } };
        }
      }

      // 2) Memoria + privacidad
      const cls = classify(original, { flagPrivate });
      const found = await search.search({ userId, query: original, k: 4, tokenBudget: 600, includePrivate: true });
      const isPrivate = privacy.isPrivateMessage({ flag: flagPrivate, classification: cls, notes: found.notes });

      // 3) Acción para el PC: modo Preparar, siempre para Claude. Flash = no actúa en el PC, responde la nube.
      // Con "/gemini" no se encola nada: se contesta como charla.
      if (!chatSolo && !prefer && cls.kind === "accion_pc" && !(motor === "flash" && !isPrivate)) {
        const task = await prepare.prepare({ userId, text: original, isPrivate, reviewFirst: true, source, engine: "claude" });
        agent?.sweep?.();
        const reply = task.prepared?.sin_cuota
          ? "Lo anoté en la cola para el PC, señor, pero sin ordenarlo: mis modelos están sin cuota."
          : `Lo preparé para Claude en el PC, señor. Revise los pasos en la cola antes de enviarlo.`;
        await saveMsg(userId, conv, "user", original, null, isPrivate);
        await saveMsg(userId, conv, "assistant", reply, task.prepared?.por || "cola", isPrivate);
        bus?.emit("chat.done", { userId, text: reply, provider: task.prepared?.por || "cola" });
        state(userId, "speaking");
        return { status: "tarea", conversationId: conv, reply, task: { id: task.id, seq: task.seq, engine: task.engine } };
      }

      // 3b) Consulta actual y NO privada: búsqueda web con citas (si falla, sigue la cadena normal)
      if (!chatSolo && cls.kind === "investigacion" && !isPrivate && webSearch) {
        const w = await webSearch.search({ userId, query: original, isPrivate });
        if (w.ok) {
          const reply = webSearch.format(w);
          await saveMsg(userId, conv, "user", original, null, false);
          await saveMsg(userId, conv, "assistant", reply, w.provider, false);
          bus?.emit("chat.done", { userId, text: reply, provider: w.provider });
          state(userId, "speaking", { provider: w.provider });
          return { status: "ok", conversationId: conv, reply, provider: w.provider, private: false, sources: w.sources, notes_read: found.notes.length };
        }
      }

      // 4) Charla normal por la cadena de modelos
      const hist = await all(db, "SELECT role, content, private FROM messages WHERE conversation_id=? AND user_id=? ORDER BY id DESC LIMIT 10", [conv, userId]);
      const history = hist.reverse().filter((m) => isPrivate || !m.private).map((m) => ({ role: m.role, content: m.content }));
      let system = persona + (chatSolo ? PROMPT_MODO_CHAT : "");
      if (found.notes.length) system += "\n\nNotas del señor que pueden servir:\n" + found.notes.map((n) => `- ${n.title ? n.title + ": " : ""}${n.body}`).join("\n");
      await saveMsg(userId, conv, "user", original, null, isPrivate);
      const r = await router.route({ userId, kind: (chatSolo || prefer) && (cls.kind === "accion_pc" || cls.kind === "investigacion") ? "charla" : cls.kind, system, isPrivate, prefer, messages: [...history, { role: "user", content: original }] });
      bus?.emit("providers.update", { userId });
      if (!r.ok) {
        await saveMsg(userId, conv, "assistant", MSG_SIN_CUOTA, null, isPrivate);
        state(userId, "sin_cuota");
        return { status: "sin_cuota", conversationId: conv, reply: MSG_SIN_CUOTA, private: isPrivate, notes_read: found.notes.length };
      }
      const texto = r.text;
      await saveMsg(userId, conv, "assistant", texto, r.provider, isPrivate);
      bus?.emit("chat.delta", { userId, text: texto });
      bus?.emit("chat.done", { userId, text: texto, provider: r.provider });
      state(userId, "speaking", { provider: r.provider });
      return { status: "ok", conversationId: conv, reply: texto, provider: r.provider, private: isPrivate, notes_read: found.notes.length };
    },
  };
}
