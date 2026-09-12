import { useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WebApp from '@twa-dev/sdk';
import { AuthContext, User } from './stores/auth';
import { authApi, profileApi } from './api/client';
import { getSocket, disconnectSocket } from './api/socket';
import { useNotifications } from './stores/notifications';
import { emitSafeEvent, emitNotificationEvent } from './utils/socketEvents';

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
import PendingDuelModal from './components/common/PendingDuelModal';
import NotificationsModal from './components/common/NotificationsModal';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('vault_token'));
  const [loading, setLoading] = useState(true);
  const [onboardingDone, setOnboardingDoneState] = useState(
    localStorage.getItem('onboarding_done') === '1'
  );
  const [toast, setToast] = useState<string | null>(null);
  const { fetchNotifications, clear: clearNotifications } = useNotifications();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const p = await profileApi.get();
      setUser(p);
    } catch {
      setUser(null);
      setToken(null);
      localStorage.removeItem('vault_token');
    }
  }, []);

  useEffect(() => {
    let sock: any = null;

    (async () => {
      try {
        if (token) {
          await refreshUser();
          sock = getSocket(token);

          // Уведомление из сокета — тост + перечитывание списка с сервера.
          // Подделывать уведомление на клиенте (id: Date.now()) нельзя: такой id
          // не существует в БД, и «отметить прочитанным» по нему не сработает.
          sock.on('notification', (data: any) => {
            showToast(data.message);
            refreshUser();
            fetchNotifications();
            emitNotificationEvent(data || {});
          });

          // События сейфа пересылаем подписчикам (Safe/SafeCrack) без перезагрузки
          // страницы: reload обрывал мини-игру взлома и ронял socket-соединение.
          sock.on('safe_crack_started', (data: any) => {
            showToast('🔓 Начался взлом сейфа!');
            emitSafeEvent('safe_crack_started', data);
          });
          sock.on('safe_finished', (data: any) => {
            showToast('🏆 Сейф разыгран — итоги готовы');
            emitSafeEvent('safe_finished', data);
          });
          sock.on('safe_cancelled', (data: any) => emitSafeEvent('safe_cancelled', data));
          sock.on('safe_created', (data: any) => emitSafeEvent('safe_created', data));
          // Новый баланс приходит сразу после любой операции с деньгами —
          // цифра на экране перестаёт «отставать» от сервера
          sock.on('balance_updated', (data: any) => {
            if (data?.balance == null) return;
            setUser(u => u ? {
              ...u,
              balance: Number(data.balance),
              frozen_balance: data.frozen_balance != null ? Number(data.frozen_balance) : u.frozen_balance,
              available: Number(data.balance) - (data.frozen_balance != null ? Number(data.frozen_balance) : u.frozen_balance)
            } : u);
          });

          // Вклад/возврат вклада: банк в карточках обновляется у всех сразу,
          // без перезагрузки страницы (тост не показываем — был бы спам)
          sock.on('safe_deposit', (data: any) => emitSafeEvent('safe_deposit', data));
        }
      } finally {
        setLoading(false);
      }
    })();

    // Опрос уведомлений здесь не нужен: NotificationsModal обновляет список сам.
    return () => {
      disconnectSocket();
    };
  }, [token, refreshUser, showToast, fetchNotifications]);

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
    if (token || loading) return;
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
          const demoId = parseInt(localStorage.getItem('demo_id') || String(Math.floor(Math.random() * 100000) + 1));
          localStorage.setItem('demo_id', String(demoId));
          res = await authApi.demoLogin(demoId, 'demo' + demoId, ref);
        }
        localStorage.setItem('vault_token', res.token);
        setToken(res.token);
        setUser(res.user);
        if (res.isNew) {
          localStorage.removeItem('onboarding_done');
          setOnboardingDoneState(false);
        }
      } catch (e: any) {
        showToast('Ошибка входа: ' + e.message);
      }
    })();
  }, [token, loading, showToast]);

  const logout = () => {
    localStorage.removeItem('vault_token');
    setToken(null);
    setUser(null);
    clearNotifications();
    disconnectSocket();
  };

  const setOnboardingDone = () => {
    localStorage.setItem('onboarding_done', '1');
    setOnboardingDoneState(true);
  };

  if (loading) {
    return <div className="app"><div className="container text-center" style={{paddingTop: '50vh'}}>Загрузка VAULT...</div></div>;
  }

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
          {onboardingDone && <PendingDuelModal />}
          {onboardingDone && <NotificationsModal />}
          <div className="container">
            <Routes>
              {!onboardingDone && <Route path="*" element={<Onboarding />} />}
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
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
