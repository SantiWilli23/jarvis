// Estudio: chat de código por la API oficial de Gemini (nivel gratis). Lo privado NUNCA sale hacia Gemini.
import { all, get, run } from "./db/client.js";
import { ProviderError } from "./providers/base.js";

export const AVISO_ENTRENAMIENTO = "Aviso: en el plan gratis de Gemini, Google puede usar lo que envía para mejorar y entrenar sus modelos. No pegue secretos, claves ni datos privados.";
const SYSTEM = "Eres el Estudio de código de Jarvis. Responde en español, directo y breve. Pon todo el código en bloques de código con su lenguaje (```js ... ```). Si falta información, pregunta una sola cosa.";
const SESSION_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function createStudio({ db, config = {}, providers, chat, privacy, now = () => Date.now() }) {
  const cfg = { modelo_por_defecto: "gemini-3.8-flash", tope_dia: 100, max_caracteres: 12000, modelos: [], ...config };
  const dayStart = () => { const d = new Date(now()); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
  const err = (status, error, extra = {}) => Object.assign(new Error(error), { status, error, ...extra });

  return {
    aviso: AVISO_ENTRENAMIENTO,
    models() {
      return { modelos: cfg.modelos.map((m) => ({ id: m.id, nombre: m.nombre, gratis: !!m.gratis })), por_defecto: cfg.modelo_por_defecto, aviso: AVISO_ENTRENAMIENTO, tope_dia: cfg.tope_dia, disponible: !!providers.gemini?.enabled };
    },
    async history(userId, session) {
      if (!SESSION_RE.test(session || "")) throw err(400, "sesion_invalida");
      return all(db, "SELECT id, role, model, content, created_at FROM studio_messages WHERE user_id=? AND session=? ORDER BY id", [userId, session]);
    },
    async clear(userId, session) {
      if (!SESSION_RE.test(session || "")) throw err(400, "sesion_invalida");
      await run(db, "DELETE FROM studio_messages WHERE user_id=? AND session=?", [userId, session]);
    },
    async send({ userId, text, model, session, flagPrivate = false }) {
      if (!SESSION_RE.test(session || "")) throw err(400, "sesion_invalida");
      text = typeof text === "string" ? text : "";
      if (!text.trim()) throw err(400, "texto_vacio");
      if (text.length > cfg.max_caracteres) throw err(413, "texto_largo", { max: cfg.max_caracteres });
      const m = cfg.modelos.find((x) => x.id === (model || cfg.modelo_por_defecto));
      if (!m) throw err(400, "modelo_desconocido");
      if (!m.gratis) throw err(400, "sin_nivel_gratis", { mensaje: `${m.nombre} no tiene nivel gratis: no se usa.` });
      // Privacidad ANTES de todo: lo privado no se guarda ni se envía.
      const priv = await chat.checkPrivate({ userId, text, flagPrivate });
      try { privacy.assert("gemini", priv); } catch { throw err(403, "privado_no_gemini", { mensaje: "Eso es privado, señor: no se lo paso a Gemini ni se guarda en el Estudio." }); }
      const g = providers.gemini;
      if (!g?.enabled) throw err(503, "gemini_sin_clave", { mensaje: "Gemini no tiene clave en el servidor." });
      const usados = await get(db, "SELECT COUNT(*) AS n FROM studio_messages WHERE user_id=? AND role='user' AND created_at>=?", [userId, dayStart()]);
      if (Number(usados?.n ?? 0) >= cfg.tope_dia) throw err(429, "tope_diario", { mensaje: `Llegó al tope de ${cfg.tope_dia} mensajes del Estudio por hoy.` });
      const hist = (await all(db, "SELECT role, content FROM studio_messages WHERE user_id=? AND session=? ORDER BY id DESC LIMIT 20", [userId, session])).reverse();
      const messages = [...hist.map((h) => ({ role: h.role, content: h.content })), { role: "user", content: text }];
      let out;
      try { out = await g.chat({ messages, system: SYSTEM, model: m.id }); }
      catch (e) {
        if (e instanceof ProviderError && e.status === 429) throw err(429, "limite_gemini", { mensaje: "Gemini llegó a su límite gratis por ahora. Pruebe en un rato o con otro modelo." });
        throw err(502, "gemini_fallo", { mensaje: "Gemini no respondió. Intente de nuevo." });
      }
      const reply = String(out?.text ?? "");
      const t = now();
      await run(db, "INSERT INTO studio_messages (user_id, session, role, model, content, created_at) VALUES (?,?,?,?,?,?)", [userId, session, "user", null, text, t]);
      await run(db, "INSERT INTO studio_messages (user_id, session, role, model, content, created_at) VALUES (?,?,?,?,?,?)", [userId, session, "assistant", m.id, reply, t]);
      return { reply, model: m.id, session, aviso: AVISO_ENTRENAMIENTO };
    },
  };
}
