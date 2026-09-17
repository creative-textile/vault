/**
 * Окружение для PBR-материалов: процедурная «неоновая студия хранилища».
 *
 * Это главный приём, который отличает дорогую картинку от кубиков. Металл и
 * стекло вообще не имеют собственного цвета — они отражают окружение. Без
 * environment map золото выглядит жёлтой пластмассой, хром — серым, а стекло
 * пропадает. С ним появляются настоящие блики, цветные отражения и глубина.
 *
 * Скачивать HDRI неоткуда (внешние хосты из Telegram Mini App недоступны, а
 * файл 1–4 МБ убил бы первый экран), поэтому окружение строится кодом:
 * тёмная комната + несколько светящихся панелей разных цветов → запекается
 * через PMREMGenerator в префильтрованную карту отражений.
 *
 * Раскладка света специально «казиношная»:
 *   - большой тёплый софит сверху  → золотые блики на монетах и ручке сейфа
 *   - фиолетовая/пурпурная панель слева → фирменный rim-light по кромкам
 *   - циановая панель справа       → холодный контровой, отделяет объект от фона
 *   - белая панель спереди         → читаемый ключевой блик
 *   - узкая белая полоса           → «полоса» на цилиндрах (монета, барабаны)
 *   - тёплый пол                   → мягкая подсветка снизу (иначе низ чёрный)
 */
import * as THREE from 'three';

export type EnvPreset = 'vault' | 'rocket' | 'duel' | 'safe';

interface LightPanel {
  color: number;
  /** Множитель яркости: значения > 1 нужны, чтобы после PMREM блик остался «горячим». */
  intensity: number;
}

interface EnvConfig {
  bg: number;
  key: LightPanel;
  rim: LightPanel;
  fill: LightPanel;
  floor: LightPanel;
}

const PRESETS: Record<EnvPreset, EnvConfig> = {
  // Универсальный: золото + фиолетовый контровой (главная, вклад, онбординг)
  vault: {
    bg: 0x0a0a18,
    key: { color: 0xffe6a8, intensity: 5.2 },
    rim: { color: 0xa855f7, intensity: 2.6 },
    fill: { color: 0x22d3ee, intensity: 1.7 },
    floor: { color: 0x3a2a10, intensity: 0.8 }
  },
  // Космос: холоднее, синий контровой; единственный тёплый источник — пламя
  rocket: {
    bg: 0x05060f,
    key: { color: 0xfff2d0, intensity: 3.2 },
    rim: { color: 0x4f8dff, intensity: 2.4 },
    fill: { color: 0x22d3ee, intensity: 1.5 },
    floor: { color: 0x120a04, intensity: 0.5 }
  },
  // Арена дуэли: тёплый прожектор + пурпур по краям
  duel: {
    bg: 0x0b0718,
    key: { color: 0xfff0c0, intensity: 6.0 },
    rim: { color: 0xc026d3, intensity: 2.8 },
    fill: { color: 0x22d3ee, intensity: 1.5 },
    floor: { color: 0x2a1a3a, intensity: 0.9 }
  },
  // Сейф (раунд U): тёплая музейная студия. Прежний красный контровой давал
  // те самые «кислотные розовые отсветы» на стали — металл отражает именно
  // эти панели, поэтому комната должна быть дорогой, а не тревожной.
  safe: {
    bg: 0x0d0a08,
    key: { color: 0xfff0d6, intensity: 5.6 },
    rim: { color: 0xffb066, intensity: 1.7 },
    fill: { color: 0xd8e2f5, intensity: 1.0 },
    floor: { color: 0x2a1c0e, intensity: 0.7 }
  }
};

/** Светящаяся панель: не освещает сцену напрямую, нужна только для отражений. */
function makePanel(w: number, h: number, panel: LightPanel): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ color: panel.color, side: THREE.DoubleSide });
  mat.color.multiplyScalar(panel.intensity);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

/** Кэш по пресету: четыре сцены не должны четырежды жечь GPU на одно и то же. */
const cache = new Map<EnvPreset, THREE.Texture>();

/**
 * Собрать карту окружения и вернуть текстуру для `scene.environment`.
 * `null` — если PMREM недоступен (очень старый WebGL): материалы валидны и без
 * отражений, сцена просто станет менее «металлической».
 */
export function getEnvironment(renderer: THREE.WebGLRenderer, preset: EnvPreset = 'vault'): THREE.Texture | null {
  const cached = cache.get(preset);
  if (cached) return cached;

  const cfg = PRESETS[preset];
  if (!cfg) return null;

  let pmrem: THREE.PMREMGenerator | null = null;
  try {
    pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(cfg.bg);

    // Комната: изнутри видим тёмные стены — они дают металлу «тень» в отражении,
    // без неё металл выглядит плоским и равномерно серым
    envScene.add(new THREE.Mesh(
      new THREE.BoxGeometry(22, 14, 22),
      new THREE.MeshBasicMaterial({ color: cfg.bg, side: THREE.BackSide })
    ));

    // Ключевой софит сверху (большой → мягкие широкие блики)
    const key = makePanel(13, 13, cfg.key);
    key.position.set(0, 6.8, 0);
    key.rotation.x = Math.PI / 2;
    envScene.add(key);

    // Контровой слева (фирменный rim по кромкам)
    const rim = makePanel(9, 8, cfg.rim);
    rim.position.set(-9.5, 1.5, -3);
    rim.rotation.y = Math.PI / 2;
    envScene.add(rim);

    // Заполняющий справа (холодный, отделяет объект от фона)
    const fill = makePanel(9, 8, cfg.fill);
    fill.position.set(9.5, 1.2, -1);
    fill.rotation.y = -Math.PI / 2;
    envScene.add(fill);

    // Фронтальный блик — читаемая «точка» на полированных поверхностях
    const front = makePanel(5, 3.2, { color: 0xffffff, intensity: 3.4 });
    front.position.set(2.5, 3.2, 10.4);
    front.rotation.y = Math.PI;
    envScene.add(front);

    // Узкая полоса: даёт вытянутый блик на цилиндрах (монета, барабаны сейфа)
    const stripe = makePanel(0.7, 7, { color: 0xffffff, intensity: 4.2 });
    stripe.position.set(-3.4, 2.0, 10.2);
    stripe.rotation.y = Math.PI;
    envScene.add(stripe);

    // Тёплый пол: подсвечивает нижние части объектов
    const floor = makePanel(16, 16, cfg.floor);
    floor.position.set(0, -6.6, 0);
    floor.rotation.x = -Math.PI / 2;
    envScene.add(floor);

    const rt = pmrem.fromScene(envScene, 0.035);
    cache.set(preset, rt.texture);

    // Временная сцена больше не нужна — карта запечена в render target
    envScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    pmrem.dispose();
    return rt.texture;
  } catch {
    pmrem?.dispose();
    return null;
  }
}

/** Освободить все закэшированные карты (при выгрузке приложения). */
export function disposeEnvironments(): void {
  for (const [, tex] of cache) tex.dispose();
  cache.clear();
}
