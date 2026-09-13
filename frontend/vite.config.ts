import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Метка сборки вшивается в бандл и показывается в профиле: по ней сразу видно,
// свежий ли фронтенд отдаёт nginx (иначе после пересборки можно часами искать
// баг в старом кешированном бандле)
const BUILD_INFO = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_INFO__: JSON.stringify(BUILD_INFO) },
  build: {
    // Чанк `three` — одна неделимая vendor-библиотека (~501 КБ): её нельзя ни
    // разрезать, ни выкинуть, и браузер кэширует её отдельно от кода приложения,
    // поэтому она не перезагружается при каждом релизе. Порог предупреждения
    // поднят осознанно — чтобы предупреждение о размере не маскировало настоящий разросшийся
    // чанк приложения.
    chunkSizeWarningLimit: 560,
    rollupOptions: {
      output: {
        // Один бандл на 850 КБ (из них ~600 КБ — three.js) грузился целиком
        // даже на экране профиля и инвалидировался при любом изменении кода.
        // Тяжёлые зависимости вынесены в отдельные чанки: они кешируются
        // браузером независимо и не пересобираются вместе с приложением.
        manualChunks: {
          three: ['three'],
          vendor: ['react', 'react-dom', 'react-router-dom', 'socket.io-client', 'zustand', '@twa-dev/sdk']
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Dev-сервер смотрят не только с localhost: превью рабочей среды открывается
    // через поддомен *.e2b.app, и без разрешения Vite отвечает 403 Blocked
    // request. Точка в начале разрешает все поддомены зоны, но не любой хост.
    allowedHosts: ['.e2b.app'],
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
