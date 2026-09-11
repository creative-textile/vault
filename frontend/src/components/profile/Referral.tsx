import { useEffect, useState } from 'react';
import Header from '../layout/Header';
import { referralApi } from '../../api/client';
import { useAuth } from '../../stores/auth';

export default function Referral() {
  const { user, showToast } = useAuth();
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    referralApi.stats().then(setStats).catch(() => {});
  }, []);

  // В демо-режиме генерируем ссылку вида http://localhost:3000/?ref=CODE для теста
  const isDemo = !!(window as any).Telegram?.WebApp?.initData?.startsWith?.('demo:')
                 || !/Telegram/i.test(navigator.userAgent)
                 || (window as any).location.hostname === 'localhost';
  const shareLink = isDemo && stats?.ref_code
    ? `${window.location.origin}/?ref=${stats.ref_code}`
    : stats?.link;

  const copy = () => {
    if (shareLink) {
      navigator.clipboard?.writeText(shareLink);
      showToast('Ссылка скопирована');
    }
  };

  const share = () => {
    if (navigator.share && shareLink) {
      navigator.share({ title: 'VAULT — зарабатывай в играх', url: shareLink });
    } else {
      copy();
    }
  };

  return (
    <>
      <Header title="👥 Рефералы" />

      <div className="card card-hl text-center">
        <div className="card-title">Ваша ссылка</div>
        <div style={{
          background:'#0a0a1a',
          padding:14,
          borderRadius:12,
          fontFamily:'monospace',
          fontSize:15,
          wordBreak:'break-all',
          margin:'12px 0'
        }}>{shareLink || 'Загрузка...'}</div>
        {isDemo && <div className="text-dim text-center" style={{fontSize:12, marginBottom:8}}>
          🧪 Демо-режим: откройте ссылку в новой вкладке/браузере — получите бонус 3%
        </div>}
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={copy}>📋 Копировать</button>
          <button className="btn" onClick={share}>📤 Отправить</button>
        </div>
      </div>

      <div className="card">
        <div style={{fontSize:15}}>
          Вы получаете <span className="text-accent" style={{fontWeight:900}}>3%</span> от каждой ставки приглашённого друга.
          <br/><span className="text-dim">Мгновенно на баланс. Навсегда.</span>
        </div>
      </div>

      <div className="card">
        <div style={{display:'flex', justifyContent:'space-around'}}>
          <div className="text-center">
            <div className="text-dim" style={{fontSize:12}}>Рефералов</div>
            <div style={{fontSize:32, fontWeight:900, color:'#ffd700'}}>{stats?.total_referrals || 0}</div>
          </div>
          <div className="text-center">
            <div className="text-dim" style={{fontSize:12}}>Заработано</div>
            <div style={{fontSize:32, fontWeight:900, color:'#22c55e'}}>${(stats?.total_earned || 0).toFixed(2)}</div>
          </div>
        </div>
      </div>

      {stats?.referrals?.length > 0 && (
        <div className="card">
          <div className="card-title">Ваши рефералы ({stats.referrals.length})</div>
          <div className="scroll-list" style={{maxHeight:340, overflowY:'auto'}}>
            {stats.referrals.map((r: any, i: number) => (
              <div key={i} className="history-item">
                <div>
                  <div style={{fontWeight:700}}>{r.username}</div>
                  <div className="text-dim" style={{fontSize:12}}>Ставок: ${(r.total_bets || 0).toFixed(2)}</div>
                </div>
                <div className="text-green" style={{fontWeight:700}}>+${(r.earned_from || 0).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-center text-dim" style={{fontSize:12}}>
        Реферальные начисляются только со ставок (Ракета, Дуэль, Сейф).<br/>
        Vault Вклад не учитывается.
      </div>
    </>
  );
}
