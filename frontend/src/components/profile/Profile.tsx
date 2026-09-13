import { useEffect, useState } from 'react';
import MoneyBreakdown from '../common/MoneyBreakdown';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import { profileApi } from '../../api/client';
import { useAuth } from '../../stores/auth';

export default function Profile() {
  const { user, refreshUser, showToast, logout } = useAuth();
  const nav = useNavigate();
  const [txs, setTxs] = useState<any[]>([]);
  const [autoSafe, setAutoSafe] = useState(0);
  const [showAdminLink, setShowAdminLink] = useState(false);

  useEffect(() => {
    if (user) {
      setAutoSafe(user.auto_safe_percent || 0);
    }
    profileApi.transactions(50).then(setTxs).catch(() => {});
    // В демо все пользователи видят админ-ссылку (по желанию убрать в проде)
    setShowAdminLink(true);
  }, [user]);

  const saveAutoSafe = async (v: number) => {
    setAutoSafe(v);
    await profileApi.update({ auto_safe_percent: v });
    refreshUser();
  };

  return (
    <>
      <Header title="⚙️ Профиль" />

      <div className="card text-center">
        <div style={{fontSize:48}}>👤</div>
        <div style={{fontSize:22, fontWeight:900}}>{user?.username}</div>
        <div className="text-dim">ID: {user?.id} · TG: {user?.telegram_id}</div>
      </div>

      <div className="card">
        <div className="card-title">💰 Баланс</div>
        <div style={{fontSize:28, fontWeight:900, color:'#ffd700'}}>${user?.balance.toFixed(2)}</div>
        <div className="text-dim" style={{fontSize:13}}>
          доступно: <span style={{color:'#fff', fontWeight:700}}>
            ${((user?.balance || 0) - (user?.frozen_balance || 0)).toFixed(2)}
          </span>
        </div>
        {/* Куда делись деньги: заморозка дуэлей, вклад в сейф, вклад VAULT */}
        <MoneyBreakdown detailed />
        <div className="btn-row">
          <Link to="/deposit" className="btn btn-secondary">📥 Пополнить</Link>
          <Link to="/withdraw" className="btn btn-secondary">📤 Вывести</Link>
        </div>
      </div>

      <div className="card">
        <div className="card-title">🔒 Безопасность</div>
        <div className="history-item">
          <span>PIN-код вывода</span>
          <Link to="/set-pin" className="btn btn-small">
            {user?.pin_set ? 'ИЗМЕНИТЬ' : 'УСТАНОВИТЬ'}
          </Link>
        </div>
        <div className="history-item">
          <span>Кошёлек вывода</span>
          <span className="text-dim" style={{maxWidth:'50%', overflow:'hidden', textOverflow:'ellipsis', fontSize:12}}>
            {user?.withdraw_address || 'не установлен'}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">🔒 Автовклад в Сейф</div>
        <div className="text-dim" style={{marginBottom:12, fontSize:14}}>
          Автоматически откладывать процент от выигрышей в Сейф
        </div>
        <div className="bet-chips">
          {[0, 10, 25, 50, 100].map(p => (
            <div key={p} className="chip" onClick={() => saveAutoSafe(p)} style={{background: autoSafe === p ? '#ffd700' : '', color: autoSafe === p ? '#000' : ''}}>
              {p === 0 ? 'ВЫКЛ' : `${p}%`}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">🔔 Уведомления</div>
        <div className="text-dim" style={{fontSize:14}}>Настроить можно в настройках Telegram-бота</div>
      </div>

      <div className="game-grid">
        <Link to="/referral" className="game-tile">
          <div className="game-icon" style={{fontSize:36}}>👥</div>
          <div className="game-name" style={{fontSize:14}}>Рефералы</div>
        </Link>
        {showAdminLink && (
          <Link to="/admin" className="game-tile">
            <div className="game-icon" style={{fontSize:36}}>🔧</div>
            <div className="game-name" style={{fontSize:14}}>Админка</div>
          </Link>
        )}
      </div>

      <div className="card">
        <div className="card-title">📋 История транзакций</div>
        {txs.length === 0 && <div className="text-dim text-center">Нет транзакций</div>}
        <div className="scroll-list" style={{maxHeight:320, overflowY:'auto'}}>
          {txs.slice(0, 30).map((t: any) => (
            <div key={t.id} className="history-item" style={{fontSize:13}}>
              <div>
                <div style={{fontSize:14}}>{t.description || t.type}</div>
                <div className="text-dim" style={{fontSize:11}}>{new Date(t.created_at).toLocaleString('ru-RU', {timeZone:'Europe/Moscow'})}</div>
              </div>
              <div className={t.amount > 0 ? 'text-green' : 'text-red'} style={{fontWeight:700}}>
                {t.amount > 0 ? '+' : ''}{t.amount.toFixed(2)}$
              </div>
            </div>
          ))}
        </div>
      </div>

      <button className="btn btn-secondary" onClick={() => { logout(); nav('/'); }}>
        🚪 Выйти (сбросить демо)
      </button>

      {/* Метка сборки: если после деплоя здесь старая дата — браузер показывает
          закешированный бандл, и проверять нужно не код, а обновление страницы */}
      <div className="text-dim text-center" style={{ fontSize: 11, margin: '10px 0 4px' }}>
        сборка фронтенда: {typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__ : 'dev'}
      </div>
    </>
  );
}
