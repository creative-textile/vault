/**
 * Фабрика текстур: всё рисуется на canvas кодом.
 *
 * Никаких скачанных картинок — по двум причинам. Во-первых, внешние хосты из
 * Telegram Mini App недоступны, а во-вторых, растровые ассеты такого качества
 * стоят 200 КБ–2 МБ каждый и убивают первый экран на мобильной сети. Canvas
 * даёт 2–15 КБ на текстуру, идеальную резкость на любом DPR и возможность
 * перерисовать арт под бренд (надпись VAULT, номиналы, цвета зала).
 *
 * Каждая функция кэшируется по ключу: сцена не должна перерисовывать canvas
 * на каждый кадр или на каждый ремаунт.
 */
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function cached(key: string, size: [number, number], draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;

  const [w, h] = size;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  draw(ctx, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/* ═══════════════════════════ ЧАСТИЦЫ И БЛИКИ ═══════════════════════════ */

/** Мягкая круглая точка — базовый спрайт для искр, пыли, звёзд, дыма. */
export function glowSprite(color = '#ffffff', hardness = 0.0): THREE.CanvasTexture {
  const key = `glow:${color}:${hardness}`;
  return cached(key, [128, 128], (ctx, w, h) => {
    const r = w / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, color);
    g.addColorStop(Math.min(0.9, 0.12 + hardness), color);
    g.addColorStop(0.42, withAlpha(color, 0.42));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Четырёхлучевая звезда — блики на металле и яркие звёзды фона. */
export function starFlare(color = '#ffffff'): THREE.CanvasTexture {
  return cached(`star:${color}`, [128, 128], (ctx, w, h) => {
    const r = w / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, color);
    g.addColorStop(0.16, withAlpha(color, 0.55));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Лучи
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const lg = ctx.createLinearGradient(
        r - Math.cos(a) * r, r - Math.sin(a) * r,
        r + Math.cos(a) * r, r + Math.sin(a) * r
      );
      lg.addColorStop(0, withAlpha(color, 0));
      lg.addColorStop(0.5, withAlpha(color, 0.85));
      lg.addColorStop(1, withAlpha(color, 0));
      ctx.strokeStyle = lg;
      ctx.lineWidth = i % 2 === 0 ? 5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(r - Math.cos(a) * r, r - Math.sin(a) * r);
      ctx.lineTo(r + Math.cos(a) * r, r + Math.sin(a) * r);
      ctx.stroke();
    }
  });
}

/** Клуб дыма: неровное пятно, а не идеальный круг (иначе дым выглядит как горох). */
export function smokeSprite(): THREE.CanvasTexture {
  return cached('smoke:v2', [128, 128], (ctx, w, h) => {
    const r = w / 2;
    ctx.globalCompositeOperation = 'source-over';
    // 14 смещённых мягких пятен дают рваный силуэт
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const d = r * 0.32 * (0.4 + ((i * 37) % 10) / 10);
      const cx = r + Math.cos(a) * d;
      const cy = r + Math.sin(a) * d;
      const rr = r * (0.42 + ((i * 53) % 10) / 26);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, 'rgba(255,255,255,0.30)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    // Обрезаем края, чтобы спрайт не светился квадратом
    const mask = ctx.createRadialGradient(r, r, r * 0.2, r, r, r);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, w, h);
  }, false);
}

/** Вытянутая полоса — след искры/снаряда на длинной выдержке. */
export function streakSprite(color = '#ffd28a'): THREE.CanvasTexture {
  return cached(`streak:${color}`, [64, 256], (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, withAlpha(color, 0));
    g.addColorStop(0.5, color);
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.2, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

/* ═══════════════════════════ МЕТАЛЛ И ПОВЕРХНОСТИ ══════════════════════ */

/**
 * Шлифованный металл: карта шероховатости с направленными рисками.
 * Без неё золото выглядит как пластиковая отливка — блик получается ровным
 * и «мёртвым», а риски дают ему жизнь и анизотропию.
 */
export function brushedMetal(opts: { base?: number; strength?: number; circular?: boolean } = {}): THREE.CanvasTexture {
  const { base = 128, strength = 46, circular = false } = opts;
  return cached(`brushed:${base}:${strength}:${circular}`, [512, 512], (ctx, w, h) => {
    // Детерминированный ГПСЧ: риски металла одинаковы у всех игроков
    let seed = ((base * 7919 + strength * 104729) ^ (circular ? 0x5f3759df : 0)) >>> 0 || 123456789;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    ctx.fillStyle = `rgb(${base},${base},${base})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.5;
    if (circular) {
      // Круговая шлифовка (как на настоящих монетах и циферблатах)
      for (let i = 0; i < 900; i++) {
        const r = rnd() * (w / 2);
        const a0 = rnd() * Math.PI * 2;
        const a1 = a0 + (rnd() * 0.5 + 0.08);
        const v = base + (rnd() - 0.5) * strength * 2;
        ctx.strokeStyle = `rgb(${v},${v},${v})`;
        ctx.lineWidth = rnd() * 1.4 + 0.2;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, r, a0, a1);
        ctx.stroke();
      }
    } else {
      // Продольная шлифовка
      for (let i = 0; i < 2600; i++) {
        const y = rnd() * h;
        const x = rnd() * w;
        const len = rnd() * 90 + 12;
        const v = base + (rnd() - 0.5) * strength * 2;
        ctx.strokeStyle = `rgb(${v},${v},${v})`;
        ctx.lineWidth = rnd() * 1.2 + 0.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y + (rnd() - 0.5) * 1.5);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }, false);
}

/** Диагональные жёлто-чёрные полосы опасности (площадка ракеты, порог сейфа). */
export function hazardStripes(yellow = '#f5c542', dark = '#14141c', stripe = 34): THREE.CanvasTexture {
  const t = cached(`hazard:${yellow}:${dark}:${stripe}`, [256, 256], (ctx, w, h) => {
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = yellow;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.translate(-w, -h);
    for (let x = -w; x < w * 2; x += stripe * 2) ctx.fillRect(x, 0, stripe, h * 2);
    ctx.restore();
    // Потёртости: полосы не должны быть идеальными
    // Детерминированный ГПСЧ вместо Math.random
    let seed = 777001 >>> 0 || 1;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.14)';
      ctx.fillRect(rnd() * w, rnd() * h, rnd() * 26, rnd() * 3);
    }
    ctx.globalAlpha = 1;
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Технологические панели корпуса ракеты: линии расшивки, люки, заклёпки. */
export function hullPanels(): THREE.CanvasTexture {
  const t = cached('hull:v2', [512, 512], (ctx, w, h) => {
    ctx.fillStyle = '#f2f3f7';
    ctx.fillRect(0, 0, w, h);
    // Детерминированный ГПСЧ вместо Math.random
    let seed = 777002 >>> 0 || 1;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    // Лёгкая пятнистость краски
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = `rgba(${180 + rnd() * 40},${182 + rnd() * 40},${190 + rnd() * 40},0.10)`;
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, rnd() * 26 + 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Линии расшивки
    ctx.strokeStyle = 'rgba(60,64,84,0.55)';
    ctx.lineWidth = 2;
    [0.18, 0.42, 0.62, 0.84].forEach((y) => {
      ctx.beginPath(); ctx.moveTo(0, y * h); ctx.lineTo(w, y * h); ctx.stroke();
    });
    [0.25, 0.5, 0.75].forEach((x) => {
      ctx.beginPath(); ctx.moveTo(x * w, 0); ctx.lineTo(x * w, h); ctx.stroke();
    });
    // Заклёпки вдоль швов
    ctx.fillStyle = 'rgba(120,126,150,0.6)';
    for (let x = 8; x < w; x += 22) {
      [0.18, 0.42, 0.62, 0.84].forEach((y) => {
        ctx.beginPath(); ctx.arc(x, y * h - 6, 1.7, 0, Math.PI * 2); ctx.fill();
      });
    }
    // Техническая маркировка
    ctx.fillStyle = 'rgba(70,74,96,0.5)';
    ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.fillText('VAULT-9', 16, 0.36 * h);
    ctx.fillText('⚠ CRYO', 16, 0.78 * h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ═══════════════════════════ МОНЕТА (ДУЭЛЬ) ════════════════════════════ */

export type CoinSide = 'heads' | 'tails';

/**
 * Лицо золотой монеты: гурт-бусины, лавровый венок, эмблема, надпись VAULT.
 *
 * Прежняя монета была цилиндром с тремя плоскими цветами и пятью белыми
 * шариками — «выглядела очень странно». Здесь рисунок настоящий, и он же
 * работает картой рельефа (bumpMap): эмблема и буквы физически выступают,
 * поэтому на вращении блик бежит по чеканке, а не по гладкому диску.
 */
export function coinFace(side: CoinSide): THREE.CanvasTexture {
  const S = 1024;
  return cached(`coin:${side}:v3`, [S, S], (ctx, w) => {
    const c = w / 2;
    // Поле монеты: радиальный градиент золота (центр светлее — как чеканка)
    const field = ctx.createRadialGradient(c * 0.72, c * 0.66, 10, c, c, c);
    field.addColorStop(0, '#fff6cf');
    field.addColorStop(0.34, '#f7d05f');
    field.addColorStop(0.72, '#d99a12');
    field.addColorStop(1, '#8c5a06');
    ctx.fillStyle = field;
    ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();

    // Круговая шлифовка поля
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, c * 0.99, 0, Math.PI * 2); ctx.clip();
    // Детерминированный ГПСЧ вместо Math.random
    let seed = 777003 >>> 0 || 1;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 1500; i++) {
      const r = rnd() * c;
      const a0 = rnd() * Math.PI * 2;
      ctx.strokeStyle = rnd() > 0.5 ? '#fff8dd' : '#7a4e04';
      ctx.lineWidth = rnd() * 1.5 + 0.2;
      ctx.beginPath(); ctx.arc(c, c, r, a0, a0 + rnd() * 0.4 + 0.05); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Гурт: бусины по окружности
    ctx.save();
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const x = c + Math.cos(a) * c * 0.945;
      const y = c + Math.sin(a) * c * 0.945;
      const bg = ctx.createRadialGradient(x - 2, y - 2, 0, x, y, 9);
      bg.addColorStop(0, '#fff8dd');
      bg.addColorStop(0.6, '#e0a91c');
      bg.addColorStop(1, '#7a4e04');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(x, y, 8.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Внешний ободок и внутреннее кольцо
    ring(ctx, c, c, c * 0.9, 10, '#a9720a', '#ffe9a8');
    ring(ctx, c, c, c * 0.8, 5, '#ffe9a8', '#a9720a');

    // Лавровый венок (две ветви)
    laurel(ctx, c, c, c * 0.7, side === 'heads' ? '#ffe9a8' : '#fff0bd');

    if (side === 'heads') {
      // ОРЁЛ: звезда в круге + расходящиеся лучи
      ctx.save();
      ctx.translate(c, c * 0.94);
      const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, c * 0.52);
      halo.addColorStop(0, 'rgba(255,247,214,0.95)');
      halo.addColorStop(1, 'rgba(255,247,214,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, c * 0.52, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 16; i++) {
        ctx.rotate((Math.PI * 2) / 16);
        ctx.fillStyle = i % 2 ? 'rgba(255,240,190,0.42)' : 'rgba(255,248,220,0.72)';
        ctx.beginPath();
        ctx.moveTo(0, -c * 0.2);
        ctx.lineTo(c * 0.035, -c * 0.47);
        ctx.lineTo(-c * 0.035, -c * 0.47);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      star(ctx, c, c * 0.94, c * 0.3, '#fff8dd', '#b8860b');
      text(ctx, c, c * 0.36, 'VAULT', c * 0.155, '#fff3c4', '#8c5a06');
      text(ctx, c, c * 1.62, 'ГОЛОВА', c * 0.095, '#ffe9a8', '#8c5a06');
    } else {
      // РЕШКА: герб хранилища — сейф с ручкой
      ctx.save();
      ctx.translate(c, c * 0.96);
      const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, c * 0.5);
      halo.addColorStop(0, 'rgba(255,247,214,0.9)');
      halo.addColorStop(1, 'rgba(255,247,214,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, c * 0.5, 0, Math.PI * 2); ctx.fill();
      // Корпус сейфа
      const bw = c * 0.5, bh = c * 0.46;
      const body = ctx.createLinearGradient(-bw, -bh, bw, bh);
      body.addColorStop(0, '#fff3c4');
      body.addColorStop(0.5, '#e6b422');
      body.addColorStop(1, '#96640a');
      ctx.fillStyle = body;
      roundRect(ctx, -bw, -bh, bw * 2, bh * 2, 16);
      ctx.fill();
      ctx.strokeStyle = '#7a4e04'; ctx.lineWidth = 7; ctx.stroke();
      // Дверь и ручка-кольцо
      ctx.strokeStyle = '#8c5a06'; ctx.lineWidth = 5;
      roundRect(ctx, -bw * 0.72, -bh * 0.72, bw * 1.44, bh * 1.44, 10); ctx.stroke();
      ctx.lineWidth = 13; ctx.strokeStyle = '#fff8dd';
      ctx.beginPath(); ctx.arc(0, 0, bw * 0.34, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 6; ctx.strokeStyle = '#8c5a06';
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * bw * 0.2, Math.sin(a) * bw * 0.2);
        ctx.lineTo(Math.cos(a) * bw * 0.52, Math.sin(a) * bw * 0.52);
        ctx.stroke();
      }
      // Заклёпки по углам
      ctx.fillStyle = '#fff8dd';
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
        ctx.beginPath(); ctx.arc(sx * bw * 0.84, sy * bh * 0.84, 7, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
      text(ctx, c, c * 0.36, 'VAULT', c * 0.155, '#fff3c4', '#8c5a06');
      text(ctx, c, c * 1.62, 'РЕШКА', c * 0.095, '#ffe9a8', '#8c5a06');
    }

    // Потёртости по краю: монета не выглядит только что отчеканенной
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.clip();
    ctx.globalAlpha = 0.13;
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = rnd() > 0.5 ? '#fffbe8' : '#6b4403';
      ctx.lineWidth = rnd() * 2.4 + 0.4;
      const a = rnd() * Math.PI * 2;
      const r0 = c * (0.55 + rnd() * 0.44);
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a + 0.2) * r0 * 1.06, c + Math.sin(a + 0.2) * r0 * 1.06);
      ctx.stroke();
    }
    ctx.restore();
  });
}

/** Гурт (ребро) монеты: насечка + надпись — то, что видно в полёте сбоку. */
export function coinEdge(): THREE.CanvasTexture {
  const t = cached('coin-edge:v2', [1024, 64], (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#8c5a06');
    g.addColorStop(0.22, '#ffe9a8');
    g.addColorStop(0.5, '#d99a12');
    g.addColorStop(0.8, '#ffe9a8');
    g.addColorStop(1, '#7a4e04');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Насечка
    ctx.strokeStyle = 'rgba(90,58,4,0.75)';
    ctx.lineWidth = 2;
    for (let x = 0; x < w; x += 8) {
      ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, h - 2); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,248,221,0.4)';
    ctx.lineWidth = 1;
    for (let x = 3; x < w; x += 8) {
      ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, h - 2); ctx.stroke();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/* ═══════════════════════════ БАРАБАНЫ СЕЙФА ════════════════════════════ */

/**
 * Плашка одной цифры для барабана сейфа.
 *
 * Критично для игры: прежде 3D-барабаны были просто цветными цилиндрами, и
 * цифру на них видно не было — игрок смотрел на DOM-кружки рядом. Теперь у
 * каждого барабана 10 таких плашек по окружности, и цифра читается на самой
 * модели (см. SafeCrackScene — поворот выводится из той же формулы digitAt).
 */
export function digitPlate(digit: number, opts: { face?: string; accent?: string } = {}): THREE.CanvasTexture {
  const { face = '#0d1024', accent = '#f5c542' } = opts;
  // 1024px: при игровом наезде камеры плашки занимают пол-экрана —
  // цифры обязаны быть идеально резкими
  return cached(`digit:${digit}:${face}:${accent}:2`, [1024, 1024], (ctx, w, h) => {
    // Детерминированный шум вместо Math.random (ограничение ТЗ): риски
    // металла обязаны быть одинаковыми от кадра к кадру и между клиентами.
    let rs = (digit + 7) * 2654435761 % 4294967296;
    const rnd = () => {
      rs = (rs * 1664525 + 1013904223) % 4294967296;
      return rs / 4294967296;
    };

    // Фон плашки: почти чёрный — цифра светится на нём как табло
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#141833');
    g.addColorStop(0.45, face);
    g.addColorStop(1, '#03040a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Тонкие риски металла — только тёмные, чтобы не сбивать контраст цифры
    ctx.globalAlpha = 0.09;
    for (let i = 0; i < 100; i++) {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = rnd() * 1.3;
      const y = rnd() * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (rnd() - 0.5) * 3); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Цифра: раскалённо-белая с золотым низом и ореолом — читается в любом
    // свете. Крупная (0.86 высоты), жирная, с тёмным тиснением.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(h * 0.86)}px 'Orbitron', 'Russo One', ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(0,0,0,0.95)';
    ctx.fillText(String(digit), w / 2 + h * 0.016, h / 2 + h * 0.047);
    const tg = ctx.createLinearGradient(0, h * 0.08, 0, h * 0.92);
    tg.addColorStop(0, '#ffffff');
    tg.addColorStop(0.35, '#ffe9a8');
    tg.addColorStop(0.75, accent);
    tg.addColorStop(1, '#c08a12');
    ctx.fillStyle = tg;
    ctx.fillText(String(digit), w / 2, h / 2 + 2);
    ctx.lineWidth = h * 0.016;
    ctx.strokeStyle = 'rgba(255,248,221,0.85)';
    ctx.strokeText(String(digit), w / 2, h / 2 + h * 0.008);

    // Ореол вокруг цифры — свечение видно даже в тени
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.52);
    halo.addColorStop(0, withAlpha(accent, 0.4));
    halo.addColorStop(1, withAlpha(accent, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Градуировка лимба (кольцо с делениями вокруг диска сейфа). */
export function dialGraduation(): THREE.CanvasTexture {
  return cached('dial:v2', [512, 512], (ctx, w) => {
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);
    ctx.save();
    ctx.translate(c, c);
    for (let i = 0; i < 100; i++) {
      const a = (i / 100) * Math.PI * 2;
      const major = i % 10 === 0;
      const mid = i % 5 === 0;
      ctx.rotate((Math.PI * 2) / 100);
      ctx.fillStyle = major ? '#ffe9a8' : mid ? 'rgba(255,233,168,.7)' : 'rgba(255,233,168,.38)';
      const len = major ? 34 : mid ? 22 : 13;
      ctx.fillRect(-2, -c * 0.96, major ? 5 : 3, len);
    }
    ctx.restore();
    // Числа каждые 10
    ctx.fillStyle = '#fff3c4';
    ctx.font = `700 ${Math.round(w * 0.052)}px 'Orbitron', ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = c + Math.cos(a) * c * 0.74;
      const y = c + Math.sin(a) * c * 0.74;
      ctx.fillText(String(i * 10).padStart(2, '0'), x, y);
    }
  });
}

/** Табличка с гравировкой (дверь сейфа, корпус ракеты). */
export function engravedPlate(label: string, sub = ''): THREE.CanvasTexture {
  return cached(`plate:${label}:${sub}`, [512, 192], (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#4a4f6e');
    g.addColorStop(0.34, '#8b91b4');
    g.addColorStop(0.52, '#c8cde6');
    g.addColorStop(0.72, '#6f759a');
    g.addColorStop(1, '#3c405c');
    ctx.fillStyle = g;
    roundRect(ctx, 0, 0, w, h, 18);
    ctx.fill();
    // Рамка и винты
    ctx.strokeStyle = 'rgba(20,22,38,0.75)';
    ctx.lineWidth = 6;
    roundRect(ctx, 12, 12, w - 24, h - 24, 12); ctx.stroke();
    ctx.fillStyle = '#2b2e44';
    [[26, 26], [w - 26, 26], [26, h - 26], [w - 26, h - 26]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.stroke();
    });
    // Гравировка: тёмная надпись со светлой кромкой снизу (вдавленный эффект)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(h * 0.34)}px 'Orbitron', 'Russo One', sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(label, w / 2, h / 2 + 3 + (sub ? -8 : 0));
    ctx.fillStyle = '#1b1d2e';
    ctx.fillText(label, w / 2, h / 2 + (sub ? -8 : 0));
    if (sub) {
      ctx.font = `700 ${Math.round(h * 0.13)}px 'Russo One', sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillText(sub, w / 2, h / 2 + h * 0.24 + 2);
      ctx.fillStyle = '#252841';
      ctx.fillText(sub, w / 2, h / 2 + h * 0.24);
    }
  });
}


/** Бетон стартовой площадки: детерминированный шум + потёки (без Math.random). */
export function concrete(): THREE.CanvasTexture {
  return cached('concrete:v1', [512, 512], (ctx, w, h) => {
    const rnd = (i: number) => {
      const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    ctx.fillStyle = '#3a3d46';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) {
      const x = rnd(i) * w, y = rnd(i + 500) * h, r = 6 + rnd(i + 900) * 46;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd(i + 77) > 0.5;
      g.addColorStop(0, dark ? 'rgba(20,22,28,.16)' : 'rgba(120,124,134,.10)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 5200; i++) {
      const v = 40 + rnd(i * 3) * 60;
      ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v + 6) | 0},${0.05 + rnd(i) * 0.08})`;
      ctx.fillRect(rnd(i + 1) * w, rnd(i + 2) * h, 1.4, 1.4);
    }
    ctx.strokeStyle = 'rgba(18,20,26,.35)';
    for (let i = 0; i < 14; i++) {
      ctx.lineWidth = 0.7 + rnd(i + 40) * 1.4;
      ctx.beginPath();
      let x = rnd(i + 60) * w, y = 0;
      ctx.moveTo(x, y);
      for (let k = 0; k < 9; k++) {
        x += (rnd(i * 9 + k) - 0.5) * 46;
        y += h / 9;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(12,14,18,.5)';
    ctx.lineWidth = 3;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((w / 4) * i, 0); ctx.lineTo((w / 4) * i, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke();
    }
  });
}

/** Огненный шар взрыва: турбулентные лепестки вокруг ядра (детерминированно). */
export function fireball(): THREE.CanvasTexture {
  return cached('fireball:v1', [256, 256], (ctx, w) => {
    const rnd = (i: number) => {
      const x = Math.sin(i * 91.7 + 47.3) * 24634.6345;
      return x - Math.floor(x);
    };
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);
    for (let i = 0; i < 46; i++) {
      const a = rnd(i) * Math.PI * 2;
      const d = rnd(i + 9) * c * 0.62;
      const r = c * (0.16 + rnd(i + 21) * 0.30);
      const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const hot = rnd(i + 33) > 0.42;
      g.addColorStop(0, hot ? 'rgba(255,214,120,.9)' : 'rgba(255,106,26,.8)');
      g.addColorStop(0.55, 'rgba(255,84,20,.34)');
      g.addColorStop(1, 'rgba(120,20,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5);
    core.addColorStop(0, 'rgba(255,246,214,1)');
    core.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(c, c, c * 0.5, 0, Math.PI * 2); ctx.fill();
  });
}


/** Стена арены: тёмный цилиндр с неоновыми пилястрами (глубина вместо пустоты). */
export function arenaWall(): THREE.CanvasTexture {
  return cached('arenaWall:v1', [1024, 256], (ctx, w, h) => {
    const rnd = (i: number) => {
      const x = Math.sin(i * 57.3 + 11.9) * 34621.4321;
      return x - Math.floor(x);
    };
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#05030c');
    g.addColorStop(0.72, '#0b0718');
    g.addColorStop(1, '#160f2b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // пилястры: чередование фиолетовых и циановых полос, тающих вверх
    for (let i = 0; i < 24; i++) {
      const x = (i + 0.5) * (w / 24);
      const col = i % 2 ? '34,211,238' : '168,85,247';
      const hh = h * (0.35 + rnd(i) * 0.4);
      const lg = ctx.createLinearGradient(0, h, 0, h - hh);
      lg.addColorStop(0, `rgba(${col},.5)`);
      lg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = lg;
      ctx.fillRect(x - 3, h - hh, 6, hh);
      ctx.fillStyle = `rgba(${col},.8)`;
      ctx.fillRect(x - 1.2, h - 14, 2.4, 14);
    }
    // нижняя световая линия
    const bl = ctx.createLinearGradient(0, h, 0, h - 10);
    bl.addColorStop(0, 'rgba(245,197,66,.8)');
    bl.addColorStop(1, 'rgba(245,197,66,0)');
    ctx.fillStyle = bl;
    ctx.fillRect(0, h - 10, w, 10);
  });
}

/** Вертикальный световой пилон: мягкая колонна света (альфа тает вверх). */
export function lightPillar(color = '#22d3ee'): THREE.CanvasTexture {
  return cached(`pillar:${color}`, [128, 256], (ctx, w, h) => {
    const lg = ctx.createLinearGradient(0, h, 0, 0);
    lg.addColorStop(0, withAlpha(color, 0.85));
    lg.addColorStop(0.5, withAlpha(color, 0.28));
    lg.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, w, h);
    // мягкие края по горизонтали
    ctx.globalCompositeOperation = 'destination-in';
    const hg = ctx.createLinearGradient(0, 0, w, 0);
    hg.addColorStop(0, 'rgba(0,0,0,0)');
    hg.addColorStop(0.5, 'rgba(0,0,0,1)');
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);
  });
}


/** Чёрный полированный мрамор с золотыми прожилками — пол и постаменты. */
export function blackMarble(): THREE.CanvasTexture {
  return cached('blackMarble:v1', [512, 512], (ctx, w, h) => {
    const rnd = (i: number) => {
      const x = Math.sin(i * 74.7 + 7.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b0b12');
    g.addColorStop(0.5, '#101018');
    g.addColorStop(1, '#0a0a10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // широкие дымчатые разводы
    for (let i = 0; i < 26; i++) {
      const x = rnd(i) * w, y = rnd(i + 31) * h, r = 40 + rnd(i + 61) * 120;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${i % 3 ? '38,38,52' : '26,24,36'},.22)`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // прожилки: золото и серебро, ветвящиеся линии
    for (let i = 0; i < 16; i++) {
      const gold = i % 3 === 0;
      ctx.strokeStyle = gold ? 'rgba(212,175,55,.4)' : 'rgba(190,196,224,.22)';
      ctx.lineWidth = gold ? 1.6 : 1.1;
      ctx.beginPath();
      let x = rnd(i + 7) * w, y = 0;
      ctx.moveTo(x, y);
      for (let k = 0; k < 12; k++) {
        x += (rnd(i * 13 + k) - 0.5) * 70;
        y += h / 12;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      // тонкие ответвления
      ctx.strokeStyle = gold ? 'rgba(212,175,55,.18)' : 'rgba(190,196,224,.1)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x - 30, y - h / 4);
      ctx.lineTo(x + 26, y);
      ctx.stroke();
    }
    // блики полировки
    for (let i = 0; i < 8; i++) {
      const x = rnd(i + 91) * w, y = rnd(i + 121) * h;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 60 + rnd(i) * 60);
      rg.addColorStop(0, 'rgba(255,255,255,.05)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

/**
 * Клеймо слитка: «VAULT 999.9 FINE GOLD». Тёмная гравировка на прозрачном —
 * кладётся отдельной плоскостью на верхнюю грань слитка.
 */
export function ingotStamp(): THREE.CanvasTexture {
  const W = 256;
  const H = 88;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return new THREE.CanvasTexture(c);

  // Двойная рамка штампа
  g.strokeStyle = 'rgba(74,58,14,0.85)';
  g.lineWidth = 5;
  g.strokeRect(10, 8, W - 20, H - 16);
  g.lineWidth = 2;
  g.strokeRect(20, 16, W - 40, H - 32);

  // Гравировка: тёмный знак + светлый сдвиг вниз-вправо (эффект чеканки)
  const draw = (color: string, ox: number, oy: number) => {
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 34px Georgia, serif';
    g.fillText('VAULT', W / 2 + ox, 32 + oy);
    g.font = '700 19px Georgia, serif';
    g.fillText('999.9 · FINE GOLD', W / 2 + ox, 62 + oy);
  };
  draw('rgba(255,236,180,0.5)', 1.4, 1.4);
  draw('rgba(58,44,8,0.95)', 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Золотой медальон арены: компасная роза судьбы под монетой.
 * Прозрачный фон — кладётся декалью на мрамор.
 */
export function arenaMedallion(): THREE.CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  if (!g) return new THREE.CanvasTexture(c);
  const cx = S / 2, cy = S / 2;

  g.strokeStyle = 'rgba(232,196,110,0.9)';
  g.lineWidth = 10;
  g.beginPath(); g.arc(cx, cy, 470, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 4;
  g.beginPath(); g.arc(cx, cy, 430, 0, Math.PI * 2); g.stroke();

  // Лучи розы: 8 длинных, 16 коротких
  g.fillStyle = 'rgba(232,196,110,0.75)';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.save();
    g.translate(cx, cy); g.rotate(a);
    g.beginPath();
    g.moveTo(0, -410); g.lineTo(26, -120); g.lineTo(-26, -120);
    g.closePath(); g.fill();
    g.restore();
  }
  g.fillStyle = 'rgba(232,196,110,0.4)';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
    g.save();
    g.translate(cx, cy); g.rotate(a);
    g.beginPath();
    g.moveTo(0, -300); g.lineTo(14, -110); g.lineTo(-14, -110);
    g.closePath(); g.fill();
    g.restore();
  }

  // Центральное кольцо и бусины по ободу
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(232,196,110,0.9)';
  g.beginPath(); g.arc(cx, cy, 96, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(232,196,110,0.85)';
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    g.beginPath();
    g.arc(cx + Math.cos(a) * 450, cy + Math.sin(a) * 450, 7, 0, Math.PI * 2);
    g.fill();
  }

  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Радиальное затухание 1→0: альфа-карта для пола, который растворяется
 * в фоне карточки (прозрачная сцена витрины).
 */
export function radialFade(): THREE.CanvasTexture {
  return cached('radialFade', [256, 256], (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.08, w / 2, h / 2, w * 0.5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.62, '#ffffff');
    g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/* ═══════════════════════════ ПОЛ И ФОН ═════════════════════════════════ */

/** Радиальное свечение на полу (неоновое кольцо арены, подсветка сейфа). */
export function radialGlow(color = '#a855f7', inner = 0.18): THREE.CanvasTexture {
  return cached(`radial:${color}:${inner}`, [512, 512], (ctx, w) => {
    const c = w / 2;
    const g = ctx.createRadialGradient(c, c, c * inner, c, c, c);
    g.addColorStop(0, withAlpha(color, 0.95));
    g.addColorStop(0.35, withAlpha(color, 0.34));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** Кольцо-подсветка (тонкий яркий ободок для арены и платформы). */
export function neonRing(color = '#22d3ee', thickness = 0.06): THREE.CanvasTexture {
  return cached(`ring:${color}:${thickness}`, [512, 512], (ctx, w) => {
    const c = w / 2;
    const r = c * 0.86;
    const g = ctx.createRadialGradient(c, c, r * (1 - thickness * 3), c, c, r * (1 + thickness * 3));
    g.addColorStop(0, withAlpha(color, 0));
    g.addColorStop(0.5, color);
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c, c, r * (1 + thickness * 3), 0, Math.PI * 2); ctx.fill();
  });
}

/** Тёмный мрамор/бархат арены с прожилками. */
export function arenaFloor(): THREE.CanvasTexture {
  const t = cached('arena:v2', [512, 512], (ctx, w, h) => {
    ctx.fillStyle = '#0b0718';
    ctx.fillRect(0, 0, w, h);
    // Детерминированный ГПСЧ вместо Math.random
    let seed = 777004 >>> 0 || 1;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    // Прожилки
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(168,85,247,.5)' : 'rgba(200,205,240,.28)';
      ctx.lineWidth = rnd() * 2.4 + 0.4;
      ctx.beginPath();
      let x = rnd() * w, y = rnd() * h;
      ctx.moveTo(x, y);
      for (let s = 0; s < 7; s++) {
        x += (rnd() - 0.5) * 190;
        y += (rnd() - 0.5) * 190;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Виньетка (центр светлее — туда падает прожектор)
    const v = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.62);
    v.addColorStop(0, 'rgba(90,60,140,0.34)');
    v.addColorStop(1, 'rgba(0,0,0,0.86)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Туманность для космоса (фон ракеты): облака цвета вместо чёрной пустоты. */
export function nebula(): THREE.CanvasTexture {
  // v4: детерминированный ГПСЧ, богаче облака и звёзды; полюса тёмные —
  // верх и низ текстуры на сфере стягиваются в точку, и яркий рисунок там
  // превращался в «срезанные» разводы вверху кадра
  return cached('nebula:v4', [1024, 512], (ctx, w, h) => {
    let seed = 987654321 >>> 0;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    // Глубокий градиент вместо плоского чёрного
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#070a1c');
    bg.addColorStop(0.5, '#04050e');
    bg.addColorStop(1, '#0a0716');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const clouds: Array<[number, number, number, string]> = [
      [w * 0.22, h * 0.36, h * 0.66, 'rgba(96,52,178,0.5)'],
      [w * 0.62, h * 0.26, h * 0.56, 'rgba(28,102,168,0.44)'],
      [w * 0.84, h * 0.66, h * 0.5, 'rgba(168,52,108,0.36)'],
      [w * 0.42, h * 0.76, h * 0.48, 'rgba(44,132,150,0.3)'],
      [w * 0.1, h * 0.8, h * 0.38, 'rgba(132,88,214,0.26)'],
      [w * 0.52, h * 0.5, h * 0.6, 'rgba(70,60,190,0.3)']
    ];
    clouds.forEach(([x, y, r, color]) => {
      // Облако из множества мягких пятен + яркое ядро
      for (let i = 0; i < 46; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * r * 0.85;
        const rr = r * (0.2 + rnd() * 0.5);
        const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
        const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Диагональная полоса «млечного пути» из мелкой звёздной пыли
    for (let i = 0; i < 700; i++) {
      const t = rnd();
      const x = t * w;
      const y = h * (0.32 + t * 0.22) + (rnd() - 0.5) * h * 0.22;
      const b = rnd();
      ctx.fillStyle = `rgba(210,220,255,${0.06 + b * 0.3})`;
      ctx.fillRect(x, y, 1, 1);
    }

    // Затемнение к полюсам (верх/низ кадра на сфере)
    const poleTop = ctx.createLinearGradient(0, 0, 0, h * 0.24);
    poleTop.addColorStop(0, 'rgba(3,4,10,1)');
    poleTop.addColorStop(1, 'rgba(3,4,10,0)');
    ctx.fillStyle = poleTop;
    ctx.fillRect(0, 0, w, h * 0.24);
    const poleBottom = ctx.createLinearGradient(0, h, 0, h * 0.76);
    poleBottom.addColorStop(0, 'rgba(3,4,10,1)');
    poleBottom.addColorStop(1, 'rgba(3,4,10,0)');
    ctx.fillStyle = poleBottom;
    ctx.fillRect(0, h * 0.76, w, h * 0.24);

    // Звёзды: мелкие точки + у ярких крестовый блик
    for (let i = 0; i < 1200; i++) {
      const x = rnd() * w, y = rnd() * h;
      const b = rnd();
      ctx.fillStyle = `rgba(255,255,255,${0.16 + b * 0.72})`;
      ctx.fillRect(x, y, b > 0.93 ? 2 : 1, b > 0.93 ? 2 : 1);
      if (b > 0.965) {
        ctx.strokeStyle = 'rgba(220,230,255,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y);
        ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3);
        ctx.stroke();
      }
    }
  });
}

/* ═══════════════════════════ ВСПОМОГАТЕЛЬНОЕ ═══════════════════════════ */

function withAlpha(color: string, alpha: number): string {
  // Поддерживаем #rgb, #rrggbb и rgba()/rgb()
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map((x) => parseFloat(x));
    return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
  }
  return color;
}

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, width: number, dark: string, light: string): void {
  ctx.save();
  ctx.lineWidth = width;
  ctx.strokeStyle = dark;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = Math.max(1, width * 0.34);
  ctx.strokeStyle = light;
  ctx.beginPath(); ctx.arc(cx, cy, r - width * 0.28, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, stroke: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.44;
    ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, fill);
  g.addColorStop(1, stroke);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();
}

function laurel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const a = Math.PI * 0.5 + dir * (0.34 + t * 1.62);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + dir * Math.PI * 0.34);
      ctx.fillStyle = i % 2 ? color : 'rgba(255,240,190,0.72)';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.088, r * 0.036, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

function text(ctx: CanvasRenderingContext2D, cx: number, cy: number, str: string, size: number, fill: string, stroke: string): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(size)}px 'Orbitron', 'Russo One', sans-serif`;
  ctx.lineWidth = Math.max(2, size * 0.06);
  ctx.strokeStyle = stroke;
  ctx.strokeText(str, cx, cy);
  const g = ctx.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
  g.addColorStop(0, '#fffdf2');
  g.addColorStop(0.48, fill);
  g.addColorStop(1, '#c08a10');
  ctx.fillStyle = g;
  ctx.fillText(str, cx, cy);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Освободить все текстуры (при выгрузке сцены — иначе память течёт). */
export function disposeTextures(): void {
  for (const [, tex] of cache) tex.dispose();
  cache.clear();
}
