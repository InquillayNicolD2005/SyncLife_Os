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

Al crear una cuenta se elige un nombre de usuario único, que también puede usarse junto con la contraseña para iniciar sesión. La reserva se guarda en Firestore desde el backend y no revela el correo asociado. Las cuentas antiguas pueden elegir su usuario después de entrar; si usan solo Google, también pueden crear una contraseña sin perder el acceso con Google. Para habilitar la validación segura de contraseña en Render, configura `FIREBASE_WEB_API_KEY` con la misma clave web pública del proyecto Firebase que usa `VITE_FIREBASE_API_KEY`; en local puedes añadirla a `backend/.env`. Limita esa clave en Google Cloud a las APIs y dominios necesarios. El acceso por correo y Google sigue disponible.

La sección **Registro** se retiró para evitar formularios repetidos: las sesiones de ejercicio se guardan en **Bienestar → Actividad Física**, las comidas en **Alimentación**, los gastos en **Finanzas** y los eventos en **Calendario**. Análisis muestra estos datos locales y no calcula un puntaje diario. Los ejercicios guardados anteriormente en el historial local se incorporan a la lista de actividad física; no se borran los datos históricos de Firebase.

### Base de datos PostgreSQL en Render

En Render, crea o selecciona una base PostgreSQL y copia su **Internal Database URL** en `DATABASE_URL` del servicio backend. No publiques esa URL ni la pongas en Vercel o en una variable `VITE_*`. El backend crea y migra automáticamente `synclife_accounts` y `synclife_activity_events`: PostgreSQL conserva los perfiles administrativos, roles, accesos delegados y conteos agregados de actividad. Firebase Authentication sigue verificando la identidad y administrando el inicio de sesión; el panel sincroniza sus cuentas a PostgreSQL para mostrarlas y gestionarlas. Los registros diarios históricos previos que aún estén en Firestore siguen ahí y se combinan con los datos nuevos del panel; no se migran automáticamente.

Para consultar la base: abre el dashboard de Render, selecciona tu recurso **PostgreSQL** y entra en **Connect**. Usa la conexión privada desde el backend. Para ver filas, conecta un cliente SQL como `psql` o DBeaver y ejecuta, por ejemplo, `SELECT * FROM synclife_accounts ORDER BY registered_at DESC;` o `SELECT * FROM synclife_activity_events ORDER BY created_at DESC LIMIT 100;`. No compartas la URL ni sus credenciales.

## Panel administrativo

El panel administrativo es una vista independiente del espacio personal. El propietario único es `admin@gmail.com` por defecto (se puede cambiar con `SUPER_ADMIN_EMAIL` en Render); el backend verifica esa identidad de Firebase y su rol en PostgreSQL, sin depender de custom claims que deban asignarse manualmente. El propietario puede delegar y retirar administradores desde **Administradores**; las cuentas delegadas requieren la custom claim `admin` de Firebase y no pueden gestionar roles. El backend verifica Firebase y PostgreSQL en cada operación privilegiada.

1. En Render configura `SUPER_ADMIN_EMAIL=admin@gmail.com`, `DATABASE_URL` con la URL privada de PostgreSQL, `FIREBASE_PROJECT_ID=synclife-os-b2daf` y `FIREBASE_SERVICE_ACCOUNT_JSON` con el JSON privado de una cuenta de servicio del mismo proyecto (`project_id`, `client_email` y `private_key`). Esa cuenta necesita el rol Firebase Authentication Admin para listar y eliminar usuarios y acceso a Firestore para los nombres de usuario e historiales heredados. En local puedes usar `GOOGLE_APPLICATION_CREDENTIALS` con una ruta local. No guardes secretos en Git ni en el frontend.
2. Crea la cuenta propietaria en Firebase Authentication usando el correo configurado. Tras desplegar, inicia sesión normalmente; el backend sincroniza el rol propietario. Las cuentas existentes se incorporan a PostgreSQL al abrir el panel.
3. El propietario puede conceder acceso desde **Administración → Administradores**, escribiendo el correo de una cuenta ya registrada. Los cambios se guardan en PostgreSQL y en las custom claims de Firebase; las cuentas delegadas no pueden gestionar otros administradores.
4. El resumen y los conteos de comidas, rutinas y ejercicios nuevos usan PostgreSQL. No se envían al administrador nombres de ejercicios, peso, edad, talla, comidas, finanzas ni calendario. Los puntajes históricos heredados de Firestore siguen visibles; los eventos nuevos se guardan de forma agregada en PostgreSQL.

«Activos hoy» se calcula con el último inicio de sesión sincronizado en PostgreSQL. La comprobación de YouTube usa oEmbed; la app usa iframes y no consume cuota de YouTube Data API. El consumo del clima cuenta solicitudes desde que arrancó el backend y se reinicia al desplegar.

## Despliegue: backend en Render y frontend en Vercel

El servicio existente `SyncLife_Os` en Render debe usar la raíz `backend`, el comando de build `npm ci && npm rebuild sqlite3 --build-from-source` y el comando de inicio `npm start`. La recompilación evita reutilizar un binario de `sqlite3` que requiere una versión de glibc distinta. Render define `PORT` automáticamente; `3002` es solo el valor predeterminado local. Comprueba disponibilidad en `/api/health`.

En Render, añade `DATABASE_URL`, `SUPER_ADMIN_EMAIL=admin@gmail.com`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` y `FIREBASE_WEB_API_KEY`. El dominio `https://synclifeos.vercel.app` ya está permitido por el backend; define `CORS_ORIGINS` si necesitas permitir dominios adicionales. También añade `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.8-flash` y una clave válida en `GEMINI_API_KEY` desde el panel de Render. No subas claves privadas al repositorio ni las pongas en variables `VITE_*`.

El proyecto de producción `synclifeos` en Vercel debe conservar la raíz del repositorio (`.`). El `vercel.json` raíz instala y compila el frontend de `frontend` y publica `frontend/dist` con rutas SPA. El frontend usa `https://synclife-os.onrender.com` como backend predeterminado; si cambia la URL, configura `VITE_API_URL` en Vercel y vuelve a desplegar. El backend permite por defecto el dominio `https://synclifeos.vercel.app`; usa `CORS_ORIGINS` en Render para añadir otros dominios publicados.

Comprueba `https://synclife-os.onrender.com/api/health` y `https://synclife-os.onrender.com/api/synclife/ai/status`: el primero debe devolver `status: "ok"` y el segundo debe indicar `configured: true`. El clima no necesita clave; las tasas de cambio usan ExchangeRate-API y Frankfurter con respaldos aproximados. La IA y las finanzas requieren conectividad desde Render a sus proveedores externos.

SQLite guarda datos en `backend/synclife.db` por defecto. El disco de un servicio Render sin almacenamiento persistente no garantiza conservar la base tras reinicios o despliegues; usa un disco persistente de Render o una base de datos externa si necesitas conservar registros.

## Disponibilidad de servicios externos

El clima consulta Open-Meteo y wttr.in en paralelo, sin requerir una clave de API; Open-Meteo proporciona temperatura, condición y velocidad del viento. Las consultas exitosas se almacenan en memoria durante 10 minutos. Si ambos proveedores fallan, se reutiliza el último dato guardado en SQLite y se identifica como antiguo. La pantalla permite actualizar manualmente y vuelve a consultar periódicamente. Tipos de cambio y datos de productos usan proveedores externos gratuitos, con tiempo máximo de espera, proveedor alternativo para cambio de moneda y respaldos locales cuando están disponibles. La interfaz identifica los valores estimados o reutilizados. Ningún proveedor gratuito garantiza conectividad o disponibilidad permanente.

La tabla nutricional consulta USDA FoodData Central desde el backend, sin IA y sin enviar claves al navegador. La categoría de comida (por ejemplo, «Almuerzo») solo organiza el registro; la búsqueda se hace con el texto de «Alimento o plato». Traduce ingredientes frecuentes del español y ordena los resultados según sus ingredientes y preparación, descartando coincidencias que no se parecen a lo escrito. USDA ofrece referencias nutricionales y no calcula la receta completa; confirma la coincidencia elegida o ingresa los valores manualmente. Los nutrientes no publicados quedan vacíos. Los valores se ofrecen por 100 g, o se calculan para la cantidad ingresada únicamente si esta incluye un peso explícito en g o kg.

Para desarrollo, el backend usa `DEMO_KEY` de FoodData Central, que tiene una cuota muy baja. Para un despliegue compartido, solicita gratis una clave en [api.data.gov](https://api.data.gov/signup/) y configúrala como `FDC_API_KEY` en las variables de entorno del servicio de Render. No pongas esa clave en Vercel ni en una variable `VITE_*`.

Las funciones generativas requieren una clave válida de Gemini u OpenAI y están sujetas a las cuotas y condiciones del proveedor; el nivel gratuito, si existe, puede cambiar o agotarse. Si una clave se expone, revócala y crea una nueva.
