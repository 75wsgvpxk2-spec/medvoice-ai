import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/*
 * Ports come from .env so that two checkouts of this repository — a worktree
 * and the branch it came from, say — can run side by side without one of them
 * silently proxying its API calls into the other's database.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname), '');
  const apiPort = Number(env.API_PORT) || 5174;
  const clientPort = Number(env.CLIENT_PORT) || 5173;

  return {
    root: path.resolve(import.meta.dirname, 'client'),
    plugins: [react()],
    server: {
      port: clientPort,
      proxy: {
        // SSE needs buffering off, which the proxy honours for text/event-stream.
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
    build: {
      outDir: path.resolve(import.meta.dirname, 'client', 'dist'),
      emptyOutDir: true,
    },
  };
});
