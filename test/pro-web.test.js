import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, renderMensaje, renderInforme, renderVerificacion, renderDiff, renderRonda, renderBloqueo, renderHilos, trabajador, motivosTexto, rondaViva } from "../web/js/pro.js";

test("esc neutraliza HTML", () => assert.equal(esc("<b a=\"1\">&'</b>"), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;"));

test("burbujas distintas por autor y texto escapado", () => {
  const u = renderMensaje({ id: 1, author: "usuario", kind: "texto", text: "<img onerror=x>" });
  assert.match(u, /a-usuario/); assert.ok(!u.includes("<img"));
  assert.match(renderMensaje({ author: "claude", kind: "texto", text: "hola" }), /a-claude/);
  assert.match(renderMensaje({ author: "gemini", kind: "texto", text: "hola" }), /a-gemini/);
});

test("verificación resalta los tres tipos de discrepancia", () => {
  const h = renderVerificacion({ dijo_no_hizo: ["a"], hizo_no_dijo: ["b"], cambios_ajenos: ["c"], veredicto: "corregir" });
  for (const c of ["h-nohizo", "h-nodijo", "h-ajeno", "v-corregir"]) assert.ok(h.includes(c), c);
  assert.match(renderVerificacion({ veredicto: "aprobado" }), /coincide/);
});

test("informe, diff y botón de diff", () => {
  assert.match(renderInforme({ dijo_hizo: ["x"], archivos_tocados: ["a.js"], comandos: ["npm test"], resultado: "ok" }), /npm test/);
  const d = renderDiff("M\ta.js\nA\tb.js\nD\tc.js\n a.js | 3 ++-\n 3 files changed, 2 insertions(+)");
  assert.ok(d.includes("df-M") && d.includes("df-A") && d.includes("df-D") && d.includes("st"));
  assert.match(renderDiff(""), /Sin diff/);
  const h = renderMensaje({ author: "claude", kind: "informe", text: "", meta: { job_id: 7, body: { dijo_hizo: ["hecho"] } } });
  assert.ok(h.includes("hecho") && h.includes('data-job="7"'));
});

test("ronda: plan editable, contador de correcciones y decisiones", () => {
  const p = renderRonda({ id: 3, status: "esperando_aprobacion", corrections: 0 }, [{ kind: "plan", text: "Plan <x>" }]);
  assert.ok(p.includes('id="plan-edit"') && p.includes("Plan &lt;x&gt;") && p.includes('data-accion="aprobar"') && p.includes("0/2"));
  const n = renderRonda({ id: 3, status: "necesita_usuario", corrections: 2 }, []);
  assert.ok(n.includes("2/2") && n.includes("Aceptar ronda (commit local)") && n.includes('data-accion="corregir"'));
  assert.ok(!renderRonda({ id: 3, status: "hecha", corrections: 1 }, [], []).includes("cancelar"));
  assert.ok(renderRonda({ id: 3, status: "programando", corrections: 0 }, []).includes('data-act="cancelar"'));
  assert.ok(renderRonda({ id: 3, status: "programando", corrections: 0 }, [], [{ id: 9, detail: "npm test", summary: "cmd" }]).includes('data-act="aprobacion"'));
});

test("trabajador: motor y modelo según estado", () => {
  assert.equal(trabajador({ status: "hecha" }), null);
  assert.deepEqual(trabajador({ status: "programando", programmer: "claude", verifier: "gemini" }), { engine: "claude", modelo: "sonnet", rol: "programa" });
  assert.equal(trabajador({ status: "verificando", programmer: "claude", verifier: "gemini" }).modelo, "gemini-3.8-flash-high");
  assert.equal(trabajador({ status: "programando", programmer: "gemini" }).modelo, "gemini-3.8-flash-high");
  assert.equal(trabajador({ status: "planeando", programmer: "claude" }).modelo, "opus");
  assert.ok(rondaViva({ status: "corrigiendo" }));
});

test("motivos de bloqueo y lista de hilos", () => {
  const pro = { habilitado: false, motivos: ["pc_apagado", "gemini_sin_login", "otro"] };
  assert.equal(motivosTexto(pro).length, 3);
  assert.match(renderBloqueo(pro), /PC está apagado/);
  assert.ok(!renderBloqueo(pro).includes("CLI"));
  assert.match(renderBloqueo(null), /Sin conexión/);
  assert.match(renderHilos([], null), /Aún no hay hilos/);
  assert.match(renderHilos([{ id: 1, title: "t", repo: "C:\\a\\b" }], 1), /aria-current="true"/);
});
