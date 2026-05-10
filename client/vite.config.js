import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  /** Single repo-root `.env` supplies both Node (`server.js`) and `VITE_*` client vars. */
  envDir: path.join(__dirname, '..'),
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3002', changeOrigin: true },
      /** /r2/* is served by the Node dev server during local development
       *  (which streams from R2 via rclone) and by the Cloudflare Worker
       *  in production. Both paths are transparent to the client. */
      '/r2': { target: 'http://127.0.0.1:3002', changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
