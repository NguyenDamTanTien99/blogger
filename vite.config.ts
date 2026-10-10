import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dashboard (React SPA) được build vào dist/client/app và phục vụ tại /app/ như static assets.
// Khi dev: Vite (5173) phục vụ /app/* có HMR, mọi đường dẫn khác (API, blog SSR) proxy sang `wrangler dev` (8787).
export default defineConfig({
  root: 'src/client',
  base: '/app/',
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/client/app',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Giữ nguyên Host (changeOrigin: false) để cookie & kiểm tra CSRF hoạt động như production.
      '^/(?!app(?:/|$)).*': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
});
