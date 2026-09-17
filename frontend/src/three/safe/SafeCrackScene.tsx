/**
 * 🔒 ВЗЛОМ СЕЙФА — 3D-сцена: банковская дверь хранилища.
 *
 * Претензия пользователя была прямой: «не поймешь сразу, что это вообще сейф».
 * Прежняя сцена — плоская коробка и три цветных цилиндра без единой цифры.
 * Здесь собраны все признаки, по которым сейф узнаётся за полсекунды:
 *
 *  - Корпус-монолит на постаменте, а не висящая в пустоте пластина.
 *  - КРУГЛАЯ дверь с фаской (LatheGeometry) — самый узнаваемый силуэт хранилища.
 *  - 14 заклёпок по периметру, две петли слева, четыре ригеля справа.
 *  - Штурвал со спицами поверх шкалы с делениями (dialGraduation).
 *  - Гравированная табличка VAULT (engravedPlate).
 *  - Три барабана с НАСТОЯЩИМИ ЦИФРАМИ: по 10 плашек на каждый, цифры читаются
 *    через окно-безель, как в реальном кодовом замке.
 *  - Красный маячок тревоги сверху — вращается, пока идёт взлом.
 *  - Финал: ригели уходят → штурвал прокручивается → дверь распахивается на
 *    петлях → изнутри бьёт золотой свет по слиткам. Это и есть награда за взлом.
 *
 * СИНХРОН ЦИФР. Тап засчитывается по цифре в DOM (SafeCrack.tsx), а смотрит
 * игрок на картинку. Поэтому и то и другое считается из одного модуля
 * `drumMath.ts`: угол барабана = drumAngle(drumPosition(ms, speed)), а на
 * остановке — angleForDigit(code[i]). Формула проверена тестом
 * tests/scene-math.mjs на 60 000 мс прокрутки для одиннадцати скоростей.
 * Доводка барабана экспоненциальная и БЕЗ перелёта: перелёт означал бы, что
 * на долю секунды видна соседняя цифра.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createStageSafe, startLoop, detectQuality } from '../lib/stage';
import { createRng, easeOutCubic, easeInOut } from '../lib/rng';
import {
  gold, polishedGold, chrome, darkSteel, paintedRed, glass, neon, disposeObject
} from '../lib/materials';
import {
  digitPlate, dialGraduation, engravedPlate, brushedMetal,
  radialGlow, radialFade, glowSprite, smokeSprite, blackMarble, arenaMedallion, starFlare
} from '../lib/textures';
import { ParticleField } from '../lib/particles';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loadModel, disposeModel, playClip, scrubClip, type LoadedModel } from '../lib/models';
import {
  drumPosition, drumAngle, angleForDigit, speedOf, normalizeCode, drumPlateTransform
} from './drumMath';

interface Props {
  phase: 'idle' | 'spinning' | 'result';
  code?: number[];
  drumSpeeds?: number[];
  onDrumStop?: (drumIndex: number, digit: number, position: number) => void;
  tapDrum?: (i: number) => void;
  crackable?: boolean;
  /**
   * Абсолютный якорь вращения (Date.now()) из SafeCrack — тот же, по которому
   * DOM показывает цифры. Без него сцена считает от собственного запуска и
   * цифры на картинке могут не совпасть с DOM во время прокрутки.
   */
  startedAt?: number;
  /** Моменты остановки каждого барабана в мс от якоря (taps из SafeCrack). */
  taps?: (number | undefined)[];
}

/**
 * Хром без «вырвиглазных» бликов: фидбек раунда R — на сейфе странные
 * резкие отражения. Глобальный chrome() не трогаем (он и в ракете),
 * приглушаем только здесь.
 */
function softChrome(): THREE.MeshPhysicalMaterial {
  const m = chrome();
  m.roughness = 0.34;
  m.envMapIntensity = 0.55;
  return m;
}

/**
 * Матовое золото: фидбек раунда T — «всё металлическое через чур блестит».
 * Полированное золото из lib оставляем для крошечных акцентов, крупные
 * детали получаем с приглушёнными отражениями.
 */
function softGold(): THREE.MeshPhysicalMaterial {
  const m = gold({ roughness: 0.26 });
  m.color.set(0xe8bd4a);   // яркое ювелирное золото, не «горчица»
  m.envMapIntensity = 1.3;
  return m;
}

/* ── Геометрия: всё подогнано под контейнер 4:3 и камеру на z = 6.6 ─────── */
const FLOOR_Y = -1.78;
const DOOR_R = 1.42;
const DOOR_Y = 0.30;
/** Ось петли: дверь распахивается вокруг левого края. */
const HINGE_X = -1.55;
const DRUM_R = 0.33;
const DRUM_W = 0.46;
const DRUM_Y = 0.18;
const DRUM_XS = [-0.80, 0, 0.80];

export default function SafeCrackScene({
  phase, code, drumSpeeds, onDrumStop, startedAt, taps
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ phase, code, drumSpeeds, startedAt, taps, onDrumStop });
  useEffect(() => {
    stateRef.current.phase = phase;
    stateRef.current.code = code;
    stateRef.current.drumSpeeds = drumSpeeds;
    stateRef.current.startedAt = startedAt;
    stateRef.current.taps = taps;
    stateRef.current.onDrumStop = onDrumStop;
  }, [phase, code, drumSpeeds, startedAt, taps, onDrumStop]);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const quality = detectQuality();
    const rng = createRng('vault-safe-crack');

    const stage = createStageSafe({
      container,
      preset: 'safe',
      quality,
      background: 0x0a0812,
      fog: { color: 0x0a0812, density: 0.034 },
      fov: 40,
      position: [0.35, 0.62, 6.6],
      bloom: quality === 'high' ? 0.5 : quality === 'medium' ? 0.36 : 0,
      bloomRadius: 0.5,
      bloomThreshold: 0.74,
      exposure: 1.06,
      statsId: 'safe'
    });
    if (!stage) return;
    const { scene, camera } = stage;

    /* ═══════════════════════ МРАМОРНЫЙ ЗАЛ (переработка S3) ═════════════
     * Фидбек: «зал сейфа самый некачественный, выглядит халтурно — должен
     * быть самым презентабельным». Бетон и разметка уступают место
     * полированному чёрному мрамору, золотой инкрустации и ковровой дорожке.
     */
    // blackMarble() — кэш-общая текстура; клонируем, чтобы повтор не уехал
    // в остальные сцены, где она используется с repeat 1×1
    const floorMarbleTex = blackMarble().clone();
    floorMarbleTex.repeat.set(3, 3);
    floorMarbleTex.needsUpdate = true;
    const floorMat = new THREE.MeshPhysicalMaterial({
      map: floorMarbleTex, color: 0xb4b4c4, metalness: 0.44, roughness: 0.16,
      envMapIntensity: 1.1, clearcoat: 0.8, clearcoatRoughness: 0.14
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = quality === 'high';
    scene.add(floor);

    // Золотая компасная роза под сейфом — центр композиции пола
    const medallion = new THREE.Mesh(
      new THREE.CircleGeometry(2.9, 96),
      new THREE.MeshBasicMaterial({
        map: arenaMedallion(), transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      })
    );
    medallion.rotation.x = -Math.PI / 2;
    medallion.position.set(0, FLOOR_Y + 0.013, -0.9);
    scene.add(medallion);

    // Золотая инкрустация: большое кольцо вокруг сейфа
    const inlay = new THREE.Mesh(
      new THREE.RingGeometry(3.2, 3.34, 96),
      new THREE.MeshStandardMaterial({ color: 0xd9b464, metalness: 1, roughness: 0.5, envMapIntensity: 0.6 })
    );
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.y = FLOOR_Y + 0.012;
    scene.add(inlay);
    const inlay2 = new THREE.Mesh(
      new THREE.RingGeometry(4.6, 4.66, 96),
      new THREE.MeshStandardMaterial({ color: 0xd9b464, metalness: 1, roughness: 0.56, envMapIntensity: 0.5 })
    );
    inlay2.rotation.x = -Math.PI / 2;
    inlay2.position.y = FLOOR_Y + 0.011;
    scene.add(inlay2);

    // Лужа тёплого света на ВЕСЬ пол: раньше граница конуса прожектора
    // читалась как «срезанная долька» оранжевого круга при облете камеры.
    // Большое мягкое свечение делает переход незаметным с любого угла
    const floorPool = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 13),
      new THREE.MeshBasicMaterial({
        map: radialGlow('#ffcf6a', 0.03), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.3
      })
    );
    floorPool.rotation.x = -Math.PI / 2;
    floorPool.position.set(0, FLOOR_Y + 0.01, 0.4);
    scene.add(floorPool);

    // Ковровая дорожка к сейфу: бордовый бархат с золотой каймой
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 6.4),
      new THREE.MeshStandardMaterial({ color: 0x4a1522, roughness: 0.96, metalness: 0.02 })
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, FLOOR_Y + 0.014, 2.6);
    carpet.receiveShadow = quality === 'high';
    scene.add(carpet);
    for (const ex of [-1.34, 1.34]) {
      const edge = new THREE.Mesh(
        new THREE.PlaneGeometry(0.08, 6.4),
        new THREE.MeshStandardMaterial({ color: 0xd9b464, metalness: 1, roughness: 0.52 })
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(ex, FLOOR_Y + 0.016, 2.6);
      scene.add(edge);
    }


    /* ── Стена хранилища: панели, золотой профиль (бра убраны в T2) ────── */
    const wallMarbleTex = blackMarble().clone();
    wallMarbleTex.repeat.set(4, 2);
    wallMarbleTex.needsUpdate = true;
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallMarbleTex, color: 0x50506a, roughness: 0.52, metalness: 0.3,
      envMapIntensity: 0.45
    });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(44, 17), wallMat);
    wall.position.set(0, 2.4, -4.4);
    wall.receiveShadow = quality === 'high';
    scene.add(wall);
    // Вертикальные золотые пилястры на стене
    const pilasterMat = gold({ roughness: 0.34 });
    pilasterMat.envMapIntensity = 0.7;
    for (const px of [-5.6, -3.4, 3.4, 5.6]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.16, 8.4, 0.1), pilasterMat);
      pil.position.set(px, 1.4, -4.32);
      scene.add(pil);
    }

    // Каннелированные мраморные колонны по бокам зала
    const flutedColumn = (r: number, h: number): THREE.CylinderGeometry => {
      const geo = new THREE.CylinderGeometry(r, r * 1.06, h, 48, 4, false);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = pos.getY(i);
        const ang = Math.atan2(z, x);
        const flute = 1 + Math.cos(ang * 14) * 0.05;
        const entasis = 1 - (y / h + 0.5) * 0.08;
        pos.setX(i, x * flute * entasis);
        pos.setZ(i, z * flute * entasis);
      }
      geo.computeVertexNormals();
      return geo;
    };
    const hallColumnMat = new THREE.MeshStandardMaterial({
      map: blackMarble(), color: 0x9a9ab0, roughness: 0.4, metalness: 0.22,
      envMapIntensity: 0.7
    });
    for (const [cx, cz] of [[-6.1, -2.6], [6.1, -2.6], [-7.4, -4.0], [7.4, -4.0]] as const) {
      const col = new THREE.Group();
      const shaft = new THREE.Mesh(flutedColumn(0.44, 6.9), hallColumnMat);
      shaft.position.y = 3.95;
      // Без теней: длинные тени колонн от прожекторов полосили пол
      shaft.castShadow = false;
      col.add(shaft);
      const colGold = softGold();
      // Пьедестал: мраморный куб, на котором стоит колонна
      const pedestal = new THREE.Mesh(new RoundedBoxGeometry(1.06, 0.3, 1.06, 2, 0.03), hallColumnMat);
      pedestal.position.y = 0.15;
      col.add(pedestal);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.68, 0.26, 24), colGold);
      base.position.y = 0.43;
      col.add(base);
      // Золотое кольцо на середине ствола
      const midRing = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.035, 10, 40), colGold);
      midRing.rotation.x = Math.PI / 2;
      midRing.position.y = 3.9;
      col.add(midRing);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.5, 0.3, 24), colGold);
      cap.position.y = 7.5;
      col.add(cap);
      // Абака: квадратная плита капители
      const abacus = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.14, 1.0, 2, 0.02), colGold);
      abacus.position.y = 7.72;
      col.add(abacus);
      col.position.set(cx, FLOOR_Y, cz);
      scene.add(col);
    }

    // Контактная тень (псевдо-AO): мягкое тёмное пятно прижимает сейф к полу
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(7.8, 5.6),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, alphaMap: radialFade(),
        opacity: 0.66, depthWrite: false
      })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(0, FLOOR_Y + 0.02, 0.0);
    scene.add(contact);

    /* ── Звёздное небо на заднем плане ───────────────────────────────────
     * Вместо оранжевого гало — мерцающие звёзды по всей стене хранилища.
     * Детерминированные позиции (общий ГПСЧ сцены), свой шейдер с
     * индивидуальной фазой мерцания — как в сцене ракеты.
     */
    const starCount = quality === 'low' ? 240 : 560;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starSize = new Float32Array(starCount);
    const starAlpha = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = rng.range(-21.5, 21.5);
      starPos[i * 3 + 1] = rng.range(-0.5, 10.6);
      starPos[i * 3 + 2] = -4.32 + rng.range(0, 0.08);
      starSize[i] = rng.range(0.5, 1.7) * (rng.rand() > 0.9 ? 2.3 : 1);
      starAlpha[i] = rng.range(0.4, 1);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
    starGeo.setAttribute('aAlpha', new THREE.BufferAttribute(starAlpha, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: starFlare('#eaf2ff') }, uScale: { value: 190 }, uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          // Мерцание: у каждой звезды своя фаза
          vAlpha = aAlpha * (0.68 + 0.32 * sin(uTime * 1.9 + aAlpha * 40.0));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          float a = t.a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(t.rgb, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    scene.add(stars);

    // Верхний свет широкий и мягкий: узкий видимый конус читался
    // как «тёмные полосы» над сейфом — оставляем только свет без луча
    const topSpot = new THREE.SpotLight(0xffe2ac, 40, 30, Math.PI / 3.9, 1.0, 1.4);
    topSpot.position.set(0.3, 8.6, 1.1);
    topSpot.target.position.set(0, DOOR_Y, 0);
    scene.add(topSpot);
    scene.add(topSpot.target);


    /* ═══════════════════════════ КОРПУС СЕЙФА ═══════════════════════════ */
    const safe = new THREE.Group();
    scene.add(safe);

    const bodyMat = darkSteel({ roughness: 0.64 });
    bodyMat.envMapIntensity = 0.38;
    bodyMat.map = brushedMetal({ base: 62, strength: 22 });
    // Фаски: у реального сейфа нет бумажных углов в 90° — блик обязан
    // бежать по скруглению (раунд U, пункт «фаски»)
    const body = new THREE.Mesh(new RoundedBoxGeometry(3.9, 3.6, 2.4, 3, 0.06), bodyMat);
    body.position.set(0, 0.15, -1.35);
    body.castShadow = quality === 'high';
    body.receiveShadow = quality === 'high';
    safe.add(body);

    // Передняя рама: чуть больше корпуса, с золотистой фаской — «дорогой» сейф
    const frameMat = darkSteel({ roughness: 0.5 });
    frameMat.envMapIntensity = 0.45;
    frameMat.map = brushedMetal({ base: 74, strength: 18 });
    const frame = new THREE.Mesh(new RoundedBoxGeometry(4.14, 3.84, 0.26, 3, 0.05), frameMat);
    frame.position.set(0, 0.15, -0.14);
    safe.add(frame);

    // Постамент
    const plinth = new THREE.Mesh(
      new RoundedBoxGeometry(4.3, 0.26, 2.75, 2, 0.04),
      darkSteel({ roughness: 0.66 })
    );
    plinth.position.set(0, FLOOR_Y + 0.13, -1.35);
    plinth.receiveShadow = quality === 'high';
    safe.add(plinth);

    // Декоративные золотые боссы по углам и серединам рамы — «заклёпки
    // роскоши», статичные (корпус не двигается), видны и с моделью
    const bossGeo = new THREE.SphereGeometry(0.06, 16, 12);
    const bossMat = softGold();
    for (const [bx, by] of [
      [-2.0, 1.95], [2.0, 1.95], [-2.0, -1.62], [2.0, -1.62],
      [0, 1.98], [0, -1.66], [-2.04, 0.15], [2.04, 0.15]
    ] as const) {
      const boss = new THREE.Mesh(bossGeo, bossMat);
      boss.position.set(bx, by, 0.02);
      boss.scale.z = 0.6;
      safe.add(boss);
    }

    // Кольцо-обойма вокруг дверного проёма (признак настоящей двери хранилища)
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(DOOR_R + 0.20, 0.155, 14, 72),
      softChrome()
    );
    collar.position.set(0, DOOR_Y, -0.02);
    safe.add(collar);

    /* ── Внутренности: открываются только когда дверь распахнута ────────── */
    const interior = new THREE.Group();
    interior.position.set(0, DOOR_Y, -0.9);
    safe.add(interior);
    const interiorParts: THREE.Object3D[] = [];

    const cavity = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR_R * 2 - 0.06, DOOR_R * 2 - 0.06, 1.5),
      new THREE.MeshStandardMaterial({
        color: 0x1a1206, roughness: 0.9, metalness: 0.1, side: THREE.BackSide
      })
    );
    interior.add(cavity);
    interiorParts.push(cavity);

    // Золотое сияние в глубине
    const innerGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({
        map: radialGlow('#ffcf5e', 0.04), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0
      })
    );
    innerGlow.position.z = -0.7;
    interior.add(innerGlow);

    // Слитки пирамидой — то, ради чего всё это
    const barGeo = new THREE.BoxGeometry(0.46, 0.17, 0.26);
    const bars: THREE.Mesh[] = [];
    const barMat = polishedGold();
    for (let row = 0; row < 3; row++) {
      const n = 3 - row;
      for (let i = 0; i < n; i++) {
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.position.set(
          (i - (n - 1) / 2) * 0.5 - 0.42,
          -0.86 + row * 0.185,
          -0.34 + rng.spread(0.05)
        );
        bar.rotation.y = rng.spread(0.1);
        bar.castShadow = quality === 'high';
        interior.add(bar);
        bars.push(bar);
        interiorParts.push(bar);
      }
    }
    // Стопка монет справа
    const coinGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.035, 28);
    const coinMat = gold({ roughness: 0.22 });
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(coinGeo, coinMat);
      c.position.set(0.72 + rng.spread(0.03), -0.9 + i * 0.038, -0.3 + rng.spread(0.03));
      c.rotation.z = rng.spread(0.06);
      interior.add(c);
      interiorParts.push(c);
    }
    const goldLight = new THREE.PointLight(0xffc44d, 0, 7.5, 2);
    goldLight.position.set(0, DOOR_Y - 0.2, -0.7);
    safe.add(goldLight);

    /* ═══════════════════════════ ДВЕРЬ ══════════════════════════════════ */
    // Дверь живёт в группе с осью на петле: распахивание — поворот группы
    const doorPivot = new THREE.Group();
    doorPivot.position.set(HINGE_X, DOOR_Y, 0.06);
    safe.add(doorPivot);

    /** Профиль двери с фаской: оживало по кромке даёт бегущий блик. */
    const doorProfile: THREE.Vector2[] = [];
    const bev = 0.075;
    const halfT = 0.155;
    doorProfile.push(new THREE.Vector2(0.0001, -halfT));
    doorProfile.push(new THREE.Vector2(DOOR_R - bev, -halfT));
    const bseg = 8;
    for (let i = 1; i <= bseg; i++) {
      const a = (i / bseg) * (Math.PI / 2);
      doorProfile.push(new THREE.Vector2(
        DOOR_R - bev + Math.sin(a) * bev, -halfT + bev - Math.cos(a) * bev
      ));
    }
    for (let i = bseg; i >= 1; i--) {
      const a = (i / bseg) * (Math.PI / 2);
      doorProfile.push(new THREE.Vector2(
        DOOR_R - bev + Math.sin(a) * bev, halfT - bev + Math.cos(a) * bev
      ));
    }
    doorProfile.push(new THREE.Vector2(DOOR_R - bev, halfT));
    doorProfile.push(new THREE.Vector2(0.0001, halfT));

    const doorGeo = new THREE.LatheGeometry(doorProfile, 96);
    doorGeo.rotateX(Math.PI / 2);                       // ось двери → Z
    const doorMat = darkSteel({ roughness: 0.48 });
    doorMat.envMapIntensity = 0.45;
    const doorBrush = brushedMetal({ base: 86, strength: 20, circular: true });
    doorMat.map = doorBrush;
    // PBR-деталь (раунд U): та же карта работает картой рельефа — блик
    // на двери не идеально гладкий, а с микроцарапинами
    doorMat.bumpMap = doorBrush;
    doorMat.bumpScale = 0.006;
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.x = -HINGE_X;                          // центр двери в мире = 0
    door.castShadow = quality === 'high';
    doorPivot.add(door);

    // Заклёпки по периметру — деталь, по которой сейф узнают мгновенно
    const rivetGeo = new THREE.SphereGeometry(0.055, 14, 10);
    const rivetMat = softChrome();
    const rivets: THREE.Mesh[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.PI / 14;
      const r = new THREE.Mesh(rivetGeo, rivetMat);
      r.position.set(
        -HINGE_X + Math.cos(a) * (DOOR_R - 0.11),
        Math.sin(a) * (DOOR_R - 0.11),
        halfT + 0.012
      );
      r.scale.z = 0.62;                                  // приплюснутая головка
      doorPivot.add(r);
      rivets.push(r);
    }

    /* ── Гравированная табличка ─────────────────────────────────────────── */
    // Объёмная табличка в золотой рамке: толстая плита с гравировкой,
    // наклонена вниз — верхний спот больше не пересвечивает текст
    const plate = new THREE.Group();
    const plateBack = new THREE.Mesh(
      new RoundedBoxGeometry(1.74, 0.72, 0.05, 2, 0.02), softGold()
    );
    plateBack.position.z = -0.02;
    plate.add(plateBack);
    const plateFace = new THREE.Mesh(
      new RoundedBoxGeometry(1.62, 0.61, 0.09, 2, 0.015),
      new THREE.MeshStandardMaterial({
        map: engravedPlate('VAULT', 'DEPOSITARY № 7'),
        metalness: 1, roughness: 0.4, envMapIntensity: 0.9,
        bumpMap: engravedPlate('VAULT', 'DEPOSITARY № 7'), bumpScale: 0.012
      })
    );
    plate.add(plateFace);
    plate.position.set(-HINGE_X, 1.02, halfT + 0.012);
    plate.rotation.x = 0.07;
    doorPivot.add(plate);

    /* ═══════════════════════════ БАРАБАНЫ ═══════════════════════════════ */
    // Панель-углубление, в которой стоят барабаны
    const panel = new THREE.Mesh(
      new RoundedBoxGeometry(2.86, 1.02, 0.12, 2, 0.03),
      new THREE.MeshStandardMaterial({
        color: 0x0b0d1a, metalness: 0.7, roughness: 0.44, envMapIntensity: 0.8
      })
    );
    panel.position.set(-HINGE_X, DRUM_Y, halfT - 0.03);
    doorPivot.add(panel);

    const panelTrim = new THREE.Mesh(
      new RoundedBoxGeometry(2.98, 1.14, 0.05, 2, 0.02),
      softGold()
    );
    panelTrim.position.set(-HINGE_X, DRUM_Y, halfT - 0.075);
    doorPivot.add(panelTrim);

    /** Один барабан: цилиндр + 10 плашек с цифрами вокруг него. */
    interface Drum {
      group: THREE.Group;
      angle: number;
      target: number | null;
      settled: boolean;
      /** Золотая рамка окна чтения (группа из четырёх фасок). */
      bezel: THREE.Group;
      frameMat: THREE.MeshStandardMaterial;
      windowGlow: THREE.Mesh;
    }
    // Тёплый прожектор, направленный на барабаны: цифры не должны тонуть
    // в тени при любом окружающем свете
    const drumLight = new THREE.PointLight(0xffe3b0, 6.5, 4.6, 2);
    drumLight.position.set(-HINGE_X, DRUM_Y + 0.5, halfT + 1.35);
    doorPivot.add(drumLight);

    const drums: Drum[] = [];
    const drumBodyGeo = new THREE.CylinderGeometry(DRUM_R, DRUM_R, DRUM_W, 56, 1);
    drumBodyGeo.rotateZ(Math.PI / 2);                    // ось барабана → X
    // Круговая карта браширования читалась как «непонятные отметины» —
    // барабан стал ровнее и матовее
    const drumBodyMat = new THREE.MeshStandardMaterial({
      map: brushedMetal({ base: 104, strength: 14 }),
      metalness: 0.68, roughness: 0.52, envMapIntensity: 0.45
    });
    const plateGeo = new THREE.PlaneGeometry(DRUM_W * 0.92, DRUM_R * 1.34);

    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.set(-HINGE_X + DRUM_XS[i], DRUM_Y, halfT + 0.04);
      doorPivot.add(g);

      const body2 = new THREE.Mesh(drumBodyGeo, drumBodyMat);
      g.add(body2);

      // Торцы: стальные цапфы с золотыми ступицами — барабан выглядит
      // механизмом, а не просто цилиндром с картинками
      for (const sx of [-1, 1]) {
        const axle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.115, 0.115, 0.05, 24),
          softChrome()
        );
        axle.rotation.z = Math.PI / 2;
        axle.position.x = sx * (DRUM_W / 2 + 0.02);
        g.add(axle);
        const hub = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), softGold());
        hub.position.x = sx * (DRUM_W / 2 + 0.05);
        g.add(hub);
      }

      // Раскладка плашек — общая функция drumMath.drumPlateTransform: её же
      // проворачивает тест, поэтому знак не может разойтись с формулой угла
      for (let d = 0; d < 10; d++) {
        const place = drumPlateTransform(d, DRUM_R + 0.004);
        const tex = digitPlate(d, { face: '#0b0e20', accent: '#f5c542' });
        // Цифры обязаны читаться всегда: почти диэлектрик + собственное
        // тёплое свечение 0.6 (в раунде Q было 0.22 — не хватило)
        const p2 = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({
          map: tex,
          metalness: 0.12, roughness: 0.62, envMapIntensity: 0.3,
          emissive: 0xfff0c8, emissiveIntensity: 0.6, emissiveMap: tex
        }));
        p2.position.set(...place.position);
        p2.rotation.x = place.rotationX;
        g.add(p2);
      }

      // Боковые обоймы барабана
      for (const sx of [-1, 1]) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(DRUM_R + 0.018, 0.028, 10, 44),
          softGold()
        );
        ring.rotation.y = Math.PI / 2;
        ring.position.x = sx * (DRUM_W / 2);
        g.add(ring);
      }

      /* Окно чтения цифры: настоящая «шахта» слот-барабана.
       * Прежнее циановое кольцо висело МЕЖДУ дверью и плашками (плашки на
       * радиусе 0.334 от оси, кольцо было на 0.315 от двери) и читалось как
       * странный артефакт. Теперь: тёмные стенки-щёки от поверхности двери до
       * переднего края + золотая фасочная рамка на передней кромке.
       */
      const bezel = new THREE.Group();
      const wellMat = new THREE.MeshStandardMaterial({
        color: 0x14161f, roughness: 0.7, metalness: 0.5, envMapIntensity: 0.3
      });
      // Щёки шахты: боковые и верхняя/нижняя стенки
      const cheekSide = new THREE.BoxGeometry(0.04, 0.62, 0.46);
      const cheekTB = new THREE.BoxGeometry(0.54, 0.04, 0.46);
      for (const sx of [-1, 1]) {
        const cheek = new THREE.Mesh(cheekSide, wellMat);
        cheek.position.set(sx * 0.27, 0, -0.2);
        bezel.add(cheek);
      }
      for (const sy of [-1, 1]) {
        const cheek = new THREE.Mesh(cheekTB, wellMat);
        cheek.position.set(0, sy * 0.31, -0.2);
        bezel.add(cheek);
      }
      // Золотая рамка на передней кромке (свой материал — вспыхивает независимо)
      const frameMat = new THREE.MeshStandardMaterial({
        color: 0x8a6a24, metalness: 0.95, roughness: 0.34,
        emissive: 0xffd76a, emissiveIntensity: 0.16, envMapIntensity: 0.9
      });
      const FW = 0.62;   // проём рамки
      const FH = 0.70;
      const FT = 0.05;   // толщина планки
      for (const [bw, bh, bx, by] of [
        [FW + FT, FT, 0, FH / 2], [FW + FT, FT, 0, -FH / 2],
        [FT, FH + FT, -FW / 2, 0], [FT, FH + FT, FW / 2, 0]
      ] as const) {
        const barM = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.06), frameMat);
        barM.position.set(bx, by, 0);
        bezel.add(barM);
      }
      // Позиция: передняя плашка на радиусе 0.334 от оси барабана
      bezel.position.set(-HINGE_X + DRUM_XS[i], DRUM_Y, halfT + 0.04 + DRUM_R + 0.02);
      doorPivot.add(bezel);

      // Подсветка окна: вспыхивает золотом, когда барабан встал на цифру
      const windowGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.86, 0.86),
        new THREE.MeshBasicMaterial({
          map: radialGlow('#ffd76a', 0.12), transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0
        })
      );
      // Вспышка — перед плашками (радиус 0.334 от оси), иначе её не видно
      windowGlow.position.set(-HINGE_X + DRUM_XS[i], DRUM_Y, halfT + 0.04 + DRUM_R + 0.05);
      doorPivot.add(windowGlow);

      drums.push({ group: g, angle: 0, target: null, settled: false, bezel, frameMat, windowGlow });
    }

    /* ── Штурвал со шкалой: главный признак двери хранилища ─────────────── */
    const wheel = new THREE.Group();
    wheel.position.set(-HINGE_X, -0.86, halfT + 0.1);
    doorPivot.add(wheel);

    const dialDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.66, 64),
      new THREE.MeshStandardMaterial({
        map: dialGraduation(), metalness: 0.85, roughness: 0.46, envMapIntensity: 0.8
      })
    );
    dialDisc.position.z = -0.06;
    wheel.add(dialDisc);

    const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.055, 12, 56), softChrome());
    wheel.add(wheelRim);
    const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.16, 32), softGold());
    wheelHub.rotation.x = Math.PI / 2;
    wheel.add(wheelHub);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.5, 14), softChrome());
      spoke.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.25, Math.sin((i / 3) * Math.PI * 2) * 0.25, 0);
      spoke.rotation.z = (i / 3) * Math.PI * 2 + Math.PI / 2;
      wheel.add(spoke);
    }
    // Рукоятки на ободе — за них «крутят»
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 10), paintedRed());
      knob.position.set(Math.cos(a) * 0.54, Math.sin(a) * 0.54, 0.06);
      wheel.add(knob);
    }
    const wheelIndex = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.13, 3),
      neon(0xf5c542, 2.2)
    );
    wheelIndex.position.set(0, 0.74, 0.02);
    wheelIndex.rotation.x = Math.PI;
    doorPivot.add(wheelIndex);
    wheelIndex.position.x = -HINGE_X;
    wheelIndex.position.y = -0.86 + 0.74;
    wheelIndex.position.z = halfT + 0.12;

    /* ── Петли и ригели ─────────────────────────────────────────────────── */
    const hingeParts: THREE.Mesh[] = [];
    for (const hy of [-0.72, 0.92]) {
      const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.62, 0.42), softChrome());
      hinge.position.set(HINGE_X + 0.02, DOOR_Y + hy, -0.02);
      safe.add(hinge);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.74, 18), softGold());
      pin.position.set(HINGE_X + 0.02, DOOR_Y + hy, 0.16);
      safe.add(pin);
      hingeParts.push(hinge, pin);
    }

    // Ригели: уходят в дверь перед распахиванием
    const bolts: THREE.Mesh[] = [];
    const boltGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.42, 18);
    boltGeo.rotateZ(Math.PI / 2);                        // ось вдоль X
    for (const by of [-0.95, -0.35, 0.55, 1.15]) {
      const b = new THREE.Mesh(boltGeo, softChrome());
      b.position.set(-HINGE_X + DOOR_R + 0.1, by, halfT - 0.02);
      doorPivot.add(b);
      bolts.push(b);
    }

    /* ── Маячок тревоги наверху ─────────────────────────────────────────── */
    const beacon = new THREE.Group();
    beacon.position.set(0, 2.16, -1.0);
    safe.add(beacon);
    const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.14, 28), darkSteel({}));
    beacon.add(beaconBase);
    const domeMat0 = glass({ color: 0xff2d2d, attenuation: 0.35 });
    domeMat0.emissive = new THREE.Color(0xff1a1a);
    domeMat0.emissiveIntensity = 0.35;
    domeMat0.roughness = 0.12;
    const beaconDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 28, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      domeMat0
    );
    beaconDome.position.y = 0.07;
    beacon.add(beaconDome);
    const beaconLight = new THREE.PointLight(0xff2a2a, 0, 9, 2);
    beaconLight.position.y = 0.16;
    beacon.add(beaconLight);
    // Вращающийся «лепесток» света внутри плафона
    const beaconSweeper = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({
        map: radialGlow('#ff3b30', 0.02), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0
      })
    );
    beaconSweeper.position.set(0, 2.16, -0.72);
    safe.add(beaconSweeper);

    /* ═══════════════════════════ СВЕТ ═══════════════════════════════════ */
    /* ═══════════ 3D-МОДЕЛЬ СЕЙФА (ТЗ «3D-модели») ═══════════
     * Пока .glb едет/парсится — игрок видит процедурный сейф (фолбэк и
     * витрина одновременно). Загрузилась — корпус/дверь/ригели/штурвал/петли
     * заменяет модель, а барабаны с цифрами остаются процедурными и
     * пересаживаются под Anchor_Drums (дочерний двери — открываются вместе).
     */
    let cancelled = false;
    let safeModel: LoadedModel | null = null;
    let modelActive = false;
    let modelClip = '';
    let modelAction: THREE.AnimationAction | null = null;
    const modelHolder = new THREE.Group();
    scene.add(modelHolder);
    const proceduralHide: THREE.Object3D[] = [
      body, frame, plinth, collar, door, plate, panel, panelTrim,
      wheel, wheelIndex, ...bolts
    ];
    loadModel('safe.glb', { quality }).then((m) => {
      if (cancelled || !m) return;
      safeModel = m;
      modelHolder.add(m.root);
      // R4: блики на модели были слишком резкими — приглушаем отражения всех
      // материалов модели, пусть сцена освещает её мягче
      m.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          const sm = mat as THREE.MeshStandardMaterial;
          if (typeof sm.envMapIntensity === 'number') sm.envMapIntensity *= 0.55;
        }
      });
      modelHolder.updateMatrixWorld(true);
      // Лоадер центрирует bbox и ставит низ на пол; возвращаем петлю (root
      // модели) на сценную ось двери — габариты авторены 1:1 со сценой.
      let hinge = m.root.getObjectByName('safe');
      if (!hinge || hinge === m.root) {
        hinge = m.root.children.find((c) => c.name === 'safe') ?? m.root;
      }
      const hv = new THREE.Vector3();
      hinge.getWorldPosition(hv);
      modelHolder.position.add(new THREE.Vector3(HINGE_X, DOOR_Y, 0.06).sub(hv));
      // Процедурные барабаны — под якорь двери модели
      const drumAnchor = m.anchors['Anchor_Drums'];
      if (drumAnchor) {
        drums.forEach((d) => {
          drumAnchor.attach(d.group);
          drumAnchor.attach(d.bezel);
          drumAnchor.attach(d.windowGlow);
        });
      }
      proceduralHide.forEach((o) => { o.visible = false; });
      // Табличка VAULT: в .glb её нет, а процедурная дверь прячется — без
      // пересадки табличка исчезала после загрузки модели. Сажаем на дверь
      // модели (локально центр двери в +1.55 от оси петли)
      const modelDoor = m.root.getObjectByName('safe_door');
      if (modelDoor) {
        modelDoor.attach(plate);
        plate.position.set(1.55, 1.02, 0.18);
        plate.visible = true;
      }
      hingeParts.forEach((o) => { o.visible = false; });
      rivets.forEach((o) => { o.visible = false; });
      // процедурные внутренности заменяет интерьер модели; золотой свет —
      // под Anchor_Light, чтобы бил из настоящего проёма
      interiorParts.forEach((o) => { o.visible = false; });
      const lightAnchor = m.anchors['Anchor_Light'];
      if (lightAnchor) lightAnchor.attach(goldLight);
      modelActive = true;
    });

    scene.add(new THREE.AmbientLight(0x7a6c5c, 1.0));

    const key = new THREE.SpotLight(0xfff0cc, 58, 30, Math.PI / 3.7, 1.0, 1.4);
    key.position.set(-3.2, 4.6, 4.6);
    key.target.position.set(0, DOOR_Y, 0);
    if (quality === 'high') {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.bias = -0.0018;
    }
    scene.add(key);
    scene.add(key.target);

    // Раунд U: никакой «кислотной» подсветки — только тёплый контровой и
    // слабый нейтральный заполняющий, чтобы сталь оставалась сталью
    const rim = new THREE.DirectionalLight(0xffc088, 1.6);
    rim.position.set(4.5, 2.2, -3.5);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xc8d4f0, 0.45);
    fill.position.set(-4, -1, 3);
    scene.add(fill);
    // Правый заполняющий: при облете справа сейф раньше уходил в тень —
    // свет «срезался» границей конуса прожектора
    const rightFill = new THREE.DirectionalLight(0xffd9b0, 0.85);
    rightFill.position.set(5.5, 2.0, 3.5);
    scene.add(rightFill);
    const doorGrazing = new THREE.PointLight(0xffd76a, 3.4, 8, 2);
    doorGrazing.position.set(1.6, 1.4, 2.4);
    scene.add(doorGrazing);

    /* ═══════════════════════════ ЧАСТИЦЫ ════════════════════════════════ */
    const sparks = new ParticleField(quality === 'low' ? 70 : 220, glowSprite('#fff6da', 0.34), {
      color: 0xffe08a, size: 0.26, gravity: -3.4, drag: 0.955, scale: 230
    });
    scene.add(sparks.points);

    const dust = new ParticleField(quality === 'low' ? 50 : 140, glowSprite('#ffeccd', 0.08), {
      color: 0xd9d2f2, size: 0.11, gravity: -0.03, drag: 0.996, opacity: 0.34, scale: 120
    });
    scene.add(dust.points);

    const goldMotes = new ParticleField(quality === 'low' ? 60 : 180, glowSprite('#ffe9a8', 0.2), {
      color: 0xffd76a, size: 0.2, gravity: 0.35, drag: 0.985, opacity: 0.9, scale: 200
    });
    scene.add(goldMotes.points);

    const smoke = new ParticleField(quality === 'low' ? 40 : 110, smokeSprite(), {
      color: 0xcfc6ee, size: 0.8, gravity: 0.22, drag: 0.96,
      blending: THREE.NormalBlending, opacity: 0.26, scale: 250
    });
    scene.add(smoke.points);

    /* ═══════════════════════════ АНИМАЦИЯ ═══════════════════════════════ */
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const camTarget = new THREE.Vector3(0.35, 0.62, 6.6);
    const lookTarget = new THREE.Vector3(0, DOOR_Y - 0.05, 0);
    const lookNow = new THREE.Vector3(0, DOOR_Y - 0.05, 0);

    let doorOpen = 0;              // 0..1 — насколько распахнута дверь
    let openSeq = -1;              // таймер последовательности вскрытия
    let boltRetract = 0;
    let wheelSpin = 0;
    let shake = 0;
    let dustTimer = 0;
    let moteTimer = 0;
    let prevPhase: Props['phase'] = 'idle';
    /** Собственные часы сцены, если якорь из SafeCrack не передан. */
    let localSpinMs = 0;
    const flash: number[] = [0, 0, 0];

    /** Искры из-под остановившегося барабана. */
    const burstSparks = (i: number) => {
      const wx = DRUM_XS[i];
      const n = quality === 'low' ? 14 : 40;
      for (let k = 0; k < n; k++) {
        const a = rng.rand() * Math.PI * 2;
        const sp = rng.range(0.8, 3.6);
        tmp.set(wx, DOOR_Y, halfT + 0.24);
        tmp2.set(Math.cos(a) * sp * 0.8, Math.sin(a) * sp, rng.range(0.6, 2.6));
        sparks.emit(tmp, tmp2, rng.range(0.3, 0.85), rng.range(0.14, 0.32));
      }
      shake = Math.min(1, shake + 0.32);
    };

    const stopLoop = startLoop(stage, (dt, elapsed) => {
      starMat.uniforms.uTime.value = elapsed;
      const s = stateRef.current;
      const phaseNow = s.phase;
      const digits = normalizeCode(s.code) ?? [0, 0, 0];

      /* ── Переход между фазами ─────────────────────────────────────────── */
      if (phaseNow !== prevPhase) {
        if (phaseNow === 'spinning') {
          localSpinMs = 0;
          drums.forEach((d) => { d.target = null; d.settled = false; });
          openSeq = -1;
          doorOpen = 0;
          boltRetract = 0;
        } else if (phaseNow === 'result') {
          openSeq = 0;
          drums.forEach((d) => { d.settled = false; });
        } else {
          openSeq = -1;
          doorOpen = 0;
          boltRetract = 0;
        }
        prevPhase = phaseNow;
      }

      /* ── Барабаны ─────────────────────────────────────────────────────── */
      // Время прокрутки: из якоря SafeCrack (тогда цифры совпадают с DOM),
      // иначе от собственных часов сцены
      const anchor = typeof s.startedAt === 'number' && s.startedAt > 0 ? s.startedAt : null;
      if (phaseNow === 'spinning') localSpinMs += dt * 1000;
      const spinMs = anchor ? Math.max(0, Date.now() - anchor) : localSpinMs;

      for (let i = 0; i < 3; i++) {
        const d = drums[i];
        const speed = speedOf(s.drumSpeeds, i);
        const tapped = Array.isArray(s.taps) ? s.taps[i] : undefined;
        const wantStop = phaseNow === 'result' || (phaseNow === 'spinning' && typeof tapped === 'number');

        if (phaseNow === 'idle') {
          // Витрина: барабаны медленно идут вместе — сейф «живой»
          d.angle = drumAngle(drumPosition(elapsed * 260, 1));
          d.target = null;
          d.settled = false;
        } else if (!wantStop) {
          d.angle = drumAngle(drumPosition(spinMs, speed));
          d.target = null;
          d.settled = false;
        } else {
          // Цель: цифра из DOM. С taps — тот же момент времени, что засчитал
          // сервер; без них (реплей/экран сейфа) — середина окна нужной цифры.
          const want = typeof tapped === 'number'
            ? drumAngle(drumPosition(tapped, speed))
            : angleForDigit(digits[i]);
          if (d.target === null) {
            // Крутим только ВПЕРЁД: обратная отмотка показала бы чужую цифру
            const turns = Math.ceil((d.angle - want) / (Math.PI * 2));
            d.target = want + Math.PI * 2 * Math.max(0, turns);
          }
          // Экспоненциальная доводка без перелёта (перелёт = соседняя цифра)
          const k = 1 - Math.pow(0.0016, dt);
          d.angle += (d.target - d.angle) * k;
          if (Math.abs(d.target - d.angle) < 0.0015) {
            d.angle = d.target;
            if (!d.settled) {
              d.settled = true;
              flash[i] = 1;
              burstSparks(i);
              s.onDrumStop?.(i, digits[i], d.angle);
            }
          }
        }
        d.group.rotation.x = d.angle;

        // Вспышка окна при фиксации цифры
        flash[i] = Math.max(0, flash[i] - dt * 1.9);
        (d.windowGlow.material as THREE.MeshBasicMaterial).opacity = flash[i] * 0.85;
        d.frameMat.emissiveIntensity = 0.16 + flash[i] * 2.4;
        d.bezel.scale.setScalar(1 + flash[i] * 0.02);
      }

      /* ── Последовательность вскрытия ──────────────────────────────────── */
      const alarmOn = phaseNow === 'spinning';
      if (openSeq >= 0) {
        openSeq += dt;
        // 0.00–0.45 с: ригели уходят в дверь
        boltRetract = Math.min(1, openSeq / 0.45);
        // 0.35–1.25 с: штурвал прокручивается
        wheelSpin = easeOutCubic(Math.min(1, Math.max(0, (openSeq - 0.35) / 0.9))) * Math.PI * 3;
        // 1.15–2.75 с: дверь распахивается
        doorOpen = easeInOut(Math.min(1, Math.max(0, (openSeq - 1.15) / 1.6)));
      } else {
        wheelSpin = phaseNow === 'idle' ? Math.sin(elapsed * 0.22) * 0.12 : 0;
      }

      for (const b of bolts) b.position.x = -HINGE_X + DOOR_R + 0.1 - boltRetract * 0.34;
      wheel.rotation.z = wheelSpin + (phaseNow === 'spinning' ? Math.sin(elapsed * 2.2) * 0.03 : 0);
      doorPivot.rotation.y = -doorOpen * 1.12;           // открываем на себя-влево
      // Дверь чуть выезжает вперёд, когда распахивается: так читается толщина
      doorPivot.position.z = 0.06 + doorOpen * 0.16;

      /* ── Модель сейфа: детерминированные клипы (mixer.setTime) ─────────── */
      if (modelActive && safeModel) {
        const want = openSeq >= 0 ? 'open' : phaseNow === 'spinning' ? 'spin' : 'idle';
        if (want !== modelClip) {
          modelClip = want;
          modelAction = playClip(safeModel, want, want === 'open' ? 'once' : 'loop');
        }
        if (modelAction) {
          const dur = safeModel.clips[want]?.duration ?? 1;
          scrubClip(safeModel, modelAction, want === 'open' ? openSeq : elapsed % dur);
        }
      }

      // Золото внутри разгорается вместе с дверью
      const glow = doorOpen * doorOpen;
      goldLight.intensity = glow * 13;
      (innerGlow.material as THREE.MeshBasicMaterial).opacity = glow * 0.95;
      bars.forEach((b, i) => {
        b.rotation.y = Math.sin(elapsed * 0.6 + i) * 0.05 * glow;
      });

      /* ── Маячок тревоги ───────────────────────────────────────────────── */
      const pulse = alarmOn ? (Math.sin(elapsed * 7.5) * 0.5 + 0.5) : (openSeq >= 0 ? 0 : 0.16 + Math.sin(elapsed * 1.1) * 0.06);
      beaconLight.intensity = pulse * (alarmOn ? 7 : 0);
      const domeMat = beaconDome.material as THREE.MeshPhysicalMaterial;
      domeMat.emissiveIntensity = 0.5 + pulse * (alarmOn ? 3.2 : 0.9);
      beaconSweeper.rotation.z = elapsed * (alarmOn ? 2.4 : 0.5);
      (beaconSweeper.material as THREE.MeshBasicMaterial).opacity = pulse * (alarmOn ? 0.42 : 0);
      // Красная подсветка двери во время взлома
      doorGrazing.intensity = 3.4 + (alarmOn ? Math.sin(elapsed * 7.5) * 1.4 : 0);
      doorGrazing.color.setHex(alarmOn ? 0xff5a4a : 0xffd76a);

      /* ── Частицы ──────────────────────────────────────────────────────── */
      dustTimer += dt;
      if (dustTimer > 0.2) {
        dustTimer = 0;
        tmp.set(rng.spread(3.4), FLOOR_Y + rng.range(0.2, 3.6), rng.range(-0.6, 2.2));
        tmp2.set(rng.spread(0.06), rng.range(0.02, 0.14), rng.spread(0.05));
        dust.emit(tmp, tmp2, rng.range(4, 8), rng.range(0.07, 0.16));
      }
      if (doorOpen > 0.25) {
        moteTimer += dt;
        if (moteTimer > 0.05) {
          moteTimer = 0;
          tmp.set(rng.spread(0.9), DOOR_Y + rng.spread(0.8), -0.6 + rng.spread(0.3));
          tmp2.set(rng.spread(0.7), rng.range(0.25, 1.1), rng.range(0.9, 2.4));
          goldMotes.emit(tmp, tmp2, rng.range(1.1, 2.2), rng.range(0.1, 0.26));
        }
        if (rng.rand() < dt * 6) {
          tmp.set(rng.spread(1.1), DOOR_Y - 0.6 + rng.spread(0.4), -0.5);
          tmp2.set(rng.spread(0.3), rng.range(0.2, 0.6), rng.range(0.4, 1.1));
          smoke.emit(tmp, tmp2, rng.range(1.4, 2.6), rng.range(0.7, 1.4));
        }
      }
      sparks.update(dt);
      dust.update(dt);
      goldMotes.update(dt);
      smoke.update(dt);

      /* ── Камера ───────────────────────────────────────────────────────── */
      if (phaseNow === 'idle') {
        const a = elapsed * 0.13;
        camTarget.set(0.35 + Math.sin(a) * 0.55, 0.62 + Math.sin(elapsed * 0.24) * 0.14, 6.55 + Math.cos(a) * 0.3);
        lookTarget.set(0, DOOR_Y - 0.05, 0);
      } else if (phaseNow === 'spinning') {
        // Крупнее на барабанах: игрок должен видеть цифры
        camTarget.set(0.1 + Math.sin(elapsed * 0.7) * 0.05, DRUM_Y + 0.26, 4.5);
        lookTarget.set(0, DRUM_Y, 0.1);
      } else {
        // Заезжаем справа и чуть сбоку, чтобы заглянуть в открытый сейф
        const k = easeOutCubic(Math.min(1, Math.max(0, (openSeq - 1.0) / 1.8)));
        camTarget.set(0.35 + k * 1.5, 0.62 - k * 0.18, 6.55 - k * 1.5);
        lookTarget.set(k * 0.45, DOOR_Y - k * 0.12, -k * 0.5);
      }
      camera.position.lerp(camTarget, 1 - Math.pow(phaseNow === 'spinning' ? 0.02 : 0.006, dt));
      lookNow.lerp(lookTarget, 1 - Math.pow(0.01, dt));
      camera.lookAt(lookNow);
      const wantFov = phaseNow === 'spinning' ? 31.5 : openSeq >= 0 ? 38.5 : 40;
      camera.fov += (wantFov - camera.fov) * (1 - Math.pow(0.05, dt));
      camera.updateProjectionMatrix();

      if (shake > 0) {
        shake = Math.max(0, shake - dt * 2.4);
        camera.position.x += rng.spread(shake * 0.1);
        camera.position.y += rng.spread(shake * 0.08);
      }
    });

    stage.render();

    return () => {
      cancelled = true;
      disposeModel('safe.glb');
      stopLoop();
      sparks.dispose(); dust.dispose(); goldMotes.dispose(); smoke.dispose();
      barGeo.dispose(); coinGeo.dispose();
      drumBodyGeo.dispose(); plateGeo.dispose(); rivetGeo.dispose(); boltGeo.dispose();
      disposeObject(safe);
      disposeObject(scene);
      stage.dispose();
    };
  }, []);

  return <div ref={ref} className="three-container" />;
}
