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
  digitPlate, dialGraduation, engravedPlate, brushedMetal, hazardStripes,
  radialGlow, glowSprite, smokeSprite
} from '../lib/textures';
import { ParticleField } from '../lib/particles';
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
      background: 0x08060f,
      fog: { color: 0x08060f, density: 0.055 },
      fov: 40,
      position: [0.35, 0.62, 6.6],
      bloom: quality === 'high' ? 0.7 : quality === 'medium' ? 0.45 : 0,
      bloomRadius: 0.55,
      bloomThreshold: 0.66,
      exposure: 1.06,
      statsId: 'safe'
    });
    if (!stage) return;
    const { scene, camera } = stage;

    /* ═══════════════════════ ПОЛ И ФОНОВАЯ НИША ═════════════════════════ */
    const floorTex = brushedMetal({ base: 26, strength: 16, circular: false });
    floorTex.repeat.set(6, 6);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshStandardMaterial({
        map: floorTex, color: 0x2a2c40, metalness: 0.55, roughness: 0.42, envMapIntensity: 0.5
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = quality === 'high';
    scene.add(floor);

    // Лужа тёплого света под сейфом — иначе он висит в черноте
    const floorPool = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, 7.5),
      new THREE.MeshBasicMaterial({
        map: radialGlow('#ffcf6a', 0.05), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.28
      })
    );
    floorPool.rotation.x = -Math.PI / 2;
    floorPool.position.set(0, FLOOR_Y + 0.01, 0.4);
    scene.add(floorPool);

    // Опасная разметка перед сейфом: читается как «зона хранилища»
    const hazardTex = hazardStripes('#f5c542', '#101018', 40);
    hazardTex.repeat.set(6, 1);
    const hazard = new THREE.Mesh(
      new THREE.PlaneGeometry(8.4, 0.42),
      new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.7, metalness: 0.1 })
    );
    hazard.rotation.x = -Math.PI / 2;
    hazard.position.set(0, FLOOR_Y + 0.015, 1.75);
    scene.add(hazard);

    /* ═══════════════════════════ КОРПУС СЕЙФА ═══════════════════════════ */
    const safe = new THREE.Group();
    scene.add(safe);

    const bodyMat = darkSteel({ roughness: 0.52 });
    bodyMat.envMapIntensity = 0.75;
    bodyMat.map = brushedMetal({ base: 62, strength: 22 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.9, 3.6, 2.4, 1, 1, 1), bodyMat);
    body.position.set(0, 0.15, -1.35);
    body.castShadow = quality === 'high';
    body.receiveShadow = quality === 'high';
    safe.add(body);

    // Передняя рама: чуть больше корпуса, с золотистой фаской — «дорогой» сейф
    const frameMat = darkSteel({ roughness: 0.34 });
    frameMat.envMapIntensity = 1.1;
    frameMat.map = brushedMetal({ base: 74, strength: 18 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.14, 3.84, 0.26), frameMat);
    frame.position.set(0, 0.15, -0.14);
    safe.add(frame);

    // Постамент
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(4.3, 0.26, 2.75),
      darkSteel({ roughness: 0.66 })
    );
    plinth.position.set(0, FLOOR_Y + 0.13, -1.35);
    plinth.receiveShadow = quality === 'high';
    safe.add(plinth);

    // Кольцо-обойма вокруг дверного проёма (признак настоящей двери хранилища)
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(DOOR_R + 0.20, 0.155, 14, 72),
      chrome()
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
    const doorMat = darkSteel({ roughness: 0.3 });
    doorMat.envMapIntensity = 1.25;
    doorMat.map = brushedMetal({ base: 86, strength: 20, circular: true });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.x = -HINGE_X;                          // центр двери в мире = 0
    door.castShadow = quality === 'high';
    doorPivot.add(door);

    // Заклёпки по периметру — деталь, по которой сейф узнают мгновенно
    const rivetGeo = new THREE.SphereGeometry(0.055, 14, 10);
    const rivetMat = chrome();
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
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.62, 0.61),
      new THREE.MeshStandardMaterial({
        map: engravedPlate('VAULT', 'DEPOSITARY № 7'),
        metalness: 1, roughness: 0.34, envMapIntensity: 1.5,
        bumpMap: engravedPlate('VAULT', 'DEPOSITARY № 7'), bumpScale: 0.012
      })
    );
    plate.position.set(-HINGE_X, 1.02, halfT + 0.012);
    doorPivot.add(plate);

    /* ═══════════════════════════ БАРАБАНЫ ═══════════════════════════════ */
    // Панель-углубление, в которой стоят барабаны
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(2.86, 1.02, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x0b0d1a, metalness: 0.7, roughness: 0.44, envMapIntensity: 0.8
      })
    );
    panel.position.set(-HINGE_X, DRUM_Y, halfT - 0.03);
    doorPivot.add(panel);

    const panelTrim = new THREE.Mesh(
      new THREE.BoxGeometry(2.98, 1.14, 0.05),
      polishedGold()
    );
    panelTrim.position.set(-HINGE_X, DRUM_Y, halfT - 0.075);
    doorPivot.add(panelTrim);

    /** Один барабан: цилиндр + 10 плашек с цифрами вокруг него. */
    interface Drum {
      group: THREE.Group;
      angle: number;
      target: number | null;
      settled: boolean;
      bezel: THREE.Mesh;
      windowGlow: THREE.Mesh;
    }
    const drums: Drum[] = [];
    const drumBodyGeo = new THREE.CylinderGeometry(DRUM_R, DRUM_R, DRUM_W, 56, 1);
    drumBodyGeo.rotateZ(Math.PI / 2);                    // ось барабана → X
    const drumBodyMat = new THREE.MeshStandardMaterial({
      map: brushedMetal({ base: 118, strength: 30, circular: true }),
      metalness: 1, roughness: 0.3, envMapIntensity: 1.4
    });
    const plateGeo = new THREE.PlaneGeometry(DRUM_W * 0.92, DRUM_R * 1.34);

    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.set(-HINGE_X + DRUM_XS[i], DRUM_Y, halfT + 0.04);
      doorPivot.add(g);

      const body2 = new THREE.Mesh(drumBodyGeo, drumBodyMat);
      g.add(body2);

      // Раскладка плашек — общая функция drumMath.drumPlateTransform: её же
      // проворачивает тест, поэтому знак не может разойтись с формулой угла
      for (let d = 0; d < 10; d++) {
        const place = drumPlateTransform(d, DRUM_R + 0.004);
        const tex = digitPlate(d, { face: '#0b0e20', accent: '#f5c542' });
        const p2 = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({
          map: tex, bumpMap: tex, bumpScale: 0.01,
          metalness: 0.85, roughness: 0.36, envMapIntensity: 1.2
        }));
        p2.position.set(...place.position);
        p2.rotation.x = place.rotationX;
        g.add(p2);
      }

      // Боковые обоймы барабана
      for (const sx of [-1, 1]) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(DRUM_R + 0.018, 0.028, 10, 44),
          polishedGold()
        );
        ring.rotation.y = Math.PI / 2;
        ring.position.x = sx * (DRUM_W / 2);
        g.add(ring);
      }

      // Безель окна чтения: рамка вокруг цифры, обращённой к игроку
      // Свой экземпляр материала на барабан: безели вспыхивают независимо.
      // neon() из lib — это MeshBasicMaterial без emissive, а для bloom нужен
      // именно emissiveIntensity > 1 при toneMapped: false.
      const bezel = new THREE.Mesh(
        new THREE.TorusGeometry(0.30, 0.026, 10, 44),
        new THREE.MeshStandardMaterial({
          color: 0x0a1a24, emissive: 0x22d3ee, emissiveIntensity: 1.2,
          metalness: 0.45, roughness: 0.3, toneMapped: false
        })
      );
      bezel.scale.set(0.86, 1.18, 1);
      bezel.position.set(-HINGE_X + DRUM_XS[i], DRUM_Y, halfT + 0.16);
      doorPivot.add(bezel);

      // Подсветка окна: вспыхивает, когда барабан остановился на цифре
      const windowGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.86, 0.86),
        new THREE.MeshBasicMaterial({
          map: radialGlow('#22d3ee', 0.12), transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0
        })
      );
      windowGlow.position.set(-HINGE_X + DRUM_XS[i], DRUM_Y, halfT + 0.1);
      doorPivot.add(windowGlow);

      drums.push({ group: g, angle: 0, target: null, settled: false, bezel, windowGlow });
    }

    /* ── Штурвал со шкалой: главный признак двери хранилища ─────────────── */
    const wheel = new THREE.Group();
    wheel.position.set(-HINGE_X, -0.86, halfT + 0.1);
    doorPivot.add(wheel);

    const dialDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.66, 64),
      new THREE.MeshStandardMaterial({
        map: dialGraduation(), metalness: 0.95, roughness: 0.32, envMapIntensity: 1.3
      })
    );
    dialDisc.position.z = -0.06;
    wheel.add(dialDisc);

    const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.055, 12, 56), chrome());
    wheel.add(wheelRim);
    const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.16, 32), polishedGold());
    wheelHub.rotation.x = Math.PI / 2;
    wheel.add(wheelHub);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.5, 14), chrome());
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
      const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.62, 0.42), chrome());
      hinge.position.set(HINGE_X + 0.02, DOOR_Y + hy, -0.02);
      safe.add(hinge);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.74, 18), polishedGold());
      pin.position.set(HINGE_X + 0.02, DOOR_Y + hy, 0.16);
      safe.add(pin);
      hingeParts.push(hinge, pin);
    }

    // Ригели: уходят в дверь перед распахиванием
    const bolts: THREE.Mesh[] = [];
    const boltGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.42, 18);
    boltGeo.rotateZ(Math.PI / 2);                        // ось вдоль X
    for (const by of [-0.95, -0.35, 0.55, 1.15]) {
      const b = new THREE.Mesh(boltGeo, chrome());
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
    domeMat0.emissiveIntensity = 1.4;
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
      hingeParts.forEach((o) => { o.visible = false; });
      rivets.forEach((o) => { o.visible = false; });
      // процедурные внутренности заменяет интерьер модели; золотой свет —
      // под Anchor_Light, чтобы бил из настоящего проёма
      interiorParts.forEach((o) => { o.visible = false; });
      const lightAnchor = m.anchors['Anchor_Light'];
      if (lightAnchor) lightAnchor.attach(goldLight);
      modelActive = true;
    });

    scene.add(new THREE.AmbientLight(0x5f5a86, 0.75));

    const key = new THREE.SpotLight(0xfff0cc, 58, 22, Math.PI / 5.2, 0.5, 1.5);
    key.position.set(-3.2, 4.6, 4.6);
    key.target.position.set(0, DOOR_Y, 0);
    if (quality === 'high') {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.bias = -0.0018;
    }
    scene.add(key);
    scene.add(key.target);

    const rim = new THREE.DirectionalLight(0x8b5cf6, 2.3);
    rim.position.set(4.5, 2.2, -3.5);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x22d3ee, 0.9);
    fill.position.set(-4, -1, 3);
    scene.add(fill);
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
        (d.bezel.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + flash[i] * 5;
        d.bezel.scale.set(0.86 + flash[i] * 0.05, 1.18 + flash[i] * 0.05, 1);
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
      beaconLight.intensity = pulse * (alarmOn ? 7 : 1.6);
      const domeMat = beaconDome.material as THREE.MeshPhysicalMaterial;
      domeMat.emissiveIntensity = 0.5 + pulse * (alarmOn ? 3.2 : 0.9);
      beaconSweeper.rotation.z = elapsed * (alarmOn ? 2.4 : 0.5);
      (beaconSweeper.material as THREE.MeshBasicMaterial).opacity = pulse * (alarmOn ? 0.42 : 0.1);
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
        camTarget.set(0.1 + Math.sin(elapsed * 0.7) * 0.05, DRUM_Y + 0.34, 5.35);
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
      const wantFov = phaseNow === 'spinning' ? 36 : openSeq >= 0 ? 38.5 : 40;
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
