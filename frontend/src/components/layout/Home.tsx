import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/auth';
import { onSafeEvent } from '../../utils/socketEvents';
import { vaultApi, safeApi } from '../../api/client';

function fmt(n: number) {
  return n.toFixed(2);
}

function timeToStr(ms: number) {
  if (ms <= 0) return '0:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function Home() {
  const { user, refreshUser } = useAuth();
  const nav = useNavigate();
  const [vaultStatus, setVaultStatus] = useState<any>(null);
  const [safe, setSafe] = useState<any>(null);
  // Сейф, который принимает вклады (во время взлома и после розыгрыша — следующий)
  const [collect, setCollect] = useState<any>(null);
  const [timeToCrack, setTimeToCrack] = useState(0);
  const [collectTimeToCrack, setCollectTimeToCrack] = useState(0);

  const loadSafe = useCallback(() => {
    safeApi.current().then(s => {
      setSafe(s.safe);
      setCollect(s.collecting_safe || s.safe);
      if (s.safe?.crack_at) {
        const d = new Date(s.safe.crack_at).getTime();
        setTimeToCrack(Math.max(0, d - Date.now()));
      } else {
        setTimeToCrack(s.safe?.time_to_crack_ms || 0);
      }
      const cms = s.collecting_safe?.time_to_crack_ms;
      if (cms != null) {
        setCollectTimeToCrack(Math.max(0, cms));
      } else if (s.collecting_safe?.crack_at) {
        setCollectTimeToCrack(Math.max(0, new Date(s.collecting_safe.crack_at).getTime() - Date.now()));
      } else {
        setCollectTimeToCrack(s.safe?.time_to_crack_ms || 0);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    vaultApi.status().then(setVaultStatus).catch(() => {});
    loadSafe();
    // Карточка сейфа обновляется по socket-событиям: старт взлома, итоги, отмена
    const off = onSafeEvent(loadSafe);
    const iv = setInterval(() => {
      setTimeToCrack(t => Math.max(0, t - 1000));
      setCollectTimeToCrack(t => Math.max(0, t - 1000));
    }, 1000);
    // Страховка на случай потерянного socket: банк не должен «застывать»
    const poll = setInterval(loadSafe, 15000);
    const refresh = setInterval(refreshUser, 5000);
    return () => { off(); clearInterval(iv); clearInterval(poll); clearInterval(refresh); };
  }, [refreshUser, loadSafe]);

  if (!user) return null;

  const activeDeposit = vaultStatus?.active_deposit;
  const baseRate = vaultStatus?.pool_info?.yesterday?.base_rate || 2.1;
  const pendingPool = vaultStatus?.pool_info?.pending_pool || 0;
  const available = user.balance - user.frozen_balance;

  return (
    <>
      <div className="topbar">
        <div className="logo">VAULT</div>
        <Link to="/profile" style={{color:'#fff', textDecoration:'none', fontSize:24}}>⚙️</Link>
      </div>

      <div className="balance-block">
        <div className="balance-label">БАЛАНС</div>
        <div className="balance-amount">${fmt(user.balance)}</div>
        <div style={{display:'flex', justifyContent:'center', gap: 16, fontSize: 13}}>
          <span className="text-dim">доступно: <span style={{color:'#fff', fontWeight:700}}>${fmt(available)}</span></span>
          {user.frozen_balance > 0 && (
            <span className="text-dim">заморожено: ${fmt(user.frozen_balance)}</span>
          )}
        </div>
      </div>

      <div className="btn-row">
        <Link to="/deposit" className="btn btn-secondary">📥 Пополнить</Link>
        <Link to="/withdraw" className="btn btn-secondary">📤 Вывести</Link>
      </div>

      {/* Vault Вклад */}
      <div className="vault-card" onClick={() => nav('/vault')} style={{cursor:'pointer'}}>
        {activeDeposit ? (
          <>
            <div style={{display:'flex', justifyContent:'center', alignItems:'center', gap:10}}>
              <div className="card-title" style={{color:'#c084fc', margin:0}}>💎 Вклад АКТИВЕН</div>
              <span className="pill pill-active">×{activeDeposit.multiplier}</span>
            </div>
            <div style={{margin:'8px 0'}}>🔒 ${fmt(activeDeposit.amount)} · {activeDeposit.term_days} дн.</div>
            <div style={{display:'flex', justifyContent:'center', alignItems:'center', gap:12, marginBottom:8}}>
              <span className="text-dim" style={{fontSize:13}}>День {activeDeposit.days_elapsed} из {activeDeposit.term_days}</span>
              <span className="text-accent" style={{fontWeight:900, fontSize:20}}>+${fmt(activeDeposit.accumulated_profit)}</span>
            </div>
            <div className="progress" style={{width:'100%'}}>
              <div className="progress-fill" style={{width: `${(activeDeposit.days_elapsed / activeDeposit.term_days) * 100}%`}} />
            </div>
          </>
        ) : (
          <>
            <div className="card-title" style={{color:'#c084fc', marginBottom:4}}>💎 Vault Вклад</div>
            <div style={{fontSize:13}}>1–30 дней · до ×2.0 доли прибыли</div>
            <div style={{fontSize:15, fontWeight:900, color:'#ffd700', margin:'4px 0'}}>
              Пул сегодня: ${pendingPool.toFixed(2)}
            </div>
            <div className="text-dim" style={{fontSize:12}}>Вчера: {baseRate.toFixed(1)}% · макс. вклад ${vaultStatus?.pool_info?.max_deposit || 100}</div>
            <div style={{marginTop:10}}><button className="btn btn-small" style={{background:'#c084fc', color:'#fff'}}>ОТКРЫТЬ ВКЛАД</button></div>
          </>
        )}
      </div>

      {/* Игры */}
      <div className="game-grid">
        <Link to="/rocket" className="game-tile">
          <div className="game-icon">🚀</div>
          <div className="game-name">Ракета</div>
          <div className="text-dim" style={{fontSize:11, marginTop:4}}>мин. $1 · до ×90</div>
        </Link>
        <Link to="/duel" className="game-tile">
          <div className="game-icon">⚔️</div>
          <div className="game-name">Дуэль</div>
          <div className="text-dim" style={{fontSize:11, marginTop:4}}>мин. $1 · PvP 50/50</div>
        </Link>
      </div>

      {/* Сейф */}
      <div className="card" onClick={() => nav('/safe')} style={{cursor:'pointer'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div className="card-title">🔒 Сейф</div>
          <span className={`pill ${safe?.status === 'cracking' ? 'pill-active' : safe?.status === 'collecting' ? 'pill-active' : ''}`}>
            {safe?.status === 'collecting' ? 'открыт' : safe?.status === 'cracking' ? '🔥 ВЗЛОМ' : safe?.status === 'finished' ? 'взломан' : '—'}
          </span>
        </div>

        {safe?.status === 'cracking' && (
          <div className="text-red text-center" style={{fontSize:22, fontWeight:900, padding:'12px 0'}}>
            🔥 ИДЁТ ВЗЛОМ СЕЙФА #{safe.id}!
          </div>
        )}
        {safe?.status === 'finished' && (
          <>
            <div className="text-green text-center" style={{fontSize:18, fontWeight:900, padding:'8px 0'}}>
              ✅ СЕЙФ #{safe.id} ВЗЛОМАН
            </div>
            <div className="text-dim text-center" style={{fontSize:13}}>
              Банк: ${fmt(safe.bank)} · Победителей: {safe.winners_count}
            </div>
          </>
        )}
        {!safe && <div className="text-dim" style={{fontSize:13}}>Создаём сейф...</div>}

        {/* Банк и отсчёт — всегда по сейфу, который принимает вклады прямо сейчас:
            во время взлома и после розыгрыша это уже сейф следующего дня */}
        {collect?.status === 'collecting' && (
          <>
            <div style={{display:'flex', gap:16, justifyContent:'space-between', alignItems:'center', fontSize:16, margin:'8px 0'}}>
              <div>💰 <span className="text-accent" style={{fontWeight:900}}>${fmt(collect.bank)}</span></div>
              <div>👥 {collect.participants_count}</div>
              <div className="timer" style={{fontSize:18}}>
                ⏰ {timeToStr(collect.id === safe?.id ? timeToCrack : collectTimeToCrack)}
              </div>
            </div>
            <div className="text-dim" style={{marginTop:8, fontSize:13}}>
              {collect.id !== safe?.id ? `СЕЙФ #${collect.id} · сбор открыт · ` : ''}Приз: ×1.5 · мин. $1
            </div>
          </>
        )}
        <button className="btn mt" style={{padding:'14px', fontSize:16}}>
          {collect?.status === 'collecting'
            ? (collect.id !== safe?.id ? `💰 ВНЕСТИ В СЕЙФ #${collect.id}` : '💰 ВНЕСТИ')
            : '🔥 УЧАСТВОВАТЬ'}
        </button>
      </div>

      {/* Нижнее меню */}
      <div className="game-grid">
        <Link to="/referral" className="game-tile" style={{padding: '12px'}}>
          <div className="game-icon" style={{fontSize:32}}>👥</div>
          <div className="game-name" style={{fontSize:14}}>Рефералы</div>
        </Link>
        <Link to="/profile" className="game-tile" style={{padding: '12px'}}>
          <div className="game-icon" style={{fontSize:32}}>📊</div>
          <div className="game-name" style={{fontSize:14}}>Профиль</div>
        </Link>
      </div>

      <div className="text-center text-dim mt" style={{fontSize:11, paddingBottom: 8}}>
        Комиссия игр 10% · Вывод 1% · USDT TON
      </div>
    </>
  );
}
