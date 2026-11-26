# Memoria central: contrato

REPO PÚBLICO: nada de correos, nombres de colegio ni claves (usar ejemplo@example.com).
Estado: MCP (apagado), recolectar, repartir y vista web hechos (sin probar con las IA reales).

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

## Servidor MCP (hecho: server/mcp/)
- `/mcp`: Streamable HTTP sin estado, solo POST (`initialize`, `ping`, `tools/list`, `tools/call`). Apagado por defecto: `config/mcp.json` con `activo:false` hace que `/mcp`, `/oauth/*` y `/.well-known/*` den 404.
- OAuth 2.1: PKCE S256 obligatorio, metadatos RFC 9728 y RFC 8414, registro dinámico RFC 7591. Redirecciones: solo las de claude.ai y claude.com (`/api/mcp/auth_callback`) y `http://localhost|127.0.0.1:<puerto>/callback`. Máximo 20 clientes (los de más de un día sin autorizar se liberan) y 5 registros por IP cada 15 minutos.
- Códigos de un solo uso, 10 minutos, ligados a cliente, redirección y reto. En la base solo queda el hash.
- El token es un dispositivo `mcp`: no caduca, solo sirve en `/mcp` y se revoca en Dispositivos (vista móvil `/m`). No hay refresh token.
- `memoria_buscar` (máximo 8 notas, ~1500 tokens): solo lo que puede salir; además se descarta lo que mencione escolar, Classroom o Lirmi.
- `memoria_proponer`: a la zona de revisión con origen `mcp:<cliente>`, máximo 30 al día.
- Auditoría sin contenido (cliente y cantidad).
- El consentimiento aprueba con fetch del mismo origen y redirige con JavaScript, así que el CSP global (`form-action 'self'`) no se cambió.

## Cómo conectarlo
1. Poner `"activo": true` en `config/mcp.json` y publicar (https). Si hay proxy, fijar `PUBLIC_URL` con la dirección pública.
2. claude.ai (recomendado; también aparece en la app de escritorio y el móvil): Ajustes > Conectores > Añadir conector personalizado > URL `https://<su-jarvis>/mcp`. Se abre la pantalla de Jarvis: iniciar sesión y Aprobar.
3. Claude Code: `claude mcp add --transport http jarvis https://<su-jarvis>/mcp` y luego `/mcp` para autorizar.
4. Alternativa para la app de escritorio: `node scripts/make-mcpb.js` crea `dist/jarvis-memoria.mcpb`; abrirlo con Claude Desktop e indicar la dirección de Jarvis. No lleva claves: la primera vez abre el navegador para autorizar y guarda el token en texto plano en `~/.jarvis-mcp/` (carpeta del usuario). Se anula revocando el dispositivo "MCP: Claude Desktop".

Usar 2 **o** 4, no ambos (saldrían las herramientas duplicadas).
