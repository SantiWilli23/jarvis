// Lo escolar (docs/NAV.md): intents, chat, cuenta, cifrado, purga, privacidad y rutas. Datos inventados y nav falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext, loadJson } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createEscolar } from "../server/escolar.js";
import { createCrypto } from "../server/crypto.js";
import { parseEscolarIntent } from "../server/escolar-intents.js";
import { createPrivacy } from "../server/router/privacy.js";
import { clock, spy, memDb } from "./helpers.js";

const CORREO = "ejemplo@example.com";
const item = { curso: "Curso Inventado", tipo: "tarea", titulo: "Maqueta del volcán", fecha: "2026-01-09", url: "https://classroom.google.com/c/abc", resumen: "Armar una maqueta secreta" };
const ok = (extra = {}) => ({ estado: "ok", cuenta_visible: `Alumno (${CORREO})`, items: [item], ...extra });

async function armar(secreto = "clave-de-prueba-larga-123") {
  const { db, userId } = await memDb();
  const now = clock();
  const nav = { pedidos: [], handler: null, registrar: (tipo, h) => { assert.equal(tipo, "estudio"); nav.handler = h; }, enqueue: async (p) => { nav.pedidos.push(p); return { id: nav.pedidos.length, estado: "pendiente" }; } };
  const escolar = createEscolar({ db, config: loadJson("escolar.json"), crypto: createCrypto(secreto), nav, now });
  const volcado = async () => JSON.stringify((await db.execute("SELECT * FROM estudio_items")).rows);
  return { db, userId, now, nav, escolar, volcado };
}

test("intents: frases escolares, IRMI es Lirmi, y nada más", () => {
  const a = (accion, fuente) => ({ accion, fuente });
  assert.deepEqual(parseEscolarIntent("Revisa mi Classroom"), a("actualizar", "classroom"));
  assert.deepEqual(parseEscolarIntent("revisa google classroom"), a("actualizar", "classroom"));
  assert.deepEqual(parseEscolarIntent("Jarvis, revisa IRMI."), a("actualizar", "lirmi"));
  assert.deepEqual(parseEscolarIntent("revísame lirmi por favor"), a("actualizar", "lirmi"));
  assert.deepEqual(parseEscolarIntent("¿Qué tareas tengo?"), a("listar", null));
  assert.deepEqual(parseEscolarIntent("qué tareas tengo en classroom para mañana"), a("listar", "classroom"));
  for (const t of ["revisa mi código", "qué es classroom", "revisa classroom y manda un correo", "qué tareas tiene un jardinero", ""]) assert.equal(parseEscolarIntent(t), null, t);
});

test("privacidad: nivel escolar solo claude", () => {
  const p = createPrivacy({ allowed: ["claude", "groq"], localSafe: ["fake"] });
  assert.deepEqual(p.filter(["claude", "groq", "gemini", "fake", "web_claude"], "escolar"), ["claude"]);
  assert.throws(() => p.assert("groq", "escolar"));
  assert.deepEqual(p.filter(["claude", "groq", "gemini"], true), ["claude", "groq"]);
});

test("actualizar: pide correo en Classroom, no en Lirmi, y encola con url y cuenta", async () => {
  const { userId, nav, escolar } = await armar();
  await assert.rejects(escolar.actualizar({ userId, fuente: "classroom" }), { error: "falta_correo" });
  await assert.rejects(escolar.actualizar({ userId, fuente: "constructor" }), { error: "fuente_desconocida" });
  await escolar.actualizar({ userId, fuente: "lirmi" });
  await escolar.setCorreo(userId, "Ejemplo@Example.com");
  await escolar.actualizar({ userId, fuente: "classroom" });
  assert.deepEqual(nav.pedidos.map((p) => [p.tipo, p.sitio, p.urlInicial, p.cuenta]), [
    ["estudio", "lirmi", "https://global-sso.lirmi.com/", null],
    ["estudio", "classroom", "https://classroom.google.com/", { correo: CORREO }],
  ]);
  await assert.rejects(escolar.setCorreo(userId, "no es correo"), { error: "correo_invalido" });
  const sin = await armar("");
  await assert.rejects(sin.escolar.actualizar({ userId: sin.userId, fuente: "lirmi" }), { error: "sin_cifrado" });
});

test("recibir: cuenta distinta o ausente se descarta; la correcta se guarda cifrada y con enlaces filtrados", async () => {
  const { userId, nav, escolar, volcado } = await armar();
  await escolar.setCorreo(userId, CORREO);
  const tarea = { user_id: userId, sitio: "classroom" };
  for (const cuenta_visible of ["otra@example.com", "", undefined, "sin correo", `x${CORREO}`]) {
    assert.equal((await nav.handler(tarea, ok({ cuenta_visible }))).estado, "cuenta_incorrecta");
  }
  assert.equal(await volcado(), "[]");
  const r = await nav.handler(tarea, ok({ items: [item, { ...item, titulo: "Mala", url: "https://sitio.test/x" }] }));
  assert.equal(r.estado, "ok");
  assert.ok(!/volc|Curso/.test(r.mensaje));
  assert.ok(!/volc|Curso|maqueta|classroom\.google/i.test(await volcado()));
  const s = await escolar.resumen(userId);
  assert.deepEqual(s.items[0], { fuente: "classroom", ...item });
  assert.equal(s.items[1].url, "");
  assert.equal(s.cuentas[0].correo, CORREO);
  // Un fallo no borra lo guardado
  assert.equal((await nav.handler(tarea, { estado: "necesita_login" })).estado, "necesita_login");
  assert.equal((await nav.handler(tarea, ok({ items: undefined }))).estado, "error");
  assert.equal((await escolar.resumen(userId)).items.length, 2);
  await escolar.setCorreo(userId, "otra@example.com");
  assert.equal((await escolar.resumen(userId)).items.length, 0);
});

test("purga a los 30 días", async () => {
  const { userId, now, escolar, volcado } = await armar();
  await escolar.recibir({ user_id: userId, sitio: "lirmi" }, { estado: "ok", items: [{ ...item, url: "https://aula.lirmi.com/t/1" }] });
  now.advance(29 * 86_400_000);
  assert.equal((await escolar.resumen(userId)).items.length, 1);
  now.advance(2 * 86_400_000);
  await escolar.purge();
  assert.equal(await volcado(), "[]");
});

test("chat y rutas: el contenido no llega a modelos ni a messages", async () => {
  const ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123", CONNECTIONS_KEY: "clave-de-prueba-larga-123" } });
  const groq = spy("groq"); ctx.providers.groq = groq;
  const pedidos = [];
  ctx.nav.enqueue = async (p) => { pedidos.push(p); return { id: 7, estado: "pendiente" }; };
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let token = null;
  const call = (path, method = "GET", body, tk = token) => fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const chat = async (body) => (await call("/chat", "POST", body)).json();
  try {
    token = (await (await call("/auth/login", "POST", { password: "prueba-123" })).json()).token;
    assert.equal((await call("/escolar", "GET", undefined, null)).status, 401);
    assert.equal((await call("/escolar/actualizar", "POST", { fuente: "classroom" })).status, 409);
    assert.equal((await call("/escolar/cuentas", "PUT", { classroom_correo: CORREO })).status, 200);
    assert.deepEqual(await (await call("/escolar/actualizar", "POST", { fuente: "classroom" })).json(), { task_id: 7 });
    let r = await chat({ text: "revisa mi classroom" });
    assert.deepEqual([r.status, r.private, r.nav.id], ["escolar", true, 7]);
    const conversationId = r.conversationId;
    assert.equal(pedidos.at(-1).conversationId, conversationId);
    await ctx.escolar.recibir({ user_id: ctx.ownerId, sitio: "classroom" }, ok());
    assert.equal((await (await call("/escolar")).json()).items.length, 1);

    r = await chat({ text: "qué tareas tengo", conversationId });
    assert.match(r.reply, /Maqueta del volcán/);
    r = await chat({ text: "explícame la tarea del volcán", conversationId });
    assert.equal(r.status, "escolar");
    assert.match(r.reply, /maqueta secreta/);
    r = await chat({ text: "de qué trata la primera", conversationId });
    assert.equal(r.status, "escolar");
    assert.equal(groq.calls, 0);
    const msgs = JSON.stringify((await ctx.db.execute("SELECT content FROM messages")).rows);
    assert.ok(!/Maqueta del|maqueta secreta|Curso Inventado/.test(msgs));
    // Fuera de lo escolar, la charla sigue normal
    assert.notEqual((await chat({ text: "gracias", conversationId })).status, "escolar");
    // El Atajo no recibe contenido
    const a = await ctx.chat.handle({ userId: ctx.ownerId, text: "qué tareas tengo", source: "atajo" });
    assert.ok(!/volc/.test(a.reply));
    // Modo Chat: no se encola
    await call("/settings", "PUT", { modo: "chat" });
    const n = pedidos.length;
    assert.notEqual((await chat({ text: "revisa mi classroom" })).status, "escolar");
    assert.equal(pedidos.length, n);
  } finally { server.close(); }
});
