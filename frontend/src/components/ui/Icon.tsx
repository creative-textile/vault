/**
 * Набор SVG-иконок приложения.
 *
 * Зачем свой набор, а не эмодзи:
 *  - эмодзи рисуются системным шрифтом, поэтому на Android/Windows/iOS один и
 *    тот же экран выглядит по-разному (🚀 на Windows — чёрно-белая ракета, на
 *    iOS — цветная), а в Telegram WebView часть глифов вообще отсутствует;
 *  - эмодзи нельзя перекрасить в цвет интерфейса и нельзя выровнять по базовой
 *    линии текста — отсюда «прыгающие» заголовки;
 *  - stroke-иконка наследует `currentColor`, поэтому состояние (активно/
 *    неактивно/ошибка) задаётся цветом текста, а не подменой картинки.
 *
 * Все иконки — в сетке 24×24, stroke-based (как Lucide/Feather), без внешних
 * запросов и без дополнительного веса бандла: это JSX, который tree-shake'ится.
 */
import type { CSSProperties, ReactNode } from 'react';

export type IconName =
  | 'rocket' | 'swords' | 'lock' | 'lockOpen' | 'gem' | 'vault'
  | 'wallet' | 'deposit' | 'withdraw' | 'coins' | 'dollar' | 'percent'
  | 'users' | 'user' | 'chart' | 'sliders' | 'wrench' | 'bell' | 'megaphone'
  | 'copy' | 'share' | 'link' | 'check' | 'close' | 'plus' | 'minus'
  | 'chevronLeft' | 'chevronRight' | 'chevronDown' | 'arrowRight' | 'arrowUpRight'
  | 'clock' | 'calendar' | 'timer' | 'trophy' | 'crown' | 'medal' | 'flame'
  | 'snowflake' | 'refresh' | 'play' | 'replay' | 'volume' | 'volumeOff'
  | 'alert' | 'info' | 'ban' | 'shield' | 'key' | 'eye' | 'search' | 'flag'
  | 'sparkles' | 'ghost' | 'zap' | 'trendUp' | 'trendDown' | 'equal'
  | 'list' | 'home' | 'logout' | 'target' | 'dice' | 'send' | 'edit' | 'star'
  | 'flask' | 'gift' | 'burst';

const PATHS: Record<IconName, ReactNode> = {
  rocket: (
    <>
      <path d="M12 2.6c2.6 2.2 4 5.4 4 9.1 0 1.8-.3 3.4-1 5H9c-.7-1.6-1-3.2-1-5 0-3.7 1.4-6.9 4-9.1Z" />
      <circle cx="12" cy="10" r="1.9" />
      <path d="M8.3 13.4 5 16.5v3.2l3.7-2" />
      <path d="M15.7 13.4 19 16.5v3.2l-3.7-2" />
      <path d="M10.4 18.4c.3 1.6.8 2.7 1.6 3.4.8-.7 1.3-1.8 1.6-3.4" />
    </>
  ),
  swords: (
    <>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6" />
      <path d="m16 16 4 4" />
      <path d="m19 21 2-2" />
      <path d="M14.5 6.5 18 3h3v3l-3.5 3.5" />
      <path d="m5 14 4 4" />
      <path d="m7 17-3 3" />
      <path d="m3 19 2 2" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" />
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
      <path d="M12 14.6v2.6" />
    </>
  ),
  lockOpen: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" />
      <path d="M8 10.5V7.6a4 4 0 0 1 7.7-1.4" />
      <path d="M12 14.6v2.6" />
    </>
  ),
  gem: (
    <>
      <path d="M6.2 3h11.6l3.4 5.4L12 21 2.8 8.4 6.2 3Z" />
      <path d="M2.8 8.4h18.4" />
      <path d="m9.4 8.4 2.6 12.4 2.6-12.4" />
      <path d="M6.2 3l3.2 5.4M17.8 3l-3.2 5.4" />
    </>
  ),
  vault: (
    <>
      <rect x="2.8" y="4" width="18.4" height="16" rx="2.6" />
      <circle cx="10.2" cy="12" r="3.8" />
      <path d="M10.2 8.2V6.6M10.2 17.4v-1.6M14 12h1.6M4.8 12h1.6" />
      <path d="M17.8 8.6v6.8" />
    </>
  ),
  wallet: (
    <>
      <path d="M19 7V4.6a1 1 0 0 0-1-1H5.6a2.2 2.2 0 0 0 0 4.4H19a1.6 1.6 0 0 1 1.6 1.6v6.8a1.6 1.6 0 0 1-1.6 1.6H5.4A2.4 2.4 0 0 1 3 16.6V5.8" />
      <path d="M20.6 10.4h-3.2a2 2 0 0 0 0 4h3.2" />
    </>
  ),
  deposit: (
    <>
      <path d="M12 3.2v10.6" />
      <path d="m7.6 9.6 4.4 4.4 4.4-4.4" />
      <path d="M4 16.6v2.2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.2" />
    </>
  ),
  withdraw: (
    <>
      <path d="M12 14.2V3.6" />
      <path d="M7.6 7.8 12 3.4l4.4 4.4" />
      <path d="M4 16.6v2.2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.2" />
    </>
  ),
  coins: (
    <>
      <circle cx="8.4" cy="8.4" r="5.6" />
      <path d="M17.9 10.6a5.6 5.6 0 1 1-7.3 7.3" />
      <path d="M7.4 6.2h1v4" />
      <path d="m16.4 14 .8.8-2.9 2.9" />
    </>
  ),
  dollar: (
    <>
      <path d="M12 2.6v18.8" />
      <path d="M16.6 6.6c-.6-1.3-2.3-2.1-4.6-2.1-2.7 0-4.5 1.3-4.5 3.2 0 4.4 9.3 2.1 9.3 6.7 0 2-2 3.3-4.9 3.3-2.6 0-4.4-1-5-2.5" />
    </>
  ),
  percent: (
    <>
      <path d="m5.2 18.8 13.6-13.6" />
      <circle cx="7.6" cy="7.6" r="2.6" />
      <circle cx="16.4" cy="16.4" r="2.6" />
    </>
  ),
  users: (
    <>
      <path d="M15.6 21v-1.9a3.9 3.9 0 0 0-3.9-3.9H6.3a3.9 3.9 0 0 0-3.9 3.9V21" />
      <circle cx="9" cy="7.2" r="3.9" />
      <path d="M21.6 21v-1.9a3.9 3.9 0 0 0-2.9-3.8" />
      <path d="M15.6 3.4a3.9 3.9 0 0 1 0 7.6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4.1" />
      <path d="M4.6 21a7.4 7.4 0 0 1 14.8 0" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M18.4 17V9.2" />
      <path d="M13.2 17V5.4" />
      <path d="M8 17v-3.4" />
    </>
  ),
  sliders: (
    <>
      <path d="M21 5h-6.4M10.4 5H3M21 12h-8.4M8.4 12H3M21 19h-4.4M12.4 19H3" />
      <path d="M12.6 2.8v4.4M6.4 9.8v4.4M16.6 16.8v4.4" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.9Z" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.4a6 6 0 1 0-12 0c0 6.8-2.8 8.6-2.8 8.6h17.6S18 15.2 18 8.4Z" />
      <path d="M13.7 20.6a2 2 0 0 1-3.4 0" />
    </>
  ),
  megaphone: (
    <>
      <path d="m3 10.6 14-6.2v15.2L3 13.4z" />
      <path d="M3 10.6h-.6a1.4 1.4 0 0 0 0 2.8H3" />
      <path d="M7 12.4V20a1.6 1.6 0 0 0 3.2 0v-6.4" />
      <path d="M20 10.2a2.6 2.6 0 0 1 0 3.6" />
    </>
  ),
  copy: (
    <>
      <rect x="8.8" y="8.8" width="12.4" height="12.4" rx="2.2" />
      <path d="M5.4 15.2H4.6a1.8 1.8 0 0 1-1.8-1.8V4.6a1.8 1.8 0 0 1 1.8-1.8h8.8a1.8 1.8 0 0 1 1.8 1.8v.8" />
    </>
  ),
  share: (
    <>
      <path d="M4 12.4v6.4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6.4" />
      <path d="m16 6.4-4-4-4 4" />
      <path d="M12 2.6v13" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.4a4.6 4.6 0 0 0 6.9.5l2-2a4.6 4.6 0 0 0-6.5-6.5l-1.1 1.1" />
      <path d="M13.8 10.6a4.6 4.6 0 0 0-6.9-.5l-2 2a4.6 4.6 0 0 0 6.5 6.5l1.1-1.1" />
    </>
  ),
  check: <path d="m4.6 12.6 4.8 4.8L19.4 7.4" />,
  close: <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  chevronLeft: <path d="m14.6 5.4-7 6.6 7 6.6" />,
  chevronRight: <path d="m9.4 5.4 7 6.6-7 6.6" />,
  chevronDown: <path d="m5.4 9.2 6.6 6.4 6.6-6.4" />,
  arrowRight: (
    <>
      <path d="M3.6 12h16" />
      <path d="m13.6 5.8 6.2 6.2-6.2 6.2" />
    </>
  ),
  arrowUpRight: (
    <>
      <path d="M6.6 17.4 17.4 6.6" />
      <path d="M8.6 6.6h8.8v8.8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.8V12l3.4 2" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.4" r="7.8" />
      <path d="M12 9.6v3.8l2.6 1.6" />
      <path d="M9.2 2.6h5.6" />
      <path d="m19.4 6.6 1.4-1.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.4" y="5" width="17.2" height="16" rx="2.4" />
      <path d="M8 2.8v4.4M16 2.8v4.4M3.4 10.4h17.2" />
    </>
  ),
  trophy: (
    <>
      <path d="M18 2.8H6v6.4a6 6 0 0 0 12 0V2.8Z" />
      <path d="M6 5.6H4.4a2.4 2.4 0 0 0 0 4.8H6" />
      <path d="M18 5.6h1.6a2.4 2.4 0 0 1 0 4.8H18" />
      <path d="M10 14.8V17c0 .6-.5 1-1 1.2-.9.4-1.4 1.4-1.4 2.8" />
      <path d="M14 14.8V17c0 .6.5 1 1 1.2.9.4 1.4 1.4 1.4 2.8" />
      <path d="M4.4 21.2h15.2" />
    </>
  ),
  crown: (
    <>
      <path d="m3 18 1.6-9.4 4.6 4L12 4.6l2.8 8 4.6-4L21 18z" />
      <path d="M3.6 21h16.8" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15" r="6" />
      <path d="m8.6 9.4-3-6.6h4.8l2 4.2" />
      <path d="m15.4 9.4 3-6.6h-4.8" />
      <path d="m12 12.4 1 2 2.2.3-1.6 1.6.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.6 2.2-.3z" />
    </>
  ),
  flame: (
    <>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />
    </>
  ),
  snowflake: (
    <>
      <path d="M2.6 12h18.8M12 2.6v18.8" />
      <path d="m19.6 15.6-3.6-3.6 3.6-3.6" />
      <path d="m4.4 8.4 3.6 3.6-3.6 3.6" />
      <path d="M15.6 4.4 12 8 8.4 4.4" />
      <path d="m8.4 19.6 3.6-3.6 3.6 3.6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.8 12a8.8 8.8 0 1 1-2.6-6.2" />
      <path d="M21 3.4v5.4h-5.4" />
    </>
  ),
  play: <path d="m7.4 4.4 12 7.6-12 7.6z" />,
  replay: (
    <>
      <path d="M3.2 12a8.8 8.8 0 1 0 2.6-6.2" />
      <path d="M3 3.4v5.4h5.4" />
      <path d="M12 7.8V12l2.8 1.8" />
    </>
  ),
  volume: (
    <>
      <path d="M11 4.8 6.6 8.8H3.2v6.4h3.4L11 19.2z" />
      <path d="M15.2 9.2a4.2 4.2 0 0 1 0 5.6" />
      <path d="M18 6.4a8.2 8.2 0 0 1 0 11.2" />
    </>
  ),
  volumeOff: (
    <>
      <path d="M11 4.8 6.6 8.8H3.2v6.4h3.4L11 19.2z" />
      <path d="m15.6 9.6 5 4.8M20.6 9.6l-5 4.8" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.2v4.2M12 17.4h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.2v5M12 7.9h.01" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.8 5.8 12.4 12.4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 21.4s8-3.8 8-9.6V5.2L12 2.4 4 5.2v6.6c0 5.8 8 9.6 8 9.6Z" />
      <path d="m8.8 11.8 2.2 2.2 4.2-4.4" />
    </>
  ),
  key: (
    <>
      <circle cx="7.8" cy="15.8" r="4.4" />
      <path d="m11 12.7 8.2-8.2" />
      <path d="m16.6 5 2.6 2.6" />
      <path d="m14.2 7.4 2 2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="7" />
      <path d="m20.4 20.4-4.4-4.4" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21.2V3.4h13.2l-2.4 4.4 2.4 4.4H5" />
    </>
  ),
  sparkles: (
    <>
      <path d="m11.4 3.2 1.7 4.5 4.5 1.7-4.5 1.7-1.7 4.5-1.7-4.5-4.5-1.7 4.5-1.7z" />
      <path d="m18.2 14.6.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" />
      <path d="m4.8 14 .6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
    </>
  ),
  ghost: (
    <>
      <path d="M4.8 20.8V10.4a7.2 7.2 0 0 1 14.4 0v10.4l-2.4-2-2.4 2-2.4-2-2.4 2-2.4-2z" />
      <path d="M9.6 10.2h.01M14.4 10.2h.01" />
    </>
  ),
  zap: <path d="M13.2 2.4 4.8 13.6h6L10 21.6l8.8-11.6h-6.2z" />,
  trendUp: (
    <>
      <path d="m3 17.2 6-6 4 4 8-8" />
      <path d="M15.4 7.2h5.6v5.6" />
    </>
  ),
  trendDown: (
    <>
      <path d="m3 7.2 6 6 4-4 8 8" />
      <path d="M15.4 17.2h5.6v-5.6" />
    </>
  ),
  equal: <path d="M4.6 9.4h14.8M4.6 14.6h14.8" />,
  list: (
    <>
      <path d="M8.4 6.2h12.4M8.4 12h12.4M8.4 17.8h12.4" />
      <path d="M3.8 6.2h.01M3.8 12h.01M3.8 17.8h.01" />
    </>
  ),
  home: (
    <>
      <path d="m3.2 10.6 8.8-7.4 8.8 7.4v8.8a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2z" />
      <path d="M9.4 21.4v-7h5.2v7" />
    </>
  ),
  logout: (
    <>
      <path d="M9.4 21.2H5.2a2 2 0 0 1-2-2V4.8a2 2 0 0 1 2-2h4.2" />
      <path d="m15.8 16.6 4.6-4.6-4.6-4.6" />
      <path d="M20.4 12H9.2" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  dice: (
    <>
      <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3.6" />
      <path d="M8.4 8.4h.01M15.6 8.4h.01M12 12h.01M8.4 15.6h.01M15.6 15.6h.01" />
    </>
  ),
  send: (
    <>
      <path d="M21.2 2.8 10.6 13.4" />
      <path d="m21.2 2.8-6.6 18.4-4-8.8-8.8-4z" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4.2L19.4 8.8a2.1 2.1 0 0 0-3-3L5.2 17z" />
      <path d="m14.8 5.4 3.8 3.8" />
    </>
  ),
  star: (
    <>
      <path d="m12 3.2 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.7l6.1-.9z" />
    </>
  ),
  flask: (
    <>
      <path d="M9.5 3h5" />
      <path d="M10.5 3v6.2L5.6 17.4A2 2 0 0 0 7.3 20.5h9.4a2 2 0 0 0 1.7-3.1L13.5 9.2V3" />
      <path d="M8.2 14.5h7.6" />
    </>
  ),
  burst: (
    <>
      <path d="M12 3.4 13.9 9l5.6-1.9-3.7 4.4 4.6 3.1-5.8.4.9 5.6L12 17.9l-3.5 2.7.9-5.6-5.8-.4 4.6-3.1L4.5 7.1 10.1 9z" />
    </>
  ),
  gift: (
    <>
      <path d="M3.5 9.5h17V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
      <path d="M2.5 6.5h19v3h-19z" />
      <path d="M12 6.5V21" />
      <path d="M12 6.5S10.8 3 8.9 3a1.9 1.9 0 0 0 0 3.5zM12 6.5S13.2 3 15.1 3a1.9 1.9 0 0 1 0 3.5z" />
    </>
  )
};

interface Props {
  name: IconName;
  /** Размер в px. Иконка наследует размер шрифта, если передать `undefined`. */
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  /** Залить контур цветом (для «монолитных» акцентов). */
  filled?: boolean;
  title?: string;
}

export default function Icon({
  name, size = 18, strokeWidth = 1.75, className, style, filled = false, title
}: Props) {
  return (
    <svg
      className={['icon', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      style={style}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
