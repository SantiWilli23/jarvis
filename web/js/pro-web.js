// Pro web: render puro (HTML siempre escapado) y lógica de acciones, compartidos por escritorio (pro.js) y móvil (movil.js).
// Todo texto que venga de GitHub, del servidor o del usuario pasa por esc(); los enlaces solo son https del repo del hilo.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const lista = (a) => (Array.isArray(a) ? a : []);

export const MOTIVOS_WEB = {
  github_sin_llave: "Falta la llave de GitHub: créela con permisos de solo lectura y póngala en Jarvis (vea la guía, «Conectar GitHub»).",
  github_llave_clasica: "La llave de GitHub es de las antiguas: cree una nueva «fine-grained» (vea la guía).",
  github_llave_invalida: "GitHub rechazó la llave: puede haber caducado o no tener permiso. Cree otra (vea la guía).",
};
export const motivosWebTexto = (pro) => lista(pro?.web?.motivos).map((m) => MOTIVOS_WEB[m] || "GitHub no está disponible.");
export const webHabilitado = (pro) => !!pro?.web?.habilitado;
export const localVisible = (pro) => pro?.local_visible === true;
export const proActivo = (pro) => !!pro?.habilitado || webHabilitado(pro);

export const DESTINOS = {
  claude_web: { nombre: "Claude Code", url: "https://claude.ai/code", host: "claude.ai" },
  jules: { nombre: "Jules", url: "https://jules.google.com", host: "jules.google.com" },
  chatgpt: { nombre: "ChatGPT", url: "https://chatgpt.com/", host: "chatgpt.com", extra: true },
  grok: { nombre: "Grok", url: "https://grok.com/", host: "grok.com", extra: true },
  perplexity: { nombre: "Perplexity", url: "https://www.perplexity.ai/", host: "www.perplexity.ai", extra: true },
};
export const nombreDestino = (d) => DESTINOS[d]?.nombre || String(d || "");
export const EXTRAS = Object.keys(DESTINOS).filter((k) => DESTINOS[k].extra);
export const OTRA = { claude_web: "jules", jules: "claude_web" };

export const ESTADOS_WEB = {
  traduciendo: "Jarvis está preparando el prompt…", conversando: "Esperando su respuesta", prompt_listo: "Prompt listo: elija dónde enviarlo",
  en_curso_web: "Enviado: espere el resultado en GitHub", resultado_listo: "Resultado listo para revisar", necesita_usuario: "Necesita su decisión",
  hecha: "Hecha", cancelada: "Cancelada", fallida: "Fallida",
};
export const ENVIO_ESTADOS = {
  preparado: "Preparado", preparando: "Preparándolo en el navegador de Jarvis…", prompt_listo: "Pegado en el navegador de Jarvis, falta que lo envíe usted",
  copiado: "Copiado, falta enviarlo", enviado: "Enviado, esperando resultado", vinculado: "Resultado vinculado", respondido: "Respondió",
  tarea_bloqueado: "El navegador de Jarvis quedó bloqueado", tarea_necesita_login: "Inicie sesión en el navegador de Jarvis", tarea_degradado: "El navegador de Jarvis no pudo seguir",
  tarea_error: "El navegador de Jarvis falló", tarea_cancelada: "Tarea cancelada", tarea_vencida: "Tarea vencida",
};
export const CHECK_ESTADOS = { success: "bien", failure: "falló", neutral: "neutral", cancelled: "cancelado", skipped: "omitido", timed_out: "tardó demasiado", action_required: "pide acción", in_progress: "en marcha", queued: "en cola", completed: "terminado" };

export const ERRORES_WEB = {
  ronda_activa: "Ya hay una ronda en marcha en este hilo. Espere a que termine o cancélela.",
  estado_invalido: "Esa acción ya no corresponde al estado de la ronda (recargue el hilo).",
  privado: "Ese mensaje es privado y no puede ir a Pro.",
  tope_dia: "Llegó al máximo de envíos de hoy. Mañana podrá enviar más.",
  destino_invalido: "Ese destino no vale para esta acción.",
  asistido_no_disponible: "El navegador de Jarvis no está disponible ahora (PC apagado o sin abrir). Use «Copiar y abrir».",
  github_error: "GitHub no responde ahora mismo. Pruebe en un momento.",
  fork_no_permitido: "Ese PR viene de un fork: por seguridad solo se aceptan ramas del mismo repositorio.",
  url_invalida: "El enlace de ese PR no es del repositorio del hilo.",
  repo_invalido: "Ese repositorio no está disponible con su llave de GitHub.",
  rama_invalida: "Esa rama no existe en el repositorio.",
  web_deshabilitado: "Pro web no está disponible: revise la llave de GitHub.",
  misma_herramienta: "La revisión cruzada debe hacerla la otra herramienta.",
  sin_resultado_vinculado: "Primero vincule el resultado (botón «Es este»).",
  pr_invalido: "Ese PR no existe o no se pudo leer.",
  tipo_invalido: "Ese resultado no es válido.",
  sin_prompt: "Todavía no hay prompt que enviar.",
  no_es_web: "Ese hilo no es de Pro web.",
  modo_invalido: "Modo de envío no válido.",
  rol_invalido: "Esa acción no vale para este envío.",
  texto_invalido: "El mensaje está vacío o es demasiado largo.",
  no_existe: "Eso ya no existe (recargue el hilo).",
};
export const errWeb = (e) => (e && ERRORES_WEB[e.message]) || (e?.status === 429 ? ERRORES_WEB.tope_dia : e?.status === 503 || e?.status === 502 ? "El servidor está dormido o sin conexión; reintente en unos segundos." : e?.message ? "No se pudo hacer: " + e.message : "Error");

// ---------- enlaces seguros ----------
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export function enlaceRepo(repo, url) {
  if (!REPO_RE.test(String(repo || "")) || /(^|\/)\.{1,2}(\/|$)/.test(repo) || typeof url !== "string") return "";
  const base = `https://github.com/${repo}/`;
  if (!url.toLowerCase().startsWith(base.toLowerCase()) || /[\s"'<>]/.test(url)) return "";
  return url;
}
const enlace = (repo, url, texto) => { const u = enlaceRepo(repo, url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(texto)}</a>` : ""; };
// URL de apertura: la del servidor solo si es https y del host conocido del destino; si no, la fija.
export function urlDestino(destino, url) {
  const d = DESTINOS[destino]; if (!d) return "";
  try { const u = new URL(String(url)); if (u.protocol === "https:" && u.hostname === d.host && !u.username && !u.password) return u.href; } catch { /* usa la fija */ }
  return d.url;
}

// ---------- copiar y abrir: SÍNCRONO, dentro del mismo gesto del clic (iOS/Electron). Sin await antes. ----------
export function copiarYAbrir({ prompt, url, destino }, { nav, win, doc, area } = {}) {
  const destUrl = urlDestino(destino, url);
  let copiado = false, abierto = false, pendiente = null;
  try { // 1) execCommand síncrono (el más fiable en iOS); usa el textarea visible o uno temporal
    if (doc?.execCommand) {
      let t = area, temporal = false;
      if (!t && doc.createElement && doc.body) { t = doc.createElement("textarea"); t.value = prompt; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;left:0;opacity:0"; doc.body.appendChild(t); temporal = true; }
      if (t) { t.focus?.(); t.select?.(); t.setSelectionRange?.(0, String(prompt).length); copiado = !!doc.execCommand("copy"); if (temporal) t.remove(); }
    }
  } catch { /* se prueba el portapapeles moderno */ }
  try { // 2) API moderna, sin await; si la promesa falla se avisa luego
    if (nav?.clipboard?.writeText) { pendiente = Promise.resolve(nav.clipboard.writeText(prompt)).then(() => true, () => false); if (!copiado) copiado = true; }
  } catch { /* nada */ }
  try { if (win?.open && destUrl) { win.open(destUrl, "_blank", "noopener"); abierto = true; } } catch { /* bloqueado: queda el enlace */ }
  return { copiado, abierto, url: destUrl, pendiente };
}

// ---------- render ----------
export const renderOpciones = (items, sel, vacio) => (lista(items).length ? items.map((v) => `<option value="${esc(v.value)}"${v.value === sel ? " selected" : ""}>${esc(v.text)}</option>`).join("") : `<option value="">${esc(vacio || "(sin opciones)")}</option>`);
export const opcionesRepos = (repos, sel) => renderOpciones(lista(repos).map((r) => ({ value: r.full_name, text: r.full_name + (r.private ? " (privado)" : "") })), sel, "(sin repositorios)");
export const opcionesRamas = (ramas, sel) => renderOpciones(lista(ramas).map((b) => ({ value: b.name, text: b.name })), sel, "(sin ramas)");
export const ramaPorDefecto = (repos, full) => lista(repos).find((r) => r.full_name === full)?.default_branch || "";

export function ultimoPrompt(msgs, roundId) {
  const m = [...lista(msgs)].reverse().find((x) => x.kind === "prompt" && (!roundId || x.round_id === roundId));
  return m ? { texto: String(m.meta?.prompt ?? m.text ?? ""), criterios: lista(m.meta?.criterios), sugerido: m.meta?.destino_sugerido, plantilla: !!m.meta?.plantilla } : null;
}
export const ultimoResultado = (msgs, roundId) => [...lista(msgs)].reverse().find((x) => x.kind === "resultado" && (!roundId || x.round_id === roundId)) || null;

const btn = (w, txt, attrs = "", cls = "") => `<button type="button" class="${cls}" data-w="${w}" ${attrs}>${esc(txt)}</button>`;
const ul = (a) => (lista(a).length ? `<ul class="mono">${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");

export function renderCandidatos(cands, repo, envioId, limitado, roundId) {
  if (!lista(cands).length) return `<p class="lbl">${limitado ? "Acabo de mirar; vuelva a buscar en unos segundos." : "Todavía no veo ramas ni PRs nuevos en GitHub."}</p>`;
  return `<ul class="cands">${cands.map((c) => {
    const nombre = c.tipo === "pr" ? `PR #${Number(c.numero) || 0}: ${c.titulo || c.head || ""}` : `Rama ${c.head || c.ref || ""}`;
    const ver = c.tipo === "pr" ? enlace(repo, c.html_url, "ver en GitHub") : "";
    return `<li class="cand${c.prioritario ? " prio" : ""}"><span>${esc(nombre)}${c.estado ? ` <small>(${esc(c.estado)})</small>` : ""} ${ver}</span>${btn("vincular", "Es este", `data-round="${esc(roundId)}" data-envio="${esc(envioId)}" data-tipo="${esc(c.tipo)}" data-ref="${esc(c.ref)}"`, "yes")}</li>`;
  }).join("")}</ul>`;
}
export function renderResultado(msg, repo) {
  if (!msg) return "";
  const m = msg.meta || {}, res = m.resultado || {}, c = m.comprobacion || {};
  const lk = res.tipo === "pr" ? enlace(repo, res.html_url, `Abrir PR #${Number(res.numero) || ""} en GitHub`) : enlace(repo, res.html_url, `Abrir rama ${res.head || ""} en GitHub`);
  const aviso = (t, a) => (lista(a).length ? `<p class="lbl warn">${esc(t)}</p>${ul(a)}` : "");
  const checks = lista(m.checks);
  return `<div class="rep resultado"><h4>Resultado</h4><p class="txt">${esc(msg.text)}</p>${lk ? `<p>${lk}</p>` : ""}
    ${lista(c.tocados).length ? `<p class="lbl">Archivos tocados (${c.tocados.length})</p>${ul(c.tocados.slice(0, 20))}` : ""}
    ${aviso("Pedidos que no se tocaron", c.mencionados_no_tocados)}${aviso("Archivos sensibles tocados: mírelos con cuidado", c.sensibles_tocados)}${aviso("Cambios no pedidos", c.ajenos)}
    ${checks.length ? `<p class="lbl">Comprobaciones de GitHub</p><ul>${checks.map((k) => `<li class="ck-${esc(k.conclusion)}">${esc(k.name)}: ${esc(CHECK_ESTADOS[k.conclusion] || k.conclusion || "sin datos")}</li>`).join("")}</ul>` : `<p class="lbl">Sin comprobaciones de GitHub.</p>`}</div>`;
}
function renderEnvio(e, repo, estado, roundId) {
  const nom = nombreDestino(e.destino), rol = e.rol === "revisar" ? "Revisión" : e.destino && DESTINOS[e.destino]?.extra ? "Consulta" : "Trabajo";
  const aviso = estado.avisos?.[e.id];
  const abrir = e.status === "copiado" || e.status === "enviado" || e.status === "preparado";
  let h = `<div class="envio"><p class="lbl"><b>${esc(rol)} en ${esc(nom)}</b>: ${esc(ENVIO_ESTADOS[e.status] || e.status)}</p>`;
  if (abrir && !e.resultado) {
    h += `<label class="sr" for="web-env-${esc(e.id)}">Prompt enviado a ${esc(nom)}</label><textarea id="web-env-${esc(e.id)}" class="webprompt" rows="5" readonly data-envio-prompt="${esc(e.id)}">${esc(e.prompt)}</textarea>
      <div class="btns">${btn("copiar-abrir", `Copiar y abrir ${nom}`, `data-round="${esc(roundId)}" data-envio="${esc(e.id)}" data-destino="${esc(e.destino)}"`, "yes")}${btn("ya-enviado", "Ya lo envié", `data-round="${esc(roundId)}" data-envio="${esc(e.id)}"`)}</div>
      <p class="lbl">${aviso ? esc(aviso) : `Se copia el prompt y se abre ${esc(nom)}: inicie sesión usted y péguelo.`} <a href="${esc(urlDestino(e.destino))}" target="_blank" rel="noopener noreferrer">Abrir ${esc(nom)} de nuevo</a></p>`;
  }
  return h + "</div>";
}

export function renderRamaSelect(thread, ramas) {
  if (!thread || thread.modo !== "web") return "";
  return `<div class="webrama"><label for="web-rama">Rama de trabajo</label><select id="web-rama" data-w-change="rama">${opcionesRamas(ramas?.length ? ramas : [{ name: thread.gh_rama }], thread.gh_rama)}</select> <small>${esc(thread.gh_repo)}</small></div>`;
}

// Tarjeta de la ronda web. ctx: {thread, msgs, envios, web (pro.web), estado:{candidatos,limitado,avisos,corr}}
export function renderRondaWeb(r, ctx = {}) {
  if (!r) return "";
  const { thread, msgs, web, estado = {} } = ctx, repo = thread?.gh_repo, envios = lista(ctx.envios).filter((e) => e.round_id === r.id);
  const ult = envios.at(-1), pm = ultimoPrompt(msgs, r.id), final = ["hecha", "cancelada", "fallida"].includes(r.status);
  let h = `<div class="round web st-${esc(r.status)}"><div class="rh"><b>${esc(ESTADOS_WEB[r.status] || r.status)}</b></div>`;
  if (r.summary) h += `<p class="sum">${esc(r.summary)}</p>`;
  if (r.status === "prompt_listo" && pm) {
    const asist = web?.destinos?.claude_web?.asistido;
    h += `<label for="web-prompt-${esc(r.id)}">Prompt (puede editarlo antes de enviarlo)${pm.plantilla ? " · es su texto tal cual, sin traductor" : ""}</label>
      <textarea id="web-prompt-${esc(r.id)}" class="webprompt" rows="8" maxlength="5000" data-orig="${esc(pm.texto)}">${esc(pm.texto)}</textarea>
      ${lista(pm.criterios).length ? `<p class="lbl">Criterios</p>${ul(pm.criterios)}` : ""}
      <div class="btns">${btn("preparar", "Preparar para Claude Code", `data-round="${esc(r.id)}" data-destino="claude_web" data-modo="copiar"`, pm.sugerido === "claude_web" ? "yes" : "")}
      ${btn("preparar", "Preparar para Jules", `data-round="${esc(r.id)}" data-destino="jules" data-modo="copiar"`, pm.sugerido === "jules" ? "yes" : "")}
      ${asist ? btn("preparar", "Dejar en el navegador de Jarvis", `data-round="${esc(r.id)}" data-destino="claude_web" data-modo="asistido"`) : ""}</div>
      <div class="extras"><label for="web-extra-${esc(r.id)}">Consultar a otra herramienta (solo si usted lo pide)</label>
      <select id="web-extra-${esc(r.id)}"><option value="">Consultar a…</option>${EXTRAS.map((k) => `<option value="${esc(k)}">${esc(nombreDestino(k))}</option>`).join("")}</select>
      ${btn("extra", "Preparar consulta", `data-round="${esc(r.id)}"`)}</div>`;
  }
  if (["en_curso_web", "necesita_usuario", "resultado_listo"].includes(r.status)) {
    for (const e of envios.slice(-3)) h += renderEnvio(e, repo, estado, r.id);
    if (ult && !ult.resultado && r.status !== "resultado_listo") {
      h += `<div class="btns">${btn("sondear", "Buscar resultado", `data-round="${esc(r.id)}"`, "yes")}</div>`;
      const c = estado.candidatos?.[r.id] ?? ult.candidatos;
      if (c) h += renderCandidatos(c, repo, ult.id, estado.limitado?.[r.id], r.id);
    }
  }
  if (r.status === "resultado_listo") {
    h += renderResultado(ultimoResultado(msgs, r.id), repo);
    const prog = [...envios].reverse().find((e) => e.rol === "programar" && e.resultado), otra = prog && OTRA[prog.destino];
    if (otra) {
      h += `<div class="btns">${btn("revisar", `Revisión cruzada con ${nombreDestino(otra)}`, `data-round="${esc(r.id)}" data-destino="${esc(otra)}" data-modo="copiar"`)}${web?.destinos?.claude_web?.asistido && otra === "claude_web" ? btn("revisar", "Revisión en el navegador de Jarvis", `data-round="${esc(r.id)}" data-destino="${esc(otra)}" data-modo="asistido"`) : ""}</div>`;
    }
    h += `<label for="web-corr-${esc(r.id)}">Pedir corrección (opcional: diga qué falta)</label><textarea id="web-corr-${esc(r.id)}" rows="3" maxlength="2000"></textarea>
      <div class="btns">${btn("correccion", "Pedir corrección", `data-round="${esc(r.id)}"`)}${btn("marcar-hecha", "Marcar como hecha", `data-round="${esc(r.id)}"`, "yes")}${btn("rechazar", "Rechazar resultado", `data-round="${esc(r.id)}"`)}</div>`;
  } else if (r.status === "necesita_usuario") {
    h += `<div class="btns">${btn("marcar-hecha", "Marcar como hecha", `data-round="${esc(r.id)}"`)}</div>`;
  }
  if (!final) h += `<div class="btns">${btn("cancelar", "Cancelar ronda", `data-round="${esc(r.id)}"`)}</div>`;
  return h + "</div>";
}

// ---------- controlador de acciones (api y entorno inyectados: se prueba sin navegador) ----------
export function createWebCtl({ api, nav, win, doc, root, hilo, recargar, error }) {
  const estado = { candidatos: {}, limitado: {}, avisos: {} };
  const falla = (e) => { error?.(errWeb(e)); };
  const pegar = (path, body) => api(path, { method: "POST", body: body || {} });
  const refresco = () => Promise.resolve(recargar?.());
  const valor = (sel) => root?.()?.querySelector(sel)?.value ?? "";

  async function conRecarga(fn) { let msg = ""; try { await fn(); } catch (e) { msg = errWeb(e); } await refresco(); error?.(msg); }

  function clic(b) { // devuelve una promesa; la parte síncrona (copiar-abrir) corre antes de cualquier await
    const d = b.dataset, w = d.w;
    if (w === "copiar-abrir") {
      const area = root?.()?.querySelector(`[data-envio-prompt="${CSS_esc(d.envio)}"]`) || null;
      const e = lista(hilo?.()?.envios).find((x) => String(x.id) === String(d.envio));
      const prompt = area ? area.value : e?.prompt;
      if (!prompt) return Promise.resolve();
      const r = copiarYAbrir({ prompt, url: estado.urls?.[d.envio], destino: d.destino }, { nav, win, doc, area });
      estado.avisos[d.envio] = r.copiado ? `Copiado${r.abierto ? " y abierto" : ""}. Pegue el prompt en ${nombreDestino(d.destino)} y envíelo.` : "No se pudo copiar solo: seleccione el texto de arriba y cópielo a mano.";
      r.pendiente?.then((ok) => { if (!ok && !r.copiado) { estado.avisos[d.envio] = "No se pudo copiar solo: copie el texto a mano."; refresco(); } });
      return pegar(`/pro/rounds/${d.round}/ya-enviado`, { envio_id: Number(d.envio) }).catch(() => {}).then(refresco);
    }
    if (w === "preparar" || w === "extra") {
      const destino = w === "extra" ? valor(`#web-extra-${CSS_esc(d.round)}`) : d.destino;
      if (!destino) { error?.("Elija primero a quién consultar."); return Promise.resolve(); }
      const area = root?.()?.querySelector(`#web-prompt-${CSS_esc(d.round)}`);
      const body = { destino, modo: w === "extra" ? "copiar" : d.modo, rol: "programar" };
      if (area && area.value.trim() && area.value.trim() !== area.dataset.orig) body.prompt_editado = area.value.trim();
      return conRecarga(async () => { const r = await pegar(`/pro/rounds/${d.round}/enviar`, body); if (r.envio) { estado.urls = { ...estado.urls, [r.envio.id]: r.url }; estado.avisos[r.envio.id] = body.modo === "asistido" ? "Dejado en el navegador de Jarvis: revíselo allí y envíelo usted." : ""; } });
    }
    if (w === "ya-enviado") return conRecarga(() => pegar(`/pro/rounds/${d.round}/ya-enviado`, { envio_id: Number(d.envio) }));
    if (w === "sondear") return conRecarga(async () => { const r = await pegar(`/pro/rounds/${d.round}/sondear`); estado.candidatos[d.round] = r.candidatos || []; estado.limitado[d.round] = !!r.limitado; });
    if (w === "vincular") return conRecarga(() => pegar(`/pro/rounds/${d.round}/vincular`, { envio_id: Number(d.envio), tipo: d.tipo, ref: d.ref }).then(() => { delete estado.candidatos[d.round]; }));
    if (w === "revisar") return conRecarga(() => pegar(`/pro/rounds/${d.round}/revisar`, { destino: d.destino, modo: d.modo }));
    if (w === "correccion") return conRecarga(() => pegar(`/pro/rounds/${d.round}/correccion`, { texto: valor(`#web-corr-${CSS_esc(d.round)}`).trim() || undefined }));
    if (w === "marcar-hecha") return conRecarga(() => pegar(`/pro/rounds/${d.round}/marcar-hecha`));
    if (w === "rechazar") return conRecarga(() => pegar(`/pro/rounds/${d.round}/rechazar`));
    if (w === "cancelar") return conRecarga(() => pegar(`/pro/rounds/${d.round}/cancel`));
    return Promise.resolve();
  }
  async function cambiarRama(rama) {
    const id = hilo()?.id; if (!id || !rama) return;
    await conRecarga(() => api(`/pro/threads/${id}`, { method: "PATCH", body: { gh_rama: rama } }));
  }
  return { estado, clic, cambiarRama };
}
const CSS_esc = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "");
