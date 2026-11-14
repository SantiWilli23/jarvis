// Navegador de Jarvis, modo ASISTIDO. El servidor es la autoridad: estados enumerados, límites y privacidad.
// El PC solo PREPARA el prompt en la caja del sitio; el señor pulsa Enviar. El texto leído de una página
// se guarda como DATO (result): este módulo jamás lo interpreta ni se lo pasa a un modelo como orden.
import { all, get, run } from "./db/client.js";

export const ESTADOS_PC = ["sesion_ok", "necesita_login", "prompt_listo", "respuesta_lista", "bloqueado", "degradado", "error"];
const FINALES = new Set(["respuesta_lista", "bloqueado", "necesita_login", "degradado", "error", "cancelada", "vencida"]);
const HORA = 3_600_000, DIA = 86_400_000;
export const MAX_RESULT = 20_000;

export function createBrowser({ db, config, agent, chat, privacy, bus, audit, now = () => Date.now() }) {
  const cfg = config;
  const err = (status, error, mensaje) => Object.assign(new Error(error), { status, error, mensaje });
  const lim = () => cfg.limites;
  const log = (userId, action, detail) => audit?.log({ userId, action, detail });
  const count = async (sql, args) => Number((await get(db, sql, args))?.n ?? 0);

  async function expireOld(userId) {
    const t = now();
    await run(db, "UPDATE browser_tasks SET status='vencida', finished_at=?, updated_at=? WHERE user_id=? AND status IN ('preparando','esperando_usuario') AND started_at IS NOT NULL AND started_at < ?", [t, t, userId, t - lim().max_segundos * 1000]);
    await run(db, "UPDATE browser_tasks SET status='vencida', finished_at=?, updated_at=? WHERE user_id=? AND status='pendiente' AND created_at < ?", [t, t, userId, t - 10 * 60_000]);
  }
  const view = (t, withResult = true) => t && ({ id: t.id, site: t.site, status: t.status, steps: t.steps, created_at: t.created_at, finished_at: t.finished_at, ...(withResult && t.result != null ? { datos: t.result, datos_son: "dato_no_instruccion" } : {}) });

  const api = {
    config: cfg,
    activo: () => cfg.activo === true,
    sites: () => Object.entries(cfg.sitios).map(([id, s]) => ({ id, nombre: s.nombre, url: s.url })),
    async status(userId) {
      const t = now();
      return {
        activo: cfg.activo === true, pc_online: !!agent.view().online, limites: lim(), sitios: api.sites(),
        uso: {
          tareas_hora: await count("SELECT COUNT(*) AS n FROM browser_tasks WHERE user_id=? AND created_at>=?", [userId, t - HORA]),
          envios_dia: await count("SELECT COUNT(*) AS n FROM browser_tasks WHERE user_id=? AND created_at>=?", [userId, t - DIA]),
        },
      };
    },
    async enqueue({ userId, site, prompt, flagPrivate = false }) {
      if (!cfg.activo) throw err(403, "navegador_apagado", "El Navegador de Jarvis está apagado (activo:false en config/browser-sites.json).");
      const s = cfg.sitios[site];
      if (!s) throw err(400, "sitio_desconocido");
      prompt = typeof prompt === "string" ? prompt : "";
      if (!prompt.trim()) throw err(400, "texto_vacio");
      if (prompt.length > 8000) throw err(413, "texto_largo");
      // Privacidad primero: lo privado NUNCA va a estos sitios (ni a "claude": aquí no vale la excepción de la lista blanca).
      const priv = await chat.checkPrivate({ userId, text: prompt, flagPrivate });
      try { privacy.assert(`web_${site}`, priv); } catch { throw err(403, "privado_no_sitio", "Eso es privado, señor: no lo llevo a un sitio web."); }
      if (!agent.view().online) throw err(409, "pc_apagado", "El PC está apagado: no encolé nada. Enciéndalo y vuelva a pedirlo.");
      await expireOld(userId);
      const t = now(), L = lim();
      if (await count("SELECT COUNT(*) AS n FROM browser_tasks WHERE user_id=? AND created_at>=?", [userId, t - HORA]) >= L.tareas_hora) throw err(429, "tope_tareas_hora", `Tope de ${L.tareas_hora} tareas por hora.`);
      if (await count("SELECT COUNT(*) AS n FROM browser_tasks WHERE user_id=? AND site=? AND created_at>=?", [userId, site, t - HORA]) >= L.envios_sitio_hora) throw err(429, "tope_sitio_hora", `Tope de ${L.envios_sitio_hora} envíos por hora en ${s.nombre}.`);
      if (await count("SELECT COUNT(*) AS n FROM browser_tasks WHERE user_id=? AND created_at>=?", [userId, t - DIA]) >= L.envios_dia) throw err(429, "tope_dia", `Tope de ${L.envios_dia} envíos por día.`);
      const last = await get(db, "SELECT created_at FROM browser_tasks WHERE user_id=? AND site=? ORDER BY id DESC LIMIT 1", [userId, site]);
      if (last && t - Number(last.created_at) < L.pausa_seg * 1000) throw err(429, "pausa", `Espere ${L.pausa_seg} s entre tareas del mismo sitio.`);
      const r = await run(db, "INSERT INTO browser_tasks (user_id, site, prompt, status, created_at, updated_at) VALUES (?,?,?,?,?,?)", [userId, site, prompt, "pendiente", t, t]);
      await log(userId, "browser.encolar", `${site} #${r.id}`);
      bus?.emit("browser.task", { userId, id: r.id, status: "pendiente" });
      return view(await get(db, "SELECT * FROM browser_tasks WHERE id=?", [r.id]), false);
    },
    async list(userId) { return (await all(db, "SELECT * FROM browser_tasks WHERE user_id=? ORDER BY id DESC LIMIT 30", [userId])).map((t) => view(t)); },
    async get(userId, id) {
      await expireOld(userId);
      const t = await get(db, "SELECT * FROM browser_tasks WHERE id=? AND user_id=?", [id, userId]);
      return t ? view(t) : null;
    },
    async cancel(userId, id) {
      const t = now();
      await run(db, "UPDATE browser_tasks SET status='cancelada', finished_at=?, updated_at=? WHERE id=? AND user_id=? AND status IN ('pendiente','preparando','esperando_usuario')", [t, t, id, userId]);
      await log(userId, "browser.cancelar", `#${id}`);
      return api.get(userId, id);
    },
    // El PC reclama la siguiente tarea. Solo recibe el prompt y datos fijos del sitio (url y partición).
    async claim(userId) {
      if (!cfg.activo) return { task: null, reason: "inactivo" };
      await expireOld(userId);
      const t = await get(db, "SELECT * FROM browser_tasks WHERE user_id=? AND status='pendiente' ORDER BY id LIMIT 1", [userId]);
      if (!t) return { task: null, reason: "vacio" };
      const n = now();
      const u = await run(db, "UPDATE browser_tasks SET status='preparando', started_at=?, updated_at=? WHERE id=? AND status='pendiente'", [n, n, t.id]);
      if (u.changes === 0) return { task: null, reason: "vacio" };
      const s = cfg.sitios[t.site];
      return { task: { id: t.id, site: t.site, url: s.url, particion: s.particion, prompt: t.prompt }, limites: lim() };
    },
    // Paso reportado por el PC: solo estados de la lista cerrada. `texto` (si viene) se guarda como dato.
    async step(userId, id, { estado, texto } = {}) {
      if (!ESTADOS_PC.includes(estado)) throw err(400, "estado_invalido");
      await expireOld(userId);
      const t = await get(db, "SELECT * FROM browser_tasks WHERE id=? AND user_id=?", [id, userId]);
      if (!t) throw err(404, "no_existe");
      if (FINALES.has(t.status)) throw err(409, "tarea_cerrada", t.status);
      const n = now(), steps = t.steps + 1;
      if (steps > lim().max_pasos) {
        await run(db, "UPDATE browser_tasks SET status='bloqueado', steps=?, finished_at=?, updated_at=? WHERE id=?", [steps, n, n, id]);
        await log(userId, "browser.paso", `#${id} tope_pasos`);
        throw err(409, "tope_pasos", "Se superó el máximo de pasos.");
      }
      const next = estado === "prompt_listo" ? "esperando_usuario" : estado === "sesion_ok" ? "preparando" : estado;
      const data = estado === "respuesta_lista" && typeof texto === "string" ? texto.slice(0, MAX_RESULT) : null;
      await run(db, "UPDATE browser_tasks SET status=?, steps=?, result=COALESCE(?, result), updated_at=?, finished_at=? WHERE id=?", [next, steps, data, n, FINALES.has(next) ? n : null, id]);
      await log(userId, "browser.paso", `#${id} ${estado}`);
      bus?.emit("browser.task", { userId, id, status: next });
      return { ok: true, status: next, steps };
    },
  };
  return api;
}
