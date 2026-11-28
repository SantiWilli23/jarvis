# Conversar (voz en vivo con Gemini Live)

Botón "Conversar" de la barra de escritura (`/` y la app del PC; todavía no en `/m`).

- Servidor (`server/conversa.js`): `POST /api/conversa/token` da un token efímero de un uso; `POST /api/conversa/fin` cierra, devuelve los minutos no usados y guarda el texto en `conversations`/`messages` (`provider='conversa'`, no privado). La API key no sale del servidor.
- Ajustes: `config/providers.json` > `voz.live` (modelo, voz, `tope_minutos_dia`, `max_min_sesion`).
- Tope: al emitir el token se reservan los minutos; sin `/fin` quedan gastados. Google corta al cumplirse (`expireTime`). Los minutos usados los mide el servidor.
- El token fija modelo, voz, instrucciones, transcripciones, compresión y herramientas (ninguna). El cliente solo manda el modelo y la reanudación.
- Sin herramientas: con `googleSearch` Google cerraba la sesión por cuota (nivel gratis, 28-nov-2026).
- Privacidad: Google puede usar lo que se diga. Si la transcripción coincide con el clasificador privado se corta y no se guarda (ese audio ya salió). Sin memoria ni historial en el contexto.
- Freno: no deja abrir y corta la charla en curso.
- Límite conocido: un token ya emitido no se puede revocar; un cliente modificado podría llamar a `/fin` y seguir hasta que el token caduque.
