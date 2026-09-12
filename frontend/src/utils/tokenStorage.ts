/**
 * Токен и флаг онбординга храним в sessionStorage — он у каждой вкладки свой.
 *
 * В localStorage они общие на весь браузер, и вторая вкладка с другим
 * аккаунтом перезаписывала токен: первая вкладка продолжала ходить в API под
 * чужим пользователем, поэтому свои уведомления (в том числе о результате
 * дуэли) не получала, а список уведомлений приходил уже чужой. Для Telegram
 * Mini App разница незаметна — вкладка там одна, а вход по initData
 * автоматический, — зато проверку двумя аккаунтами в двух вкладках браузера
 * это делает возможной.
 *
 * Значения, оставленные прежней версией в localStorage, забираем себе при
 * первом чтении и оттуда убираем: обновление не разлогинивает пользователя и
 * не оставляет общий токен соседним вкладкам.
 */

const TOKEN_KEY = 'vault_token';
const ONBOARDING_KEY = 'onboarding_done';

function read(key: string): string | null {
  try {
    const own = sessionStorage.getItem(key);
    if (own != null) return own;
    const legacy = localStorage.getItem(key);
    if (legacy != null) {
      sessionStorage.setItem(key, legacy);
      localStorage.removeItem(key);
      return legacy;
    }
  } catch {
    /* приватный режим браузера может блокировать хранилища — работаем без них */
  }
  return null;
}

function write(key: string, value: string | null) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
    localStorage.removeItem(key);
  } catch {
    /* см. выше */
  }
}

export const getStoredToken = (): string | null => read(TOKEN_KEY);
export const setStoredToken = (token: string) => write(TOKEN_KEY, token);
export const clearStoredToken = () => write(TOKEN_KEY, null);

export const getOnboardingDone = (): boolean => read(ONBOARDING_KEY) === '1';
export const setOnboardingDone = (done: boolean) => write(ONBOARDING_KEY, done ? '1' : null);

/**
 * Демо-аккаунт для входа из браузера. Читаем свой (вкладочный) id, а если его
 * нет — общий из localStorage: так новая вкладка по умолчанию попадает в тот
 * же демо-аккаунт, что и раньше, но переключение аккаунта в одной вкладке
 * больше не утаскивает за собой соседнюю (у той уже свой токен в sessionStorage).
 */
const DEMO_ID_KEY = 'demo_id';

export function getDemoId(): string | null {
  try {
    return sessionStorage.getItem(DEMO_ID_KEY) ?? localStorage.getItem(DEMO_ID_KEY);
  } catch {
    return null;
  }
}

export function setDemoId(id: string) {
  try {
    sessionStorage.setItem(DEMO_ID_KEY, id);
    localStorage.setItem(DEMO_ID_KEY, id);
  } catch {
    /* приватный режим */
  }
}
