/**
 * 📦 Загрузка .glb-моделей (ТЗ «3D-модели и анимации», раздел 6.1).
 *
 * Контракт модуля:
 *  - `loadModel(file, opts)` — грузит `/models/<file>` лениво, кэширует по
 *    URL (сейф используется двумя сценами — файл скачивается один раз),
 *    нормализует модель под сцену (высота → `targetHeight`, низ → `floorY`,
 *    центр по X/Z → 0) и возвращает якоря + клипы + микшер.
 *  - Ошибка сети/парсинга глотается и возвращается `null`: сцена обязана
 *    показать процедурный fallback (раздел 6.3 ТЗ), а не чёрный экран.
 *  - `quality === 'low'` → модель не грузится вовсе (запроса к .glb нет).
 *  - Анимация детерминирована: время задаётся ЯВНО через `mixer.setTime(t)`
 *    (никакого накопления `mixer.update(dt)`), поэтому реплей показывает ту же
 *    картинку. Клипы зацикливаются взятием времени по модулю длительности.
 *  - Декодеры сжатия (Draco/KTX2/meshopt) сознательно НЕ подключены:
 *    модели хранятся без сжатия геометрии и укладываются в бюджет раздела 9
 *    (рост чанка `three` только на GLTFLoader — см. отчёт).
 *
 * Замечание про инстансы: один файл — один общий `LoadedModel` (микшер и
 * трансформации общие!). Если две сцены должны показывать одну модель
 * одновременно (дев-галерея), вторая берёт геометрию через `acquireRoot` —
 * клон без микшера (общая геометрия, новые трансформации).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface LoadedModel {
  /** Корень для добавления в сцену (уже нормализован и поставлен на пол). */
  root: THREE.Group;
  /** Клипы по имени: 'idle' | 'spin' | 'open' | 'close'. */
  clips: Record<string, THREE.AnimationClip>;
  /** Микшер: время задаём явно — mixer.setTime(t). */
  mixer: THREE.AnimationMixer;
  /** Якоря из раздела 4.2 ТЗ (пустые объекты, которых может не быть). */
  anchors: Record<string, THREE.Object3D | undefined>;
  /** Сколько треугольников реально отрисовывается (для отчёта/деградации). */
  triangles: number;
}

export interface ModelOptions {
  /** Целевая высота объекта в единицах сцены (Bounding Box → scale). */
  targetHeight?: number;
  /** Поставить низ модели на этот Y (по умолчанию — 0). */
  floorY?: number;
  /** Качество: 'low' отменяет загрузку полностью. */
  quality?: 'high' | 'medium' | 'low';
  /** Замена/дополнение материалов (материалы общие между инстансами!). */
  onMaterial?: (m: THREE.Material, name: string) => void;
}

interface Entry {
  model: Promise<LoadedModel | null>;
  bytes: Promise<number>;
  /** Живые потребители: файл освобождается, когда не остался никто. */
  refs: number;
}

const cache = new Map<string, Entry>();
const gltfLoader = new GLTFLoader();

const anchorPrefix = 'Anchor_';

/**
 * Отладочный переключатель дев-галереи (`/scenes.html`): если включён,
 * `loadModel` всегда возвращает `null`, и сцены работают на процедурной
 * геометрии — так проверяется режим «модель не грузится».
 */
export function isProceduralForced(): boolean {
  return typeof window !== 'undefined' &&
    Boolean((window as unknown as { __VAULT_FORCE_PROCEDURAL__?: boolean }).__VAULT_FORCE_PROCEDURAL__);
}

function normalizeTemplate(template: THREE.Group, opts: ModelOptions): void {
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  box.setFromObject(template);
  box.getSize(size);
  if (opts.targetHeight && size.y > 1e-6) {
    const s = opts.targetHeight / size.y;
    template.scale.multiplyScalar(s);
  }
  box.setFromObject(template);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  template.position.x -= cx;
  template.position.z -= cz;
  template.position.y += (opts.floorY ?? 0) - box.min.y;
  template.updateMatrixWorld(true);
}

function countTriangles(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const g = mesh.geometry as THREE.BufferGeometry;
      triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
    }
  });
  return Math.round(triangles);
}

function collectAnchors(root: THREE.Object3D): Record<string, THREE.Object3D | undefined> {
  const anchors: Record<string, THREE.Object3D | undefined> = {};
  root.traverse((o) => {
    if (o.name.startsWith(anchorPrefix)) anchors[o.name] = o;
  });
  return anchors;
}

/** Запрос к сети + разбор. Любая ошибка → `null` (сцена покажет процедурное). */
async function fetchAndParse(file: string, opts: ModelOptions): Promise<{ model: LoadedModel | null; bytes: number }> {
  try {
    const url = `${import.meta.env.BASE_URL}models/${file}`;
    // fetch → parse, а не loader.load: так мы узнаём точный вес файла
    // (для отладочной галереи) и получаем промис вместо колбэков.
    const resp = await fetch(url);
    if (!resp.ok) return { model: null, bytes: 0 };
    const buffer = await resp.arrayBuffer();
    const bytes = buffer.byteLength;
    const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
      (resolve, reject) => {
        gltfLoader.parse(buffer, '', (g) => resolve(g as { scene: THREE.Group; animations: THREE.AnimationClip[] }), reject);
      }
    );

    const template = gltf.scene;
    template.name = file.replace(/\.glb$/i, '');

    // Защита от мусора в файле: свет и камеры ставит сцена, не модель (ТЗ 4.1).
    const drop: THREE.Object3D[] = [];
    template.traverse((o) => {
      const probe = o as unknown as { isLight?: boolean; isCamera?: boolean };
      if (probe.isLight || probe.isCamera) drop.push(o);
    });
    drop.forEach((o) => o.parent?.remove(o));

    normalizeTemplate(template, opts);

    const clips: Record<string, THREE.AnimationClip> = {};
    for (const clip of gltf.animations ?? []) clips[clip.name] = clip;

    const mixer = new THREE.AnimationMixer(template);
    const model: LoadedModel = {
      root: template,
      clips,
      mixer,
      anchors: collectAnchors(template),
      triangles: countTriangles(template)
    };
    return { model, bytes };
  } catch {
    return { model: null, bytes: 0 };
  }
}

/**
 * Загрузить .glb из /models/<file>. Кэш по URL: вторая сцена не грузит
 * повторно. Параметры нормализации применяются при ПЕРВОМ вызове (у обоих
 * потребителей сейфа они одинаковые — см. ТЗ 6.2).
 */
export function loadModel(file: string, opts: ModelOptions = {}): Promise<LoadedModel | null> {
  if (opts.quality === 'low' || isProceduralForced()) {
    return Promise.resolve(null);
  }
  let entry = cache.get(file);
  if (!entry) {
    let resolveBytes: (n: number) => void = () => undefined;
    const bytes = new Promise<number>((res) => { resolveBytes = res; });
    const model = fetchAndParse(file, opts).then((r) => {
      resolveBytes(r.bytes);
      return r.model;
    });
    entry = { model, bytes, refs: 0 };
    cache.set(file, entry);
  }
  entry.refs += 1;
  return entry.model;
}

/** Синхронно взять уже загруженную модель из кэша (null, если ещё не готова). */
export function peekModel(file: string): LoadedModel | null {
  const entry = cache.get(file);
  if (!entry) return null;
  // Промис уже резолвлен? Сохраняем результат синхронно при готовности.
  const rec = entry as Entry & { resolved?: LoadedModel | null };
  if (rec.resolved === undefined) {
    entry.model.then((m) => { rec.resolved = m; });
    return null;
  }
  return rec.resolved ?? null;
}

/** Вес файла в байтах и полигонаж — для отладочной галереи (раздел 6.4 ТЗ). */
export function modelInfo(file: string): Promise<{ bytes: number; triangles: number } | null> {
  const entry = cache.get(file);
  if (!entry) return Promise.resolve(null);
  return Promise.all([entry.bytes, entry.model]).then(([bytes, model]) =>
    model ? { bytes, triangles: model.triangles } : null
  );
}

/**
 * Взять модель для второй одновременной сцены (дев-галерея): если корень уже
 * стоит в какой-то сцене, возвращается клон (геометрия и материалы общие,
 * микшер не клонируется — клон статичен либо управляется вручную).
 */
export function acquireRoot(model: LoadedModel): THREE.Group {
  if (!model.root.parent) return model.root;
  return model.root.clone(true);
}

function disposeDeep(root: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  const texProps = [
    'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
    'emissiveMap', 'alphaMap', 'bumpMap'
  ] as const;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      list.forEach((m) => mats.add(m as THREE.Material));
    }
  });
  mats.forEach((m) => {
    const rec = m as unknown as Record<string, unknown>;
    texProps.forEach((p) => {
      const t = rec[p];
      if (t && (t as THREE.Texture).isTexture) (t as THREE.Texture).dispose();
    });
    m.dispose();
  });
}

/** Освободить одну модель (когда последний потребитель ушёл). */
export function disposeModel(file: string): void {
  const entry = cache.get(file);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) {
    cache.delete(file);
    entry.model.then((model) => {
      if (model) {
        model.mixer.stopAllAction();
        model.mixer.uncacheRoot(model.root);
        disposeDeep(model.root);
      }
    });
  }
}

/** Освободить все модели (размонтирование приложения/тест утечек). */
export function disposeModels(): void {
  for (const file of Array.from(cache.keys())) {
    const entry = cache.get(file);
    if (!entry) continue;
    entry.refs = 0;
    cache.delete(file);
    entry.model.then((model) => {
      if (model) {
        model.mixer.stopAllAction();
        model.mixer.uncacheRoot(model.root);
        disposeDeep(model.root);
      }
    });
  }
}

/* ── Детерминированное управление клипами ─────────────────────────────────── */

/**
 * Сделать активным один клип (остановив остальные). `mode='once'` фиксирует
 * последний кадр по завершении (для клипа открытия сейфа).
 */
export function playClip(model: LoadedModel, name: string, mode: 'loop' | 'once'): THREE.AnimationAction | null {
  const clip = model.clips[name];
  if (!clip) return null;
  model.mixer.stopAllAction();
  const action = model.mixer.clipAction(clip);
  action.reset();
  action.setLoop(mode === 'loop' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  action.clampWhenFinished = mode === 'once';
  action.play();
  return action;
}

/**
 * Прокрутить активный клип на ЯВНОЕ время (детерминизм реплеев, ТЗ 3.2):
 * микшер сбрасывается в 0 и продвигается ровно на `t` секунд — никакой
 * зависимости от частоты кадров.
 */
export function scrubClip(model: LoadedModel, action: THREE.AnimationAction, t: number): void {
  // После достижения конца LoopOnce-клипа three сам ставит action.paused;
  // снимаем его, чтобы mixer.setTime() снова мог задать время.
  action.paused = false;
  model.mixer.setTime(Math.max(0, t));
}
