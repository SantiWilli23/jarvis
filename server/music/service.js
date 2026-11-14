// Resuelve una orden de música (ya interpretada por intents.js) contra YouTube. Sin modelo.
// Devuelve { reply, musica }. Solo texto: nunca voz. Los nombres de playlists y pistas son privados.
import { bestMatch } from "./match.js";

const BUSCAR = (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`;
const WATCH = (id, list) => `https://music.youtube.com/watch?v=${id}${list ? `&list=${list}` : ""}`;
const CONTROL_TXT = { pause: "En pausa, señor.", resume: "Sigo, señor.", next: "Siguiente, señor.", prev: "Vuelvo a la anterior, señor.", stop: "Música parada, señor.", shuffle: "Aleatorio, señor.", info: "Miro qué suena, señor." };

export function createMusic({ youtube, now = () => Date.now() }) {
  const enabled = !!youtube?.enabled;

  const conLink = (reply, abrir, op = "info") => ({ reply, musica: { op, abrir } });

  function errorReply(e, q) {
    const abrir = q ? BUSCAR(q) : "https://music.youtube.com/";
    if (e.code === "sin_cuota_youtube") return conLink(`Llegué al límite diario de YouTube, señor. ${q ? "Le abro la búsqueda en YouTube Music." : "Pruebe de nuevo mañana."}`, abrir);
    if (e.code === "falta_permiso_youtube") return conLink("Falta el permiso de YouTube, señor. Vuelva a conectar Google en Ajustes y acepte el permiso de YouTube.", abrir);
    if (e.code === "no_conectado") return conLink("Google no está conectado, señor. Conéctelo en Ajustes para usar sus playlists.", abrir);
    if (e.code === "no_encontrado") return conLink("No encontré eso, señor.", abrir);
    return conLink("YouTube no respondió bien, señor.", abrir);
  }

  async function reproducirLista(userId, lista) {
    const items = await youtube.items(userId, lista.id);
    if (!items.length) return { reply: `La lista "${lista.titulo}" no tiene canciones que se puedan reproducir aquí, señor.`, musica: { op: "info", abrir: `https://music.youtube.com/playlist?list=${lista.id}` } };
    await youtube.guardarUltima(userId, { tipo: "playlist", id: lista.id, titulo: lista.titulo });
    return { reply: `Pongo "${lista.titulo}", señor: ${items.length} canciones.`, musica: { op: "play", items, index: 0, titulo: lista.titulo, fuente: "playlist", abrir: WATCH(items[0].id, lista.id) } };
  }

  async function buscar(userId, q) {
    const hit = await youtube.buscarEnCache(userId, q); // gratis: en tus playlists ya guardadas
    if (hit) {
      const it = hit.items[hit.index];
      return { reply: `Suena "${it.titulo}", señor.`, musica: { op: "play", items: hit.items, index: hit.index, titulo: it.titulo, fuente: "playlist", abrir: WATCH(it.id, hit.playlist) } };
    }
    const r = await youtube.search(userId, { q, max: 5 });
    if (!r.length) return conLink("No encontré nada para eso, señor.", BUSCAR(q));
    return { reply: `Pongo "${r[0].titulo}", señor.`, musica: { op: "play", items: r, index: 0, titulo: r[0].titulo, fuente: "busqueda", abrir: WATCH(r[0].id) } };
  }

  return {
    enabled,
    // ¿Se acepta una orden ambigua ("pon X")? Solo si X se parece a una playlist ya guardada o el reproductor está activo.
    async acepta(userId, intent, { reproductor } = {}) {
      if (!intent.ambiguo) return true;
      if (reproductor?.activo) return true;
      const pl = await youtube.playlistsEnCache(userId);
      return !!(pl && bestMatch(pl, intent.q).mejor);
    },
    async resolve(userId, intent, { reproductor } = {}) {
      if (CONTROL_TXT[intent.op]) return { reply: CONTROL_TXT[intent.op], musica: { op: intent.op } };
      const q = intent.op === "buscar" ? intent.q : intent.op === "playlist" ? intent.nombre : "";
      try {
        const est = await youtube.ready(userId);
        if (!est.conectado) return errorReply({ code: "no_conectado" }, q);
        if (!est.permiso) return errorReply({ code: "falta_permiso_youtube" }, q);
        if (intent.op === "listas") {
          const pl = await youtube.playlists(userId);
          if (!pl.length) return { reply: "No tiene playlists en YouTube, señor.", musica: { op: "listas", items: [] } };
          return { reply: `Sus playlists, señor: ${pl.map((p) => p.titulo).join(", ")}.`, musica: { op: "listas", items: pl.map((p) => ({ id: p.id, titulo: p.titulo, canal: p.n != null ? `${p.n} canciones` : "" })) } };
        }
        if (intent.op === "musica") {
          const ult = await youtube.ultima(userId);
          if (ult?.id) return await reproducirLista(userId, ult);
          return { reply: "¿Qué quiere escuchar, señor? Puedo poner una de sus playlists o buscar una canción.", musica: { op: "info" } };
        }
        if (intent.op === "playlist" || (intent.op === "buscar" && intent.ambiguo)) {
          const pl = await youtube.playlists(userId);
          const { mejor, parecidas } = bestMatch(pl, q);
          if (mejor) return await reproducirLista(userId, mejor);
          if (intent.op === "buscar") return await buscar(userId, q); // "pon X" que no era lista
          return { reply: parecidas.length ? `No encontré la playlist "${q}", señor. ¿Quizá ${parecidas.map((p) => `"${p.titulo}"`).join(", ")}?` : `No encontré la playlist "${q}", señor.`,
            musica: { op: "listas", items: parecidas.map((p) => ({ id: p.id, titulo: p.titulo, canal: p.n != null ? `${p.n} canciones` : "" })) } };
        }
        if (intent.op === "buscar") return await buscar(userId, q);
      } catch (e) { return errorReply(e, q); }
      return { reply: "No entendí qué música quiere, señor.", musica: { op: "info" } };
    },
  };
}
