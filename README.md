# SyncLife OS

## Desarrollo local

Instala las dependencias de cada paquete una vez:

```powershell
npm ci
npm ci --prefix backend
npm ci --prefix frontend
```

Inicia frontend y backend con `npm run dev`. En desarrollo, el backend usa el puerto `3002` para evitar conflictos con servicios que ya ocupen los puertos `3000` o `3001`; el frontend de Vite envía `/api` al backend en `127.0.0.1:3002`. En producción, el backend respeta el puerto asignado por la plataforma mediante `PORT`.

## Despliegue multiservicio en Vercel

El archivo raíz `vercel.json` configura dos servicios: `backend` (Express, con `backend/server.js` como punto de entrada) y `frontend` (Vite). Las rutas públicas `/api/*` se envían al backend y el resto al frontend. Al importar el repositorio en Vercel, usa la raíz del repositorio (`./`) y el preset **Services** para que se aplique esta configuración.

Configura las claves del proveedor de IA como variables de entorno privadas en la plataforma de despliegue. En local, `backend/.env` es compatible y está excluido de Git. No incluyas claves `VITE_*` en el frontend. El clima usa proveedores externos sin clave.

## Despliegue del backend en Render

Para alojar el backend en Render y el frontend en Vercel, crea un servicio web de Node.js con `backend` como directorio raíz y `npm start` como comando de inicio. El servidor escucha `process.env.PORT` en Render; el puerto `3002` es solo el valor predeterminado local. Configura `CORS_ORIGINS` en Render con el origen exacto del frontend de Vercel (por ejemplo, `https://tu-app.vercel.app`); admite varios orígenes separados por comas. En Vercel, configura `VITE_API_URL` con la URL base de Render (por ejemplo, `https://tu-backend.onrender.com`) y vuelve a desplegar el frontend. Sin `VITE_API_URL`, el frontend conserva las rutas relativas usadas por el despliegue multiservicio de Vercel y el proxy local de Vite.

SQLite guarda datos en `backend/synclife.db` por defecto. El sistema de archivos de Vercel Functions no es almacenamiento persistente, por lo que la base local no es adecuada para conservar datos entre ejecuciones o despliegues; migra a una base de datos externa si necesitas persistencia.

## Disponibilidad de servicios externos

El clima consulta Open-Meteo y wttr.in en paralelo, sin requerir una clave de API; Open-Meteo proporciona temperatura, condición y velocidad del viento. Las consultas exitosas se almacenan en memoria durante 10 minutos. Si ambos proveedores fallan, se reutiliza el último dato guardado en SQLite y se identifica como antiguo. La pantalla permite actualizar manualmente y vuelve a consultar periódicamente. Tipos de cambio y datos de productos usan proveedores externos gratuitos, con tiempo máximo de espera, proveedor alternativo para cambio de moneda y respaldos locales cuando están disponibles. La interfaz identifica los valores estimados o reutilizados. Ningún proveedor gratuito garantiza conectividad o disponibilidad permanente.

Las funciones generativas requieren una clave válida de Gemini u OpenAI y están sujetas a las cuotas y condiciones del proveedor; el nivel gratuito, si existe, puede cambiar o agotarse. Si una clave se expone, revócala y crea una nueva.
