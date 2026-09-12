/**
 * Флаги «показать один раз» — в `sessionStorage`, он свой для каждой вкладки.
 *
 * В `localStorage` две вкладки одного браузера делили флаг: в одной мини-игра
 * взлома открывалась сама, в другой нужно было жать кнопку (и секунды окна
 * уходили), а итоги раунда в одной вкладке раскрывались, в другой — нет.
 *
 * Модуль общий для `Safe.tsx` и `SafeCrackRedirector`: ключи должны совпадать,
 * иначе переход в мини-игру срабатывал бы дважды за раунд.
 */
export const tabStore = {
  get(key: string): string | null {
    try { return window.sessionStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { window.sessionStorage.setItem(key, value); } catch { /* приватный режим — не критично */ }
  },
  remove(key: string) {
    try { window.sessionStorage.removeItem(key); } catch { /* приватный режим — не критично */ }
  }
};

/** Игрок уже видел итоги этого раунда. */
export const resultSeenKey = (safeId: number) => `vault:safe-result-seen:${safeId}`;

/** В этом раунде игрока уже открывали в мини-игре взлома. */
export const crackVisitedKey = (safeId: number) => `vault:safe-crack-visited:${safeId}`;

/** Анимацию броска монеты в этой дуэли уже смотрели (повтор открываем на результате). */
export const duelSeenKey = (duelId: number | string) => `vault:duel-seen:${duelId}`;
