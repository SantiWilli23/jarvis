// Lógica de una conversación: la comparten /api/chat y /api/shortcut.
import { all, get, run } from "./db/client.js";
import { detectDirect } from "./queue/direct.js";
import { classify } from "./router/classify.js";
import { parsePhoneIntent, phoneReply } from "./phone/intents.js";

const MSG_SIN_CUOTA = "Mis proveedores gratuitos llegaron a su límite por ahora, señor. Lo reintento en cuanto se reinicien.";

const MOTORES = ["auto", "flash", "gemini", "claude"]; // lista cerrada del selector del chat
const NOTA_PC_APAGADO = " (Flash: PC apagado)";

export function createChatService({ db, router, privacy, search, tasks, prepare, bus, phone = null, persona = "", webSearch = null, agent = null, now = () => Date.now() }) {
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
    // ¿El texto es privado? (marca, clasificador o notas privadas). Se usa ANTES de encolar algo para Gemini.
    async checkPrivate({ userId, text, flagPrivate = false }) {
      const cls = classify(String(text ?? ""), { flagPrivate });
      const found = await search.search({ userId, query: String(text ?? ""), k: 4, tokenBudget: 600, includePrivate: true });
      return privacy.isPrivateMessage({ flag: flagPrivate, classification: cls, notes: found.notes });
    },
    async handle({ userId, text, conversationId, flagPrivate = false, source = "texto", engine = "auto" }) {
      const motor = MOTORES.includes(engine) ? engine : "auto";
      const original = String(text ?? "");
      if (!original.trim()) return { status: "vacio", reply: "No le oí nada, señor." };
      const conv = await ensureConversation(userId, conversationId, original);
      state(userId, "thinking");

      // 1) Directo a Claude o a Gemini: se guarda el texto exacto, sin modelo.
      const d = detectDirect(original);
      if (d.direct) {
        const quien = d.engine === "gemini" ? "Gemini" : "Claude";
        if (!d.text.length) { state(userId, "idle"); return { status: "vacio", conversationId: conv, reply: `¿Qué quiere que le diga a ${quien}, señor?` }; }
        if (d.engine === "gemini" && await this.checkPrivate({ userId, text: original, flagPrivate })) {
          // Privacidad ANTES de encolar: lo privado nunca llega a Gemini (ni tarea, ni llamada).
          const reply = "Eso es privado, señor: no se lo paso a Gemini. Si quiere, dígaselo a Claude con /claude.";
          await saveMsg(userId, conv, "user", original, null, true);
          await saveMsg(userId, conv, "assistant", reply, "privacidad", true);
          bus?.emit("chat.done", { userId, text: reply, provider: "privacidad" });
          state(userId, "speaking");
          return { status: "privado_no_gemini", conversationId: conv, reply, private: true };
        }
        const task = await tasks.create({ userId, rawText: d.text, mode: "directo", engine: d.engine, header: { source } });
        const reply = `Anotado, señor. Lo dejé en cola, palabra por palabra, y se lo entrego a ${quien} en cuanto encienda su PC.`;
        await saveMsg(userId, conv, "user", original, null, false);
        await saveMsg(userId, conv, "assistant", reply, "cola", false);
        bus?.emit("chat.done", { userId, text: reply, provider: "cola" });
        state(userId, "speaking");
        return { status: "tarea", conversationId: conv, reply, task: { id: task.id, seq: task.seq, sha256: task.sha256, engine: task.engine } };
      }

      // 1b) Orden fija para el teléfono ("enciende la linterna", "brillo al 30"): sin modelo
      const pi = phone && !flagPrivate ? parsePhoneIntent(original, phone.config) : null;
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

      // 3) Acción para el PC: modo Preparar. Motor: lo privado SIEMPRE Claude; Auto = Claude (o Gemini si Claude
      // llegó a su tope diario y el PC tiene agy); Gemini = cola para Gemini aunque el PC esté apagado;
      // Flash = no actúa en el PC, responde la nube.
      if (cls.kind === "accion_pc" && !(motor === "flash" && !isPrivate)) {
        let eng = "claude";
        if (!isPrivate) {
          if (motor === "gemini") eng = "gemini";
          else if (motor === "auto" && agent && agent.geminiReady() && await agent.capped(userId, "claude")) eng = "gemini";
        }
        const task = await prepare.prepare({ userId, text: original, isPrivate, reviewFirst: true, source, engine: eng });
        agent?.sweep?.();
        const quien = eng === "gemini" ? "Gemini" : "Claude";
        const apagado = eng === "gemini" && agent && !agent.view().online ? " Su PC está apagado: queda en cola hasta que encienda." : "";
        const reply = task.prepared?.sin_cuota
          ? "Lo anoté en la cola para el PC, señor, pero sin ordenarlo: mis modelos están sin cuota."
          : `Lo preparé para ${quien} en el PC, señor. Revise los pasos en la cola antes de enviarlo.${apagado}`;
        await saveMsg(userId, conv, "user", original, null, isPrivate);
        await saveMsg(userId, conv, "assistant", reply, task.prepared?.por || "cola", isPrivate);
        bus?.emit("chat.done", { userId, text: reply, provider: task.prepared?.por || "cola" });
        state(userId, "speaking");
        return { status: "tarea", conversationId: conv, reply, task: { id: task.id, seq: task.seq, engine: task.engine } };
      }
      // Con Gemini elegido y el PC apagado, las preguntas las responde Flash (nube) y se avisa.
      const notaFlash = () => { agent?.sweep?.(); return motor === "gemini" && !isPrivate && agent && !(agent.view().online && agent.geminiReady()) ? NOTA_PC_APAGADO : ""; };

      // 3b) Consulta actual y NO privada: búsqueda web con citas (si falla, sigue la cadena normal)
      if (cls.kind === "investigacion" && !isPrivate && webSearch) {
        const w = await webSearch.search({ userId, query: original, isPrivate });
        if (w.ok) {
          const reply = webSearch.format(w) + notaFlash();
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
      let system = persona;
      if (found.notes.length) system += "\n\nNotas del señor que pueden servir:\n" + found.notes.map((n) => `- ${n.title ? n.title + ": " : ""}${n.body}`).join("\n");
      await saveMsg(userId, conv, "user", original, null, isPrivate);
      const r = await router.route({ userId, kind: cls.kind, system, isPrivate, messages: [...history, { role: "user", content: original }] });
      bus?.emit("providers.update", { userId });
      if (!r.ok) {
        await saveMsg(userId, conv, "assistant", MSG_SIN_CUOTA, null, isPrivate);
        state(userId, "sin_cuota");
        return { status: "sin_cuota", conversationId: conv, reply: MSG_SIN_CUOTA, private: isPrivate, notes_read: found.notes.length };
      }
      const texto = r.text + notaFlash();
      await saveMsg(userId, conv, "assistant", texto, r.provider, isPrivate);
      bus?.emit("chat.delta", { userId, text: texto });
      bus?.emit("chat.done", { userId, text: texto, provider: r.provider });
      state(userId, "speaking", { provider: r.provider });
      return { status: "ok", conversationId: conv, reply: texto, provider: r.provider, private: isPrivate, notes_read: found.notes.length };
    },
  };
}
