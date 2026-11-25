<!-- estado-proyecto -->
# Estado de Jarvis (25-nov-2026) - rama ola-f3 (desde integracion)
**Pedido:** Ola F3 - quitar del todo `agy` (Gemini CLI) del lado PC.
**Hecho:** borrados `desktop/runner/agy-{args,policy,runner}.js` y `fake-agy.mjs`; limpiados pro-worker (solo `engine: claude`), worker, doctor (`{claude, repos}`), danger, main.js, config, `cleanCaps`, pruebas y docs.
**Dejado:** entradas `agy-*` en GUARDIANES (`secret-paths.js`); chat/Estudio/voz/búsqueda con Gemini intactos.
**Queda:** probar la app de escritorio en Windows real; sin push ni merge.
**Antes (control-ola2):** resultados de acciones PC/iPhone vuelven al chat/HUD/voz; falta probar en navegador, iPhone y Windows reales; el Atajo debe enviar `datos`.
**Verificar:** `npm test`.
