import { useEffect, useState } from 'react';
import BalancePanel from '../common/BalancePanel';
import Header from '../layout/Header';
import Icon from '../ui/Icon';
import { useAuth } from '../../stores/auth';
import { walletApi, publicConfig } from '../../api/client';
import { formatAmount } from '../../utils/betChips';
import { sfx } from '../../audio';

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
      sfx.money();
      showToast(res.status === 'pending'
        ? `Заявка #${res.withdrawal_id} на $${formatAmount(Number(res.payout))} принята: деньги списаны, выплата будет отправлена оператором`
        : `$${formatAmount(Number(res.payout))} отправлено`);
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
      <Header title="Вывести" icon="withdraw" />

      {/* Единый блок денег: та же карточка, что на главной и на /deposit */}
      {/* «Почему доступно меньше, чем на балансе» объясняют пилюли внутри
          BalancePanel; второй MoneyBreakdown рисовал их же ещё раз */}
      <BalancePanel variant="hero" label="Доступно к выводу" showTotal
        aside={<span className="balance__net">USDT · TON</span>} />

      <div className="card">
        <div className="card-title"><Icon name="coins" size={16} /> Сумма вывода</div>
        <input
          type="number"
          className="input input--amount"
          value={amount}
          inputMode="decimal"
          onChange={e => setAmount(e.target.value)}
          placeholder="0.00"
          min={5}
        />
        <div className="limits-line">
          <span className="limits-line__item">Мин: <b>$5</b></span>
          <span className="limits-line__sep" aria-hidden="true" />
          <button
            type="button"
            className="limits-line__action"
            onClick={() => { sfx.chip(); setAmount(String(Math.floor(available * 100) / 100)); }}
            disabled={available < 5}
          >
            <Icon name="zap" size={13} strokeWidth={2.2} /> вывести всё
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Icon name="wallet" size={16} /> Куда</div>
        <input
          type="text"
          className="input input--mono"
          value={address}
          onChange={e => setAddress(e.target.value)}
          placeholder="UQ… (адрес USDT в сети TON)"
          spellCheck={false}
          autoCapitalize="off"
        />
      </div>

      <div className="card fee-card">
        <div className="fee-card__row">
          <span className="text-dim"><Icon name="percent" size={14} strokeWidth={2} /> Комиссия {feePercent}%</span>
          <span>−${formatAmount(fee)}</span>
        </div>
        <div className="fee-card__row fee-card__row--total">
          <span>Вы получите</span>
          <span className="text-green">${formatAmount(payout)}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title text-center"><Icon name="lock" size={16} /> PIN-код</div>
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
          <div className="text-center pin-missing">
            <span className="text-red">PIN не установлен — вывод недоступен.</span>
            <a href="/set-pin" className="btn btn-small mt">
              <Icon name="key" size={13} strokeWidth={2.2} /> Установить PIN
            </a>
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
        <Icon name="withdraw" size={18} strokeWidth={2} />
        {loading ? 'Обработка…' : `Вывести $${formatAmount(payout)}`}
      </button>
    </>
  );
}
