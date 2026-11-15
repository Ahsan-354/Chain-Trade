import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, root, '');
  return {
    plugins: [react(), tailwind()],
    build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'] } } } },
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:' + (env.API_PORT || '4000') } },
    },
  };
});
