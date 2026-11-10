# SyncLife OS

## Desarrollo local

Instala las dependencias de cada paquete una vez:

```powershell
npm ci
npm ci --prefix backend
npm ci --prefix frontend
```

Inicia frontend y backend con `npm run dev`. En desarrollo, el backend usa el puerto `3002` para evitar conflictos con servicios que ya ocupen los puertos `3000` o `3001`; el frontend de Vite envía `/api` al backend en `127.0.0.1:3002`. En producción, el backend respeta el puerto asignado por la plataforma mediante `PORT`.

## Inicio de sesión con Google

La autenticación usa Firebase Authentication. La configuración web del proyecto está incluida como valor predeterminado en el frontend; opcionalmente puede sobrescribirse con las variables de `frontend/.env.example` en `frontend/.env.local` o en Vercel. En Firebase Console, habilita **Authentication → Sign-in method → Google** y agrega `localhost` y el dominio de producción (por ejemplo, `synclifeos.vercel.app`) en **Authentication → Settings → Authorized domains**. El primer inicio con Google crea automáticamente la cuenta si aún no existe. La clave API web es pública para clientes y debe restringirse en Google Cloud a los dominios y APIs necesarios; no la uses como secreto de servidor.

Firebase Authentication sigue siendo responsable del inicio de sesión, registro y contraseñas. Al iniciar sesión, el backend verifica el token y sincroniza en PostgreSQL el UID de Firebase, correo, nombre visible y rol (`user` o `admin`). No se guardan contraseñas en PostgreSQL. Los datos de hábitos, comidas, rutinas y finanzas siguen guardándose en el navegador y no se sincronizan entre dispositivos.

### Base de datos PostgreSQL en Render

En Render, crea o selecciona una base PostgreSQL y copia su **Internal Database URL** en la variable `DATABASE_URL` del servicio backend. No la pongas en Vercel ni en una variable `VITE_*`, y no la subas a Git. El backend crea automáticamente la tabla `synclife_accounts`; el registro se sincroniza al iniciar sesión y los roles se derivan de la custom claim verificada de Firebase. El endpoint `/api/health` muestra `database.configured: true` cuando `DATABASE_URL` está definida. Las cuentas existentes se incorporan al iniciar sesión después del despliegue. El panel sigue usando Firebase Authentication como fuente para listar, bloquear y eliminar las cuentas.

## Panel administrativo

El panel aparece en la navegación solo cuando el usuario tiene la custom claim `admin: true`. Las rutas de administración vuelven a validar en el backend la sesión revocada/no revocada y el claim; ocultar la opción en el cliente no es una medida de seguridad. Las cuentas administradoras están protegidas contra bloqueo o eliminación desde el panel.

1. Habilita **Firestore Database** en el mismo proyecto Firebase de Authentication. Desde la raíz del repositorio, publica las reglas de `firestore.rules` con Firebase CLI (`firebase deploy --only firestore:rules --project synclife-os-b2daf`) o pégalas en **Firestore Database → Rules** y pulsa **Publicar**. Las reglas permiten a administradores leer los contadores agregados; las escrituras solo se aceptan desde el backend con Admin SDK. El resto de documentos no es accesible desde clientes.
2. Proporciona al backend una cuenta de servicio privada del mismo proyecto. En Render define `FIREBASE_PROJECT_ID=synclife-os-b2daf` y `FIREBASE_SERVICE_ACCOUNT_JSON` con el JSON de la cuenta de servicio. Asigna solo permisos de administración de Firebase Authentication y acceso a Firestore que requiera el servicio. Para desarrollo local puedes usar `GOOGLE_APPLICATION_CREDENTIALS` con la ruta absoluta al archivo de credenciales. No guardes el JSON en Git ni en el frontend.
3. Para preparar el primer administrador, crea primero la cuenta con el inicio de sesión normal de SyncLife (con el correo indicado o Google usando ese mismo correo). Después ejecuta el comando con su correo o UID:

   ```powershell
   npm ci --prefix backend
   npm --prefix backend run set-admin -- admin@gmail.com
   ```

   El comando requiere credenciales Firebase Admin en la terminal, por ejemplo `GOOGLE_APPLICATION_CREDENTIALS` con una cuenta de servicio del mismo proyecto. Nunca pegues sus secretos en el repositorio ni en el navegador. Si la cuenta todavía no existe, créala antes de ejecutar el comando. Cierra sesión y vuelve a entrar para refrescar la claim.
4. Después, el administrador inicia sesión desde el formulario normal de SyncLife (correo/contraseña o Google) y elige **Admin**. En **Usuarios**, puede otorgar el rol a cuentas habilitadas; el servidor asigna la custom claim y sincroniza el rol con PostgreSQL. La cuenta promovida debe volver a iniciar sesión para actualizar su token. Administradores no se pueden bloquear ni eliminar desde el panel. Inicia la app con `npm run dev`. El panel contiene Resumen, Usuarios, Estado de APIs y Seguridad. Los datos personales de la app permanecen en `localStorage` del dispositivo y no pueden borrarse remotamente desde el panel.

Los contadores de comidas y rutinas empiezan desde que se habilita esta versión; los registros históricos locales no se pueden reconstruir. Solo se envían el tipo de actividad y un ID opaco para deduplicarla, nunca el contenido de comidas, peso, edad, talla, finanzas o calendario. «Activos hoy» se estima con el último inicio de sesión de Firebase (día UTC). La comprobación de YouTube usa oEmbed; la app usa iframes y no consume cuota de YouTube Data API. El consumo del clima cuenta solicitudes a proveedores desde que arrancó el proceso del backend y se reinicia al desplegar.

## Despliegue: backend en Render y frontend en Vercel

El servicio existente `SyncLife_Os` en Render debe usar la raíz `backend`, el comando de build `npm ci && npm rebuild sqlite3 --build-from-source` y el comando de inicio `npm start`. La recompilación evita reutilizar un binario de `sqlite3` que requiere una versión de glibc distinta. Render define `PORT` automáticamente; `3002` es solo el valor predeterminado local. Comprueba disponibilidad en `/api/health`.

En Render, configura `CORS_ORIGINS` con `https://synclifeos.vercel.app`. Añade `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.8-flash` y una clave válida en `GEMINI_API_KEY` desde el panel de Render. No subas claves al repositorio ni las pongas en variables `VITE_*`.

El proyecto de producción `synclifeos` en Vercel debe conservar la raíz del repositorio (`.`). El `vercel.json` raíz instala y compila el frontend de `frontend` y publica `frontend/dist` con rutas SPA. En **Environment Variables** de Vercel, establece `VITE_API_URL=https://synclife-os.onrender.com` para Production y vuelve a desplegar. La aplicación falla con un mensaje explícito si falta esta variable, en vez de enviar las peticiones a rutas API del mismo dominio Vercel.

Comprueba `https://synclife-os.onrender.com/api/health` y `https://synclife-os.onrender.com/api/synclife/ai/status`: el primero debe devolver `status: "ok"` y el segundo debe indicar `configured: true`. El clima no necesita clave; las tasas de cambio usan ExchangeRate-API y Frankfurter con respaldos aproximados. La IA y las finanzas requieren conectividad desde Render a sus proveedores externos.

SQLite guarda datos en `backend/synclife.db` por defecto. El disco de un servicio Render sin almacenamiento persistente no garantiza conservar la base tras reinicios o despliegues; usa un disco persistente de Render o una base de datos externa si necesitas conservar registros.

## Disponibilidad de servicios externos

El clima consulta Open-Meteo y wttr.in en paralelo, sin requerir una clave de API; Open-Meteo proporciona temperatura, condición y velocidad del viento. Las consultas exitosas se almacenan en memoria durante 10 minutos. Si ambos proveedores fallan, se reutiliza el último dato guardado en SQLite y se identifica como antiguo. La pantalla permite actualizar manualmente y vuelve a consultar periódicamente. Tipos de cambio y datos de productos usan proveedores externos gratuitos, con tiempo máximo de espera, proveedor alternativo para cambio de moneda y respaldos locales cuando están disponibles. La interfaz identifica los valores estimados o reutilizados. Ningún proveedor gratuito garantiza conectividad o disponibilidad permanente.

Las funciones generativas requieren una clave válida de Gemini u OpenAI y están sujetas a las cuotas y condiciones del proveedor; el nivel gratuito, si existe, puede cambiar o agotarse. Si una clave se expone, revócala y crea una nueva.
