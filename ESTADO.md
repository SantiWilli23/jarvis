<!-- estado-proyecto -->
# Estado de Jarvis (25-nov-2026) - rama ola-c (desde integracion)
**Pedido:** Ola C - más control del iPhone vía el Atajo "Jarvis Puente".
**Hecho:** acciones temporizador, enfoque, notificacion, estado, buscar_iphone (automáticas) y atajo (con aprobación; `atajos_permitidos` vacía) en `config/phone-actions.json`.
**Código:** validación y resumen de estado en `server/phone/queue.js`; reglas en `intents.js`; botones en `web/js/movil.js`; `sw.js` v16.
**Docs:** `docs/ATAJO-PUENTE.md` reescrito paso a paso.
**Cambio de conducta:** "temporizador de N minutos" desde el teléfono o sin origen va al iPhone (desde el PC sigue en el PC).
**Queda:** nada probado en iPhone ni en navegador; armar los bloques del Atajo; sin push/merge/deploy.
**Verificar:** `npm test` (342; incluye `test/phone-c.test.js`).
