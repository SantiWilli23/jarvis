<!-- estado-proyecto -->
# Estado de Jarvis (25-nov-2026) - rama ola-d2 (desde integracion)
**Pedido:** Ola D2 - tope diario de capturas en el servidor, registro de uso y `capabilities.pc_acciones`.
**Hecho:** `capturas_por_dia` (20, día UTC) en `config/pc-actions.json`, comprobado al encolar (429 `tope_capturas`) y al entregar; uso en `claude_usage` (tipo, device_id del PC, ok, action_id; sin contenido).
**Compatibilidad:** el PC manda `pc_acciones` en hello/heartbeat; sin él solo las acciones antiguas; la UI oculta las no admitidas.
**PC:** segunda barrera `capturas_por_dia` + `uso_capturas` en su config.json.
**Antes (Ola A):** resultados de PC/iPhone vuelven al chat, HUD y voz (`server/acciones/resultados.js`).
**Queda:** probar en navegador, iPhone y Windows/Electron reales; hay que actualizar la app del PC para captura, archivos y cancelar apagado; el Atajo debe enviar `datos`.
**Verificar:** `npm test` (incluye `test/pc-d2.test.js`).
