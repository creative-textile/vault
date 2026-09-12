import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import SafeCrackScene from '../../three/safe/SafeCrackScene';
import { safeApi } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { onSafeEvent } from '../../utils/socketEvents';

/**
 * Скорости барабанов приходят с сервера (одинаковые для всех игроков в этот день).
 * Каждая цифра видна 1000 / (speed × 1.3) мс: при 1.45–2.00 это 385–530 мс —
 * обычный игрок попадает примерно в 80% попыток, но разница между игроками
 * остаётся в десятках миллисекунд. Запасные значения — те же, что генерирует сервер.
 */
const DEFAULT_SPEEDS = [1.55, 1.72, 1.9];
/** Цифра барабана i в момент, когда с начала вращения прошло ms миллисекунд. */
const digitAt = (speeds: number[], i: number, ms: number) =>
  Math.floor((ms * (speeds[i] ?? DEFAULT_SPEEDS[i]) * 0.0013) % 10);

function fmtWindow(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SafeCrack() {
  const { user, showToast, refreshUser } = useAuth();
  const nav = useNavigate();

  const [safe, setSafe] = useState<any>(null);
  const [myDeposit, setMyDeposit] = useState<any>(null);
  const [phase, setPhase] = useState<'countdown' | 'spinning' | 'done'>('countdown');
  const [countdown, setCountdown] = useState(3);
  const [codeRevealed, setCodeRevealed] = useState(false);
  // taps[i] — момент остановки барабана (мс от старта вращения); барабан
  // останавливается ТОЛЬКО на правильной цифре, а промах просто подсвечивается
  // красным: штрафного времени нет, игрок теряет ровно то, что потратил на повтор
  const [taps, setTaps] = useState<(number | undefined)[]>([]);
  const [flash, setFlash] = useState<{ i: number; digit: number } | null>(null);
  const [spinElapsed, setSpinElapsed] = useState(0);
  const [windowLeft, setWindowLeft] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  // Уже засчитанное время (пришли на экран после сдачи результата) — мини-игру не перезапускаем
  const [myTime, setMyTime] = useState<number | null>(null);
  // Скорости барабанов: фиксируем один раз при первой загрузке, чтобы отрисовка
  // и проверка попадания не разъехались, если данные перезагрузятся во время игры
  const [speeds, setSpeeds] = useState<number[]>(DEFAULT_SPEEDS);
  const speedsLockedRef = useRef(false);

  const startedAtRef = useRef(0);
  const submittedRef = useRef(false);
  const submittedNowRef = useRef(false);
  const hasDepositRef = useRef(false);
  const windowDeadlineRef = useRef<number | null>(null);
  const spinRef = useRef<number | null>(null);
  const tapsRef = useRef<(number | undefined)[]>([]);
  const flashTimerRef = useRef<number | null>(null);

  // ── Данные сейфа: опрос + мгновенная реакция на socket-событие ──────────
  const load = useCallback(async () => {
    try {
      const r = await safeApi.current();
      setSafe(r.safe);
      setMyDeposit(r.my_deposit);
      hasDepositRef.current = !!r.my_deposit;
      const ds = r.safe?.drum_speeds;
      if (!speedsLockedRef.current && Array.isArray(ds) && ds.length === 3) {
        const nums = ds.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x) && x > 0);
        if (nums.length === 3) { setSpeeds(nums); speedsLockedRef.current = true; }
      }
      const recorded = r.my_deposit?.crack_time_ms;
      if (recorded != null) {
        // Игрок уже сдал результат (перезаход на экран, возврат с /safe) —
        // показываем его время и ждём остальных, барабаны не запускаем.
        submittedRef.current = true;
        setMyTime(recorded);
        setPhase('done');
      }
      if (r.safe?.crack_remaining_ms != null) {
        windowDeadlineRef.current = Date.now() + r.safe.crack_remaining_ms;
      }
      if (r.safe && r.safe.status !== 'cracking') setFinished(true);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    const off = onSafeEvent(d => {
      if (d.type === 'safe_finished' || d.type === 'safe_cancelled') {
        setFinished(true);
        load();
      }
    });
    return () => { clearInterval(iv); off(); };
  }, [load]);

  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  // ── Предстартовая последовательность: 3-2-1 → код (3 с) → вращение ─────
  useEffect(() => {
    if (myTime != null) return; // результат уже засчитан — отсчёт не запускаем
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
  }, [myTime]);

  // ── Обратный отсчёт окна взлома (серверное время, тикает локально) ─────
  useEffect(() => {
    const iv = setInterval(() => {
      const deadline = windowDeadlineRef.current;
      setWindowLeft(deadline == null ? null : Math.max(0, deadline - Date.now()));
    }, 250);
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
    // Если игрок только что сдал результат — даём увидеть «ВЗЛОМ!», потом к итогам
    const delay = submittedNowRef.current ? 2200 : 0;
    const t = setTimeout(() => nav('/safe', { replace: true }), delay);
    return () => clearTimeout(t);
  }, [finished, phase, nav]);

  const submit = (finalTaps: number[]) => {
    // Время взлома = момент остановки последнего барабана. Штрафов за промахи
    // нет: промахнувшийся игрок тапает снова и теряет время сам.
    const totalTime = Math.max(...finalTaps);

    submittedRef.current = true;
    setPhase('done');

    if (!hasDepositRef.current) {
      showToast('Вы не вносили вклад в этот сейф — результат не засчитывается');
      return;
    }

    submittedNowRef.current = true;
    // Сервер получает моменты тапов и сам сверяет цифры с кодом сейфа:
    // засчитанное время не может быть лучше честно пересчитанного
    safeApi.crack(totalTime, finalTaps)
      .then((r: any) => {
        const shown = Number.isFinite(r?.crack_time_ms) ? r.crack_time_ms : totalTime;
        setMyTime(shown);
        showToast(`✅ Код собран за ${(shown / 1000).toFixed(2)} с`);
        refreshUser();
        // Все участники сдали результат — сервер подвёл итоги досрочно
        if (r?.finished) setFinished(true);
        else load();
      })
      .catch((e: any) => {
        // Сервер отклонил результат (цифры не совпали с кодом, окно закрылось) —
        // если время ещё есть, барабаны раскручиваются снова, игрок пробует ещё раз
        showToast(e.message);
        submittedRef.current = false;
        submittedNowRef.current = false;
        if (windowDeadlineRef.current != null && Date.now() >= windowDeadlineRef.current) {
          setFinished(true);
          return;
        }
        setMyTime(null);
        setPhase('spinning');
        startedAtRef.current = Date.now();
        tapsRef.current = [];
        setTaps([]);
      });
  };

  /**
   * Тап по барабану. Останавливает его только попадание в нужную цифру:
   * промах НЕ фиксирует барабан и не штрафует временем — он просто продолжает
   * крутиться, и игрок теряет ровно столько, сколько потратил на повторный тап.
   */
  const tapDrum = (i: number) => {
    if (phase !== 'spinning' || tapsRef.current[i] !== undefined || submittedRef.current) return;
    const code: number[] = safe?.code || [];
    if (code.length !== 3) return;

    const tapTime = Math.round(Date.now() - startedAtRef.current);
    const shown = digitAt(speeds, i, tapTime);

    if (shown !== code[i]) {
      setFlash({ i, digit: shown });
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlash(null), 400);
      return;
    }

    const newTaps = [...tapsRef.current];
    newTaps[i] = tapTime;
    tapsRef.current = newTaps;
    setTaps(newTaps);

    const done = newTaps.filter(t => t !== undefined) as number[];
    if (done.length === 3) submit(done);
  };

  if (!safe) return <><Header title="🔒 ВЗЛОМ СЕЙФА" /><div className="text-center mt">Загрузка...</div></>;

  const code: number[] = safe.code || [0, 0, 0];
  const showWindow = windowLeft != null && windowLeft > 0;
  const windowClosed = windowLeft === 0;
  const stoppedCount = taps.filter(t => t !== undefined).length;

  return (
    <>
      <Header title="🔒 ВЗЛОМ СЕЙФА" />

      {/* Какой аккаунт играет сейчас: при нескольких вкладках/браузерах это
          единственное место, где видно, чей результат засчитывается */}
      {user && (
        <div className="text-dim text-center" style={{ fontSize: 12, margin: '2px 0 6px' }}>
          👤 играет @{user.username || 'demo'}
        </div>
      )}

      <SafeCrackScene
        phase={phase === 'spinning' ? 'spinning' : phase === 'done' ? 'result' : 'idle'}
        code={code}
        drumSpeeds={safe.drum_speeds}
      />

      {showWindow && phase !== 'done' && (
        <div className="timer" style={{ color: (windowLeft as number) < 15000 ? '#ef4444' : undefined }}>
          ⏱ Нужно взломать сейф за: {fmtWindow(windowLeft as number)}
        </div>
      )}
      {windowClosed && phase !== 'done' && (
        <div className="timer" style={{ color: '#ef4444' }}>
          ⏱ Время вышло — результат не будет засчитан
        </div>
      )}

      {!myDeposit && (
        <div className="text-center text-dim mt" style={{ fontSize: 13 }}>
          Вы не вносили вклад в этот сейф — можно посмотреть взлом со стороны
        </div>
      )}

      {phase === 'countdown' && countdown > 0 && (
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
          <div className="text-dim">Запомните код — он показывается один раз. Барабан остановится только на своей цифре.</div>
        </div>
      )}

      {phase === 'spinning' && (
        <>
          <div className="text-center mt" style={{ fontSize: 18 }}>
            Остановите барабаны на цифрах кода — <span className="text-dim">код был показан перед стартом</span>
          </div>
          <div className="drums">
            {[0, 1, 2].map(i => {
              const isStopped = taps[i] !== undefined;
              const isFlash = flash?.i === i;
              const shownDigit = isStopped
                ? digitAt(speeds, i, taps[i] as number)
                : isFlash
                  ? (flash as any).digit
                  : digitAt(speeds, i, spinElapsed);
              return (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div className="text-dim" style={{ fontSize: 13, marginBottom: 4 }}>
                    барабан {i + 1}
                  </div>
                  <div
                    className="drum"
                    onClick={() => tapDrum(i)}
                    style={{
                      opacity: isStopped ? 0.6 : 1,
                      background: isStopped ? '#111' : '#1a1a3a',
                      // в покое оставляем рамку из CSS-класса, подсвечиваем только состояние
                      border: isFlash ? '3px solid #ef4444' : isStopped ? '3px solid #22c55e' : undefined,
                      position: 'relative',
                      color: isStopped ? '#22c55e' : isFlash ? '#ef4444' : '#ffd700',
                      fontSize: 40
                    }}
                  >
                    {shownDigit}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4, color: isStopped ? '#22c55e' : '#8888aa' }}>
                    {isStopped ? `✓ ${(taps[i]! / 1000).toFixed(2)} с` : isFlash ? 'промах — крутится дальше' : 'крутится'}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-dim text-center" style={{ fontSize: 14 }}>
            Собрано {stoppedCount} из 3
          </div>
          <div className="text-dim text-center" style={{ fontSize: 13, marginTop: 6 }}>
            Барабан останавливается только на нужной цифре — сервер проверяет каждый тап.
            Промах временем не штрафуется, но барабан крутится дальше.
            Побеждает тот, кто собрал код раньше остальных.
          </div>
        </>
      )}

      {phase === 'done' && (
        <>
          <div className="card mt text-center">
            <div className="result-text win">✅ КОД СОБРАН: {code[0]} {code[1]} {code[2]}</div>
            {myTime != null && (
              <div className="text-accent" style={{ fontWeight: 900, fontSize: 20 }}>
                Ваше время: {(myTime / 1000).toFixed(2)} с
              </div>
            )}
            <div className="text-dim">
              {finished
                ? 'Подводим итоги...'
                : showWindow && (safe.pending_cracks ?? 0) > 0
                  ? `Ждём остальных игроков (${safe.pending_cracks} из ${safe.participants_count}) — окно закроется через ${fmtWindow(windowLeft as number)}`
                  : showWindow
                    ? `Окно взлома закроется через ${fmtWindow(windowLeft as number)}`
                    : 'Подводим итоги...'}
            </div>
            <div className="text-dim" style={{ fontSize: 12, marginTop: 6 }}>
              Итоги появятся сразу, как только все участники сдадут результат
            </div>
            <button className="btn mt" onClick={() => nav('/safe', { replace: true })}>К РЕЗУЛЬТАТАМ</button>
          </div>
          <button className="btn btn-secondary" onClick={() => nav('/')}>🏠 НА ГЛАВНУЮ</button>
        </>
      )}
    </>
  );
}
