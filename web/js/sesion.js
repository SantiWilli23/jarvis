// Lógica pura de "¿se cayó de verdad la sesión?". Un 401 suelto (o un error de red/5xx/Render dormido) NO cierra la sesión.
// check(): promesa con el código HTTP de GET /auth/me (lanza si no hay red). Devuelve:
//   "valida"  -> /auth/me respondió 2xx
//   "caida"   -> /auth/me dio 401 las dos veces seguidas (con una espera entre medias)
//   "incierta" -> cualquier otra cosa (red, 5xx, 401 + éxito...): no borrar el token, reintentar luego
export async function confirmarSesion(check, esperar = (ms) => new Promise((r) => setTimeout(r, ms)), reintentoMs = 1500) {
  let seguidos401 = 0;
  for (let i = 0; i < 2; i++) {
    let st = 0;
    try { st = await check(); } catch { st = 0; }
    if (st >= 200 && st < 300) return "valida";
    seguidos401 = st === 401 ? seguidos401 + 1 : 0;
    if (i === 0) await esperar(reintentoMs);
  }
  return seguidos401 === 2 ? "caida" : "incierta";
}
