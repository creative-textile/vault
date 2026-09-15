import { useCallback, useEffect, useState } from 'react';
import BalancePanel from '../common/BalancePanel';
import Header from '../layout/Header';
import Icon from '../ui/Icon';
import { useAuth } from '../../stores/auth';
import { walletApi, publicConfig, ApiError } from '../../api/client';
import { formatAmount } from '../../utils/betChips';
import { sfx } from '../../audio';

/** Быстрые суммы демо-пополнения — те же, что в играх, но от $2 (минимум сети). */
const DEMO_CHIPS = [10, 50, 100, 500, 1000];

export default function Deposit() {
  const { refreshUser, showToast } = useAuth();
  const [address, setAddress] = useState<string>('');
  const [addressError,setAddressError]=useState('');
  const [addressLoading,setAddressLoading]=useState(true);
  const [demoAmount, setDemoAmount] = useState('100');
  const [demoBusy, setDemoBusy] = useState(false);
  /**
   * Карточка демо-пополнения рисуется ТОЛЬКО в демо-режиме.
   *
   * Раньше она показывалась всегда, а сервер в реальном режиме отвечал 403:
   * игрок видел рабочую на вид кнопку «+ ПОПОЛНИТЬ», которая никогда не
   * срабатывает. Флаг demo_mode приходит из /api/config (там же сервер
   * отключает сам эндпоинт).
   */
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => { publicConfig().then((c: any) => setDemoMode(c?.demo_mode === true)).catch(() => {}); }, []);

  const loadAddress=useCallback(async()=>{
    setAddressLoading(true); setAddressError('');
    for(let attempt=0;attempt<3;attempt++) {
      try { const r=await walletApi.depositAddress(); if(!r?.address)throw new Error('Пустой адрес'); setAddress(r.address);setAddressLoading(false);return; }
      catch(e:any) { if(attempt<2) await new Promise(r=>setTimeout(r,700*(attempt+1))); else setAddressError(e.message||'Не удалось получить адрес'); }
    }
    setAddressLoading(false);
  },[]);
  useEffect(()=>{let active=true; loadAddress(); const onVisible=()=>{if(active&&document.visibilityState==='visible')loadAddress()}; document.addEventListener('visibilitychange',onVisible); return()=>{active=false;document.removeEventListener('visibilitychange',onVisible)}},[loadAddress]);

  const doDemoDeposit = async () => {
    const amt = parseFloat(demoAmount);
    if (!amt || amt < 2) { sfx.error(); return showToast('Минимальная сумма $2'); }
    if (demoBusy) return;
    setDemoBusy(true);
    try {
      await walletApi.demoDeposit(amt);
      await refreshUser();
      sfx.money();
      showToast(`+$${formatAmount(amt)} зачислено (демо)`);
    } catch (e: any) {
      // 401 здесь означает, что сессия восстанавливается (см. App.tsx):
      // приложение уже перезапустило вход, поэтому ждём новый токен и повторяем
      // запрос ОДИН раз. Повтор безопасен — отклонённый по авторизации запрос
      // деньги не начисляет. Без этого игрок видел «Ошибка авторизации» и лечил
      // её перезагрузкой страницы.
      if (e instanceof ApiError && e.status === 401) {
        try {
          await new Promise(r => setTimeout(r, 1500));
          await walletApi.demoDeposit(amt);
          await refreshUser();
          sfx.money();
          showToast(`+$${formatAmount(amt)} зачислено (демо)`);
          return;
        } catch {
          showToast('Сессия обновляется — нажмите «Пополнить» ещё раз');
          return;
        }
      }
      sfx.error();
      showToast(e.message||'Пополнение не выполнено');
    } finally {
      setDemoBusy(false);
    }
  };
  const copy = () => { if(!address)return; navigator.clipboard?.writeText(address); sfx.tapSoft(); showToast('Адрес скопирован'); };

  return <>
    <Header title="Пополнить" icon="deposit" />

    {/* Тот же блок денег, что на главной и на /withdraw: сумма, которую можно
        потратить, и пилюли «где ещё лежат средства». Прежняя строка
        «Текущий баланс: $50.00 / ❄️ Заморожено…» выглядела черновиком. */}
    {/* Пилюли «в деле» рисует сам BalancePanel — отдельный MoneyBreakdown
        здесь задваивал их: «в деле В дуэлях $25 В сейфе $33,33» дважды подряд */}
    <BalancePanel variant="hero" label="Баланс" showTotal
      aside={<span className="balance__net">TON</span>} />

    <div className="card">
      <div className="card-title deposit-title">
        <Icon name="coins" size={16} /> Отправьте USDT в сети TON
      </div>
      <div className="address-box">
        <span className="address-box__value">
          {address || (addressLoading ? 'Генерация адреса…' : 'Адрес пока не получен')}
        </span>
        <button disabled={!address} onClick={copy} className="btn btn-small" type="button">
          <Icon name="copy" size={14} strokeWidth={2} /> Копировать
        </button>
      </div>
      {addressError && (
        <div className="text-center text-red">
          <div>{addressError}</div>
          <button className="btn btn-small mt" onClick={loadAddress} type="button">
            <Icon name="refresh" size={14} strokeWidth={2} /> Повторить
          </button>
        </div>
      )}
      <div className="deposit-facts">
        <span><Icon name="info" size={13} strokeWidth={2} /> минимум $2</span>
        <span><Icon name="percent" size={13} strokeWidth={2} /> комиссия сети 0%</span>
        <span><Icon name="clock" size={13} strokeWidth={2} /> зачисление 1–3 минуты</span>
      </div>
      <div className="deposit-warn">
        <Icon name="alert" size={14} strokeWidth={2} />
        Зачисляются только USDT в сети TON. Токены других сетей не возвращаются.
      </div>
    </div>

    {demoMode && (
      <div className="card card-hl">
        <div className="card-title"><Icon name="flask" size={16} /> Демо-пополнение</div>
        <div className="text-dim" style={{marginBottom:12}}>
          В демо-режиме деньги начисляются мгновенно — без реальной отправки USDT.
        </div>
        <div className="bet-chips">
          {DEMO_CHIPS.map(c => (
            <button
              key={c} type="button"
              className={`chip${Math.round(parseFloat(demoAmount) || 0) === c ? ' chip--on' : ''}`}
              onClick={() => { sfx.chip(); setDemoAmount(String(c)); }}
            >${formatAmount(c)}</button>
          ))}
        </div>
        <div className="demo-row">
          <input
            className="input input--amount" type="number" value={demoAmount} inputMode="decimal"
            onChange={e=>setDemoAmount(e.target.value)} placeholder="Сумма" min={2}
          />
          <button className="btn btn-green" onClick={doDemoDeposit} disabled={demoBusy} type="button">
            <Icon name="plus" size={16} strokeWidth={2.4} />
            {demoBusy ? 'Зачисляем…' : 'Пополнить'}
          </button>
        </div>
      </div>
    )}
  </>;
}
