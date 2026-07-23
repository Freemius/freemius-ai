import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// React + Vite frontend. The Hono API runs separately on PORT (default 8787);
// /api is proxied there in dev. See references/nextjs-to-vite-port.md.
export default defineConfig({
  plugins: [react()],
  root: 'src/web',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/web', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
});
