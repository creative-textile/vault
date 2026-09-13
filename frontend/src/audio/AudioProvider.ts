/**
 * Инициализация звука на уровне приложения.
 *
 * Два ограничения платформы, которые здесь закрыты:
 *
 * 1. **AudioContext нельзя создать до жеста пользователя.** iOS/Telegram WebView
 *    создают контекст в состоянии `suspended`, и первый звук (запуск ракеты)
 *    пропадает. Поэтому слушаем первое касание/клик/клавишу и только тогда
 *    поднимаем контекст. Слушатели снимаются сразу после успешного unlock.
 *
 * 2. **Звук не должен играть в фоне.** Ушёл в другую вкладку — гул двигателя
 *    и вращение барабанов продолжаются и раздражают. На `hidden` гасим все
 *    длинные голоса и приостанавливаем контекст; на возврате возобновляем его
 *    и сообщаем экранам событием `vault:audio-visible`, чтобы летящая ракета
 *    заново завела двигатель (полёт при этом не прерывается: он принадлежит
 *    серверу, а не клиенту).
 */
import { audio } from './engine';

let installed = false;

function unlockOnce() {
  audio.unlock();
  if (audio.ready) {
    window.removeEventListener('pointerdown', unlockOnce, true);
    window.removeEventListener('touchstart', unlockOnce, true);
    window.removeEventListener('keydown', unlockOnce, true);
  }
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    audio.stopAllLoops();
    audio.suspend();
  } else {
    audio.resume();
    audio.unlock();
    window.dispatchEvent(new CustomEvent('vault:audio-visible'));
  }
}

if (!installed && typeof window !== 'undefined') {
  installed = true;
  // capture=true: реагируем до того, как обработчик компонента остановит событие
  window.addEventListener('pointerdown', unlockOnce, true);
  window.addEventListener('touchstart', unlockOnce, true);
  window.addEventListener('keydown', unlockOnce, true);
  document.addEventListener('visibilitychange', onVisibility);
  // Уход со страницы: длинные голоса не должны остаться висеть в контексте
  window.addEventListener('pagehide', () => audio.stopAllLoops());
}

export {};
