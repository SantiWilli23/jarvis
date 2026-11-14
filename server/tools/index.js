// Registro de herramientas. Cada una dice si es automática o si pide aprobación en el teléfono.
//  - Leer = automática. ENVIAR / ESCRIBIR (correo, evento, WhatsApp) = SIEMPRE aprobación, no configurable.
//  - Controlar Spotify = según config/permissions.json ("spotify_control" en `automatico` o `requiere_aprobacion`).
// Los resultados traen `private:true` cuando son datos personales; se devuelven tal cual al dueño
// y NUNCA se pasan a ningún modelo desde aquí (este módulo no llama al enrutador).
import { run } from "../db/client.js";
import { parsePhoneIntent, phoneReply } from "../phone/intents.js";
import { bestMatch } from "../music/match.js";

export function createTools({ db, approvals, audit, bus, permissions, websearch, google, youtube, spotify, games, whatsapp, phone, notify, status, now = () => Date.now() }) {
  const list = new Map();
  const add = (t) => list.set(t.name, t);
  const off = (c) => () => !!c?.enabled;
  const json = (o) => JSON.stringify(o, null, 1).slice(0, 3500);

  const spotifyAuto = () => (permissions?.automatico || []).includes("spotify_control") && !(permissions?.requiere_aprobacion || []).includes("spotify_control");

  add({ name: "jarvis.estado", desc: "Resumen del estado del hub", mode: "auto", private: false, enabled: () => true,
    run: async (userId) => {
      const s = await status(userId);
      return { text: `PC: ${s.pc.online ? "encendido" : "apagado"}. Cola: ${s.queue.total}. Aprobaciones pendientes: ${s.pendientes_aprobacion}. Proveedores activos: ${s.providers.filter((p) => p.estado === "activo").map((p) => p.id).join(", ") || "ninguno"}.` };
    } });
  add({ name: "web.buscar", desc: "Busca en la web con fuentes (nunca texto privado)", mode: "auto", private: false, enabled: () => true,
    run: async (userId, a) => {
      const r = await websearch.search({ userId, query: a.query, isPrivate: !!a.private });
      if (!r.ok) throw new Error(r.reason === "privado" ? "no busco en la web con texto privado" : "sin resultados");
      return { text: websearch.format(r), data: r };
    } });
  add({ name: "recordatorio.crear", desc: "Crea un recordatorio (en_minutos o due_at)", mode: "auto", private: false, enabled: () => true,
    run: async (userId, a) => {
      const due = a.due_at ? Number(a.due_at) : now() + Number(a.en_minutos) * 60_000;
      if (!a.text || !Number.isFinite(due)) throw new Error("faltan texto y hora");
      await run(db, "INSERT INTO reminders (user_id, text, due_at, created_at) VALUES (?,?,?,?)", [userId, String(a.text).slice(0, 500), due, now()]);
      return { text: `Anotado: "${String(a.text).slice(0, 80)}" en ${Math.max(1, Math.round((due - now()) / 60_000))} min.` };
    } });

  // Teléfono: deja una acción de la lista blanca en la cola del iPhone (las sensibles piden aprobación dentro de la cola)
  add({ name: "telefono.accion", desc: "Deja una acción en la cola del iPhone (args: accion+valor, o frase)", mode: "auto", private: false, enabled: () => !!phone,
    run: async (userId, a) => {
      let accion = a.accion, args = a;
      if (a.frase && !accion) {
        const p = parsePhoneIntent(a.frase, phone.config);
        if (p) { accion = p.action; args = p.args; }
        else { const [x, ...v] = String(a.frase).trim().split(/\s+/); accion = x; args = { valor: v.join(" ") }; }
      }
      const out = await phone.create({ userId, action: String(accion || ""), args, source: "tool" });
      if (!out.ok) throw new Error(out.error);
      return { text: phoneReply(out.item) };
    } });

  // Google
  add({ name: "google.correos", desc: "Lista correos recientes de Gmail", mode: "auto", private: true, enabled: off(google), run: async (u, a) => {
    const r = await google.listEmails(u, { q: a.q, max: a.max });
    return { data: r, text: r.length ? r.map((m) => `- ${m.from}: ${m.subject}`).join("\n") : "Sin correos." };
  } });
  add({ name: "google.eventos", desc: "Próximos eventos de Calendar", mode: "auto", private: true, enabled: off(google), run: async (u, a) => {
    const r = await google.listEvents(u, a);
    return { data: r, text: r.length ? r.map((e) => `- ${e.start}: ${e.summary}`).join("\n") : "Sin eventos." };
  } });
  add({ name: "google.archivos", desc: "Archivos recientes de Drive", mode: "auto", private: true, enabled: off(google), run: async (u, a) => {
    const r = await google.listFiles(u, { q: a.q, max: a.max });
    return { data: r, text: r.length ? r.map((x) => `- ${x.name}`).join("\n") : "Sin archivos." };
  } });
  add({ name: "google.enviar_correo", desc: "Envía un correo (APROBACIÓN)", mode: "approval", private: true, enabled: off(google),
    summary: (a) => `Enviar correo a ${a.to}: ${a.subject}`, validate: (a) => a.to && a.subject && a.body != null,
    run: async (u, a) => { await google.sendEmail(u, a); return { text: `Correo enviado a ${a.to}.` }; } });
  add({ name: "google.crear_evento", desc: "Crea un evento en Calendar (APROBACIÓN)", mode: "approval", private: true, enabled: off(google),
    summary: (a) => `Crear evento "${a.summary}" ${a.start}`, validate: (a) => a.summary && a.start && a.end,
    run: async (u, a) => { await google.createEvent(u, a); return { text: `Evento "${a.summary}" creado.` }; } });

  // YouTube (solo lectura). Playlists y pistas son datos personales; la búsqueda pública no.
  const pistas = (l) => l.map((x) => `- ${x.titulo}${x.canal ? ` (${x.canal})` : ""}`).join("\n");
  add({ name: "youtube.buscar", desc: "Busca canciones en YouTube (cuesta 100 unidades de cuota; max 5)", mode: "auto", private: false, enabled: off(youtube),
    validate: (a) => typeof a.q === "string" && a.q.trim().length > 0,
    run: async (u, a) => { const r = await youtube.search(u, { q: a.q, max: Math.min(Number(a.max) || 5, 5) }); return { items: r, data: r, text: r.length ? pistas(r) : "Sin resultados." }; } });
  add({ name: "youtube.mis_playlists", desc: "Sus playlists de YouTube", mode: "auto", private: true, enabled: off(youtube),
    run: async (u) => { const r = await youtube.playlists(u); return { items: r, data: r, text: r.length ? r.map((p) => `- ${p.titulo}${p.n != null ? ` (${p.n})` : ""}`).join("\n") : "Sin playlists." }; } });
  add({ name: "youtube.playlist", desc: "Canciones de una playlist (id o nombre)", mode: "auto", private: true, enabled: off(youtube),
    validate: (a) => !!(a.id || a.nombre),
    run: async (u, a) => {
      let id = a.id;
      if (!id) { id = bestMatch(await youtube.playlists(u), a.nombre).mejor?.id; if (!id) throw new Error("no_encontrado"); }
      const r = await youtube.items(u, id);
      return { items: r, data: r, text: r.length ? pistas(r) : "Sin canciones reproducibles." };
    } });
  add({ name: "youtube.cuota", desc: "Cuota de YouTube usada hoy", mode: "auto", private: false, enabled: off(youtube),
    run: async (u) => { const r = await youtube.usage(u); return { ...r, data: r, text: `Cuota de YouTube hoy: ${r.unidades} de ${r.tope} unidades.${r.pausado_hasta ? " En pausa hasta la medianoche del Pacífico." : ""}` }; } });

  // Spotify
  add({ name: "spotify.escuchando", desc: "Qué suena ahora", mode: "auto", private: true, enabled: off(spotify), run: async (u) => {
    const r = await spotify.nowPlaying(u);
    return { data: r, text: r.nombre ? `${r.sonando ? "Suena" : "En pausa"}: ${r.nombre} - ${r.artistas}` : "No hay nada sonando." };
  } });
  add({ name: "spotify.recientes", desc: "Últimas canciones", mode: "auto", private: true, enabled: off(spotify), run: async (u, a) => {
    const r = await spotify.recent(u, a.limit);
    return { data: r, text: r.map((t) => `- ${t.nombre} - ${t.artistas}`).join("\n") || "Nada reciente." };
  } });
  add({ name: "spotify.control", desc: "Controla la reproducción (según permissions.json)", mode: () => (spotifyAuto() ? "auto" : "approval"), private: true, enabled: off(spotify),
    summary: (a) => `Spotify: ${a.accion}`, validate: (a) => ["play", "pausa", "siguiente", "anterior"].includes(a.accion),
    run: async (u, a) => { await spotify.control(u, a.accion); return { text: `Listo: ${a.accion}.` }; } });

  // Juegos (solo lectura)
  add({ name: "games.estado", desc: "Estado del juego de fútbol", mode: "auto", private: false, enabled: off(games), run: async () => {
    const [h, f] = await Promise.allSettled([games.health(), games.features()]);
    const data = { health: h.value ?? null, features: f.value ?? null };
    return { data, text: `Juego: ${h.status === "fulfilled" && h.value?.ok ? "en línea" : "sin respuesta"}.\n${json(data.features)}` };
  } });
  add({ name: "games.ranking", desc: "Ranking global del juego (necesita GAMES_API_TOKEN)", mode: "auto", private: true,
    enabled: () => !!games?.enabled && !!games?.hasToken,
    run: async (u, a) => { const r = await games.ranking(a); return { data: r, text: json(r) }; } });
  add({ name: "games.progreso", desc: "Nivel y progreso del dueño en el juego (necesita GAMES_API_TOKEN)", mode: "auto", private: true,
    enabled: () => !!games?.enabled && !!games?.hasToken,
    run: async () => { const r = await games.progreso(); return { data: r, text: json(r) }; } });

  // WhatsApp (solo enviar; recibir va por el webhook)
  add({ name: "whatsapp.enviar", desc: "Envía un WhatsApp (APROBACIÓN)", mode: "approval", private: true, enabled: off(whatsapp),
    summary: (a) => `Enviar WhatsApp a ${a.to}: ${String(a.text).slice(0, 80)}`, validate: (a) => a.to && a.text,
    run: async (u, a) => { await whatsapp.send(a); return { text: `WhatsApp enviado a ${a.to}.` }; } });

  const modeOf = (t) => (typeof t.mode === "function" ? t.mode() : t.mode);
  const api = {
    names: () => [...list.keys()],
    describe: () => [...list.values()].map((t) => ({ name: t.name, desc: t.desc, mode: modeOf(t), private: t.private, enabled: !!t.enabled() })),
    // Punto de entrada: ejecuta o pide aprobación.
    async run({ userId, name, args = {} }) {
      const t = list.get(name);
      if (!t) return { status: "error", error: "herramienta_desconocida" };
      if (!t.enabled()) return { status: "error", error: "apagada" };
      if (t.validate && !t.validate(args)) return { status: "error", error: "argumentos_invalidos" };
      try {
        if (modeOf(t) === "approval") {
          const a = await approvals.request({ userId, kind: `tool:${name}`, summary: t.summary(args), detail: JSON.stringify(args) });
          return { status: "pendiente_aprobacion", approval_id: a.id, private: t.private };
        }
        const r = await t.run(userId, args);
        await audit?.log({ userId, action: `herramienta.${name}`, detail: "" });
        return { status: "ok", private: t.private, ...r };
      } catch (e) { return { status: "error", error: e.message }; }
    },
    // Tras aprobar: ejecuta de verdad.
    async executeApproved(approval) {
      const name = String(approval.kind).slice(5);
      const t = list.get(name);
      if (!t || !t.enabled()) return null;
      let args; try { args = JSON.parse(approval.detail || "{}"); } catch { return null; }
      try {
        const r = await t.run(approval.userId ?? approval.user_id, args);
        return { ok: true, text: r.text };
      } catch (e) { return { ok: false, text: `Falló: ${e.message}` }; }
    },
  };

  // Una aprobación "tool:*" aprobada se ejecuta aquí, venga del teléfono (web) o de Telegram.
  bus?.on("approval.resolved", async ({ userId, approval }) => {
    if (!approval?.kind?.startsWith("tool:") || approval.status !== "aprobada") return;
    try {
      const out = await api.executeApproved({ ...approval, userId });
      if (out) {
        await audit?.log({ userId, action: `herramienta.${approval.kind.slice(5)}`, detail: out.ok ? "ejecutada" : "falló" });
        await notify?.(out.text);
      }
    } catch (e) { console.error("[tools]", e.message); }
  });
  return api;
}
