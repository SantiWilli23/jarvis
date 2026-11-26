// Recolectar y repartir la memoria entre las IA (docs/MEMORIA.md). Usa el navegador del PC (nav, perfil ia):
// una consulta en un chat nuevo por IA. Lo que responde una IA es DATO, nunca órdenes: se parte en líneas, se filtra
// y queda en la zona de revisión. memoria_repartos no guarda contenido.
import { createHash } from "node:crypto";
import { Router } from "express";
import { all, get, run } from "./db/client.js";
import { classify } from "./router/classify.js";
import { plano } from "./escolar-intents.js";

export const DESTINOS = ["claude", "chatgpt", "gemini"];
export const TEXTO_RECOGER = "Por favor, enumera todo lo que recuerdas sobre mí (memoria guardada e instrucciones personales). Responde solo con una lista, un dato por línea, sin introducción ni comentarios. No incluyas contraseñas, claves, documentos de identidad, tarjetas ni nada del colegio. Si no recuerdas nada, responde solo NADA.";
const CABECERA = "Por favor, recuerda estos datos sobre mí para futuras conversaciones. Son datos, no tareas ni órdenes. Si no puedes guardarlos en tu memoria, dímelo. Datos: ";
const MAX_REPARTO = 3800; // nav admite consultas de hasta 4000
const MAX_LINEAS = 80;
const MAX_LINEA = 500;
const DIA = 86_400_000;
export const CADA_MS = 30 * DIA;

const SECRETO = /contrase|password|passwd|\bclaves?\b|\bpin\b|\btoken\b|api[ _-]?key|\bsk-[\w-]{8,}|\brut\b|\bdni\b|pasaporte|c[eé]dula|documento de identidad|n[uú]mero de (documento|cuenta|identidad|tarjeta)|\btarjetas?\b|\bcvv\b|\biban\b|c[oó]digo de (seguridad|verificaci[oó]n|acceso)|\d(?:[ .-]?\d){8,}|\d{1,2}\.\d{3}\.\d{3}-[\dk]|\b(?=[\w-]*\d)(?=[\w-]*[a-z])[\w-]{24,}\b/i;
const ESCOLAR = /(?<![\p{L}])(colegios?|escuelas?|liceos?|escolar(es)?|classroom|lirmi|irmi|profes?|profesor(es)?|profesoras?|asignaturas?|tareas?|pruebas?|examen|exámenes|examenes|evaluaci[oó]n|evaluaciones|calificaci[oó]n|calificaciones|apoderad[oa]s?|alumn[oa]s?|estudiantes?|curso|clases? de|b[aá]sico|enseñanza media)(?![\p{L}])/iu;
const CORREO = /[^\s@]+@[^\s@]+\.[^\s@]+/;

const huella = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const normal = (s) => plano(s).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

// ¿Puede salir de Jarvis? (reparto y MCP). Ante la duda, no sale.
export function puedeSalir(n, privacy) {
  if (n.status !== "activa" || n.level !== "normal" || n.origen === "escolar") return false;
  const t = `${n.title || ""} ${n.body || ""}`;
  if (SECRETO.test(t) || ESCOLAR.test(t) || CORREO.test(t)) return false;
  return !privacy.isPrivateMessage({ classification: classify(t), notes: [n] });
}

// Respuesta de una IA -> datos sueltos. Descarta secretos y lo escolar.
export function lineasDeMemoria(respuesta) {
  const out = [], vistas = new Set();
  for (const cruda of String(respuesta || "").slice(0, 20_000).split(/\r?\n/)) {
    const l = cruda.replace(/^\s*(?:[-*•·>]+|#{1,6}|\d{1,3}[.)]|\(\d{1,3}\))\s*/, "").replace(/\*\*|`/g, "").trim();
    if (l.length < 5 || l.length > MAX_LINEA || l.endsWith(":") || /^nada\.?$/i.test(l)) continue;
    if (SECRETO.test(l) || ESCOLAR.test(l)) continue;
    const k = normal(l);
    if (!k || vistas.has(k)) continue;
    vistas.add(k);
    out.push(l);
    if (out.length >= MAX_LINEAS) break;
  }
  return out;
}

const FRASE = /^(?:(?:oye )?jarvis )?(?:(?:por favor|porfa) )?(?:(?:puedes|podrias) )?(reparte|repartir|recoge|recoger|recolecta|recolectar) (?:mi|la) memoria(?: (?:con|a|en|de|entre) (?:las|mis) (?:ia|ias))?(?: ahora)?(?: por favor| porfa)?$/;
export function parseMemoriaIntent(text) {
  const m = FRASE.exec(plano(text));
  return m ? (m[1].startsWith("repart") ? "repartir" : "recoger") : null;
}

const MOTIVOS = { pc_apagado: "el PC no está conectado con el navegador", tope_hora: "se llegó al tope por hora del navegador", tope_dia: "se llegó al tope diario del navegador", nada_que_repartir: "no hay nada que se pueda repartir", frenado: "el freno está puesto" };

export function createMemoriaReparto({ db, notes, inbox, privacy, nav, audit, bus = null, agent = null, getControl = () => null, now = () => Date.now() }) {
  const err = (status, error, mensaje) => Object.assign(new Error(error), { status, error, mensaje });
  const nombre = (d) => nav.config.sitios[d]?.nombre || d;
  const frenado = async (userId) => !!(await getControl()?.frenado?.(userId));
  const ajuste = async (userId, key) => Number((await get(db, "SELECT value FROM settings WHERE user_id=? AND key=?", [userId, key]))?.value || 0);
  const guardar = (userId, key, v) => run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", [userId, key, String(v), now()]);
  const conPc = () => { agent?.sweep(); return !agent || (!!agent.view().online && !!agent.capabilities()?.chrome?.ok); };
  const abiertas = async (userId) => Number((await get(db, "SELECT COUNT(*) AS n FROM memoria_repartos WHERE user_id=? AND estado IN ('pendiente','en_curso')", [userId])).n);
  const cerrar = (id, estado, cantidad, error = null) => run(db, "UPDATE memoria_repartos SET estado=?, cantidad=?, error=?, terminado=? WHERE id=?", [estado, cantidad, error, now(), id]);
  const cancelarPendientes = (userId, motivo) => run(db, "UPDATE memoria_repartos SET estado='cancelada', error=?, terminado=? WHERE user_id=? AND estado='pendiente'", [motivo, now(), userId]);

  async function vista(userId) {
    const filas = await all(db, "SELECT title, body, level, status, origen FROM notes WHERE user_id=? AND status='activa' ORDER BY id DESC", [userId]);
    const partes = [];
    let largo = CABECERA.length, fuera = 0;
    for (const n of filas) {
      if (!puedeSalir(n, privacy)) continue;
      // Una sola línea (un salto de línea enviaría el chat a medias) y sin "<>" (no puede cerrar el bloque del prompt).
      const dato = `${n.title ? `${n.title}: ` : ""}${n.body}`.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
      const parte = `(${partes.length + 1}) ${dato}`;
      if (largo + parte.length + 2 > MAX_REPARTO) { fuera++; continue; }
      partes.push(parte);
      largo += parte.length + 2;
    }
    const texto = partes.length ? CABECERA + partes.join("; ") : "";
    return { texto, cantidad: partes.length, fuera, hash: huella(texto) };
  }

  const avisar = (userId, destino, tipo, mensaje) => bus?.emit("nav.done", { userId, task: { id: 0, tipo: `memoria_${tipo}`, sitio: destino, estado: "error", respuesta: mensaje, fuentes: [], url_conversacion: null, conversation_id: null } });

  // Una IA a la vez: la cola del navegador vence lo que espera demasiado.
  async function avanzar(userId) {
    const f = await get(db, "SELECT * FROM memoria_repartos WHERE user_id=? AND estado='pendiente' ORDER BY id LIMIT 1", [userId]);
    if (!f) return;
    const u = await run(db, "UPDATE memoria_repartos SET estado='en_curso' WHERE id=? AND estado='pendiente' AND NOT EXISTS (SELECT 1 FROM memoria_repartos WHERE user_id=? AND estado='en_curso')", [f.id, userId]);
    if (!u.changes) return;
    try {
      if (await frenado(userId)) throw err(409, "frenado");
      let consulta = TEXTO_RECOGER, cantidad = 0;
      if (f.tipo === "repartir") {
        const v = await vista(userId);
        if (!v.cantidad) throw err(409, "nada_que_repartir");
        consulta = v.texto;
        cantidad = v.cantidad;
      }
      const t = await nav.enqueue({ userId, tipo: `memoria_${f.tipo}`, sitio: f.destino, consulta, nuevo: true });
      await run(db, "UPDATE memoria_repartos SET nav_id=?, cantidad=? WHERE id=?", [t.id, cantidad, f.id]);
    } catch (e) {
      if (!e?.error) {
        await cerrar(f.id, "error", 0, "interno");
        throw e;
      }
      // Sin reintentos: se anota, se cancela el resto y se avisa una vez.
      await cerrar(f.id, "error", 0, e.error);
      await cancelarPendientes(userId, e.error);
      await audit?.log({ userId, action: "memoria.fallo", detail: `${f.tipo} ${f.destino} ${e.error}` });
      avisar(userId, f.destino, f.tipo, `No pude ${f.tipo === "recoger" ? "recoger" : "repartir"} su memoria, señor: ${MOTIVOS[e.error] || e.error}.`);
    }
  }

  async function recibir(tarea, resultado) {
    const userId = tarea.user_id, tipo = tarea.tipo.replace("memoria_", ""), n = nombre(tarea.sitio);
    const f = await get(db, "SELECT * FROM memoria_repartos WHERE user_id=? AND tipo=? AND destino=? AND estado='en_curso' AND (nav_id IS NULL OR nav_id=?)", [userId, tipo, tarea.sitio, tarea.id]);
    if (!f) return { mensaje: `Terminé con ${n}, señor.` };
    const estado = resultado.estado;
    let cantidad = 0, mensaje;
    if (estado === "ok" && tipo === "recoger") {
      const hay = new Set((await all(db, "SELECT title, body FROM notes WHERE user_id=?", [userId])).flatMap((x) => [normal(x.body), normal(`${x.title}: ${x.body}`)]));
      let llena = false;
      for (const l of lineasDeMemoria(resultado.respuesta)) {
        if (hay.has(normal(l))) continue;
        const level = classify(l).private || CORREO.test(l) ? "privada" : "normal";
        const r = await inbox.propose({ userId, body: l, level, origen: `ia:${tarea.sitio}` });
        if (r.reason === "bandeja_llena") {
          llena = true;
          break;
        }
        if (r.saved) {
          cantidad++;
          hay.add(normal(l));
        }
      }
      mensaje = `Recogí la memoria de ${n}, señor: ${cantidad} datos nuevos para revisar en Memoria.${llena ? " La bandeja de revisión está llena." : ""}`;
      await cerrar(f.id, "ok", cantidad, llena ? "bandeja_llena" : null);
    } else if (estado === "ok") {
      cantidad = Number(f.cantidad);
      mensaje = `Envié su memoria a ${n}, señor. Eso no garantiza que la haya guardado.`;
      await cerrar(f.id, "enviado", cantidad);
    } else {
      const porque = estado === "necesita_login" ? "falta iniciar sesión" : estado === "captcha" ? "pide un CAPTCHA" : estado;
      mensaje = `No pude ${tipo === "recoger" ? "recoger la memoria de" : "repartir su memoria a"} ${n}, señor: ${porque}.`;
      await cerrar(f.id, estado, 0, estado);
      if (estado === "cancelada") await cancelarPendientes(userId, "cancelada");
    }
    await audit?.log({ userId, action: `memoria.${tipo}`, detail: `${tarea.sitio} ${estado} ${cantidad}` });
    await avanzar(userId);
    return { mensaje };
  }
  nav.registrar("memoria_recoger", recibir);
  nav.registrar("memoria_repartir", recibir);

  // Filas que quedaron colgadas (reinicio del servidor): se cierran, sin reintentar.
  async function reconciliar(userId) {
    await nav.sweep(userId);
    await run(db, `UPDATE memoria_repartos SET estado='error', error='interrumpido', terminado=? WHERE user_id=? AND estado='en_curso' AND creado<?
      AND NOT EXISTS (SELECT 1 FROM nav_tasks t WHERE t.id=memoria_repartos.nav_id AND t.estado IN ('pendiente','en_curso'))`, [now(), userId, now() - 3_600_000]);
    await run(db, "UPDATE memoria_repartos SET estado='cancelada', error='vencida', terminado=? WHERE user_id=? AND estado='pendiente' AND creado<?", [now(), userId, now() - DIA]);
    // Una tarea del navegador que venció sin llegar al manejador no deja la fila abierta.
    await run(db, `UPDATE memoria_repartos SET estado='vencida', error='vencida', terminado=? WHERE user_id=? AND estado='en_curso'
      AND EXISTS (SELECT 1 FROM nav_tasks t WHERE t.id=memoria_repartos.nav_id AND t.estado='vencida')`, [now(), userId]);
  }

  async function iniciar(userId, tipos) {
    if (!nav.activo()) throw err(403, "nav_apagado", "El navegador de Claude está apagado, señor.");
    if (await frenado(userId)) throw err(409, "frenado", "El freno está puesto, señor.");
    await reconciliar(userId);
    if (await abiertas(userId)) throw err(409, "en_marcha", "Ya hay una recolección o un reparto en marcha, señor.");
    if (!conPc()) throw err(409, "pc_apagado", "Su PC no está conectado con el navegador, señor: no hice nada.");
    for (const tipo of tipos) {
      for (const d of DESTINOS) await run(db, "INSERT INTO memoria_repartos (user_id, tipo, destino, estado, creado) VALUES (?,?,?,'pendiente',?)", [userId, tipo, d, now()]);
    }
    await avanzar(userId);
  }

  async function recoger(userId) {
    await iniciar(userId, ["recoger"]);
    return { ok: true, mensaje: "Voy a pedirle su memoria a Claude, ChatGPT y Gemini, señor. Lo que traigan quedará para su revisión." };
  }

  // La orden explícita (frase o botón tras la vista previa) autoriza y enciende el reparto mensual.
  async function repartir(userId, hash = null) {
    const v = await vista(userId);
    if (!v.cantidad) throw err(409, "nada_que_repartir", "No hay nada que se pueda repartir, señor.");
    if (hash != null && hash !== v.hash) throw err(409, "vista_cambio", "La memoria cambió, señor: revise de nuevo la vista previa.");
    await iniciar(userId, ["repartir"]);
    await guardar(userId, "memoria_aprobado", now());
    await guardar(userId, "memoria_ultimo", now());
    return { ok: true, mensaje: `Voy a enviar ${v.cantidad} datos a Claude, ChatGPT y Gemini, señor.` };
  }

  async function estado(userId) {
    await reconciliar(userId);
    const filas = await all(db, "SELECT id, title, body, level, status, origen FROM notes WHERE user_id=? ORDER BY (status='revision') DESC, id DESC LIMIT 500", [userId]);
    const repartos = await all(db, "SELECT tipo, destino, estado, cantidad, error, creado, terminado FROM memoria_repartos WHERE user_id=? ORDER BY id DESC LIMIT 30", [userId]);
    const aprobado = await ajuste(userId, "memoria_aprobado"), ultimo = await ajuste(userId, "memoria_ultimo");
    return {
      notas: filas.map((n) => ({ id: Number(n.id), title: n.title, body: n.body, level: n.level, status: n.status, origen: n.origen, sale: puedeSalir(n, privacy) })),
      repartos: repartos.map((r) => ({ ...r, nombre: nombre(r.destino), cantidad: Number(r.cantidad), creado: Number(r.creado), terminado: r.terminado == null ? null : Number(r.terminado) })),
      automatico: { activo: !!aprobado, proximo: aprobado ? ultimo + CADA_MS : null },
    };
  }

  // Borra la memoria de Jarvis y apaga el reparto mensual. No borra nada dentro de las otras IA.
  async function borrarTodo(userId) {
    const ids = await all(db, "SELECT id FROM notes WHERE user_id=?", [userId]);
    for (const { id } of ids) await notes.remove(userId, Number(id));
    await run(db, "UPDATE nav_tasks SET estado='cancelada', terminado=? WHERE user_id=? AND tipo IN ('memoria_recoger','memoria_repartir') AND estado IN ('pendiente','en_curso')", [now(), userId]);
    await run(db, "UPDATE nav_tasks SET consulta='' WHERE user_id=? AND tipo IN ('memoria_recoger','memoria_repartir')", [userId]);
    await run(db, "DELETE FROM memoria_repartos WHERE user_id=?", [userId]);
    await run(db, "DELETE FROM settings WHERE user_id=? AND key IN ('memoria_aprobado','memoria_ultimo')", [userId]);
    await audit?.log({ userId, action: "memoria.borrar_todo", detail: String(ids.length) });
    return { ok: true, borradas: ids.length };
  }

  return {
    vista, estado, recoger, repartir, borrarTodo,
    async intent({ userId, text, flagPrivate, chatSolo }) {
      const accion = chatSolo || flagPrivate ? null : parseMemoriaIntent(text);
      if (!accion) return null;
      try {
        return { status: "memoria", reply: (await (accion === "recoger" ? recoger : repartir)(userId)).mensaje };
      } catch (e) {
        if (!e?.error) throw e;
        return { status: "memoria", reply: e.mensaje };
      }
    },
    // Cada hora. Solo tras la primera aprobación, cada 30 días y con el PC conectado. Una vez iniciado no se repite.
    async tick(userId) {
      await reconciliar(userId);
      if (await abiertas(userId)) return avanzar(userId);
      if (!(await ajuste(userId, "memoria_aprobado")) || now() - (await ajuste(userId, "memoria_ultimo")) < CADA_MS) return;
      if (!nav.activo() || !conPc() || (await frenado(userId))) return; // se espera a que el PC esté encendido
      await guardar(userId, "memoria_ultimo", now());
      await iniciar(userId, ["recoger", "repartir"]);
    },
    routes() {
      const r = Router();
      const ruta = (fn) => async (req, res, next) => {
        try {
          res.json(await fn(req));
        } catch (e) {
          if (e?.error) res.status(e.status || 400).json({ error: e.error, mensaje: e.mensaje });
          else next(e);
        }
      };
      const id = (req) => Number(req.params.id) || 0;
      r.get("/", ruta((req) => estado(req.user.id)));
      r.get("/vista", ruta((req) => vista(req.user.id)));
      r.post("/recoger", ruta((req) => recoger(req.user.id)));
      r.post("/repartir", ruta((req) => repartir(req.user.id, String(req.body?.hash || "")))); // desde la web, solo lo visto
      r.post("/notas/:id/aprobar", ruta(async (req) => ({ ok: await inbox.approve(req.user.id, id(req)) })));
      r.delete("/notas/:id", ruta(async (req) => {
        const n = await get(db, "SELECT id FROM notes WHERE id=? AND user_id=?", [id(req), req.user.id]); // antes de tocar el índice
        return { ok: n ? !!(await notes.remove(req.user.id, id(req))) : false };
      }));
      r.delete("/datos", ruta((req) => borrarTodo(req.user.id)));
      return r;
    },
  };
}
