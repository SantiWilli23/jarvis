// Memoria central (docs/MEMORIA.md) y seguir el chat de Claude. PC y navegador falsos, sin red.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { parseNavIntent } from "../server/nav-intents.js";
import { lineasDeMemoria, parseMemoriaIntent, TEXTO_RECOGER, CADA_MS } from "../server/memoria-reparto.js";
import { decidir } from "../desktop/runner/nav-guard.js";
import { politicaDe, navPrompt } from "../desktop/runner/nav-worker.js";
import { buildNavArgs } from "../desktop/runner/claude-args.js";
import { clock } from "./helpers.js";

const now = clock();
let server, base, ctx, token, pcToken, uid;
const call = (path, { method = "GET", body, tk = token } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const json = async (...a) => (await call(...a)).json();
const pc = (path, body = {}) => json("/api/agent/nav" + path, { method: "POST", body, tk: pcToken });
const claim = async () => (await pc("/claim")).task;
const hello = (capabilities = { chrome: { ok: true } }) => call("/api/agent/hello", { method: "POST", body: { host: "pc", capabilities }, tk: pcToken });
const sql = async (q, args = []) => (await ctx.db.execute({ sql: q, args })).rows;
const nota = (body, o = {}) => ctx.notes.add({ userId: uid, body, ...o });
async function limpiar() {
  for (const t of ["nav_tasks", "memoria_repartos", "notes"]) await sql(`DELETE FROM ${t}`);
  await sql("DELETE FROM settings WHERE key LIKE 'memoria_%'");
  now.advance(25 * 3_600_000);
}

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" }, now });
  uid = ctx.ownerId;
  server = createApp(ctx).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await json("/api/auth/login", { method: "POST", body: { password: "prueba-123" }, tk: null })).token;
  pcToken = (await json("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).token;
});
after(() => server.close());

test("frases de Claude y de memoria", () => {
  for (const t of ["Háblale a Claude de los púlsares", "dile a Claude de los púlsares", "Jarvis, sigue con Claude: de los púlsares"]) {
    assert.deepEqual(parseNavIntent(t), { tipo: "preguntar_ia", sitio: "claude", consulta: "de los púlsares" }, t);
  }
  assert.deepEqual(parseNavIntent("Chat nuevo con Claude: hola"), { tipo: "preguntar_ia", sitio: "claude", consulta: "hola", nuevo: true });
  for (const t of ["dile a Claude Code que compile", "sigue con Claude Code", "ayer le dije a Claude algo", "dile a Gemini hola"]) assert.equal(parseNavIntent(t), null, t);
  assert.equal(parseMemoriaIntent("Jarvis, reparte mi memoria"), "repartir");
  assert.equal(parseMemoriaIntent("recoge mi memoria por favor"), "recoger");
  assert.equal(parseMemoriaIntent("no repartas mi memoria"), null);
});

test("seguir el mismo chat: url anterior revalidada, 'chat nuevo' la evita y vence por horas", async () => {
  await limpiar();
  const URL1 = "https://claude.ai/chat/abc-123";
  const una = async (extra) => {
    await hello();
    await ctx.nav.enqueue({ userId: uid, tipo: "preguntar_ia", sitio: "claude", consulta: "hola", ...extra });
    const t = await claim();
    await pc(`/${t.id}/result`, { estado: "ok", respuesta: "r", url_conversacion: URL1 });
    return t;
  };
  assert.equal((await una()).url_inicial, "https://claude.ai/new");
  const t2 = await una();
  assert.deepEqual([t2.url_inicial, t2.continuacion], [URL1, true]);
  const t3 = await una({ nuevo: true });
  assert.deepEqual([t3.url_inicial, t3.continuacion], ["https://claude.ai/new", undefined]);
  now.advance(13 * 3_600_000);
  assert.equal((await una()).url_inicial, "https://claude.ai/new");
  // Misma conversación de Jarvis: aunque hayan pasado las horas.
  await una({ conversationId: 5 });
  now.advance(13 * 3_600_000);
  assert.equal((await una({ conversationId: 5 })).url_inicial, URL1);
  // Una dirección manipulada en la base no se entrega.
  await hello();
  await ctx.nav.enqueue({ userId: uid, tipo: "preguntar_ia", sitio: "claude", consulta: "x" });
  await sql("UPDATE nav_tasks SET url_inicial='https://claude.ai/settings' WHERE estado='pendiente'");
  assert.equal((await claim()).url_inicial, "https://claude.ai/new");
  assert.match(navPrompt({ ...t2, limites: { hosts: ["claude.ai"] } }), /conversación ya empezada/);
});

test("líneas de memoria: descarta secretos y lo escolar, deduplica y limita", () => {
  const r = lineasDeMemoria(["Esto recuerdo:", "- Le gusta el café", "2. le gusta el café.", "Su contraseña es abc", "Tarjeta 4111 1111", "RUT 12.345.678-5", "Va al colegio en bus", "Tiene prueba el lunes", "* Vive cerca del mar", "NADA", "x".repeat(600)].join("\n"));
  assert.deepEqual(r, ["Le gusta el café", "Vive cerca del mar"]);
  assert.equal(lineasDeMemoria(Array.from({ length: 200 }, (_, i) => `dato número ${i}`).join("\n")).length, 80);
});

test("recoger: una IA a la vez, queda en revisión, sin guardar la respuesta; un fallo no se reintenta", async () => {
  await limpiar();
  await hello();
  await nota("Le gusta el café");
  const r = await json("/api/chat", { method: "POST", body: { text: "recoge mi memoria" } });
  assert.equal(r.status, "memoria");
  const t = await claim();
  assert.deepEqual([t.tipo, t.sitio, t.consulta, t.url_inicial], ["memoria_recoger", "claude", TEXTO_RECOGER, "https://claude.ai/new"]);
  assert.equal((await sql("SELECT * FROM nav_tasks")).length, 1);
  await pc(`/${t.id}/result`, { estado: "ok", respuesta: "- Le gusta el café\n- Prefiere el té verde\n- Su correo es ejemplo@example.com" });
  const nuevas = await sql("SELECT body, level, status FROM notes WHERE origen='ia:claude' ORDER BY id");
  assert.deepEqual(nuevas.map((n) => [n.body, n.level, n.status]), [["Prefiere el té verde", "normal", "revision"], ["Su correo es ejemplo@example.com", "privada", "revision"]]);
  assert.ok(!JSON.stringify(await sql("SELECT * FROM nav_tasks WHERE id=?", [t.id])).includes("té verde"));
  const g = await claim();
  await pc(`/${g.id}/result`, { estado: "necesita_login" });
  const m = await claim();
  await pc(`/${m.id}/result`, { estado: "ok", respuesta: "NADA" });
  assert.equal(await claim(), null);
  const { repartos } = await json("/api/memoria-reparto");
  assert.deepEqual(repartos.map((x) => [x.destino, x.estado, x.cantidad]).reverse(), [["claude", "ok", 2], ["chatgpt", "necesita_login", 0], ["gemini", "ok", 0]]);
});

test("repartir: vista previa, hash, solo lo que puede salir, mensual sin bucles", async () => {
  await limpiar();
  await hello();
  await nota("Le gusta el café\ncon leche <b>");
  await nota("Dato reservado", { level: "privada" });
  await nota("Va al colegio en bus");
  await nota("Algo de ayer", { origen: "escolar" });
  await nota("Pendiente de revisar", { status: "revision" });
  await nota("mi contraseña es 1234");
  const v = await json("/api/memoria-reparto/vista");
  assert.equal(v.cantidad, 1);
  assert.match(v.texto, /Datos: \(1\) Le gusta el café con leche b$/);
  await ctx.memoriaReparto.tick(uid);
  assert.equal(await claim(), null); // sin aprobación no hay nada automático
  assert.equal((await call("/api/memoria-reparto/repartir", { method: "POST", body: { hash: "otro" } })).status, 409);
  assert.equal((await call("/api/memoria-reparto/repartir", { method: "POST", body: { hash: v.hash } })).status, 200);
  for (let i = 0; i < 3; i++) {
    const t = await claim();
    assert.deepEqual([t.tipo, t.consulta], ["memoria_repartir", v.texto]);
    assert.equal((await json("/api/nav/tasks")).tasks[0].consulta, "Repartir memoria");
    await pc(`/${t.id}/result`, { estado: "ok", respuesta: "Anotado" });
  }
  let e = await json("/api/memoria-reparto");
  assert.deepEqual(e.repartos.map((x) => x.estado), ["enviado", "enviado", "enviado"]);
  assert.equal(e.automatico.activo, true);
  assert.ok(!JSON.stringify(await sql("SELECT * FROM nav_tasks")).includes("café"));

  now.advance(CADA_MS + 1);
  await hello({ claude: { ok: true } }); // sin navegador: se espera, sin anotar nada
  await ctx.memoriaReparto.tick(uid);
  assert.equal((await sql("SELECT * FROM memoria_repartos")).length, 3);
  await hello();
  await ctx.memoriaReparto.tick(uid);
  assert.equal((await claim()).tipo, "memoria_recoger");
  now.advance(600_000); // el PC deja de responder: vence y se cancela el resto
  await ctx.memoriaReparto.tick(uid);
  await ctx.memoriaReparto.tick(uid);
  await hello();
  await ctx.memoriaReparto.tick(uid);
  e = await json("/api/memoria-reparto");
  assert.equal(e.repartos.length, 9);
});

test("borrar datos apaga el reparto; PC sin navegador no encola", async () => {
  await json("/api/memoria-reparto/datos", { method: "DELETE" });
  const e = await json("/api/memoria-reparto");
  assert.deepEqual([e.notas.length, e.repartos.length, e.automatico.activo], [0, 0, false]);
  await hello({ claude: { ok: true } });
  assert.equal((await call("/api/memoria-reparto/recoger", { method: "POST", body: {} })).status, 409);
  assert.equal((await sql("SELECT * FROM memoria_repartos")).length, 0);
});

test("guardia: en memoria solo se teclea el texto aprobado", () => {
  const pol = politicaDe({ tipo: "memoria_repartir", perfil: "ia", consulta: "texto aprobado", limites: { hosts: ["claude.ai"] } });
  const d = (n, i) => decidir(pol, `mcp__claude-in-chrome__${n}`, i).ok;
  assert.ok(d("computer", { action: "type", text: "texto aprobado" }));
  assert.ok(d("computer", { action: "key", text: "Return" }));
  assert.ok(d("computer", { action: "left_click" }));
  assert.ok(d("form_input", { value: "texto aprobado" }));
  assert.ok(!d("computer", { action: "type", text: "texto aprobado y más" }));
  assert.ok(!d("computer", { action: "key", text: "ctrl+v" }));
  assert.ok(!d("computer", { action: "left_click_drag" }));
  assert.ok(!d("form_input", { value: true }));
  assert.ok(!d("browser_batch", { actions: [{ name: "computer", input: { action: "type", text: "otra" } }] }));
  assert.equal(politicaDe({ tipo: "preguntar_ia", perfil: "ia" }).texto_exacto, undefined);
  const sistema = (m) => buildNavArgs({ perfil: "ia", memoria: m }).join("\n");
  assert.ok(sistema(true).includes("EXACTAMENTE") && !sistema(false).includes("EXACTAMENTE"));
});
