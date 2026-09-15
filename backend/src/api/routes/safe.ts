import { Router } from 'express';
import { auth } from '../middleware/auth';
import { moneyBody } from '../middleware/security';
import {
  getActiveSafe, getCollectingSafe, getLastFinishedSafe, safeDeposit, cancelSafeDeposit, submitCrackTime,
  getSafeResults, getUserSafeDeposit, getSafeById,
  getCrackWindowMs, getCrackRemainingMs, getPendingCracksCount,
  getSpinLeadMs, getSpinStartInMs, isCodeRevealed, getCodeRevealInMs, SPIN_CODE_LEAD_MS
} from '../../services/safe';
import { nextMSK, fmtMSK } from '../../utils/time';

const router = Router();

// GET /api/safe/current
router.get('/current', auth, async (req, res) => {
  try {
    const user = (req as any).user;

    // Сейф, который принимает вклады прямо сейчас: во время взлома и после
    // розыгрыша это сейф следующей даты, и сбор не останавливается ни на минуту.
    // Считаем его ПЕРВЫМ: getCollectingSafe() при необходимости создаёт сейф сам.
    // Раньше при отсутствии «активного» сейфа маршрут отдавал collecting_safe: null,
    // и главная зависала на «Создаём сейф...» без таймера.
    const collecting = await getCollectingSafe();

    const safe = await getActiveSafe();
    const myDeposit = safe ? await getUserSafeDeposit(safe.id, user.id) : null;
    // Время до взлома — читается из настроек (час/минута в МСК)
    const { getSetting } = await import('../../services/revenue');
    const hour = parseInt((await getSetting('safe_crack_hour')) || '18');
    const minute = parseInt((await getSetting('safe_crack_minute')) || '0');
    const crackAt = nextMSK(hour, minute);
    const now = new Date();
    const timeToCrack = Math.max(0, crackAt.getTime() - now.getTime());

    // Во время взлома клиенту нужно знать длину окна и остаток (считается на
    // сервере от crack_started_at — клиентские часы могут врать)
    const isCracking = safe?.status === 'cracking';
    const crackWindowMs = isCracking ? await getCrackWindowMs() : null;
    const crackRemainingMs = isCracking ? await getCrackRemainingMs(safe!.id, crackWindowMs ?? undefined) : null;
    const pendingCracks = isCracking ? await getPendingCracksCount(safe!.id) : null;

    // ОБЩИЙ старт мини-игры: все игроки начинают вращение в один момент по
    // серверным часам, независимо от того, когда их выдернуло на экран взлома.
    // Отдаём остаток в миллисекундах (а не абсолютную метку), чтобы клиентские
    // часы не влияли на результат; server_now нужен клиенту для диагностики
    // расхождения часов и для поправки на время доставки ответа.
    const spinLeadMs = isCracking ? await getSpinLeadMs(crackWindowMs ?? undefined) : null;
    const spinInMs = isCracking ? await getSpinStartInMs(safe!.id, crackWindowMs ?? undefined) : null;

    // Код сейфа отдаётся только с момента «открытия» (за 3 с до общего старта
    // вращения) и после завершения раунда. Прежняя версия возвращала код весь
    // статус cracking, то есть за 6 секунд до старта барабанов: этого хватало,
    // чтобы скриптом отправить результат на первой миллисекунде и забрать пул.
    // `code_reveal_in_ms` нужен клиенту, чтобы запросить код ровно в момент
    // открытия (опрос раз в 5 с мог бы опоздать к отсчёту 3-2-1).
    const codeRevealed = safe ? await isCodeRevealed(safe, crackWindowMs ?? undefined) : false;
    const codeRevealInMs = safe && isCracking && !codeRevealed
      ? await getCodeRevealInMs(safe!.id, crackWindowMs ?? undefined)
      : null;

    const collectingIsOther = !!collecting && collecting?.id !== safe?.id;
    const myCollectingDeposit = collectingIsOther
      ? await getUserSafeDeposit(collecting!.id, user.id)
      : myDeposit;

    // Последний завершённый раунд: экран сейфа показывает итоги только его
    // (вся история в БД остаётся, но клиенту достаточно последнего раунда)
    const lastFinished = await getLastFinishedSafe();
    const myLastDeposit = lastFinished && lastFinished.id !== safe?.id
      ? await getUserSafeDeposit(lastFinished.id, user.id)
      : (lastFinished && lastFinished.id === safe?.id ? myDeposit : null);

    res.json({
      last_finished: lastFinished ? {
        id: lastFinished.id,
        // Раунд закрыт — код уже не секрет: по нему 3D-сцена выравнивает барабаны
        code: lastFinished.status === 'finished' ? lastFinished.code : null,
        date: lastFinished.date,
        status: lastFinished.status,
        bank: lastFinished.bank,
        prize_pool: lastFinished.prize_pool,
        participants_count: lastFinished.participants_count,
        winners_count: lastFinished.winners_count,
        cracked_at: lastFinished.cracked_at
      } : null,
      my_last_deposit: myLastDeposit,
      collecting_safe: collecting ? {
        id: collecting!.id,
        // «взлом в HH:MM МСК» — подпись под обратным отсчётом на экранах (час берётся из настроек)
        crack_at_msk: fmtMSK(crackAt),
        bank: collecting.bank,
        prize_pool: collecting.prize_pool,
        participants_count: collecting.participants_count,
        status: collecting.status,
        date: collecting.date,
        crack_at: crackAt.toISOString(),
        time_to_crack_ms: timeToCrack
      } : null,
      my_collecting_deposit: myCollectingDeposit,
      safe: safe ? {
        id: safe.id,
        crack_at_msk: fmtMSK(crackAt),
        bank: safe.bank,
        prize_pool: safe.prize_pool,
        participants_count: safe.participants_count,
        winners_count: safe.winners_count,
        status: safe.status,
        code: codeRevealed ? safe.code : null,
        // Скорости барабанов без кода ничего не дают, но до розыгрыша это
        // всё равно часть секрета: отдаём их вместе с кодом.
        drum_speeds: codeRevealed ? safe.drum_speeds : null,
        date: safe.date,
        crack_at: crackAt.toISOString(),
        time_to_crack_ms: isCracking ? (crackRemainingMs ?? 0) : timeToCrack,
        crack_window_ms: crackWindowMs,
        crack_remaining_ms: crackRemainingMs,
        crack_spin_in_ms: spinInMs,
        crack_spin_lead_ms: spinLeadMs,
        crack_code_lead_ms: isCracking ? SPIN_CODE_LEAD_MS : null,
        code_reveal_in_ms: codeRevealInMs,
        pending_cracks: pendingCracks
      } : null,
      my_deposit: myDeposit,
      server_now: Date.now()
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/safe/deposit
router.post('/deposit', auth, moneyBody('amount',0.01), async (req, res) => {
  try {
    const user = (req as any).user;
    const { amount } = req.body;
    res.json(await safeDeposit(user.id, parseFloat(amount)));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/safe/cancel
router.post('/cancel', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    res.json(await cancelSafeDeposit(user.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/safe/crack
router.post('/crack', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { time_ms, taps } = req.body;
    const t = Number(time_ms);
    if (!Number.isFinite(t) || t < 0) throw new Error('Некорректное время взлома');
    // taps — моменты тапов по барабанам (мс от старта вращения): по ним сервер
    // сам проверяет, что игрок остановил барабаны на цифрах кода
    res.json(await submitCrackTime(user.id, t, taps));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/safe/results/:id
router.get('/results/:id', auth, async (req, res) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new Error('Некорректный ID сейфа');
    const results = await getSafeResults(id);
    res.json({ results, my_user_id: user.id });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * GET /api/safe/:id (replay)
 *
 * Требует авторизации и отдаёт только ЗАВЕРШЁННЫЕ сейфы. Прежде маршрут был
 * публичным и возвращал строку `safes` целиком: код и скорости барабанов
 * действующего раунда читались одним запросом `GET /api/safe/<id>` без токена
 * (проверено: код сегодняшнего сейфа отдавался всем). Клиент этим эндпоинтом
 * не пользуется — реплеи идут через /api/replay/safe/:id.
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new Error('Некорректный ID сейфа');
    const safe = await getSafeById(id);
    if (!safe || safe.status !== 'finished') return res.status(404).json({ error: 'Не найдено' });
    res.json(safe);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
