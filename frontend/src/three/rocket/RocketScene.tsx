/**
 * 🚀 РАКЕТА — 3D-сцена зала.
 *
 * Что изменилось относительно прежней версии (цилиндр + конус + два конуса-киля):
 *
 *  - Корпус — тело вращения (LatheGeometry) с настоящим профилем: оживальный
 *    нос, цилиндрическая часть, сужение к соплу. Покраска — белый перламутр с
 *    лаком (clearcoat) и картой расшивки панелей, заклёпок и маркировки.
 *  - Кили — выдавленный профиль с фаской (ExtrudeGeometry), а не конусы: у них
 *    есть толщина, корневый наплыв и скруглённая законцовка.
 *  - Сопло — раструб (LatheGeometry) из воронёной стали с раскалённой
 *    внутренней поверхностью; вокруг него «алмазные» ударные волны.
 *  - Иллюминатор — настоящее стекло (transmission + ior) в металлическом
 *    кольце, а не синий шарик.
 *  - Пламя — три аддитивных слоя (ядро/средний/внешний) с дрожанием по
 *    фрактальному шуму, плюс реактивная струя из частиц и искры.
 *  - Окружение — туманность на сфере, звёзды спрайтами с бликом (а не
 *    квадратными точками), процедурная карта отражений (см. lib/environment).
 *  - Взрыв — вспышка, ударное кольцо, 34 обломка с физикой и кувырканием,
 *    угли, растущий дым и импульс красного света.
 *  - Камера — киношная: медленный облёт на площадке, сопровождение полёта с
 *    запаздыванием, расширение FOV и тряска на больших множителях.
 *  - Bloom через EffectComposer (см. lib/stage) с авто-отключением на слабом FPS.
 *
 * Логика фаз сохранена полностью — в том числе «призрак» после кэшаута:
 * настоящая ракета приземляется, полупрозрачный двойник доигрывает траекторию
 * до сохранённой точки взрыва, камера следует за ним, по окончании срабатывает
 * onGhostFinished (экран показывает «💥 Взрыв на x…» и финальную точку).
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createStageSafe, startLoop, detectQuality } from '../lib/stage';
import { createRng, fbm1, easeOutCubic } from '../lib/rng';
import { gold, chrome, darkSteel, paintedHull, paintedRed, glass, neon, additive, composite, polishedGold, disposeObject } from '../lib/materials';
import { glowSprite, starFlare, smokeSprite, nebula, hazardStripes, neonRing, radialGlow, streakSprite, concrete, fireball } from '../lib/textures';
import { ParticleField } from '../lib/particles';
import { loadModel, disposeModel } from '../lib/models';

interface Props {
  phase: 'idle' | 'flying' | 'crashed' | 'cashed';
  multiplier?: number;
  cashoutAt?: number;
  crashAt?: number;
  onReady?: () => void;
  onGhostFinished?: () => void;
  seed?: string;
}

/** Кривая роста множителя — та же, что на сервере: x(t) = e^(0.075·t). */
const CURVE = 0.075;

/* ═══════════════════════════ МОДЕЛЬ РАКЕТЫ ═══════════════════════════ */

interface RocketParts {
  group: THREE.Group;
  flameCore: THREE.Mesh;
  flameMid: THREE.Mesh;
  flameOuter: THREE.Mesh;
  diamonds: THREE.Mesh[];
  nozzleGlow: THREE.Mesh;
  engineLight: THREE.PointLight;
  beacon: THREE.Mesh;
  beaconLight: THREE.PointLight;
  /** Корпусные детали: при загрузке .glb они скрываются (модель вместо них). */
  bodyParts: THREE.Object3D[];
}

/**
 * Собрать ракету. `ghost=true` делает все материалы полупрозрачными — это
 * двойник, который летит дальше после кэшаута (деньги уже забраны, поэтому
 * он «призрак»: выплата зафиксирована и от его полёта не зависит).
 */
function buildRocket(ghost = false): RocketParts {
  const group = new THREE.Group();
  const bodyParts: THREE.Object3D[] = [];

  /** Обёртка материала: в режиме призрака делаем прозрачным и не пишущим в depth. */
  const asGhost = <T extends THREE.Material>(m: T): T => {
    if (!ghost) return m;
    m.transparent = true;
    m.opacity = 0.34;
    m.depthWrite = false;
    return m;
  };

  /* ── Корпус: профиль вращения ─────────────────────────────────────────── */
  // Точки снизу вверх. Оживало (ogive) задаёт характерный «ракетный» нос,
  // а сужение внизу — сопловой отсек, которого не было у простого цилиндра.
  const profile: THREE.Vector2[] = [];
  const H = 2.5;            // полная высота корпуса
  const R = 0.46;           // радиус миделя
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;              // 0 = низ, 1 = верх
    const y = -H / 2 + t * H;
    let r: number;
    if (t < 0.16) {
      // Сопловое сужение
      r = R * (0.56 + 0.44 * easeOutCubic(t / 0.16));
    } else if (t < 0.62) {
      // Цилиндрическая часть с лёгкой выпуклостью
      const k = (t - 0.16) / 0.46;
      r = R * (1 + 0.035 * Math.sin(k * Math.PI));
    } else {
      // Оживальный нос
      const k = (t - 0.62) / 0.38;
      r = R * Math.sqrt(Math.max(0, 1 - k * k)) * (1 - 0.1 * k);
    }
    profile.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const hullMat = asGhost(paintedHull());
  const hull = new THREE.Mesh(new THREE.LatheGeometry(profile, 56), hullMat);
  hull.castShadow = !ghost;
  group.add(hull);
  bodyParts.push(hull);

  /* ── Носовой обтекатель: красный лак поверх белого корпуса ────────────── */
  const noseProfile: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const y = H * 0.18 + t * H * 0.32;
    const k = t;
    noseProfile.push(new THREE.Vector2(Math.max(0.001, R * Math.sqrt(Math.max(0, 1 - k * k)) * (1 - 0.1 * k) * 1.012), y));
  }
  const nose = new THREE.Mesh(new THREE.LatheGeometry(noseProfile, 56), asGhost(paintedRed()));
  nose.castShadow = !ghost;
  group.add(nose);
  bodyParts.push(nose);

  /* ── Золотые акцентные кольца: читаются как «дорогой» объект ─────────── */
  [-0.52, 0.34, 0.92].forEach((y, i) => {
    const r = i === 2 ? R * 0.78 : R * 1.02;
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.022, 10, 64),
      asGhost(i === 1 ? polishedGold() : gold({ roughness: 0.3 }))
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    group.add(band);
  bodyParts.push(band);
  });

  /* ── Иллюминатор: стекло в металлическом кольце ──────────────────────── */
  const windowGroup = new THREE.Group();
  const glassBall = new THREE.Mesh(new THREE.SphereGeometry(0.155, 28, 20), asGhost(glass({ color: 0x9fd8ff })));
  windowGroup.add(glassBall);
  const windowRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.175, 0.032, 12, 40),
    asGhost(chrome())
  );
  windowGroup.add(windowRing);
  // Внутреннее свечение кабины — даёт жизнь даже без интерьера
  const cabinGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 18, 14),
    ghost ? additive(0x6fd0ff, 0.3) : additive(0x6fd0ff, 0.85)
  );
  windowGroup.add(cabinGlow);
  windowGroup.position.set(0, 0.42, R * 0.94);
  windowGroup.rotation.x = -0.12;
  group.add(windowGroup);
  bodyParts.push(windowGroup);

  /* ── Кили: выдавленный профиль с фаской (не конусы) ───────────────────── */
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.62, -0.1);          // передняя стреловидная кромка
  finShape.quadraticCurveTo(0.74, -0.34, 0.5, -0.78);   // законцовка
  finShape.quadraticCurveTo(0.22, -0.86, 0, -0.62);     // задняя кромка
  finShape.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.05, bevelEnabled: true, bevelThickness: 0.022,
    bevelSize: 0.022, bevelSegments: 3, curveSegments: 14
  });
  finGeo.translate(0, 0, -0.025);
  const finMat = asGhost(paintedRed());
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(finGeo, finMat);
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    fin.position.set(Math.cos(a) * R * 0.86, -H * 0.32, Math.sin(a) * R * 0.86);
    fin.rotation.y = -a + Math.PI / 2;
    fin.rotation.z = 0;
    fin.castShadow = !ghost;
    group.add(fin);
  bodyParts.push(fin);

    // Золотая кромка киля — тонкая полоска, ловит блик
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.72, 0.11),
      asGhost(gold({ roughness: 0.24 }))
    );
    edge.position.set(Math.cos(a) * (R * 0.86 + 0.3), -H * 0.32 - 0.3, Math.sin(a) * (R * 0.86 + 0.3));
    edge.rotation.y = -a + Math.PI / 2;
    group.add(edge);
  bodyParts.push(edge);
  }

  /* ── Сопловой раструб ────────────────────────────────────────────────── */
  const bellProfile: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    // Раструб: узкое горло → расширяющийся срез
    bellProfile.push(new THREE.Vector2(0.1 + 0.3 * Math.pow(t, 1.7), -H / 2 - t * 0.44));
  }
  const bell = new THREE.Mesh(new THREE.LatheGeometry(bellProfile, 40), asGhost(darkSteel({ roughness: 0.5 })));
  bell.castShadow = !ghost;
  group.add(bell);
  bodyParts.push(bell);

  // Раскалённая внутренняя поверхность сопла
  const innerProfile = bellProfile.map((p) => new THREE.Vector2(p.x * 0.93, p.y + 0.01));
  const nozzleGlow = new THREE.Mesh(
    new THREE.LatheGeometry(innerProfile, 40),
    ghost ? additive(0xff8a2a, 0.3) : additive(0xffa64d, 1)
  );
  nozzleGlow.material.side = THREE.BackSide;
  group.add(nozzleGlow);

  /* ── Пламя: три аддитивных слоя ──────────────────────────────────────── */
  const flameY = -H / 2 - 0.42;
  const flameOuter = new THREE.Mesh(
    new THREE.ConeGeometry(0.36, 1.85, 26, 1, true),
    ghost ? additive(0xff5a1f, 0.16) : additive(0xff5a1f, 0.42)
  );
  flameOuter.position.y = flameY - 0.86;
  flameOuter.rotation.x = Math.PI;
  group.add(flameOuter);

  const flameMid = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 1.3, 24, 1, true),
    ghost ? additive(0xffa62e, 0.2) : additive(0xffa62e, 0.62)
  );
  flameMid.position.y = flameY - 0.6;
  flameMid.rotation.x = Math.PI;
  group.add(flameMid);

  const flameCore = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 0.82, 20, 1, true),
    ghost ? additive(0xdff3ff, 0.24) : additive(0xdff3ff, 0.95)
  );
  flameCore.position.y = flameY - 0.36;
  flameCore.rotation.x = Math.PI;
  group.add(flameCore);

  // «Алмазные» ударные волны в струе — то, что видно на настоящих двигателях
  const diamonds: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Mesh(
      new THREE.SphereGeometry(0.1 - i * 0.012, 14, 10),
      ghost ? additive(0xbfe6ff, 0.18) : additive(0xbfe6ff, 0.7 - i * 0.12)
    );
    d.position.y = flameY - 0.42 - i * 0.3;
    d.scale.y = 1.5;
    group.add(d);
    diamonds.push(d);
  }

  /* ── Маячок на носу ──────────────────────────────────────────────────── */
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 14, 10),
    ghost ? additive(0xff3b5c, 0.4) : additive(0xff3b5c, 1.6)
  );
  beacon.position.y = H * 0.5 + 0.05;
  group.add(beacon);
  bodyParts.push(beacon);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.016, 0.16, 8),
    asGhost(chrome())
  );
  antenna.position.y = H * 0.5 - 0.02;
  group.add(antenna);
  bodyParts.push(antenna);

  /* ── Свет ────────────────────────────────────────────────────────────── */
  const engineLight = new THREE.PointLight(0xff7a2a, 0, 26, 2);
  engineLight.position.y = flameY - 0.6;
  group.add(engineLight);

  const beaconLight = new THREE.PointLight(0xff3b5c, 0, 8, 2);
  beaconLight.position.y = H * 0.5;
  group.add(beaconLight);

  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material && !ghost) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      list.forEach((mat) => { mat.needsUpdate = true; });
    }
  });

  return { group, flameCore, flameMid, flameOuter, diamonds, nozzleGlow, engineLight, beacon, beaconLight, bodyParts };
}

/* ═══════════════════════════ ПЛАТФОРМА И КОСМОС ══════════════════════ */

function buildPad(quality: string): THREE.Group {
  const pad = new THREE.Group();

  // Бетонная юбка — площадка стоит на «земле», а не висит в пустоте
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(2.95, 3.2, 0.24, 72),
    new THREE.MeshStandardMaterial({ map: concrete(), color: 0x565a66, roughness: 0.9, metalness: 0.05 })
  );
  skirt.position.y = -0.5;
  skirt.receiveShadow = quality === 'high';
  pad.add(skirt);

  // Бетонный пьедестал
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.35, 2.6, 0.3, 72),
    new THREE.MeshStandardMaterial({ map: concrete(), color: 0x6a6e7a, roughness: 0.85, metalness: 0.08 })
  );
  base.position.y = -0.24;
  base.receiveShadow = quality === 'high';
  pad.add(base);

  // Металлическая палуба с расшивкой
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.16, 0.1, 72),
    new THREE.MeshStandardMaterial({ map: concrete(), color: 0x8a8fa0, metalness: 0.75, roughness: 0.5 })
  );
  top.position.y = -0.04;
  top.receiveShadow = quality === 'high';
  pad.add(top);

  // Кольцо опасной разметки вокруг ракеты
  const hazard = hazardStripes('#f5c542', '#14141c', 30);
  hazard.repeat.set(6, 1);
  const hazardRing = new THREE.Mesh(
    new THREE.RingGeometry(1.25, 1.62, 64),
    new THREE.MeshStandardMaterial({ map: hazard, metalness: 0.4, roughness: 0.62, side: THREE.DoubleSide })
  );
  hazardRing.rotation.x = -Math.PI / 2;
  hazardRing.position.y = 0.015;
  pad.add(hazardRing);

  // Газоотводный колодец под соплом: тёмная воронка со стальным кантом
  const duct = new THREE.Mesh(
    new THREE.CylinderGeometry(0.92, 0.7, 0.5, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x0a0b10, roughness: 0.95, metalness: 0.2, side: THREE.DoubleSide })
  );
  duct.position.y = -0.12;
  pad.add(duct);
  const ductRim = new THREE.Mesh(new THREE.TorusGeometry(0.94, 0.05, 12, 64), darkSteel({ roughness: 0.4 }));
  ductRim.rotation.x = Math.PI / 2;
  ductRim.position.y = 0.02;
  pad.add(ductRim);

  // Неоновое кольцо по кромке палубы
  const ringTex = neonRing('#22d3ee', 0.055);
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), new THREE.MeshBasicMaterial({
    map: ringTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.7
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  pad.add(ring);

  // Золотое кольцо вокруг колодца
  const ring2Tex = neonRing('#f5c542', 0.04);
  const ring2 = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 3.1), new THREE.MeshBasicMaterial({
    map: ring2Tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.55
  }));
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y = 0.06;
  pad.add(ring2);

  // Трубопроводы от края к центру — площадка «обслуживается»
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10), darkSteel({ roughness: 0.5 }));
    pipe.rotation.z = Math.PI / 2;
    pipe.rotation.y = -a;
    pipe.position.set(Math.cos(a) * 1.6, 0.05, Math.sin(a) * 1.6);
    pad.add(pipe);
  }

  // Три опорных пилона с огнями
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const pylon = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.05, 12), darkSteel());
    post.position.y = 0.52;
    pylon.add(post);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), neon(0xff3b5c, 2.4));
    lamp.position.y = 1.06;
    pylon.add(lamp);
    const lampLight = new THREE.PointLight(0xff3b5c, 0.9, 4.5, 2);
    lampLight.position.y = 1.06;
    pylon.add(lampLight);
    pylon.position.set(Math.cos(a) * 1.72, 0.05, Math.sin(a) * 1.72);
    pad.add(pylon);
  }

  // Свечение под платформой (мягкая лужа света)
  const poolTex = radialGlow('#4f8dff', 0.1);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshBasicMaterial({
    map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.4, toneMapped: false
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = -0.6;
  pad.add(pool);

  return pad;
}

/* ═══════════════════════════ КОМПОНЕНТ ═══════════════════════════════ */

export default function RocketScene({
  phase, multiplier = 1, cashoutAt = 1, crashAt = 1, onReady, onGhostFinished, seed = 'vault-rocket'
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [ghostMultiplier, setGhostMultiplier] = useState<number | null>(null);

  // Всё изменяемое держим в ref: эффект создаёт сцену один раз на seed,
  // а новые props попадают в цикл анимации без пересоздания WebGL-контекста
  const stateRef = useRef({
    phase, multiplier, cashoutAt, crashAt,
    cashedStarted: phase === 'cashed' ? performance.now() : 0
  });
  const lastGhostUiRef = useRef(0);
  const ghostFinishedRef = useRef(false);
  const onGhostFinishedRef = useRef(onGhostFinished);
  onGhostFinishedRef.current = onGhostFinished;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (phase === 'cashed' && stateRef.current.phase !== 'cashed') {
      stateRef.current.cashedStarted = performance.now();
      ghostFinishedRef.current = false;
    }
    stateRef.current.phase = phase;
    stateRef.current.multiplier = multiplier;
    stateRef.current.cashoutAt = cashoutAt;
    stateRef.current.crashAt = crashAt;
    if (phase !== 'cashed') {
      setGhostMultiplier(null);
      lastGhostUiRef.current = 0;
    }
  }, [phase, multiplier, cashoutAt, crashAt]);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const rng = createRng(seed);
    const quality = detectQuality();
    const stage = createStageSafe({
      container,
      preset: 'rocket',
      quality,
      transparent: true,
      fog: { color: 0x05060f, density: 0.017 },
      fov: 52,
      position: [0, 1.6, 8.4],
      bloom: quality === 'high' ? 0.92 : quality === 'medium' ? 0.6 : 0,
      bloomRadius: 0.66,
      bloomThreshold: 0.58,
      exposure: 1.12,
      statsId: 'rocket'
    });
    // WebGL недоступен или контекст не создался: экран обязан остаться играбельным
    if (!stage) return;
    const { scene, camera } = stage;

    /* ── Космос: туманность + звёзды ────────────────────────────────────── */
    const skyGeo = new THREE.SphereGeometry(120, 32, 24);
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
      map: nebula(), side: THREE.BackSide, depthWrite: false, fog: false
    }));
    scene.add(sky);

    const starCount = quality === 'low' ? 260 : quality === 'medium' ? 520 : 820;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starSize = new Float32Array(starCount);
    const starAlpha = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      const [x, y, z] = rng.onSphere(rng.range(34, 96));
      starPos[i * 3] = x; starPos[i * 3 + 1] = y; starPos[i * 3 + 2] = z - 12;
      starSize[i] = rng.range(0.6, 2.6) * (rng.rand() > 0.93 ? 2.4 : 1);
      starAlpha[i] = rng.range(0.35, 1);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
    starGeo.setAttribute('aAlpha', new THREE.BufferAttribute(starAlpha, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: starFlare('#ffffff') }, uScale: { value: 210 }, uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          // Мерцание: у каждой звезды своя фаза
          vAlpha = aAlpha * (0.72 + 0.28 * sin(uTime * 2.1 + aAlpha * 42.0));
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

    /* ── Свет ───────────────────────────────────────────────────────────── */
    scene.add(new THREE.AmbientLight(0x4a5aa8, 0.55));
    const key = new THREE.DirectionalLight(0xfff0d0, 2.1);
    key.position.set(4.5, 9, 6);
    if (quality === 'high') {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 34;
      key.shadow.bias = -0.0012;
    }
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4f8dff, 1.5);
    rim.position.set(-6, 3, -5);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x22d3ee, 0.7);
    fill.position.set(5, -2, -3);
    scene.add(fill);

    /* ── Объекты ────────────────────────────────────────────────────────── */
    const pad = buildPad(quality);
    scene.add(pad);

    const rocket = buildRocket(false);
    rocket.group.position.y = 0.42;
    scene.add(rocket.group);

    const ghost = buildRocket(true);
    ghost.group.visible = false;
    scene.add(ghost.group);

    /* ═══ 3D-МОДЕЛЬ РАКЕТЫ (ТЗ): корпус из .glb, пламя/частицы — VFX сцены ═══
     * Призрак после кэшаута остаётся процедурным (полупрозрачный дубль).
     * Модель садится в группу ракеты и inherits покачивания/полёт; срез сопла
     * (Anchor_Flame) совмещаем с верхом процедурного пламени.
     */
    let cancelled = false;
    const rocketHolder = new THREE.Group();
    rocket.group.add(rocketHolder);
    loadModel('rocket.glb', { quality }).then((m) => {
      if (cancelled || !m) return;
      rocketHolder.add(m.root);
      rocketHolder.updateMatrixWorld(true);
      const anchor = m.anchors['Anchor_Flame'] ?? m.root;
      const av = new THREE.Vector3();
      anchor.getWorldPosition(av);
      rocket.group.worldToLocal(av);
      rocketHolder.position.add(new THREE.Vector3(0, -1.60, 0).sub(av));
      rocket.bodyParts.forEach((o) => { o.visible = false; });
    });

    /* ── Частицы ────────────────────────────────────────────────────────── */
    const smoke = new ParticleField(quality === 'low' ? 90 : 220, smokeSprite(), {
      color: 0xbfc6e8, size: 1.5, gravity: -0.35, drag: 0.965,
      blending: THREE.NormalBlending, opacity: 0.5
    });
    scene.add(smoke.points);

    const embers = new ParticleField(quality === 'low' ? 90 : 260, glowSprite('#ffd28a', 0.2), {
      color: 0xffb347, size: 0.55, gravity: -1.1, drag: 0.975, opacity: 1
    });
    scene.add(embers.points);

    const sparks = new ParticleField(quality === 'low' ? 110 : 320, glowSprite('#fff4d0', 0.35), {
      color: 0xffe9b0, size: 0.4, gravity: -3.2, drag: 0.965, opacity: 1
    });
    scene.add(sparks.points);

    const speedLines = new ParticleField(quality === 'low' ? 60 : 160, streakSprite('#bfe6ff'), {
      color: 0xcfe9ff, size: 0.34, gravity: 0, drag: 1, opacity: 0.75
    });
    scene.add(speedLines.points);

    /* ── Обломки (взрыв): не коробочки, а фрагменты самой ракеты ─────────
     * Изогнутые куски обшивки (открытые цилиндры), рваный носовой конус,
     * осколок киля, кольца силового набора, раскалённые «внутренности».
     * Открытые поверхности — DoubleSide, иначе куски «исчезают» с изнанки.
     */
    const debrisGroup = new THREE.Group();
    const hullMatD = paintedHull(); hullMatD.side = THREE.DoubleSide;
    const redMatD = paintedRed(); redMatD.side = THREE.DoubleSide;
    // Раскалённый металл: тёмная сталь с остывающим свечением кромки
    const charMat = new THREE.MeshStandardMaterial({
      color: 0x24262e, roughness: 0.78, metalness: 0.85,
      emissive: 0xff6a24, emissiveIntensity: 0.95
    });
    const tankMat = new THREE.MeshStandardMaterial({
      color: 0xc8ccd8, roughness: 0.34, metalness: 1, side: THREE.DoubleSide
    });
    const debrisMats = [hullMatD, redMatD, darkSteel(), gold({ roughness: 0.35 }), charMat, tankMat];

    // Кусок обшивки: открытый цилиндр с углом охвата ~90°
    const hullShard = new THREE.CylinderGeometry(0.32, 0.34, 0.3, 10, 1, true, 0.4, 1.5);
    // Рваный фрагмент носового конуса
    const noseShard = new THREE.ConeGeometry(0.3, 0.42, 10, 1, true, 2.1, 1.4);
    // Осколок киля: тонкий выдавленный треугольник
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.34, -0.06);
    finShape.quadraticCurveTo(0.4, -0.22, 0.26, -0.4);
    finShape.lineTo(0, -0.3);
    finShape.closePath();
    const finShard = new THREE.ExtrudeGeometry(finShape, { depth: 0.02, bevelEnabled: false });
    // Осколки силового кольца и соплового раструба
    const ringShard = new THREE.TorusGeometry(0.26, 0.035, 8, 14, 2.1);
    const ductShard = new THREE.TorusGeometry(0.2, 0.055, 8, 14, 1.7);
    // Внутренности: раскалённый многогранник и осколок топливного бака
    const charShard = new THREE.TetrahedronGeometry(0.17);
    const tankShard = new THREE.SphereGeometry(0.24, 10, 8, 0, 2.3, 0.5, 1.5);
    const debrisGeos = [hullShard, noseShard, finShard, ringShard, ductShard, charShard, tankShard];
    const DEBRIS = quality === 'low' ? 18 : 38;
    const debris: Array<{ mesh: THREE.Mesh; v: THREE.Vector3; vr: THREE.Vector3 }> = [];
    for (let i = 0; i < DEBRIS; i++) {
      const mesh = new THREE.Mesh(
        debrisGeos[i % debrisGeos.length],
        debrisMats[rng.int(0, debrisMats.length - 1)]
      );
      mesh.scale.setScalar(rng.range(0.72, 1.45));
      mesh.visible = false;
      debrisGroup.add(mesh);
      debris.push({ mesh, v: new THREE.Vector3(), vr: new THREE.Vector3() });
    }
    scene.add(debrisGroup);

    // Вспышка и ударная волна взрыва
    const flash = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 26),
      additive(0xfff0d0, 0)
    );
    flash.visible = false;
    scene.add(flash);

    const shock = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.72, 64),
      additive(0xffb347, 0)
    );
    shock.visible = false;
    scene.add(shock);

    const blastLight = new THREE.PointLight(0xff7a2a, 0, 40, 2);
    scene.add(blastLight);

    // Огненный шар: два перекрещенных билборда с турбулентной текстурой
    const fireMat = () => new THREE.MeshBasicMaterial({
      map: fireball(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      side: THREE.DoubleSide
    });
    const fireA = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fireMat());
    const fireB = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fireMat());
    fireA.visible = fireB.visible = false;
    scene.add(fireA, fireB);

    // Вторая ударная волна — догоняет первую
    const shock2 = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.62, 64),
      additive(0xfff0d0, 0)
    );
    shock2.visible = false;
    scene.add(shock2);

    /* ── Q4: облако огненных шаров — взрыв «объёмный», а не плоский ─────── */
    interface CloudBall { mesh: THREE.Mesh; off: THREE.Vector3; delay: number; spin: number; rise: number }
    const fireCloud: CloudBall[] = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fireMat());
      m.visible = false;
      scene.add(m);
      fireCloud.push({
        mesh: m,
        off: new THREE.Vector3(rng.spread(1.5), rng.range(0, 1.1), rng.spread(1.5)),
        delay: rng.range(0, 0.22),
        spin: rng.spread(2.6),
        rise: rng.range(1.1, 2.6)
      });
    }
    // Столб пламени: вертикальный билборд, растёт и тает — «ядерный гриб»
    const flameCol = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fireMat());
    flameCol.visible = false;
    scene.add(flameCol);

    // Цепная реакция: три вторичных детонации с задержкой и смещением —
    // взрыв не один «бабах», а серия, как в настоящем крушении
    interface After { mesh: THREE.Mesh; delay: number; off: THREE.Vector3; burst: boolean }
    const afters: After[] = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fireMat());
      m.visible = false;
      scene.add(m);
      afters.push({
        mesh: m,
        delay: 0.42 + i * rng.range(0.22, 0.34),
        off: new THREE.Vector3(rng.spread(2.2), rng.range(-0.4, 1.0), rng.spread(2.2)),
        burst: false
      });
    }

    /* ── Состояние анимации ─────────────────────────────────────────────── */
    let altitude = 0;
    let flightT = 0;
    let explodedAt = -1;
    let landed = false;
    let ghostAlt = 0;
    let shake = 0;
    let smokeTimer = 0;
    let emberTimer = 0;
    let lineTimer = 0;
    const camTarget = new THREE.Vector3(0, 1.6, 8.4);
    // Два временных вектора: в кадре до сотни частиц, и `new Vector3()` на
    // каждую — это сборка мусора посреди полёта (подтормаживание на Android)
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();

    const explode = (at: THREE.Vector3) => {
      if (explodedAt >= 0) return;
      explodedAt = 0;
      debrisGroup.position.copy(at);
      for (const d of debris) {
        d.mesh.visible = true;
        d.mesh.position.set(rng.spread(0.2), rng.spread(0.2), rng.spread(0.2));
        const [vx, vy, vz] = rng.onSphere(1);
        d.v.set(vx * rng.range(2.2, 7), Math.abs(vy) * rng.range(1.4, 5.6), vz * rng.range(2.2, 7));
        d.vr.set(rng.spread(5.5), rng.spread(5.5), rng.spread(5.5));
      }
      // Искры и дым взрыва
      for (let i = 0; i < (quality === 'low' ? 60 : 150); i++) {
        const [vx, vy, vz] = rng.onSphere(1);
        const sp = rng.range(2.5, 9);
        sparks.emit(at, tmp.set(vx * sp, vy * sp * 0.9 + 1.4, vz * sp), rng.range(0.5, 1.5), rng.range(0.3, 0.8));
      }
      for (let i = 0; i < (quality === 'low' ? 14 : 34); i++) {
        const [vx, vy, vz] = rng.onSphere(1);
        smoke.emit(at, tmp.set(vx * rng.range(0.5, 1.9), Math.abs(vy) * rng.range(0.4, 1.4), vz * rng.range(0.5, 1.9)), rng.range(1.4, 3), rng.range(1.4, 3.2));
      }
      flash.position.copy(at);
      flash.visible = true;
      shock.position.copy(at);
      shock.visible = true;
      shock2.position.copy(at);
      shock2.visible = false;
      fireA.position.copy(at);
      fireB.position.copy(at);
      fireA.visible = fireB.visible = true;
      fireA.scale.setScalar(0.6);
      fireB.scale.setScalar(0.6);
      (fireA.material as THREE.MeshBasicMaterial).opacity = 1;
      (fireB.material as THREE.MeshBasicMaterial).opacity = 1;
      blastLight.position.copy(at);
      // Облако огненных шаров вокруг эпицентра + столб пламени
      for (const b of fireCloud) {
        b.mesh.visible = true;
        b.mesh.position.copy(at).add(b.off);
        b.mesh.scale.setScalar(0.5);
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
      }
      flameCol.visible = true;
      flameCol.position.copy(at);
      flameCol.scale.set(1.4, 0.6, 1);
      (flameCol.material as THREE.MeshBasicMaterial).opacity = 1;
      for (const a of afters) {
        a.mesh.visible = false;
        a.burst = false;
        a.mesh.position.copy(at).add(a.off);
        a.mesh.scale.setScalar(0.4);
      }
      // Фонтан раскалённых углей вверх — взрыв не только вширь, но и вверх
      for (let i = 0; i < (quality === 'low' ? 28 : 92); i++) {
        const a = rng.rand() * Math.PI * 2;
        const rr = rng.range(0, 0.5);
        tmp.set(at.x + Math.cos(a) * rr, at.y, at.z + Math.sin(a) * rr);
        tmp2.set(Math.cos(a) * rng.range(0.3, 1.7), rng.range(2.8, 7.4), Math.sin(a) * rng.range(0.3, 1.7));
        embers.emit(tmp, tmp2, rng.range(0.7, 1.6), rng.range(0.2, 0.5));
      }
      // Первый кадр: плотный выброс дыма из точки взрыва
      for (let i = 0; i < (quality === 'low' ? 20 : 60); i++) {
        const [vx, vy, vz] = rng.onSphere(1);
        smoke.emit(at, tmp.set(vx * rng.range(0.4, 1.4), Math.abs(vy) * rng.range(0.5, 1.6), vz * rng.range(0.4, 1.4)), rng.range(1.8, 3.4), rng.range(0.9, 1.9));
      }
      shake = 1.6;
    };

    const stopLoop = startLoop(stage, (dt, elapsed) => {
      const s = stateRef.current;
      const phase = s.phase;
      const mult = Math.max(1, s.multiplier);

      // Звёзды и туманность медленно вращаются всегда — кадр не «замирает»
      stars.rotation.y = elapsed * 0.012;
      sky.rotation.y = elapsed * 0.006;
      starMat.uniforms.uTime.value = elapsed;

      // Маячок мигает в любой фазе
      const blink = Math.sin(elapsed * 5.2) > 0.35 ? 1 : 0.12;
      rocket.beaconLight.intensity = blink * 1.4;
      (rocket.beacon.material as THREE.MeshBasicMaterial).opacity = ghost.group.visible ? 1 : blink;

      if (phase === 'idle') {
        flightT = 0;
        altitude = 0;
        landed = false;
        explodedAt = -1;
        rocket.group.visible = true;
        ghost.group.visible = false;
        flash.visible = false;
        shock.visible = false;
        blastLight.intensity = 0;
        debris.forEach((d) => { d.mesh.visible = false; });
        fireCloud.forEach((b) => { b.mesh.visible = false; });
        flameCol.visible = false;
        afters.forEach((a) => { a.mesh.visible = false; });
        smoke.clear(); embers.clear(); sparks.clear(); speedLines.clear();

        // Предстартовое покачивание + лёгкое дрожание (двигатель на холостых)
        rocket.group.position.y = 0.42 + Math.sin(elapsed * 1.5) * 0.028;
        rocket.group.rotation.y = Math.sin(elapsed * 0.42) * 0.24;
        rocket.group.rotation.z = Math.sin(elapsed * 0.9) * 0.012;

        // Пламя на холостых: короткое, дышит
        const idleFlame = 0.24 + Math.abs(fbm1(elapsed * 6)) * 0.1;
        rocket.flameOuter.scale.set(0.6, idleFlame, 0.6);
        rocket.flameMid.scale.set(0.55, idleFlame * 0.9, 0.55);
        rocket.flameCore.scale.set(0.5, idleFlame * 0.8, 0.5);
        (rocket.flameOuter.material as THREE.MeshBasicMaterial).opacity = 0.3;
        (rocket.flameMid.material as THREE.MeshBasicMaterial).opacity = 0.42;
        (rocket.flameCore.material as THREE.MeshBasicMaterial).opacity = 0.6;
        rocket.nozzleGlow.scale.setScalar(1);
        rocket.engineLight.intensity = 2.4 + fbm1(elapsed * 9) * 1.1;
        rocket.diamonds.forEach((d, i) => { d.visible = i < 2; });

        // Пар с платформы
        smokeTimer += dt;
        if (smokeTimer > 0.09) {
          smokeTimer = 0;
          const a = rng.rand() * Math.PI * 2;
          smoke.emit(
            tmp.set(Math.cos(a) * 0.7, -0.1, Math.sin(a) * 0.7),
            tmp2.set(Math.cos(a) * 0.5, -0.25, Math.sin(a) * 0.5),
            rng.range(1.2, 2.2), rng.range(0.7, 1.5)
          );
        }

        // Киношный облёт площадки
        const orbit = elapsed * 0.16;
        camTarget.set(Math.sin(orbit) * 1.5, 1.7 + Math.sin(elapsed * 0.3) * 0.18, 8.1 + Math.cos(orbit) * 0.5);
        camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt));
        camera.lookAt(0, rocket.group.position.y + 0.5, 0);
        camera.fov += (52 - camera.fov) * 0.06;
        camera.updateProjectionMatrix();
      } else if (phase === 'flying') {
        flightT += dt;
        rocket.group.visible = true;
        ghost.group.visible = false;
        landed = false;
        explodedAt = -1;
        flash.visible = false;
        shock.visible = false;
        blastLight.intensity = 0;
        debris.forEach((d) => { d.mesh.visible = false; });
        fireCloud.forEach((b) => { b.mesh.visible = false; });
        flameCol.visible = false;
        afters.forEach((a) => { a.mesh.visible = false; });

        // Набор высоты логарифмический: ракета уходит вверх, но остаётся в кадре
        const targetAlt = Math.log(1 + flightT * 0.62) * 4.2;
        altitude += (targetAlt - altitude) * (1 - Math.pow(0.001, dt));
        rocket.group.position.y = 0.42 + altitude;
        rocket.group.position.x = 0;
        rocket.group.position.z = 0;

        // Пламя растёт вместе с множителем и дрожит
        const power = Math.min(1, 0.55 + Math.log(mult) * 0.3);
        const flick = 1 + fbm1(elapsed * 22) * 0.16;
        rocket.flameOuter.scale.set(0.72 + power * 0.42, (1.05 + power * 0.9) * flick, 0.72 + power * 0.42);
        rocket.flameMid.scale.set(0.66 + power * 0.34, (0.92 + power * 0.72) * flick, 0.66 + power * 0.34);
        rocket.flameCore.scale.set(0.58 + power * 0.26, (0.76 + power * 0.5) * flick, 0.58 + power * 0.26);
        (rocket.flameOuter.material as THREE.MeshBasicMaterial).opacity = 0.34 + power * 0.2;
        (rocket.flameMid.material as THREE.MeshBasicMaterial).opacity = 0.5 + power * 0.26;
        (rocket.flameCore.material as THREE.MeshBasicMaterial).opacity = 0.72 + power * 0.24;
        rocket.diamonds.forEach((d, i) => {
          d.visible = i < 1 + Math.round(power * 3);
          const s = 1 + Math.sin(elapsed * 26 - i * 1.2) * 0.22;
          d.scale.set(s, s * 1.5, s);
        });
        rocket.engineLight.intensity = 7 + power * 12 + fbm1(elapsed * 18) * 3;
        rocket.engineLight.distance = 30;

        // Тряска корпуса: растёт с множителем (нагрузочный режим)
        const stress = Math.min(1, Math.max(0, (mult - 2.2) / 7));
        rocket.group.position.x = rng.spread(0.014 + stress * 0.07);
        rocket.group.position.z = rng.spread(0.012 + stress * 0.06);
        rocket.group.rotation.z = rng.spread(0.006 + stress * 0.03);
        rocket.group.rotation.y = elapsed * 0.35;

        // Струя: дым и угли из сопла
        smokeTimer += dt;
        const smokeRate = 0.035 - stress * 0.012;
        if (smokeTimer > smokeRate) {
          smokeTimer = 0;
          tmp.set(rng.spread(0.16), rocket.group.position.y - 1.62, rng.spread(0.16));
          tmp2.set(rng.spread(0.7), -2.6 - power * 2.2, rng.spread(0.7));
          smoke.emit(tmp, tmp2, rng.range(0.7, 1.5), rng.range(0.5, 1.2));
        }
        emberTimer += dt;
        if (emberTimer > 0.02) {
          emberTimer = 0;
          tmp.set(rng.spread(0.14), rocket.group.position.y - 1.7, rng.spread(0.14));
          tmp2.set(rng.spread(1.1), -5 - power * 5, rng.spread(1.1));
          embers.emit(tmp, tmp2, rng.range(0.3, 0.8), rng.range(0.24, 0.5));
        }

        // Линии скорости на больших множителях — ощущение разгона
        lineTimer += dt;
        if (mult > 2.4 && lineTimer > 0.03) {
          lineTimer = 0;
          const r = rng.range(2.2, 7.5);
          const a = rng.rand() * Math.PI * 2;
          tmp.set(Math.cos(a) * r, rocket.group.position.y + rng.range(2, 9), Math.sin(a) * r);
          tmp2.set(0, -16 - mult * 1.6, 0);
          speedLines.emit(tmp, tmp2, rng.range(0.28, 0.55), rng.range(0.5, 1.4));
        }

        // Камера следует с запаздыванием; FOV расширяется с множителем
        const shakeAmt = stress * 0.16;
        camTarget.set(rng.spread(shakeAmt), 1.5 + altitude, 8.2 - Math.min(1.6, Math.log(mult) * 0.5));
        camera.position.lerp(camTarget, 1 - Math.pow(0.0016, dt));
        camera.lookAt(rng.spread(shakeAmt * 0.6), rocket.group.position.y + 0.35, 0);
        const targetFov = 52 + Math.min(15, Math.log(mult) * 7.5);
        camera.fov += (targetFov - camera.fov) * (1 - Math.pow(0.02, dt));
        camera.updateProjectionMatrix();

        // Платформа уходит вниз и исчезает
        pad.position.y = -altitude * 0.35;
        pad.visible = altitude < 26;

        // Звёзды «летят» мимо
        stars.position.y = altitude * 0.55;
        sky.position.y = altitude * 0.22;
      } else if (phase === 'crashed') {
        if (explodedAt < 0) explode(new THREE.Vector3(0, rocket.group.position.y, 0));
        rocket.group.visible = false;
        ghost.group.visible = false;
        runExplosion(dt, elapsed);
        camera.fov += (60 - camera.fov) * 0.05;
        camera.updateProjectionMatrix();
      } else if (phase === 'cashed') {
        /* Кэшаут: настоящая ракета приземляется, призрак доигрывает траекторию */
        const from = Math.max(1.01, s.cashoutAt);
        const to = Math.max(from, s.crashAt);
        const fullMs = Math.max(900, (Math.log(to / from) / CURVE) * 1000);
        const passed = Math.max(0, performance.now() - s.cashedStarted);
        const ghostMult = Math.min(to, from * Math.exp(CURVE * (passed / 1000)));

        if (passed < fullMs) {
          // Призрак летит по той же кривой, что и сервер
          ghostAlt = Math.log(1 + Math.max(0, Math.log(ghostMult) / CURVE) * 0.62) * 4.2;
          ghost.group.visible = true;
          ghost.group.position.set(0, 0.42 + ghostAlt, 0);
          ghost.group.rotation.y = elapsed * 0.5;
          const gPower = Math.min(1, 0.6 + Math.log(ghostMult) * 0.28);
          const gFlick = 1 + fbm1(elapsed * 20) * 0.18;
          ghost.flameOuter.scale.set(0.6 + gPower * 0.3, (0.9 + gPower * 0.7) * gFlick, 0.6 + gPower * 0.3);
          ghost.flameMid.scale.set(0.54 + gPower * 0.26, (0.78 + gPower * 0.56) * gFlick, 0.54 + gPower * 0.26);
          ghost.flameCore.scale.set(0.48 + gPower * 0.2, (0.64 + gPower * 0.42) * gFlick, 0.48 + gPower * 0.2);
          ghost.engineLight.intensity = 4 + gPower * 7;
          ghost.diamonds.forEach((d, i) => { d.visible = i < 1 + Math.round(gPower * 2); });

          // Настоящая ракета мягко опускается на платформу
          rocket.group.visible = true;
          rocket.group.position.y = landed
            ? 0.42
            : Math.max(0.42, rocket.group.position.y - dt * 3.2);
          if (rocket.group.position.y <= 0.43) landed = true;
          const idleF = 0.18 + Math.abs(fbm1(elapsed * 5)) * 0.07;
          rocket.flameOuter.scale.set(0.5, idleF, 0.5);
          rocket.flameMid.scale.set(0.44, idleF * 0.9, 0.44);
          rocket.flameCore.scale.set(0.4, idleF * 0.8, 0.4);
          rocket.engineLight.intensity = 1.8;
          rocket.group.rotation.y += dt * 0.25;

          // Угли из-под призрака
          emberTimer += dt;
          if (emberTimer > 0.05) {
            emberTimer = 0;
            tmp.set(rng.spread(0.14), ghost.group.position.y - 1.7, rng.spread(0.14));
            tmp2.set(rng.spread(0.9), -4.4, rng.spread(0.9));
            embers.emit(tmp, tmp2, rng.range(0.3, 0.7), rng.range(0.2, 0.42));
          }

          // Камера следует за призраком: длинный красивый полёт обязан быть в кадре
          camTarget.set(0, 1.5 + ghostAlt, 8.2 - Math.min(1.4, Math.log(ghostMult) * 0.45));
          camera.position.lerp(camTarget, 1 - Math.pow(0.004, dt));
          camera.lookAt(0, ghost.group.position.y + 0.3, 0);
          const targetFov = 52 + Math.min(12, Math.log(ghostMult) * 6);
          camera.fov += (targetFov - camera.fov) * 0.05;
          camera.updateProjectionMatrix();

          pad.position.y = -ghostAlt * 0.3;
          pad.visible = ghostAlt < 26;
          stars.position.y = ghostAlt * 0.5;
          sky.position.y = ghostAlt * 0.2;

          // Обновляем HUD не чаще 12 раз в секунду — иначе ре-рендер React
          // съедает кадры, которые нужны сцене
          if (performance.now() - lastGhostUiRef.current > 80) {
            lastGhostUiRef.current = performance.now();
            setGhostMultiplier(ghostMult);
          }
        } else {
          // Полёт закончился: призрак взрывается в сохранённой точке
          if (!ghostFinishedRef.current) {
            ghostFinishedRef.current = true;
            setGhostMultiplier(to);
            onGhostFinishedRef.current?.();
          }
          if (explodedAt < 0) explode(new THREE.Vector3(0, 0.42 + ghostAlt, 0));
          ghost.group.visible = false;
          runExplosion(dt, elapsed);
        }
      }

      /* ── Общая физика частиц и взрыва ─────────────────────────────────── */
      smoke.update(dt);
      embers.update(dt);
      sparks.update(dt);
      speedLines.update(dt);
      smoke.setScale(camera.position.distanceTo(tmp.set(0, rocket.group.position.y, 0)) * 34);
      embers.setScale(240);
      sparks.setScale(260);
      speedLines.setScale(200);

      if (shake > 0) {
        shake = Math.max(0, shake - dt * 1.6);
        camera.position.x += rng.spread(shake * 0.42);
        camera.position.y += rng.spread(shake * 0.42);
      }

      function runExplosion(dt: number, elapsed: number) {
        explodedAt += dt;
        // Обломки: гравитация + сопротивление + огненные шлейфы.
        // Куски кувыркаются медленно (крупные детали так и летят), шлейф
        // искр тянется дольше, а самые большие оставляют дымный след.
        const trailOn = explodedAt < 1.7;
        for (let di = 0; di < debris.length; di++) {
          const d = debris[di];
          if (!d.mesh.visible) continue;
          d.v.y -= 5.4 * dt;
          d.v.multiplyScalar(1 - 0.35 * dt);
          d.mesh.position.addScaledVector(d.v, dt);
          d.mesh.rotation.x += d.vr.x * dt;
          d.mesh.rotation.y += d.vr.y * dt;
          d.mesh.rotation.z += d.vr.z * dt;
          if (trailOn) {
            tmp.copy(d.mesh.position);
            tmp2.copy(d.v).multiplyScalar(-0.16);
            if (rng.rand() < 0.5) sparks.emit(tmp, tmp2, rng.range(0.16, 0.34), rng.range(0.05, 0.12));
            // Каждый третий кусок — «крупный»: дымный след
            if (di % 3 === 0 && rng.rand() < 0.3) {
              smoke.emit(tmp, tmp2.multiplyScalar(0.3), rng.range(0.5, 0.9), rng.range(0.3, 0.6));
            }
          }
          if (explodedAt > 3.2) d.mesh.visible = false;
        }
        // Вспышка гаснет за ~0.4 с
        const f = Math.max(0, 1 - explodedAt / 0.45);
        (flash.material as THREE.MeshBasicMaterial).opacity = f * f;
        flash.scale.setScalar(1.3 + explodedAt * 3.1);
        flash.lookAt(camera.position);
        flash.visible = f > 0.01;
        // Огненный шар растёт и тает, билборды к камере
        const ft = explodedAt;
        const fscale = 0.6 + easeOutCubic(Math.min(1, ft / 0.55)) * 7.5;
        const fop = Math.max(0, 1 - ft / 0.95);
        fireA.visible = fireB.visible = fop > 0.01;
        if (fireA.visible) {
          fireA.scale.setScalar(fscale * (1 + Math.sin(elapsed * 31) * 0.05));
          fireB.scale.setScalar(fscale * (1 + Math.cos(elapsed * 27) * 0.05));
          (fireA.material as THREE.MeshBasicMaterial).opacity = fop * fop;
          (fireB.material as THREE.MeshBasicMaterial).opacity = fop * fop * 0.85;
          fireA.lookAt(camera.position);
          fireB.lookAt(camera.position);
          fireB.rotateZ(Math.PI / 2);
        }
        // Облако огненных шаров: растёт, поднимается, вращается, гаснет с задержкой
        for (const b of fireCloud) {
          const bt = explodedAt - b.delay;
          if (bt < 0) { b.mesh.visible = false; continue; }
          const bScale = 0.5 + easeOutCubic(Math.min(1, bt / 0.5)) * (2.4 + b.delay * 3);
          const bOp = Math.max(0, 1 - bt / 1.35);
          b.mesh.visible = bOp > 0.01;
          if (b.mesh.visible) {
            b.mesh.position.y += b.rise * dt;
            b.mesh.scale.setScalar(bScale * (1 + Math.sin(elapsed * 23 + b.delay * 40) * 0.07));
            (b.mesh.material as THREE.MeshBasicMaterial).opacity = bOp * bOp * 0.9;
            b.mesh.lookAt(camera.position);
            b.mesh.rotateZ(b.spin * elapsed);
          }
        }
        // Столб пламени: быстро растёт вверх, гаснет за 0.7 с
        const colT = explodedAt;
        const colOp = Math.max(0, 1 - colT / 0.7);
        flameCol.visible = colOp > 0.01;
        if (flameCol.visible) {
          flameCol.scale.set(1.4 + colT * 1.2, 0.6 + easeOutCubic(Math.min(1, colT / 0.4)) * 7.5, 1);
          flameCol.position.y = debrisGroup.position.y + flameCol.scale.y * 0.32;
          (flameCol.material as THREE.MeshBasicMaterial).opacity = colOp * colOp;
          flameCol.lookAt(camera.position);
        }
        // Цепная реакция: вторичные детонации вспыхивают по очереди,
        // каждая со своим всплеском искр
        for (const a of afters) {
          const at2 = explodedAt - a.delay;
          if (at2 < 0) { a.mesh.visible = false; continue; }
          const aOp = Math.max(0, 1 - at2 / 0.6);
          a.mesh.visible = aOp > 0.01;
          if (a.mesh.visible) {
            a.mesh.scale.setScalar(0.4 + easeOutCubic(Math.min(1, at2 / 0.3)) * 4.6);
            (a.mesh.material as THREE.MeshBasicMaterial).opacity = aOp * aOp;
            a.mesh.lookAt(camera.position);
            a.mesh.rotateZ(at2 * 2.4);
          }
          if (!a.burst && at2 >= 0) {
            a.burst = true;
            tmp.copy(a.mesh.position);
            for (let k = 0; k < (quality === 'low' ? 10 : 26); k++) {
              const [vx, vy, vz] = rng.onSphere(1);
              const sp = rng.range(1.4, 5);
              sparks.emit(tmp, tmp2.set(vx * sp, vy * sp, vz * sp), rng.range(0.3, 0.8), rng.range(0.16, 0.34));
            }
            blastLight.intensity += 8;
          }
        }
        // Дымовая колонна поднимается ещё полторы секунды
        if (ft < 1.6) {
          smokeTimer += dt;
          if (smokeTimer > 0.03) {
            smokeTimer = 0;
            tmp.copy(debrisGroup.position);
            tmp.x += rng.spread(0.5); tmp.y += rng.range(0, 0.6); tmp.z += rng.spread(0.5);
            tmp2.set(rng.spread(0.4), rng.range(1.2, 2.6), rng.spread(0.4));
            smoke.emit(tmp, tmp2, rng.range(1.6, 3), rng.range(0.8, 1.7));
          }
        }
        // Ударные кольца: первое + догоняющая вторая волна
        const sr = Math.max(0, 1 - explodedAt / 0.95);
        (shock.material as THREE.MeshBasicMaterial).opacity = sr * 0.8;
        shock.scale.setScalar(1 + easeOutCubic(Math.min(1, explodedAt / 0.95)) * 16);
        shock.lookAt(camera.position);
        shock.visible = sr > 0.01;
        const s2t = Math.max(0, explodedAt - 0.14);
        const s2r = Math.max(0, 1 - s2t / 0.8);
        (shock2.material as THREE.MeshBasicMaterial).opacity = s2r * 0.55;
        shock2.scale.setScalar(1 + easeOutCubic(Math.min(1, s2t / 0.8)) * 22);
        shock2.lookAt(camera.position);
        shock2.visible = s2r > 0.01;
        // Свет: главный пик + вторичный от огненного шара
        blastLight.intensity = Math.max(blastLight.intensity - 40 * dt,
          Math.max(0, 34 * (1 - explodedAt / 0.7)) +
          (ft > 0.1 ? 16 * Math.max(0, 1 - Math.abs(ft - 0.3) / 0.5) : 0));
        // Камера отъезжает и дрожит с лёгким креном — удар ощущается
        const back = 8.6 + Math.min(2.4, explodedAt * 1.4);
        // Зум-панч: в первые 0.3 с камера резко расширяет поле зрения
        const punch = Math.max(0, 1 - explodedAt / 0.3) * 9;
        camera.fov += (60 + punch - camera.fov) * (1 - Math.pow(0.01, dt));
        camera.updateProjectionMatrix();
        camTarget.set(0, debrisGroup.position.y + 0.4, back);
        camera.position.lerp(camTarget, 1 - Math.pow(0.02, dt));
        camera.lookAt(debrisGroup.position.x, debrisGroup.position.y, debrisGroup.position.z);
        if (explodedAt < 0.9) camera.rotateZ(Math.sin(elapsed * 37) * 0.02 * (0.9 - explodedAt));
        void elapsed;
      }
    });

    // Первый кадр отрисован — можно сообщать о готовности
    stage.render();
    onReadyRef.current?.();

    // Возврат из фоновой вкладки: сцена продолжает жить, но dt ограничен
    const onVisible = () => { /* цикл сам ограничивает dt, действий не нужно */ };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      disposeModel('rocket.glb');
      document.removeEventListener('visibilitychange', onVisible);
      stopLoop();
      smoke.dispose(); embers.dispose(); sparks.dispose(); speedLines.dispose();
      debrisGeos.forEach((g) => g.dispose());
      debrisMats.forEach((m) => m.dispose());
      disposeObject(rocket.group);
      disposeObject(ghost.group);
      disposeObject(pad);
      disposeObject(scene);
      starGeo.dispose(); starMat.dispose(); skyGeo.dispose();
      (sky.material as THREE.Material).dispose();
      stage.dispose();
      // Текстуры из lib/textures намеренно НЕ освобождаем: кэш общий для всех
      // сцен, и его очистка заставила бы следующий зал перерисовывать canvas.
    };
  }, [seed]);

  /* ── HUD поверх сцены ────────────────────────────────────────────────── */
  const ghostActive = phase === 'cashed' && ghostMultiplier !== null;
  const ghostDone = ghostActive && ghostMultiplier! >= crashAt - 1e-9;

  return (
    <div style={{ position: 'relative' }}>
      <div ref={ref} className="three-container" />

      {ghostActive && (
        <div className="scene-hud">
          {/* Верхние плашки ушли в Rocket.tsx: два наложенных .scene-hud
              (этот и внешний) дрались за правый верхний угол */}
          <div style={{ margin: '0 auto', textAlign: 'center' }}>
            <div
              className="mult"
              style={{
                fontSize: 'clamp(40px, 13vw, 62px)',
                color: ghostDone ? '#ff8fa3' : '#ffe27a',
                textShadow: ghostDone
                  ? '0 0 26px rgba(255,59,92,.7), 0 0 66px rgba(255,59,92,.3)'
                  : '0 0 24px rgba(245,197,66,.66), 0 0 62px rgba(245,197,66,.28)'
              }}
            >
              x{ghostMultiplier!.toFixed(2)}
            </div>
            <div className="text-faint" style={{ letterSpacing: '.14em', textTransform: 'uppercase', fontSize: 9 }}>
              {ghostDone ? 'выплата зафиксирована' : 'деньги уже забраны'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
