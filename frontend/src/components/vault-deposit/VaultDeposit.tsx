import { useEffect, useState } from 'react';
import MoneyBreakdown from '../common/MoneyBreakdown';
import Header from '../layout/Header';
import { vaultApi } from '../../api/client';
import { useAuth } from '../../stores/auth';

const TERMS = [
  { days: 1, mult: 1.0 },
  { days: 7, mult: 1.3 },
  { days: 14, mult: 1.6 },
  { days: 30, mult: 2.0, fire: '🔥' }
];

function fmt(n: number) { return n.toFixed(2); }

export default function VaultDeposit() {
  const { user, refreshUser, showToast } = useAuth();
  const [status, setStatus] = useState<any>(null);
  const [amount, setAmount] = useState('10');
  const [selectedTerm, setSelectedTerm] = useState(30);
  const [history, setHistory] = useState<any[]>([]);

  const load = () => vaultApi.status().then(s => {
    setStatus(s);
    setHistory(s.history || []);
    const mn = s?.pool_info?.min_deposit || 10;
    setAmount(prev => {
      const cur = parseFloat(prev);
      if (!cur || cur < mn) return String(mn);
      return prev;
    });
  });

  useEffect(() => { load(); }, []);

  const active = status?.active_deposit;
  const maxDeposit = status?.pool_info?.max_deposit || 100;
  const minDeposit = status?.pool_info?.min_deposit || 10;
  const baseRate = status?.pool_info?.yesterday?.base_rate || 2.1;

  const forecast = (days: number, mult: number) => {
    const a = parseFloat(amount) || 0;
    // Прогноз: базовая ставка * множитель * дни / 100
    return Math.round(a * (baseRate / 100) * mult * days * 100) / 100;
  };

  const lock = async () => {
    const a = parseFloat(amount);
    if (!a || a < minDeposit) return showToast(`Минимум $${minDeposit}`);
    if (a > maxDeposit) return showToast(`Макс: $${maxDeposit}`);
    try {
      await vaultApi.lock(a, selectedTerm);
      showToast('🔒 Вклад открыт!');
      await refreshUser();
      load();
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const unlock = async () => {
    if (!active) return;
    if (!confirm(`Вернуть $${fmt(active.amount)}? Накопленный доход $${fmt(active.accumulated_profit)} сгорит.`)) return;
    try {
      await vaultApi.earlyUnlock(active.id);
      showToast('💸 Тело вклада возвращено');
      await refreshUser();
      load();
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const unlockDate = active ? new Date(new Date(active.created_at).getTime() + active.term_days * 86400000) : null;

  return (
    <>
      <Header title="💎 Vault Вклад" />
      <div style={{padding:'8px 0', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:14}}>
        <span className="text-dim">Доступно:</span>
        <span className="text-accent" style={{fontWeight:700, fontSize:18}}>${((user?.balance || 0) - (user?.frozen_balance || 0)).toFixed(2)}</span>
      </div>
      {/* Куда делись деньги, которых не хватает для нового вклада */}
      <MoneyBreakdown total={false} />

      {active ? (
        <>
          <div className="card card-hl text-center">
            <div className="card-title" style={{fontSize:20, color:'#a855f7'}}>💎 АКТИВЕН</div>
            <div style={{fontSize:22, fontWeight:900}}>
              🔒 ${fmt(active.amount)} на {active.term_days} дней (×{active.multiplier})
            </div>
            <div className="text-dim">День {active.days_elapsed} из {active.term_days}</div>
          </div>

          <div className="card text-center">
            <div className="balance-label">Накоплено</div>
            <div style={{fontSize:36, fontWeight:900, color:'#ffd700'}}>${fmt(active.accumulated_profit)}</div>
            <div className="progress">
              <div className="progress-fill" style={{width: `${(active.days_elapsed / active.term_days) * 100}%`}} />
            </div>
            <div className="text-dim">{Math.round((active.days_elapsed / active.term_days) * 100)}%</div>
          </div>

          {history.length > 1 && (
            <div className="card">
              <div className="card-title">📋 По дням</div>
              {history.slice(0, 5).map((h: any) => (
                <div key={h.id} className="history-item">
                  <span>День {h.days_elapsed}</span>
                  <span className="text-green">+${fmt(h.accumulated_profit)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="card text-center">
            <div className="text-dim">Разблокировка:</div>
            <div style={{fontSize:18, fontWeight:700}}>
              {unlockDate?.toLocaleDateString('ru-RU', {timeZone:'Europe/Moscow'})}
            </div>
          </div>

          {active.term_days > 1 && (
            <button className="btn btn-danger" onClick={unlock}>
              ❌ Досрочно забрать ${fmt(active.amount)}
              <div style={{fontSize:12, fontWeight:400, marginTop:4}}>
                (доход ${fmt(active.accumulated_profit)} сгорит)
              </div>
            </button>
          )}
        </>
      ) : (
        <>
          <div className="card text-center">
            <div style={{fontSize:16}}>Зарабатывайте с оборота платформы каждый день.</div>
            <div style={{fontSize:14}} className="text-dim">Тело вклада возвращается всегда.</div>
            <div className="mt" style={{fontSize:20, fontWeight:900, color:'#a855f7'}}>
              📊 Вчера: {baseRate.toFixed(1)}% (базовая)
            </div>
          </div>

          <div className="card">
            <div className="card-title">Сумма вклада</div>
            <input type="number" className="input" value={amount} onChange={e => setAmount(e.target.value)} />
            <div className="text-dim text-center" style={{marginTop:8}}>
              Мин: ${minDeposit} · Макс: ${maxDeposit}
            </div>
          </div>

          {TERMS.map(t => {
            const fc = forecast(t.days, t.mult);
            const isSel = selectedTerm === t.days;
            return (
              <div
                key={t.days}
                className={`term-card ${isSel ? 'selected' : ''}`}
                onClick={() => setSelectedTerm(t.days)}
              >
                <div>
                  <div style={{fontWeight:900, fontSize:18}}>{t.fire || ''} {t.days} {t.days === 1 ? 'день' : t.days < 5 ? 'дня' : 'дней'}</div>
                  <div className="text-dim" style={{fontSize:14}}>Множитель ×{t.mult}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div className="text-green" style={{fontWeight:700}}>~${fmt(fc)}</div>
                  <button className={`btn btn-small ${isSel ? '' : 'btn-secondary'}`} onClick={(e) => { e.stopPropagation(); setSelectedTerm(t.days); }}>
                    {isSel ? 'ВЫБРАНО' : 'ВЫБРАТЬ'}
                  </button>
                </div>
              </div>
            );
          })}

          <div className="card text-dim" style={{fontSize:13}}>
            ⚠️ Прогноз на основе вчерашней доходности. Реальная ставка меняется каждый день.<br/>
            При досрочном выходе тело возвращается 100%, доход сгорает.
          </div>

          <button className="btn btn-big" onClick={lock} style={{background:'#a855f7', color:'#fff'}}>
            🔒 ЗАБЛОКИРОВАТЬ ${parseFloat(amount||'0').toFixed(0)} НА {selectedTerm} {selectedTerm === 1 ? 'ДЕНЬ' : 'ДНЕЙ'}
          </button>
        </>
      )}
    </>
  );
}
