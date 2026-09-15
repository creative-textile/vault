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

/**
 * Память вкладки — запасное хранилище.
 *
 * `sessionStorage`/`localStorage` доступны НЕ всегда: в приватном режиме, в
 * WebView Telegram на части устройств и — самое частое — когда приложение
 * открыто в iframe с заблокированными сторонними хранилищами, любой `getItem`
 * бросает SecurityError. Прежняя версия ловила исключение и возвращала `null`,
 * поэтому токен «исчезал» сразу после входа: следующий запрос уходил без
 * заголовка Authorization и отвечал 401 «Нет авторизации», а лечилось это
 * только перезагрузкой страницы (в новом документе хранилище иногда
 * отваливалось не сразу). Держим значение ещё и в переменной модуля: оно живёт
 * ровно столько, сколько живёт вкладка, и не зависит от политик браузера.
 */
const memory = new Map<string, string>();

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
    /* хранилище недоступно — ниже возьмём значение из памяти вкладки */
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: string | null) {
  if (value == null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
    localStorage.removeItem(key);
  } catch {
    /* см. выше: память вкладки уже обновлена, запросы не разлогинятся */
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
    /* приватный режим / iframe без хранилищ */
    return memory.get(DEMO_ID_KEY) ?? null;
  }
}

export function setDemoId(id: string) {
  memory.set(DEMO_ID_KEY, id);
  try {
    sessionStorage.setItem(DEMO_ID_KEY, id);
    localStorage.setItem(DEMO_ID_KEY, id);
  } catch {
    /* приватный режим */
  }
}
