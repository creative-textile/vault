import { useEffect, useState } from 'react';
import BalancePanel from '../common/BalancePanel';
import AmountChips from '../common/AmountChips';
import Header from '../layout/Header';
import Icon from '../ui/Icon';
import { dialog } from '../ui/Dialog';
import { vaultApi } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { formatAmount } from '../../utils/betChips';
import { useAmountField } from '../../utils/useAmountField';

/** Сроки вклада. `hot` — метка самого выгодного срока (вместо эмодзи «🔥»). */
const TERMS = [
  { days: 1, mult: 1.0 },
  { days: 7, mult: 1.3 },
  { days: 14, mult: 1.6 },
  { days: 30, mult: 2.0, hot: true }
];

function fmt(n: number) { return n.toFixed(2); }

/** «1 день / 2 дня / 5 дней» — без этого подпись срока читается с ошибкой. */
function pluralDays(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

export default function VaultDeposit() {
  const { user, refreshUser, showToast } = useAuth();
  const [status, setStatus] = useState<any>(null);
  const [selectedTerm, setSelectedTerm] = useState(30);
  const [history, setHistory] = useState<any[]>([]);
  const [accruals, setAccruals] = useState<any[]>([]);

  const active = status?.active_deposit;
  const maxDeposit = status?.pool_info?.max_deposit || 100;
  const minDeposit = status?.pool_info?.min_deposit || 10;
  const baseRate = status?.pool_info?.yesterday?.base_rate || 2.1;
  // Деньги, которые реально можно положить во вклад (баланс минус резерв дуэлей)
  const available = Number(user?.available ?? ((user?.balance || 0) - (user?.frozen_balance || 0))) || 0;

  // Сумма вклада по умолчанию: минимум пула, если он по карману, иначе средний
  // номинал тех же кнопок (25% доступного в границах пула). Прежние «$10»
  // стояли в поле и при балансе $2 (вклад невозможен), и при $50 000 (мелочь),
  // а подтягивание «до минимума» в load() перезаписывало сумму, которую игрок
  // уже ввёл руками. Хук подставляет значение только до первого ввода.
  const [amount, setAmount] = useAmountField({
    available, min: minDeposit, max: maxDeposit, preferred: minDeposit
  });

  const load = () => vaultApi.status().then(s => {
    setStatus(s);
    setHistory(s.history || []);
  });

  useEffect(() => { load(); vaultApi.accruals().then(setAccruals).catch(()=>{}); }, []);

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
      showToast('Вклад открыт');
      await refreshUser();
      load();
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const unlock = async () => {
    if (!active) return;
    // Кастомное окно вместо `window.confirm`: в Telegram WebView нативный
    // диалог нередко не показывается вовсе, и вклад «возвращался» или не
    // возвращался без ведома игрока
    const ok = await dialog.confirm({
      title: 'Закрыть вклад досрочно?',
      message: (
        <>
          На баланс вернётся <b className="text-accent">${fmt(active.amount)}</b> — тело вклада.
          Накопленный доход <b className="text-red">${fmt(active.accumulated_profit)}</b> будет списан.
        </>
      ),
      confirmText: 'Вернуть вклад',
      cancelText: 'Оставить',
      tone: 'danger',
      icon: 'alert'
    });
    if (!ok) return;
    try {
      await vaultApi.earlyUnlock(active.id);
      showToast('Тело вклада возвращено на баланс');
      await refreshUser();
      load();
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const unlockDate = active ? new Date(new Date(active.created_at).getTime() + active.term_days * 86400000) : null;

  return (
    <>
      <Header title="Vault Вклад" icon="gem" />
      {/* Единый блок денег: столько же, сколько на /deposit и /withdraw */}
      {/* «Куда делись деньги, которых не хватает для нового вклада» показывают
          пилюли внутри BalancePanel — отдельный MoneyBreakdown их задваивал */}
      <BalancePanel variant="hero" label="Доступно для вклада" showTotal />

      {active ? (
        <>
          <div className="card card-hl text-center">
            <div className="card-title vault-active__title">
              <Icon name="gem" size={18} /> Вклад активен
            </div>
            <div className="vault-active__amount">
              ${fmt(active.amount)} · {active.term_days} {pluralDays(active.term_days)}
            </div>
            <div className="vault-active__mult">доля прибыли ×{active.multiplier}</div>
            <div className="text-dim">День {active.days_elapsed} из {active.term_days}</div>
          </div>

          <div className="card text-center">
            <div className="balance-label">Накоплено</div>
            <div style={{fontSize:36, fontWeight:900, color:'var(--gold)'}}>${fmt(active.accumulated_profit)}</div>
            <div className="progress">
              <div className="progress-fill" style={{width: `${(active.days_elapsed / active.term_days) * 100}%`}} />
            </div>
            <div className="text-dim">{Math.round((active.days_elapsed / active.term_days) * 100)}%</div>
          </div>

          <div className="card">
            <div className="card-title"><Icon name="calendar" size={16} /> Ежедневные начисления</div>
            {accruals.length===0?<div className="text-dim">Первое начисление появится после расчёта в 00:00 МСК.</div>:accruals.slice(0,30).map((a:any)=><div key={a.id} className="history-item"><span>{new Date(`${a.date}T00:00:00`).toLocaleDateString('ru-RU')}<small className="text-dim" style={{display:'block'}}>Доля ×{a.multiplier}</small></span><b className="text-green">+${fmt(a.profit)}</b></div>)}
          </div>

          <div className="card text-center">
            <div className="text-dim">Разблокировка:</div>
            <div style={{fontSize:18, fontWeight:700}}>
              {unlockDate?.toLocaleDateString('ru-RU', {timeZone:'Europe/Moscow'})}
            </div>
          </div>

          {active.term_days > 1 && (
            <button className="btn btn-danger" onClick={unlock}>
              <Icon name="withdraw" size={16} />
              Досрочно забрать ${fmt(active.amount)}
              <div className="btn__sub">доход ${fmt(active.accumulated_profit)} сгорит</div>
            </button>
          )}
        </>
      ) : (
        <>
          {/* Как это работает. Прежний текст («Зарабатывайте с оборота
              платформы… Тело вклада возвращается всегда. 📊 Вчера: 2.1%»)
              был набором лозунгов в три строки разного кегля: непонятно,
              откуда деньги, когда начисление и что значит «базовая». */}
          <div className="card vault-pitch">
            <div className="vault-pitch__head">
              <span className="vault-pitch__badge"><Icon name="trendUp" size={14} strokeWidth={2.1} /> пассивный доход</span>
              <div className="vault-pitch__title">Вклад растёт вместе с платформой</div>
              <p className="vault-pitch__text">
                Каждый день пул игр делится частью дохода с вкладчиками. Начисления
                приходят в 00:00 МСК, а сумма вклада возвращается целиком — в срок
                и при досрочном закрытии.
              </p>
            </div>
            <div className="vault-pitch__stats">
              <div className="vault-stat">
                <span className="vault-stat__label">доходность вчера</span>
                <b className="vault-stat__value">{baseRate.toFixed(1)}%</b>
                <span className="vault-stat__hint">базовая ставка дня</span>
              </div>
              <div className="vault-stat">
                <span className="vault-stat__label">пул сегодня</span>
                <b className="vault-stat__value">${formatAmount(status?.pool_info?.pending_pool || 0)}</b>
                <span className="vault-stat__hint">из него считается доля</span>
              </div>
              <div className="vault-stat">
                <span className="vault-stat__label">макс. вклад</span>
                <b className="vault-stat__value">${formatAmount(maxDeposit)}</b>
                <span className="vault-stat__hint">минимум ${formatAmount(minDeposit)}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title"><Icon name="coins" size={16} /> Сумма вклада</div>
            <input
              type="number" className="input input--amount" value={amount} inputMode="decimal"
              onChange={e => setAmount(e.target.value)} min={minDeposit} max={maxDeposit}
            />
            {/* Номиналы от доступного баланса, но в границах вклада: кнопка
                «всё» никогда не предлагает больше, чем разрешает пул */}
            <AmountChips
              available={available} value={amount} onChange={setAmount}
              min={minDeposit} max={maxDeposit} allLabel="Всё"
            />
            <div className="limits-line">
              <span className="limits-line__item">Мин: <b>${formatAmount(minDeposit)}</b></span>
              <span className="limits-line__sep" aria-hidden="true" />
              <span className="limits-line__item">Макс: <b className="text-accent">${formatAmount(maxDeposit)}</b></span>
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
                  <div className="term-card__days">
                    {t.days} {pluralDays(t.days)}
                    {t.hot && <span className="term-card__hot"><Icon name="flame" size={12} strokeWidth={2.2} /> выгодно</span>}
                  </div>
                  <div className="term-card__mult">доля прибыли ×{t.mult}</div>
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

          <div className="card vault-note">
            <Icon name="info" size={15} strokeWidth={2} />
            <span>
              Прогноз рассчитан по вчерашней доходности: ставка меняется каждый день.
              При досрочном выходе сумма вклада возвращается полностью, накопленный доход сгорает.
            </span>
          </div>

          {/* При пустом/слишком маленьком поле кнопка говорит, чего не хватает,
              а не обещает «вклад $0.00» */}
          <button
            className="btn btn-big btn-violet" onClick={lock} type="button"
            disabled={!(parseFloat(amount) >= minDeposit)}
          >
            <Icon name="lock" size={18} strokeWidth={2} />
            {parseFloat(amount) >= minDeposit
              ? <>ОТКРЫТЬ ВКЛАД · ${formatAmount(parseFloat(amount))} на {selectedTerm} {pluralDays(selectedTerm).toUpperCase()}</>
              : <>МИНИМУМ ${formatAmount(minDeposit)}</>}
          </button>
        </>
      )}
    </>
  );
}
