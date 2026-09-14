/**
 * Предложение отправить часть выигрыша в Сейф.
 *
 * Полностью перерисовано: прежняя версия клала тускло-серый (`--text-dim`) и
 * золотой текст прямо на яркий фиолетовый градиент — половина подписей
 * («Взлом в 21:00 МСК…», «Возможный приз», чекбоксы) физически не читалась.
 * Теперь это обычная тёмная карточка с одним акцентом: суммой вклада.
 * Все стили вынесены в `app.css` (классы `safe-prompt__*`), инлайновых
 * `style={{…}}` с цветами больше нет.
 */
import { useState, useEffect } from 'react';
import { safeApi, profileApi, publicConfig } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { muteSafePrompt } from '../../utils/safePrompt';
import { formatAmount } from '../../utils/betChips';
import { sfx } from '../../audio';
import Icon from '../ui/Icon';

interface Props {
  profit: number;
  onClose: () => void;
  onDeposited: () => void;
}

const PERCENTS = [25, 50, 100];

export default function SafeDepositPrompt({ profit, onClose, onDeposited }: Props) {
  const { showToast, refreshUser } = useAuth();
  const [percent, setPercent] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  // Час взлома — из настроек (по умолчанию 18:00 МСК), а не захардкоженный
  const [safeTime, setSafeTime] = useState('18:00');
  const [autoSave, setAutoSave] = useState(false);
  const [mutePrompts, setMutePrompts] = useState(false);
  // Множитель приза тоже из настроек: «×1.5» в вёрстке расходилось с сервером
  const [payoutMult, setPayoutMult] = useState(1.5);

  useEffect(() => {
    publicConfig().then((c: any) => {
      const m = Number(c?.safe_payout_multiplier);
      if (Number.isFinite(m) && m > 0) setPayoutMult(m);
    }).catch(() => {});
    safeApi.current().then((s: any) => {
      // Время взлома берём у сейфа, в который реально идёт вклад:
      // во время взлома/после розыгрыша это уже сейф следующего дня
      const target = s?.collecting_safe || s?.safe;
      if (target?.crack_at_msk) { setSafeTime(target.crack_at_msk); return; }
      if (target?.crack_at) {
        try {
          const d = new Date(target.crack_at);
          if (!isNaN(d.getTime())) {
            setSafeTime(d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }));
          }
        } catch {}
      }
    }).catch(()=>{});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') skip(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amount = Math.round(profit * (percent / 100) * 100) / 100;
  const canDeposit = amount >= 1;
  const prizeForecast = Math.round(amount * payoutMult * 100) / 100;

  const skip = () => {
    if (mutePrompts) muteSafePrompt();
    sfx.tapSoft();
    onClose();
  };

  const deposit = async () => {
    if (!canDeposit || submitting) return;
    setSubmitting(true);
    try {
      await safeApi.deposit(amount);
      sfx.deposit();
      showToast(`$${formatAmount(amount)} внесено в Сейф`);
      if (autoSave) {
        await profileApi.update({ auto_safe_percent: percent });
        showToast(`Автовклад ${percent}% включён`);
      }
      await refreshUser();
      onDeposited();
    } catch (e: any) {
      sfx.error();
      showToast(e.message);
    }
    setSubmitting(false);
  };

  return (
    <div className="safe-prompt" onClick={skip} role="dialog" aria-modal="true" aria-label="Внести часть выигрыша в сейф">
      <div className="safe-prompt__card" onClick={(e) => e.stopPropagation()}>
        <button className="safe-prompt__close" onClick={skip} aria-label="Закрыть" type="button">
          <Icon name="close" size={16} strokeWidth={2.4} />
        </button>

        <div className="safe-prompt__head">
          <span className="safe-prompt__icon"><Icon name="lock" size={22} strokeWidth={1.9} /></span>
          <div className="safe-prompt__title">Отложить выигрыш в сейф?</div>
          <div className="safe-prompt__sub">
            Взлом сегодня в <b>{safeTime}</b> МСК · приз до ×{payoutMult}
          </div>
        </div>

        <div className="safe-prompt__sums">
          <div className="safe-prompt__sum">
            <span className="safe-prompt__sum-label">вкладываем</span>
            <b className="safe-prompt__sum-value">${formatAmount(amount)}</b>
          </div>
          <Icon name="arrowRight" size={18} strokeWidth={2} className="safe-prompt__arrow" />
          <div className="safe-prompt__sum">
            <span className="safe-prompt__sum-label">возможный приз</span>
            <b className="safe-prompt__sum-value safe-prompt__sum-value--green">${formatAmount(prizeForecast)}</b>
          </div>
        </div>
        <div className="safe-prompt__note">
          Приз делится между теми, кто собрал код быстрее остальных. Если код не
          собран — вклад возвращается в общий банк раунда.
        </div>

        <div className="safe-prompt__percents">
          {PERCENTS.map(p => (
            <button
              key={p} type="button"
              className={`safe-prompt__percent${p === percent ? ' safe-prompt__percent--on' : ''}`}
              onClick={() => { sfx.chip(); setPercent(p); }}
            >
              {p === 100 ? 'всё' : `${p}%`}
              <small>${formatAmount(Math.round(profit * (p / 100) * 100) / 100)}</small>
            </button>
          ))}
        </div>

        <button
          className="btn btn-big btn-green"
          onClick={deposit}
          disabled={!canDeposit || submitting}
          type="button"
        >
          <Icon name="deposit" size={18} strokeWidth={2} />
          {submitting ? 'Вносим…' : canDeposit ? `Внести $${formatAmount(amount)}` : 'Минимум $1'}
        </button>

        <label className="safe-prompt__check">
          <input type="checkbox" checked={autoSave} onChange={e => setAutoSave(e.target.checked)} />
          <span className="safe-prompt__box"><Icon name="check" size={11} strokeWidth={3} /></span>
          Вкладывать так каждый раз — {percent}% от любого выигрыша
        </label>

        <button className="btn btn-ghost" onClick={skip} type="button">
          Пропустить
        </button>
        <label className="safe-prompt__check safe-prompt__check--muted">
          <input type="checkbox" checked={mutePrompts} onChange={e => setMutePrompts(e.target.checked)} />
          <span className="safe-prompt__box"><Icon name="check" size={11} strokeWidth={3} /></span>
          Больше не предлагать сегодня
        </label>
      </div>
    </div>
  );
}
