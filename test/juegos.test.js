import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";
import { JUEGOS, parseJuegoIntent, respuestaJuego } from "../server/games.js";
import { JUEGOS as JUEGOS_WEB } from "../web/js/juegos.js";

const id = (t) => parseJuegoIntent(t)?.juego?.id ?? null;

test("detecta cada juego, con y sin tildes y en mayúsculas", () => {
  for (const t of ["abre Futotal", "ABRE FUTOTAL", "Abrir futotal", "lanza el futotal", "juega a Futotal", "abre football quiz", "Jarvis, abre el quiz de fútbol", "abre futbol quiz", "abre el juego de futotal por favor"]) assert.equal(id(t), "futotal", t);
  for (const t of ["abre ski", "abre Ski Beta", "abre esquí", "abre esqui", "inicia el ski", "jugar al esquí", "Abre el juego de ski beta"]) assert.equal(id(t), "ski", t);
});

test("'abre el juego' / 'juegos' sin alias devuelve la lista", () => {
  for (const t of ["abre el juego", "abre los juegos", "abre juegos", "Abre mis juegos", "juegos", "quiero jugar a un juego"]) assert.deepEqual(parseJuegoIntent(t), { lista: true }, t);
  assert.equal(respuestaJuego({ lista: true }).juegos.length, 2);
});

test("no confunde apps del PC, música ni charla", () => {
  for (const t of ["abre spotify", "abre chrome", "abre el bloc de notas", "pon música", "reproduce ski", "abre el correo", "qué es el esquí", "cuéntame del futotal", "abre alquimia", "abre draft europeo", "", null]) assert.equal(parseJuegoIntent(t), null, String(t));
});

test("URLs correctas y misma lista en la web", () => {
  assert.equal(JUEGOS.find((j) => j.id === "futotal").url, "https://football-quiz-nod2.onrender.com");
  assert.equal(JUEGOS.find((j) => j.id === "ski").url, "https://santiwilli23.github.io/ski-beta/");
  assert.deepEqual(JUEGOS_WEB, JUEGOS.map(({ id, nombre, url }) => ({ id, nombre, url })));
  const r = respuestaJuego(parseJuegoIntent("abre futotal"));
  assert.equal(r.reply, "Abriendo Futotal, señor.");
  assert.deepEqual(r.acciones, [{ tipo: "abrir_url", url: "https://football-quiz-nod2.onrender.com", nuevaPestana: true }]);
});

let server, base, ctx, token;
const call = (path, { method = "GET", body, tk = token } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
before(async () => {
  const db = createDb({ url: ":memory:" });
  ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" } });
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await call("/api/auth/login", { method: "POST", body: { password: "prueba-123" }, tk: null })).json()).token;
});
after(() => { ctx.hub.close(); server.close(); });

test("/api/chat resuelve 'abre Futotal' sin IA en modo ia y en modo chat", async () => {
  ctx.router.route = async () => { throw new Error("no debe llamar a la IA"); };
  for (const modo of ["ia", "chat"]) {
    await call("/api/settings", { method: "PUT", body: { modo } });
    const j = await (await call("/api/chat", { method: "POST", body: { text: "abre Futotal" } })).json();
    assert.equal(j.status, "juego", modo);
    assert.equal(j.reply, "Abriendo Futotal, señor.");
    assert.equal(j.acciones[0].url, "https://football-quiz-nod2.onrender.com");
    const l = await (await call("/api/chat", { method: "POST", body: { text: "abre el juego" } })).json();
    assert.equal(l.status, "juego"); assert.equal(l.juegos.length, 2); assert.deepEqual(l.acciones, []);
  }
});

test("web: contenedor, módulo en el shell y caché v13", () => {
  const w = (f) => readFileSync(new URL("../web/" + f, import.meta.url), "utf8");
  assert.match(w("index.html"), /id="juegos"/); assert.match(w("m.html"), /id="juegos"/);
  assert.match(w("sw.js"), /jarvis-shell-v13/); assert.match(w("sw.js"), /"\/js\/juegos\.js"/);
  assert.match(w("js/juegos.js"), /noopener/);
});
