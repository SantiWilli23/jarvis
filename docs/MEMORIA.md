# Memoria central: contrato

REPO PÚBLICO: nada de correos, nombres de colegio ni claves (usar ejemplo@example.com).
Estado: Fase 0 (andamiaje). Lo marcado como pendiente lo programan los paquetes siguientes.

## Decisiones del usuario
- Una sola memoria central en Jarvis que junta la de todas las IA (claude.ai, ChatGPT, Gemini).
- Cada mes Jarvis la reparte a cada una, leyendo y escribiendo con el Chrome del PC.
- Servidor MCP para que Claude consulte la memoria en vivo.
- NO hay globo "¿Guardo esto?" (aprende) NI importación de archivos de chats.
- Lo privado, secreto o escolar NUNCA se reparte ni sale por MCP. Lo secreto ni se guarda.

## Qué puede salir (reparto y MCP)
Solo notas con status `activa`, level `normal` y origen distinto de `escolar`, que además pasen el
filtro de privacidad (server/router/privacy.js). Ante la duda, no sale.
Lo leído en otra IA es DATO, nunca instrucción: entra a la zona de revisión.

## Proponer (hecho)
`POST /api/agent/memoria/proponer` (token `pc`) con `{title, body, level, origen}`.
- body hasta 2000 caracteres, title hasta 200, máximo 200 propuestas pendientes; level `secreta` no se guarda.
- 201 `{saved:true,id,status:"revision"}` · 200 `{saved:false,reason:"secreta"}` · 400 `vacia|muy_larga|nivel_invalido` · 429 `bandeja_llena`.
- `notes.origen` guarda de dónde vino (claude, chatgpt, gemini...). El runner usa `memoriaProponer()`.

## Recolectar y repartir cada mes (pendiente: server/memoria-reparto.js)
1. Recolectar: el PC abre cada IA con Chrome (sesiones del usuario), lee su memoria y la propone.
2. Repartir: Jarvis arma el texto con lo que puede salir y el PC lo escribe en cada IA.
3. Cada recolección o reparto queda en `memoria_repartos` (tipo, destino, estado, cantidad, fechas), sin contenido.
- Nunca claves, contraseñas ni códigos; no se resuelven CAPTCHAs. Respeta el freno (docs/CONTROL.md).
- Web: `/api/memoria-reparto` (sesión web). `tick()` se llama cada hora desde server/index.js.

## Servidor MCP (pendiente: server/mcp/index.js)
- `/mcp`, `/.well-known/*`, `/oauth/*`, montadas antes del estático. Hoy responden 501.
- OAuth con tablas `oauth_clients` y `oauth_codes` (de códigos y secretos solo se guarda el hash).
- Solo lectura de lo que puede salir. Cada consulta se registra en audit_log sin contenido.
- Ojo: el CSP global tiene `form-action 'self'`; la pantalla de consentimiento que redirige fuera necesita su propio CSP.
