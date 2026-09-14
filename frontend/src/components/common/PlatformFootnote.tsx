/**
 * Сноска о комиссиях и сети выплат.
 *
 * Требование — «по-красивее, но без сильного акцента»: это служебная
 * информация, она должна читаться, если её ищут, и не отвлекать от игр.
 * Поэтому — тонкая стеклянная полоса с разделителями-точками, иконками в
 * `--text-faint` и цифрами из настроек платформы (а не захардкоженными 10/1%).
 */
import { useEffect, useState } from 'react';
import { publicConfig } from '../../api/client';
import Icon from '../ui/Icon';

export default function PlatformFootnote() {
  // Цифры берём из /api/config: админ может изменить комиссию в панели, и
  // сноска обязана показывать действительность, а не текст из вёрстки.
  const [gameFee, setGameFee] = useState<number | null>(null);
  const [withdrawFee, setWithdrawFee] = useState<number | null>(null);

  useEffect(() => {
    publicConfig().then((c: any) => {
      const g = Number(c?.commission_percent);
      const w = Number(c?.withdraw_commission);
      if (Number.isFinite(g) && g >= 0) setGameFee(g);
      if (Number.isFinite(w) && w >= 0) setWithdrawFee(w);
    }).catch(() => {});
  }, []);

  const pct = (v: number | null, fallback: number) => {
    const n = v == null ? fallback : v;
    return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1).replace(/\.0$/, '')}%`;
  };

  return (
    <div className="fee-strip">
      <span className="fee-strip__item">
        <Icon name="percent" size={12} strokeWidth={2} />
        игры {pct(gameFee, 10)}
      </span>
      <span className="fee-strip__dot" aria-hidden="true" />
      <span className="fee-strip__item">
        <Icon name="withdraw" size={12} strokeWidth={2} />
        вывод {pct(withdrawFee, 1)}
      </span>
      <span className="fee-strip__dot" aria-hidden="true" />
      <span className="fee-strip__item">
        <Icon name="coins" size={12} strokeWidth={2} />
        USDT · TON
      </span>
    </div>
  );
}
