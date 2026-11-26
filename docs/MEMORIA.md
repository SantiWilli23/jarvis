# Memoria central: contrato

REPO PÚBLICO: nada de correos, nombres de colegio ni claves (usar ejemplo@example.com).
Estado: recolectar, repartir y la vista web están hechos (sin probar con las IA reales). Lo marcado como pendiente lo programan otros paquetes.

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

## Recolectar y repartir (server/memoria-reparto.js)
Destinos: claude, chatgpt y gemini. Una consulta en un chat nuevo por IA, de una en una, con el navegador del PC
(tipos `memoria_recoger` y `memoria_repartir`, perfil ia, docs/NAV.md). No se tocan páginas de ajustes.
- Recoger: texto fijo. La respuesta es DATO: se parte en líneas (máx. 80, 500 caracteres), se descartan secretos
  (claves, contraseñas, documentos, tarjetas, números largos) y lo escolar (palabras clave), se deduplica y entra a la
  zona de revisión con origen `ia:<nombre>`; nivel según classify (con correo: privada). Se aprueba en la web.
- Repartir: una sola línea con las notas que pueden salir (`puedeSalir()`), máx. 3800 caracteres, las más nuevas primero.
  El guardia del PC solo deja teclear exactamente ese texto (`texto_exacto`): ni pegar ni otras teclas. No puede
  verificar en qué botón se hace clic.
- Autorización: el primer reparto se ve y se aprueba (o se pide con "reparte mi memoria"; "recoge mi memoria" recoge).
  Después, cada 30 días el tick recoge y reparte si el PC está conectado. Lo recién recogido no sale hasta aprobarlo.
- Un fallo queda en `memoria_repartos` (sin contenido) y se avisa; no se reintenta. "enviado" no garantiza que la IA lo guardara.
- nav no guarda la respuesta; el texto enviado se reemplaza por una etiqueta al cerrar la tarea.
- Nunca claves, contraseñas ni códigos; no se resuelven CAPTCHAs. Respeta el freno si server/control.js expone
  `frenado(userId)` (docs/CONTROL.md).
- La app de escritorio debe estar actualizada (guardia y worker nuevos) antes de repartir.

## Web y API (sesión web)
Panel en "Más" (web/js/memoria.js). `/api/memoria-reparto`: `GET /` (notas, repartos, automatico), `GET /vista`
({texto,cantidad,fuera,hash}), `POST /recoger`, `POST /repartir {hash}`, `POST /notas/:id/aprobar`,
`DELETE /notas/:id`, `DELETE /datos` (borra toda la memoria de Jarvis y apaga el reparto; no borra nada en las IA).

## Servidor MCP (pendiente: server/mcp/index.js)
- `/mcp`, `/.well-known/*`, `/oauth/*`, montadas antes del estático. Hoy responden 501.
- OAuth con tablas `oauth_clients` y `oauth_codes` (de códigos y secretos solo se guarda el hash).
- Solo lectura de lo que puede salir. Cada consulta se registra en audit_log sin contenido.
- Ojo: el CSP global tiene `form-action 'self'`; la pantalla de consentimiento que redirige fuera necesita su propio CSP.
