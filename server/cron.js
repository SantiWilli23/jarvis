// Avisos proactivos. Se dispara desde fuera con GET/POST /api/cron/tick (secreto CRON_SECRET).
//  1) Recordatorios vencidos -> Telegram y push (solo se marcan hechos si algún aviso salió). También cada minuto
//     desde el propio servidor; lo atrasado (Render dormido) sale una sola vez, marcado como atrasado.
//  2) PC encendido/apagado -> Telegram, solo cuando CAMBIA respecto al último aviso.
//  3) Resumen diario de cuota (una vez al día, a partir de CRON_SUMMARY_HOUR_UTC, 12 por defecto).
import { all, get, run } from "./db/client.js";
import { classify } from "./router/classify.js";
import { cuando, ZONA } from "./funciones/comun.js";

const ATRASO_MS = 10 * 60_000;

export function createCron({ db, notify, state, status, ownerId, env = process.env, now = () => Date.now(), bus, proWeb = null, getPush = () => null, zona = ZONA }) {
  const setting = async (k) => (await get(db, "SELECT value FROM settings WHERE user_id=? AND key=?", [ownerId, k]))?.value ?? null;
  const setSetting = (k, v) => run(db, `INSERT INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value`, [ownerId, k, String(v), now()]);

  async function entregar() {
    let n = 0;
    const t = now();
    for (const r of await all(db, "SELECT id, text, due_at FROM reminders WHERE user_id=? AND done=0 AND due_at<=? ORDER BY due_at LIMIT 20", [ownerId, t])) {
      const titulo = t - Number(r.due_at) > ATRASO_MS ? `Recordatorio atrasado (era ${cuando(Number(r.due_at), t, zona)})` : "Recordatorio";
      let enviado = !!(await notify?.(`${titulo}: ${r.text}`));
      try {
        // En la pantalla bloqueada no se muestra lo privado.
        const p = await getPush()?.notify(ownerId, { title: titulo, body: classify(r.text).private ? "Abra Jarvis para verlo." : r.text, tag: `jarvis-recordatorio-${r.id}` });
        enviado = enviado || p?.sent > 0;
      } catch (e) { console.error("[recordatorios] push", e?.message); }
      if (!enviado) continue; // sin canal: se reintenta
      bus?.emit("reminder.due", { userId: ownerId, text: r.text });
      await run(db, "UPDATE reminders SET done=1 WHERE id=?", [r.id]);
      n++;
    }
    return n;
  }
  // Una entrega a la vez: el reloj interno y el externo no repiten avisos.
  let enCurso = null;
  const recordatorios = () => (enCurso ??= entregar().finally(() => { enCurso = null; }));

  return {
    recordatorios,
    async tick() {
      const out = { recordatorios: 0, pc: null, resumen: false };
      const t = now();

      for (const r of await all(db, "SELECT id, text FROM reminders WHERE user_id=? AND done=0 AND due_at<=? ORDER BY due_at LIMIT 20", [ownerId, t])) {
        bus?.emit("reminder.due", { userId: ownerId, text: r.text });
        if (await notify(`Recordatorio: ${r.text}`)) { await run(db, "UPDATE reminders SET done=1 WHERE id=?", [r.id]); out.recordatorios++; }
      }

      try { out.pro_web = proWeb ? await proWeb.tick() : 0; } catch { out.pro_web = 0; } // busca resultados de rondas Pro web en GitHub
      const now_ = state.pc?.online ? "pc_online" : "pc_offline";
      const last = await setting("pc_avisado");
      if (last == null) await setSetting("pc_avisado", now_); // primera vez: se anota sin avisar
      else if (last !== now_ && await notify(now_ === "pc_online" ? "Su PC se encendió, señor. Ya puedo pasarle la cola a Claude." : "Su PC se apagó, señor. Vuelvo al modo nube.")) {
        await setSetting("pc_avisado", now_); out.pc = now_;
      }

      const hour = Number(env.CRON_SUMMARY_HOUR_UTC ?? 12);
      const day = new Date(t).toISOString().slice(0, 10);
      if (new Date(t).getUTCHours() >= hour && (await setting("resumen_cuota_dia")) !== day) {
        const s = await status(ownerId);
        const lines = s.providers.filter((p) => p.usado_dia > 0 || p.estado === "pausado").map((p) => `- ${p.nombre}: ${p.usado_dia}${p.limite_dia != null ? "/" + p.limite_dia : ""} hoy${p.estado === "pausado" ? " (pausado)" : ""}`);
        if (await notify(`Resumen de cuota, señor:\n${lines.join("\n") || "Sin uso de modelos hoy."}`)) { await setSetting("resumen_cuota_dia", day); out.resumen = true; }
      }
      return out;
    },
  };
}
