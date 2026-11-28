// Selector Haiku/Sonnet (docs/NAV.md "Modelo"): reglas, forzado por texto, escalada y compatibilidad. Sin red ni modelos reales.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { elegirModelo, elegirModeloTextos } from "../server/modelo-elige.js";
import { parseNavIntent } from "../server/nav-intents.js";
import { createDb } from "../server/db/client.js";
import { initSchema } from "../server/db/index.js";
import { buildContext } from "../server/context.js";
import { setNavElegirModelo } from "../server/settings.js";
import { proReasons } from "../server/pro/reasons.js";
import { createNavWorker, actua } from "../desktop/runner/nav-worker.js";
import { createTextosWorker } from "../desktop/runner/textos-worker.js";
import { createControlState } from "../desktop/runner/control-state.js";
import { buildArgs, buildNavArgs, buildTextosArgs } from "../desktop/runner/claude-args.js";
import { buildDescribeArgs } from "../desktop/runner/pc-capture.js";
import { clock } from "./helpers.js";

const HAIKU = "claude-haiku-5-5", DIA = 86_400_000;
const flag = (a, f) => a[a.indexOf(f) + 1];
const elige = (o) => elegirModelo({ tipo: "preguntar_ia", sitio: "chatgpt", perfil: "ia", consulta: "qué es un púlsar", ...o });

test("fuera de Pro el modelo va explícito y nunca es Opus", () => {
  for (const a of [buildArgs({ task: { header: {} } }), buildDescribeArgs(), buildDescribeArgs({ model: null }), buildTextosArgs(),
    buildNavArgs({ model: "claude-opus-5-5" }), buildTextosArgs({ model: "opus" })]) assert.equal(flag(a, "--model"), "sonnet");
  assert.equal(flag(buildNavArgs({ model: HAIKU }), "--model"), HAIKU);
});

test("selector: puntos y umbral", () => {
  for (const sitio of ["chatgpt", "gemini", "perplexity", "grok"]) assert.deepEqual(elige({ sitio }), { modelo: HAIKU, puntos: 0, motivos: [] });
  assert.equal(elige({ tipo: "buscar_google", sitio: "google", perfil: "lectura" }).modelo, HAIKU);
  assert.deepEqual([elige({ sitio: "claude" }).puntos, elige({ continuacion: true }).puntos, elige({ capturas: true }).puntos, elige({ consulta: "a".repeat(1501) }).puntos], [1, -1, 2, 1]);
  assert.equal(elige({ sitio: "claude", capturas: true }).modelo, "sonnet"); // 3 puntos
  for (const tipo of ["investigar", "estudio", "memoria_recoger", "memoria_repartir"]) assert.equal(elige({ tipo }).modelo, "sonnet", tipo);
  assert.equal(elige({ consulta: "primero busca el precio y luego compáralo" }).puntos, 2);
  for (const c of ["entrégalo en la página", "rellena el formulario", "quiero publicar esto", "mira la foto y súbela", "baja el archivo y sube el informe"]) assert.equal(elige({ consulta: c }).modelo, "sonnet", c);
  for (const c of ["por qué sube la marea", "qué es la universidad pública", "cuándo es la entrega de los Óscar", "qué es el relleno sanitario", "qué hago primero"]) assert.equal(elige({ consulta: c }).puntos, 0, c);
  assert.equal(elige({ historial: { casos: 4, fallos: 1 } }).modelo, "sonnet");
  assert.equal(elige({ historial: { casos: 3, fallos: 3 } }).modelo, HAIKU);
  assert.equal(elige({ historial: { casos: 8, fallos: 1 } }).modelo, HAIKU);
  assert.equal(elige({ perfil: "escolar", continuacion: true }).modelo, "sonnet");
  assert.equal(elige({ consulta: "ayúdame con la tarea de mi colegio" }).modelo, "sonnet");
  assert.equal(elige({ cfg: { modelos: { fuerte: "opus" } }, capturas: true, sitio: "claude" }).modelo, "sonnet");
});

test("textos: Haiku solo si es corto, informal, sin código y no escolar", () => {
  const t = (texto, tipo = "otro") => elegirModeloTextos({ tipo, texto });
  assert.equal(t("resume esto en dos líneas"), HAIKU);
  for (const x of ["a".repeat(2000), "escribe una carta formal", "corrige este código en python", "```x```"]) assert.equal(t(x), "sonnet", x.slice(0, 30));
  assert.equal(t("corto", "repaso"), "sonnet");
});

test("forzar por texto: se quita de la consulta y no hay falsos positivos", () => {
  const ia = (consulta, modelo) => ({ tipo: "preguntar_ia", sitio: "chatgpt", consulta, ...(modelo ? { modelo } : {}) });
  assert.deepEqual(parseNavIntent("pregúntale a ChatGPT con haiku qué es un púlsar"), ia("qué es un púlsar", "barato"));
  assert.deepEqual(parseNavIntent("Jarvis, con Sonnet, pregúntale a ChatGPT qué es un púlsar"), ia("qué es un púlsar", "fuerte"));
  assert.deepEqual(parseNavIntent("pregúntale a ChatGPT qué es un púlsar, modelo rápido"), ia("qué es un púlsar", "barato"));
  assert.deepEqual(parseNavIntent("pregúntale a ChatGPT usando el modelo fuerte: qué es un púlsar"), ia("qué es un púlsar", "fuerte"));
  assert.equal(parseNavIntent("busca en google con haiku vuelos a Cali").modelo, "barato");
  const inv = parseNavIntent("investiga volcanes, con sonnet.");
  assert.deepEqual([inv.consulta, inv.modelo], ["volcanes", "fuerte"]);
  for (const c of ["qué es Claude Sonnet", "escribe un poema con haiku", "escríbeme un haiku", "qué diferencia a sonnet de haiku", "cómo se cocina con el modelo rápido de olla", "compara haiku, sonnet y opus", "cuál es el modelo fuerte de Toyota"]) {
    assert.deepEqual(parseNavIntent(`pregúntale a ChatGPT ${c}`), ia(c), c);
  }
});

test("actua: solo mirar no cuenta; clic, tecleo, formulario o dirección que envía, sí", () => {
  const C = "mcp__claude-in-chrome__";
  assert.equal(actua(C + "browser_batch", { actions: [{ name: "navigate", input: { url: "https://chatgpt.com/" } }, { name: "computer", input: { action: "screenshot" } }] }), false);
  assert.equal(actua(C + "navigate", { url: "https://www.google.com/search?q=x" }), false);
  for (const [n, i] of [["computer", { action: "left_click" }], ["computer", { action: "type" }], ["form_input", {}], ["navigate", { url: "https://chatgpt.com/?q=hola" }], ["browser_batch", { actions: [{ name: "computer", input: { action: "key" } }] }]]) assert.equal(actua(C + n, i), true, n);
});

// --- Escalada en el PC (Claude falso).
const fx = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const CLAUDE = { command: process.execPath, prefix: [join(fx, "fake-claude.mjs")] };
const OK = "```json\n" + JSON.stringify({ estado: "ok", respuesta: "bien", fuentes: [] }) + "\n```";
const limpiarEnv = () => { for (const k of Object.keys(process.env)) if (k.startsWith("FAKE_")) delete process.env[k]; };
async function correr(env, limites = {}) {
  const out = join(mkdtempSync(join(tmpdir(), "modelo-")), "f");
  limpiarEnv();
  Object.assign(process.env, { FAKE_OUT: out, FAKE_RESULT: OK, ...env });
  const tarea = { id: 1, tipo: "preguntar_ia", sitio: "chatgpt", consulta: "hola", url_inicial: "https://chatgpt.com/",
    limites: { hosts: ["chatgpt.com"], timeout_s: 180, max_budget_usd: 0.2, modelo: HAIKU, escalar: "sonnet", margen_dia_usd: 1, ...limites } };
  const res = [];
  let dada = false;
  const hub = { navClaim: async () => (dada ? { task: null } : (dada = true, { task: tarea })), navResult: async (_id, b) => { res.push(b); }, navEvents: async () => ({}) };
  await createNavWorker({ hub, claude: CLAUDE, navDir: join(mkdtempSync(join(tmpdir(), "modelo-nav-")), "nav") }).tick();
  const modelos = [];
  for (let n = 0; existsSync(`${out}.${n}.args.json`); n++) modelos.push(flag(JSON.parse(readFileSync(`${out}.${n}.args.json`, "utf8")), "--model"));
  limpiarEnv();
  return { r: res[0], modelos };
}
const falla = (texto, extra = {}) => ({ FAKE_ERR_MODEL: HAIKU, FAKE_ERR_TEXT: texto, FAKE_COSTO: "0.02", ...extra });
const SIN_MODELO = "There is an issue with the selected model. It may not exist";

test("escalada: un solo reintento con Sonnet y se suman los costos", async () => {
  for (const [env, causa] of [[falla(SIN_MODELO), "modelo_no_disponible"], [falla("x", { FAKE_ERR_SUBTYPE: "error_max_turns" }), "error_max_turns"], [falla("x", { FAKE_ERR_SUBTYPE: "error_max_budget_usd" }), "tope_costo_tarea"]]) {
    const { r, modelos } = await correr(env);
    assert.deepEqual(modelos, [HAIKU, "sonnet"], causa);
    assert.deepEqual([r.estado, r.escalada, r.motivo_escalada], ["ok", true, causa]);
    assert.equal(r.uso.costo_usd, 0.04);
  }
  for (const [respuesta, causa] of [["sin bloque", "sin_json"], ["```json\n{\"estado\":\"error\",\"respuesta\":\"no pude\"}\n```", "estado_error"]]) {
    const { r, modelos } = await correr({ FAKE_RESULT: respuesta, FAKE_COSTO: "0.02" });
    assert.deepEqual(modelos, [HAIKU, "sonnet"], "una sola vez aunque Sonnet también falle");
    assert.equal(r.motivo_escalada, causa);
  }
});

test("escalada: casos en que no se reintenta", async () => {
  const casos = {
    sin_login: [falla("Please run /login")],
    sin_cuota: [falla("You hit your usage limit")],
    "sin permiso del servidor": [falla(SIN_MODELO), { escalar: undefined }],
    "intento caro": [falla("x", { FAKE_ERR_SUBTYPE: "error_max_turns", FAKE_COSTO: "0.1" })],
    "sin tope diario": [falla(SIN_MODELO), { margen_dia_usd: 0.01 }],
    "ya tecleó": [falla("x", { FAKE_ERR_SUBTYPE: "error_max_turns", FAKE_ERR_TOOLS: JSON.stringify([{ name: "mcp__claude-in-chrome__computer", input: { action: "type", text: "hola" } }]) })],
    captcha: [{ FAKE_RESULT: "```json\n{\"estado\":\"captcha\",\"respuesta\":\"\"}\n```" }],
    bloqueado: [{ FAKE_TOOLS: JSON.stringify([{ name: "mcp__claude-in-chrome__navigate", input: { url: "https://malo.example/" } }]), FAKE_HANG_MS: "30000" }],
  };
  for (const [nombre, [env, lim]] of Object.entries(casos)) {
    const { r, modelos } = await correr(env, lim);
    assert.equal(modelos.length, 1, nombre);
    assert.equal(r.escalada, undefined, nombre);
  }
});

test("compatibilidad: claim sin modelo => Sonnet; textos usa el modelo del servidor si viene", async () => {
  assert.deepEqual((await correr({}, { modelo: undefined, escalar: undefined, margen_dia_usd: undefined })).modelos, ["sonnet"]);
  for (const [extra, esperado] of [[{}, "sonnet"], [{ modelo: HAIKU }, HAIKU], [{ modelo: "opus" }, "sonnet"]]) {
    let visto;
    const hub = { textosClaim: async () => ({ task: { id: 1, tipo: "x", texto: "hola", ...extra } }), textosResult: async () => {} };
    await createTextosWorker({ hub, claude: CLAUDE, control: createControlState(), runClaude: async ({ args }) => { visto = flag(args, "--model"); return { result: "ok" }; } }).tick();
    assert.equal(visto, esperado);
  }
});

// --- Servidor.
const now = clock();
let ctx, uid;
const REQ = ["claude-opus-5-5", "claude-sonnet-5-5"];
const hello = (claude = { ok: true, modelos: [...REQ, HAIKU] }) => ctx.agent.hello(uid, { capabilities: { chrome: { ok: true }, claude, repos: ["C:/r"] } });
const limpiar = () => ctx.db.execute("DELETE FROM nav_tasks");
const fila = async (id) => (await ctx.db.execute({ sql: "SELECT * FROM nav_tasks WHERE id=?", args: [id] })).rows[0];
async function tarea({ claude, ...o } = {}) {
  now.advance(1000);
  await hello(claude);
  const { id } = await ctx.nav.enqueue({ userId: uid, tipo: "preguntar_ia", sitio: "chatgpt", consulta: "qué es un púlsar " + Math.random(), ...o });
  return (await ctx.nav.claim(uid, 1)).task || assert.fail("sin tarea " + id);
}
const resultado = (id, o = {}) => ctx.nav.result(uid, 1, id, { estado: "ok", respuesta: "r", ...o });

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" }, now });
  uid = ctx.ownerId;
  ctx.nav.config.ahorro.elegir_modelo = false; // cada prueba enciende lo que necesita
});

test("selector apagado: igual que antes, pero forzar por texto funciona", async () => {
  await limpiar();
  assert.equal(ctx.nav.config.ahorro.elegir_modelo, false);
  let t = await tarea();
  assert.deepEqual([t.limites.modelo, t.limites.escalar], ["sonnet", undefined]);
  await resultado(t.id);
  t = await tarea({ modelo: "barato" });
  assert.deepEqual([t.limites.modelo, t.limites.escalar], [HAIKU, "sonnet"]);
  assert.ok(t.limites.margen_dia_usd > 0);
  await resultado(t.id);
  assert.equal((await ctx.nav.ver(uid, t.id)).task.modelo_motivo, "pedido por usted");
});

test("ajuste por usuario enciende el selector; escalada guardada; sin Haiku en el PC se usa Sonnet", async () => {
  await limpiar();
  await setNavElegirModelo(ctx.db, uid, true);
  let t = await tarea();
  assert.equal(t.limites.modelo, HAIKU);
  await resultado(t.id, { escalada: true, motivo_escalada: "sin_json" });
  const v = (await ctx.nav.ver(uid, t.id)).task;
  assert.deepEqual([v.modelo, v.escalada], ["sonnet", true]);
  assert.match(v.modelo_motivo, /repetido con Sonnet/);
  const sin = { ok: false, error: "modelo_no_disponible", modelos: REQ, faltan: [HAIKU] };
  t = await tarea({ claude: sin, modelo: "barato" });
  assert.equal(t.limites.modelo, "sonnet");
  // El barato que falta no deja a Pro sin Claude.
  assert.equal(ctx.agent.capabilities().claude.ok, true);
  assert.deepEqual(proReasons({ pcOnline: true, caps: ctx.agent.capabilities(), cfg: { modelos: { claude: { planear: REQ[0], programar: REQ[1] } } } }).filter((r) => /claude|modelo/i.test(JSON.stringify(r))), []);
  await resultado(t.id);
  const h = await hello();
  assert.ok(h.pro.modelos_claude.includes(HAIKU));
  assert.equal(h.modelos.capturas, "sonnet");
});

test("historial: con 25% de fallos de Haiku se usa Sonnet", async () => {
  await limpiar();
  await setNavElegirModelo(ctx.db, uid, true);
  now.advance(2 * 3_600_000);
  for (let i = 0; i < 4; i++) {
    const t = await tarea();
    assert.equal(t.limites.modelo, HAIKU, String(i));
    await resultado(t.id, i === 0 ? { estado: "error", error: "x" } : {});
  }
  const t = await tarea();
  assert.equal(t.limites.modelo, "sonnet");
  assert.match((await fila(t.id)).modelo_motivo, /fallado/);
  await resultado(t.id);
});

test("regla de vuelta: si Haiku no ahorra se apaga 7 días", async () => {
  await limpiar();
  await setNavElegirModelo(ctx.db, uid, false);
  now.advance(2 * 3_600_000);
  let t = await tarea({ sitio: "gemini" });
  await resultado(t.id, { uso: { costo_usd: 0.05 } });
  await setNavElegirModelo(ctx.db, uid, true);
  for (let i = 0; i < 4; i++) {
    t = await tarea({ sitio: "gemini" });
    assert.equal(t.limites.modelo, HAIKU);
    await resultado(t.id, { uso: { costo_usd: 0.04 } });
  }
  now.advance(2 * 3_600_000); // fuera del tope por hora
  t = await tarea({ sitio: "gemini" });
  assert.equal(t.limites.modelo, "sonnet");
  assert.match((await fila(t.id)).modelo_motivo, /pausa/);
  await resultado(t.id);
  now.advance(8 * DIA);
  t = await tarea({ sitio: "gemini" });
  assert.equal(t.limites.modelo, HAIKU);
  await resultado(t.id);
});

test("migración: columnas del selector en una base antigua", async () => {
  const db = createDb({ url: ":memory:" });
  await db.execute("CREATE TABLE nav_tasks (id INTEGER PRIMARY KEY, user_id INTEGER, conversation_id INTEGER, tipo TEXT, sitio TEXT, consulta TEXT, estado TEXT, respuesta TEXT, fuentes TEXT, error TEXT, device_id INTEGER, creado INTEGER, tomado INTEGER, terminado INTEGER)");
  await initSchema(db);
  const cols = (await db.execute("PRAGMA table_info(nav_tasks)")).rows.map((c) => c.name);
  for (const c of ["modelo", "modelo_motivo", "escalada", "modelo_forzado"]) assert.ok(cols.includes(c), c);
});
