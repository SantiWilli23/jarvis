// Navegador de Claude en el PC (docs/NAV.md): cola nav_tasks. El servidor es la autoridad de estados, topes y privacidad.
// La respuesta leída de una página es DATO: se guarda y se muestra, jamás se interpreta ni se pasa a un modelo como orden.
import { all, get, run } from "./db/client.js";

export const ESTADOS_RESULTADO = ["ok", "necesita_login", "captcha", "bloqueado", "vencida", "error"];
export const DATO = "dato_no_instruccion"; // marca en messages.provider
const MAX_CONSULTA = 4000;
const MAX_RESPUESTA = 20_000;
const HORA = 3_600_000, DIA = 86_400_000;

const MENSAJES = {
  necesita_login: (n) => `${n} pide iniciar sesión, señor. Entre usted en Chrome del PC y vuelva a pedírmelo.`,
  captcha: (n) => `${n} mostró un CAPTCHA, señor. No los resuelvo: hágalo en Chrome del PC y vuelva a pedírmelo.`,
  bloqueado: (n) => `No pude seguir en ${n}, señor: el navegador quedó bloqueado.`,
  vencida: (n) => `La consulta a ${n} venció sin respuesta, señor. Revise que el PC siga encendido y vuelva a pedirlo.`,
  error: (n) => `Hubo un error al consultar ${n}, señor.`,
};

function limpiarFuentes(f) {
  const out = [];
  for (const x of Array.isArray(f) ? f : []) {
    const url = typeof x?.url === "string" ? x.url.trim() : "";
    if (!/^https?:\/\//i.test(url) || url.length > 2000) continue;
    out.push({ titulo: String(x.titulo || url).slice(0, 300), url });
    if (out.length >= 10) break;
  }
  return out;
}

export function createNav({ db, config, agent, chat, privacy, bus, audit, now = () => Date.now() }) {
  const cfg = config;
  const err = (status, error, mensaje) => Object.assign(new Error(error), { status, error, mensaje });
  const lim = () => cfg.limites;
  const nombre = (sitio) => cfg.sitios[sitio]?.nombre || sitio;
  const count = async (sql, args) => Number((await get(db, sql, args))?.n ?? 0);
  const log = (userId, action, detail) => audit?.log({ userId, action, detail });

  // Guarda la respuesta (o el motivo) en la conversación y avisa a la web. Solo se llama tras cerrar la tarea.
  async function avisar(t) {
    const ok = t.estado === "ok";
    const fuentes = ok ? JSON.parse(t.fuentes || "[]") : [];
    const respuesta = ok ? t.respuesta : MENSAJES[t.estado](nombre(t.sitio));
    const conv = t.conversation_id == null ? null : Number(t.conversation_id);
    if (conv != null) {
      const lista = fuentes.length ? "\n\nFuentes:\n" + fuentes.map((f) => `- ${f.titulo}: ${f.url}`).join("\n") : "";
      const cuerpo = ok ? `Respuesta de ${nombre(t.sitio)} (dato leído de la web):\n${respuesta}${lista}` : respuesta;
      await run(db, "INSERT INTO messages (user_id, conversation_id, role, content, provider, private, created_at) VALUES (?,?,'assistant',?,?,0,?)",
        [t.user_id, conv, cuerpo, ok ? DATO : "nav", now()]);
    }
    bus?.emit("nav.done", { userId: Number(t.user_id), task: { id: Number(t.id), tipo: t.tipo, sitio: t.sitio, estado: t.estado, respuesta, fuentes, conversation_id: conv } });
  }

  // Cierra las tareas sin respuesta (180 s más margen), tanto sin reclamar como en curso.
  async function sweep(userId) {
    const t = now(), limite = t - (lim().timeout_s + lim().margen_s) * 1000;
    const viejas = await all(db, "SELECT id FROM nav_tasks WHERE user_id=? AND ((estado='pendiente' AND creado<?) OR (estado='en_curso' AND tomado<?))", [userId, limite, limite]);
    for (const { id } of viejas) {
      const u = await run(db, "UPDATE nav_tasks SET estado='vencida', terminado=? WHERE id=? AND estado IN ('pendiente','en_curso')", [t, id]);
      if (u.changes) await avisar(await get(db, "SELECT * FROM nav_tasks WHERE id=?", [id]));
    }
  }

  const disponible = () => {
    agent.sweep();
    return !!agent.view().online && !!agent.capabilities()?.chrome?.ok;
  };

  return {
    config: cfg,
    activo: () => cfg.activo === true,
    sweep,
    async enqueue({ userId, conversationId = null, tipo, sitio, consulta, text = consulta, flagPrivate = false }) {
      if (!cfg.activo) throw err(403, "nav_apagado", "El navegador de Claude está apagado, señor.");
      if (!["preguntar_ia", "buscar_google"].includes(tipo) || !cfg.sitios[sitio] || (tipo === "buscar_google") !== (sitio === "google")) throw err(400, "sitio_desconocido", "No conozco ese sitio, señor.");
      consulta = typeof consulta === "string" ? consulta.trim() : "";
      if (!consulta) throw err(400, "texto_vacio", "¿Qué quiere que consulte, señor?");
      if (consulta.length > MAX_CONSULTA) throw err(413, "texto_largo", "Es demasiado largo para el navegador, señor.");
      // Privacidad primero: lo privado NUNCA va a un sitio web (tampoco a claude.ai).
      const priv = await chat.checkPrivate({ userId, text, flagPrivate });
      try { privacy.assert(`web_${sitio}`, priv); } catch { throw err(403, "privado_no_sitio", "Eso es privado, señor: no lo llevo a un sitio web."); }
      if (!disponible()) throw err(409, "pc_apagado", "Su PC no está conectado con el navegador, señor: no encolé nada.");
      await sweep(userId);
      const t = now(), L = lim();
      if (await count("SELECT COUNT(*) AS n FROM nav_tasks WHERE user_id=? AND creado>=?", [userId, t - HORA]) >= L.por_hora) throw err(429, "tope_hora", `Llegué al tope de ${L.por_hora} consultas por hora con el navegador, señor.`);
      if (await count("SELECT COUNT(*) AS n FROM nav_tasks WHERE user_id=? AND creado>=?", [userId, t - DIA]) >= L.por_dia) throw err(429, "tope_dia", `Llegué al tope de ${L.por_dia} consultas por día con el navegador, señor.`);
      const r = await run(db, "INSERT INTO nav_tasks (user_id, conversation_id, tipo, sitio, consulta, estado, creado) VALUES (?,?,?,?,?,'pendiente',?)", [userId, conversationId, tipo, sitio, consulta, t]);
      await log(userId, "nav.encolar", `${sitio} #${r.id}`);
      return { id: Number(r.id), estado: "pendiente" };
    },
    async claim(userId, deviceId) {
      if (!cfg.activo) return { task: null };
      await sweep(userId);
      const t = await get(db, "SELECT * FROM nav_tasks WHERE user_id=? AND estado='pendiente' ORDER BY id LIMIT 1", [userId]);
      if (!t) return { task: null };
      // Una tarea a la vez por dispositivo, en la misma sentencia para que no haya carreras.
      const u = await run(db, "UPDATE nav_tasks SET estado='en_curso', tomado=?, device_id=? WHERE id=? AND estado='pendiente' AND NOT EXISTS (SELECT 1 FROM nav_tasks WHERE device_id=? AND estado='en_curso')", [now(), deviceId, t.id, deviceId]);
      if (!u.changes) return { task: null };
      return { task: { id: Number(t.id), tipo: t.tipo, sitio: t.sitio, consulta: t.consulta, url_inicial: cfg.sitios[t.sitio].url_inicial, limites: { hosts: cfg.hosts, timeout_s: lim().timeout_s, max_turnos: lim().max_turnos } } };
    },
    async result(userId, deviceId, id, { estado, respuesta, fuentes, error } = {}) {
      if (!ESTADOS_RESULTADO.includes(estado)) throw err(400, "estado_invalido");
      await sweep(userId);
      const t = await get(db, "SELECT * FROM nav_tasks WHERE id=? AND user_id=?", [id, userId]);
      if (!t || (t.device_id != null && Number(t.device_id) !== Number(deviceId))) throw err(404, "no_existe");
      const texto = typeof respuesta === "string" ? respuesta.trim().slice(0, MAX_RESPUESTA) : "";
      const final = estado === "ok" && !texto ? "error" : estado;
      const u = await run(db, "UPDATE nav_tasks SET estado=?, respuesta=?, fuentes=?, error=?, terminado=? WHERE id=? AND estado='en_curso'",
        [final, texto || null, JSON.stringify(limpiarFuentes(fuentes)), error ? String(error).slice(0, 500) : null, now(), id]);
      if (!u.changes) throw err(409, "tarea_cerrada");
      await log(userId, "nav.resultado", `#${id} ${final}`);
      await avisar(await get(db, "SELECT * FROM nav_tasks WHERE id=?", [id]));
      return { ok: true };
    },
  };
}
