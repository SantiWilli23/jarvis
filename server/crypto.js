// Cifrado de tokens de conectores: AES-256-GCM. La clave sale de CONNECTIONS_KEY (.env).
// Sin clave (o muy corta) no se guarda ningún token: los conectores con OAuth quedan apagados.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function createCrypto(secret) {
  const ok = typeof secret === "string" && secret.length >= 16;
  const key = ok ? createHash("sha256").update(secret).digest() : null;
  return {
    enabled: ok,
    encrypt(obj) {
      if (!ok) throw new Error("CONNECTIONS_KEY falta o es muy corta (mínimo 16 caracteres)");
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
      return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    },
    decrypt(blob) {
      if (!ok) throw new Error("CONNECTIONS_KEY falta");
      const [v, iv, tag, ct] = String(blob).split(".");
      if (v !== "v1") throw new Error("formato de token desconocido");
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8"));
    },
  };
}
