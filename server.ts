import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { createApiApp } from './src/server/apiApp';
import { initializeServerPersistenceAdapterFromEnv } from './src/server/persistenceAdapters';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const persistenceFilePath =
    process.env.SOWVEIL_STORE_PATH ||
    path.join(__dirname, '.data', 'sowveil-durable-store.json');

  const { adapter: persistenceAdapter, readiness } =
    await initializeServerPersistenceAdapterFromEnv({
      snapshotFilePath: persistenceFilePath,
      refuseUnreadyProductionStartup: true,
    });

  const app = createApiApp({
    persistenceFilePath,
    persistenceAdapter,
  });
  const PORT = Number(process.env.PORT || 3000);
  const server = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Please retry or release the port.`);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Sowveil Studio Server listening on http://0.0.0.0:${PORT} [adapter=${readiness.activeAdapterKind}, status=${readiness.status}]`
    );
  });
}

void startServer().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[FATAL STARTUP ERROR] Sowveil Studio server failed to start: ${message}`);
  process.exit(1);
});


