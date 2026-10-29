import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const server = await createServer({
  root,
  configFile: fileURLToPath(new URL('./vite.config.js', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});

await server.listen();
server.printUrls();
