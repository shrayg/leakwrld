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
      '/auth': { target: 'http://127.0.0.1:3002', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:3002', changeOrigin: true },
      '/thumbnail': { target: 'http://127.0.0.1:3002', changeOrigin: true },
      '/preview-media': { target: 'http://127.0.0.1:3002', changeOrigin: true },
      '/thumbnails': { target: 'http://127.0.0.1:3002', changeOrigin: true },
      '/images': { target: 'http://127.0.0.1:3002', changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
