import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, renderRondaWeb, renderCandidatos, renderResultado, renderRamaSelect, enlaceRepo, urlDestino, errWeb, ERRORES_WEB, MOTIVOS_WEB, motivosWebTexto, proActivo, copiarYAbrir, createWebCtl, opcionesRepos, ultimoPrompt } from "../web/js/pro-web.js";

const thread = { id: 1, modo: "web", gh_repo: "yo/app", gh_rama: "main" };
const prompt = { id: 5, round_id: 9, kind: "prompt", text: "x", meta: { prompt: "Haz <b>esto</b>", criterios: ["a.js cambia"], destino_sugerido: "jules" } };

test("tarjeta prompt_listo: prompt editable escapado, destinos y consultas explícitas", () => {
  const h = renderRondaWeb({ id: 9, status: "prompt_listo" }, { thread, msgs: [prompt], envios: [], web: { destinos: { claude_web: { asistido: true } } } });
  assert.ok(h.includes("<textarea") && h.includes("&lt;b&gt;esto&lt;/b&gt;") && !h.includes("<b>esto"));
  for (const t of ["Preparar para Claude Code", "Preparar para Jules", "Dejar en el navegador de Jarvis", "Consultar a…", "ChatGPT", "Grok", "Perplexity"]) assert.ok(h.includes(t), t);
  assert.ok(!renderRondaWeb({ id: 9, status: "prompt_listo" }, { thread, msgs: [prompt], envios: [], web: { destinos: { claude_web: { asistido: false } } } }).includes("Dejar en el navegador"));
});

test("en curso: el prompt ya está en el DOM y hay botón Copiar y abrir", () => {
  const e = { id: 3, round_id: 9, destino: "jules", rol: "programar", status: "copiado", prompt: "P<script>", candidatos: [] };
  const h = renderRondaWeb({ id: 9, status: "en_curso_web" }, { thread, msgs: [], envios: [e], estado: {} });
  assert.ok(h.includes("Copiar y abrir Jules") && h.includes("P&lt;script&gt;") && !h.includes("<script>"));
  assert.ok(h.includes("Buscar resultado"));
});

test("candidatos y resultado: enlaces solo https del repo del hilo, todo escapado", () => {
  const c = [{ tipo: "pr", ref: "7", numero: 7, titulo: "<img onerror=x>", head: "claude/x", estado: "open", html_url: "https://github.com/yo/app/pull/7", prioritario: true },
    { tipo: "pr", ref: "8", numero: 8, titulo: "malo", html_url: "javascript:alert(1)" }, { tipo: "pr", ref: "9", numero: 9, titulo: "otro", html_url: "https://github.com/otro/repo/pull/9" },
    { tipo: "rama", ref: "jules/a\"b", head: "jules/a\"b" }];
  const h = renderCandidatos(c, "yo/app", 3, false, 9);
  assert.ok(h.includes('href="https://github.com/yo/app/pull/7"') && h.includes('rel="noopener noreferrer"'));
  assert.ok(!h.includes("javascript:") && !h.includes("otro/repo") && !h.includes("<img"));
  assert.equal((h.match(/Es este/g) || []).length, 4);
  assert.ok(h.includes('data-ref="jules/a&quot;b"'));
  const r = renderResultado({ text: "<x>", meta: { resultado: { tipo: "pr", numero: 7, html_url: "https://evil.com/yo/app/pull/7" }, comprobacion: { tocados: ["a.js"], sensibles_tocados: [".env"], mencionados_no_tocados: ["b.js"], ajenos: [] }, checks: [{ name: "<ci>", conclusion: "success" }] } }, "yo/app");
  assert.ok(!r.includes("evil.com") && !r.includes("<ci>") && r.includes("&lt;ci&gt;") && r.includes("bien") && r.includes(".env") && r.includes("b.js"));
});

test("resultado_listo ofrece revisión cruzada con la OTRA herramienta", () => {
  const e = { id: 3, round_id: 9, destino: "claude_web", rol: "programar", status: "vinculado", resultado: { tipo: "pr" } };
  const h = renderRondaWeb({ id: 9, status: "resultado_listo" }, { thread, msgs: [], envios: [e], web: {} });
  assert.ok(h.includes("Revisión cruzada con Jules") && h.includes("Marcar como hecha") && h.includes("Pedir corrección"));
  assert.ok(!h.includes("Revisión cruzada con Claude"));
});

test("enlaces y URLs de destino", () => {
  assert.equal(enlaceRepo("yo/app", "https://github.com/yo/app/pull/1"), "https://github.com/yo/app/pull/1");
  for (const u of ["http://github.com/yo/app/pull/1", "https://github.com/yo/appx/pull/1", "https://github.com.evil.com/yo/app/", "https://github.com/yo/app/\"x"]) assert.equal(enlaceRepo("yo/app", u), "");
  assert.equal(enlaceRepo("../x", "https://github.com/../x/"), "");
  assert.equal(urlDestino("jules", "https://jules.google.com/x"), "https://jules.google.com/x");
  assert.equal(urlDestino("jules", "https://evil.com"), "https://jules.google.com");
  assert.equal(urlDestino("claude_web", "javascript:1"), "https://claude.ai/code");
  assert.equal(urlDestino("nada", "https://x.com"), "");
});

test("errores y motivos en español, sin códigos crudos", () => {
  for (const k of ["ronda_activa", "estado_invalido", "privado", "tope_dia", "destino_invalido", "asistido_no_disponible", "github_error", "fork_no_permitido", "url_invalida", "misma_herramienta", "sin_resultado_vinculado", "repo_invalido", "rama_invalida", "web_deshabilitado"]) assert.ok(ERRORES_WEB[k], k);
  assert.equal(errWeb(new Error("tope_dia")), ERRORES_WEB.tope_dia);
  assert.match(errWeb(Object.assign(new Error("x"), { status: 503 })), /dormido/);
  for (const k of ["github_sin_llave", "github_llave_clasica", "github_llave_invalida"]) assert.match(MOTIVOS_WEB[k], /GitHub/);
  assert.deepEqual(motivosWebTexto({ web: { motivos: ["github_sin_llave"] } }), [MOTIVOS_WEB.github_sin_llave]);
  assert.ok(proActivo({ habilitado: false, web: { habilitado: true } }) && !proActivo({ habilitado: false, web: { habilitado: false } }) && proActivo({ habilitado: true }));
});

test("selectores de repo y rama", () => {
  assert.ok(opcionesRepos([{ full_name: "yo/<a>", private: true }], "").includes("yo/&lt;a&gt; (privado)"));
  const s = renderRamaSelect(thread, [{ name: "main" }, { name: "dev" }]);
  assert.ok(s.includes('data-w-change="rama"') && s.includes('value="main" selected'));
  assert.equal(renderRamaSelect({ modo: "local" }, []), "");
  assert.equal(ultimoPrompt([prompt], 9).sugerido, "jules");
});

test("copiarYAbrir: copia y abre en el mismo gesto, sin await", () => {
  const orden = [];
  const area = { value: "PROMPT", focus() {}, select() { orden.push("select"); }, setSelectionRange() {} };
  const doc = { execCommand: (c) => { orden.push(c); return true; } };
  const nav = { clipboard: { writeText: (t) => { orden.push("write:" + t); return Promise.resolve(); } } };
  const win = { open: (u, n, f) => { orden.push(`open:${u}:${n}:${f}`); return null; } };
  const r = copiarYAbrir({ prompt: "PROMPT", url: "https://jules.google.com", destino: "jules" }, { nav, win, doc, area });
  // todo ocurrió ya, de forma síncrona, antes de que retorne la función
  assert.deepEqual(orden, ["select", "copy", "write:PROMPT", "open:https://jules.google.com/:_blank:noopener"]);
  assert.ok(r.copiado && r.abierto);
});

test("copiarYAbrir: respaldo si no hay portapapeles ni execCommand, y URL ajena se descarta", () => {
  const abiertos = [];
  const r = copiarYAbrir({ prompt: "p", url: "https://evil.com", destino: "claude_web" }, { nav: {}, doc: {}, win: { open: (u) => abiertos.push(u) } });
  assert.equal(r.copiado, false); assert.deepEqual(abiertos, ["https://claude.ai/code"]);
  const r2 = copiarYAbrir({ prompt: "p", destino: "jules" }, { nav: { clipboard: { writeText() { throw new Error("no"); } } }, doc: { execCommand: () => { throw new Error("no"); } }, win: { open() { throw new Error("bloqueado"); } } });
  assert.equal(r2.copiado, false); assert.equal(r2.abierto, false);
});

test("controlador: Copiar y abrir es síncrono antes del POST ya-enviado; preparar manda prompt_editado solo si cambió", async () => {
  const llamadas = []; const orden = [];
  const api = async (path, o = {}) => { llamadas.push([path, o.method || "GET", o.body]); orden.push("api"); if (path.endsWith("/enviar")) return { envio: { id: 3 }, url: "https://claude.ai/code" }; return {}; };
  const area = { value: "EDITADO", dataset: { orig: "ORIG" } }, areaEnv = { value: "ENV", focus() {}, select() {}, setSelectionRange() {} };
  const rootEl = { querySelector: (s) => (s.startsWith("#web-prompt-") ? area : s.startsWith("[data-envio-prompt") ? areaEnv : null) };
  const doc = { execCommand: () => { orden.push("copy"); return true; } };
  const win = { open: () => { orden.push("open"); } };
  let recargas = 0, err = "";
  const ctl = createWebCtl({ api, nav: {}, win, doc, root: () => rootEl, hilo: () => ({ id: 1, envios: [{ id: 3, prompt: "ENV" }] }), recargar: () => { recargas++; }, error: (t) => { err = t; } });
  await ctl.clic({ dataset: { w: "preparar", round: "9", destino: "claude_web", modo: "copiar" } });
  assert.deepEqual(llamadas[0], ["/pro/rounds/9/enviar", "POST", { destino: "claude_web", modo: "copiar", rol: "programar", prompt_editado: "EDITADO" }]);
  orden.length = 0;
  const p = ctl.clic({ dataset: { w: "copiar-abrir", round: "9", envio: "3", destino: "claude_web" } });
  assert.deepEqual(orden, ["copy", "open", "api"]); // copia y abre ANTES de la primera llamada a la API
  await p;
  assert.equal(llamadas.at(-1)[0], "/pro/rounds/9/ya-enviado");
  area.value = "ORIG"; await ctl.clic({ dataset: { w: "preparar", round: "9", destino: "jules", modo: "copiar" } });
  assert.equal(llamadas.at(-1)[2].prompt_editado, undefined);
  assert.ok(recargas >= 3 && err === "");
});

test("controlador: errores del servidor salen en español y la búsqueda guarda candidatos", async () => {
  let err = "";
  const api = async (p) => { if (p.endsWith("/vincular")) throw Object.assign(new Error("fork_no_permitido"), { status: 422 }); return { candidatos: [{ tipo: "rama", ref: "x" }], limitado: true }; };
  const ctl = createWebCtl({ api, root: () => null, hilo: () => ({ id: 1 }), recargar() {}, error: (t) => { err = t; } });
  await ctl.clic({ dataset: { w: "sondear", round: "9" } });
  assert.equal(ctl.estado.candidatos[9][0].ref, "x"); assert.equal(ctl.estado.limitado[9], true);
  await ctl.clic({ dataset: { w: "vincular", round: "9", envio: "3", tipo: "pr", ref: "5" } });
  assert.equal(err, ERRORES_WEB.fork_no_permitido);
  await ctl.clic({ dataset: { w: "extra", round: "9" } }); // sin elegir destino: no envía
  assert.match(err, /Elija/);
});

test("esc", () => assert.equal(esc(`<&"'>`), "&lt;&amp;&quot;&#39;&gt;"));

import { readFileSync } from "node:fs";
const leer = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
test("ids de pro.js en index.html, caché del service worker con los archivos nuevos", () => {
  const ids = new Set([...leer("index.html").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of leer("js/pro.js").matchAll(/\$\("([^"]+)"\)/g)) if (!/^(plan-edit|corr-text)$/.test(m[1])) assert.ok(ids.has(m[1]), m[1]);
  const sw = leer("sw.js");
  for (const p of ['"/js/pro-web.js"', '"/js/movil-pro.js"']) assert.ok(sw.includes(p), p);
  assert.ok(!/innerHTML\s*=\s*[^;]*\b(err|S\.error)\b/.test(leer("js/movil-pro.js")), "los errores van con textContent");
});
