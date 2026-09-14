import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sfx } from '../../audio';
import { useAuth } from '../../stores/auth';
import { onSafeEvent } from '../../utils/socketEvents';
import { vaultApi, safeApi } from '../../api/client';
import BalancePanel from '../common/BalancePanel';
import PlatformFootnote from '../common/PlatformFootnote';
import Icon from '../ui/Icon';
import { formatAmount } from '../../utils/betChips';

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
  // Свой вклад в сейф, который взламывают прямо сейчас: по нему видно,
  // должен ли игрок оказаться в мини-игре (и почему его туда не уводит)
  const [crackDeposit, setCrackDeposit] = useState<any>(null);
  const [collectTimeToCrack, setCollectTimeToCrack] = useState(0);
  // Дедлайны в ref, тикаем локально — без запросов к серверу каждую секунду
  const collectAtRef = useRef<number | null>(null);
  const crackAtRef = useRef<number | null>(null);

  const loadSafe = useCallback(() => {
    safeApi.current().then(s => {
      setSafe(s.safe);
      setCollect(s.collecting_safe || s.safe);
      setCrackDeposit(s.safe?.status === 'cracking' ? (s.my_deposit ?? null) : null);
      // Отсчёт до взлома — всегда по сейфу, который сейчас собирает
      const cms = s.collecting_safe?.time_to_crack_ms
        ?? (s.safe?.status === 'collecting' ? s.safe?.time_to_crack_ms : null);
      if (cms != null) {
        setCollectTimeToCrack(Math.max(0, cms));
        collectAtRef.current = Date.now() + Math.max(0, cms);
      } else if (s.collecting_safe?.crack_at) {
        const d = Math.max(0, new Date(s.collecting_safe.crack_at).getTime() - Date.now());
        setCollectTimeToCrack(d);
        collectAtRef.current = Date.now() + d;
      }
      // Остаток окна взлома — только когда взлом идёт
      if (s.safe?.status === 'cracking' && s.safe?.crack_remaining_ms != null) {
        setTimeToCrack(Math.max(0, s.safe.crack_remaining_ms));
        crackAtRef.current = Date.now() + s.safe.crack_remaining_ms;
      } else {
        crackAtRef.current = null;
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    vaultApi.status().then(setVaultStatus).catch(() => {});
    loadSafe();
    // Карточка сейфа обновляется по socket-событиям: старт взлома, итоги, отмена
    const off = onSafeEvent(loadSafe);
    const iv = setInterval(() => {
      if (collectAtRef.current) setCollectTimeToCrack(Math.max(0, collectAtRef.current - Date.now()));
      else setCollectTimeToCrack(t => Math.max(0, t - 1000));
      if (crackAtRef.current) setTimeToCrack(Math.max(0, crackAtRef.current - Date.now()));
    }, 1000);
    // Страховка на случай потерянного socket: банк не должен «застывать»
    const poll = setInterval(loadSafe, 20000);
    // Balance changes arrive through Socket.io; slow reconciliation is only a fallback.
    const refresh = setInterval(refreshUser, 30000);
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
        <div className="logo">VAULT<span className="logo-sub">ХРАНИЛИЩЕ</span></div>
        <Link to="/profile" className="topbar__icon-link" onClick={() => sfx.tapSoft()} aria-label="Профиль">
          <Icon name="sliders" size={20} strokeWidth={1.9} />
        </Link>
      </div>

      {/* Один блок денег на всех экранах: сумма, которую можно поставить, и
          пилюли «где ещё лежат средства» (дуэли, сейф, вклад). Прежняя строка
          «❄️ Заморожено: $50.00» под балансом смешивала три разных резерва в
          одну цифру и выглядела как ошибка вёрстки. */}
      <BalancePanel variant="hero" label="Доступно" showTotal />

      <div className="btn-row">
        <Link to="/deposit" className="btn btn-secondary" onClick={() => sfx.tap()}>
          <Icon name="deposit" size={17} strokeWidth={2} /> Пополнить
        </Link>
        <Link to="/withdraw" className="btn btn-secondary" onClick={() => sfx.tap()}>
          <Icon name="withdraw" size={17} strokeWidth={2} /> Вывести
        </Link>
      </div>

      {/* Vault Вклад */}
      <div className="vault-card" onClick={() => { sfx.transition(); nav('/vault'); }} style={{cursor:'pointer'}}>
        {activeDeposit ? (
          <>
            <div style={{display:'flex', justifyContent:'center', alignItems:'center', gap:10}}>
              <div className="card-title vault-tile__title">
                <Icon name="gem" size={17} /> Вклад активен
              </div>
              <span className="pill pill-active">×{activeDeposit.multiplier}</span>
            </div>
            <div className="vault-tile__amount">
              <Icon name="lock" size={13} strokeWidth={2} />
              ${fmt(activeDeposit.amount)} · {activeDeposit.term_days} дн.
            </div>
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
            <div className="card-title vault-tile__title">
              <Icon name="gem" size={17} /> Vault Вклад
            </div>
            {/* Формула вклада одной строкой: срок, доля, откуда доход.
                Прежние «Зарабатывайте с оборота платформы…» и «Тело вклада
                возвращается всегда» не объясняли ничего конкретного. */}
            <div className="vault-tile__lead">
              1–30 дней · доля прибыли до ×2.0 · начисления каждый день в 00:00 МСК
            </div>
            <div className="vault-tile__pool">
              Пул сегодня: <b>${formatAmount(pendingPool)}</b>
            </div>
            <div className="vault-tile__meta">
              <span className="vault-tile__rate">
                <Icon name="chart" size={12} strokeWidth={2.1} /> вчера {baseRate.toFixed(1)}%
              </span>
              <span className="vault-tile__cap">макс. вклад ${formatAmount(vaultStatus?.pool_info?.max_deposit || 100)}</span>
            </div>
            <div style={{marginTop:10}}>
              <button className="btn btn-small btn-violet" type="button">
                <Icon name="plus" size={14} strokeWidth={2.4} /> Открыть вклад
              </button>
            </div>
            <div className="vault-tile__note">Сумма вклада возвращается целиком — в срок и досрочно</div>
          </>
        )}
      </div>

      {/* Игры */}
      <div className="game-grid">
        {/* tile-* задаёт --tile-glow/--tile-edge: у каждой игры свой цвет
            свечения, поэтому витрина читается как набор разных залов, а не
            четыре одинаковые кнопки. Бейджи — фактические цифры из правил игр,
            не выдуманные «HOT». */}
        <Link to="/rocket" className="game-tile tile-rocket" onClick={() => sfx.transition()}>
          {/* «до ×90» читалось как служебная пометка: непонятно, что это
              множитель выплаты. Теперь знак × крупный и золотой, а слово «до»
              стоит мелким префиксом — сразу видно потолок выигрыша. */}
          <span className="tile-badge tile-badge--gold">
            <span className="tile-badge__pre">до</span>
            <span className="tile-badge__mult">×90</span>
          </span>
          <div className="game-icon"><Icon name="rocket" size={34} strokeWidth={1.6} /></div>
          <div className="game-name">Ракета</div>
          <div className="game-sub">мин. $1 · забери до взрыва</div>
        </Link>
        <Link to="/duel" className="game-tile tile-duel" onClick={() => sfx.transition()}>
          <span className="tile-badge">
            <span className="tile-badge__pre">PvP</span>
            <span className="tile-badge__mult">50/50</span>
          </span>
          <div className="game-icon"><Icon name="swords" size={34} strokeWidth={1.6} /></div>
          <div className="game-name">Дуэль</div>
          <div className="game-sub">мин. $1 · орёл или решка</div>
        </Link>
      </div>

      {/* Короткий статус; внесение и детали — одно действие на экране Сейфа. */}
      <div className="card" onClick={() => { sfx.transition(); nav('/safe'); }} style={{cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
        <div>
          <b className="safe-line__title"><Icon name="lock" size={14} strokeWidth={2} /> Сейф #{collect?.id || '—'}</b>
          <div className="text-dim" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Пульсирующая точка — взлом идёт прямо сейчас: это действие
                ограничено по времени, и его нельзя пропустить */}
            {safe?.status === 'cracking' && <span className="live-dot" style={{ color: 'var(--red)' }} />}
            {safe?.status==='cracking'
              ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>Взлом · {timeToStr(timeToCrack)}</span>
              : collect?.status==='collecting'
                ? <>{timeToStr(collectTimeToCrack)} · банк ${fmt(collect.bank)}</>
                : <>Подготовка</>}
          </div>
        </div>
        <span className="safe-line__cta">Открыть <Icon name="chevronRight" size={15} strokeWidth={2.2} /></span>
      </div>

      {/* Нижнее меню */}
      <div className="game-grid">
        <Link to="/referral" className="game-tile tile-ref game-tile--compact" onClick={() => sfx.tapSoft()}>
          <div className="game-icon game-icon--sm"><Icon name="users" size={26} strokeWidth={1.8} /></div>
          <div className="game-name" style={{fontSize:14}}>Рефералы</div>
        </Link>
        <Link to="/stats" className="game-tile tile-stats game-tile--compact" onClick={() => sfx.tapSoft()}>
          <div className="game-icon game-icon--sm"><Icon name="chart" size={26} strokeWidth={1.8} /></div>
          <div className="game-name" style={{fontSize:14}}>Статистика</div>
        </Link>
      </div>

      {/* Служебная информация о комиссиях: тонкая полоса без акцента, цифры
          берутся из настроек платформы (админ может их изменить) */}
      <PlatformFootnote />
    </>
  );
}
