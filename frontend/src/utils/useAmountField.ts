/**
 * Поле суммы со значением по умолчанию, которое считается от баланса.
 *
 * Хук нужен, чтобы «умный дефолт» не спорил с игроком: значение подставляется
 * только до первого ввода. Без этого эффект перезаполнял бы поле каждый раз,
 * когда обновился баланс (пришёл выигрыш, сокет прислал `balance_updated`), и
 * набранную вручную сумму стирало.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultAmount } from './betChips';

export interface AmountFieldOptions {
  /** Доступный баланс: баланс минус заморозка дуэлей. */
  available: number;
  /** Минимальная сумма игры. */
  min?: number;
  /** Лимит игры; `null` — лимита нет. */
  max?: number | null;
  /** Желаемая сумма по умолчанию, если она по карману (минимум игры и т.п.). */
  preferred?: number;
}

export function useAmountField({ available, min = 1, max = null, preferred }: AmountFieldOptions) {
  const [value, setValue] = useState('');
  const touched = useRef(false);

  useEffect(() => {
    if (touched.current) return;
    const next = defaultAmount(available, min, max, preferred);
    setValue(prev => (prev === next ? prev : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, min, max, preferred]);

  /** Любой ввод игрока (поле или кнопка-номинал) отключает автоподстановку. */
  const onChange = useCallback((next: string) => {
    touched.current = true;
    setValue(next);
  }, []);

  return [value, onChange] as const;
}
