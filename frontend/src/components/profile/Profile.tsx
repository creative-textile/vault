import { useEffect, useState } from 'react';
import MoneyBreakdown from '../common/MoneyBreakdown';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import Icon, { type IconName } from '../ui/Icon';
import { dialog } from '../ui/Dialog';
import { profileApi } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { formatAmount } from '../../utils/betChips';
import { sfx } from '../../audio';

export default function Profile() {
  const { user, refreshUser, showToast, logout } = useAuth();
  const nav = useNavigate();
  const [txs, setTxs] = useState<any[]>([]);
  const [autoSafe, setAutoSafe] = useState(0);
  const [showAdminLink, setShowAdminLink] = useState(false);
  const [savingNotif, setSavingNotif] = useState<string | null>(null);

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

  const toggleNotification = async (key: 'notif_duel'|'notif_safe'|'notif_referral'|'notif_vault') => {
    if (!user || savingNotif) return;
    setSavingNotif(key);
    try {
      await profileApi.update({ [key]: !user[key] });
      await refreshUser();
      showToast('Настройки уведомлений сохранены');
    } catch (e:any) { showToast(e.message || 'Не удалось сохранить'); }
    finally { setSavingNotif(null); }
  };

  return (
    <>
      <Header title="Профиль" icon="sliders" />

      <div className="card text-center profile-head">
        <div className="profile-head__avatar">
          <Icon name="user" size={30} strokeWidth={1.6} />
        </div>
        <div className="profile-head__name">{user?.username}</div>
        <div className="profile-head__ids">
          <span>ID {user?.id}</span>
          <span className="profile-head__dot" aria-hidden="true" />
          <span>TG {user?.telegram_id}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Icon name="wallet" size={16} /> Баланс</div>
        <div className="profile-balance">${formatAmount(user?.balance || 0)}</div>
        {/* Полная раскладка средств показывается только в профиле */}
        <MoneyBreakdown detailed />
        <div className="btn-row">
          <Link to="/deposit" className="btn btn-secondary" onClick={() => sfx.tap()}>
            <Icon name="deposit" size={16} strokeWidth={2} /> Пополнить
          </Link>
          <Link to="/withdraw" className="btn btn-secondary" onClick={() => sfx.tap()}>
            <Icon name="withdraw" size={16} strokeWidth={2} /> Вывести
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Icon name="shield" size={16} /> Безопасность</div>
        <div className="history-item">
          <span>PIN-код вывода</span>
          <Link to="/set-pin" className="btn btn-small">
            <Icon name="key" size={13} strokeWidth={2.2} />
            {user?.pin_set ? 'Изменить' : 'Установить'}
          </Link>
        </div>
        <div className="history-item">
          <span>Кошелёк вывода</span>
          <span className="text-dim" style={{maxWidth:'50%', overflow:'hidden', textOverflow:'ellipsis', fontSize:12}}>
            {user?.withdraw_address || 'не установлен'}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Icon name="lock" size={16} /> Автовклад в Сейф</div>
        <div className="text-dim" style={{marginBottom:12, fontSize:14}}>
          Автоматически откладывать процент от выигрышей в Сейф
        </div>
        <div className="bet-chips">
          {[0, 10, 25, 50, 100].map(p => (
            <button
              key={p} type="button"
              className={`chip${autoSafe === p ? ' chip--on' : ''}`}
              onClick={() => { sfx.chip(); saveAutoSafe(p); }}
            >
              {p === 0 ? 'Выкл' : `${p}%`}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Icon name="bell" size={16} /> Уведомления</div>
        {([
          ['notif_duel','Дуэли','swords'], ['notif_safe','Сейф','lock'],
          ['notif_referral','Рефералы','users'], ['notif_vault','Vault Вклад','gem']
        ] as const).map(([key,label,icon]) => (
          <div className="history-item" key={key}>
            <span className="row-label"><Icon name={icon as IconName} size={15} strokeWidth={1.9} /> {label}</span>
            <button className={`btn btn-small ${user?.[key] ? '' : 'btn-secondary'}`}
              disabled={savingNotif === key} onClick={() => toggleNotification(key)}>
              {user?.[key] ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
          </div>
        ))}
      </div>

      <div className="game-grid">
        <Link to="/referral" className="game-tile tile-ref game-tile--compact">
          <div className="game-icon game-icon--sm"><Icon name="users" size={28} strokeWidth={1.7} /></div>
          <div className="game-name" style={{fontSize:14}}>Рефералы</div>
        </Link>
        {showAdminLink && (
          <Link to="/admin" className="game-tile tile-stats game-tile--compact">
            <div className="game-icon game-icon--sm"><Icon name="wrench" size={28} strokeWidth={1.7} /></div>
            <div className="game-name" style={{fontSize:14}}>Админка</div>
          </Link>
        )}
      </div>

      <div className="card">
        <div className="card-title"><Icon name="list" size={16} /> История транзакций</div>
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

      <button
        className="btn btn-secondary"
        onClick={async () => {
          // Кастомное окно вместо `window.confirm`: выход сбрасывает демо-сессию,
          // и случайный тап по кнопке стоил игроку текущего аккаунта
          const ok = await dialog.confirm({
            title: 'Выйти из аккаунта?',
            message: 'Демо-сессия будет сброшена, и приложение создаст новый аккаунт при следующем входе.',
            confirmText: 'Выйти',
            cancelText: 'Остаться',
            tone: 'danger',
            icon: 'logout'
          });
          if (!ok) return;
          logout();
          nav('/');
        }}
      >
        <Icon name="logout" size={16} strokeWidth={2} /> Выйти (сбросить демо)
      </button>

    </>
  );
}
