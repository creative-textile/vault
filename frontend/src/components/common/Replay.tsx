/**
 * Публичный повтор раунда (Ракета / Дуэль / Сейф).
 *
 * Три исправления относительно прежней версии:
 *  1. ЗВУК. В живой игре ракета воет, тикает и взрывается, а повтор шёл в
 *     полной тишине — проигрываем те же эффекты по той же временной шкале.
 *  2. Никаких следов внутренней механики «красивого полёта»: подпись
 *     «✨ Красивый полёт: призрак долетел до x…» объясняла игроку устройство
 *     раунда (и что выплата фиксируется раньше взрыва). Сервер больше не отдаёт
 *     этот флаг, а текст убран отсюда.
 *  3. Дуэль: победитель «заработал» столько, сколько реально получил —
 *     приз минус своя ставка. Прежняя формула в сервисе реплеев делила банк
 *     пополам, и при ставке $50 повтор сообщал «+$5.00» вместо «+$40.00».
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { replayApi } from '../../api/client';
import DuelScene from '../../three/duel/DuelScene';
import SafeCrackScene from '../../three/safe/SafeCrackScene';
import RocketScene from '../../three/rocket/RocketScene';
import Icon from '../ui/Icon';
import { sfx, createTickTracker } from '../../audio';
import { formatAmount } from '../../utils/betChips';

const money = (n: number) => `$${formatAmount(Math.abs(Number(n) || 0))}`;

export default function Replay() {
  const { game, id } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [r, setR] = useState<any>();
  const [err, setErr] = useState('');
  const [elapsed, setElapsed] = useState(0);
  /** Инкремент на «Смотреть заново»: перезапускает rAF-таймлайн. */
  const [runId, setRunId] = useState(0);
  const [copied, setCopied] = useState(false);
  /** Звук по умолчанию включён, но браузер может потребовать жест пользователя. */
  const [soundOn, setSoundOn] = useState(true);
  const soundOnRef = useRef(true);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);

  const backTo = (location.state as { replayFrom?: string } | null)?.replayFrom || '/';

  useEffect(() => {
    let live = true;
    if (!['rocket', 'duel', 'safe'].includes(game || '')) { setErr('Неизвестный реплей'); return; }
    replayApi.get(game as any, Number(id)).then(x => live && setR(x)).catch(e => live && setErr(e.message));
    return () => { live = false; };
  }, [game, id]);

  // ── Таймлайн повтора ────────────────────────────────────────────────────
  // Зависит и от runId: без этого «Смотреть заново» обнулял elapsed, но
  // цикл уже был остановлен — ракета улетала в бесконечный полёт на x1.
  useEffect(() => {
    if (!r) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      setElapsed(Math.min(r.duration_ms, now - start));
      if (now - start < r.duration_ms) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, runId]);

  /** Однократные звуковые отметки таймлайна: каждая срабатывает ровно один раз. */
  const marksRef = useRef<Record<string, boolean>>({});
  const once = (key: string, fn: () => void) => {
    if (marksRef.current[key]) return;
    marksRef.current[key] = true;
    if (soundOnRef.current) fn();
  };

  const done = !!r && elapsed >= r.duration_ms;
  const mult = r && r.game === 'rocket'
    ? Math.min(r.outcome.crash_at, Math.exp(r.animation.curve * elapsed / 1000))
    : 1;
  const cashed = !!(r && r.game === 'rocket' && r.outcome.cashout_at && mult >= r.outcome.cashout_at);
  const rocketPhase = r?.game === 'rocket'
    ? (r.outcome.cashout_at ? (cashed ? 'cashed' : 'flying') : (done ? 'crashed' : 'flying'))
    : 'flying';

  // ── Звук по таймлайну (та же партитура, что в живой игре) ────────────────
  const engineRef = useRef(0);
  const tickRef = useRef(createTickTracker());
  useEffect(() => {
    if (!r) return;
    marksRef.current = {};
    tickRef.current = createTickTracker();
    sfx.stopAll();
    if (r.game === 'rocket') {
      once('ignite', () => { sfx.ignite(); sfx.engineStart(); });
    }
    if (r.game === 'duel') {
      once('flip', () => sfx.coinFlip());
    }
    if (r.game === 'safe') {
      once('drums', () => sfx.drumsStart());
    }
    return () => { sfx.engineStop(); sfx.stopAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, soundOn]);

  useEffect(() => {
    if (!r) return;
    const now = performance.now();
    if (r.game === 'rocket' && !done) {
      if (now - engineRef.current > 100) { engineRef.current = now; if (soundOnRef.current) sfx.engineUpdate(mult); }
      if (soundOnRef.current) tickRef.current(mult, now);
      if (cashed) {
        once('cashout', () => {
          sfx.engineStop();
          sfx.cashout(r.outcome.cashout_at);
          sfx.win(Number(r.outcome.cashout_at) >= 10 || Number(r.outcome.profit) >= 100);
        });
      }
    }
    if (done) {
      if (r.game === 'rocket') {
        if (!r.outcome.cashout_at) once('crash', () => { sfx.engineStop(); sfx.crash(); sfx.haptic('heavy'); });
        else once('ghost-end', () => sfx.crash());
      }
      if (r.game === 'duel') {
        once('land', () => {
          sfx.coinLand();
          if (r.participants?.some((p: any) => p.won)) sfx.win(false);
          else sfx.neutral();
        });
      }
      if (r.game === 'safe') {
        once('vault', () => { sfx.drumsStop(); sfx.vaultOpen(); });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, done, cashed, mult, r]);

  const hero = useMemo(
    () => r && (r.participants.find((p: any) => p.name === params.get('player'))
      || r.participants.find((p: any) => p.won)
      || r.participants[0]),
    [r, params]
  );

  if (err) return (
    <div className="card text-center replay-error">
      <Icon name="alert" size={22} strokeWidth={2} />
      <div>{err}</div>
      <a href="/" className="btn btn-small mt">Открыть VAULT</a>
    </div>
  );
  if (!r) return <div className="text-center mt replay-loading"><span className="spinner" /> Загрузка повтора…</div>;

  // ── Заголовок. Для дуэли говорим о ВЫПЛАТЕ победителя, а не о «заработал»:
  //    `net` считается сервером как приз минус своя ставка.
  const headline = r.game === 'safe'
    ? (hero?.profit > 0
      ? `${hero.name} забрал ${money(hero.profit)} в Сейфе`
      : hero?.profit < 0
        ? `${hero.name} потерял ${money(hero.profit)} в Сейфе`
        : `${hero?.name} вышел в ноль в Сейфе`)
    : r.game === 'duel'
      ? (hero?.won
        ? `${hero?.name} выиграл дуэль и забрал ${money(r.outcome.prize)}`
        : `${hero?.name} сыграл дуэль и потерял ${money(hero?.net ?? r.outcome.amount)}`)
      : `${hero?.name} ${r.outcome.cashout_at
        ? `забрал ${money(r.outcome.payout)} на x${r.outcome.cashout_at.toFixed(2)}`
        : `рискнул ${money(r.outcome.bet)}`}`;

  const share = async () => {
    const url = window.location.href;
    const text = `${headline}. Смотри повтор в VAULT:`;
    try {
      if (navigator.share) await navigator.share({ title: headline, text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 2200); }
    } catch { /* отмена шара — не ошибка */ }
  };

  /**
   * Проиграть повтор заново. Заодно «разблокировать» звук: браузеры и Telegram
   * WebView создают AudioContext только после жеста пользователя, поэтому первое
   * открытие ссылки может пройти в тишине — нажатие кнопки это лечит.
   */
  const restart = () => {
    marksRef.current = {};
    setElapsed(0);
    setRunId((x) => x + 1);
    tickRef.current = createTickTracker();
    sfx.unlock();
    if (soundOnRef.current) {
      sfx.transition();
      // Эффект, заводящий турбину, исполняется только на загрузку данных
      // ([r, soundOn]) — после «Смотреть заново» его никто не повторит,
      // поэтому зажигаем двигатель прямо здесь
      if (r?.game === 'rocket') {
        sfx.engineStop();
        sfx.ignite();
        sfx.engineStart();
      }
    }
  };

  return (
    <>
      <div className="replay-topbar">
        <button
          className="btn btn-secondary replay-back" type="button"
          onClick={() => backTo === '/' ? navigate('/', { replace: true }) : navigate(-1)}
        >
          <Icon name="chevronLeft" size={17} strokeWidth={2.3} /> Назад
        </button>
        <button
          className="btn btn-secondary replay-sound" type="button"
          onClick={() => setSoundOn(v => {
            const n = !v;
            soundOnRef.current = n;
            if (!n) { sfx.engineStop(); sfx.stopAll(); }
            else { sfx.unlock(); restart(); }
            return n;
          })}
          aria-label={soundOn ? 'Выключить звук' : 'Включить звук'}
        >
          <Icon name={soundOn ? 'volume' : 'volumeOff'} size={17} strokeWidth={2} />
        </button>
      </div>

      <div className="card replay-headline">
        <div className="replay-headline__label">
          <Icon name="replay" size={13} strokeWidth={2.2} /> ИТОГ ИГРЫ · VAULT
        </div>
        <div className="replay-headline__text">{headline}</div>
      </div>

      {r.game === 'rocket' && (
        <RocketScene
          key={`rocket-${runId}`}
          phase={rocketPhase} multiplier={mult} cashoutAt={r.outcome.cashout_at || 1}
          crashAt={r.outcome.crash_at} seed={r.animation.seed}
        />
      )}
      {r.game === 'duel' && <DuelScene phase={done ? 'result' : 'flipping'} result={r.outcome.result} trajectory={r.animation.trajectory} />}
      {r.game === 'safe' && <SafeCrackScene phase={done ? 'result' : 'spinning'} code={r.animation.code} drumSpeeds={r.animation.drum_speeds} />}

      {/* Полоса прогресса повтора + повторный просмотр */}
      <div className="replay-timeline">
        <div className="replay-timeline__bar">
          <div className="replay-timeline__fill" style={{ width: `${Math.min(100, (elapsed / (r.duration_ms || 1)) * 100)}%` }} />
        </div>
        <button className="replay-timeline__again" type="button" onClick={restart} disabled={!done}>
          <Icon name="refresh" size={14} strokeWidth={2.2} /> {done ? 'Смотреть заново' : 'Идёт повтор…'}
        </button>
      </div>

      <div className="card">
        {r.game === 'rocket' && <>
          <div className="history-item"><span>Ставка</span><b>{money(r.outcome.bet)}</b></div>
          <div className="history-item">
            <span>Кэшаут</span>
            <b className="text-green">
              {r.outcome.cashout_at ? `x${r.outcome.cashout_at.toFixed(2)} · ${money(r.outcome.payout)}` : 'Не успел забрать'}
            </b>
          </div>
          <div className="history-item">
            <span>Чистый результат</span>
            <b className={r.outcome.profit >= 0 ? 'text-green' : 'text-red'}>
              {r.outcome.profit >= 0 ? '+' : '−'}{money(r.outcome.profit)}
            </b>
          </div>
          <div className="history-item">
            <span>Финал полёта</span>
            <b>{done ? <>взрыв на x{r.outcome.crash_at.toFixed(2)}</> : 'полёт продолжается…'}</b>
          </div>
        </>}

        {r.game === 'duel' && <>
          <div className="history-item"><span>Ставка каждого</span><b>{money(r.outcome.amount)}</b></div>
          {r.participants.map((p: any) => (
            <div className="history-item" key={p.name}>
              <span className="row-label">
                <Icon name={p.won ? 'trophy' : 'swords'} size={14} strokeWidth={2.1} /> {p.name}
              </span>
              <b className={p.won ? 'text-green' : 'text-red'}>
                {/* Победителю выплачивается весь банк за вычетом комиссии:
                    «+$40.00» при ставке $50, а не «+$5.00» */}
                {p.won
                  ? `выплата ${money(r.outcome.prize)} · +${money(p.net)}`
                  : `−${money(p.net)}`}
              </b>
            </div>
          ))}
          {done && (
            <div className="replay-verdict">
              Выпало: <b>{r.outcome.result === 'heads' ? 'ОРЁЛ' : 'РЕШКА'}</b>
              <span className="replay-verdict__prize">банк {money(r.outcome.prize)}</span>
            </div>
          )}
        </>}

        {r.game === 'safe' && r.participants.map((p: any) => (
          <div className="history-item replay-safe-row" key={p.name}>
            <span className="replay-safe-row__who">
              <Icon name={p.won ? 'trophy' : 'clock'} size={14} strokeWidth={2.1} />
              #{p.rank} {p.name}
              <small className="text-dim">
                Вклад {money(p.amount)}{p.time_ms ? ` · ${(p.time_ms / 1000).toFixed(2)} с` : ' · не успел'}
              </small>
            </span>
            <span className="replay-safe-row__money">
              <b>{p.prize > 0 ? `Получил ${money(p.prize)}` : 'Без приза'}</b>
              <small className={p.profit > 0 ? 'text-green' : p.profit < 0 ? 'text-red' : 'text-dim'}>
                {p.profit > 0 ? `Заработал ${money(p.profit)}` : p.profit < 0 ? `Потерял ${money(p.profit)}` : 'Вышел в ноль'}
              </small>
            </span>
          </div>
        ))}
      </div>

      <div className="replay-actions">
        <button className="btn btn-secondary" onClick={share} type="button">
          <Icon name={copied ? 'check' : 'share'} size={16} strokeWidth={2.1} />
          {copied ? 'Ссылка скопирована' : 'Поделиться'}
        </button>
        <a className="btn btn-green" href="/"><Icon name="play" size={16} strokeWidth={2.2} /> Играть в VAULT</a>
      </div>
    </>
  );
}
