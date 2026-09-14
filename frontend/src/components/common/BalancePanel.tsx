/**
 * Единый блок баланса для всех экранов.
 *
 * Раньше одна и та же информация на разных страницах выглядела по-разному:
 * на `/withdraw` — крупная карточка «Доступно», на `/deposit` — строка
 * «Текущий баланс: $50.00» и под ней серый текст «❄️ Заморожено: $50.00»,
 * в играх — «Доступно:» в одну строку с цифрой. Игрок каждый раз заново
 * искал, где тут деньги. Теперь блок один и в двух плотностях:
 *
 *  - `hero`   — крупный блок для кошелька (пополнение, вывод);
 *  - `strip`  — компактная стеклянная полоса для игровых экранов, где баланс
 *               сопровождает форму ставки и не должен спорить с ней за внимание.
 *
 * «Где деньги» раскрывается пилюлями с иконками: дуэли (заморозка), сейф,
 * вклад VAULT. Пилюли появляются только при ненулевой сумме — у игрока без
 * вкладов блок остаётся чистым.
 */
import type { ReactNode } from 'react';
import { useAuth } from '../../stores/auth';
import { formatAmount } from '../../utils/betChips';
import Icon, { type IconName } from '../ui/Icon';

export interface LockedPart {
  key: string;
  icon: IconName;
  label: string;
  value: number;
  tone: 'cyan' | 'gold' | 'violet';
}

/** Разложить средства игрока: доступно + где ещё лежат деньги. */
export function useMoneyParts(): {
  balance: number;
  frozen: number;
  safe: number;
  vault: number;
  available: number;
  total: number;
  locked: LockedPart[];
} {
  const { user } = useAuth();
  const balance = Number(user?.balance) || 0;
  const frozen = Number(user?.frozen_balance) || 0;
  const safe = Number(user?.safe_locked) || 0;
  const vault = Number(user?.vault_locked) || 0;

  const locked: LockedPart[] = [];
  if (frozen > 0.004) locked.push({ key: 'duel', icon: 'swords', label: 'В дуэлях', value: frozen, tone: 'cyan' });
  if (safe > 0.004) locked.push({ key: 'safe', icon: 'lock', label: 'В сейфе', value: safe, tone: 'gold' });
  if (vault > 0.004) locked.push({ key: 'vault', icon: 'gem', label: 'Во вкладе', value: vault, tone: 'violet' });

  return {
    balance, frozen, safe, vault,
    available: Math.round((balance - frozen) * 100) / 100,
    // Общая сумма средств: баланс уже включает резерв дуэлей, а сейф и вклад
    // списаны с баланса — поэтому складываем balance + safe + vault
    total: Math.round((balance + safe + vault) * 100) / 100,
    locked
  };
}

interface Props {
  variant?: 'hero' | 'strip';
  /** Подпись над суммой. По умолчанию «Доступно» — именно эту сумму можно поставить. */
  label?: string;
  /** Показывать итог «Всего средств» (полезно в кошельке). */
  showTotal?: boolean;
  /** Слот справа в hero-варианте (например, кнопка «Пополнить»). */
  aside?: ReactNode;
  /** Под блоком (пояснение, комиссия). */
  footnote?: ReactNode;
}

export default function BalancePanel({
  variant = 'strip', label = 'Доступно', showTotal = false, aside, footnote
}: Props) {
  const { available, locked, total } = useMoneyParts();

  return (
    <div className={`balance${variant === 'hero' ? ' balance--hero' : ' balance--strip'}`}>
      <div className="balance__main">
        <div className="balance__label">{label}</div>
        <div className="balance__value">${formatAmount(available)}</div>
        {showTotal && locked.length > 0 && (
          <div className="balance__total">всего средств ${formatAmount(total)}</div>
        )}
      </div>

      {aside && <div className="balance__aside">{aside}</div>}

      {locked.length > 0 && (
        <div className="balance__locked">
          <span className="balance__locked-hint">
            <Icon name="snowflake" size={12} strokeWidth={2} />
            в деле
          </span>
          {locked.map(p => (
            <span key={p.key} className={`lock-pill lock-pill--${p.tone}`} title={`${p.label}: $${formatAmount(p.value)}`}>
              <Icon name={p.icon} size={12} strokeWidth={2} />
              {p.label}
              <b>${formatAmount(p.value)}</b>
            </span>
          ))}
        </div>
      )}

      {footnote && <div className="balance__footnote">{footnote}</div>}
    </div>
  );
}
