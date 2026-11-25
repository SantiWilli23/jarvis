// "Crea una sesión Pro [en <repo>]: <pedido>" desde Clásico (docs/NAV.md, "Pro desde Clásico").
// Solo frase explícita y anclada al inicio. Crea un hilo Pro web y le envía el pedido; nada se manda a Claude solo.
const FRASE = /^\s*[¡¿]?(?:(?:oye\s+)?jarvis[,.:]?\s+)?(?:(?:por favor|porfa),?\s+)?(?:(?:puedes|podrias)\s+)?(?:crea(?:me|r|rme)?)\s+(?:una\s+)?sesion\s+(?:de\s+)?pro(?=\s|:|$|[.!?])(?:\s+en\s+(?:el\s+repo(?:sitorio)?\s+)?([^:]{1,120}?))?\s*(?::([\s\S]*)|[.!?]*\s*)$/d;

// Minúsculas y sin tildes, carácter a carácter: las posiciones siguen valiendo en el texto original.
const plano = (s) => s.split("").map((c) => c.normalize("NFD")[0].toLowerCase()[0]).join("");

// Devuelve { repo, pedido } (repo null si no se dijo; pedido puede venir vacío) o null.
export function parseProIntent(text) {
  const t = String(text ?? "").normalize("NFC");
  const m = FRASE.exec(plano(t));
  if (!m) return null;
  const trozo = (i) => (m.indices[i] ? t.slice(...m.indices[i]).trim() : "");
  return { repo: trozo(1) || null, pedido: trozo(2) };
}

// "mi app", "Mi-App" y "mi_app" son el mismo nombre al dictarlo.
const clave = (s) => plano(String(s)).replace(/[\s_.-]+/g, "");
const corto = (full) => String(full).split("/").pop();

export function buscarRepo(dicho, repos) {
  const d = String(dicho).replace(/[.,;!?]+$/, "");
  const exacto = repos.filter((r) => r.full_name.toLowerCase() === d.toLowerCase());
  if (exacto.length) return exacto;
  return repos.filter((r) => clave(d.includes("/") ? r.full_name : corto(r.full_name)) === clave(d));
}

const EJEMPLO = "«crea una sesión Pro en <repositorio>: <pedido>»";
const FALLOS = {
  privado: "Eso es privado, señor: no lo llevo a Pro.",
  web_deshabilitado: "El modo Pro web no está disponible ahora, señor: revise la conexión con GitHub.",
  repo_invalido: "No puedo usar ese repositorio, señor.",
  rama_invalida: "No encuentro la rama de ese repositorio, señor.",
  github_error: "GitHub no respondió, señor. Pruebe de nuevo en un momento.",
  texto_invalido: "El pedido es demasiado largo para Pro, señor.",
};

// Devuelve { reply, private, pro: { thread_id } | { error } }.
export async function crearSesionPro({ pro, github, checkPrivate, userId, intent, original, flagPrivate = false }) {
  const fin = (reply, info, priv = !!flagPrivate) => ({ reply, pro: info, private: priv });
  const fallo = (code) => fin(FALLOS[code] || "No pude crear la sesión Pro, señor.", { error: code }, code === "privado" || !!flagPrivate);
  let threadId = null;
  try {
    // Privacidad primero: si es privado no se crea ni el hilo.
    if (flagPrivate || await checkPrivate({ userId, text: original, flagPrivate })) return fallo("privado");
    if (!intent.pedido) return fin(`¿Qué quiere que haga, señor? Dígame ${EJEMPLO}.`, { error: "falta_pedido" });
    if (!(await pro.orch.web.disponibilidad()).habilitado) return fallo("web_deshabilitado");

    let repo, rama;
    if (intent.repo) {
      let repos;
      try { repos = await github.repos(); } catch { return fallo("github_error"); }
      const hay = buscarRepo(intent.repo, repos);
      if (!hay.length) return fin(`No encuentro ese repositorio en GitHub, señor. Dígame ${EJEMPLO} con su nombre exacto.`, { error: "repo_invalido" });
      if (hay.length > 1) return fin(`Hay varios con ese nombre, señor: ${hay.map((r) => r.full_name).join(", ")}. Repita el pedido con el nombre completo.`, { error: "repo_ambiguo" });
      repo = hay[0].full_name; rama = hay[0].default_branch;
    } else {
      const ultimo = (await pro.orch.store.listThreads(userId)).find((t) => t.modo === "web" && t.gh_repo);
      if (!ultimo) return fin(`¿En qué repositorio, señor? Dígame ${EJEMPLO}.`, { error: "falta_repo" });
      repo = ultimo.gh_repo; rama = ultimo.gh_rama;
    }

    const hilo = await pro.orch.createThread(userId, { modo: "web", gh_repo: repo, gh_rama: rama, title: intent.pedido.slice(0, 80) });
    threadId = hilo.id;
    await pro.orch.send(userId, threadId, intent.pedido);
    return fin(`Abrí una sesión Pro en ${corto(hilo.gh_repo)}, señor. Revise el hilo antes de enviar nada.`, { thread_id: threadId });
  } catch (e) {
    if (e?.name !== "Error" || !e.status || !e.code) throw e; // solo ProError
    if (threadId) return fin("Creé el hilo Pro, señor, pero no pude enviar el pedido. Ábralo e inténtelo allí.", { thread_id: threadId, error: e.code });
    return fallo(e.code);
  }
}
