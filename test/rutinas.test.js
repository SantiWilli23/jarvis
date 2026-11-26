// Rutinas (docs/CONTROL.md). Sin red: proveedor de pruebas y PC simulado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContext } from "../server/context.js";
import { all } from "../server/db/client.js";
import { setModo } from "../server/settings.js";
import { parseCrear, toca, MAX_PASOS } from "../server/rutinas.js";
import { memDb, clock } from "./helpers.js";

// Viernes 6-nov-2026, 18:00 en Santiago (UTC-3).
const VIERNES = Date.UTC(2026, 10, 6, 21, 0, 0);

async function levantar() {
  const { db } = await memDb();
  const now = clock(VIERNES - 3_600_000);
  const avisos = [];
  const webpush = { generateVAPIDKeys: () => ({ publicKey: "p", privateKey: "s" }), sendNotification: async (_s, p) => { avisos.push(JSON.parse(p)); } };
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" }, now, webpush });
  const uid = ctx.ownerId;
  await ctx.push.subscribe(uid, null, { endpoint: "https://push.invalid/x", keys: { p256dh: "a", auth: "b" } });
  ctx.agent.sweep = () => {};
  ctx.agent.view = () => ({ online: true });
  ctx.agent.accionesPc = () => ["volumen", "estado_sistema", "bloquear", "apagar"];
  const decir = (text, extra = {}) => ctx.chat.handle({ userId: uid, text, ...extra });
  const acciones = async () => (await all(db, "SELECT action FROM pc_actions ORDER BY id")).map((r) => r.action);
  return { ctx, db, now, uid, avisos, decir, acciones };
}

test("parseCrear: horario, frase y pasos", () => {
  const a = parseCrear("cada viernes a las 18:00 revisa mis tareas y avísame");
  assert.deepEqual(a.horario, { dias: [5], hora: "18:00" });
  assert.deepEqual(a.pasos, ["revisa mis tareas"]);
  const b = parseCrear('Crea una rutina llamada Cierre cuando diga "hora de cerrar": volumen al 10 en el pc; luego bloquea la pantalla');
  assert.equal(b.nombre, "Cierre");
  assert.equal(b.frase, "hora de cerrar");
  assert.deepEqual(b.pasos, ["volumen al 10 en el pc", "bloquea la pantalla"]);
  assert.deepEqual(parseCrear("crea una rutina: todos los días a las 8 de la noche estado del pc").horario, { dias: [0, 1, 2, 3, 4, 5, 6], hora: "20:00" });
  assert.equal(parseCrear("cada viernes a las 18 juego fútbol"), null);
});

test("toca: zona, una vez por ocasión y sin horas ya pasadas", () => {
  const h = { dias: [5], hora: "18:00", zona: "America/Santiago" };
  assert.equal(toca(h, VIERNES), true);
  assert.equal(toca(h, VIERNES - 60_000), false);
  assert.equal(toca(h, VIERNES + 11 * 60_000), false);
  assert.equal(toca(h, VIERNES + 60_000, { ultima: VIERNES }), false);
  assert.equal(toca(h, VIERNES + 7 * 86_400_000, { ultima: VIERNES }), true);
  assert.equal(toca(h, VIERNES + 5 * 60_000, { desde: VIERNES + 3 * 60_000 }), false);
  assert.equal(toca({ ...h, zona: "UTC" }, VIERNES), false);
});

test("chat: crear, listar, pausar, borrar; sin recursión, sin privado y con tope", async () => {
  const { ctx, uid, decir } = await levantar();
  assert.match((await decir("crea una rutina llamada Uno: cada viernes a las 18 estado del pc")).reply, /creada/);
  assert.match((await decir("mis rutinas")).reply, /Uno \(viernes a las 18:00\)/);
  assert.match((await decir("pausa la rutina Uno")).reply, /pausa/);
  assert.match((await decir("lanza la rutina Uno")).reply, /en pausa/);
  assert.match((await decir("borra la rutina Uno")).reply, /Borré/);
  assert.equal((await ctx.rutinas.lista(uid)).length, 0);
  await assert.rejects(ctx.rutinas.crear(uid, { pasos: ["lanza la rutina Uno"] }), (e) => e.error === "recursion");
  await ctx.rutinas.crear(uid, { frase: "hora de cerrar", pasos: ["volumen al 10 en el pc"] });
  await assert.rejects(ctx.rutinas.crear(uid, { pasos: ["hora de cerrar"] }), (e) => e.error === "recursion");
  await assert.rejects(ctx.rutinas.crear(uid, { pasos: ["mi contraseña es x"] }), (e) => e.error === "privado");
  await assert.rejects(ctx.rutinas.crear(uid, { pasos: Array(MAX_PASOS + 1).fill("hola") }), (e) => e.error === "demasiados_pasos");
  const dentro = await ctx.rutinas.intent({ userId: uid, text: "hora de cerrar", source: "rutina" });
  assert.match(dentro.reply, /no puede/);
});

test("la frase ejecuta los pasos por el chat y respeta la aprobación del PC", async () => {
  const { ctx, uid, decir, acciones } = await levantar();
  await ctx.rutinas.crear(uid, { frase: "hora de cerrar", pasos: ["volumen al 10 en el pc", "apaga el pc"] });
  const r = await decir("hora de cerrar");
  assert.equal(r.status, "rutina");
  assert.deepEqual(await acciones(), ["volumen", "apagar"]);
  const pend = await ctx.approvals.pending(uid);
  assert.deepEqual(pend.map((a) => a.kind), ["pc:apagar"]);
  assert.match(r.reply, /espera su visto bueno/);
});

test("por horario: lee solo, pide permiso para cambiar, no repite y el aviso no lleva contenido", async () => {
  const { ctx, now, uid, avisos, acciones } = await levantar();
  await ctx.rutinas.crear(uid, { nombre: "Colegio privilegiado", horario: { dias: [5], hora: "18:00" }, pasos: ["estado del pc", "volumen al 10 en el pc"] });
  await ctx.rutinas.tick(uid);
  assert.deepEqual(await acciones(), []);
  now.advance(3_600_000);
  await Promise.all([ctx.rutinas.tick(uid), ctx.rutinas.tick(uid)]);
  now.advance(60_000);
  await ctx.rutinas.tick(uid);
  assert.deepEqual(await acciones(), ["estado_sistema"]);
  const [a, ...resto] = (await ctx.approvals.pending(uid)).filter((x) => x.kind.startsWith("rutina:"));
  assert.equal(resto.length, 0);
  assert.equal(a.detail, "volumen al 10 en el pc");
  const aviso = avisos.find((x) => /rutina/.test(x.body));
  assert.ok(aviso && !/Colegio|volumen/.test(aviso.body));
  await ctx.approvals.decide(uid, a.id, true);
  await ctx.rutinas.esperar();
  assert.deepEqual(await acciones(), ["estado_sistema", "volumen"]);
});

test("rechazar el permiso o dejarlo vencer no ejecuta nada", async () => {
  const { ctx, now, uid, acciones } = await levantar();
  await ctx.rutinas.crear(uid, { horario: { dias: [5], hora: "18:00" }, pasos: ["volumen al 10 en el pc", "bloquea la pantalla"] });
  now.advance(3_600_000);
  await ctx.rutinas.tick(uid);
  const [a, b] = await ctx.approvals.pending(uid);
  await ctx.approvals.decide(uid, a.id, false);
  now.advance(13 * 3_600_000);
  await ctx.approvals.decide(uid, b.id, true);
  await ctx.rutinas.esperar();
  assert.deepEqual(await acciones(), []);
});

test("con el freno o en modo Chat no corre nada", async () => {
  const { ctx, db, now, uid, decir, acciones } = await levantar();
  const r = await ctx.rutinas.crear(uid, { frase: "hora de cerrar", horario: { dias: [5], hora: "18:00" }, pasos: ["volumen al 10 en el pc"] });
  await ctx.control.freno(uid);
  assert.equal((await ctx.rutinas.ejecutar(uid, r, { origen: "probar" })).ok, false);
  now.advance(3_600_000);
  await ctx.rutinas.tick(uid);
  await ctx.control.reanudar(uid);
  await ctx.rutinas.tick(uid); // la ocasión frenada no se recupera
  assert.deepEqual(await acciones(), []);
  assert.equal((await ctx.approvals.pending(uid)).length, 0);
  await setModo(db, uid, "chat");
  assert.match((await decir("hora de cerrar")).reply, /modo Chat/);
  now.advance(7 * 86_400_000);
  await ctx.rutinas.tick(uid);
  assert.deepEqual(await acciones(), []);
  assert.equal((await ctx.approvals.pending(uid)).length, 0);
});

test("'revisa mis tareas' va por lo escolar sin pedir permiso", async () => {
  const { ctx, now, uid, decir } = await levantar();
  assert.match((await decir("cada viernes a las 18:00 revisa mis tareas y avísame")).reply, /creada/);
  now.advance(3_600_000);
  await ctx.rutinas.tick(uid);
  assert.equal((await ctx.approvals.pending(uid)).length, 0);
});

test("los pasos conservan el «qué» inicial", async () => {
  const { parseCrear } = await import("../server/rutinas.js");
  assert.deepEqual(parseCrear("crea una rutina cuando diga hola: qué tengo en classroom; sube el volumen").pasos, ["qué tengo en classroom", "sube el volumen"]);
});
