import { useEffect, useState } from 'react';
import MoneyBreakdown from '../common/MoneyBreakdown';
import Header from '../layout/Header';
import { useAuth } from '../../stores/auth';
import { walletApi, publicConfig } from '../../api/client';

export default function Withdraw() {
  const { user, refreshUser, showToast } = useAuth();
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState(user?.withdraw_address || '');
  const [pin, setPin] = useState(['', '', '', '']);
  const [loading, setLoading] = useState(false);
  // Комиссия вывода — из настроек платформы (админка), а не захардкоженный 1%:
  // иначе экран показывал одну сумму, а сервер списывал другую.
  const [feePercent, setFeePercent] = useState(1);
  useEffect(() => { publicConfig().then((c: any) => {
    const p = Number(c?.withdraw_commission);
    if (Number.isFinite(p) && p >= 0) setFeePercent(p);
  }).catch(() => {}); }, []);

  const amt = parseFloat(amount) || 0;
  const fee = Math.round(amt * (feePercent / 100) * 100) / 100;
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
    // PIN обязателен всегда: сервер больше не принимает «0000» вместо
    // неустановленного PIN (раньше так можно было вывести деньги без PIN).
    if (!user?.pin_set) return showToast('Сначала установите PIN-код в профиле');
    if (!/^\d{4}$/.test(pin.join(''))) return showToast('Введите 4 цифры PIN-кода');
    if (!address) return showToast('Укажите адрес для вывода');
    setLoading(true);
    try {
      const res = await walletApi.withdraw(amt, pin.join(''), address);
      // В реальном режиме выплата уходит оператору на отправку (status=pending),
      // в демо — выполняется мгновенно. Сообщаем честно, что произошло.
      showToast(res.status === 'pending'
        ? `📤 Заявка #${res.withdrawal_id} на $${Number(res.payout).toFixed(2)} принята: деньги списаны, выплата будет отправлена оператором`
        : `📤 $${Number(res.payout).toFixed(2)} отправлено!`);
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
        <div style={{fontSize:32, fontWeight:900, color:'var(--gold)'}}>${available.toFixed(2)}</div>
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
            style={{background:'none', border:'none', color:'var(--gold)', cursor:'pointer', fontWeight:700}}
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
          <span className="text-dim">Комиссия ({feePercent}%):</span>
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
        {!user?.pin_set ? (
          <div className="text-center" style={{fontSize:12}}>
            <span className="text-red">PIN не установлен — вывод недоступен.</span>{' '}
            <a href="/set-pin" style={{color:'var(--gold)'}}>Установить PIN</a>
          </div>
        ) : (
          <div className="text-dim text-center" style={{fontSize:12}}>
            5 неверных попыток блокируют вывод на 15 минут
          </div>
        )}
      </div>

      <button
        className="btn btn-danger btn-big"
        onClick={doWithdraw}
        disabled={loading || amt < 5 || amt > available || !user?.pin_set || !/^\d{4}$/.test(pin.join(''))}
      >
        {loading ? 'Обработка...' : '📤 ВЫВЕСТИ'}
      </button>
    </>
  );
}
