import { useEffect, useState, useCallback, useRef } from 'react';
import MoneyBreakdown from '../common/MoneyBreakdown';
import AmountChips from '../common/AmountChips';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import Icon, { type IconName } from '../ui/Icon';
import { dialog } from '../ui/Dialog';
import { formatAmount } from '../../utils/betChips';
import SafeCrackScene from '../../three/safe/SafeCrackScene';
import { safeApi, publicConfig } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { sfx } from '../../audio';
import { onSafeEvent } from '../../utils/socketEvents';
import { tabStore, resultSeenKey } from '../../utils/tabStore';

function fmt(n: number) { return (Number(n) || 0).toFixed(2); }

function timeToStr(ms: number) {
  if (ms <= 0) return '0:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}


/** Ключ флага: игрок уже видел итоги этого раунда. */
const seenKey = resultSeenKey;

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
      ? { key: 'late', icon: 'timer' as IconName, title: 'НЕ УСПЕЛИ', color: 'var(--red)', net }
      : { key: 'lose', icon: 'close' as IconName, title: 'ПОРАЖЕНИЕ', color: 'var(--red)', net };
  }
  if (net > 0) return { key: 'win', icon: 'trophy' as IconName, title: 'ПОБЕДА', color: 'var(--green)', net };
  if (net === 0) return { key: 'even', icon: 'equal' as IconName, title: 'В НОЛЬ', color: 'var(--cyan)', net };
  return { key: 'partial', icon: 'alert' as IconName, title: 'ЧАСТИЧНЫЙ ПРИЗ', color: 'var(--accent-2)', net };
}

/** «+$12.50» / «−$11.00» / «±$0.00» — прибыль или убыток относительно вклада. */
const fmtNet = (net: number) =>
  net > 0 ? `+$${fmt(net)}` : net < 0 ? `−$${fmt(-net)}` : '±$0.00';

export default function Safe() {
  const { user, refreshUser, showToast } = useAuth();
  const nav = useNavigate();
  // С экрана сейфа «назад» всегда ведёт в главное меню — независимо от того,
  // откуда игрока сюда перебросили (требование: фича «вернуться, откуда забрали»
  // убрана). replace, чтобы не плодить записи истории и не ходить по кругу.
  const backToMenu = useCallback(() => nav('/', { replace: true }), [nav]);

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

  // Итоги показываем один раз и только участнику раунда: если игрок в нём не
  // вкладывался, чужие результаты не должны раскрываться перед ним сами
  // (строка раунда остаётся, кнопка «ИТОГИ» — по желанию).
  useEffect(() => {
    if (!lastId) return;
    const seen = !!tabStore.get(seenKey(lastId));
    setShowLast(lastStatus === 'finished' && !seen && !!lastDeposit);
    sawResultRef.current = null;
  }, [lastId, lastStatus, lastDeposit]);

  // Уходим со страницы — результат этого раунда игрок уже видел, дальше не показываем
  useEffect(() => () => {
    if (sawResultRef.current != null) tabStore.set(seenKey(sawResultRef.current), String(Date.now()));
  }, []);
  useEffect(() => {
    if (showLast && lastId && lastStatus === 'finished' && results.length) sawResultRef.current = lastId;
  }, [showLast, lastId, lastStatus, results.length]);

  const markSeen = () => {
    if (lastId) {
      tabStore.set(seenKey(lastId), String(Date.now()));
      sawResultRef.current = null;
    }
    setShowLast(false);
  };

  // На мини-игру отправляем участника, который ещё не сдал результат, — но
  // только ОДИН раз за раунд: на этой же странице теперь живёт сбор следующего
  // сейфа, и выдёргивать игрока оттуда каждый раз нельзя (это и была «ловушка»).
  const isCracking = safe?.status === 'cracking';
  // Автопереход в мини-игру делает SafeCrackRedirector (App.tsx): он срабатывает
  // с любого экрана, а не только когда игрок уже стоит на /safe. Здесь остаётся
  // лишь кнопка для того, кто зашёл в игру сам или вернулся в неё повторно.

  const deposit = async () => {
    const a = parseFloat(amount);
    if (!a || a < minBet) { sfx.error(); return showToast(`Минимум $${minBet}`); }
    try {
      const r: any = await safeApi.deposit(a);
      const target = r?.safe_id ?? collect?.id;
      // Деньги ушли в сейф: звон монет и подтверждение
      sfx.deposit();
      sfx.money();
      showToast(`$${fmt(a)} внесено в СЕЙФ #${target}`);
      await refreshUser();
      load();
    } catch (e: any) {
      sfx.error();
      showToast(e.message);
    }
  };

  const cancel = async () => {
    // Кастомное окно вместо `window.confirm`: в Telegram WebView нативный
    // диалог нередко не показывается вовсе, и отмена вклада либо молча не
    // срабатывала, либо происходила без подтверждения
    const ok = await dialog.confirm({
      title: 'Вернуть вклад?',
      message: (
        <>
          Сумма вернётся на баланс, а призовой фонд сейфа
          {collect ? ` #${collect.id}` : ''} уменьшится. Повторно внести вклад
          в этот раунд можно, пока идёт сбор.
        </>
      ),
      confirmText: 'Вернуть вклад',
      cancelText: 'Оставить в сейфе',
      tone: 'danger',
      icon: 'lockOpen'
    });
    if (!ok) return;
    try {
      const r: any = await safeApi.cancel();
      sfx.refund();
      showToast(`$${fmt(r?.returned || 0)} возвращено (СЕЙФ #${r?.safe_id ?? collect?.id})`);
      await refreshUser();
      load();
    } catch (e: any) {
      sfx.error();
      showToast(e.message);
    }
  };

  if (!safe && !collect) {
    return <><Header title="Сейф" icon="lock" onBack={backToMenu} /><div className="text-center mt">Загрузка...</div></>;
  }

  const collecting = collect?.status === 'collecting';
  // Вклад вносится из доступных денег (баланс минус резерв дуэлей)
  const available = Number(user?.available ?? ((user?.balance || 0) - (user?.frozen_balance || 0))) || 0;
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
      <div className="card-title">
        <Icon name="coins" size={16} /> {collectDeposit ? 'Добавить ещё' : 'Внести в сейф'}
      </div>
      <input
        type="number" className="input input--amount" value={amount} inputMode="decimal"
        onChange={e => setAmount(e.target.value)} min={minBet}
      />
      {/* Номиналы от доступного баланса: прежний фиксированный ряд
          [10, 50, 100, 250, 500, 1000] не имел ничего общего с деньгами игрока */}
      <AmountChips available={available} value={amount} onChange={setAmount} min={minBet} allLabel="Всё" />
      <button className="btn btn-big btn-green" onClick={deposit}>
        <Icon name="deposit" size={18} strokeWidth={2} />
        {collectDeposit ? 'Добавить' : 'Внести'} ${formatAmount(parseFloat(amount) || 0)}
      </button>
    </>
  );

  return (
    <>
      <Header title="Сейф" icon="lock" onBack={backToMenu} />
      {user && (
        <div className="safe-whoami">
          <Icon name="user" size={13} strokeWidth={2} />
          @{user.username || 'demo'} · баланс ${fmt(user.balance)}
        </div>
      )}
      <SafeCrackScene
        phase={isCracking ? 'spinning' : last?.status === 'finished' ? 'result' : 'idle'}
        code={isCracking ? safe.code : (last?.code ?? undefined)}
        drumSpeeds={safe?.drum_speeds || undefined}
      />

      <div className="avail-line">
        {/* Здесь именно ДОСТУПНО (баланс минус заморозка дуэлей): подпись
            «Баланс» при таком значении врала */}
        <span className="avail-line__label"><Icon name="wallet" size={14} /> Доступно</span>
        <span className="avail-line__value">${formatAmount(available)}</span>
      </div>
      <MoneyBreakdown />

      {/* ── Взлом идёт: короткая строка состояния ────────────────────────────
          Игрок с вкладом в этом раунде сюда просто не попадает — его уводит в
          мини-игру SafeCrackRedirector с любого экрана в момент старта взлома.
          Карточка нужна тем, кто уже сдал результат, кто в этом раунде не
          участвовал, и как запасной вход для того, кто вышел из игры сам. */}
      {isCracking && (
        <div className="card" style={{ border: '1px solid var(--red)', background: 'rgba(255,68,68,0.08)', padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div className="safe-live__title"><Icon name="flame" size={15} strokeWidth={2.1} /> Сейф #{safe.id} — идёт взлом</div>
            <div style={{ fontWeight: 900, fontSize: 15, whiteSpace: 'nowrap', color: crackTime < 15000 ? 'var(--red)' : undefined }}>
              {crackTime > 0 ? `⏱ ${timeToStr(crackTime)}` : '⏳ подводим итоги…'}
            </div>
          </div>
          <div className="text-dim" style={{ fontSize: 12, marginTop: 4 }}>
            Сдали результат: {Math.max(0, (safe.participants_count ?? 0) - (safe.pending_cracks ?? 0))} из {safe.participants_count}
            {safeDeposit
              ? ((safeDeposit.crack_time_ms ?? null) != null
                ? ` · ваш результат ${(safeDeposit.crack_time_ms / 1000).toFixed(2)} с засчитан`
                : ' · мини-игра откроется сама')
              : ' · вы не вносили вклад в этот раунд'}
          </div>
          {safeDeposit
            ? ((safeDeposit.crack_time_ms ?? null) != null
              ? null
              : <button className="btn btn-small mt" onClick={() => nav('/safe/crack')}><Icon name="key" size={13} strokeWidth={2.2} /> Собрать код</button>)
            : <button className="btn btn-small mt" onClick={() => nav('/safe/crack')}><Icon name="eye" size={13} strokeWidth={2.2} /> Смотреть взлом</button>}
        </div>
      )}

      {/* ── Сбор: главный блок, сюда всегда можно внести вклад ───────────── */}
      {collecting && (
        <div className="card" style={{ border: isCracking ? undefined : '1px solid rgba(255,215,0,0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-title"><Icon name="lock" size={16} /> Сейф #{collect.id}</div>
            <span className="pill pill-active">сбор</span>
          </div>

          <div className="timer">⏰ {timeToStr(collectTime)}</div>
          <div className="text-center text-dim" style={{ fontSize: 12, marginTop: -4 }}>
            {collect.crack_at_msk ? `взлом в ${collect.crack_at_msk} МСК` : 'до взлома'}
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
                  {collect.prize_pool + 0.001 < collectDeposit.amount * 1.5 && (
                    <div className="text-dim" style={{ fontSize: 11, marginTop: 2 }}>
                      В пуле пока ${fmt(collect.prize_pool)} — для полного приза нужно больше.
                    </div>
                  )}
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
                {last.status === 'finished'
                  ? <><Icon name="trophy" size={15} /> Сейф #{last.id} — взломан</>
                  : <><Icon name="ban" size={15} /> Сейф #{last.id} — отменён</>}
              </div>
              <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>
                {last.status === 'finished'
                  ? <>Банк ${fmt(last.bank)} · призовой ${fmt(last.prize_pool)} · участников {last.participants_count} · с призом {last.winners_count}</>
                  : 'Не набрал минимум — вклады возвращены'}
                {last.status === 'finished' && lastDeposit && (
                  <b style={{ color: out.color }}> · вы: ${fmt(prize)} <Icon name={out.icon} size={13} strokeWidth={2.2} /></b>
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
              <Link className="btn btn-small btn-secondary" state={{replayFrom:'/safe'}} to={`/replay/safe/${last.id}?player=${encodeURIComponent('@'+(user?.username||'user'))}`}><Icon name="replay" size={13} /> Реплей и ссылка</Link>
              {/* Исход для игрока: приз и результат «чистыми» */}
              {showOutcome && (
                <div className="card" style={{ margin: '12px 0 0', background: `${out.color}1f`, border: `1px solid ${out.color}` }}>
                  <div className="card-title" style={{ margin: 0 }}>Ваш вклад: ${fmt(depAmount)}</div>
                  <div style={{ fontWeight: 900, fontSize: out.key === 'win' ? 26 : 22, margin: '6px 0', color: out.color }}>
                    <Icon name={out.icon} size={16} strokeWidth={2.1} /> {out.title}
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
                      Результат не был сдан вовремя. Вы поставлены в конец очереди; среди опоздавших приоритет у более раннего вклада.
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
                    Призовой пул ${fmt(last.prize_pool)} раздаётся по очереди: сначала завершившим взлом, затем не успевшим — по времени внесения вклада.
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
                          color: isMe ? 'var(--gold)' : o.color,
                          background: isMe ? 'rgba(255,215,0,0.08)' : undefined,
                          borderRadius: 6,
                          padding: '6px 4px'
                        }}>
                          <span>{i + 1}. {r.username}{isMe ? ' (вы)' : ''} · {timeStr}</span>
                          <span style={{ textAlign: 'right' }}>
                            ${fmt(r.amount)} → ${fmt(r.prize)} <b>({fmtNet(o.net)})</b> <Icon name={o.icon} size={13} strokeWidth={2.2} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
