import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMusicIntent as p } from "../server/music/intents.js";
import { bestMatch } from "../server/music/match.js";

test("playlists, canciones y listas", () => {
  assert.deepEqual(p("ponme mi playlist gym"), { op: "playlist", nombre: "gym" });
  assert.deepEqual(p("Pon la lista de reproducción de Rock"), { op: "playlist", nombre: "rock" });
  assert.deepEqual(p("pon la canción Bohemian Rhapsody de Queen"), { op: "buscar", q: "bohemian rhapsody de queen", ambiguo: false });
  assert.deepEqual(p("reproduce Despacito"), { op: "buscar", q: "despacito", ambiguo: false });
  assert.deepEqual(p("quiero escuchar Soda Stereo"), { op: "buscar", q: "soda stereo", ambiguo: false });
  assert.deepEqual(p("ponme algo de Shakira"), { op: "buscar", q: "shakira", ambiguo: false });
  assert.deepEqual(p("¿Qué playlists tengo?"), { op: "listas" });
  assert.deepEqual(p("pon música"), { op: "musica" });
});

test("controles", () => {
  for (const [t, op] of [["pausa", "pause"], ["pausa la música", "pause"], ["sigue", "resume"], ["siguiente", "next"], ["anterior", "prev"], ["para la música", "stop"], ["aleatorio", "shuffle"], ["qué suena", "info"]]) assert.deepEqual(p(t), { op }, t);
});

test("'pon X' a secas es ambiguo", () => {
  assert.deepEqual(p("pon atención"), { op: "buscar", q: "atencion", ambiguo: true });
  assert.deepEqual(p("pon gym"), { op: "buscar", q: "gym", ambiguo: true });
});

test("no secuestra órdenes del teléfono ni del PC", () => {
  for (const t of ["pon el wifi", "enciende el wifi", "brillo al 30", "pon el brillo al 30", "pon una alarma a las 7", "pon el volumen al 50", "abre YouTube", "pon la canción en mi pc", "abre el navegador en mi ordenador", "hola qué tal", ""]) assert.equal(p(t), null, t);
  assert.equal(p("reproduce " + "a".repeat(100)), null);
});

test("coincidencia de playlists sin tildes ni palabras vacías", () => {
  const l = [{ id: "1", titulo: "Música para el Gym" }, { id: "2", titulo: "Rock clásico" }, { id: "3", titulo: "Gimnasio" }];
  assert.equal(bestMatch(l, "mi playlist de gym").mejor.id, "1");
  assert.equal(bestMatch(l, "clasico").mejor.id, "2");
  assert.equal(bestMatch(l, "clasicoo").mejor.id, "2"); // distancia de edición
  const r = bestMatch(l, "jazz");
  assert.equal(r.mejor, null);
});
