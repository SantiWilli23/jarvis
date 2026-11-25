<!-- estado-proyecto -->
# Estado de Jarvis (25-nov-2026) - rama ola-e (desde integracion)
**Pedido:** Ola E - escenas y disparadores de iOS.
**Hecho:** `config/escenas.json` + `server/escenas.js` (solo pasos automáticos; sin capturas), intents de chat, botones en la hoja Control de `/m`.
**iOS:** `POST /api/phone/disparador` con token phone, solo `{escena}`, 10/hora, auditado; guía en `docs/ATAJO-PUENTE.md` apartado 8.
**Antes:** Ola D2 (tope de capturas, pc_acciones), Ola C (iPhone), Ola A (resultados al chat).
**Queda:** probar en navegador, iPhone y Windows/Electron reales; sin push, merge ni despliegue.
**Verificar:** `npm test` (incluye `test/escenas.test.js`).
