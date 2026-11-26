// Lo escolar (docs/NAV.md): Google Classroom y Lirmi, solo lectura.
// Su contenido es privado de nivel "escolar" (solo claude): se guarda cifrado, se borra a los 30 días, nunca pasa por el
// router de modelos ni por voces en la nube y no se escribe en messages ni en nav_tasks. Lo leído es DATO, nunca orden.
import { all, get, run } from "./db/client.js";
import { parseEscolarIntent, esSeguimiento, plano } from "./escolar-intents.js";

const KEY_CORREO = "classroom_correo";
const MARCA = "escolar"; // messages.provider
const RE_CORREO = /[^\s<>()",;:]+@[^\s<>()",;:]+\.[^\s<>()",;:]+/g;
const DIA = 86_400_000;
const GUARDADO = "(Aquí le mostré al señor contenido escolar. No se guarda en la conversación.)";
const SOLO_CLAUDE = "El contenido del colegio no lo paso a otros modelos, señor.";
const VACIAS = ["tarea", "tareas", "cual", "cuando", "para", "sobre", "trata", "tengo", "esta", "explicame", "vence"];

const FALLOS = {
  necesita_login: (n) => `${n} pide iniciar sesión, señor. Entre usted en Chrome del PC y vuelva a pedírmelo.`,
  captcha: (n) => `${n} mostró un CAPTCHA, señor. No los resuelvo: hágalo en Chrome del PC y vuelva a pedírmelo.`,
  bloqueado: (n) => `No pude seguir en ${n}, señor: el navegador quedó bloqueado.`,
  vencida: (n) => `La revisión de ${n} venció sin respuesta, señor.`,
  cancelada: (n) => `Cancelé la revisión de ${n}, señor.`,
  cuenta_incorrecta: (n) => `En ${n} no estaba abierta la cuenta configurada, señor: descarté lo leído y no guardé nada.`,
  error: (n) => `Hubo un error al revisar ${n}, señor.`,
};

export function createEscolar({ db, config, crypto, nav, audit = null, now = () => Date.now() }) {
  const fuentes = config.fuentes;
  const err = (status, error, mensaje) => Object.assign(new Error(error), { status, error, mensaje });
  const nombre = (f) => fuentes[f]?.nombre || f;

  const correo = async (userId) => (await get(db, "SELECT value FROM settings WHERE user_id=? AND key=?", [userId, KEY_CORREO]))?.value || null;

  const purge = () => run(db, "DELETE FROM estudio_items WHERE creado<?", [now() - config.retencion_dias * DIA]);

  async function setCorreo(userId, valor) {
    const v = String(valor ?? "").trim().toLowerCase();
    if (v && (v.length > 254 || v.match(RE_CORREO)?.[0] !== v)) throw err(400, "correo_invalido", "Ese correo no parece válido, señor.");
    const antes = await correo(userId);
    if (v) await run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", [userId, KEY_CORREO, v, now()]);
    else await run(db, "DELETE FROM settings WHERE user_id=? AND key=?", [userId, KEY_CORREO]);
    // Si cambia la cuenta, lo leído con la anterior se descarta.
    if ((antes || "") !== v) await run(db, "DELETE FROM estudio_items WHERE user_id=? AND fuente='classroom'", [userId]);
    return v || null;
  }

  // Solo enlaces https dentro de la lista blanca de la fuente.
  function enlace(fuente, url) {
    try {
      const u = new URL(String(url));
      const ok = u.protocol === "https:" && !u.username && !u.password && fuentes[fuente].hosts.some((h) => (h.startsWith("*.") ? u.hostname.endsWith(h.slice(1)) : u.hostname === h));
      return ok && u.href.length <= 2000 ? u.href : "";
    } catch { return ""; }
  }

  function limpiar(fuente, items) {
    const s = (v, n) => String(v ?? "").trim().slice(0, n);
    return items
      .map((x) => ({ curso: s(x?.curso, 120), tipo: s(x?.tipo, 40), titulo: s(x?.titulo, 300), fecha: s(x?.fecha, 60), url: enlace(fuente, x?.url), resumen: s(x?.resumen, 800) }))
      .filter((x) => x.titulo)
      .slice(0, config.max_items);
  }

  async function filas(userId, fuente = null) {
    await purge();
    const rows = await all(db, `SELECT fuente, datos, creado FROM estudio_items WHERE user_id=?${fuente ? " AND fuente=?" : ""} ORDER BY id`, fuente ? [userId, fuente] : [userId]);
    const out = [];
    for (const r of rows) {
      try { out.push({ item: { fuente: r.fuente, ...crypto.decrypt(r.datos) }, creado: Number(r.creado) }); } catch { /* clave cambiada: no se puede leer */ }
    }
    return out;
  }

  async function guardar(userId, fuente, items) {
    const t = now();
    await db.batch([
      { sql: "DELETE FROM estudio_items WHERE user_id=? AND fuente=?", args: [userId, fuente] },
      ...items.map((i) => ({ sql: "INSERT INTO estudio_items (user_id, fuente, datos, creado) VALUES (?,?,?,?)", args: [userId, fuente, crypto.encrypt(i), t] })),
    ], "write");
  }

  // Llega de nav al terminar una tarea "estudio". Devuelve solo texto neutro: es lo único que nav guarda y muestra.
  async function recibir(tarea, resultado = {}) {
    const userId = Number(tarea?.user_id ?? tarea?.userId), fuente = tarea?.sitio;
    const fin = (estado) => ({ estado, mensaje: (FALLOS[estado] || FALLOS.error)(nombre(fuente)) });
    if (!userId || !Object.hasOwn(fuentes, fuente)) return fin("error");
    await purge();
    if (resultado.estado !== "ok") return fin(Object.hasOwn(FALLOS, resultado.estado) ? resultado.estado : "error");
    if (fuentes[fuente].requiere_correo) {
      const esperado = await correo(userId);
      const vistos = String(resultado.cuenta_visible ?? "").toLowerCase().match(RE_CORREO) || [];
      if (!esperado || !vistos.length || vistos.some((v) => v !== esperado)) { // ante la duda, se descarta
        await audit?.log({ userId, action: "escolar.cuenta_incorrecta", detail: fuente });
        return fin("cuenta_incorrecta");
      }
    }
    if (!Array.isArray(resultado.items) || !crypto.enabled) return fin("error");
    const items = limpiar(fuente, resultado.items);
    await guardar(userId, fuente, items);
    await audit?.log({ userId, action: "escolar.leido", detail: `${fuente}: ${items.length}` });
    return { estado: "ok", mensaje: items.length ? `Revisé ${nombre(fuente)}, señor: ${items.length} elementos. Pregúnteme «qué tareas tengo».` : `Revisé ${nombre(fuente)}, señor: no encontré nada.` };
  }
  nav.registrar?.("estudio", recibir);

  async function actualizar({ userId, fuente, conversationId = null }) {
    const f = Object.hasOwn(fuentes, fuente) ? fuentes[fuente] : null;
    if (!f) throw err(400, "fuente_desconocida", "Solo reviso Classroom y Lirmi, señor.");
    if (!crypto.enabled) throw err(409, "sin_cifrado", "Falta la clave de cifrado (CONNECTIONS_KEY) en el servidor, señor: no leo nada que no pueda guardar cifrado.");
    const c = f.requiere_correo ? await correo(userId) : null;
    if (f.requiere_correo && !c) throw err(409, "falta_correo", `Antes configure el correo de ${f.nombre} en Estudiar, señor.`);
    await purge();
    // La consulta y el texto los arma el servidor: nada de lo que dijo el señor viaja al sitio.
    const t = await nav.enqueue({ userId, conversationId, tipo: "estudio", sitio: fuente, consulta: f.consulta, text: f.consulta, flagPrivate: false, urlInicial: f.url_inicial, cuenta: c ? { correo: c } : null });
    return { id: t.id, estado: t.estado };
  }

  const linea = (i) => `- ${i.curso ? i.curso + ": " : ""}${i.titulo}${i.fecha ? ` (${i.fecha})` : ""}`;

  async function listar(userId, fuente) {
    let items = (await filas(userId, fuente)).map((x) => x.item);
    if (!items.length) return "No tengo nada guardado, señor. Pídame «revisa mi classroom» o «revisa lirmi».";
    const tareas = items.filter((i) => /tarea|evaluaci|prueba|entrega|assignment/i.test(i.tipo));
    if (tareas.length) items = tareas;
    const resto = items.length > 12 ? `\nY ${items.length - 12} más en Estudiar.` : "";
    return `Esto tengo, señor:\n${items.slice(0, 12).map(linea).join("\n")}${resto}`;
  }

  // Seguimiento sin modelo: muestra lo guardado que coincide con las palabras de la pregunta.
  async function detalle(userId, text) {
    const palabras = plano(text).split(" ").filter((w) => w.length > 3 && !VACIAS.includes(w));
    const items = (await filas(userId)).map((x) => x.item);
    const hits = items.filter((i) => { const t = plano(`${i.curso} ${i.titulo}`).split(" "); return palabras.some((w) => t.includes(w)); }).slice(0, 5);
    if (!hits.length) return `${SOLO_CLAUDE} Puede pedirme «qué tareas tengo» o abrir Estudiar.`;
    return `${SOLO_CLAUDE} Esto es lo que tengo guardado:\n${hits.map((i) => linea(i) + (i.resumen ? `\n  ${i.resumen}` : "") + (i.url ? `\n  ${i.url}` : "")).join("\n")}`;
  }

  // ¿Se habló de lo escolar en las dos últimas respuestas de esta conversación?
  async function enContexto(userId, conv) {
    const r = await all(db, "SELECT provider FROM messages WHERE conversation_id=? AND user_id=? AND role='assistant' ORDER BY id DESC LIMIT 2", [conv, userId]);
    return r.some((m) => m.provider === MARCA);
  }

  return {
    config, purge, recibir, actualizar, setCorreo, correo,
    async resumen(userId) {
      const rows = await filas(userId);
      const c = await correo(userId);
      return {
        cuentas: Object.entries(fuentes).map(([id, f]) => ({ id, nombre: f.nombre, correo: f.requiere_correo ? c : null })),
        items: rows.map((x) => x.item),
        actualizado: rows.length ? Math.max(...rows.map((x) => x.creado)) : null,
      };
    },
    // Para el chat. Devuelve { reply, guardar, nav? } o null. `reply` se muestra; `guardar` es lo único que va a messages.
    // Fase "orden": frases explícitas (solo modo IA). Fase "seguimiento": justo antes de que algo llegue a un modelo.
    async chat({ userId, conversationId, text, fase, source = "texto" }) {
      let reply;
      if (fase === "orden") {
        const i = parseEscolarIntent(text);
        if (!i) return null;
        if (i.accion === "actualizar") {
          try {
            const t = await actualizar({ userId, fuente: i.fuente, conversationId });
            reply = `Reviso ${nombre(i.fuente)} en su navegador, señor.`;
            return { reply, guardar: reply, nav: { ...t, sitio: i.fuente } };
          } catch (e) {
            if (!e?.error) throw e;
            return { reply: e.mensaje, guardar: e.mensaje, nav: { error: e.error, sitio: i.fuente } };
          }
        }
        reply = await listar(userId, i.fuente);
      } else {
        if (!esSeguimiento(text) || !(await enContexto(userId, conversationId))) return null;
        reply = await detalle(userId, text);
      }
      // Al Atajo del teléfono y a Telegram no viaja contenido escolar.
      if (source === "atajo" || source === "telegram") reply = "Véalo en Jarvis, en Estudiar, señor.";
      return { reply, guardar: GUARDADO };
    },
  };
}
