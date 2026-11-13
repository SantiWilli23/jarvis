import { test } from "node:test";
import assert from "node:assert/strict";
import { memDb } from "./helpers.js";
import { createNotes, estimateTokens } from "../server/memory/notes.js";
import { createSearch } from "../server/memory/search.js";
import { createInbox } from "../server/memory/inbox.js";

async function setup(forceLike = false) {
  const { db, fts, userId } = await memDb();
  const useFts = forceLike ? false : fts;
  const notes = createNotes({ db, fts: useFts });
  const search = createSearch({ db, fts: useFts });
  return { db, userId, notes, search, fts: useFts };
}

for (const forceLike of [false, true]) {
  const modo = forceLike ? "LIKE" : "FTS5";
  test(`búsqueda (${modo}): como máximo k notas`, async () => {
    const { userId, notes, search } = await setup(forceLike);
    for (let i = 0; i < 10; i++) await notes.add({ userId, title: `Futbol ${i}`, body: `El equipo de fútbol número ${i} juega el sábado` });
    const r = await search.search({ userId, query: "fútbol sábado", k: 3, tokenBudget: 10_000 });
    assert.equal(r.notes.length, 3);
  });

  test(`búsqueda (${modo}): respeta el presupuesto de tokens`, async () => {
    const { userId, notes, search } = await setup(forceLike);
    const largo = "palabra ".repeat(100); // ~200 tokens
    for (let i = 0; i < 6; i++) await notes.add({ userId, title: "t", body: largo + "alquimia" });
    const r = await search.search({ userId, query: "alquimia", k: 6, tokenBudget: 450 });
    assert.ok(r.notes.length >= 1 && r.notes.length <= 2, `devolvió ${r.notes.length}`);
    assert.ok(r.tokens <= 450);
    assert.equal(r.tokens, r.notes.reduce((a, n) => a + n.tokens, 0));
    assert.equal(estimateTokens("t " + largo + "alquimia"), r.notes[0].tokens);
  });
}

test("las notas de otro usuario o en revisión no aparecen", async () => {
  const { db, userId, notes, search } = await setup();
  await db.execute({ sql: "INSERT INTO users (name, role, created_at) VALUES ('invitado','invitado',?)", args: [Date.now()] });
  await notes.add({ userId: 2, body: "dato del invitado zanahoria" });
  await notes.add({ userId, body: "propuesta del modelo zanahoria", source: "modelo" });
  assert.equal((await search.search({ userId, query: "zanahoria" })).notes.length, 0);
});

test("la nota secreta no escribe nada en la BD", async () => {
  const { db, userId, notes } = await setup();
  const antes = [];
  for (const t of ["notes", "notes_fts", "audit_log", "messages"]) antes.push((await db.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n);
  const r = await notes.add({ userId, body: "mi clave del banco", level: "secreta" });
  assert.deepEqual({ saved: r.saved, reason: r.reason }, { saved: false, reason: "secreta" });
  const despues = [];
  for (const t of ["notes", "notes_fts", "audit_log", "messages"]) despues.push((await db.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n);
  assert.deepEqual(despues, antes);
});

test("zona de revisión: lo del modelo no se busca hasta aprobarlo", async () => {
  const { userId, notes, search } = await setup();
  const inbox = createInbox({ notes });
  const p = await inbox.propose({ userId, body: "al señor le gusta el café" });
  assert.equal(p.status, "revision");
  assert.equal((await search.search({ userId, query: "café" })).notes.length, 0);
  assert.equal((await inbox.list(userId)).length, 1);
  await inbox.approve(userId, p.id);
  assert.equal((await search.search({ userId, query: "café" })).notes.length, 1);
});
