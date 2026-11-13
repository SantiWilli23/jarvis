# Guía de usuario: poner a Jarvis a funcionar

Esta guía es para la Fase 1: Jarvis corre en su computador, en `http://localhost:3000`. No cuesta nada. Sin claves también funciona, pero con respuestas simuladas.

## 1. Lo que necesita
- Node 24 o más nuevo (`node -v` en una terminal debe decir `v24...`).
- Esta carpeta (`jarvis`) y, dentro de ella, haber corrido `npm install` una vez.

## 2. Sacar la clave gratis de Groq
Groq pone la voz a texto (Whisper) y responde rápido. Es el único que recibe lo privado, además de Claude.
1. Entre a https://console.groq.com e inicie sesión (con Google sirve).
2. En el menú, abra **API Keys** y pulse **Create API Key**.
3. Póngale un nombre (por ejemplo "jarvis") y copie la clave que empieza con `gsk_`. Solo se muestra una vez.
4. Los límites gratuitos aparecen en la sección **Limits** de la misma consola. Verifíquelos ahí: Jarvis no los inventa.

## 3. Sacar la clave gratis de Gemini
Gemini ayuda con fotos y preguntas de razonamiento.
1. Entre a https://aistudio.google.com e inicie sesión con su cuenta de Google.
2. Pulse **Get API key** y luego **Create API key**.
3. Copie la clave (empieza con `AIza`).
4. Importante: Jarvis nunca le manda a Gemini nada marcado como privado.

## 4. Crear el archivo `.env`
1. En la carpeta `jarvis`, copie `.env.example` y llame a la copia `.env` (con el punto delante, sin nada más).
2. Ábralo con el Bloc de notas y rellene, sin comillas ni espacios:
   ```
   OWNER_PASSWORD=una-contraseña-larga-que-solo-usted-sepa
   GROQ_API_KEY=gsk_...
   GEMINI_API_KEY=AIza...
   ```
3. Guarde. El archivo `.env` nunca se sube a git ni se comparte.

## 5. Elegir la contraseña
La contraseña es `OWNER_PASSWORD`. Elija una larga (una frase de cuatro o cinco palabras sirve). Jarvis guarda solo su "hash" en la base de datos, nunca la contraseña. Para cambiarla: edite `.env` y reinicie; se actualiza sola. Tras 5 intentos fallidos seguidos, Jarvis se bloquea 15 minutos.

## 6. Encenderlo
En una terminal, dentro de la carpeta `jarvis`:
```
npm run dev
```
Abra http://localhost:3000, escriba la contraseña, toque el orbe: Jarvis dice "Hola, señor." Después, un toque en el orbe para grabar y otro para enviar. También puede escribir en la casilla de abajo.

Si abre la página en el iPhone, use Safari. El micrófono pide permiso la primera vez.

## 7. Qué hace cada variable de `.env`
| Variable | Para qué sirve |
|---|---|
| `OWNER_PASSWORD` | Su contraseña. Obligatoria. |
| `OWNER_NAME` | Cómo se llama el usuario dueño en la base de datos (opcional). |
| `PORT` | Puerto local (por defecto 3000). |
| `DATABASE_URL` | Dirección de la base en la nube (Turso). Vacío = archivo local `data/jarvis.db`. |
| `DATABASE_AUTH_TOKEN` | Clave de la base en la nube. Solo si usa Turso. |
| `GROQ_API_KEY` | Groq: voz a texto, charla rápida y lo privado. |
| `GEMINI_API_KEY` | Gemini: fotos y razonamiento. |
| `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `OLLAMA_URL`, `OPENAI_API_KEY`, `XAI_API_KEY`, `PERPLEXITY_API_KEY` | Fases posteriores; por ahora están apagadas aunque las rellene. |
| `TELEGRAM_BOT_TOKEN` | Fase 4 (Telegram). |

## 8. Cosas que conviene saber
- **Directo a Claude:** si dice o escribe al INICIO "díselo a Claude: ...", "directo a Claude: ...", "tal cual: ..." (con los dos puntos) o "/claude ..." (decir "tal cual" dentro de una frase normal no activa nada), el texto se guarda palabra por palabra, sin que ningún modelo lo toque, y espera en la cola del panel derecho. La hora se guarda aparte.
- **Preparar:** si pide algo para el PC sin esas palabras, un modelo gratis lo ordena en pasos y preguntas; usted lo revisa en la cola y pulsa "Enviar al PC".
- **Privado:** marque la casilla "privado" o use una nota privada; ese mensaje solo va a Groq (o a Claude). Si Groq no puede, Jarvis dice que no hay cuota en vez de mandarlo a otro lado.
- **Notas "secretas"** nunca se guardan.
- **Sin claves:** Jarvis usa un proveedor de pruebas que repite lo que le dice. Sirve para ver que todo funciona.
- **Probar el sistema:** `npm test` corre las pruebas (no necesita red ni claves).
- El PC (Claude Code), Telegram y el widget de Atajos llegan en las fases 2, 3 y 4. Los botones de esas conexiones se ven apagados hasta entonces.

## 9. Voz de Jarvis (cadena de voz)
Cuando Jarvis habla, el servidor prueba en este orden y salta en silencio a la siguiente si falla:
1. **Frases pregrabadas** (sus propios audios).
2. **Gemini TTS** (voz grave y formal en español). Usa `GEMINI_API_KEY` y tiene un tope diario propio (`voz.gemini.tope_dia` en `config/providers.json`, 30 por defecto; ajústelo a lo que le permita su cuenta).
3. **MiniMax** (apagado por defecto: su cuenta no tiene saldo). Para activarlo ponga `MINIMAX_API_KEY` en `.env` y `"enabled": true` en `voz.minimax`. Tope de 5.000 caracteres al día; el consumo se ve en el panel "Voz".
4. **Voz del navegador** (tono bajo), si todo lo anterior falla o si el texto es privado.

Lo privado NUNCA se manda a Gemini ni a MiniMax. El saludo "Hola, señor." se guarda en `data/cache/tts/` para no gastar cuota cada vez.

### Cómo agregar sus propios audios (mp3)
1. Grabe usted la frase (no use voces de actores ni audios de películas) y guárdela como mp3.
2. Cópiela en la carpeta `web/audio/phrases/` con el nombre que dice `web/audio/phrases/manifest.json`: `hola-senor.mp3`, `a-sus-ordenes.mp3`, `sistemas-en-linea.mp3`, `entendido.mp3`, `un-momento-senor.mp3`.
3. Para frases nuevas, añada una línea a `manifest.json`: `{ "id": "mi-frase", "texto": "Lo que dice.", "archivo": "mi-frase.mp3" }`.
4. No hace falta reiniciar. La frase coincide ignorando mayúsculas, espacios y puntuación. Si el mp3 no existe, simplemente se usa la voz de la cadena.

## 10. OpenRouter (relevo gratis)
Ponga `OPENROUTER_API_KEY` (https://openrouter.ai/keys) y se activa solo, después de Gemini, Groq y Mistral. Usa solo modelos `:free` (el id está en `config/providers.json`, `proveedores.openrouter.modelo`; si no termina en `:free` queda apagado). Tope propio de 50 pedidos al día. Nunca recibe mensajes privados.

## La app de Jarvis para Windows (Fase 2)

Es una ventana con el orbe, un icono en la bandeja y un "runner" que recoge la cola y se la pasa a Claude Code en su PC.

### 1. Instalar Claude Code e iniciar sesión con su plan Pro
1. Instale Node 24 o superior y abra PowerShell.
2. Instale Claude Code con el instalador oficial de Anthropic (o `npm install -g @anthropic-ai/claude-code`).
3. Escriba `claude` una vez, elija iniciar sesión con su cuenta (plan Pro) y termine el aviso del navegador. Jarvis nunca ve su contraseña: usa la sesión que ya dejó Claude Code.
4. Compruebe con `claude --version`. Si Jarvis no lo encuentra, ponga la ruta completa en `claudePath` del archivo de configuración.

### 2. Arrancar la app
1. En la carpeta del proyecto: `npm start` (servidor) y, en otra ventana, `cd desktop`, `npm install` y `npm start`.
2. Por defecto abre `http://localhost:3055`. Para otra dirección: variable `JARVIS_HUB_URL` o `hubUrl` en el archivo de configuración (menú de la bandeja > "Abrir archivo de configuración").
3. Inicie sesión en la ventana. La app pide por sí sola un token de dispositivo "PC" (se guarda cifrado en Windows) y el panel mostrará "PC en línea".
4. Atajo global: **Ctrl+Alt+J** abre Jarvis y activa el micrófono (cámbielo con `hotkey`). Cerrar la ventana la oculta; para salir use la bandeja > Salir. "Pausar cola" detiene el runner sin apagarlo.
5. Arranque con Windows: la versión empaquetada se registra sola al abrirse; al encender el PC la cola empieza de inmediato, el hub emite `pc_online` (Telegram lo avisará en la Fase 4) y Jarvis dice "Hola, señor.".
6. Instalador: `cd desktop` y `npm run dist` (electron-builder genera un instalador en `desktop/dist`; sin probar en este equipo).

### 3. Qué puede hacer Claude solo y qué le pide permiso
- Solo: leer y escribir dentro de las carpetas de `config/permissions.json` (`carpetas_permitidas`; si está vacía solo lee).
- Siempre con su sí (tarjeta ámbar en la web): borrar, terminal libre, enviar mensajes, `git push`, desplegar. El permiso caduca a los 30 minutos.
- Topes de su plan Pro: `tope_claude` en `config/permissions.json` (`por_tarea_tokens`, `diario_tareas`, `diario_tokens`). Vacíos = sin tope hasta verificar sus límites reales.
- Modo Directo: el texto llega a Claude exactamente igual, byte a byte; la hora del dictado va aparte.
