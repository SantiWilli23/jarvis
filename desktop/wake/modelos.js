// Modelos de openWakeWord (licencia CC BY-NC-SA, no comercial): NUNCA van al repo.
// Los baja scripts/get-wake-models.mjs a <datos de la app>/wake; aquí se cargan con onnxruntime (inyectado).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { modelosDe } from "./detector.js";

const BASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/";
// nombre -> sha256 (GitHub no publica digest para esta release: fijado en la primera descarga oficial).
export const MODELOS = {
  "melspectrogram.onnx": "ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f",
  "embedding_model.onnx": "70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f",
  "hey_jarvis_v0.1.onnx": "94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb",
};
export const url = (nombre) => BASE + nombre;
export const faltanModelos = (dir) => Object.keys(MODELOS).filter((n) => !existsSync(join(dir, n)));

export async function cargarModelos(ort, dir) {
  ort.env.wasm.numThreads = 1;
  return modelosDe(ort, Object.keys(MODELOS).map((n) => readFileSync(join(dir, n))));
}
