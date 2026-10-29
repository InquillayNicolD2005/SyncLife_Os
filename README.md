# SyncLife OS

## Desarrollo local

Instala las dependencias de cada paquete una vez:

```powershell
npm ci
npm ci --prefix backend
npm ci --prefix frontend
```

Inicia frontend y backend con `npm run dev`. En desarrollo, el backend usa el puerto `3002` para evitar conflictos con servicios que ya ocupen los puertos `3000` o `3001`; el frontend de Vite envía `/api` al backend en `127.0.0.1:3002`. En producción, el backend respeta el puerto asignado por la plataforma mediante `PORT`.

## Despliegue: backend en Render y frontend en Vercel

El servicio existente `SyncLife_Os` en Render debe usar la raíz `backend`, el comando de build `npm ci && npm rebuild sqlite3 --build-from-source` y el comando de inicio `npm start`. La recompilación evita reutilizar un binario de `sqlite3` que requiere una versión de glibc distinta. Render define `PORT` automáticamente; `3002` es solo el valor predeterminado local. Comprueba disponibilidad en `/api/health`.

En Render, configura `CORS_ORIGINS` con `https://synclifeos.vercel.app`. Añade `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.8-flash` y una clave válida en `GEMINI_API_KEY` desde el panel de Render. No subas claves al repositorio ni las pongas en variables `VITE_*`.

El proyecto de producción `synclifeos` en Vercel debe conservar la raíz del repositorio (`.`). El `vercel.json` raíz instala y compila el frontend de `frontend` y publica `frontend/dist` con rutas SPA. En **Environment Variables** de Vercel, establece `VITE_API_URL=https://synclife-os.onrender.com` para Production y vuelve a desplegar. La aplicación falla con un mensaje explícito si falta esta variable, en vez de enviar las peticiones a rutas API del mismo dominio Vercel.

Comprueba `https://synclife-os.onrender.com/api/health` y `https://synclife-os.onrender.com/api/synclife/ai/status`: el primero debe devolver `status: "ok"` y el segundo debe indicar `configured: true`. El clima no necesita clave; las tasas de cambio usan ExchangeRate-API y Frankfurter con respaldos aproximados. La IA y las finanzas requieren conectividad desde Render a sus proveedores externos.

SQLite guarda datos en `backend/synclife.db` por defecto. El disco de un servicio Render sin almacenamiento persistente no garantiza conservar la base tras reinicios o despliegues; usa un disco persistente de Render o una base de datos externa si necesitas conservar registros.

## Disponibilidad de servicios externos

El clima consulta Open-Meteo y wttr.in en paralelo, sin requerir una clave de API; Open-Meteo proporciona temperatura, condición y velocidad del viento. Las consultas exitosas se almacenan en memoria durante 10 minutos. Si ambos proveedores fallan, se reutiliza el último dato guardado en SQLite y se identifica como antiguo. La pantalla permite actualizar manualmente y vuelve a consultar periódicamente. Tipos de cambio y datos de productos usan proveedores externos gratuitos, con tiempo máximo de espera, proveedor alternativo para cambio de moneda y respaldos locales cuando están disponibles. La interfaz identifica los valores estimados o reutilizados. Ningún proveedor gratuito garantiza conectividad o disponibilidad permanente.

Las funciones generativas requieren una clave válida de Gemini u OpenAI y están sujetas a las cuotas y condiciones del proveedor; el nivel gratuito, si existe, puede cambiar o agotarse. Si una clave se expone, revócala y crea una nueva.
