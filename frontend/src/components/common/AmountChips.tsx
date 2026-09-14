/**
 * Ряд быстрых сумм для ставки/вклада.
 *
 * Номиналы производны от доступного баланса игрока (10% / 25% / 50%, округление
 * вниз до первой значащей цифры — как серверный `roundDownClean()`), поэтому
 * кнопки всегда «по карману»: у игрока с $7 нет номинала $100, а у игрока с
 * $50 000 есть $5 000 / $12 000 / $25 000.
 *
 * Крайняя кнопка MAX вносит всё, что доступно (с учётом лимита игры). Она
 * намеренно отличается по стилю: это не «ещё один номинал», а отдельное
 * действие, и перепутать его с $50 нельзя.
 */
import { amountChips, formatAmount } from '../../utils/betChips';
import { sfx } from '../../audio';
import Icon from '../ui/Icon';

interface Props {
  available: number;
  value: string;
  onChange: (next: string) => void;
  min?: number;
  /** `null` — лимита нет (настройка Ракеты 0%). */
  max?: number | null;
  /** Подпись кнопки «всё». В Сейфе «внести всё» читается лучше, чем «MAX». */
  allLabel?: string;
}

export default function AmountChips({ available, value, onChange, min = 1, max = null, allLabel = 'MAX' }: Props) {
  const { chips, all } = amountChips(available, min, max);
  if (!chips.length && all == null) return null;

  const current = Math.round((parseFloat(value) || 0) * 100) / 100;
  const isOn = (n: number) => Math.abs(current - n) < 0.005;

  const pick = (n: number) => {
    sfx.chip();
    onChange(String(Math.round(n * 100) / 100));
  };

  return (
    <div className="bet-chips">
      {chips.map(c => (
        <button
          key={c}
          type="button"
          className={`chip${isOn(c) ? ' chip--on' : ''}`}
          onClick={() => pick(c)}
        >
          ${formatAmount(c)}
        </button>
      ))}
      {all != null && (
        <button
          type="button"
          className={`chip chip--all${isOn(all) ? ' chip--on' : ''}`}
          onClick={() => pick(all)}
          title={`Внести всю доступную сумму: $${formatAmount(all)}`}
        >
          <Icon name="zap" size={13} strokeWidth={2.2} />
          {allLabel === 'MAX' ? 'MAX' : allLabel}
        </button>
      )}
    </div>
  );
}
