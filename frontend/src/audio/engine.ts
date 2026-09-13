/**
 * VAULT — звуковой движок (процедурный WebAudio).
 *
 * Почему синтез, а не файлы: приложение живёт в Telegram WebView на мобильных
 * сетях, каждый лишний килобайт ассета — это задержка первого экрана, а внешние
 * CDN-хосты звуков из Mini App недоступны. Синтез даёт ноль байт ассетов,
 * полный контроль над громкостью/высотой (звук полёта ракеты реально следует
 * за множителем) и отсутствие рассинхрона «файл не догрузился».
 *
 * Архитектура шины:
 *   голос → [dry gain] ─────────────┐
 *         → [reverb send] → convolver┤→ master gain → compressor → destination
 *                                    ┘
 * Компрессор обязателен: наложенные звуки (взрыв + тики + фанфары) иначе клиппуют.
 */

type Osc = OscillatorType;

/** Настройки, которые переживает перезагрузку страницы. */
export interface AudioSettings {
  muted: boolean;
  volume: number;      // 0..1
  haptics: boolean;
}

const LS_KEY = 'vault:audio:v1';

function loadSettings(): AudioSettings {
  const fallback: AudioSettings = { muted: false, volume: 0.75, haptics: true };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return {
      muted: !!p.muted,
      volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : fallback.volume,
      haptics: p.haptics !== false
    };
  } catch {
    return fallback;
  }
}

/** Короткий детерминированный шумовой буфер — переиспользуется всеми голосами. */
function makeNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    // Белый шум с лёгким «розовым» наклоном: звучит мягче, чем чистый white
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = white * 0.72 + last * 3.2;
    }
  }
  return buf;
}

/** Импульсная характеристика реверберации: «большой зал хранилища». */
function makeReverbIR(ctx: AudioContext, seconds = 2.1, decay = 2.6): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Экспоненциальный спад + редкие ранние отражения (ощущение металла/бетона)
      const env = Math.pow(1 - t, decay);
      const early = i < ctx.sampleRate * 0.09 && Math.random() < 0.0016 ? 2.2 : 0;
      data[i] = (Math.random() * 2 - 1) * env + (Math.random() * 2 - 1) * early * env;
    }
  }
  return buf;
}

/** Мягкая кривая насыщения (для взрыва и удара — добавляет «мяса»).
 *  Возвращаемый тип не аннотируем: `Float32Array` без параметра в TS 5.7+
 *  означает `Float32Array<ArrayBufferLike>` и не присваивается
 *  `WaveShaperNode.curve`, который ждёт обычный ArrayBuffer. */
function makeDistortionCurve(amount = 18) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private curve: ReturnType<typeof makeDistortionCurve> | null = null;

  /** Активные продолжительные голоса (двигатель ракеты, вращение барабанов). */
  private loops = new Map<string, { stop: (when?: number) => void }>();

  settings: AudioSettings = loadSettings();

  /** AudioContext можно создать только после жеста пользователя (iOS/Telegram). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.settings.muted ? 0 : this.settings.volume;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 26;
      comp.ratio.value = 7;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;

      const convolver = ctx.createConvolver();
      convolver.buffer = makeReverbIR(ctx);
      const reverbSend = ctx.createGain();
      reverbSend.gain.value = 0.3;
      const dry = ctx.createGain();
      dry.gain.value = 1;

      dry.connect(master);
      reverbSend.connect(convolver);
      convolver.connect(master);
      master.connect(comp);
      comp.connect(ctx.destination);

      this.master = master;
      this.compressor = comp;
      this.convolver = convolver;
      this.reverbSend = reverbSend;
      this.dry = dry;
      this.noiseBuf = makeNoiseBuffer(ctx, 2);
      this.curve = makeDistortionCurve(18);

      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      // Аудио недоступно (старый WebView) — игра остаётся полностью играбельной
      this.ctx = null;
    }
  }

  private persist(): void {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.settings)); } catch { /* приватный режим */ }
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.settings.volume, this.ctx.currentTime, 0.02);
    }
    if (muted) this.stopAllLoops();
    this.persist();
  }

  setVolume(v: number): void {
    this.settings.volume = Math.min(1, Math.max(0, v));
    if (this.master && this.ctx && !this.settings.muted) {
      this.master.gain.setTargetAtTime(this.settings.volume, this.ctx.currentTime, 0.02);
    }
    this.persist();
  }

  setHaptics(on: boolean): void {
    this.settings.haptics = on;
    this.persist();
  }

  get ready(): boolean {
    return !!this.ctx && !this.settings.muted;
  }

  private get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private bus(): { out: GainNode; send: (amount: number) => void } | null {
    if (!this.ctx || !this.dry || !this.reverbSend || this.settings.muted) return null;
    const out = this.ctx.createGain();
    out.gain.value = 1;
    out.connect(this.dry);
    return {
      out,
      send: (amount: number) => {
        if (!this.ctx) return;
        const g = this.ctx.createGain();
        g.gain.value = Math.min(1, Math.max(0, amount));
        out.connect(g);
        g.connect(this.reverbSend!);
      }
    };
  }

  /* ───────────────────────── примитивы синтеза ───────────────────────── */

  /** Один тон с огибающей ADSR-подобной формы. */
  private tone(opts: {
    freq: number; to?: number; type?: Osc; dur: number; gain?: number;
    attack?: number; delay?: number; detune?: number; sweepShape?: 'exp' | 'lin';
    out: AudioNode;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = this.now + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    const dur = Math.max(0.01, opts.dur);
    osc.frequency.setValueAtTime(Math.max(1, opts.freq), t0);
    if (opts.to && opts.to > 0) {
      if (opts.sweepShape === 'lin') osc.frequency.linearRampToValueAtTime(opts.to, t0 + dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + dur);
    }
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, t0);

    const g = ctx.createGain();
    const peak = opts.gain ?? 0.25;
    const atk = opts.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(opts.out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** noise → filter → gain с огибающей; основа ударов, шипения, взрывов. */
  private noise(opts: {
    dur: number; gain?: number; filter?: BiquadFilterType; freq?: number; to?: number;
    q?: number; attack?: number; delay?: number; rate?: number; distortion?: boolean;
    out: AudioNode; loop?: boolean;
  }): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return null;
    const t0 = this.now + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = opts.loop ?? true;
    if (opts.rate) src.playbackRate.setValueAtTime(opts.rate, t0);

    const dur = Math.max(0.01, opts.dur);
    let node: AudioNode = src;
    if (opts.filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = opts.filter;
      bq.frequency.setValueAtTime(Math.max(20, opts.freq ?? 1000), t0);
      if (opts.to) bq.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + dur);
      bq.Q.value = opts.q ?? 1;
      src.connect(bq);
      node = bq;
    }
    if (opts.distortion && this.curve) {
      const ws = ctx.createWaveShaper();
      ws.curve = this.curve;
      ws.oversample = '2x';
      node.connect(ws);
      node = ws;
    }
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    const atk = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g);
    g.connect(opts.out);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return src;
  }

  /** FM-колокол: золото, монеты, приз. Носитель + модулятор с быстрым спадом. */
  private bell(opts: {
    freq: number; dur?: number; gain?: number; ratio?: number; index?: number;
    delay?: number; out: AudioNode;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = this.now + (opts.delay ?? 0);
    const dur = opts.dur ?? 0.9;
    const ratio = opts.ratio ?? 2.76;
    const index = opts.index ?? 3.2;

    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(opts.freq, t0);

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(opts.freq * ratio, t0);
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(opts.freq * index, t0);
    modGain.gain.exponentialRampToValueAtTime(1, t0 + dur * 0.75);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const g = ctx.createGain();
    const peak = opts.gain ?? 0.22;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    carrier.connect(g);
    g.connect(opts.out);
    carrier.start(t0); mod.start(t0);
    carrier.stop(t0 + dur + 0.05); mod.stop(t0 + dur + 0.05);
  }

  /* ───────────────────────────── тактильность ─────────────────────────── */

  /** Вибро-отклик Telegram: звук и тактильность всегда идут парой. */
  haptic(style: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' = 'light'): void {
    if (!this.settings.haptics) return;
    try {
      const tg = (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: Record<string, unknown> } } }).Telegram?.WebApp;
      const hf = tg?.HapticFeedback as
        | { impactOccurred?: (s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
            notificationOccurred?: (s: 'error' | 'success' | 'warning') => void }
        | undefined;
      if (!hf) {
        if (navigator.vibrate) navigator.vibrate(style === 'heavy' ? 26 : style === 'medium' ? 16 : 9);
        return;
      }
      if (style === 'success' || style === 'error' || style === 'warning') hf.notificationOccurred?.(style);
      else hf.impactOccurred?.(style);
    } catch { /* тактильность не критична */ }
  }

  /* ─────────────────────────── звуки интерфейса ───────────────────────── */

  /** Касание кнопки/плитки: короткий «клик» механизмом. */
  tap(pitch = 1): void {
    const b = this.bus(); if (!b) return;
    this.tone({ freq: 1750 * pitch, to: 900 * pitch, type: 'triangle', dur: 0.055, gain: 0.085, out: b.out });
    this.noise({ dur: 0.028, gain: 0.05, filter: 'highpass', freq: 2600, out: b.out });
  }

  /** Вторичное действие (назад, закрыть). */
  tapSoft(): void {
    const b = this.bus(); if (!b) return;
    this.tone({ freq: 780, to: 520, type: 'sine', dur: 0.07, gain: 0.055, out: b.out });
  }

  /** Выбор фишки/номинала: керамический «клик» покерной фишки. */
  chip(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.18);
    this.noise({ dur: 0.045, gain: 0.13, filter: 'bandpass', freq: 3200, q: 3.4, out: b.out });
    this.tone({ freq: 2400, to: 1750, type: 'square', dur: 0.05, gain: 0.045, out: b.out });
    this.tone({ freq: 4200, type: 'sine', dur: 0.035, gain: 0.03, delay: 0.012, out: b.out });
    this.haptic('light');
  }

  /** Ввод цифры (PIN, сумма): тихий «тик» клавиатуры. */
  key(): void {
    const b = this.bus(); if (!b) return;
    this.tone({ freq: 1180 + Math.random() * 90, type: 'square', dur: 0.035, gain: 0.04, out: b.out });
  }

  /** Ошибка/отклонение: глухой двойной тон. */
  error(): void {
    const b = this.bus(); if (!b) return;
    this.tone({ freq: 196, to: 150, type: 'sawtooth', dur: 0.22, gain: 0.1, out: b.out });
    this.tone({ freq: 155, to: 120, type: 'square', dur: 0.26, gain: 0.06, delay: 0.03, out: b.out });
    this.noise({ dur: 0.12, gain: 0.05, filter: 'lowpass', freq: 900, out: b.out });
    this.haptic('error');
  }

  /** Подтверждение действия (не выигрыш): мягкий «ок». */
  confirm(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.22);
    this.bell({ freq: 880, dur: 0.4, gain: 0.1, out: b.out });
    this.bell({ freq: 1320, dur: 0.5, gain: 0.075, delay: 0.07, out: b.out });
    this.haptic('success');
  }

  /** Уведомление: два тона, не пугает и не перекрывает игру. */
  notify(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.3);
    this.bell({ freq: 1046, dur: 0.32, gain: 0.085, out: b.out });
    this.bell({ freq: 1568, dur: 0.4, gain: 0.06, delay: 0.09, out: b.out });
  }

  /** Пополнение/вывод приняты: кассовый «чинг». */
  money(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.34);
    [1318, 1760, 2093].forEach((f, i) => this.bell({ freq: f, dur: 0.75, gain: 0.11 - i * 0.015, delay: i * 0.055, out: b.out }));
    this.noise({ dur: 0.09, gain: 0.05, filter: 'highpass', freq: 5200, delay: 0.02, out: b.out });
    this.haptic('medium');
  }

  /* ───────────────────────────── РАКЕТА ──────────────────────────────── */

  /** Ставка принята: монета падает в кассу. */
  betPlace(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.3);
    this.bell({ freq: 2093, dur: 0.5, gain: 0.1, out: b.out });
    this.bell({ freq: 3136, dur: 0.42, gain: 0.06, delay: 0.035, out: b.out });
    this.tone({ freq: 180, to: 90, type: 'sine', dur: 0.16, gain: 0.11, delay: 0.05, out: b.out });
    this.noise({ dur: 0.05, gain: 0.06, filter: 'bandpass', freq: 4200, q: 2, delay: 0.05, out: b.out });
    this.haptic('medium');
  }

  /** Зажигание: шипение + нарастающий гул перед стартом двигателя. */
  ignite(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.4);
    this.noise({ dur: 0.85, gain: 0.2, filter: 'lowpass', freq: 240, to: 2600, attack: 0.18, out: b.out, distortion: true });
    this.noise({ dur: 0.5, gain: 0.1, filter: 'highpass', freq: 4200, attack: 0.02, out: b.out });
    this.tone({ freq: 42, to: 78, type: 'sawtooth', dur: 0.9, gain: 0.16, attack: 0.2, out: b.out });
    this.haptic('heavy');
  }

  /**
   * Двигатель в полёте: непрерывный гул + реактивная струя.
   * Высота и яркость растут вместе с множителем — звук «давит» к падению.
   */
  engineStart(): void {
    const ctx = this.ctx;
    if (!ctx || this.settings.muted || this.loops.has('engine')) return;
    const b = this.bus(); if (!b) return;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 0.22);
    out.connect(b.out);
    b.send(0.26);

    // Низкий корпус двигателя
    const sub = ctx.createOscillator();
    sub.type = 'sawtooth';
    sub.frequency.value = 58;
    const subG = ctx.createGain(); subG.gain.value = 0.5;
    const subLp = ctx.createBiquadFilter(); subLp.type = 'lowpass'; subLp.frequency.value = 240; subLp.Q.value = 3;
    sub.connect(subG); subG.connect(subLp); subLp.connect(out);

    // Реактивная струя: шум через полосовой фильтр
    const jet = ctx.createBufferSource();
    jet.buffer = this.noiseBuf!; jet.loop = true;
    const jetBp = ctx.createBiquadFilter();
    jetBp.type = 'bandpass'; jetBp.frequency.value = 900; jetBp.Q.value = 0.8;
    const jetG = ctx.createGain(); jetG.gain.value = 0.34;
    jet.connect(jetBp); jetBp.connect(jetG); jetG.connect(out);

    // Дрожание пламени (LFO на громкости струи)
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.11;
    lfo.connect(lfoG); lfoG.connect(jetG.gain);

    sub.start(); jet.start(); lfo.start();

    this.loops.set('engine', {
      stop: () => {
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setTargetAtTime(0.0001, t, 0.06);
        setTimeout(() => { try { sub.stop(); jet.stop(); lfo.stop(); } catch { /* уже остановлены */ } }, 400);
      }
    });

    // Сохраняем узлы, чтобы менять высоту по множителю
    (this.loops.get('engine') as unknown as { nodes: Record<string, AudioNode> }).nodes =
      { sub, subLp, jetBp, jetG, out };
  }

  /** Подстройка двигателя под текущий множитель (вызывается на каждый тик UI). */
  engineUpdate(multiplier: number): void {
    const ctx = this.ctx;
    const loop = this.loops.get('engine') as unknown as { nodes?: Record<string, AudioNode> } | undefined;
    if (!ctx || !loop?.nodes) return;
    const m = Math.min(20, Math.max(1, multiplier));
    const t = ctx.currentTime;
    const k = (m - 1) / 19;                       // 0..1 по множителю
    const sub = loop.nodes.sub as OscillatorNode;
    const subLp = loop.nodes.subLp as BiquadFilterNode;
    const jetBp = loop.nodes.jetBp as BiquadFilterNode;
    const jetG = loop.nodes.jetG as GainNode;
    sub.frequency.setTargetAtTime(58 + k * 78, t, 0.18);
    subLp.frequency.setTargetAtTime(240 + k * 620, t, 0.2);
    jetBp.frequency.setTargetAtTime(900 + k * 2100, t, 0.2);
    jetG.gain.setTargetAtTime(0.34 + k * 0.2, t, 0.2);
  }

  engineStop(): void {
    this.loops.get('engine')?.stop();
    this.loops.delete('engine');
  }

  /**
   * Тик множителя: тот самый «щелчок» crash-игр.
   * Темп и высота растут с множителем — напряжение накапливается звуком.
   */
  tickBlip(multiplier: number): void {
    const b = this.bus(); if (!b) return;
    const m = Math.max(1, multiplier);
    const freq = 620 + Math.min(1400, Math.log(m) * 900);
    this.tone({ freq, to: freq * 1.5, type: 'square', dur: 0.035, gain: 0.038 + Math.min(0.03, m * 0.002), out: b.out });
    if (m > 4) this.tone({ freq: freq * 2, type: 'sine', dur: 0.03, gain: 0.02, delay: 0.01, out: b.out });
  }

  /** Кэшаут: восходящий арпеджио колоколов + блеск (главный «приятный» звук). */
  cashout(multiplier = 2): void {
    const b = this.bus(); if (!b) return;
    b.send(0.42);
    const base = multiplier > 5 ? 1046 : 880;
    const seq = [0, 4, 7, 12];
    seq.forEach((semi, i) => {
      this.bell({ freq: base * Math.pow(2, semi / 12), dur: 0.85, gain: 0.12 - i * 0.012, delay: i * 0.062, out: b.out });
    });
    this.noise({ dur: 0.5, gain: 0.05, filter: 'highpass', freq: 6000, attack: 0.08, out: b.out });
    this.tone({ freq: 130, to: 260, type: 'sine', dur: 0.3, gain: 0.09, out: b.out });
    this.haptic('success');
  }

  /** Взрыв: шумовой удар + падающий сабы + треск обломков. */
  crash(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.55);
    this.noise({ dur: 1.25, gain: 0.34, filter: 'lowpass', freq: 5200, to: 180, attack: 0.006, out: b.out, distortion: true });
    this.tone({ freq: 120, to: 26, type: 'sine', dur: 1.1, gain: 0.3, attack: 0.008, out: b.out });
    this.tone({ freq: 62, to: 22, type: 'triangle', dur: 0.9, gain: 0.16, out: b.out });
    // Треск разлетающихся обломков: серия коротких щелчков
    for (let i = 0; i < 9; i++) {
      this.noise({
        dur: 0.05, gain: 0.07 - i * 0.005, filter: 'bandpass',
        freq: 1400 + Math.random() * 3200, q: 2.4, delay: 0.05 + i * 0.055 + Math.random() * 0.03, out: b.out
      });
    }
    this.haptic('heavy');
  }

  /* ───────────────────────────── ДУЭЛЬ ───────────────────────────────── */

  /** Бросок монеты: свист воздуха вверх-вниз. */
  coinFlip(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.4);
    this.noise({ dur: 0.62, gain: 0.14, filter: 'bandpass', freq: 420, to: 3600, q: 1.4, attack: 0.14, out: b.out });
    this.noise({ dur: 0.5, gain: 0.1, filter: 'bandpass', freq: 3600, to: 500, q: 1.6, delay: 0.42, attack: 0.06, out: b.out });
    this.tone({ freq: 320, to: 620, type: 'sine', dur: 0.5, gain: 0.05, out: b.out });
    this.haptic('medium');
  }

  /** Монета приземляется: металлический звон + пара мелких отскоков. */
  coinLand(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.5);
    this.bell({ freq: 2637, dur: 1.0, gain: 0.13, ratio: 3.1, index: 2.4, out: b.out });
    this.bell({ freq: 3951, dur: 0.75, gain: 0.07, delay: 0.012, out: b.out });
    this.noise({ dur: 0.09, gain: 0.09, filter: 'highpass', freq: 5400, out: b.out });
    // Отскоки затухают
    [0.16, 0.28, 0.37].forEach((d, i) => {
      this.bell({ freq: 2637 * (1 - i * 0.03), dur: 0.28 - i * 0.05, gain: 0.06 - i * 0.015, delay: d, out: b.out });
      this.noise({ dur: 0.03, gain: 0.05 - i * 0.012, filter: 'highpass', freq: 6000, delay: d, out: b.out });
    });
    this.haptic('heavy');
  }

  /** Создание/принятие вызова: короткий «клинок». */
  sword(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.34);
    this.noise({ dur: 0.34, gain: 0.12, filter: 'bandpass', freq: 1200, to: 5200, q: 2.6, out: b.out });
    this.bell({ freq: 1760, dur: 0.5, gain: 0.07, delay: 0.05, out: b.out });
  }

  /* ───────────────────────────── СЕЙФ ────────────────────────────────── */

  /** Вращение барабанов: механический шорох с периодическими щелчками. */
  drumsStart(): void {
    const ctx = this.ctx;
    if (!ctx || this.settings.muted || this.loops.has('drums')) return;
    const b = this.bus(); if (!b) return;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.18);
    out.connect(b.out);
    b.send(0.3);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.1;
    const g = ctx.createGain(); g.gain.value = 0.5;
    src.connect(bp); bp.connect(g); g.connect(out);

    // «Стрекот» механизма: LFO режет громкость с частотой вращения
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.24;
    lfo.connect(lfoG); lfoG.connect(g.gain);

    // Низкое гудение привода
    const hum = ctx.createOscillator(); hum.type = 'triangle'; hum.frequency.value = 74;
    const humG = ctx.createGain(); humG.gain.value = 0.18;
    hum.connect(humG); humG.connect(out);

    src.start(); lfo.start(); hum.start();
    this.loops.set('drums', {
      stop: () => {
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setTargetAtTime(0.0001, t, 0.05);
        setTimeout(() => { try { src.stop(); lfo.stop(); hum.stop(); } catch { /* уже остановлены */ } }, 320);
      }
    });
  }

  drumsStop(): void {
    this.loops.get('drums')?.stop();
    this.loops.delete('drums');
  }

  /** Барабан остановился на верной цифре: тяжёлый механический «клак» + звонок. */
  drumLock(index = 0): void {
    const b = this.bus(); if (!b) return;
    b.send(0.4);
    this.tone({ freq: 150 - index * 8, to: 70, type: 'square', dur: 0.13, gain: 0.16, out: b.out });
    this.noise({ dur: 0.09, gain: 0.14, filter: 'bandpass', freq: 1800, q: 1.6, out: b.out });
    this.bell({ freq: 1318 + index * 196, dur: 0.62, gain: 0.1, delay: 0.02, out: b.out });
    this.haptic(index === 2 ? 'heavy' : 'medium');
  }

  /** Промах: сухой «бзз» без колокола (игрок понимает, что не засчитано). */
  drumMiss(): void {
    const b = this.bus(); if (!b) return;
    this.tone({ freq: 220, to: 160, type: 'square', dur: 0.14, gain: 0.1, out: b.out });
    this.noise({ dur: 0.07, gain: 0.08, filter: 'bandpass', freq: 700, q: 1.2, out: b.out });
    this.haptic('warning');
  }

  /** Тап по барабану (до проверки): лёгкий механический щелчок. */
  drumTap(): void {
    const b = this.bus(); if (!b) return;
    this.noise({ dur: 0.04, gain: 0.1, filter: 'bandpass', freq: 2400, q: 2, out: b.out });
    this.tone({ freq: 900, to: 620, type: 'triangle', dur: 0.045, gain: 0.06, out: b.out });
  }

  /** Отсчёт перед общим стартом: «бип» с повышением на последнем такте. */
  countdown(step: number): void {
    const b = this.bus(); if (!b) return;
    b.send(0.3);
    const final = step <= 1;
    this.tone({ freq: final ? 1320 : 880, type: 'sine', dur: final ? 0.34 : 0.14, gain: final ? 0.15 : 0.1, out: b.out });
    if (final) this.bell({ freq: 1760, dur: 0.5, gain: 0.08, delay: 0.02, out: b.out });
    this.haptic(final ? 'medium' : 'light');
  }

  /** Сейф открыт: тяжёлая дверь, шипение воздуха и блеск приза. */
  vaultOpen(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.6);
    // Скрежет засовов
    this.noise({ dur: 0.9, gain: 0.16, filter: 'bandpass', freq: 260, to: 900, q: 1.1, attack: 0.06, out: b.out, distortion: true });
    // Удар двери
    this.tone({ freq: 92, to: 38, type: 'sine', dur: 0.7, gain: 0.26, out: b.out });
    this.noise({ dur: 0.4, gain: 0.14, filter: 'lowpass', freq: 1400, to: 220, out: b.out });
    // Стравливание воздуха
    this.noise({ dur: 1.1, gain: 0.07, filter: 'highpass', freq: 3600, attack: 0.14, delay: 0.3, out: b.out });
    // Блеск содержимого
    [1046, 1318, 1568, 2093].forEach((f, i) =>
      this.bell({ freq: f, dur: 1.1, gain: 0.09 - i * 0.012, delay: 0.62 + i * 0.09, out: b.out }));
    this.haptic('heavy');
  }

  /** Вклад в сейф: монеты в металл. */
  deposit(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.36);
    [0, 0.06, 0.13].forEach((d, i) => {
      this.bell({ freq: 1760 + i * 520, dur: 0.5, gain: 0.09 - i * 0.015, delay: d, out: b.out });
      this.noise({ dur: 0.04, gain: 0.06, filter: 'highpass', freq: 5200, delay: d, out: b.out });
    });
    this.tone({ freq: 140, to: 80, type: 'sine', dur: 0.2, gain: 0.09, delay: 0.04, out: b.out });
    this.haptic('medium');
  }

  /** Возврат вклада: те же монеты, но нисходяще (деньги уходят обратно). */
  refund(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.34);
    [0, 0.07].forEach((d, i) => this.bell({ freq: 1568 - i * 392, dur: 0.5, gain: 0.085, delay: d, out: b.out }));
  }

  /* ─────────────────────────── ИТОГИ РАУНДА ──────────────────────────── */

  /** Победа: мажорный фанфарный аккорд. */
  win(big = false): void {
    const b = this.bus(); if (!b) return;
    b.send(0.5);
    const chord = big ? [523, 659, 784, 1046, 1318] : [523, 659, 784, 1046];
    chord.forEach((f, i) => this.bell({ freq: f, dur: big ? 1.7 : 1.15, gain: 0.11 - i * 0.012, delay: i * (big ? 0.075 : 0.05), out: b.out }));
    this.tone({ freq: 130, to: 196, type: 'triangle', dur: 0.6, gain: 0.11, out: b.out });
    if (big) {
      // Восходящий блеск и «дождь монет»
      this.noise({ dur: 1.4, gain: 0.055, filter: 'highpass', freq: 5200, attack: 0.3, out: b.out });
      for (let i = 0; i < 14; i++) {
        this.bell({
          freq: 1760 * Math.pow(2, Math.random() * 0.6), dur: 0.5,
          gain: 0.045, delay: 0.4 + i * 0.075 + Math.random() * 0.04, out: b.out
        });
      }
    }
    this.haptic('success');
  }

  /** Проигрыш: нисходящая минорная линия, без резкости. */
  lose(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.42);
    [392, 349, 293, 233].forEach((f, i) =>
      this.tone({ freq: f, to: f * 0.98, type: 'triangle', dur: 0.42, gain: 0.1 - i * 0.014, delay: i * 0.12, out: b.out }));
    this.tone({ freq: 110, to: 74, type: 'sine', dur: 0.9, gain: 0.12, delay: 0.1, out: b.out });
    this.haptic('error');
  }

  /** Частичный приз / «в ноль»: нейтральный одиночный тон. */
  neutral(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.36);
    this.bell({ freq: 659, dur: 0.8, gain: 0.09, out: b.out });
    this.bell({ freq: 988, dur: 0.7, gain: 0.06, delay: 0.1, out: b.out });
  }

  /** Джекпот/очень крупный множитель: длинный восходящий проигрыш. */
  jackpot(): void {
    const b = this.bus(); if (!b) return;
    b.send(0.6);
    for (let i = 0; i < 12; i++) {
      this.bell({ freq: 523 * Math.pow(2, i / 6), dur: 1.2, gain: 0.09, delay: i * 0.06, out: b.out });
    }
    this.noise({ dur: 2.2, gain: 0.05, filter: 'highpass', freq: 4800, attack: 0.5, out: b.out });
    this.tone({ freq: 65, to: 196, type: 'sawtooth', dur: 1.4, gain: 0.12, attack: 0.3, out: b.out });
    this.haptic('success');
  }

  /** Открытие экрана/переход: мягкий «вуш». */
  transition(): void {
    const b = this.bus(); if (!b) return;
    this.noise({ dur: 0.26, gain: 0.05, filter: 'bandpass', freq: 500, to: 2600, q: 1.1, out: b.out });
  }

  /** Приостановить контекст (уход в фон) — экономит батарею и гасит звук. */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => {});
  }

  /** Возобновить контекст (возврат в приложение). */
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  stopAllLoops(): void {
    for (const [, l] of this.loops) { try { l.stop(); } catch { /* игнорируем */ } }
    this.loops.clear();
  }
}

/** Единственный движок на приложение. */
export const audio = new AudioEngine();
