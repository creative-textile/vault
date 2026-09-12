import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import SafeCrackScene from '../../three/safe/SafeCrackScene';
import { safeApi } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { onSafeEvent } from '../../utils/socketEvents';

/** Скорость каждого барабана (общая для отрисовки и проверки попадания). */
const drumSpeed = (i: number) => (0.7 + i * 0.15) * 1.2;
/** Цифра барабана i в момент, когда с начала вращения прошло ms миллисекунд. */
const digitAt = (i: number, ms: number) => Math.floor((ms * drumSpeed(i) * 0.0013) % 10);

function fmtWindow(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SafeCrack() {
  const { showToast, refreshUser } = useAuth();
  const nav = useNavigate();

  const [safe, setSafe] = useState<any>(null);
  const [myDeposit, setMyDeposit] = useState<any>(null);
  const [phase, setPhase] = useState<'countdown' | 'spinning' | 'done'>('countdown');
  const [countdown, setCountdown] = useState(3);
  const [codeRevealed, setCodeRevealed] = useState(false);
  const [taps, setTaps] = useState<(number | undefined)[]>([]);
  const [spinElapsed, setSpinElapsed] = useState(0);
  const [windowLeft, setWindowLeft] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);

  const startedAtRef = useRef(0);
  const submittedRef = useRef(false);
  const hasDepositRef = useRef(false);
  const windowDeadlineRef = useRef<number | null>(null);
  const spinRef = useRef<number | null>(null);

  // ── Данные сейфа: опрос + мгновенная реакция на socket-событие ──────────
  const load = useCallback(async () => {
    try {
      const r = await safeApi.current();
      setSafe(r.safe);
      setMyDeposit(r.my_deposit);
      hasDepositRef.current = !!r.my_deposit;
      if (r.safe?.crack_remaining_ms != null) {
        windowDeadlineRef.current = Date.now() + r.safe.crack_remaining_ms;
      }
      if (r.safe && r.safe.status !== 'cracking') setFinished(true);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 3000);
    const off = onSafeEvent(d => {
      if (d.type === 'safe_finished' || d.type === 'safe_cancelled') {
        setFinished(true);
        load();
      }
    });
    return () => { clearInterval(iv); off(); };
  }, [load]);

  // ── Предстартовая последовательность: 3-2-1 → код (3 с) → вращение ─────
  useEffect(() => {
    let cancelled = false;
    const timers = [
      window.setTimeout(() => !cancelled && setCountdown(2), 1000),
      window.setTimeout(() => !cancelled && setCountdown(1), 2000),
      window.setTimeout(() => {
        if (cancelled) return;
        setCountdown(0);
        setCodeRevealed(true);
      }, 3000),
      window.setTimeout(() => {
        if (cancelled) return;
        startedAtRef.current = Date.now();
        setPhase('spinning');
      }, 6000)
    ];
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, []);

  // ── Обратный отсчёт окна взлома (серверное время, тикает локально) ─────
  useEffect(() => {
    const iv = setInterval(() => {
      const deadline = windowDeadlineRef.current;
      setWindowLeft(deadline == null ? null : Math.max(0, deadline - Date.now()));
    }, 500);
    return () => clearInterval(iv);
  }, []);

  // ── Анимация барабанов: цифры считаются от прошедшего времени ──────────
  // Та же формула, что и при проверке попадания, поэтому показанная цифра
  // всегда совпадает с засчитанной (раньше анимация копилась по кадрам и
  // «уезжала» при сворачивании вкладки).
  useEffect(() => {
    if (phase !== 'spinning') {
      if (spinRef.current) { cancelAnimationFrame(spinRef.current); spinRef.current = null; }
      return;
    }
    const tick = () => {
      setSpinElapsed(Date.now() - startedAtRef.current);
      spinRef.current = requestAnimationFrame(tick);
    };
    spinRef.current = requestAnimationFrame(tick);
    return () => { if (spinRef.current) cancelAnimationFrame(spinRef.current); };
  }, [phase]);

  // ── Переход к результатам, когда окно взлома закрылось ─────────────────
  useEffect(() => {
    if (!finished) return;
    // Если игрок уже сдал результат — даём увидеть «ВЗЛОМ!», потом к итогам
    const delay = submittedRef.current || phase === 'done' ? 2200 : 0;
    const t = setTimeout(() => nav('/safe'), delay);
    return () => clearTimeout(t);
  }, [finished, phase, nav]);

  const tapDrum = (i: number) => {
    if (phase !== 'spinning' || taps[i] !== undefined || submittedRef.current) return;

    const tapTime = Date.now() - startedAtRef.current;
    const newTaps = [...taps];
    newTaps[i] = tapTime;
    setTaps(newTaps);

    if (newTaps.filter(t => t !== undefined).length < 3) return;

    const maxTap = Math.max(...(newTaps as number[]));
    const misses = newTaps.filter((t, idx) => digitAt(idx, t as number) !== safe.code[idx]).length;
    const totalTime = maxTap + misses * 500;

    submittedRef.current = true;
    setPhase('done');

    if (!hasDepositRef.current) {
      showToast('Вы не вносили вклад в этот сейф — результат не засчитывается');
      return;
    }

    safeApi.crack(totalTime)
      .then((r: any) => {
        // Сервер пишет max(время клиента, время от старта фазы взлома)
        const shown = Number.isFinite(r?.crack_time_ms) ? r.crack_time_ms : totalTime;
        showToast(`✅ Взлом за ${(shown / 1000).toFixed(2)}с (промахи: ${misses})`);
        refreshUser();
      })
      .catch((e: any) => showToast(e.message));
  };

  if (!safe) return <><Header title="🔒 ВЗЛОМ СЕЙФА" /><div className="text-center mt">Загрузка...</div></>;

  const code: number[] = safe.code || [0, 0, 0];
  const showWindow = windowLeft != null && windowLeft > 0;

  return (
    <>
      <Header title="🔒 ВЗЛОМ СЕЙФА" />

      <SafeCrackScene
        phase={phase === 'spinning' ? 'spinning' : phase === 'done' ? 'result' : 'idle'}
        code={code}
        drumSpeeds={safe.drum_speeds}
      />

      {showWindow && phase !== 'done' && (
        <div className="timer" style={{ color: (windowLeft as number) < 15000 ? '#ef4444' : undefined }}>
          ⏱ Окно взлома: {fmtWindow(windowLeft as number)}
        </div>
      )}

      {!myDeposit && (
        <div className="text-center text-dim mt" style={{ fontSize: 13 }}>
          Вы не вносили вклад в этот сейф — можно посмотреть взлом со стороны
        </div>
      )}

      {countdown > 0 && (
        <div className="text-center mt">
          <div style={{ fontSize: 96, fontWeight: 900, color: '#ff4444' }}>{countdown}</div>
          <div className="text-dim">Приготовьтесь...</div>
        </div>
      )}

      {codeRevealed && phase === 'countdown' && countdown === 0 && (
        <div className="card card-hl text-center mt">
          <div className="card-title" style={{ fontSize: 24 }}>КОД:</div>
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', fontSize: 56, fontWeight: 900, color: '#ffd700', margin: '16px 0' }}>
            <span>{code[0]}</span>
            <span>{code[1]}</span>
            <span>{code[2]}</span>
          </div>
          <div className="text-dim">Запоминайте! Барабаны сейчас начнут вращаться...</div>
        </div>
      )}

      {phase === 'spinning' && (
        <>
          <div className="text-center mt" style={{ fontSize: 18 }}>Тапните по нужной цифре!</div>
          <div className="drums">
            {[0, 1, 2].map(i => {
              const isTapped = taps[i] !== undefined;
              const tappedDigit = isTapped ? digitAt(i, taps[i] as number) : 0;
              return (
                <div
                  key={i}
                  className="drum"
                  onClick={() => tapDrum(i)}
                  style={{
                    opacity: isTapped ? 0.5 : 1,
                    background: isTapped ? '#111' : '#1a1a3a',
                    position: 'relative',
                    color: isTapped ? (tappedDigit === code[i] ? '#22c55e' : '#ef4444') : '#ffd700',
                    fontSize: 40
                  }}
                >
                  {isTapped ? tappedDigit : digitAt(i, spinElapsed)}
                </div>
              );
            })}
          </div>
          <div className="text-dim text-center" style={{ fontSize: 14 }}>
            Кликните по барабану в момент, когда видна нужная цифра.<br />
            Промах = +0.5 сек штраф.
          </div>
        </>
      )}

      {phase === 'done' && (
        <>
          <div className="card mt text-center">
            <div className="result-text win">✅ ВЗЛОМ!</div>
            <div className="text-dim">
              {showWindow
                ? `Ждём окончания окна взлома: ${fmtWindow(windowLeft as number)}`
                : 'Подводим итоги...'}
            </div>
            <button className="btn mt" onClick={() => nav('/safe')}>К РЕЗУЛЬТАТАМ</button>
          </div>
          <button className="btn btn-secondary" onClick={() => nav('/')}>🏠 НА ГЛАВНУЮ</button>
        </>
      )}
    </>
  );
}
