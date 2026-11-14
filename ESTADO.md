<!-- estado-proyecto -->
# Estado de Jarvis (14-nov-2026) - rama youtube-musica
**Pedido:** música desde el iPhone con sus playlists de YouTube Music, costo cero, solo lectura.
**Hecho (servidor):** scope `youtube.readonly`, `server/connectors/youtube.js` (playlists, pistas, búsqueda, cuota 'youtube' en hora del Pacífico, caché cifrada `yt:*`), `server/music/*` (órdenes sin modelo), paso de música en `chat-service` (`status:"musica"`, private=1), herramientas `youtube.*`, `/api/connect` con `youtube`, CSP para el reproductor, docs.
**Contrato web:** `reproductor:{activo}` en `/api/chat`; respuesta `musica:{op,items,index,titulo,fuente,abrir}`; herramientas devuelven `items`.
**Queda:** la web (reproductor IFrame, en otra rama), activar YouTube Data API v3 y reconectar Google, probar con cuenta real. Sin push ni merge.
**Otras ramas:** control del PC (Ola 0+1), Pro web, GitHub lectura, Groq primero: ver docs/PLAN.md.
**Verificar:** `npm test` (299 pruebas); `node --test test/youtube.test.js test/musica-chat.test.js test/musica-intents.test.js`.
