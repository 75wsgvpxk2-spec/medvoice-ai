import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'client'),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // SSE needs buffering off, which the proxy honours for text/event-stream.
      '/api': { target: 'http://localhost:5174', changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'client', 'dist'),
    emptyOutDir: true,
  },
});
