<!-- estado-proyecto -->
# Estado de Jarvis (14-nov-2026) - rama juegos-atajos (desde main 9c9d6a4)
**Pedido:** "abre <juego>" abre el juego sin gastar IA + botones de acceso rápido.
**Hecho:** `server/games.js` (lista Futotal y Ski Beta, `parseJuegoIntent`, `respuestaJuego`); paso 1-bis en `chat-service` antes de música/PC/IA, igual en modo Chat e IA: `status:"juego"`, `juegos:[{id,nombre,url}]`, `acciones:[{tipo:"abrir_url",url,nuevaPestana}]`.
**Web:** `web/js/juegos.js` (botones discretos `#juegos` en index.html y m.html + `window.open` noopener al llegar `jarvis:juego`; los botones sirven de respaldo si el navegador bloquea la pestaña); `sw.js` v13.
**Pruebas:** `test/juegos.test.js`. Alquimia y Draft Europeo no están en la lista a propósito.
**Queda:** probar en navegador real/iPhone (bloqueo de pestañas, estilo de botones). Sin push ni deploy.
**Verificar:** `npm test`.
