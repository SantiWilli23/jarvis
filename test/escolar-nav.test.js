// Escolar y navegador reales juntos: encolar, reclamar, entregar resultado. Sin red ni PC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { clock } from "./helpers.js";

test("estudio de punta a punta: guarda cifrado y descarta la cuenta equivocada", async () => {
  const now = clock();
  const ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123", CONNECTIONS_KEY: "clave-de-prueba-larga-123" }, now });
  const userId = ctx.ownerId, correo = "ejemplo@example.com";
  ctx.agent.view = () => ({ online: true });
  ctx.agent.sweep = () => {};
  ctx.agent.capabilities = () => ({ chrome: { ok: true } });
  await ctx.escolar.setCorreo(userId, correo);
  const correr = async (cuenta_visible) => {
    await ctx.escolar.actualizar({ userId, fuente: "classroom" });
    const { task } = await ctx.nav.claim(userId, 1);
    assert.deepEqual([task.perfil, task.cuenta], ["escolar", { correo }]);
    await ctx.nav.result(userId, 1, task.id, { estado: "ok", cuenta_visible, items: [{ curso: "Inventado", titulo: "Maqueta secreta" }] });
    return (await ctx.db.execute("SELECT * FROM nav_tasks ORDER BY id DESC LIMIT 1")).rows[0];
  };
  const mala = await correr("otra@example.com");
  assert.equal(mala.estado, "cuenta_incorrecta");
  assert.equal((await ctx.db.execute("SELECT * FROM estudio_items")).rows.length, 0);
  const buena = await correr(correo);
  assert.equal(buena.estado, "ok");
  assert.match(buena.respuesta, /1 elementos/);
  const guardado = JSON.stringify((await ctx.db.execute("SELECT * FROM estudio_items")).rows);
  assert.ok((await ctx.db.execute("SELECT * FROM estudio_items")).rows.length === 1 && !guardado.includes("Maqueta"));
});
