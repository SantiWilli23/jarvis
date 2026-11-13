import test from "node:test";
import assert from "node:assert/strict";
import { runDoctor, resolveAgy, parseAgyModels } from "../desktop/runner/doctor.js";

const MODELS = "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n";
test("parseAgyModels y resolveAgy en LOCALAPPDATA", () => {
  assert.deepEqual(parseAgyModels(MODELS), ["gemini-3.8-flash-high", "gemini-3.8-flash-low"]);
  const b = resolveAgy({ env: { LOCALAPPDATA: "C:\\L", PATH: "" }, platform: "win32", exists: (p) => /agy[\\/]bin[\\/]agy\.exe$/.test(p) });
  assert.match(b.command, /agy\.exe$/);
});
test("doctor: login por `agy models` y modelos que faltan", async () => {
  const ex = async (b, a) => (a[0] === "models" ? MODELS : a[0] === "--help" ? "--print --output-format --model --mode --effort" : "1.5.8");
  const c = await runDoctor({ agyPath: "agy", claudePath: "claude", exec: ex });
  assert.equal(c.agy.login, "google"); assert.deepEqual(c.agy.faltan, ["gemini-3.8-flash-medium"]); assert.equal(c.agy.flags.ok, true);
  const sin = await runDoctor({ agyPath: "agy", claudePath: "claude", exec: async (b, a) => { if (a[0] === "models") throw new Error("no login"); return "x"; } });
  assert.equal(sin.agy.login, null);
});
