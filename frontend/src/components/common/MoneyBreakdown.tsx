/**
 * Полная раскладка средств игрока.
 *
 * Используется там, где нужно объяснить цифры подробно (профиль) или коротко
 * (игровые экраны). Короткий вариант — тот же набор пилюль, что рисует
 * `BalancePanel`, поэтому экраны не спорят друг с другом оформлением.
 */
import { useMoneyParts } from './BalancePanel';
import { formatAmount } from '../../utils/betChips';
import Icon, { type IconName } from '../ui/Icon';

export default function MoneyBreakdown({ detailed = false }: { detailed?: boolean }) {
  const { available, frozen, safe, vault, total, locked } = useMoneyParts();

  if (!detailed) {
    if (!locked.length) return null;
    return (
      <div className="balance__locked balance__locked--inline">
        <span className="balance__locked-hint">
          <Icon name="snowflake" size={12} strokeWidth={2} />
          в деле
        </span>
        {locked.map(p => (
          <span key={p.key} className={`lock-pill lock-pill--${p.tone}`}>
            <Icon name={p.icon} size={12} strokeWidth={2} />
            {p.label}
            <b>${formatAmount(p.value)}</b>
          </span>
        ))}
      </div>
    );
  }

  const rows: { icon: IconName; label: string; value: number; tone?: string }[] = [
    { icon: 'wallet', label: 'Доступно', value: available },
    { icon: 'swords', label: 'В дуэлях', value: frozen },
    { icon: 'lock', label: 'В сейфе', value: safe },
    { icon: 'gem', label: 'Во вкладе', value: vault }
  ];

  return (
    <div className="money-rows">
      {rows.map(r => (
        <div className="money-rows__line" key={r.label}>
          <span className="money-rows__label">
            <Icon name={r.icon} size={14} strokeWidth={1.9} />
            {r.label}
          </span>
          <b className="money-rows__value">${formatAmount(r.value)}</b>
        </div>
      ))}
      <div className="money-rows__line money-rows__line--total">
        <span className="money-rows__label">
          <Icon name="coins" size={14} strokeWidth={1.9} />
          Всего средств
        </span>
        <b className="money-rows__value money-rows__value--gold">${formatAmount(total)}</b>
      </div>
    </div>
  );
}
