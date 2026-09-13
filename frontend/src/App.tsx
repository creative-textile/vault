import { useEffect, useState, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WebApp from '@twa-dev/sdk';
import { AuthContext, User } from './stores/auth';
import { authApi, profileApi } from './api/client';
import { getSocket, disconnectSocket } from './api/socket';
import {
  getStoredToken, setStoredToken, clearStoredToken,
  getOnboardingDone, setOnboardingDone as persistOnboardingDone,
  getDemoId, setDemoId
} from './utils/tokenStorage';
import { useNotifications } from './stores/notifications';
import { emitSafeEvent, emitNotificationEvent } from './utils/socketEvents';
import { holdBalance, releaseBalance, isBalanceHeld, onBalanceReleased } from './utils/balanceHold';

import Onboarding from './components/onboarding/Onboarding';
import Home from './components/layout/Home';
import Deposit from './components/wallet/Deposit';
import Withdraw from './components/wallet/Withdraw';
import Rocket from './components/rocket/Rocket';
import Duel from './components/duel/Duel';
import DuelGame from './components/duel/DuelGame';
import Safe from './components/safe/Safe';
import SafeCrack from './components/safe/SafeCrack';
import VaultDeposit from './components/vault-deposit/VaultDeposit';
import Referral from './components/profile/Referral';
import Profile from './components/profile/Profile';
import AdminPanel from './components/profile/AdminPanel';
import SetPin from './components/wallet/SetPin';
import DuelResultModal from './components/common/DuelResultModal';
import NotificationsModal from './components/common/NotificationsModal';
import SafeCrackRedirector from './components/safe/SafeCrackRedirector';
import RocketFlightBadge from './components/common/RocketFlightBadge';
import Replay from './components/common/Replay';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  // Токен и онбординг — в sessionStorage (свой для вкладки): два аккаунта в
  // двух вкладках браузера не перезаписывают друг друга
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [loading, setLoading] = useState(true);
  const [onboardingDone, setOnboardingDoneState] = useState(getOnboardingDone());
  /** Показывать ли приветственные экраны: да только для аккаунта, созданного в
      этом входе (`isNew`). Возврат в игру с действующим токеном в приветствие
      не выбрасывает — игрок мог быть посреди полёта ракеты или взлома сейфа. */
  const [showOnboarding, setShowOnboarding] = useState(false);
  // React StrictMode повторно запускает эффекты в dev. Без single-flight два
  // одновременных запроса авторизации видели один аккаунт сначала новым, затем
  // существующим; второй ответ закрывал только что открытый onboarding.
  const authInFlight = useRef(false);
  const [toast, setToast] = useState<string | null>(null);
  const { fetchNotifications, clear: clearNotifications } = useNotifications();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const p = await profileApi.get();
      // Пока баланс «на удержании» (крутится монета в дуэли) цифры не меняем:
      // сервер двигает деньги до броска, и обновлённый баланс выдавал исход.
      // Всё остальное (ник, настройки, лимиты) берём свежее.
      setUser(prev => (prev && isBalanceHeld())
        ? { ...p, balance: prev.balance, frozen_balance: prev.frozen_balance, available: prev.available }
        : p);
    } catch {
      setUser(null);
      setToken(null);
      clearStoredToken();
    }
  }, []);

  // Баланс отпущен (досмотрели дуэль или сработала страховка по времени) —
  // подтягиваем профиль: пока цифры держались, сокет-события пропускались.
  useEffect(() => onBalanceReleased(() => { refreshUser(); }), [refreshUser]);

  // Возврат в приложение с действующим токеном: приветствие уже не показываем.
  // Прежняя версия его и не показывала — экран висел роутом-«звёздочкой», а в
  // React Router конкретный путь (`/`) всегда выше рангом, чем `*`.
  useEffect(() => {
    if (getStoredToken() && !getOnboardingDone()) {
      persistOnboardingDone(true);
      setOnboardingDoneState(true);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      // Выход (или токен ещё не получен): рвём соединение, иначе сокет остаётся
      // в комнате прежнего пользователя, и события чужого аккаунта приходят в
      // эту вкладку.
      disconnectSocket();
      setLoading(false);
      return;
    }

    let alive = true;
    // Сокет создаём сразу, до refreshUser: подписки начинают работать раньше,
    // а getSocket сам переподключится с новым токеном, если токен изменился.
    const sock = getSocket(token);

    const onNotification = (data: any) => {
      // Результат дуэли показывает DuelResultModal (очередь с кнопками
      // «реплей» / «закрыть»). Тост поверх него жил 3.5 с и терялся —
      // именно так уведомление о дуэли и проглядели.
      // Подделывать уведомление на клиенте (id: Date.now()) нельзя: такой id
      // не существует в БД, и «отметить прочитанным» по нему не сработает.
      if (data?.type !== 'duel_result') {
        showToast(data.message);
      } else {
        // Соперник принял вызов: деньги сервер уже двинул, а броска ещё не было.
        // Держим баланс до показа результата — иначе исход виден на главной.
        holdBalance();
      }
      refreshUser();
      fetchNotifications();
      emitNotificationEvent(data || {});
    };

    // События сейфа пересылаем подписчикам (Safe/SafeCrack) без перезагрузки
    // страницы: reload обрывал мини-игру взлома и ронял socket-соединение.
    // Broadcast обновляет экран игры, а персональные ненавязчивые сообщения
    // приходят через persisted `notification` и учитывают настройку notif_safe.
    const onSafeCrackStarted = (data: any) => emitSafeEvent('safe_crack_started', data);
    const onSafeFinished = (data: any) => emitSafeEvent('safe_finished', data);
    const onSafeCancelled = (data: any) => emitSafeEvent('safe_cancelled', data);
    const onSafeCreated = (data: any) => emitSafeEvent('safe_created', data);
    const onSafeDeposit = (data: any) => emitSafeEvent('safe_deposit', data);

    // Новый баланс приходит сразу после любой операции с деньгами —
    // цифра на экране перестаёт «отставать» от сервера
    const onBalanceUpdated = (data: any) => {
      // Баланс на удержании (идёт анимация дуэли) — цифры не трогаем: после
      // показа результата отпускание само подтянет свежий профиль
      if (isBalanceHeld()) return;
      if (data?.balance == null) return;
      setUser(u => u ? {
        ...u,
        balance: Number(data.balance),
        frozen_balance: data.frozen_balance != null ? Number(data.frozen_balance) : u.frozen_balance,
        available: Number(data.balance) - (data.frozen_balance != null ? Number(data.frozen_balance) : u.frozen_balance),
        // «Где деньги» приходит в том же событии, чтобы пояснение к балансу
        // (вклад в сейф, вклад VAULT) не отставало от цифр
        safe_locked: data.safe_locked != null ? Number(data.safe_locked) : u.safe_locked,
        vault_locked: data.vault_locked != null ? Number(data.vault_locked) : u.vault_locked
      } : u);
    };

    sock.on('notification', onNotification);
    sock.on('safe_crack_started', onSafeCrackStarted);
    sock.on('safe_finished', onSafeFinished);
    sock.on('safe_cancelled', onSafeCancelled);
    sock.on('safe_created', onSafeCreated);
    sock.on('safe_deposit', onSafeDeposit);
    sock.on('balance_updated', onBalanceUpdated);

    (async () => {
      try {
        await refreshUser();
      } finally {
        if (alive) setLoading(false);
      }
    })();

    // Опрос уведомлений здесь не нужен: NotificationsModal обновляет список сам.
    // Сокет общий на всё приложение (бейдж летящей ракеты, экран ракеты,
    // редиректор взлома подписаны на тот же объект) — снимаем ТОЛЬКО свои
    // слушатели. Разрыв соединения бывает при выходе (выше) и при
    // размонтировании App (отдельный эффект).
    return () => {
      alive = false;
      sock.off('notification', onNotification);
      sock.off('safe_crack_started', onSafeCrackStarted);
      sock.off('safe_finished', onSafeFinished);
      sock.off('safe_cancelled', onSafeCancelled);
      sock.off('safe_created', onSafeCreated);
      sock.off('safe_deposit', onSafeDeposit);
      sock.off('balance_updated', onBalanceUpdated);
    };
  }, [token, refreshUser, showToast, fetchNotifications]);

  // Размонтирование приложения — рвём соединение один раз
  useEffect(() => () => disconnectSocket(), []);

  useEffect(() => {
    // Telegram WebApp init
    try {
      WebApp.ready();
      WebApp.expand();
      WebApp.setHeaderColor('#0a0a1a');
      WebApp.setBackgroundColor('#0a0a1a');
    } catch {}
  }, []);

  // Авто-вход по Telegram initData или демо
  useEffect(() => {
    if (token || loading || authInFlight.current) return;
    // Публичный replay не создаёт скрытый demo-аккаунт и не требует входа.
    if (window.location.pathname.startsWith('/replay/')) return;
    authInFlight.current = true;
    (async () => {
      try {
        const tg = (window as any).Telegram?.WebApp;
        const initData = tg?.initData;
        const urlParams = new URLSearchParams(window.location.search);
        const ref = urlParams.get('ref') || undefined;

        let res;
        if (initData && initData.length > 0) {
          res = await authApi.telegram(initData, ref);
        } else {
          // Демо-логин для браузера
          const demoId = parseInt(getDemoId() || String(Math.floor(Math.random() * 100000) + 1));
          setDemoId(String(demoId));
          res = await authApi.demoLogin(demoId, 'demo' + demoId, ref);
        }
        setStoredToken(res.token);
        setToken(res.token);
        setUser(res.user);
        if (res.isNew) {
          persistOnboardingDone(false);
          setOnboardingDoneState(false);
          setShowOnboarding(true);
        } else {
          // Существующий аккаунт: онбординг либо пройден, либо не показывался
          // прежней версией — не выбрасываем игрока в приветствие
          persistOnboardingDone(true);
          setOnboardingDoneState(true);
          setShowOnboarding(false);
        }
      } catch (e: any) {
        showToast('Ошибка входа: ' + e.message);
      } finally {
        authInFlight.current = false;
      }
    })();
  }, [token, loading, showToast]);

  const logout = () => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    clearNotifications();
    releaseBalance();
    setShowOnboarding(false);
    disconnectSocket();
  };

  const setOnboardingDone = () => {
    persistOnboardingDone(true);
    setOnboardingDoneState(true);
    setShowOnboarding(false);
  };

  if (loading) {
    return <div className="app"><div className="container text-center" style={{paddingTop: '50vh'}}>Загрузка VAULT...</div></div>;
  }

  const onboardingActive = showOnboarding && !onboardingDone;

  return (
    <AuthContext.Provider value={{
      user, token, loading, onboardingDone,
      login: async () => {},
      demoLogin: async () => {},
      logout, refreshUser, setOnboardingDone,
      showToast, toast
    }}>
      <BrowserRouter>
        <div className="app">
          {toast && <div className="toast">{toast}</div>}
          {/* Очередь результатов дуэлей: модальное окно из непрочитанных
              уведомлений в БД, переживает перезапуск приложения. От онбординга
              не зависит: флаг приветствия прежняя версия не выставляла никогда,
              а результат дуэли обязан доходить до игрока всегда. */}
          {token && !onboardingActive && <DuelResultModal />}
          {token && !onboardingActive && <NotificationsModal />}
          {/* Пока приветствие открыто, игровые редиректы, модальные окна и
              фоновые UI-контроллеры не монтируются и не могут сменить маршрут. */}
          {onboardingActive && (
            <div style={{position:'fixed', inset:0, zIndex:3000, background:'#0a0a1a', overflowY:'auto'}}>
              <div className="container"><Onboarding /></div>
            </div>
          )}
          {/* Уводит игрока во взлом сейфа с любого экрана и держит летящую
              ракету доступной для кэшаута, пока он не на /rocket. От онбординга
              не зависят: у нового игрока просто нет вклада в сейфе, и проверка
              состояния отрабатывает вхолостую */}
          {token && !onboardingActive && <SafeCrackRedirector />}
          {token && !onboardingActive && <RocketFlightBadge />}
          <div className="container">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/deposit" element={<Deposit />} />
              <Route path="/withdraw" element={<Withdraw />} />
              <Route path="/rocket" element={<Rocket />} />
              <Route path="/duel" element={<Duel />} />
              <Route path="/duel/:id" element={<DuelGame />} />
              <Route path="/safe" element={<Safe />} />
              <Route path="/safe/crack" element={<SafeCrack />} />
              <Route path="/vault" element={<VaultDeposit />} />
              <Route path="/referral" element={<Referral />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/admin" element={<AdminPanel />} />
              <Route path="/set-pin" element={<SetPin />} />
              <Route path="/replay/:game/:id" element={<Replay />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
