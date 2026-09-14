/**
 * Быстрые суммы ставок/вкладов.
 *
 * Три требования, которые раньше не выполнялись:
 *  1. Номиналы считались от ЗАРАНЕЕ заданного списка `[1, 5, 10, 25, 50, 100]`,
 *     поэтому у игрока с балансом $7 была кнопка «$100», а у игрока с $50 000 —
 *     только «$100». Теперь номиналы производны от доступного баланса.
 *  2. Цифры обязаны быть «красивыми»: $37.41 на кнопке выглядит как ошибка.
 *     Округление — то же, что серверное `roundDownClean()` (вклад VAULT):
 *     вниз до первой значащей цифры. $37.41 → $30, $6 480 → $6 000.
 *  3. Нужна кнопка «всё» — точный доступный остаток (с учётом лимита игры).
 */

/**
 * Округление вниз до первой значащей цифры.
 * Точная копия `roundDownClean()` из `backend/src/config.ts`: лимит максимальной
 * ставки Ракеты и максимального вклада VAULT считается на сервере именно так,
 * поэтому быстрые суммы на клиенте совпадают с тем, что сервер пропустит.
 */
export function roundDownClean(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (value < 10) return Math.max(1, Math.floor(value));
  const digits = Math.floor(value).toString().length;
  const power = Math.pow(10, digits - 1);
  return Math.floor(value / power) * power;
}

/** Деньги до копеек (без плавающей погрешности вроде 0.30000000000000004). */
export function money2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export interface AmountChips {
  /** «Красивые» номиналы: 10% / 25% / 50% от доступного баланса. */
  chips: number[];
  /**
   * Точная сумма «всё, что есть»: доступный остаток, ограниченный лимитом игры.
   * `null` — если ставить нечего (баланс ниже минимума).
   */
  all: number | null;
  /** Есть ли смысл рисовать блок кнопок. */
  enabled: boolean;
}

/**
 * Доли доступного баланса, из которых строятся номиналы.
 *
 * Три штуки, а не шесть: вместе с кнопкой MAX это четыре элемента — ровно
 * столько помещается в один ряд на экране 320 px без переноса и без «простыни»
 * кнопок, за которой не видно главного действия.
 */
const FRACTIONS = [0.1, 0.25, 0.5];

/**
 * Рассчитать быстрые суммы.
 *
 * @param available доступный баланс (баланс минус заморозка)
 * @param min       минимальная ставка/вклад игры
 * @param max       лимит игры; `null` — лимита нет (например, 0% в настройках Ракеты)
 */
export function amountChips(available: number, min = 1, max: number | null = null): AmountChips {
  const avail = money2(available);
  const floor = money2(min);
  const cap = max == null || !Number.isFinite(max) ? null : money2(max);

  // Сколько реально можно внести прямо сейчас
  const spendable = cap == null ? avail : Math.min(avail, cap);
  const all = spendable >= floor ? money2(spendable) : null;

  const chips: number[] = [];
  for (const f of FRACTIONS) {
    const raw = roundDownClean(spendable * f);
    if (raw < floor) continue;
    if (cap != null && raw > cap) continue;
    // Не дублируем ни соседний номинал, ни кнопку MAX: две одинаковые цифры
    // в одном ряду читаются как баг
    if (chips.includes(raw)) continue;
    if (all != null && money2(raw) === all) continue;
    chips.push(raw);
  }

  // Маленький баланс: доли дают 1–2 кнопки, добавляем минимум, чтобы ряд не
  // выглядел оборванным
  if (!chips.includes(floor) && floor <= spendable && chips.length < FRACTIONS.length) {
    chips.unshift(floor);
  }

  return { chips: chips.slice(0, FRACTIONS.length), all, enabled: all != null || chips.length > 0 };
}

/**
 * Текст лимита максимальной суммы.
 * Лимита может не быть вовсе (настройка Ракеты `0` = без ограничений) — показывать
 * в этом случае «Макс: $0» или «Макс: $Infinity» нельзя, поэтому формулируем явно.
 */
export function maxLabel(max: number | null | undefined, prefix = 'Макс'): string {
  if (max == null || !Number.isFinite(max) || max <= 0) return `${prefix}: без лимита`;
  return `${prefix}: $${formatAmount(max)}`;
}

/** $1 234 567 · $100 · $2.50 — с разделителями разрядов и без лишних нулей. */
export function formatAmount(value: number): string {
  const n = money2(value);
  const hasCents = Math.abs(n % 1) > 0.0001;
  return n.toLocaleString('ru-RU', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2
  });
}
