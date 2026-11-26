// Navegador de Claude en el PC (docs/NAV.md): cola nav_tasks. El servidor es la autoridad de estados, topes y privacidad.
// La respuesta leída de una página es DATO: se guarda y se muestra, jamás se interpreta ni se pasa a un modelo como orden.
// Los frames (capturas en vivo) solo pasan al websocket del dueño: nunca se guardan.
import { all, get, run } from "./db/client.js";
import { urlPermitidaEscolar } from "./nav-url.js";

export const ESTADOS_RESULTADO = ["ok", "necesita_login", "captcha", "bloqueado", "vencida", "error", "cancelada", "cuenta_incorrecta"];
export const DATO = "dato_no_instruccion"; // marca en messages.provider
export const PERFIL_DE_TIPO = { preguntar_ia: "ia", buscar_google: "lectura", investigar: "lectura", estudio: "escolar", memoria_recoger: "ia", memoria_repartir: "ia" };
// Tipos cuyo contenido no se guarda aquí: lo procesa un manejador y solo queda su mensaje neutro.
const OPACOS = new Set(["estudio", "memoria_recoger", "memoria_repartir"]);
const ETIQUETAS = { memoria_recoger: "Recoger memoria", memoria_repartir: "Repartir memoria" }; // en la web no se repite el texto enviado
const MAX_CONSULTA = 4000;
const MAX_RESPUESTA = 20_000;
const MAX_PASOS = 30;
const MAX_ITEMS = 100;
const MAX_FRAME = 400 * 1024;
const FRAME_MS = 2500; // el PC manda uno cada ~3 s; margen para el vaivén de la red
const HORA = 3_600_000, DIA = 86_400_000;

const MENSAJES = {
  necesita_login: (n) => `${n} pide iniciar sesión, señor. Entre usted en Chrome del PC y vuelva a pedírmelo.`,
  captcha: (n) => `${n} mostró un CAPTCHA, señor. No los resuelvo: hágalo en Chrome del PC y vuelva a pedírmelo.`,
  bloqueado: (n) => `No pude seguir en ${n}, señor: el navegador quedó bloqueado.`,
  vencida: (n) => `La consulta a ${n} venció sin respuesta, señor. Revise que el PC siga encendido y vuelva a pedirlo.`,
  error: (n) => `Hubo un error al consultar ${n}, señor.`,
  cancelada: (n) => `Cancelé la consulta a ${n}, señor.`,
  cuenta_incorrecta: (n) => `${n} está abierto con otra cuenta, señor: descarté lo leído.`,
};

// Herramientas que se cuentan como paso en vivo (el texto lo pone el servidor, no el PC).
const PASOS = {
  ToolSearch: "Preparo el navegador", tabs_context_mcp: "Reviso las pestañas", tabs_create_mcp: "Abro una pestaña",
  navigate: "Abro", read_page: "Leo la página", get_page_text: "Leo la página", find: "Busco en la página",
  computer: "Miro la página", form_input: "Escribo en la página",
};

const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const urlWeb = (v) => {
  const s = texto(v, 2001);
  return /^https?:\/\//i.test(s) && s.length <= 2000 ? s : "";
};
const json = (s, def = []) => { try { return JSON.parse(s) ?? def; } catch { return def; } };

function limpiarFuentes(f) {
  const out = [];
  for (const x of Array.isArray(f) ? f : []) {
    const url = urlWeb(x?.url);
    if (!url) continue;
    out.push({ titulo: String(x.titulo || url).slice(0, 300), url });
    if (out.length >= 10) break;
  }
  return out;
}

const limpiarItems = (items) => (Array.isArray(items) ? items : []).slice(0, MAX_ITEMS).filter((x) => x && typeof x === "object").map((x) => ({
  curso: texto(x.curso, 200), tipo: texto(x.tipo, 60), titulo: texto(x.titulo, 300), fecha: texto(x.fecha, 60), url: urlWeb(x.url), resumen: texto(x.resumen, 1000),
}));

export function createNav({ db, config, agent, chat, privacy, bus, audit, websearch = null, now = () => Date.now() }) {
  const cfg = config;
  const err = (status, error, mensaje) => Object.assign(new Error(error), { status, error, mensaje });
  const lim = () => cfg.limites;
  const nombre = (sitio) => cfg.sitios[sitio]?.nombre || sitio;
  const perfilDe = (t) => t.perfil || PERFIL_DE_TIPO[t.tipo] || "ia";
  const count = async (sql, args) => Number((await get(db, sql, args))?.n ?? 0);
  const log = (userId, action, detail) => audit?.log({ userId, action, detail });
  const manejadores = new Map(); // tipo -> handler (hoy solo "estudio")
  const ultimoFrame = new Map(); // id de tarea -> instante
  const fila = (id) => get(db, "SELECT * FROM nav_tasks WHERE id=?", [id]);

  const vista = (t) => ({
    id: Number(t.id), tipo: t.tipo, sitio: t.sitio, sitio_nombre: nombre(t.sitio), consulta: ETIQUETAS[t.tipo] || t.consulta, estado: t.estado,
    respuesta: t.respuesta || "", fuentes: json(t.fuentes), url_conversacion: t.url_conversacion || null, pasos: json(t.pasos),
    creado: Number(t.creado), terminado: t.terminado == null ? null : Number(t.terminado),
  });

  // Estudio y memoria: nada de lo leído se guarda aquí; solo el mensaje neutro que devuelve el manejador.
  async function manejar(t, resultado) {
    const h = manejadores.get(t.tipo);
    let estado = t.estado, mensaje = "";
    try {
      if (!h) throw new Error("sin_manejador");
      const r = await h({ ...t, id: Number(t.id), user_id: Number(t.user_id) }, { ...resultado, estado: t.estado });
      mensaje = texto(r?.mensaje, 2000);
      if (ESTADOS_RESULTADO.includes(r?.estado)) estado = r.estado;
    } catch {
      if (estado === "ok") estado = "error";
      await log(Number(t.user_id), "nav.manejador_fallo", `#${t.id}`); // sin detalle: podría llevar contenido leído
    }
    mensaje ||= estado === "ok" ? "Terminé la revisión, señor." : MENSAJES[estado](nombre(t.sitio));
    await run(db, "UPDATE nav_tasks SET estado=?, respuesta=?, consulta=? WHERE id=?", [estado, mensaje, ETIQUETAS[t.tipo] || t.consulta, t.id]);
    return { ...t, estado, respuesta: mensaje };
  }

  // Perfil lectura: si el navegador falla, se responde con la búsqueda por API.
  async function respaldo(t) {
    let w;
    try { w = await websearch?.search({ userId: Number(t.user_id), query: t.consulta }); } catch { return t; }
    if (!w?.ok) return t;
    const respuesta = `(El navegador no pudo; esto viene de la búsqueda normal.)\n${w.text}`.slice(0, MAX_RESPUESTA);
    const fuentes = JSON.stringify(limpiarFuentes((w.sources || []).map((s) => ({ titulo: s.title, url: s.url }))));
    const error = `respaldo_api: ${t.estado}${t.error ? ` ${t.error}` : ""}`.slice(0, 500);
    await run(db, "UPDATE nav_tasks SET estado='ok', respuesta=?, fuentes=?, error=? WHERE id=?", [respuesta, fuentes, error, t.id]);
    return { ...t, estado: "ok", respuesta, fuentes, error };
  }

  // Tras cerrar una tarea: manejador o respaldo, mensaje en la conversación y aviso a la web.
  async function avisar(id, resultado = {}) {
    let t = await fila(id);
    ultimoFrame.delete(Number(id));
    const opaco = OPACOS.has(t.tipo);
    if (opaco) t = await manejar(t, resultado);
    else if (perfilDe(t) === "lectura" && !["ok", "cancelada"].includes(t.estado)) t = await respaldo(t);
    const ok = t.estado === "ok";
    const fuentes = ok && !opaco ? json(t.fuentes) : [];
    const respuesta = ok || opaco ? t.respuesta : MENSAJES[t.estado](nombre(t.sitio));
    const conv = t.conversation_id == null ? null : Number(t.conversation_id);
    if (conv != null) {
      const dato = ok && !opaco;
      const lista = fuentes.length ? "\n\nFuentes:\n" + fuentes.map((f) => `- ${f.titulo}: ${f.url}`).join("\n") : "";
      const cuerpo = dato ? `Respuesta de ${nombre(t.sitio)} (dato leído de la web):\n${respuesta}${lista}` : respuesta;
      await run(db, "INSERT INTO messages (user_id, conversation_id, role, content, provider, private, created_at) VALUES (?,?,'assistant',?,?,0,?)",
        [t.user_id, conv, cuerpo, dato ? DATO : "nav", now()]);
    }
    bus?.emit("nav.done", { userId: Number(t.user_id), task: { id: Number(t.id), tipo: t.tipo, sitio: t.sitio, estado: t.estado, respuesta, fuentes, url_conversacion: t.url_conversacion || null, conversation_id: conv } });
  }

  // Cierra las tareas sin respuesta (180 s más margen), tanto sin reclamar como en curso.
  async function sweep(userId) {
    const t = now(), limite = t - (lim().timeout_s + lim().margen_s) * 1000;
    const viejas = await all(db, "SELECT id FROM nav_tasks WHERE user_id=? AND ((estado='pendiente' AND creado<?) OR (estado='en_curso' AND tomado<?))", [userId, limite, limite]);
    for (const { id } of viejas) {
      const u = await run(db, "UPDATE nav_tasks SET estado='vencida', terminado=? WHERE id=? AND estado IN ('pendiente','en_curso')", [t, id]);
      if (u.changes) await avisar(id);
    }
  }

  const disponible = () => {
    agent.sweep();
    return !!agent.view().online && !!agent.capabilities()?.chrome?.ok;
  };

  // La tarea es del usuario y, si ya la tomó un dispositivo, de ese dispositivo.
  async function propia(userId, deviceId, id) {
    const t = await get(db, "SELECT * FROM nav_tasks WHERE id=? AND user_id=?", [id, userId]);
    if (!t || (t.device_id != null && Number(t.device_id) !== Number(deviceId))) throw err(404, "no_existe");
    return t;
  }

  // La URL de partida la pone el servidor; solo estudio admite una propia, y dentro de la lista blanca.
  function urlInicialDe(tipo, sitio, consulta, urlInicial) {
    const s = cfg.sitios[sitio];
    if (PERFIL_DE_TIPO[tipo] === "lectura") return `https://www.google.com/search?q=${encodeURIComponent(consulta.slice(0, 500))}`;
    if (tipo === "estudio" && urlInicial) {
      if (!urlPermitidaEscolar(urlInicial, s.hosts)) throw err(400, "url_no_permitida", "Esa dirección no está permitida, señor.");
      return urlInicial;
    }
    return s.url_inicial;
  }

  const conversacionValida = (sitio, url) => {
    const patron = cfg.sitios[sitio]?.patron_conversacion;
    return !!patron && typeof url === "string" && url.length <= 500 && new RegExp(patron).test(url);
  };

  // Seguir el mismo chat: la última conversación de esta charla de Jarvis o, si no, de las últimas N horas.
  async function chatAnterior(userId, sitio, conversationId) {
    if (!cfg.sitios[sitio]?.continuar) return null;
    const filas = await all(db, `SELECT url_conversacion FROM nav_tasks WHERE user_id=? AND sitio=? AND tipo='preguntar_ia' AND url_conversacion IS NOT NULL
      AND (conversation_id=? OR creado>=?) ORDER BY COALESCE(conversation_id=?, 0) DESC, id DESC LIMIT 5`,
      [userId, sitio, conversationId, now() - (Number(cfg.continuar_horas) || 0) * HORA, conversationId]);
    return filas.map((f) => f.url_conversacion).find((u) => conversacionValida(sitio, u)) || null;
  }

  return {
    config: cfg,
    activo: () => cfg.activo === true,
    sweep,
    registrar(tipo, handler) { manejadores.set(tipo, handler); },
    async enqueue({ userId, conversationId = null, tipo, sitio, consulta, text = consulta, flagPrivate = false, urlInicial = null, cuenta = null, capturas = false, nuevo = false }) {
      if (!cfg.activo) throw err(403, "nav_apagado", "El navegador de Claude está apagado, señor.");
      const perfil = PERFIL_DE_TIPO[tipo];
      if (!perfil || cfg.sitios[sitio]?.perfil !== perfil) throw err(400, "sitio_desconocido", "No conozco ese sitio, señor.");
      consulta = typeof consulta === "string" ? consulta.trim() : "";
      if (!consulta) throw err(400, "texto_vacio", "¿Qué quiere que consulte, señor?");
      if (consulta.length > MAX_CONSULTA) throw err(413, "texto_largo", "Es demasiado largo para el navegador, señor.");
      // Privacidad primero: lo privado NUNCA va a un sitio web (tampoco a claude.ai). En estudio y memoria la consulta la arma el servidor, ya filtrada.
      if (!OPACOS.has(tipo)) {
        const priv = await chat.checkPrivate({ userId, text, flagPrivate });
        try { privacy.assert(`web_${sitio}`, priv); } catch { throw err(403, "privado_no_sitio", "Eso es privado, señor: no lo llevo a un sitio web."); }
      }
      let url = urlInicialDe(tipo, sitio, consulta, urlInicial);
      if (!disponible()) throw err(409, "pc_apagado", "Su PC no está conectado con el navegador, señor: no encolé nada.");
      await sweep(userId);
      const t = now(), L = lim();
      if (await count("SELECT COUNT(*) AS n FROM nav_tasks WHERE user_id=? AND creado>=?", [userId, t - HORA]) >= L.por_hora) throw err(429, "tope_hora", `Llegué al tope de ${L.por_hora} consultas por hora con el navegador, señor.`);
      if (await count("SELECT COUNT(*) AS n FROM nav_tasks WHERE user_id=? AND creado>=?", [userId, t - DIA]) >= L.por_dia) throw err(429, "tope_dia", `Llegué al tope de ${L.por_dia} consultas por día con el navegador, señor.`);
      const ajuste = await get(db, "SELECT value FROM settings WHERE user_id=? AND key='nav_capturas'", [userId]);
      if (tipo === "preguntar_ia" && !nuevo) url = (await chatAnterior(userId, sitio, conversationId)) || url;
      const correo = texto(typeof cuenta === "string" ? cuenta : cuenta?.correo, 200) || null;
      const r = await run(db, "INSERT INTO nav_tasks (user_id, conversation_id, tipo, sitio, consulta, estado, creado, perfil, capturas, url_inicial, cuenta) VALUES (?,?,?,?,?,'pendiente',?,?,?,?,?)",
        [userId, conversationId, tipo, sitio, consulta, t, perfil, capturas || ajuste?.value === "1" ? 1 : 0, url, correo]);
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
      const perfil = perfilDe(t), s = cfg.sitios[t.sitio];
      const hosts = perfil === "lectura" ? ["*"] : perfil === "escolar" ? s.hosts : cfg.hosts;
      bus?.emit("nav.inicio", { userId: Number(userId), task: { id: Number(t.id), tipo: t.tipo, sitio: t.sitio, sitio_nombre: nombre(t.sitio), consulta: ETIQUETAS[t.tipo] || t.consulta } });
      // La dirección de un chat empezado se revalida antes de entregarla.
      const continuacion = perfil === "ia" && t.url_inicial !== s.url_inicial && conversacionValida(t.sitio, t.url_inicial);
      const inicial = perfil === "ia" ? (continuacion ? t.url_inicial : s.url_inicial) : t.url_inicial || s.url_inicial;
      return {
        task: {
          id: Number(t.id), tipo: t.tipo, sitio: t.sitio, perfil, consulta: t.consulta, url_inicial: inicial, ...(continuacion ? { continuacion: true } : {}),
          capturas: !!Number(t.capturas), cuenta: t.cuenta ? { correo: t.cuenta } : null,
          limites: { hosts, hosts_negados: cfg.hosts_negados, timeout_s: lim().timeout_s, max_turnos: lim().max_turnos, max_paginas: cfg.perfiles[perfil].max_paginas },
        },
      };
    },
    // Avance y latido del PC. Responde si debe abandonar la tarea.
    async events(userId, deviceId, id, { pasos, frame } = {}) {
      await sweep(userId);
      const t = await propia(userId, deviceId, id);
      if (t.estado !== "en_curso" || Number(t.device_id) !== Number(deviceId)) return { cancelado: true };
      const nuevos = [];
      for (const p of Array.isArray(pasos) ? pasos.slice(0, MAX_PASOS) : []) {
        const corto = String(p?.herramienta || "").replace(/^mcp__claude-in-chrome__/, "");
        if (!Object.hasOwn(PASOS, corto)) continue;
        let url = urlWeb(p.url), host = "";
        try { const u = new URL(url); host = u.hostname; if (t.tipo === "estudio") url = u.origin; } catch { url = ""; }
        const base = PASOS[corto];
        const frase = corto === "navigate" ? `${base} ${host || "una página"}` : host ? `${base} (${host})` : base;
        nuevos.push({ t: now(), texto: frase, url });
      }
      if (nuevos.length) {
        await run(db, "UPDATE nav_tasks SET pasos=? WHERE id=?", [JSON.stringify([...json(t.pasos), ...nuevos].slice(-MAX_PASOS)), t.id]);
        for (const p of nuevos) bus?.emit("nav.paso", { userId: Number(userId), task_id: Number(t.id), texto: p.texto, url: p.url, t: p.t });
      }
      // La captura solo se reenvía si la tarea la pidió; nunca toca la base ni el registro.
      if (Number(t.capturas) && frame && ["image/jpeg", "image/png", "image/webp"].includes(frame.mime) && typeof frame.data === "string"
        && frame.data.length <= Math.ceil(MAX_FRAME / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(frame.data)
        && now() - (ultimoFrame.get(Number(t.id)) ?? -Infinity) >= FRAME_MS) {
        ultimoFrame.set(Number(t.id), now());
        bus?.emit("nav.frame", { userId: Number(userId), task_id: Number(t.id), mime: frame.mime, data: frame.data });
      }
      return { cancelado: false };
    },
    async result(userId, deviceId, id, { estado, respuesta, fuentes, error, url_conversacion, session_id, cuenta_visible, items } = {}) {
      if (!ESTADOS_RESULTADO.includes(estado)) throw err(400, "estado_invalido");
      await sweep(userId);
      const t = await propia(userId, deviceId, id);
      const estudio = t.tipo === "estudio", opaco = OPACOS.has(t.tipo);
      const cuerpo = texto(respuesta, MAX_RESPUESTA);
      const final = estado === "ok" && !cuerpo && !estudio ? "error" : estado;
      const limpias = limpiarFuentes(fuentes);
      const conv = perfilDe(t) === "ia" && conversacionValida(t.sitio, url_conversacion) ? url_conversacion : null;
      const sesion = !estudio && /^[\w-]{1,100}$/.test(session_id || "") ? session_id : null;
      const visible = texto(cuenta_visible, 200) || null;
      const motivo = error ? String(error).slice(0, 500) : null;
      const u = await run(db, "UPDATE nav_tasks SET estado=?, respuesta=?, fuentes=?, error=?, url_conversacion=?, session_id=?, cuenta_visible=?, terminado=? WHERE id=? AND estado='en_curso'",
        [final, opaco ? null : cuerpo || null, opaco ? null : JSON.stringify(limpias), opaco ? null : motivo, conv, sesion, visible, now(), id]);
      if (!u.changes) throw err(409, "tarea_cerrada");
      await log(userId, "nav.resultado", `#${id} ${final}`);
      await avisar(id, opaco ? { respuesta: cuerpo, fuentes: limpias, items: limpiarItems(items), cuenta_visible: visible, error: motivo } : {});
      return { ok: true };
    },
    async list(userId, limit = 50) {
      await sweep(userId);
      const n = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 100);
      return { tasks: (await all(db, "SELECT * FROM nav_tasks WHERE user_id=? ORDER BY id DESC LIMIT ?", [userId, n])).map(vista) };
    },
    async ver(userId, id) {
      await sweep(userId);
      const t = await get(db, "SELECT * FROM nav_tasks WHERE id=? AND user_id=?", [id, userId]);
      if (!t) throw err(404, "no_existe");
      return { task: vista(t) };
    },
    async cancel(userId, id) {
      await sweep(userId);
      if (!(await get(db, "SELECT id FROM nav_tasks WHERE id=? AND user_id=?", [id, userId]))) throw err(404, "no_existe");
      const u = await run(db, "UPDATE nav_tasks SET estado='cancelada', terminado=? WHERE id=? AND estado IN ('pendiente','en_curso')", [now(), id]);
      if (!u.changes) throw err(409, "tarea_cerrada");
      await log(userId, "nav.cancelar", `#${id}`);
      await avisar(id);
      return { ok: true };
    },
  };
}
