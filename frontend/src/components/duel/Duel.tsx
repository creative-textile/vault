import { useEffect, useState, useCallback } from 'react';
import MoneyBreakdown from '../common/MoneyBreakdown';
import { holdBalance, releaseBalance } from '../../utils/balanceHold';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import DuelScene from '../../three/duel/DuelScene';
import { duelApi, publicConfig } from '../../api/client';
import { useAuth } from '../../stores/auth';

interface LobbyItem {
  id: number;
  creator_name: string;
  amount: number;
  created_at: string;
  is_mine: boolean;
  target_user_id?: number;
  parent_duel_id?: number;
}

const CHIPS_DEFAULTS = [5, 10, 25, 50, 100, 500];

export default function Duel() {
  const { user, refreshUser, showToast } = useAuth();
  const nav = useNavigate();
  const [lobby, setLobby] = useState<LobbyItem[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [amount, setAmount] = useState('25');
  const [creating, setCreating] = useState(false);
  const [minBet, setMinBet] = useState(1);

  useEffect(() => {
    publicConfig().then(c => {
      setMinBet(c.min_bet || 1);
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
    if (!a || a < minBet) return showToast(`Мин. ставка $${minBet}`);
    setCreating(true);
    try {
      await duelApi.create(a);
      showToast('✅ Вызов создан — ждите соперника');
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
    try {
      const result = await duelApi.accept(id);
      await refreshUser();
      nav(`/duel/${id}`, { state: { result: { ...result, id } }, replace: true });
    } catch (e: any) {
      releaseBalance();
      await refreshUser();
      showToast(e.message);
    }
  };

  const cancel = async (id: number) => {
    try {
      await duelApi.cancel(id);
      await refreshUser();
      showToast('Вызов отменён');
      load();
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const decline = async(id:number) => {
    try { await duelApi.decline(id); showToast('Реванш отклонён'); load(); }
    catch(e:any) { showToast(e.message); }
  };

  function timeAgo(iso: string) {
    const diff = (Date.now() - new Date(iso).getTime()) / 60000;
    if (diff < 1) return 'только что';
    if (diff < 60) return `${Math.floor(diff)}м`;
    return `${Math.floor(diff/60)}ч`;
  }

  return (
    <>
      <Header title="⚔️ Дуэль" />
      <DuelScene phase="idle" />

      <div style={{padding:'8px 0', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:14}}>
        {/* Вызов создаётся из «доступно»: баланс при уже висящих вызовах
            обещал больше, чем можно поставить */}
        <span className="text-dim">Доступно:</span>
        <span className="text-accent" style={{fontWeight:700, fontSize:18}}>${((user?.balance || 0) - (user?.frozen_balance || 0)).toFixed(2)}</span>
      </div>
      <MoneyBreakdown />

      <div className="card">
        <div className="card-title">Создать вызов</div>
        <input type="number" className="input" value={amount} onChange={e => setAmount(e.target.value)} min={1} />
        <div className="bet-chips">
          {CHIPS_DEFAULTS.filter(x => x >= minBet).slice(0,6).map(c => (
            <div key={c} className="chip" onClick={() => setAmount(String(c))}>${c}</div>
          ))}
        </div>
        <div className="text-dim text-center" style={{fontSize:13}}>Победитель получает 90% · Мин. ${minBet}</div>
        <button className="btn mt" onClick={create} disabled={creating}>⚔️ СОЗДАТЬ ВЫЗОВ</button>
      </div>

      <div className="card">
        <div className="card-title">⚔️ Открытые вызовы</div>
        {lobby.length === 0 && <div className="text-dim text-center" style={{padding:20}}>Пока нет вызовов — создайте первый!</div>}
        <div className="scroll-list" style={{maxHeight:280, overflowY:'auto'}}>
          {lobby.map(l => (
            <div key={l.id} className="lobby-item">
              <div>
                <div style={{fontWeight:700}}>
                  {l.is_mine ? '🟢 Ваш вызов' : l.parent_duel_id ? `🔁 Реванш от ${l.creator_name}` : l.creator_name}
                </div>
                <div className="text-dim" style={{fontSize:12}}>{timeAgo(l.created_at)} назад</div>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <div className="text-accent" style={{fontWeight:900, fontSize:18}}>${l.amount.toFixed(0)}</div>
                {l.is_mine ? (
                  <button className="btn btn-small btn-danger" onClick={() => cancel(l.id)}>✖</button>
                ) : (
                  <>
                    <button className="btn btn-small btn-green" onClick={() => accept(l.id)}>ПРИНЯТЬ</button>
                    {l.parent_duel_id && <button className="btn btn-small btn-danger" onClick={() => decline(l.id)}>✖</button>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">📜 Последние дуэли</div>
        <div className="scroll-list" style={{maxHeight:200, overflowY:'auto'}}>
          {history.slice(0, 10).map(h => (
            <div key={h.id} className="history-item" style={{fontSize:13}}>
              <Link to={`/replay/duel/${h.id}`}>📼 {h.creator} vs {h.opponent || '?'}</Link>
              <span>${h.amount.toFixed(0)} · 🏆 {h.winner}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
