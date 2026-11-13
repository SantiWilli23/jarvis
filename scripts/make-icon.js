// Genera web/apple-touch-icon.png (180x180) con zlib, sin dependencias: mismo dibujo que icon.svg.
// Uso: node scripts/make-icon.js
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const N = 180, SS = 4; // tamaño y supermuestreo
const BG = [8, 11, 16], CY = [63, 216, 255];
const k = N / 512;
const rings = [{ r: 150 * k, w: 8 * k, a: 0.6 }, { r: 100 * k, w: 4 * k, a: 0.8 }];
const dotR = 44 * k, c = N / 2;

function pixel(x, y) {
  const d = Math.hypot(x - c, y - c);
  let col = BG.slice();
  const mix = (a) => { col = col.map((v, i) => v + (CY[i] - v) * a); };
  for (const g of rings) if (Math.abs(d - g.r) <= g.w / 2) mix(g.a);
  if (d <= dotR) mix(1);
  return col;
}
const raw = Buffer.alloc((N * 3 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 3 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const p = pixel(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS); acc = acc.map((v, i) => v + p[i]); }
    for (let i = 0; i < 3; i++) raw[y * (N * 3 + 1) + 1 + x * 3 + i] = Math.round(acc[i] / (SS * SS));
  }
}
const crcT = Array.from({ length: 256 }, (_, n) => { let v = n; for (let i = 0; i < 8; i++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; return v >>> 0; });
const crc = (b) => { let v = 0xffffffff; for (const x of b) v = crcT[(v ^ x) & 255] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
const out = fileURLToPath(new URL("../web/apple-touch-icon.png", import.meta.url));
writeFileSync(out, png);
console.log("escrito", out, png.length, "bytes");
