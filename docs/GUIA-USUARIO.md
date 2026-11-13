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
- **Directo a Claude:** si dice o escribe "díselo a Claude: ...", "tal cual: ..." o "/claude ...", el texto se guarda palabra por palabra, sin que ningún modelo lo toque, y espera en la cola del panel derecho. La hora se guarda aparte.
- **Preparar:** si pide algo para el PC sin esas palabras, un modelo gratis lo ordena en pasos y preguntas; usted lo revisa en la cola y pulsa "Enviar al PC".
- **Privado:** marque la casilla "privado" o use una nota privada; ese mensaje solo va a Groq (o a Claude). Si Groq no puede, Jarvis dice que no hay cuota en vez de mandarlo a otro lado.
- **Notas "secretas"** nunca se guardan.
- **Sin claves:** Jarvis usa un proveedor de pruebas que repite lo que le dice. Sirve para ver que todo funciona.
- **Probar el sistema:** `npm test` corre las pruebas (no necesita red ni claves).
- El PC (Claude Code), Telegram y el widget de Atajos llegan en las fases 2, 3 y 4. Los botones de esas conexiones se ven apagados hasta entonces.
