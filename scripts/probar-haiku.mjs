// Prueba real de Haiku en el navegador: GASTA uso de Claude (4 tareas). Base en memoria, sin tocar el servidor publicado.
// Uso: node scripts/probar-haiku.mjs   (Chrome abierto con la extensión Claude y sesión iniciada; app de Jarvis cerrada)
// Ensayo sin modelos: node scripts/probar-haiku.mjs --falso
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { parseNavIntent } from "../server/nav-intents.js";
import { createNavWorker } from "../desktop/runner/nav-worker.js";

const falso = process.argv.includes("--falso");
if (falso) process.env.FAKE_RESULT = '```json\n{"estado":"ok","respuesta":"ensayo","fuentes":[]}\n```';
const claude = falso ? { command: process.execPath, prefix: [fileURLToPath(new URL("../test/fixtures/fake-claude.mjs", import.meta.url))] } : undefined;

const ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: randomUUID() } });
const uid = ctx.ownerId;
const hub = {
  navClaim: () => ctx.nav.claim(uid, 1),
  navEvents: (id, b) => ctx.nav.events(uid, 1, id, b),
  navResult: async (id, b) => {
    await ctx.nav.result(uid, 1, id, b);
    const t = (await ctx.nav.ver(uid, id)).task;
    console.log(JSON.stringify({ estado: b.estado, modelo: t.modelo, motivo: t.modelo_motivo, costo_usd: b.uso?.costo_usd, error: b.error, respuesta: String(b.respuesta || "").slice(0, 200) }));
  },
};
const worker = createNavWorker({ hub, log: console.log, ...(claude ? { claude } : {}) });

for (const frase of [
  "con haiku, pregúntale a ChatGPT qué es un púlsar en dos frases",
  "chat nuevo con Claude con haiku: dime un número del 1 al 10",
  "dile a Claude con haiku que le sume 5",
  "busca en google con haiku la altura del monte Everest",
]) {
  console.log("\n>>> " + frase);
  const intent = parseNavIntent(frase);
  if (!intent?.modelo) throw new Error("la frase no fuerza modelo");
  await ctx.agent.hello(uid, { capabilities: { chrome: { ok: true }, claude: { ok: true, modelos: [] }, repos: [] } });
  const r = await ctx.nav.enqueue({ userId: uid, ...intent, text: frase });
  if (!r.id) { console.log(JSON.stringify(r)); continue; }
  await worker.tick();
}
process.exit(0);
