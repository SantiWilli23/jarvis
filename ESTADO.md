<!-- estado-proyecto -->
# Estado de Jarvis (18-nov-2026) - rama limpieza-gemini-pro (desde main c669f63)
**Pedido:** Ola F2: quitar el motor Gemini del modo Pro; Pro usa solo Claude (Opus planea/verifica, Sonnet programa).
**Hecho:** servidor (classify, coordinator, orchestrator, prompts, availability, reasons, agent), config (pro.json sin modelos.gemini, providers.json sin motores_pc), web/js/pro.js, cabecera de index.html, css, docs y pruebas ajustadas.
**Se conserva:** chat normal con Gemini (/gemini, selector Auto/Nube/Gemini/Claude), Estudio, voz Algenib, búsqueda web.
**Queda (otra ola, agy):** desktop/runner/agy-*, pro-worker (rama gemini), desktop/main.js, cleanCaps agy en server/agent.js, secciones agy de docs/PRO.md, tests runner.
**Verificar:** `npm test` (311 verdes).
