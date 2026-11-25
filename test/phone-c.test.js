import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext, loadJson } from "../server/context.js";
import { createApp } from "../server/app.js";
import { parsePhoneIntent } from "../server/phone/intents.js";
import { textoEstado } from "../server/phone/queue.js";

let server, base, ctx, web, phoneTk;
const call = (path, { method = "GET", body, tk = web } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${tk}` }, body: body ? JSON.stringify(body) : undefined });
const json = async (p, o) => (await call(p, o)).json();
const crear = (body) => call("/api/phone/actions", { method: "POST", body });

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" } });
  server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await ctx.sessions.create(ctx.ownerId, { name: "t", kind: "web" })).token;
  phoneTk = (await json("/api/devices", { method: "POST", body: { name: "iPhone", kind: "phone" } })).token;
});
after(() => server.close());

test("config: la lista de atajos viene vacía y atajo exige aprobación", () => {
  const cfg = loadJson("phone-actions.json");
  assert.deepEqual(cfg.atajos_permitidos, []);
  assert.equal(cfg.acciones.atajo.modo, "aprobacion");
  for (const a of ["temporizador", "enfoque", "notificacion", "estado", "buscar_iphone"]) assert.equal(cfg.acciones[a].modo, "auto", a);
});

test("validación estricta de parámetros", async () => {
  const malos = [
    { accion: "temporizador" }, { accion: "temporizador", valor: 0 }, { accion: "temporizador", valor: 1440 }, { accion: "temporizador", valor: 2.5 },
    { accion: "temporizador", valor: true }, { accion: "temporizador", valor: [5] }, { accion: "temporizador", valor: 5, etiqueta: "x".repeat(61) },
    { accion: "enfoque", valor: "Gaming", activar: "on" }, { accion: "enfoque", valor: "Trabajo" }, { accion: "enfoque", valor: "Trabajo", activar: "quizá" },
    { accion: "notificacion" }, { accion: "notificacion", valor: "x".repeat(201) }, { accion: "notificacion", valor: { a: 1 } },
    { accion: "atajo", valor: "Cualquiera" },
  ];
  for (const b of malos) assert.equal((await crear(b)).status, 400, JSON.stringify(b));
});

test("las acciones nuevas llegan al Atajo con sus campos", async () => {
  const nuevas = [
    { accion: "temporizador", valor: "10", etiqueta: "Pasta" }, { accion: "enfoque", valor: "trabajo", activar: "on" },
    { accion: "notificacion", valor: "Hola" }, { accion: "buscar_iphone" },
  ];
  for (const b of nuevas) assert.equal((await json("/api/phone/actions", { method: "POST", body: b })).action.status, "lista");
  const { acciones } = await json("/api/phone/next", { method: "POST", tk: phoneTk });
  assert.deepEqual(acciones.map(({ id, ...x }) => x), [
    { accion: "temporizador", valor: 10, etiqueta: "Pasta" }, { accion: "enfoque", valor: "Trabajo", activar: "on" },
    { accion: "notificacion", valor: "Hola" }, { accion: "buscar_iphone", valor: "" },
  ]);
});

test("atajo permitido: pide aprobación; el puente no se ejecuta a sí mismo", async () => {
  const cfg = ctx.phone.config;
  cfg.atajos_permitidos = ["Regar plantas", "Jarvis Puente"];
  try {
    const r = await json("/api/phone/actions", { method: "POST", body: { accion: "atajo", valor: "regar plantas" } });
    assert.equal(r.action.status, "aprobacion");
    assert.equal(r.action.args.valor, "Regar plantas");
    assert.equal((await crear({ accion: "atajo", valor: "Jarvis Puente" })).status, 400);
    assert.deepEqual((await json("/api/phone/next", { method: "POST", tk: phoneTk })).acciones, []);
    assert.deepEqual((await json("/api/phone/actions")).atajos, cfg.atajos_permitidos);
  } finally { cfg.atajos_permitidos = []; }
});

test("estado: el resultado sale solo de los datos permitidos", async () => {
  const a = await json("/api/phone/actions", { method: "POST", body: { accion: "estado" } });
  await json("/api/phone/next", { method: "POST", tk: phoneTk });
  const datos = { bateria: 80, cargando: "No", brillo: 0.5, volumen: "0,25", wifi: "MiRedSecreta", ip: "10.0.0.1" };
  await call(`/api/phone/actions/${a.action.id}/done`, { method: "POST", tk: phoneTk, body: { ok: true, result: "ignorado", datos } });
  const h = (await json("/api/phone/actions")).acciones.find((x) => x.id === a.action.id);
  assert.equal(h.result, "iPhone: batería 80%, sin cargar, brillo 50%, volumen 25%, Wi-Fi conectado.");
  assert.equal(textoEstado({ bateria: "abc", brillo: 500, wifi: "" }), "iPhone: sin Wi-Fi.");
  assert.equal(textoEstado({}), "");
});

test("intents en español", () => {
  const cfg = { ...loadJson("phone-actions.json"), atajos_permitidos: ["Regar plantas"] };
  const p = (t, o) => parsePhoneIntent(t, cfg, o);
  assert.deepEqual(p("pon un temporizador de 10 minutos"), { action: "temporizador", args: { valor: 10 } });
  assert.deepEqual(p("temporizador de media hora para el Arroz"), { action: "temporizador", args: { valor: 30, etiqueta: "el Arroz" } });
  assert.deepEqual(p("activa el modo trabajo"), { action: "enfoque", args: { valor: "Trabajo", activar: "on" } });
  assert.deepEqual(p("desactiva el enfoque conducción"), { action: "enfoque", args: { valor: "Conducción", activar: "off" } });
  assert.equal(p("activa el enfoque gaming"), null);
  assert.equal(p("activa no molestar").action, "no_molestar");
  assert.equal(p("activa el modo oscuro").action, "modo_oscuro");
  assert.deepEqual(p("mándame una notificación que diga Sacar la basura"), { action: "notificacion", args: { valor: "Sacar la basura" } });
  assert.equal(p("estado del iphone").action, "estado");
  assert.equal(p("estado"), null);
  assert.equal(p("estado", { destino: "telefono" }).action, "estado");
  assert.equal(p("haz sonar mi iPhone").action, "buscar_iphone");
  assert.equal(p("busca"), null);
  assert.deepEqual(p("ejecuta el atajo regar plantas"), { action: "atajo", args: { valor: "Regar plantas" } });
  assert.equal(p("ejecuta el atajo borrar todo"), null);
  assert.equal(p("explícame qué es un temporizador"), null);
});

test("chat: las frases que nombran el iPhone acaban en la cola del teléfono", async () => {
  for (const t of ["estado de mi iphone", "busca mi iphone", "manda una notificación al teléfono que diga hola"]) {
    assert.equal((await json("/api/chat", { method: "POST", body: { text: t } })).status, "telefono", t);
  }
});
