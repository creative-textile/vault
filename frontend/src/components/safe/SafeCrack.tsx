import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import Icon from '../ui/Icon';
import SafeCrackScene from '../../three/safe/SafeCrackScene';
import { safeApi } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { onSafeEvent } from '../../utils/socketEvents';
import { tabStore, crackVisitedKey } from '../../utils/tabStore';
import { goToSafeResults } from '../../utils/safeNav';
import { useHasRocketFlight } from '../../utils/rocketFlight';
import { DEFAULT_SPEEDS, digitAt as digitAtSpeed, speedOf } from '../../three/safe/drumMath';
import { sfx } from '../../audio';

/**
 * Скорости барабанов приходят с сервера (одинаковые для всех игроков в этот день).
 * Каждая цифра видна 1000 / (speed × 1.3) мс: при 1.45–2.00 это 385–530 мс —
 * обычный игрок попадает примерно в 80% попыток, но разница между игроками
 * остаётся в десятках миллисекунд. Запасные значения — те же, что генерирует сервер.
 *
 * Сама формула живёт в three/safe/drumMath.ts: по ней же крутится 3D-барабан в
 * сцене, и общий модуль гарантирует, что картинка и DOM показывают одну цифру
 * (тап засчитывается по DOM, а смотрит игрок на картинку). Проверено тестом
 * tests/scene-math.mjs.
 */
/** Цифра барабана i в момент, когда с начала вращения прошло ms миллисекунд. */
const digitAt = (speeds: number[], i: number, ms: number) =>
  digitAtSpeed(ms, speedOf(speeds, i));

function fmtWindow(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SafeCrack() {
  const { user, showToast, refreshUser } = useAuth();
  // Полёт ракеты не останавливается, пока игрок взламывает сейф: внизу появится
  // бейдж «ЗАБРАТЬ». Ре-рендер только на старт/конец раунда, не на каждый тик.
  const rocketFlying = useHasRocketFlight();
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
  // ── ОБЩИЙ старт вращения (один на всех игроков) ─────────────────────────
  // Момент, когда барабаны начинают крутиться, задаёт СЕРВЕР: crack_spin_in_ms —
  // остаток в миллисекундах от серверных часов до общего старта. Клиент переводит
  // его в свои часы один раз (с поправкой на время доставки ответа) и дальше
  // живёт от этого якоря. Поэтому:
  //   - отсчёт 3-2-1 у всех игроков заканчивается в один и тот же момент,
  //     независимо от того, кого выдернуло сразу, а кого — на секунду позже;
  //   - startedAtRef — абсолютный якорь, значит цифры барабанов у всех игроков
  //     в один момент времени одинаковые (никто не получает «удобную» позицию);
  //   - опоздавший (полёт ракеты, фоновая вкладка) не видит фейковый отсчёт, а
  //     сразу попадает на вращение с правильными цифрами.
  const [spinAnchor, setSpinAnchor] = useState<number | null>(null);
  const spinAnchorRef = useRef<number | null>(null);
  /** Метка общего старта по серверным часам (текст одинаков во всех окнах). */
  const [spinAtLabel, setSpinAtLabel] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  // Уже засчитанное время (пришли на экран после сдачи результата) — мини-игру не перезапускаем
  const [myTime, setMyTime] = useState<number | null>(null);
  // Скорости барабанов: фиксируем один раз при первой загрузке, чтобы отрисовка
  // и проверка попадания не разъехались, если данные перезагрузятся во время игры
  const [speeds, setSpeeds] = useState<number[]>(DEFAULT_SPEEDS);
  const speedsLockedRef = useRef(false);

  const startedAtRef = useRef(0);
  /** Последняя проигранная цифра отсчёта — интервал идёт каждые 100 мс. */
  const countdownSoundedRef = useRef<number | null>(null);
  const submittedRef = useRef(false);
  const submittedNowRef = useRef(false);
  const hasDepositRef = useRef(false);
  const windowDeadlineRef = useRef<number | null>(null);
  const spinRef = useRef<number | null>(null);
  const tapsRef = useRef<(number | undefined)[]>([]);
  const flashTimerRef = useRef<number | null>(null);

  // ── Данные сейфа: опрос + мгновенная реакция на socket-событие ──────────
  const load = useCallback(async () => {
    const sentAt = Date.now();
    try {
      const r = await safeApi.current();
      const arrivedAt = Date.now();
      const rtt = arrivedAt - sentAt;
      setSafe(r.safe);
      setMyDeposit(r.my_deposit);
      hasDepositRef.current = !!r.my_deposit;
      // Раунд в этой вкладке уже открывали — SafeCrackRedirector повторно не выдёргивает
      if (r.safe?.id && r.safe?.status === 'cracking') tabStore.set(crackVisitedKey(r.safe.id), '1');
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
        // Ответ доехал за rtt, значит на момент получения осталось на rtt/2 меньше
        windowDeadlineRef.current = arrivedAt + r.safe.crack_remaining_ms - rtt / 2;
      }
      // Якорь общего старта назначается ОДИН раз и больше не пересчитывается:
      // последующие опросы не должны сдвигать старт ни на миллисекунду.
      if (spinAnchorRef.current == null && typeof r.safe?.crack_spin_in_ms === 'number') {
        const anchor = arrivedAt + r.safe.crack_spin_in_ms - rtt / 2;
        spinAnchorRef.current = anchor;
        setSpinAnchor(anchor);
        // Расхождение клиентских и серверных часов — только для подписи на экране
        const skew = typeof r.server_now === 'number' ? Math.round(r.server_now + rtt / 2 - arrivedAt) : 0;
        const serverStart = new Date(anchor + skew);
        setSpinAtLabel(serverStart.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' }));
        startedAtRef.current = anchor;
        console.info(
          `[safe-crack] общий старт вращения через ${Math.round(anchor - arrivedAt)} мс ` +
          `(${serverStart.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК), ` +
          `rtt ${rtt} мс, часы ${skew >= 0 ? '+' : ''}${skew} мс к серверу`
        );
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
      // Взлом начался, а экран был открыт заранее — забираем общий старт сразу,
      // не дожидаясь следующего опроса (он раз в 5 с)
      if (d.type === 'safe_crack_started') load();
    });
    return () => { clearInterval(iv); off(); };
  }, [load]);

  // ── Запрос кода ровно в момент его открытия ─────────────────────────────
  // Сервер больше не отдаёт код сразу с началом фазы взлома: он становится
  // доступен за crack_code_lead_ms (3 с) до общего старта вращения. Опрос раз
  // в 5 с мог бы не попасть в это окно, и игрок начал бы вращение, не зная кода.
  // Поэтому планируем один точечный запрос на момент открытия (+ небольшой
  // запас на доставку ответа).
  const codeRevealInMs = Number(safe?.code_reveal_in_ms);
  useEffect(() => {
    if (!Number.isFinite(codeRevealInMs) || codeRevealInMs <= 0) return;
    const t = window.setTimeout(() => { load(); }, codeRevealInMs + 150);
    return () => window.clearTimeout(t);
  }, [codeRevealInMs, load]);

  // Страховка: вращение началось, а кода в данных нет (запрос не успел, вкладка
  // была в фоне) — запрашиваем немедленно, иначе тапы не засчитаются.
  useEffect(() => {
    if (phase !== 'spinning' || myTime != null) return;
    if (!Array.isArray(safe?.code) || safe.code.length !== 3) load();
  }, [phase, safe?.code, myTime, load]);

  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  // Взлом реально идёт — только тогда имеет смысл назначать общий старт
  const cracking = safe?.status === 'cracking';

  // Страховка: сервер не прислал crack_spin_in_ms (например, бэкенд не пересобран).
  // Ждём 1.5 с и стартуем сами — иначе игрок зависнет на отсчёте навсегда.
  useEffect(() => {
    if (spinAnchor != null || !cracking) return;
    const t = window.setTimeout(() => {
      if (spinAnchorRef.current != null) return;
      spinAnchorRef.current = Date.now() + 1200;
      startedAtRef.current = spinAnchorRef.current;
      setSpinAnchor(spinAnchorRef.current);
      console.warn('[safe-crack] сервер не прислал crack_spin_in_ms — старт назначен локально, синхронизации между игроками нет. Пересоберите бэкенд.');
    }, 1500);
    return () => window.clearTimeout(t);
  }, [spinAnchor, cracking]);

  // ── Предстартовая последовательность: отсчёт → код → вращение ───────────
  // Все фазы привязаны к АБСОЛЮТНОМУ моменту общего старта (spinAnchor), а не к
  // времени монтирования экрана, поэтому у каждого игрока «1» сменяется
  // вращением в один и тот же миг. Пересчёт каждые 100 мс + мгновенно при
  // возврате во вкладку: фоновую вкладку Chrome троттлит (таймеры раз в секунду,
  // через пять минут в фоне — раз в минуту), а настенные часы не обманешь.
  // Код показывается за crack_code_lead_ms до старта (по умолчанию 3 с).
  useEffect(() => {
    if (myTime != null) return;        // результат уже засчитан — отсчёт не запускаем
    if (spinAnchor == null) return;    // ждём якорь от сервера (или страховочные 1.5 с)
    if (!cracking) return;
    const codeLead = Number(safe?.crack_code_lead_ms) > 0 ? Number(safe.crack_code_lead_ms) : 3000;
    startedAtRef.current = spinAnchor; // ОДИН якорь на всех: цифры барабанов совпадают
    let done = false;

    const apply = () => {
      if (done) return;
      const toSpin = spinAnchor - Date.now();
      if (toSpin <= 0) {
        done = true;
        setCountdown(0);
        setCodeRevealed(true);
        setPhase('spinning');
        // Барабаны раскрутились
        sfx.drumsStart();
        window.clearInterval(iv);
        document.removeEventListener('visibilitychange', onVis);
        return;
      }
      const step = Math.ceil(toSpin / 1000);
      setCountdown(step);
      // Тик на каждую смену секунды (3 → 2 → 1), последний — выше
      if (countdownSoundedRef.current !== step) {
        countdownSoundedRef.current = step;
        if (step > 0 && step <= 3) sfx.countdown(step);
      }
      setCodeRevealed(toSpin <= codeLead);
    };

    const iv = window.setInterval(apply, 100);
    const onVis = () => { if (document.visibilityState === 'visible') apply(); };
    document.addEventListener('visibilitychange', onVis);
    apply();

    return () => {
      done = true;
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [myTime, spinAnchor, cracking, safe?.crack_code_lead_ms]);

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
    const t = setTimeout(() => goToSafeResults(nav), delay);
    return () => clearTimeout(t);
  }, [finished, phase, nav]);

  const submit = (finalTaps: number[]) => {
    // Время взлома = момент остановки последнего барабана. Штрафов за промахи
    // нет: промахнувшийся игрок тапает снова и теряет время сам.
    const totalTime = Math.max(...finalTaps);

    submittedRef.current = true;
    setPhase('done');
    // Все три барабана встали — код собран, замок открывается
    sfx.drumsStop();
    sfx.vaultOpen();

    if (!hasDepositRef.current) {
      sfx.error();
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
        sfx.confirm();
        showToast(`Код собран за ${(shown / 1000).toFixed(2)} с`);
        refreshUser();
        // Все участники сдали результат — сервер подвёл итоги досрочно
        if (r?.finished) setFinished(true);
        else load();
      })
      .catch((e: any) => {
        // Сервер отклонил результат (цифры не совпали с кодом, окно закрылось) —
        // если время ещё есть, барабаны раскручиваются снова, игрок пробует ещё раз
        sfx.error();
        showToast(e.message);
        submittedRef.current = false;
        submittedNowRef.current = false;
        if (windowDeadlineRef.current != null && Date.now() >= windowDeadlineRef.current) {
          setFinished(true);
          return;
        }
        setMyTime(null);
        setPhase('spinning');
        sfx.drumsStart();
        // startedAtRef НЕ сбрасываем: барабаны продолжают крутиться от общего
        // якоря, иначе повторная попытка рассинхронизировала бы игрока с остальными
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
    const tapCode: number[] = safe?.code || [];
    if (tapCode.length !== 3) { showToast('Код ещё не загрузился — попробуйте тапнуть ещё раз'); return; }

    const tapTime = Math.round(Date.now() - startedAtRef.current);
    const shown = digitAt(speeds, i, tapTime);

    if (shown !== tapCode[i]) {
      // Промах: сухой щелчок и ошибка вибрацией — барабан продолжает крутиться
      sfx.drumMiss();
      sfx.haptic('error');
      setFlash({ i, digit: shown });
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlash(null), 400);
      return;
    }

    // Барабан встал на цифру кода
    sfx.drumLock(i);
    sfx.haptic('success');
    const newTaps = [...tapsRef.current];
    newTaps[i] = tapTime;
    tapsRef.current = newTaps;
    setTaps(newTaps);

    const done = newTaps.filter(t => t !== undefined) as number[];
    if (done.length === 3) submit(done);
  };

  if (!safe) return <><Header title="ВЗЛОМ СЕЙФА" icon="lockOpen" /><div className="text-center mt">Загрузка...</div></>;

  // До открытия кода сервер присылает null: показывать 0-0-0 нельзя — игрок
  // принял бы их за настоящий код (и барабаны «остановились» бы на нуле).
  const code: number[] | null = Array.isArray(safe.code) && safe.code.length === 3 ? safe.code : null;
  const showWindow = windowLeft != null && windowLeft > 0;
  const windowClosed = windowLeft === 0;
  const stoppedCount = taps.filter(t => t !== undefined).length;

  return (
    <>
      <Header title="ВЗЛОМ СЕЙФА" icon="lockOpen" />

      {/* Какой аккаунт играет сейчас: при нескольких вкладках/браузерах это
          единственное место, где видно, чей результат засчитывается */}
      {user && (
        <div className="text-dim text-center" style={{ fontSize: 12, margin: '2px 0 6px' }}>
          <Icon name="user" size={13} strokeWidth={2} /> играет @{user.username || 'demo'}
        </div>
      )}

      <SafeCrackScene
        phase={phase === 'spinning' ? 'spinning' : phase === 'done' ? 'result' : 'idle'}
        code={code || [0, 0, 0]}
        drumSpeeds={safe.drum_speeds}
        /* Якорь и тапы — те же числа, по которым DOM рисует цифры и по которым
           сервер засчитывает тап. Без них 3D-барабан шёл бы от собственных
           часов и показывал соседнюю цифру. startedAt передаём числом, а не
           рефом: сцена читает его в кадре, ре-рендер не нужен. */
        startedAt={startedAtRef.current || undefined}
        taps={taps}
      />

      {showWindow && phase !== 'done' && (
        <div className="timer" style={{ color: (windowLeft as number) < 15000 ? 'var(--red)' : undefined }}>
          <Icon name="timer" size={14} strokeWidth={2.1} /> Нужно взломать сейф за: {fmtWindow(windowLeft as number)}
        </div>
      )}
      {windowClosed && phase !== 'done' && (
        <div className="timer" style={{ color: 'var(--red)' }}>
          <Icon name="timer" size={14} strokeWidth={2.1} /> Время вышло — результат не будет засчитан
        </div>
      )}

      {!myDeposit && (
        <div className="text-center text-dim mt" style={{ fontSize: 13 }}>
          Вы не вносили вклад в этот сейф — можно посмотреть взлом со стороны
        </div>
      )}

      {/* ОБЩИЙ старт: отсчёт заканчивается у всех игроков в один и тот же миг,
          поэтому никто не начинает вводить шифр раньше остальных */}
      {phase === 'countdown' && spinAnchor == null && (
        <div className="text-center mt text-dim">Синхронизируем общий старт...</div>
      )}

      {phase === 'countdown' && spinAnchor != null && !codeRevealed && (
        <div className="text-center mt">
          <div className="countdown-big">{countdown}</div>
          <div className="text-dim">
            Общий старт для всех игроков{spinAtLabel ? ` — ${spinAtLabel} МСК` : ''}
          </div>
          <div className="text-dim" style={{ fontSize: 12, marginTop: 4 }}>
            Барабаны начнут вращаться одновременно у всех участников, код появится за 3 с до старта
          </div>
        </div>
      )}

      {phase === 'countdown' && spinAnchor != null && codeRevealed && (
        <div className="card card-hl text-center mt">
          <div className="card-title" style={{ fontSize: 24 }}>КОД:</div>
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', fontSize: 56, fontWeight: 900, color: 'var(--gold)', margin: '16px 0' }}>
            {code
              ? <><span>{code[0]}</span><span>{code[1]}</span><span>{code[2]}</span></>
              : <span style={{ fontSize: 20, color: 'var(--text-dim)' }}>загружаем код…</span>}
          </div>
          <div style={{ fontSize: 30, fontWeight: 900, color: 'var(--red)' }}>СТАРТ ЧЕРЕЗ {countdown}</div>
          <div className="text-dim">Запомните код — он показывается один раз. Барабан остановится только на своей цифре.</div>
          <div className="text-dim" style={{ fontSize: 12, marginTop: 4 }}>
            Старт у всех игроков одновременно{spinAtLabel ? ` — ${spinAtLabel} МСК` : ''}
          </div>
        </div>
      )}

      {phase === 'spinning' && (
        <>
          <div className="text-center mt" style={{ fontSize: 18 }}>
            Остановите барабаны на цифрах кода
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
              // Состояние барабана — модификаторами класса (.drum--stopped /
              // .drum--miss): рамка, цвет, свечение и пружинка уже описаны в
              // app.css, inline-стили дублировали их и расходились в деталях
              const drumClass = ['drum', isStopped && 'drum--stopped', isFlash && 'drum--miss']
                .filter(Boolean).join(' ');
              return (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div className="drum__label">барабан {i + 1}</div>
                  <div className={drumClass} onClick={() => tapDrum(i)}>
                    {shownDigit}
                  </div>
                  <div className="drum__time" style={isStopped ? { color: 'var(--green)' } : undefined}>
                    {isStopped ? `${(taps[i]! / 1000).toFixed(2)} с — засчитано` : isFlash ? 'промах — крутится дальше' : 'крутится'}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-dim text-center" style={{ fontSize: 14 }}>
            {stoppedCount}/3
          </div>
        </>
      )}

      {phase === 'done' && (
        <>
          <div className="card mt text-center">
            <div className="result-text win"><Icon name="check" size={22} strokeWidth={2.6} /> Код собран: {code ? `${code[0]} ${code[1]} ${code[2]}` : '—'}</div>
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
            <button className="btn mt" onClick={() => goToSafeResults(nav)}>К РЕЗУЛЬТАТАМ</button>
          </div>
          <button className="btn btn-secondary" onClick={() => nav('/')}><Icon name="home" size={16} strokeWidth={2} /> На главную</button>
        </>
      )}

      {/* Запас прокрутки под плавающий бейдж ракеты, чтобы он не накрывал барабаны */}
      {rocketFlying && <div style={{ height: 72 }} />}
    </>
  );
}
