import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { memDb, clock } from "./helpers.js";
import { createTasks } from "../server/queue/tasks.js";
import { createDirect, detectDirect } from "../server/queue/direct.js";
import { get } from "../server/db/client.js";

const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

const CASOS = {
  emojis: "Arregla el login 🚀🔥 y avísame 👨‍👩‍👧‍👦",
  crlf: "linea uno\r\nlinea dos\r\n\r\nlinea tres\r\n",
  espaciosFinales: "  empieza con espacios y termina con espacios   \n\t ",
  comillas: `Dijo "hola" y 'adiós', «latinas», “tipográficas” y \\ barra \` tick`,
  unicode: "ñandú café é (descompuesto) vs é (compuesto) ﬁ",
  largo: ("x".repeat(99) + "\n").repeat(100).slice(0, 10000),
};

async function setup() {
  const { db, userId } = await memDb();
  const now = clock();
  const tasks = createTasks({ db, now });
  return { db, userId, now, tasks, direct: createDirect({ tasks }) };
}

for (const [nombre, texto] of Object.entries(CASOS)) {
  test(`texto exacto (${nombre}): mismo sha256 y mismos bytes`, async () => {
    const { db, userId, direct } = await setup();
    const t = await direct.enqueue({ userId, text: texto });
    assert.equal(t.sha256, sha(texto));
    assert.equal(t.text, texto);
    const row = await get(db, "SELECT raw_text, raw_sha256 FROM tasks WHERE id=?", [t.id]);
    assert.equal(createHash("sha256").update(Buffer.from(row.raw_text)).digest("hex"), sha(texto));
    assert.equal(row.raw_sha256, sha(texto));
  });
}

test("el de 10 000 caracteres mide exactamente 10 000", () => assert.equal(CASOS.largo.length, 10000));

test("la hora va solo en header_json, nunca en el texto", async () => {
  const { db, userId, direct, now } = await setup();
  const t = await direct.enqueue({ userId, text: "hola" });
  const row = await get(db, "SELECT header_json, raw_text FROM tasks WHERE id=?", [t.id]);
  assert.equal(JSON.parse(row.header_json).dictated_at, new Date(now()).toISOString());
  assert.equal(Buffer.from(row.raw_text).toString("utf8"), "hola");
});

test("detectDirect conserva el texto tras el disparador sin trim", () => {
  const cuerpo = "  revisa el login 🚀\r\n  ";
  for (const pre of ["/claude ", "Díselo a Claude: ", "díselo a claude, ", "Jarvis, tal cual ", "/claude\n"]) {
    const d = detectDirect(pre + cuerpo);
    assert.equal(d.direct, true, pre);
    assert.equal(d.text, pre.endsWith("\n") ? cuerpo : cuerpo, pre);
  }
  assert.equal(detectDirect("hola, qué tal").direct, false);
});

test("entrega en orden de seq", async () => {
  const { userId, tasks, direct } = await setup();
  for (const n of ["uno", "dos", "tres"]) await direct.enqueue({ userId, text: n });
  const a = await tasks.claim(userId), b = await tasks.claim(userId), c = await tasks.claim(userId);
  assert.deepEqual([a.text, b.text, c.text], ["uno", "dos", "tres"]);
  assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3]);
  assert.equal(await tasks.claim(userId), null);
});

test("editar y borrar solo pendientes", async () => {
  const { userId, tasks, direct } = await setup();
  const t1 = await direct.enqueue({ userId, text: "original" });
  const ed = await tasks.update(userId, t1.id, { rawText: "cambiado \n" });
  assert.equal(ed.ok, true);
  assert.equal(ed.task.text, "cambiado \n");
  assert.equal(ed.task.sha256, sha("cambiado \n"));
  await tasks.claim(userId); // t1 pasa a "reclamada"
  assert.equal((await tasks.update(userId, t1.id, { rawText: "x" })).ok, false);
  assert.equal((await tasks.remove(userId, t1.id)).ok, false);
  const t2 = await direct.enqueue({ userId, text: "borrar" });
  assert.equal((await tasks.remove(userId, t2.id)).ok, true);
  assert.equal(await tasks.get(userId, t2.id), null);
});

test("adjuntos: tope de 4 MB y 3 por tarea", async () => {
  const { userId, tasks, direct } = await setup();
  const t = await direct.enqueue({ userId, text: "foto" });
  const mk = (n) => ({ userId, taskId: t.id, mime: "image/jpeg", data: Buffer.alloc(n, 1) });
  assert.equal((await tasks.addAttachment(mk(4 * 1024 * 1024 + 1))).reason, "foto_grande");
  for (let i = 0; i < 3; i++) assert.equal((await tasks.addAttachment(mk(100))).ok, true);
  assert.equal((await tasks.addAttachment(mk(100))).reason, "demasiadas_fotos");
});
