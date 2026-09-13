import { useState } from 'react';
import MoneyBreakdown from '../common/MoneyBreakdown';
import Header from '../layout/Header';
import { useAuth } from '../../stores/auth';
import { walletApi } from '../../api/client';

export default function Withdraw() {
  const { user, refreshUser, showToast } = useAuth();
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState(user?.withdraw_address || '');
  const [pin, setPin] = useState(['', '', '', '']);
  const [loading, setLoading] = useState(false);

  const amt = parseFloat(amount) || 0;
  const fee = Math.round(amt * 0.01 * 100) / 100;
  const payout = Math.round((amt - fee) * 100) / 100;
  const available = user?.available || 0;

  const setPinDigit = (i: number, v: string) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...pin];
    next[i] = v;
    setPin(next);
    if (v && i < 3) {
      const el = document.getElementById(`pin-${i+1}`);
      el?.focus();
    }
  };

  const doWithdraw = async () => {
    if (amt < 5) return showToast('Минимум $5');
    if (amt > available) return showToast('Недостаточно средств');
    if (!user?.pin_set && pin.join('') !== '0000') {
      return showToast('Установите PIN в профиле (в демо: 0000)');
    }
    setLoading(true);
    try {
      const res = await walletApi.withdraw(amt, pin.join(''), address);
      showToast(`📤 $${res.payout.toFixed(2)} отправлено!`);
      setAmount('');
      setPin(['','','','']);
      await refreshUser();
    } catch (e: any) {
      showToast(e.message);
    }
    setLoading(false);
  };

  return (
    <>
      <Header title="Вывести" />

      <div className="card text-center">
        <div className="balance-label">Доступно</div>
        <div style={{fontSize:32, fontWeight:900, color:'#ffd700'}}>${available.toFixed(2)}</div>
        {/* Почему доступно меньше, чем на балансе */}
        <MoneyBreakdown />
      </div>

      <div className="card">
        <div className="card-title">Сумма</div>
        <input
          type="number"
          className="input"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.00"
        />
        <div style={{display:'flex', justifyContent:'space-between', margin:'8px 0'}}>
          <span className="text-dim">Мин: $5</span>
          <button
            className="text-accent"
            style={{background:'none', border:'none', color:'#ffd700', cursor:'pointer', fontWeight:700}}
            onClick={() => setAmount(String(Math.floor(available)))}
          >
            Вывести всё
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Куда</div>
        <input
          type="text"
          className="input"
          value={address}
          onChange={e => setAddress(e.target.value)}
          placeholder="UQ... (TON USDT адрес)"
          style={{fontSize:14}}
        />
      </div>

      <div className="card">
        <div style={{display:'flex', justifyContent:'space-between', fontSize:16}}>
          <span className="text-dim">Комиссия (1%):</span>
          <span>${fee.toFixed(2)}</span>
        </div>
        <div style={{display:'flex', justifyContent:'space-between', fontSize:20, fontWeight:900, marginTop:8}}>
          <span>Вы получите:</span>
          <span className="text-green">${payout.toFixed(2)}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title text-center">🔒 PIN-код</div>
        <div className="pin-input">
          {pin.map((d, i) => (
            <input
              key={i}
              id={`pin-${i}`}
              className="pin-digit"
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={e => setPinDigit(i, e.target.value)}
              onFocus={e => e.target.select()}
            />
          ))}
        </div>
        {!user?.pin_set && (
          <div className="text-dim text-center" style={{fontSize:12}}>
            В демо используйте PIN 0000 или <a href="/set-pin" style={{color:'#ffd700'}}>установите свой</a>
          </div>
        )}
      </div>

      <button
        className="btn btn-danger btn-big"
        onClick={doWithdraw}
        disabled={loading || amt < 5 || amt > available}
      >
        {loading ? 'Обработка...' : '📤 ВЫВЕСТИ'}
      </button>
    </>
  );
}
