import { useEffect, useState, useCallback } from 'react';
import MoneyBreakdown from '../common/MoneyBreakdown';
import AmountChips from '../common/AmountChips';
import { holdBalance, releaseBalance } from '../../utils/balanceHold';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import Icon from '../ui/Icon';
import { formatAmount } from '../../utils/betChips';
import { useAmountField } from '../../utils/useAmountField';
import DuelScene from '../../three/duel/DuelScene';
import { duelApi, publicConfig } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { sfx } from '../../audio';
import { setDuelAccepting } from '../../utils/duelTransition';

interface LobbyItem {
  id: number;
  creator_name: string;
  amount: number;
  created_at: string;
  is_mine: boolean;
  target_user_id?: number;
  parent_duel_id?: number;
}


export default function Duel() {
  const { user, refreshUser, showToast } = useAuth();
  const nav = useNavigate();
  const [lobby, setLobby] = useState<LobbyItem[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [minBet, setMinBet] = useState(1);
  // Ставка по умолчанию считается от доступного баланса: прежние $25 стояли и
  // у игрока с $3 (невозможная ставка), и у игрока с $10 000 (мелочь). Если
  // $25 по карману — остаются $25, иначе средний номинал кнопок ниже.
  const available = Number(user?.available ?? ((user?.balance || 0) - (user?.frozen_balance || 0))) || 0;
  const [amount, setAmount] = useAmountField({ available, min: minBet, preferred: 25 });
  const [creating, setCreating] = useState(false);
  /** Какая доля банка достаётся победителю (100 − комиссия игр). */
  const [winnerShare, setWinnerShare] = useState(90);

  useEffect(() => {
    publicConfig().then(c => {
      setMinBet(c.min_bet || 1);
      // Доля победителя зависит от комиссии игр в настройках: подпись «90%»
      // расходилась с реальностью, как только админ менял комиссию
      const fee = Number(c?.commission_percent);
      if (Number.isFinite(fee) && fee >= 0 && fee < 100) setWinnerShare(100 - fee);
    }).catch(()=>{});
  }, []);

  const load = useCallback(async () => {
    try {
      const [lob, hist] = await Promise.all([duelApi.lobby(), duelApi.history()]);
      setLobby(lob.filter((l:any)=>!l.target_user_id || l.target_user_id===user?.id || l.creator_id===user?.id)
        .map((l: any) => ({...l, is_mine: l.creator_id === user?.id})));
      setHistory(hist);
      // Завершённую дуэль лобби больше не открывает сам: результат приходит
      // модальным окном из очереди уведомлений (DuelResultModal), и игрок сам
      // решает — смотреть реплей или закрыть. Раньше этот автопереход уводил
      // из лобби каждые 3 с и спорил с модалкой.
    } catch {}
  }, [user?.id, nav]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [load]);

  const create = async () => {
    const a = parseFloat(amount);
    if (!a || a < minBet) { sfx.error(); return showToast(`Мин. ставка $${minBet}`); }
    setCreating(true);
    try {
      await duelApi.create(a);
      // Вызов брошен: фишка на стол и скрещивание клинков
      sfx.betPlace();
      sfx.sword();
      showToast('Вызов создан — ждите соперника');
      await refreshUser();
      load();
    } catch (e: any) {
      showToast(e.message);
    }
    setCreating(false);
  };

  const accept = async (id: number) => {
    // Сервер списывает ставку и резервирует приз в момент принятия вызова —
    // до броска монеты. Без удержания баланс в лобби и в шапке успевал
    // измениться на глазах: цифра выдавала исход раньше анимации.
    holdBalance();
    setDuelAccepting(true);
    try {
      const result = await duelApi.accept(id);
      sfx.sword();
      // Ответ уже самодостаточен: переходим к броску сразу. Ожидание profile GET
      // оставляло лобби видимым и успевало на мгновение показать result modal.
      nav(`/duel/${id}`, { state: { result: { ...result, id } }, replace: true });
      refreshUser().catch(()=>{});
      // DuelGame route itself blocks the modal; transition lock is no longer needed.
      setDuelAccepting(false);
    } catch (e: any) {
      setDuelAccepting(false);
      releaseBalance();
      await refreshUser();
      showToast(e.message);
    }
  };

  const cancel = async (id: number) => {
    try {
      await duelApi.cancel(id);
      sfx.tapSoft();
      await refreshUser();
      showToast('Вызов отменён');
      load();
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const decline = async(id:number) => {
    try { await duelApi.decline(id); sfx.tapSoft(); showToast('Реванш отклонён'); load(); }
    catch(e:any) { showToast(e.message); }
  };

  function timeAgo(iso: string) {
    const diff = (Date.now() - new Date(iso).getTime()) / 60000;
    if (diff < 1) return 'только что';
    if (diff < 60) return `${Math.floor(diff)}м`;
    return `${Math.floor(diff/60)}ч`;
  }

  // Ставка в дуэли делается из доступных денег (баланс минус уже висящие вызовы)

  return (
    <>
      <Header title="Дуэль" icon="swords" />
      <DuelScene phase="idle" />

      <div className="avail-line">
        {/* Вызов создаётся из «доступно»: баланс при уже висящих вызовах
            обещал больше, чем можно поставить */}
        <span className="avail-line__label"><Icon name="wallet" size={14} /> Доступно</span>
        <span className="avail-line__value">${formatAmount(available)}</span>
      </div>
      <MoneyBreakdown />

      <div className="card">
        <div className="card-title"><Icon name="swords" size={16} /> Создать вызов</div>
        <input
          type="number" className="input input--amount" value={amount} inputMode="decimal"
          onChange={e => setAmount(e.target.value)} min={minBet}
        />
        {/* Номиналы считаются от доступного баланса, а не из фиксированного
            списка: у игрока с $12 больше нет кнопки «$500» */}
        <AmountChips available={available} value={amount} onChange={setAmount} min={minBet} />
        <div className="duel-terms">
          <span className="duel-terms__item">
            <Icon name="trophy" size={13} strokeWidth={2.1} />
            победитель забирает {winnerShare}% банка
          </span>
          <span className="duel-terms__item">мин. ${formatAmount(minBet)}</span>
        </div>
        <button className="btn mt" onClick={create} disabled={creating}>
          <Icon name="swords" size={17} strokeWidth={2} /> Создать вызов
        </button>
      </div>

      <div className="card">
        <div className="card-title"><Icon name="list" size={16} /> Открытые вызовы</div>
        {lobby.length === 0 && <div className="text-dim text-center" style={{padding:20}}>Пока нет вызовов — создайте первый!</div>}
        <div className="scroll-list" style={{maxHeight:280, overflowY:'auto'}}>
          {lobby.map(l => (
            <div key={l.id} className="lobby-item">
              <div>
                <div style={{fontWeight:700}} className="lobby-item__name">
                  {l.is_mine
                    ? <><span className="live-dot" /> Ваш вызов</>
                    : l.parent_duel_id
                      ? <><Icon name="refresh" size={13} strokeWidth={2.1} /> Реванш от {l.creator_name}</>
                      : l.creator_name}
                </div>
                <div className="text-dim" style={{fontSize:12}}>{timeAgo(l.created_at)} назад</div>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <div className="text-accent" style={{fontWeight:900, fontSize:18}}>${l.amount.toFixed(0)}</div>
                {l.is_mine ? (
                  <button className="btn btn-small btn-danger" onClick={() => cancel(l.id)} aria-label="Отменить вызов"><Icon name="close" size={14} strokeWidth={2.4} /></button>
                ) : (
                  <>
                    <button className="btn btn-small btn-green" onClick={() => accept(l.id)}>ПРИНЯТЬ</button>
                    {l.parent_duel_id && <button className="btn btn-small btn-danger" onClick={() => decline(l.id)} aria-label="Отклонить реванш"><Icon name="close" size={14} strokeWidth={2.4} /></button>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Icon name="list" size={16} /> Последние дуэли</div>
        <div className="scroll-list" style={{maxHeight:200, overflowY:'auto'}}>
          {history.slice(0, 10).map(h => (
            <div key={h.id} className="history-item" style={{fontSize:13}}>
              <Link className="history-item__replay" state={{replayFrom:'/duel'}} to={`/replay/duel/${h.id}`}><Icon name="replay" size={13} /> {h.creator} vs {h.opponent || '?'}</Link>
              <span>${h.amount.toFixed(0)} · <Icon name="trophy" size={12} className="text-gold" /> {h.winner}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
