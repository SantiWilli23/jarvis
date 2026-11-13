// Hash de contraseñas con scrypt (node:crypto). Formato: scrypt$N$salt$hash (base64).
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

const N = 16384, KEYLEN = 64;

function scryptAsync(password, salt, n) {
  return new Promise((res, rej) => scrypt(password, salt, KEYLEN, { N: n }, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt, N);
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [alg, n, salt, hash] = String(stored).split("$");
    if (alg !== "scrypt") return false;
    const expected = Buffer.from(hash, "base64");
    const key = await scryptAsync(String(password), Buffer.from(salt, "base64"), Number(n));
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch { return false; }
}
