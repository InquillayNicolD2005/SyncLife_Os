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

SQLite guarda datos en `backend/synclife.db` por defecto. El sistema de archivos de Vercel Functions no es almacenamiento persistente, por lo que la base local no es adecuada para conservar datos entre ejecuciones o despliegues; migra a una base de datos externa si necesitas persistencia.

## Disponibilidad de servicios externos

El clima consulta Open-Meteo y wttr.in en paralelo, sin requerir una clave de API; si ambos proveedores fallan, reutiliza el último dato guardado en SQLite y lo identifica como antiguo. La pantalla permite actualizar manualmente y vuelve a consultar periódicamente. Tipos de cambio y datos de productos usan proveedores externos gratuitos, con tiempo máximo de espera, proveedor alternativo para cambio de moneda y respaldos locales cuando están disponibles. La interfaz identifica los valores estimados o reutilizados. Ningún proveedor gratuito garantiza conectividad o disponibilidad permanente.

Las funciones generativas requieren una clave válida de Gemini u OpenAI y están sujetas a las cuotas y condiciones del proveedor; el nivel gratuito, si existe, puede cambiar o agotarse. Si una clave se expone, revócala y crea una nueva.
