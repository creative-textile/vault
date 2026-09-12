import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import SafeCrackScene from '../../three/safe/SafeCrackScene';
import { safeApi, publicConfig } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { onSafeEvent } from '../../utils/socketEvents';

function fmt(n: number) { return (Number(n) || 0).toFixed(2); }

function timeToStr(ms: number) {
  if (ms <= 0) return '0:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const CHIPS_DEFAULTS = [10, 50, 100, 250, 500, 1000];

/** Ключ localStorage: игрок уже видел итоги этого раунда. */
const seenKey = (id: number) => `vault:safe-result-seen:${id}`;

/**
 * Исход розыгрыша для одного вклада.
 * Важно: приз — это выплата, а не заработок. Игрок, вложивший $50 и получивший
 * $39 из остатка пула, в минусе на $11, и называть это «победой» нельзя.
 * Поэтому сравниваем приз с вкладом и показываем результат «чистыми».
 */
function outcomeOf(amount: number, prize: number, crackTimeMs: number | null | undefined) {
  const net = Math.round(((Number(prize) || 0) - (Number(amount) || 0)) * 100) / 100;
  if (!(prize > 0)) {
    return crackTimeMs == null
      ? { key: 'late', icon: '⏱', title: 'НЕ УСПЕЛИ', color: '#ef4444', net }
      : { key: 'lose', icon: '❌', title: 'ПОРАЖЕНИЕ', color: '#ef4444', net };
  }
  if (net > 0) return { key: 'win', icon: '🏆', title: 'ПОБЕДА', color: '#22c55e', net };
  if (net === 0) return { key: 'even', icon: '⚖️', title: 'В НОЛЬ', color: '#38bdf8', net };
  return { key: 'partial', icon: '⚠️', title: 'ЧАСТИЧНЫЙ ПРИЗ', color: '#f59e0b', net };
}

/** «+$12.50» / «−$11.00» / «±$0.00» — прибыль или убыток относительно вклада. */
const fmtNet = (net: number) =>
  net > 0 ? `+$${fmt(net)}` : net < 0 ? `−$${fmt(-net)}` : '±$0.00';

export default function Safe() {
  const { user, refreshUser, showToast } = useAuth();
  const nav = useNavigate();

  // Активный сейф: нужен только для фазы взлома (остальное — собирающий и последний раунд)
  const [safe, setSafe] = useState<any>(null);
  // Вклад игрока в активном сейфе (во время взлома — во взламываемом)
  const [safeDeposit, setSafeDeposit] = useState<any>(null);
  // Сейф, который принимает вклады прямо сейчас: во время взлома и после
  // розыгрыша это сейф следующего цикла — сбор не останавливается
  const [collect, setCollect] = useState<any>(null);
  const [collectDeposit, setCollectDeposit] = useState<any>(null);
  // Последний завершённый раунд — единственная история, которую показываем
  const [last, setLast] = useState<any>(null);
  const [lastDeposit, setLastDeposit] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [showLast, setShowLast] = useState(false);

  const [amount, setAmount] = useState('100');
  const [collectTime, setCollectTime] = useState(0);
  const [crackTime, setCrackTime] = useState(0);
  const [safeMinBank, setSafeMinBank] = useState(25);
  const [minBet, setMinBet] = useState(1);

  // Дедлайны в ref: объект Date в зависимостях эффекта пересоздавался на каждом
  // опросе и запускал эффект заново — отсюда бесконечные запросы /api/safe/current
  const collectAtRef = useRef<number | null>(null);
  const crackAtRef = useRef<number | null>(null);
  const resultsForRef = useRef<number | null>(null);
  const sawResultRef = useRef<number | null>(null);

  useEffect(() => {
    publicConfig().then(c => {
      setSafeMinBank(c.safe_min_bank || 25);
      setMinBet(c.min_bet || 1);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await safeApi.current();
      setSafe(r.safe);
      setSafeDeposit(r.my_deposit ?? null);
      setCollect(r.collecting_safe || r.safe);
      setCollectDeposit(r.my_collecting_deposit !== undefined ? r.my_collecting_deposit : r.my_deposit);
      setLast(r.last_finished || null);
      setLastDeposit(r.my_last_deposit ?? null);

      // Отсчёт до взлома собирающего сейфа
      const cms = r.collecting_safe?.time_to_crack_ms ?? r.safe?.time_to_crack_ms ?? 0;
      setCollectTime(Math.max(0, cms));
      collectAtRef.current = Date.now() + Math.max(0, cms);
      // Остаток окна взлома (только когда взлом идёт)
      if (r.safe?.status === 'cracking' && r.safe?.crack_remaining_ms != null) {
        setCrackTime(Math.max(0, r.safe.crack_remaining_ms));
        crackAtRef.current = Date.now() + r.safe.crack_remaining_ms;
      } else {
        crackAtRef.current = null;
      }
    } catch {}
  }, []);

  useEffect(() => {
    load();
    // Локальный тикер обратного отсчёта (без запросов к серверу)
    const iv = setInterval(() => {
      if (collectAtRef.current) setCollectTime(Math.max(0, collectAtRef.current - Date.now()));
      if (crackAtRef.current) setCrackTime(Math.max(0, crackAtRef.current - Date.now()));
    }, 1000);
    // Контрольный опрос: основные обновления приходят по socket
    const poll = setInterval(load, 10000);
    const off = onSafeEvent(d => {
      // итоги/старт взлома/вклад — перечитываем сразу
      if (d.type === 'safe_finished') resultsForRef.current = null;
      load();
    });
    return () => { clearInterval(iv); clearInterval(poll); off(); };
  }, [load]);

  // Результаты последнего раунда грузим один раз на раунд, а не на каждом опросе
  const lastId = last?.id ?? null;
  const lastStatus = last?.status ?? null;
  useEffect(() => {
    if (!lastId || lastStatus !== 'finished') { setResults([]); resultsForRef.current = null; return; }
    if (resultsForRef.current === lastId) return;
    resultsForRef.current = lastId;
    safeApi.results(lastId)
      .then(r => setResults(r.results || []))
      .catch(() => { resultsForRef.current = null; });
  }, [lastId, lastStatus]);

  // Итоги показываем один раз: если игрок их ещё не видел — раскрываем карточку,
  // если видел (ключ в localStorage) — оставляем свёрнутой строкой
  useEffect(() => {
    if (!lastId) return;
    const seen = !!localStorage.getItem(seenKey(lastId));
    setShowLast(lastStatus === 'finished' && !seen);
    sawResultRef.current = null;
  }, [lastId, lastStatus]);

  // Уходим со страницы — результат этого раунда игрок уже видел, дальше не показываем
  useEffect(() => () => {
    if (sawResultRef.current != null) localStorage.setItem(seenKey(sawResultRef.current), String(Date.now()));
  }, []);
  useEffect(() => {
    if (showLast && lastId && lastStatus === 'finished' && results.length) sawResultRef.current = lastId;
  }, [showLast, lastId, lastStatus, results.length]);

  const markSeen = () => {
    if (lastId) {
      localStorage.setItem(seenKey(lastId), String(Date.now()));
      sawResultRef.current = null;
    }
    setShowLast(false);
  };

  // На мини-игру отправляем участника, который ещё не сдал результат, — но
  // только ОДИН раз за раунд: на этой же странице теперь живёт сбор следующего
  // сейфа, и выдёргивать игрока оттуда каждый раз нельзя (это и была «ловушка»).
  const isCracking = safe?.status === 'cracking';
  const autoSentRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isCracking || !safe?.id || !safeDeposit) return;
    if ((safeDeposit.crack_time_ms ?? null) != null) return; // результат уже сдан
    if (autoSentRef.current === safe.id) return;
    const key = `vault:safe-crack-visited:${safe.id}`;
    if (localStorage.getItem(key)) return; // в этом раунде игрок уже заходил в игру
    autoSentRef.current = safe.id;
    localStorage.setItem(key, '1');
    // replace: редирект не добавляет запись в историю — «назад» не зацикливается
    nav('/safe/crack', { replace: true });
  }, [isCracking, safe?.id, safeDeposit, nav]);

  const deposit = async () => {
    const a = parseFloat(amount);
    if (!a || a < minBet) return showToast(`Минимум $${minBet}`);
    try {
      const r: any = await safeApi.deposit(a);
      const target = r?.safe_id ?? collect?.id;
      showToast(`✅ $${a.toFixed(2)} внесено в СЕЙФ #${target}`);
      await refreshUser();
      load();
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const cancel = async () => {
    if (!confirm('Вернуть вклад? Призовой фонд будет уменьшен.')) return;
    try {
      const r: any = await safeApi.cancel();
      showToast(`💸 $${fmt(r?.returned || 0)} возвращено (СЕЙФ #${r?.safe_id ?? collect?.id})`);
      await refreshUser();
      load();
    } catch (e: any) {
      showToast(e.message);
    }
  };

  if (!safe && !collect) {
    return <><Header title="🔒 Сейф" /><div className="text-center mt">Загрузка...</div></>;
  }

  const collecting = collect?.status === 'collecting';
  // Итог игрока в последнем раунде: приз берём с сервера, а не считаем «×1.5»
  const prize = Number(lastDeposit?.prize || 0);
  const depAmount = Number(lastDeposit?.amount || 0);
  const depTime = lastDeposit?.crack_time_ms ?? null;
  const myPlace = results.length && user ? results.findIndex(r => r.user_id === user.id) + 1 : 0;
  const place = myPlace > 0 ? `место ${myPlace} из ${results.length}` : '';
  const out = outcomeOf(depAmount, prize, depTime);
  const showOutcome = last?.status === 'finished' && !!lastDeposit;

  const depositForm = (
    <>
      <div className="card-title">{collectDeposit ? 'Добавить ещё' : 'Внести'}</div>
      <input type="number" className="input" value={amount} onChange={e => setAmount(e.target.value)} min={1} />
      <div className="bet-chips">
        {CHIPS_DEFAULTS.filter(x => x >= minBet).map(c => <div key={c} className="chip" onClick={() => setAmount(String(c))}>${c}</div>)}
      </div>
      <button className="btn btn-big btn-green" onClick={deposit}>
        💰 {collectDeposit ? 'ДОБАВИТЬ' : 'ВНЕСТИ'} ${(parseFloat(amount) || 0).toFixed(0)}
      </button>
    </>
  );

  return (
    <>
      <Header title="🔒 Сейф" />
      <SafeCrackScene
        phase={isCracking ? 'spinning' : last?.status === 'finished' ? 'result' : 'idle'}
        code={isCracking ? safe.code : (last?.code ?? undefined)}
        drumSpeeds={safe?.drum_speeds || undefined}
      />

      <div style={{ padding: '8px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 }}>
        <span className="text-dim">Баланс:</span>
        <span className="text-accent" style={{ fontWeight: 700, fontSize: 18 }}>
          ${((user?.balance || 0) - (user?.frozen_balance || 0)).toFixed(2)}
        </span>
      </div>

      {/* ── Взлом: самый срочный блок, показываем первым ─────────────────── */}
      {isCracking && (
        <div className="card" style={{ border: '1px solid #ef4444', background: 'rgba(255,68,68,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-title">🔥 СЕЙФ #{safe.id} — ИДЁТ ВЗЛОМ</div>
            <span className="pill pill-active">взлом</span>
          </div>
          <div className="timer" style={{ color: crackTime < 15000 ? '#ef4444' : undefined }}>
            {crackTime > 0 ? `⏱ До конца окна: ${timeToStr(crackTime)}` : '⏳ Окно закрыто — подводим итоги...'}
          </div>
          <div className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
            Не сдали результат: {safe.pending_cracks ?? 0} из {safe.participants_count}.
            Итоги появятся сразу, как только все сдадут код, либо когда окно закроется.
          </div>
          {safeDeposit
            ? ((safeDeposit.crack_time_ms ?? null) != null
              ? <div className="text-green mt" style={{ fontWeight: 700 }}>
                  ✅ Ваш результат засчитан: {(safeDeposit.crack_time_ms / 1000).toFixed(2)} с
                </div>
              : <button className="btn mt" onClick={() => nav('/safe/crack')}>🔓 СОБРАТЬ КОД</button>)
            : <button className="btn btn-small mt" onClick={() => nav('/safe/crack')}>👀 СМОТРЕТЬ ВЗЛОМ</button>}
        </div>
      )}

      {/* ── Сбор: главный блок, сюда всегда можно внести вклад ───────────── */}
      {collecting && (
        <div className="card" style={{ border: isCracking ? undefined : '1px solid rgba(255,215,0,0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-title">🔒 СЕЙФ #{collect.id}</div>
            <span className="pill pill-active">сбор</span>
          </div>

          <div className="timer">⏰ {timeToStr(collectTime)}</div>
          <div className="text-center text-dim" style={{ fontSize: 12, marginTop: -4 }}>
            до взлома (время МСК)
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-around', margin: '12px 0', fontSize: 18 }}>
            <div className="text-center">
              <div className="text-dim" style={{ fontSize: 12 }}>Банк</div>
              <div className="text-accent" style={{ fontWeight: 900 }}>${fmt(collect.bank)}</div>
              <div className="text-dim" style={{ fontSize: 11 }}>призовой ${fmt(collect.prize_pool)}</div>
            </div>
            <div className="text-center">
              <div className="text-dim" style={{ fontSize: 12 }}>Участников</div>
              <div style={{ fontWeight: 900 }}>{collect.participants_count}</div>
              <div className="text-dim" style={{ fontSize: 11 }}>мин 2 чел.</div>
            </div>
            <div className="text-center">
              <div className="text-dim" style={{ fontSize: 12 }}>Старт</div>
              <div style={{ fontWeight: 900 }}>${safeMinBank}</div>
              <div className="text-dim" style={{ fontSize: 11 }}>мин. банк</div>
            </div>
          </div>

          {collectDeposit && (
            <div className="card" style={{ margin: '8px 0', background: 'rgba(255,215,0,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className="card-title" style={{ margin: 0 }}>Ваш вклад: ${fmt(collectDeposit.amount)}</div>
                  <div className="text-accent" style={{ fontWeight: 700 }}>
                    Возможный приз: ${fmt(collectDeposit.amount * 1.5)}
                  </div>
                </div>
                <button className="btn btn-small btn-danger" onClick={cancel}>ОТМЕНА</button>
              </div>
            </div>
          )}

          {depositForm}
          <div className="text-dim text-center" style={{ fontSize: 12, marginTop: 8 }}>
            Приз ×1.5 тому, кто соберёт код раньше остальных · мин. $1
          </div>
        </div>
      )}

      {/* ── Последний раунд: только он, без всей истории ─────────────────── */}
      {last && (
        <div className="card">
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: last.status === 'finished' ? 'pointer' : 'default' }}
            // отменённый раунд раскрывать нечего — только сводная строка
            onClick={() => last.status !== 'finished' ? undefined : (showLast ? markSeen() : setShowLast(true))}
          >
            <div>
              <div className="card-title" style={{ margin: 0 }}>
                {last.status === 'finished' ? `🏆 СЕЙФ #${last.id} — ВЗЛОМАН` : `⛔ СЕЙФ #${last.id} — ОТМЕНЁН`}
              </div>
              <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>
                {last.status === 'finished'
                  ? <>Банк ${fmt(last.bank)} · призовой ${fmt(last.prize_pool)} · участников {last.participants_count} · с призом {last.winners_count}</>
                  : 'Не набрал минимум — вклады возвращены'}
                {last.status === 'finished' && lastDeposit && (
                  <b style={{ color: out.color }}> · вы: ${fmt(prize)} {out.icon}</b>
                )}
              </div>
            </div>
            {last.status === 'finished' && (
              <span className="btn btn-small btn-secondary" style={{ pointerEvents: 'none' }}>
                {showLast ? 'СВЕРНУТЬ' : 'ИТОГИ'}
              </span>
            )}
          </div>

          {showLast && last.status === 'finished' && (
            <>
              {/* Исход для игрока: приз и результат «чистыми» */}
              {showOutcome && (
                <div className="card" style={{ margin: '12px 0 0', background: `${out.color}1f`, border: `1px solid ${out.color}` }}>
                  <div className="card-title" style={{ margin: 0 }}>Ваш вклад: ${fmt(depAmount)}</div>
                  <div style={{ fontWeight: 900, fontSize: out.key === 'win' ? 26 : 22, margin: '6px 0', color: out.color }}>
                    {out.icon} {out.title}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: out.color }}>
                    Приз: ${fmt(prize)}{' '}
                    <span className="text-dim" style={{ fontSize: 14, fontWeight: 400 }}>· чистыми {fmtNet(out.net)}</span>
                  </div>

                  {out.key === 'win' && (
                    <div className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
                      Код собран за {(depTime! / 1000).toFixed(2)} с{place ? ` · ${place}` : ''} · полный приз ×1.5
                      зачислен на баланс.
                    </div>
                  )}
                  {out.key === 'even' && (
                    <div className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
                      Код собран за {(depTime! / 1000).toFixed(2)} с{place ? ` · ${place}` : ''} · из остатка пула
                      вернулся ровно ваш вклад: ни прибыли, ни потерь.
                    </div>
                  )}
                  {out.key === 'partial' && (
                    <div className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
                      Код собран за {(depTime! / 1000).toFixed(2)} с{place ? ` · ${place}` : ''}. Полный приз ×1.5
                      составил бы ${fmt(depAmount * 1.5)}, но из призового пула ${fmt(last.prize_pool)} к вашему ходу
                      осталось только ${fmt(prize)} — выплачен этот остаток. Итог в минусе
                      на {fmtNet(out.net).replace('−', '')}, поэтому это не победа: игроки, сдавшие код раньше,
                      разобрали пул до вас.
                    </div>
                  )}
                  {out.key === 'lose' && (
                    <div className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
                      Код собран за {(depTime! / 1000).toFixed(2)} с{place ? ` · ${place}` : ''}, но призовой пул
                      ${fmt(last.prize_pool)} уже был распределён между игроками, сдавшими результат раньше.
                      Потеряно {fmtNet(out.net).replace('−', '')}.
                    </div>
                  )}
                  {out.key === 'late' && (
                    <div className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
                      Результат не был сдан до закрытия окна взлома — техническое поражение, приз $0.00.
                      Вклад ${fmt(depAmount)} ушёл в призовой пул и достался более быстрым игрокам.
                    </div>
                  )}
                </div>
              )}

              {!lastDeposit && (
                <div className="text-dim" style={{ fontSize: 13, marginTop: 10 }}>
                  Вы не участвовали в этом раунде.
                </div>
              )}

              {results.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="text-dim" style={{ fontSize: 12, marginBottom: 8 }}>
                    Призовой пул ${fmt(last.prize_pool)} раздаётся по порядку сдачи кода: сначала полный приз ×1.5,
                    затем остаток пула, дальше — $0.
                  </div>
                  <div className="scroll-list" style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {results.slice(0, 20).map((r, i) => {
                      const o = outcomeOf(r.amount, r.prize, r.crack_time_ms);
                      const participated = r.crack_time_ms != null && r.crack_time_ms > 0;
                      const timeStr = participated ? `${(r.crack_time_ms / 1000).toFixed(2)}с` : 'не успел';
                      const isMe = r.user_id === user?.id;
                      return (
                        <div key={i} className="history-item" style={{
                          fontSize: 13,
                          color: isMe ? '#ffd700' : o.color,
                          background: isMe ? 'rgba(255,215,0,0.08)' : undefined,
                          borderRadius: 6,
                          padding: '6px 4px'
                        }}>
                          <span>{i + 1}. {r.username}{isMe ? ' (вы)' : ''} · {timeStr}</span>
                          <span style={{ textAlign: 'right' }}>
                            ${fmt(r.amount)} → ${fmt(r.prize)} <b>({fmtNet(o.net)})</b> {o.icon}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="text-center" style={{ marginTop: 10 }}>
                <button className="btn btn-small btn-secondary" onClick={markSeen}>
                  ✓ Я ПОСМОТРЕЛ — БОЛЬШЕ НЕ ПОКАЗЫВАТЬ
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!collecting && !isCracking && !last && (
        <div className="card text-dim">Сейф создаётся...</div>
      )}
    </>
  );
}
