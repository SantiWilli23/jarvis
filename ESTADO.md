<!-- estado-proyecto -->
# Estado de Jarvis (14-nov-2026) - rama control-ui-pc (desde main c669f63)
**Pedido:** Ola B: pantalla del PC (acciones, aprobaciones, historial) en la web y en /m.
**Hecho:** `web/js/acciones-pc.js` (catálogo -> botones/formulario, pendientes + historial, aprobar/rechazar, estado del PC; GET /api/pc/actions cada 15 s y al llegar WS `pc.actions`/`accion.resultado`).
**UI:** /m: hoja "Teléfono" pasa a "Control" con pestañas iPhone/PC (ids sh-tel, ctab-ios, ctab-pc, #pcacc); index.html: panel `panel-pc` en la columna derecha; CSS `.pc*` en hud.css.
**Aprobación:** `panels.showApproval` muestra "El PC pide permiso" si `kind` empieza por `pc:` y params como "clave: valor".
**SW:** v14 con acciones-pc.js (v13 ya estaba en main, por eso se sube a v14; se ajustaron movil.test y juegos.test).
**Pruebas:** `test/ui-pc.test.js`; npm test 316 verde.
**Queda:** probar en navegador real/iPhone (maquetación, formulario de parámetros). Sin push ni deploy.
**Verificar:** `npm test`.
