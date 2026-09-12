import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Метка сборки вшивается в бандл и показывается в профиле: по ней сразу видно,
// свежий ли фронтенд отдаёт nginx (иначе после пересборки можно часами искать
// баг в старом кешированном бандле)
const BUILD_INFO = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_INFO__: JSON.stringify(BUILD_INFO) },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8000',
      '/socket.io': {
        target: 'ws://localhost:8000',
        ws: true
      },
      '/rocket': {
        target: 'ws://localhost:8000',
        ws: true
      }
    }
  }
});
