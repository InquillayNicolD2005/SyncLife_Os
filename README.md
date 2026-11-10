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

En Render, crea o selecciona una base PostgreSQL y copia su **Internal Database URL** en la variable `DATABASE_URL` del servicio backend. No la pongas en Vercel ni en una variable `VITE_*`, y no la subas a Git. El backend crea automáticamente `synclife_accounts` y `synclife_activity_events`. Al abrir el panel se sincronizan las cuentas de Firebase Authentication a PostgreSQL; la identidad y las credenciales siguen siendo administradas por Firebase. El endpoint `/api/health` muestra `database.configured: true` cuando `DATABASE_URL` está definida. En Render, abre el servicio PostgreSQL para consultar o administrar la base; el backend la usa mediante `DATABASE_URL`.

## Panel administrativo

La cuenta propietaria única es `admin@gmail.com` (configurable con `SUPER_ADMIN_EMAIL` en Render). Al iniciar sesión, el backend verifica esa identidad y asigna las custom claims `admin` y `superAdmin`; la interfaz la lleva directamente al panel independiente, no al espacio personal. El propietario puede delegar y retirar administradores desde **Administradores**. Las cuentas delegadas pueden entrar al panel y administrar usuarios, pero no pueden cambiar roles. El backend vuelve a validar la sesión, la claim y la identidad propietaria en cada operación privilegiada.

1. En Render, configura `SUPER_ADMIN_EMAIL=admin@gmail.com`, `DATABASE_URL` con la URL privada de PostgreSQL, `FIREBASE_PROJECT_ID=synclife-os-b2daf` y `FIREBASE_SERVICE_ACCOUNT_JSON` con el JSON privado de la cuenta de servicio Firebase. Para desarrollo local puedes usar `GOOGLE_APPLICATION_CREDENTIALS` con una ruta local. No guardes credenciales en Git ni en el frontend.
2. Crea la cuenta propietaria en Firebase Authentication usando ese correo. Después de desplegar, inicia sesión normalmente; el backend asigna el rol propietario automáticamente. Las cuentas existentes se sincronizan a PostgreSQL al abrir el panel.
3. La persona propietaria puede conceder acceso desde **Administración → Administradores**, escribiendo el correo de una cuenta ya registrada. Los cambios de rol invalidan sesiones existentes para que la persona vuelva a iniciar sesión con los permisos actualizados. No hace falta usar un comando para delegar.
4. El panel utiliza PostgreSQL en Render para cuentas, roles y nuevos conteos agregados de comidas, rutinas y ejercicios. No sincroniza datos individuales de salud, alimentos, finanzas ni calendario. Los puntajes históricos que ya estaban en Firestore permanecen allí y continúan visibles; no se copian automáticamente a PostgreSQL.

«Activos hoy» se estima a partir de la última actividad de acceso sincronizada en PostgreSQL. La comprobación de YouTube usa oEmbed; la app usa iframes y no consume cuota de YouTube Data API. El consumo del clima cuenta solicitudes a proveedores desde que arrancó el proceso del backend y se reinicia al desplegar.

## Despliegue: backend en Render y frontend en Vercel

El servicio existente `SyncLife_Os` en Render debe usar la raíz `backend`, el comando de build `npm ci && npm rebuild sqlite3 --build-from-source` y el comando de inicio `npm start`. La recompilación evita reutilizar un binario de `sqlite3` que requiere una versión de glibc distinta. Render define `PORT` automáticamente; `3002` es solo el valor predeterminado local. Comprueba disponibilidad en `/api/health`.

En Render, configura `CORS_ORIGINS` con `https://synclifeos.vercel.app`. Añade `FIREBASE_WEB_API_KEY` con la clave web pública del proyecto Firebase para que funcione el inicio con nombre de usuario. Configura también `SUPER_ADMIN_EMAIL=admin@gmail.com`, `DATABASE_URL`, `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-2.5-flash` y las credenciales privadas requeridas en el panel de Render. No subas claves privadas al repositorio ni las pongas en variables `VITE_*`.

El proyecto de producción `synclifeos` en Vercel debe conservar la raíz del repositorio (`.`). El `vercel.json` raíz instala y compila el frontend de `frontend` y publica `frontend/dist` con rutas SPA. En **Environment Variables** de Vercel, establece `VITE_API_URL=https://synclife-os.onrender.com` para Production y vuelve a desplegar. La aplicación falla con un mensaje explícito si falta esta variable, en vez de enviar las peticiones a rutas API del mismo dominio Vercel.

Comprueba `https://synclife-os.onrender.com/api/health` y `https://synclife-os.onrender.com/api/synclife/ai/status`: el primero debe devolver `status: "ok"` y el segundo debe indicar `configured: true`. El clima no necesita clave; las tasas de cambio usan ExchangeRate-API y Frankfurter con respaldos aproximados. La IA y las finanzas requieren conectividad desde Render a sus proveedores externos.

SQLite guarda datos en `backend/synclife.db` por defecto. El disco de un servicio Render sin almacenamiento persistente no garantiza conservar la base tras reinicios o despliegues; usa un disco persistente de Render o una base de datos externa si necesitas conservar registros.

## Disponibilidad de servicios externos

El clima consulta Open-Meteo y wttr.in en paralelo, sin requerir una clave de API; Open-Meteo proporciona temperatura, condición y velocidad del viento. Las consultas exitosas se almacenan en memoria durante 10 minutos. Si ambos proveedores fallan, se reutiliza el último dato guardado en SQLite y se identifica como antiguo. La pantalla permite actualizar manualmente y vuelve a consultar periódicamente. Tipos de cambio y datos de productos usan proveedores externos gratuitos, con tiempo máximo de espera, proveedor alternativo para cambio de moneda y respaldos locales cuando están disponibles. La interfaz identifica los valores estimados o reutilizados. Ningún proveedor gratuito garantiza conectividad o disponibilidad permanente.

La tabla nutricional consulta USDA FoodData Central desde el backend, sin IA y sin enviar claves al navegador. La categoría de comida (por ejemplo, «Almuerzo») solo organiza el registro; la búsqueda se hace con el texto de «Alimento o plato». Traduce ingredientes frecuentes del español y ordena los resultados según sus ingredientes y preparación, descartando coincidencias que no se parecen a lo escrito. USDA ofrece referencias nutricionales y no calcula la receta completa; confirma la coincidencia elegida o ingresa los valores manualmente. Los nutrientes no publicados quedan vacíos. Los valores se ofrecen por 100 g, o se calculan para la cantidad ingresada únicamente si esta incluye un peso explícito en g o kg.

Para desarrollo, el backend usa `DEMO_KEY` de FoodData Central, que tiene una cuota muy baja. Para un despliegue compartido, solicita gratis una clave en [api.data.gov](https://api.data.gov/signup/) y configúrala como `FDC_API_KEY` en las variables de entorno del servicio de Render. No pongas esa clave en Vercel ni en una variable `VITE_*`.

Las funciones generativas requieren una clave válida de Gemini u OpenAI y están sujetas a las cuotas y condiciones del proveedor; el nivel gratuito, si existe, puede cambiar o agotarse. Si una clave se expone, revócala y crea una nueva.
