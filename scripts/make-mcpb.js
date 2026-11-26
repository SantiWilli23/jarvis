// Arma dist/jarvis-memoria.mcpb (un zip) con desktop/mcpb/. Sin dependencias ni descargas: node scripts/make-mcpb.js
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

// Lista cerrada: nada que no esté aquí puede colarse en el paquete.
export const ARCHIVOS = ["manifest.json", "package.json", "server/index.js"];
const SRC = new URL("../desktop/mcpb/", import.meta.url);

export function zip(entradas) {
  const locales = [], centrales = [];
  let pos = 0;
  for (const { name, data } of entradas) {
    const n = Buffer.from(name), comp = deflateRawSync(data), crc = crc32(data);
    const comun = Buffer.alloc(26);
    comun.writeUInt16LE(20, 0); comun.writeUInt16LE(0x0800, 2); comun.writeUInt16LE(8, 4);
    comun.writeUInt32LE(0x00210000, 6); // 1980-01-01
    comun.writeUInt32LE(crc, 10); comun.writeUInt32LE(comp.length, 14); comun.writeUInt32LE(data.length, 18); comun.writeUInt16LE(n.length, 22);
    locales.push(Buffer.from("PK\x03\x04", "binary"), comun, n, comp);
    const c = Buffer.alloc(46);
    c.write("PK\x01\x02", 0, "binary"); c.writeUInt16LE(20, 4); comun.copy(c, 6, 0, 26); c.writeUInt32LE(pos, 42);
    centrales.push(c, n);
    pos += 30 + n.length + comp.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.write("PK\x05\x06", 0, "binary"); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...locales, dir, fin]);
}

export function armar(destino = fileURLToPath(new URL("../dist/jarvis-memoria.mcpb", import.meta.url))) {
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, zip(ARCHIVOS.map((name) => ({ name, data: readFileSync(new URL(name, SRC)) }))));
  return destino;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(armar());
