// Baja los modelos de openWakeWord (v0.5.1) fuera del repo y comprueba su sha256.
//   node scripts/get-wake-models.mjs [carpeta]   (por defecto %APPDATA%/jarvis-desktop/wake)
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODELOS, url } from "../desktop/wake/modelos.js";

const datos = process.env.APPDATA || (process.platform === "darwin" ? join(homedir(), "Library", "Application Support") : join(homedir(), ".config"));
const dir = process.argv[2] || join(datos, "jarvis-desktop", "wake");
const sha = (b) => createHash("sha256").update(b).digest("hex");
mkdirSync(dir, { recursive: true });

for (const [nombre, esperado] of Object.entries(MODELOS)) {
  const destino = join(dir, nombre);
  let buf = existsSync(destino) ? readFileSync(destino) : null;
  if (!buf || sha(buf) !== esperado) {
    const res = await fetch(url(nombre));
    if (!res.ok) throw new Error(`${nombre}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== esperado) throw new Error(`${nombre}: sha256 no coincide (${sha(buf)}); no se guarda`);
    writeFileSync(destino + ".tmp", buf);
    renameSync(destino + ".tmp", destino);
  }
  console.log(`${destino}  ${buf.length} bytes  sha256 ok`);
}
