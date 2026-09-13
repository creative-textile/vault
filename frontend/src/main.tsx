import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Порядок важен: theme.css задаёт токены/шрифты, app.css — компоненты поверх них
import './styles/theme.css';
import './styles/app.css';
// Поднимает звук по первому жесту и гасит его в фоновой вкладке
import './audio/AudioProvider';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Загрузочный экран из index.html уходит только после первой отрисовки React:
// если снять его раньше, игрок увидит пустой тёмный кадр.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById('vault-splash');
    if (!splash) return;
    splash.classList.add('is-hidden');
    window.setTimeout(() => splash.remove(), 500);
  });
});
