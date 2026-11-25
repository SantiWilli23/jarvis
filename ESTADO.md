<!-- estado-proyecto -->
# Estado de Jarvis (14-nov-2026) - rama control-ola2 (desde main c669f63)
**Pedido:** Ola A - los resultados de las acciones del PC y del iPhone vuelven al chat, HUD y voz.
**Hecho:** `server/acciones/resultados.js` (evento `accion.resultado` {origen,id,accion,ok,texto,privado,conversationId,deviceId,hablar,at}); columnas `conversation_id/device_id/source` en `pc_actions` y `phone_actions`; `phone.done` acepta `datos` (lista blanca) y emite `phone.action.result`; la cola del PC emite `pc.action.result`.
**Hub:** `EVENTOS` suma `accion.resultado` y `pc.actions`; `hasDevice/hasUser`; el resultado va al dispositivo origen, o a todos los del dueño si no está conectado.
**Web:** `web/js/main.js` muestra (textContent) y dice el resultado sin repetir `origen:id`; `sw.js` v14.
**Privacidad:** privados solo en vivo + búfer en memoria de 15 min (se reenvía al reconectar, sin voz); BD guarda "[privado]"; push/Telegram "Resultado listo"; sin dispositivo conectado hay push/Telegram de respaldo.
**Queda:** probar en navegador, iPhone y Windows reales; no se guarda el resultado como mensaje en el historial del chat; el Atajo debe enviar `datos`.
**Verificar:** `npm test` (incluye `test/resultados.test.js`).
