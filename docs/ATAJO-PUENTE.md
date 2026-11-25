# Atajo "Jarvis Puente" (iPhone): guía paso a paso

El iPhone no deja que una web controle la linterna, el brillo, etc. El Atajo hace de puente:
pregunta a Jarvis qué hay pendiente, lo hace y le cuenta cómo fue.

> **Importante: no verificado en iPhone.** Esta guía no se ha probado en un teléfono. Los nombres de los bloques
> son los de la app Atajos en español según la mejor información disponible y cambian entre versiones de iOS.
> Si un bloque no aparece con ese nombre, escriba una palabra clave en el buscador de acciones (p. ej. "brillo",
> "concentración", "temporizador"). Si no existe en su iPhone, omita esa parte: Jarvis la marcará como fallida.

Palabras que se usan aquí:
- **Bloque** (o acción): cada pieza que se añade al Atajo desde "Buscar acciones".
- **Variable**: una cajita con nombre donde se guarda un dato para usarlo después.
- `TU-SERVIDOR` es la dirección de su Jarvis; `TU_TOKEN` es la clave del paso 1.

## 1. Crear la clave (token)
En Jarvis en el teléfono (`/m`): **Más**, **Dispositivos**, **Crear token para el Atajo del iPhone**.
Cópielo ya: solo se muestra una vez. No lo comparta ni haga capturas del Atajo donde se vea.
Solo sirve para recoger acciones y devolver resultados.

Si ya tiene el Atajo armado, no hace falta crear otro: vaya al apartado 2 y cambie lo que le falte.

## 2. La estructura del Atajo
Abra **Atajos**, pulse **+**, y póngale de nombre exactamente **Jarvis Puente**.
Añada estos bloques en orden.

### 2.1 Pedir las acciones pendientes
1. **URL**: `https://TU-SERVIDOR/api/phone/next`
2. **Obtener contenido de URL**. Despliegue sus opciones (flecha):
   - Método: **POST**
   - Cabeceras, añadir una: clave `Authorization`, valor `Bearer TU_TOKEN` (con un espacio entre ambas).
3. **Obtener valor del diccionario**: obtener **Valor** para la clave `acciones` en "Contenido de URL".
4. **Repetir con cada elemento** de ese valor. **Todo lo que sigue va dentro de este Repetir.**

Si Jarvis estaba dormido puede tardar cerca de 1 minuto; si da error, ejecute el Atajo otra vez.

### 2.2 Preparar cada acción (dentro de Repetir)
1. **Obtener valor del diccionario** clave `accion` en "Elemento de repetición". Debajo, **Definir variable** `accion`.
2. Igual con la clave `valor` (variable `valor`) y con la clave `id` (variable `id`).
3. **Texto** con `false`, y **Definir variable** `ok`.
4. **Texto** con `Esta acción aún no está en el Atajo`, y **Definir variable** `resultado`.
5. **Diccionario** vacío, y **Definir variable** `datos`.

Algunas acciones traen campos extra (`minutos`, `etiqueta`, `activar`, `para`): sáquelos con
**Obtener valor del diccionario** desde "Elemento de repetición", dentro del bloque Si que los use.

### 2.3 Un bloque "Si" por acción
Para cada acción de la tabla del apartado 3:
1. Añada **Si**. Entrada: variable `accion`. Condición: **es**. Texto: el nombre exacto (p. ej. `linterna`).
2. Dentro del Si (antes de "Si no"), ponga los bloques que indica la tabla.
3. Al final, dentro del mismo Si: **Texto** `true` y **Definir variable** `ok`;
   **Texto** `Hecho` (o lo que devolvió el bloque) y **Definir variable** `resultado`.
4. Puede borrar la parte **Si no**. Deje **Finalizar si**.

Cuando una acción tiene varias opciones (on/off, nombre de app...), meta otro **Si** dentro, mirando la variable
`valor`. En ese caso ponga las líneas de `ok` y `resultado` dentro de cada opción, para que una opción que
falte no figure como hecha.

### 2.4 Avisar el resultado (al final, todavía dentro de Repetir, después del último "Finalizar si")
1. **Texto**: `https://TU-SERVIDOR/api/phone/actions/[id]/done` (inserte la variable `id` donde dice `[id]`).
2. **Obtener contenido de URL** sobre ese texto:
   - Método: **POST**
   - Cabecera `Authorization` = `Bearer TU_TOKEN`
   - Cuerpo de la solicitud: **JSON**, con tres campos:
     - `ok` (tipo Texto): variable `ok`
     - `result` (tipo Texto): variable `resultado`
     - `datos` (tipo Diccionario): variable `datos`

Debajo queda **Finalizar repetición**.

Si un bloque de iOS da error, el Atajo se detiene: esa acción queda como "enviada" hasta caducar.

## 3. Qué bloque usar en cada acción
Ningún bloque de esta tabla está verificado en iPhone.

### Acciones nuevas

| `accion` | Qué llega | Bloques dentro del Si |
|---|---|---|
| `temporizador` | `valor` = minutos; `etiqueta` opcional | **Iniciar temporizador** con duración = variable `valor`, unidad minutos. El temporizador de Atajos no admite nombre: si quiere la etiqueta, añada **Mostrar notificación** con ella. |
| `enfoque` | `valor` = nombre; `activar` = `on`/`off` | Un Si por nombre (`valor` es `Trabajo`, `Personal`, `Descanso`, `Conducción`) y dentro otro Si por `activar`. Bloque **Definir modo de concentración**: elija ese modo y "Activar" (hasta desactivarlo) o "Desactivar". |
| `notificacion` | `valor` = texto | **Mostrar notificación** con la variable `valor`. Es una notificación del propio iPhone; permita las notificaciones de Atajos. |
| `estado` | nada | Ver el apartado 3.1. |
| `buscar_iphone` | nada | **Definir volumen** al 100 %, luego **Repetir** 5 veces con **Reproducir sonido** y **Vibrar dispositivo**. |
| `atajo` | `valor` = nombre del atajo | Un Si por cada atajo permitido (`valor` es `Nombre`) con **Ejecutar atajo** y ese atajo elegido. Ver el apartado 3.2. |

Sobre `buscar_iphone`: **no es "Buscar mi iPhone" de Apple**. Atajos no tiene ninguna función para activarlo.
Solo hace ruido y vibra, y únicamente si el Atajo llega a ejecutarse (teléfono encendido, con internet y con la
automatización de correo del apartado 5, o a mano). No localiza el teléfono. Que suene con el interruptor en
silencio no está verificado. Para un teléfono perdido use la app Buscar de Apple o icloud.com/find.

`enfoque` no incluye "No molestar": ese sigue siendo la acción `no_molestar`. Los nombres de los modos se
cambian en `enfoques_permitidos` (archivo `config/phone-actions.json`) y deben coincidir con los de su iPhone
(Ajustes, Modos de concentración).

### 3.1 La acción `estado`
Dentro de `Si accion es estado`:
1. **Obtener nivel de batería**.
2. **Obtener detalles del dispositivo**: "Brillo actual".
3. **Obtener detalles del dispositivo**: "Volumen actual".
4. **Obtener detalles de la red**: Wi-Fi, "Nombre de la red".
5. **Diccionario** con estas claves exactas, y **Definir variable** `datos`:
   - `bateria` (número): nivel de batería
   - `brillo` (número): brillo actual
   - `volumen` (número): volumen actual
   - `wifi` (texto): nombre de la red (vacío si no hay)
   - `cargando` (texto `true`/`false`): **solo si su iOS tiene un bloque que lo diga**. No está confirmado que
     exista; si no lo encuentra, no ponga esta clave.
6. `ok` = `true`.

Jarvis arma la frase ("iPhone: batería 80%, ...") con esos datos. Del Wi-Fi solo guarda si hay conexión, no el
nombre de la red. Cualquier otra clave se descarta.

### 3.2 Permitir atajos suyos (`atajo`)
La lista `atajos_permitidos` en `config/phone-actions.json` viene **vacía**: Jarvis no puede ejecutar ninguno.
Para permitir uno, escriba su nombre exacto, por ejemplo `"atajos_permitidos": ["Regar plantas"]`, y publique o
reinicie Jarvis. Cada vez que lo pida, tendrá que aprobarlo en el teléfono. "Jarvis Puente" no se puede añadir.

### Acciones que ya existían

| `accion` | Bloques dentro del Si |
|---|---|
| `linterna` | Si `valor` es `on` / `off`: **Definir linterna** activada / desactivada |
| `brillo` | **Definir brillo** con `valor` (porcentaje) |
| `volumen` | **Definir volumen** con `valor` |
| `no_molestar` | **Definir modo de concentración** "No molestar" activar/desactivar según `valor`. Si llega `minutos`: **Ajustar fecha** (fecha actual + `minutos`) y active "hasta" esa hora |
| `bajo_consumo` | **Definir modo de bajo consumo** |
| `modo_oscuro` | **Definir apariencia** (Oscura / Clara) |
| `salida_audio` | **Definir destino de reproducción**; un Si por opción (`iphone`, `altavoz`, `bluetooth`) |
| `multimedia` | `play`/`pausa`: **Reproducir/Pausar**; `siguiente`: **Saltar adelante**; `anterior`: **Saltar atrás** |
| `decir` | **Hablar texto** con `valor` |
| `vibrar` | **Vibrar dispositivo** (si `valor` trae un número, dentro de **Repetir** ese número de veces) |
| `bateria` | **Obtener nivel de batería**; póngalo en `resultado` |
| `abrir_app` | Un Si por app con **Abrir app** y la app elegida |
| `alarma` | **Crear alarma** a la hora `valor`, nombre `etiqueta` |
| `recordatorio` | **Añadir nuevo recordatorio** con `valor`; si llega `minutos`, alerta a la fecha actual + `minutos` |
| `bluetooth` | **Definir Bluetooth** |
| `wifi` | **Definir Wi-Fi** |
| `datos_moviles` | **Definir datos móviles** |
| `modo_avion` | **Definir modo avión** |
| `ubicacion` | **No es posible**: Atajos no tiene un bloque para encender o apagar la ubicación. No añada nada; quedará como fallida |
| `leer_portapapeles` | **Obtener portapapeles**; póngalo en `resultado` |
| `enviar_mensaje` | **Enviar mensaje** con `valor` a `para` (iOS puede pedir confirmación) |
| `llamar` | **Llamar** a `valor` |
| `abrir_url` | **Abrir URL** con `valor` |
| `escena_homekit` | Un Si por escena con **Controlar casa** y esa escena elegida |

## 4. Probar
1. En `/m`, abra la hoja **Control**, pestaña **iPhone**, y toque "Estado" o "Notificación".
2. Pulse **Ejecutar en el iPhone**. La primera vez iOS pedirá permisos: acéptelos.
3. En el historial la acción debe pasar a "hecha". Si sale "falló", revise el nombre dentro de ese Si.

También puede decir "temporizador de 10 minutos", "activa el modo trabajo",
"manda una notificación que diga sacar la basura", "estado de mi iPhone", "busca mi iPhone" o
"ejecuta el atajo regar plantas".

## 5. Lanzarlo
- Botón "Ejecutar en el iPhone" (abre `shortcuts://run-shortcut?name=Jarvis%20Puente`).
- Decir "Oye Siri, Jarvis Puente", **Toque posterior** (Ajustes, Accesibilidad, Tocar) o **Botón de acción**.

Las acciones sensibles (Wi-Fi off, modo avión, portapapeles, mensajes, llamadas, atajos suyos) esperan su
aprobación antes de entregarse. Una acción no recogida caduca a los 10 minutos.

## 6. Correo despertador (para que Jarvis dispare el Atajo solo)
iOS no deja que un servidor ejecute un Atajo; la única vía gratis es que el iPhone reaccione a un correo.
Cuando una acción queda "lista" (automática o ya aprobada), Jarvis envía por su Gmail conectado un correo
a `PHONE_NUDGE_EMAIL` (su dirección de iCloud) con asunto `JARVIS·<código aleatorio>` y cuerpo mínimo:
**sin el comando ni datos**. Es una excepción acotada: solo a esa dirección y solo con ese asunto;
cualquier otro correo sigue pidiendo su aprobación. Sin `PHONE_NUDGE_EMAIL` o sin Gmail conectado no hace nada
(queda en la auditoría como `phone.despertador_omitido`). Máximo 20 por hora, y si ya se mandó uno en los últimos 60 s no se manda otro.

En el iPhone (app Atajos, pestaña Automatización, "+", **Correo**):
- Remitente: su Gmail (el que conectó a Jarvis). Asunto contiene: `JARVIS·`.
- Acción: **Ejecutar atajo** "Jarvis Puente". Elija **Ejecutar inmediatamente** y desactive "Notificar al ejecutar".
- Si iOS ofrece "Permitir ejecución bloqueado", actívelo para que corra con el teléfono bloqueado.
- Apague las notificaciones de ese correo para que no suene cada vez.

Automatizaciones de apoyo (recogen lo pendiente aunque falle el correo): al conectar el **Cargador**,
al llegar al **Wi-Fi de casa**, y a **horas fijas** (p. ej. 8:00, 14:00, 21:00).

Los correos despertador se acumulan en Enviados de Gmail. Borrarlos solos exigiría el permiso `gmail.modify`,
que NO se añade; bórrelos a mano o con un filtro. En Más (vista `/m`) se ve si el despertador está configurado.

## 7. Notificaciones push (aprobaciones)
Instale Jarvis en la pantalla de inicio (Safari, Compartir, Añadir a pantalla de inicio; iOS 16.4 o superior),
ábralo desde el icono, y en Más pulse "Activar notificaciones". Recibirá "Aprobación pendiente" (sin contenido privado)
y al tocarla se abre la tarjeta. Las claves VAPID se generan solas la primera vez y se guardan en la base
(o use `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`; `VAPID_SUBJECT` por defecto `mailto:jarvis@localhost`).
