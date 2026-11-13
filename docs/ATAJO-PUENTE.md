# Atajo "Jarvis Puente" (iPhone)

El iPhone no deja que una web controle la linterna, el brillo, etc. El Atajo hace de puente:
pregunta a Jarvis qué hay pendiente y lo ejecuta.

## 1. Crear el token
En la vista móvil (`/m`): Más, Dispositivos, "Crear token para el Atajo del iPhone".
(O `POST /api/devices` con `{"kind":"phone"}` desde una sesión web.) Cópielo: solo se muestra una vez.
Ese token solo sirve para `/api/phone/next` y `/api/phone/actions/:id/done`; para todo lo demás da 403.

## 2. Crear el Atajo (nombre exacto: Jarvis Puente)
1. **Obtener contenido de URL**
   - URL: `https://TU-SERVIDOR/api/phone/next`
   - Método: POST. Cabecera `Authorization` = `Bearer TU_TOKEN`.
   - Si Render estaba dormido tarda ~50 s: ponga el bloque dentro de "Repetir" 3 veces
     o añada "Esperar 20 s" y reintente si no hay respuesta.
2. **Obtener valor del diccionario** `acciones` y **Repetir con cada elemento**.
3. Dentro, **Obtener valor** `accion` y un bloque **Si** por cada acción de `config/phone-actions.json`
   (linterna, brillo, volumen, no_molestar, bajo_consumo, modo_oscuro, multimedia, decir, vibrar,
   bateria, abrir_app, alarma, recordatorio, bluetooth, wifi, datos_moviles, modo_avion, ubicacion,
   leer_portapapeles, enviar_mensaje, llamar, abrir_url, escena_homekit). Use `valor` y los extras
   (`minutos`, `para`, `etiqueta`) del elemento.
4. Al terminar cada una: **Obtener contenido de URL** POST a
   `https://TU-SERVIDOR/api/phone/actions/ID/done` (ID = `id` del elemento), mismo Bearer,
   cuerpo JSON `{"ok": true, "result": "lo que devolvió"}` (`"ok": false` si falló).

## 3. Lanzarlo
- Botón "Ejecutar en el iPhone" de la hoja Teléfono (abre `shortcuts://run-shortcut?name=Jarvis%20Puente`).
- O automatización de iOS (hora, llegar a un sitio, abrir una app) que ejecute el Atajo.

Las acciones sensibles (Wi-Fi off, modo avión, portapapeles, mensajes, llamadas) esperan su aprobación
en Jarvis antes de aparecer en `/next`. Una acción no recogida caduca a los 10 min.

## 4. Correo despertador (para que Jarvis dispare el Atajo solo)
iOS no deja que un servidor ejecute un Atajo; la única vía gratis es que el iPhone reaccione a un correo.
Cuando una acción queda "lista" (automática o ya aprobada), Jarvis envía por su Gmail conectado un correo
a `PHONE_NUDGE_EMAIL` (su dirección de iCloud) con asunto `JARVIS·<código aleatorio>` y cuerpo mínimo:
**sin el comando ni datos**. Es una excepción acotada: solo a esa dirección y solo con ese asunto;
cualquier otro correo sigue pidiendo su aprobación. Sin `PHONE_NUDGE_EMAIL` o sin Gmail conectado no hace nada
(queda en la auditoría como `phone.despertador_omitido`). Máximo 20 por hora, y si ya se mandó uno en los últimos 60 s no se manda otro.

En el iPhone (app Atajos, pestaña Automatización, "+", **Correo**):
- Remitente: su Gmail (el que conectó a Jarvis). Asunto contiene: `JARVIS·`.
- Acción: **Ejecutar atajo** "Jarvis Puente". Elija **Ejecutar inmediatamente** (sin preguntar) y desactive "Notificar al ejecutar".
- Si iOS ofrece "Permitir ejecución bloqueado", actívelo para que corra con el teléfono bloqueado.
- Reintento: si Render estaba dormido tarda ~50 s; en el atajo repita la petición 3 veces con "Esperar 20 s".
- Apague las notificaciones de ese correo (Ajustes, Notificaciones, Mail, o un filtro) para que no suene cada vez.

Automatizaciones de apoyo (recogen lo pendiente aunque falle el correo): al conectar el **Cargador**,
al llegar al **Wi-Fi de casa**, y a **horas fijas** (p. ej. 8:00, 14:00, 21:00).

Disparo manual: decir "Oye Siri, Jarvis Puente", **Toque posterior** (Ajustes, Accesibilidad, Tocar),
**Botón de acción** (iPhone 15 Pro o posterior) o el botón "Ejecutar en el iPhone" de la PWA.

Aviso: los correos despertador se acumulan en la carpeta Enviados de Gmail. Borrarlos automáticamente exigiría
el permiso `gmail.modify`, que NO se añade; bórrelos a mano o con un filtro de Gmail.
En Más (vista /m) se ve si el despertador está configurado.

## 5. Notificaciones push (aprobaciones)
Instale Jarvis en la pantalla de inicio (Safari, Compartir, Añadir a pantalla de inicio; iOS 16.4 o superior),
ábralo desde el icono, y en Más pulse "Activar notificaciones". Recibirá "Aprobación pendiente" (sin contenido privado)
y al tocarla se abre la tarjeta. Las claves VAPID se generan solas la primera vez y se guardan en la base
(o use `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`; `VAPID_SUBJECT` por defecto `mailto:jarvis@localhost`).
