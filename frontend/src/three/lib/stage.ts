/**
 * Общая сцена-«сцена» (stage): renderer + камера + окружение + bloom + ресайз
 * + авто-снижение качества.
 *
 * Зачем один модуль на четыре зала: раньше каждая сцена сама создавала
 * WebGLRenderer со своими настройками, из-за чего цвет и резкость отличались
 * от экрана к экрану (в Ракете был alpha и без tone mapping, в Дуэли —
 * непрозрачный фон и свои света). Плюс нигде не освобождались геометрии, и
 * после нескольких партий память GPU росла.
 *
 * Авто-снижение качества обязательно: bloom и transmission (стекло) на слабых
 * Android дают 12–18 FPS, и игра выглядит «сломанной». Замеряем реальный FPS
 * первые секунды и, если он ниже порога, гасим bloom и режем pixelRatio —
 * картинка остаётся той же композицией, просто без постобработки.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { getEnvironment, type EnvPreset } from './environment';

export type Quality = 'high' | 'medium' | 'low';

/** Оценка возможностей устройства до первого кадра. */
export function detectQuality(): Quality {
  if (typeof navigator === 'undefined') return 'medium';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const dpr = window.devicePixelRatio || 1;
  // Очень маленькие экраны в паре с высоким DPR — почти всегда бюджетные устройства
  const weak = cores <= 4 || mem <= 3;
  if (cores >= 8 && mem >= 6 && dpr <= 3) return 'high';
  if (weak && dpr >= 3) return 'low';
  return weak ? 'medium' : 'high';
}

export interface StageOptions {
  container: HTMLElement;
  preset?: EnvPreset;
  /** Сила свечения: 0 полностью отключает bloom (дешевле на слабых устройствах). */
  bloom?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  transparent?: boolean;
  background?: number | null;
  fog?: { color: number; density: number } | null;
  fov?: number;
  position?: [number, number, number];
  quality?: Quality;
  /** Ограничение pixelRatio: для bloom-сцен дешевле держать 1.5–1.75. */
  maxPixelRatio?: number;
  exposure?: number;
}

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer | null;
  quality: Quality;
  /** Пересобрать composer (после ресайза или смены качества). */
  setSize: () => void;
  /** Кадр. Возвращает false, если сцену уже уничтожили. */
  render: () => void;
  /** Замер FPS и авто-деградация; вызвать в цикле анимации. */
  tickPerf: () => void;
  setBloom: (strength: number) => void;
  dispose: () => void;
  width: () => number;
  height: () => number;
}

export function createStage(opts: StageOptions): Stage {
  const { container } = opts;
  const quality: Quality = opts.quality ?? detectQuality();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);

  const renderer = new THREE.WebGLRenderer({
    antialias: quality !== 'low',
    alpha: opts.transparent ?? false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true
  });
  const capByQuality = quality === 'high' ? 2 : quality === 'medium' ? 1.65 : 1.25;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio ?? capByQuality));
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (opts.transparent) renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  if (opts.background !== undefined && opts.background !== null) {
    scene.background = new THREE.Color(opts.background);
  }
  if (opts.fog) scene.fog = new THREE.FogExp2(opts.fog.color, opts.fog.density);

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 50, width / height, 0.1, 400);
  if (opts.position) camera.position.set(...opts.position);

  // Окружение: отражения в металле и стекле (главный источник «дороговизны»)
  const env = getEnvironment(renderer, opts.preset ?? 'vault');
  if (env) scene.environment = env;

  /* ── Постобработка: bloom ─────────────────────────────────────────────── */
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;

  const bloomStrength = reduced ? 0 : (opts.bloom ?? 0);
  const wantBloom = bloomStrength > 0 && quality !== 'low';

  if (wantBloom) {
    try {
      composer = new EffectComposer(renderer);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        bloomStrength,
        opts.bloomRadius ?? 0.62,
        opts.bloomThreshold ?? 0.72
      );
      composer.addPass(bloomPass);
      // OutputPass применяет tone mapping и sRGB: без него после composer
      // картинка уходит в блёклый linear-вид
      composer.addPass(new OutputPass());
    } catch {
      composer = null;
      bloomPass = null;
    }
  }

  const setSize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    bloomPass?.setSize(w, h);
  };

  /* ── Ресайз: ResizeObserver ловит и поворот экрана, и открытие клавиатуры ─ */
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => setSize());
    ro.observe(container);
  }
  window.addEventListener('resize', setSize);
  window.addEventListener('orientationchange', setSize);

  /* ── Замер FPS и авто-деградация ─────────────────────────────────────── */
  let frames = 0;
  let windowStart = performance.now();
  let degraded = false;
  let disposed = false;

  const tickPerf = () => {
    if (disposed || degraded) return;
    frames++;
    const now = performance.now();
    const elapsed = now - windowStart;
    if (elapsed < 1600) return;
    const fps = (frames * 1000) / elapsed;
    frames = 0;
    windowStart = now;

    // Меньше 34 FPS два замера подряд — гасим bloom и режем pixelRatio.
    // Композиция сцены не меняется, поэтому деградация не выглядит «поломкой».
    if (fps < 34) {
      degraded = true;
      if (bloomPass) bloomPass.strength = 0;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.1));
      setSize();
      if (renderer.shadowMap.enabled) {
        renderer.shadowMap.enabled = false;
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.material) {
            const list = Array.isArray(m.material) ? m.material : [m.material];
            list.forEach((x) => { x.needsUpdate = true; });
          }
        });
      }
      console.info(`[3d] FPS ${fps.toFixed(0)} — постобработка отключена для плавности`);
    }
  };

  const render = () => {
    if (disposed) return;
    if (composer) composer.render();
    else renderer.render(scene, camera);
  };

  const setBloom = (strength: number) => {
    if (bloomPass && !degraded) bloomPass.strength = strength;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ro?.disconnect();
    window.removeEventListener('resize', setSize);
    window.removeEventListener('orientationchange', setSize);
    composer?.dispose?.();
    bloomPass?.dispose?.();
    renderer.dispose();
    renderer.forceContextLoss?.();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  };

  return {
    renderer, scene, camera, composer, quality,
    setSize, render, tickPerf, setBloom, dispose,
    width: () => Math.max(1, container.clientWidth),
    height: () => Math.max(1, container.clientHeight)
  };
}

/**
 * То же, что createStage, но не бросает исключение.
 *
 * WebGL может отсутствовать (отключён в настройках WebView, контекст исчерпан
 * после нескольких залов, старый Android). Игра обязана остаться играбельной:
 * сцена просто не появляется, а экран продолжает работать с цифрами из БД.
 */
export function createStageSafe(opts: StageOptions): Stage | null {
  try {
    return createStage(opts);
  } catch (e) {
    console.warn('[3d] сцена не создана:', (e as Error)?.message || e);
    return null;
  }
}

/** Кадровый цикл с автоматической остановкой при уничтожении сцены. */
export function startLoop(stage: Stage, frame: (dt: number, elapsed: number) => void): () => void {
  let id = 0;
  let last = performance.now();
  const start = performance.now();
  const step = () => {
    const now = performance.now();
    // Ограничиваем dt: после возврата из фоновой вкладки иначе проходит
    // «час» симуляции за один кадр, и объекты улетают за пределы сцены
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(dt, (now - start) / 1000);
    stage.render();
    stage.tickPerf();
    id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}
