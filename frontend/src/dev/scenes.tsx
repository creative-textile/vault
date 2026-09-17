/**
 * 🎛 ОТЛАДОЧНАЯ ГАЛЕРЕЯ 3D-СЦЕН — только для разработки.
 *
 * Зачем отдельная страница: чтобы посмотреть на сцены, нужен бэкенд, PostgreSQL
 * и авторизация в Telegram. Проверять «красиво ли летит ракета» через полный
 * стек — значит каждый раз поднимать базу. Здесь сцены рендерятся на моковых
 * пропсах с переключением фаз вручную.
 *
 * Страница НЕ входит в прод-сборку: она отдельный html-вход (`scenes.html`),
 * которого нет в `build.rollupOptions.input`, поэтому `vite build` её не
 * собирает и в бандл игрока она не попадает. Открыть: `/scenes.html` на dev-сервере.
 *
 * Заодно это проверка синхрона сейфа: цифры под 3D-барабанами считаются той же
 * функцией `digitAt`, что и на экране взлома, — если картинка и подпись
 * расходятся, значит рассинхрон виден глазами.
 */
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/theme.css';
import '../styles/app.css';
import RocketScene from '../three/rocket/RocketScene';
import DuelScene from '../three/duel/DuelScene';
import SafeCrackScene from '../three/safe/SafeCrackScene';
import VaultScene from '../three/main/VaultScene';
import { digitAt, speedOf } from '../three/safe/drumMath';
import { detectQuality, getStageStats, type StageStats } from '../three/lib/stage';
import { modelInfo } from '../three/lib/models';

const GLBS = ['safe.glb', 'rocket.glb', 'coin.glb'] as const;

function fmtKb(n: number | null): string {
  return n === null ? '—' : `${(n / 1024).toFixed(0)} КБ`;
}

/** Переключатель «модели/процедурно» + живая статистика (ТЗ 6.4). */
function DevPanel({ forceProc, onToggle }: { forceProc: boolean; onToggle: () => void }) {
  const [stats, setStats] = useState<Record<string, StageStats>>({});
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  useEffect(() => {
    const iv = setInterval(() => {
      setStats(getStageStats());
      Promise.all(GLBS.map((f) => modelInfo(f))).then((r) => {
        const next: Record<string, number | null> = {};
        GLBS.forEach((f, i) => { next[f] = r[i]?.bytes ?? null; });
        setSizes(next);
      });
    }, 700);
    return () => clearInterval(iv);
  }, []);
  const rows = Object.entries(stats);
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10, background: 'rgba(8,6,15,.92)',
      borderBottom: '1px solid #2a2440', padding: '10px 16px',
      display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center',
      backdropFilter: 'blur(6px)'
    }}>
      <button className={`btn btn-small ${forceProc ? 'btn-danger' : 'btn-green'}`} onClick={onToggle}>
        {forceProc ? ' процедурно (fallback)' : '📦 3D-модели .glb'}
      </button>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-dim)' }}>
        {rows.map(([id, st]) => (
          <span key={id} style={{ fontFamily: 'monospace' }}>
            <b style={{ color: 'var(--gold)' }}>{id}</b> {st.fps} fps ·{' '}
            {(st.triangles / 1000).toFixed(1)}k tris · {st.calls} calls
          </span>
        ))}
        {rows.length === 0 && <span>статистика появится после рендера сцен…</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
        {GLBS.map((f) => `${f.replace('.glb', '')} ${fmtKb(sizes[f] ?? null)}`).join(' · ')}
      </div>
    </div>
  );
}

const CODE = [7, 3, 9];
const SPEEDS = [1.55, 1.72, 1.9];
const TRAJECTORY = { rotation_speed: 8, height: 2.6, bounces: 2, final_angle: 15 };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 34 }}>
      <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 19, margin: '0 0 4px', color: 'var(--gold)' }}>{title}</h2>
      {hint && <div className="text-dim" style={{ fontSize: 13, marginBottom: 10 }}>{hint}</div>}
      {children}
    </section>
  );
}

function Rocket() {
  const [phase, setPhase] = useState<'idle' | 'flying' | 'cashed' | 'crashed'>('idle');
  const [mult, setMult] = useState(1);
  const raf = useRef(0);
  const start = useRef(0);

  useEffect(() => {
    if (phase !== 'flying') { cancelAnimationFrame(raf.current); return; }
    start.current = performance.now();
    const tick = () => {
      const t = (performance.now() - start.current) / 1000;
      setMult(Math.exp(0.075 * t));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [phase]);

  const go = (p: typeof phase) => {
    setPhase(p);
    if (p === 'idle') setMult(1);
    if (p === 'cashed') setMult((m) => Math.max(1.2, m));
  };

  return (
    <Section title="🚀 Ракета" hint={`Множитель сейчас x${mult.toFixed(2)} · фаза: ${phase}`}>
      <RocketScene phase={phase} multiplier={mult} cashoutAt={mult} crashAt={Math.max(mult + 1.4, 3.1)} seed="gallery-rocket" />
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn btn-small" onClick={() => go('idle')}>idle</button>
        <button className="btn btn-small btn-green" onClick={() => go('flying')}>flying</button>
        <button className="btn btn-small" onClick={() => go('cashed')}>cashed (забрал)</button>
        <button className="btn btn-small btn-danger" onClick={() => go('crashed')}>crashed (взрыв)</button>
      </div>
      <div className="scene-hud" style={{ position: 'static', marginTop: 8 }}>
        <span className="hud-pill hud-pill--gold">x{mult.toFixed(2)}</span>
      </div>
    </Section>
  );
}

function Duel() {
  const [phase, setPhase] = useState<'idle' | 'flipping' | 'result'>('idle');
  const [result, setResult] = useState<'heads' | 'tails'>('heads');
  const [landed, setLanded] = useState<string>('—');

  const flip = (r: 'heads' | 'tails') => {
    setResult(r);
    setPhase('flipping');
    setLanded('в полёте…');
    setTimeout(() => setPhase('result'), 2800);
  };

  return (
    <Section title="⚔️ Дуэль: монета" hint={`Фаза: ${phase} · серверный исход: ${result} · касание пола: ${landed}`}>
      <DuelScene phase={phase} result={result} trajectory={TRAJECTORY} onFinish={() => setLanded(new Date().toLocaleTimeString('ru-RU'))} />
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn btn-small" onClick={() => setPhase('idle')}>idle (витрина)</button>
        <button className="btn btn-small btn-green" onClick={() => flip('heads')}>бросок → ОРЁЛ</button>
        <button className="btn btn-small" onClick={() => flip('tails')}>бросок → РЕШКА</button>
      </div>
    </Section>
  );
}

function Safe() {
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'result'>('idle');
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const [taps, setTaps] = useState<(number | undefined)[]>([undefined, undefined, undefined]);
  const [now, setNow] = useState(Date.now());

  // Тикаем, чтобы DOM-цифры под барабанами жили так же, как на экране взлома
  useEffect(() => {
    if (phase !== 'spinning') return;
    const iv = setInterval(() => setNow(Date.now()), 60);
    return () => clearInterval(iv);
  }, [phase]);

  const spin = () => {
    setTaps([undefined, undefined, undefined]);
    setStartedAt(Date.now());
    setPhase('spinning');
  };
  const tap = (i: number) => {
    if (phase !== 'spinning' || !startedAt || taps[i] !== undefined) return;
    const ms = Date.now() - startedAt;
    // Тап засчитывается ТОЛЬКО на нужной цифре — как в игре
    if (digitAt(ms, speedOf(SPEEDS, i)) !== CODE[i]) return;
    const next = [...taps];
    next[i] = ms;
    setTaps(next);
    if (next.every((t) => t !== undefined)) setPhase('result');
  };
  const force = (i: number) => {
    // Для галереи: остановить барабан на правильной цифре, не ловя момент
    if (!startedAt) return;
    const ms = Date.now() - startedAt;
    const per = 1000 / (speedOf(SPEEDS, i) * 1.3);
    const cur = digitAt(ms, speedOf(SPEEDS, i));
    const delta = ((CODE[i] - cur) % 10 + 10) % 10;
    const at = ms + delta * per;
    const next = [...taps];
    next[i] = at;
    setTaps(next);
    if (at <= ms) setPhase('result');
  };

  const ms = startedAt ? now - startedAt : 0;

  return (
    <Section
      title="🔒 Сейф"
      hint={`Фаза: ${phase} · код ${CODE.join('-')} · скорости ${SPEEDS.join(', ')} · прокрутка ${ms} мс`}
    >
      <SafeCrackScene phase={phase} code={CODE} drumSpeeds={SPEEDS} startedAt={startedAt} taps={taps} />
      <div className="drums" style={{ marginTop: 10 }}>
        {[0, 1, 2].map((i) => {
          const stopped = taps[i] !== undefined;
          const shown = stopped
            ? digitAt(taps[i] as number, speedOf(SPEEDS, i))
            : phase === 'result'
              ? CODE[i]
              : digitAt(ms, speedOf(SPEEDS, i));
          return (
            <div key={i} style={{ textAlign: 'center' }}>
              <div className="text-dim" style={{ fontSize: 12, marginBottom: 4 }}>барабан {i + 1}</div>
              <div className="drum" onClick={() => tap(i)} style={{ cursor: phase === 'spinning' ? 'pointer' : 'default' }}>
                {shown}
              </div>
              <div className="text-dim" style={{ fontSize: 11, marginTop: 3 }}>
                {stopped ? 'остановлен' : `нужно ${CODE[i]}`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-dim" style={{ fontSize: 12, margin: '8px 0' }}>
        Цифры выше считаются той же функцией, что и на экране взлома. Они обязаны
        совпадать с цифрами на 3D-барабанах — это и есть проверка синхрона.
      </div>
      <div className="btn-row">
        <button className="btn btn-small" onClick={() => setPhase('idle')}>idle</button>
        <button className="btn btn-small btn-green" onClick={spin}>spinning</button>
        <button className="btn btn-small" onClick={() => setPhase('result')}>result (сейф открыт)</button>
        {[0, 1, 2].map((i) => (
          <button key={i} className="btn btn-small btn-secondary" onClick={() => force(i)}>
            стоп {i + 1}
          </button>
        ))}
      </div>
    </Section>
  );
}

function App() {
  const [q] = useState(detectQuality());
  const [forceProc, setForceProc] = useState(false);
  const [gen, setGen] = useState(0);
  const toggle = () => {
    const next = !forceProc;
    setForceProc(next);
    (window as unknown as { __VAULT_FORCE_PROCEDURAL__?: boolean }).__VAULT_FORCE_PROCEDURAL__ = next;
    setGen((g) => g + 1);   // перемонтировать сцены, чтобы они перечитали флаг
  };
  return (
    <div style={{ padding: '0 0 60px' }}>
      <DevPanel forceProc={forceProc} onToggle={toggle} />
      <div style={{ padding: '18px 16px 0', maxWidth: 860, margin: '0 auto' }}>
      <div className="logo" style={{ marginBottom: 4 }}>VAULT · галерея сцен</div>
      <div className="text-dim" style={{ fontSize: 13, marginBottom: 18 }}>
        Отладочная страница (в прод-сборку не входит). Качество определено как
        <b style={{ color: 'var(--gold)' }}> {q}</b> · WebGL: {typeof WebGLRenderingContext !== 'undefined' ? 'есть' : 'нет'}
        <br />
        Если сцена пустая — браузер не дал WebGL-контекст, игра при этом остаётся играбельной.
      </div>
      <Rocket key={`r${gen}`} />
      <Duel key={`d${gen}`} />
      <Safe key={`s${gen}`} />
      <Section title="🏦 Витрина хранилища (онбординг)" hint="Прозрачный фон: сцена встроена в карточку, ореол вместо bloom.">
        <div style={{ background: 'linear-gradient(160deg,#141a3a,#070913)', borderRadius: 16, padding: 8 }}>
          <VaultScene key={`v${gen}`} size={300} />
        </div>
      </Section>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
