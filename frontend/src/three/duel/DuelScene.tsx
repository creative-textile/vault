/**
 * ⚔️ ДУЭЛЬ — 3D-сцена: золотая монета на арене.
 *
 * Прежняя монета была цилиндром с тремя плоскими цветами и пятью белыми
 * шариками («выглядит очень странно»). Здесь — настоящая чеканка:
 *
 *  - Профиль с фаской (LatheGeometry): у монеты есть скруглённый гурт, а не
 *    острый край, поэтому на вращении блик бежит по кромке.
 *  - Две стороны с рисунком (canvas): ОРЁЛ — звезда в лучах, РЕШКА — герб
 *    хранилища; бусины по краю, лавровый венок, надпись VAULT. Та же картинка
 *    работает картой рельефа (bumpMap), поэтому чеканка физически выступает.
 *  - Насечка на гурте (coinEdge) — то, что видно в полёте сбоку.
 *  - Золото PBR с процедурной картой отражений (lib/environment): металл
 *    отражает тёплый софит и пурпурный контровой, а не выглядит жёлтым пластиком.
 *  - Арена: тёмный мрамор с прожилками, два неоновых кольца, постаменты
 *    игроков (золото/циан), прожектор с псевдообъёмным конусом, пыль в луче.
 *  - Камера: облёт на витрине, сопровождение броска, снижение и тряска на
 *    приземлении, устойчивый ракурс на результате.
 *
 * ВАЖНО — анимация по времени, а не по кадрам. Прежняя версия делала
 * `flipProgress += 0.015` каждый кадр: на 120 Гц монета приземлялась вдвое
 * быстрее, на 30 Гц — вдвое медленнее, и результат появлялся, когда монета ещё
 * была в воздухе. Теперь длительность жёстко равна окну экрана (2800 мс в
 * DuelGame), а сторона, которая окажется сверху, детерминирована: полный оборот
 * 2π·k плюс π для решки.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createStageSafe, startLoop, detectQuality } from '../lib/stage';
import { createRng, easeOutCubic } from '../lib/rng';
import { gold, polishedGold, darkSteel, neon, additive, disposeObject } from '../lib/materials';
import { coinFace, coinEdge, brushedMetal, blackMarble, arenaMedallion, nebula, neonRing, radialGlow, radialFade, glowSprite, smokeSprite, lightPillar, engravedPlate } from '../lib/textures';
import { loadModel, disposeModel } from '../lib/models';
import { ParticleField } from '../lib/particles';
import { FLIP_MS, sampleFlip } from './flipMath';

interface Props {
  phase: 'idle' | 'flipping' | 'result';
  result?: 'heads' | 'tails' | null;
  trajectory?: {
    rotation_speed: number;
    height: number;
    bounces: number;
    final_angle: number;
  } | null;
  onFinish?: () => void;
}


const COIN_R = 1.18;
const COIN_T = 0.16;
const FLOOR_Y = -1.15;
/** Положение покоя: нижняя кромка монеты касается пола (монета стоит на ребре). */
const REST_Y = FLOOR_Y + COIN_R + 0.02;
/** На витрине монета парит над пьедесталом света — так она читается как медаль. */
const SHOWCASE_Y = REST_Y + 0.34;

export default function DuelScene({ phase, result, trajectory, onFinish }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ phase, result, trajectory, flipStartedAt: phase === 'flipping' ? performance.now() : 0 });
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  // Переход в 'flipping' фиксируем по времени: сцена не пересоздаётся на props
  useEffect(() => {
    const prev = stateRef.current.phase;
    if (phase === 'flipping' && prev !== 'flipping') {
      stateRef.current.flipStartedAt = performance.now();
    }
    stateRef.current.phase = phase;
    stateRef.current.result = result;
    stateRef.current.trajectory = trajectory;
  }, [phase, result, trajectory]);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const quality = detectQuality();
    const rng = createRng('vault-duel-arena');

    const stage = createStageSafe({
      container,
      preset: 'duel',
      quality,
      background: 0x07050f,
      fog: { color: 0x07050f, density: 0.05 },
      fov: 46,
      position: [0, 1.5, 6.6],
      bloom: quality === 'high' ? 0.78 : quality === 'medium' ? 0.5 : 0,
      bloomRadius: 0.6,
      bloomThreshold: 0.62,
      exposure: 1.1,
      statsId: 'duel'
    });
    if (!stage) return;
    const { scene, camera } = stage;

    /* ══════════════════════════ МОНЕТА ══════════════════════════════════ */
    const coin = new THREE.Group();

    // Профиль с фаской: центр → плоскость → скругление → гурт → скругление → центр
    const bevel = 0.035;
    const pts: THREE.Vector2[] = [];
    const segs = 10;
    pts.push(new THREE.Vector2(0.0001, -COIN_T / 2));
    pts.push(new THREE.Vector2(COIN_R - bevel, -COIN_T / 2));
    for (let i = 1; i <= segs; i++) {                       // нижняя фаска
      const a = (i / segs) * (Math.PI / 2);
      pts.push(new THREE.Vector2(
        COIN_R - bevel + Math.sin(a) * bevel,
        -COIN_T / 2 + bevel - Math.cos(a) * bevel
      ));
    }
    for (let i = segs; i >= 1; i--) {                       // верхняя фаска
      const a = (i / segs) * (Math.PI / 2);
      pts.push(new THREE.Vector2(
        COIN_R - bevel + Math.sin(a) * bevel,
        COIN_T / 2 - bevel + Math.cos(a) * bevel
      ));
    }
    pts.push(new THREE.Vector2(COIN_R - bevel, COIN_T / 2));
    pts.push(new THREE.Vector2(0.0001, COIN_T / 2));

    const bodyGeo = new THREE.LatheGeometry(pts, 96);
    bodyGeo.rotateX(Math.PI / 2);                            // ось монеты → Z (лицом к камере)
    const bodyMat = gold({ roughness: 0.19, envIntensity: 1.75 });
    bodyMat.roughnessMap = brushedMetal({ base: 92, strength: 34, circular: true });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = quality === 'high';
    coin.add(body);

    // Насечка гурта: тонкое кольцо по внешнему краю
    const edgeTex = coinEdge();
    edgeTex.repeat.set(1, 1);
    const edge = new THREE.Mesh(
      new THREE.CylinderGeometry(COIN_R + 0.002, COIN_R + 0.002, COIN_T * 0.62, 96, 1, true),
      new THREE.MeshStandardMaterial({ map: edgeTex, metalness: 1, roughness: 0.28, envMapIntensity: 1.5 })
    );
    edge.rotation.x = Math.PI / 2;
    coin.add(edge);

    /**
     * Стороны монеты. Круги лежат чуть снаружи тела, чтобы не было z-fighting,
     * а bumpMap делает чеканку объёмной: блик идёт по буквам и венку.
     */
    const faceMat = (side: 'heads' | 'tails'): THREE.MeshPhysicalMaterial => {
      const map = coinFace(side);
      return new THREE.MeshPhysicalMaterial({
        map,
        bumpMap: map,
        bumpScale: 0.018,
        metalness: 1,
        roughness: 0.24,
        roughnessMap: brushedMetal({ base: 104, strength: 30, circular: true }),
        envMapIntensity: 1.7,
        clearcoat: 0.42,
        clearcoatRoughness: 0.18
      });
    };
    const faceGeo = new THREE.CircleGeometry(COIN_R - bevel * 0.6, 96);
    // Лицевая сторона (+Z) — ОРЁЛ: при rotation.x = 0 смотрит в камеру
    const heads = new THREE.Mesh(faceGeo, faceMat('heads'));
    heads.position.z = COIN_T / 2 + 0.002;
    heads.castShadow = quality === 'high';
    coin.add(heads);
    // Обратная сторона (−Z) — РЕШКА: видна при rotation.x = π
    const tails = new THREE.Mesh(faceGeo, faceMat('tails'));
    tails.position.z = -COIN_T / 2 - 0.002;
    tails.rotation.y = Math.PI;
    coin.add(tails);

    coin.position.y = 0.1;
    scene.add(coin);

    /* ═══ 3D-МОДЕЛЬ МОНЕТЫ (ТЗ): чеканка из .glb вместо плоских сторон ═══
     * Группу `coin` сцена уже крутит/бросает — модель садится внутрь неё и
     * наследует всю логику фаз. Процедурная монета остаётся фолбэком.
     */
    let cancelled = false;
    const coinHolder = new THREE.Group();
    coin.add(coinHolder);
    loadModel('coin.glb', { quality, targetHeight: COIN_R * 2 }).then((m) => {
      if (cancelled || !m) return;
      coinHolder.add(m.root);
      // лоадер ставит низ на floorY=0 → центр монеты на R выше; возвращаем в 0
      coinHolder.position.y = -COIN_R;
      [body, edge, heads, tails].forEach((o) => { o.visible = false; });
    });

    /* ══════════════════════════ ПАНТЕОН СУДЬБЫ (арена с нуля, R3) ═══════
     * Фидбек: «всё, кроме монеты, не нравится — переделать с нуля».
     * Новый сеттинг: храм судьбы — чёрный мрамор, золотая компасная роза,
     * кольцо каннелированных колонн с жаровнями, открытый космос за ними.
     */
    // Небо: туманность за колоннадой
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 20),
      new THREE.MeshBasicMaterial({ map: nebula(), side: THREE.BackSide, depthWrite: false })
    );
    scene.add(sky);

    // Пол: полированный чёрный мрамор
    const floorMat = new THREE.MeshPhysicalMaterial({
      map: blackMarble(), color: 0xc8c8d4, metalness: 0.46, roughness: 0.14,
      envMapIntensity: 1.25, clearcoat: 0.85, clearcoatRoughness: 0.12
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(7.4, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = quality === 'high';
    scene.add(floor);

    // Золотая компасная роза под монетой — центр композиции
    const medallion = new THREE.Mesh(
      new THREE.CircleGeometry(3.1, 96),
      new THREE.MeshBasicMaterial({
        map: arenaMedallion(), transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      })
    );
    medallion.rotation.x = -Math.PI / 2;
    medallion.position.y = FLOOR_Y + 0.01;
    scene.add(medallion);
    // Физическое золотое кольцо по краю розы — плашка больше не плоская
    const roseRim = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.045, 10, 110), polishedGold());
    roseRim.rotation.x = Math.PI / 2;
    roseRim.position.y = FLOOR_Y + 0.03;
    scene.add(roseRim);

    // Радиальное затемнение пола под ареной — роза получает глубину
    const floorAO = new THREE.Mesh(
      new THREE.CircleGeometry(4.4, 64),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, alphaMap: radialFade(),
        opacity: 0.3, depthWrite: false
      })
    );
    floorAO.rotation.x = -Math.PI / 2;
    floorAO.position.y = FLOOR_Y + 0.016;
    scene.add(floorAO);

    // Контактная тень монеты — якорь, даже когда она левитирует
    const coinShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, alphaMap: radialFade(),
        opacity: 0.4, depthWrite: false
      })
    );
    coinShadow.rotation.x = -Math.PI / 2;
    coinShadow.position.y = FLOOR_Y + 0.02;
    scene.add(coinShadow);

    // Ореол за монетой — главный приз обязан гореть (подхватывается блумом)
    const coinHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlow('#ffcf5e', 0.05), transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    coinHalo.scale.setScalar(4.6);
    coinHalo.position.set(0, 0.5, -1.4);
    scene.add(coinHalo);

    // Неоновые кольца на полу
    const ringOuter = new THREE.Mesh(
      new THREE.PlaneGeometry(15.4, 15.4),
      new THREE.MeshBasicMaterial({
        map: neonRing('#a855f7', 0.035), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.9
      })
    );
    ringOuter.rotation.x = -Math.PI / 2;
    ringOuter.position.y = FLOOR_Y + 0.012;
    scene.add(ringOuter);

    const ringInner = new THREE.Mesh(
      new THREE.PlaneGeometry(7.6, 7.6),
      new THREE.MeshBasicMaterial({
        map: neonRing('#22d3ee', 0.05), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.75
      })
    );
    ringInner.rotation.x = -Math.PI / 2;
    ringInner.position.y = FLOOR_Y + 0.02;
    scene.add(ringInner);

    // Золотой обод арены: физическая геометрия вместо плоского рисунка
    const arenaRim = new THREE.Mesh(new THREE.TorusGeometry(7.42, 0.09, 12, 128), polishedGold());
    arenaRim.rotation.x = Math.PI / 2;
    arenaRim.position.y = FLOOR_Y + 0.05;
    arenaRim.castShadow = quality === 'high';
    scene.add(arenaRim);

    /* ── Колоннада: 10 каннелированных колонн с жаровнями ──────────────── */
    // Каннелюры — геометрией (смещение вершин по синусу угла), а не текстурой:
    // блик реально бежит по граням при облете камеры
    const flutedColumn = (r: number, h: number): THREE.CylinderGeometry => {
      const geo = new THREE.CylinderGeometry(r, r * 1.06, h, 60, 4, false);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = pos.getY(i);
        const ang = Math.atan2(z, x);
        const flute = 1 + Math.cos(ang * 14) * 0.05;
        const entasis = 1 - (y / h + 0.5) * 0.1; // лёгкое утоньшение к верху
        pos.setX(i, x * flute * entasis);
        pos.setZ(i, z * flute * entasis);
      }
      geo.computeVertexNormals();
      return geo;
    };
    const columnMat = new THREE.MeshStandardMaterial({
      map: blackMarble(), color: 0x9a9ab0, roughness: 0.42, metalness: 0.2,
      envMapIntensity: 0.75
    });
    const flames: Array<{ s: THREE.Sprite; ph: number }> = [];
    const COLS = quality === 'low' ? 6 : 10;
    for (let i = 0; i < COLS; i++) {
      const a = (i / COLS) * Math.PI * 2 + Math.PI / COLS;
      const x = Math.cos(a) * 10.6;
      const z = Math.sin(a) * 10.6;
      const col = new THREE.Group();
      const shaft = new THREE.Mesh(flutedColumn(0.52, 6.4), columnMat);
      shaft.position.y = 3.2;
      shaft.castShadow = quality === 'high';
      col.add(shaft);
      // База и капитель: золото
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, 0.3, 24), gold());
      base.position.y = 0.15;
      col.add(base);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.6, 0.34, 24), gold());
      cap.position.y = 6.5;
      col.add(cap);
      // Жаровня: чаша + живой огонь-спрайт
      const bowl = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.1, 10, 24), darkSteel({ roughness: 0.44 }));
      bowl.rotation.x = Math.PI / 2;
      bowl.position.y = 6.78;
      col.add(bowl);
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowSprite('#ffb347', 0.3), transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      }));
      flame.position.y = 7.15;
      flame.scale.setScalar(0.9);
      col.add(flame);
      flames.push({ s: flame, ph: i * 1.7 });
      col.position.set(x, FLOOR_Y, z);
      scene.add(col);
    }

    // Лужа света под монетой
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 6.4),
      new THREE.MeshBasicMaterial({
        map: radialGlow('#ffd76a', 0.06), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.4
      })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = FLOOR_Y + 0.008;
    scene.add(pool);

    /* ── Постаменты игроков: мрамор + золото, цвета идентичности ───────── */
    const podiums: THREE.Group[] = [];
    // Тумбы приглушены: монета — единственный герой кадра
    const podiumMarble = new THREE.MeshStandardMaterial({
      map: blackMarble(), color: 0x4c5066, roughness: 0.45, metalness: 0.35,
      envMapIntensity: 0.6
    });
    const makePodium = (x: number, colorHex: number, glowCss: string, label: string): THREE.Group => {
      const plateTex = engravedPlate(label);
      plateTex.repeat.set(2, 1);
      const g = new THREE.Group();
      // Ярус 1: восьмигранная мраморная плита с золотым кантом
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.08, 0.22, 8), podiumMarble);
      base.position.y = 0.11;
      base.castShadow = quality === 'high';
      base.receiveShadow = quality === 'high';
      g.add(base);
      const baseRim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.03, 8, 8), polishedGold());
      baseRim.rotation.x = Math.PI / 2;
      baseRim.position.y = 0.23;
      g.add(baseRim);

      // Ярус 2: каннелированный мраморный барабан с гравированной лентой
      const shaft = new THREE.Mesh(flutedColumn(0.56, 0.72), podiumMarble);
      shaft.position.y = 0.58;
      shaft.castShadow = quality === 'high';
      g.add(shaft);
      const plate = new THREE.Mesh(
        new THREE.CylinderGeometry(0.635, 0.635, 0.2, 48, 1, true),
        new THREE.MeshStandardMaterial({
          map: plateTex, metalness: 0.82, roughness: 0.34,
          envMapIntensity: 1.1, side: THREE.DoubleSide
        })
      );
      plate.position.y = 0.56;
      g.add(plate);
      // Золотые кольца барабана
      for (const [ry, rr] of [[0.94, 0.6], [0.24, 0.66]] as const) {
        const rimG = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.032, 10, 64), polishedGold());
        rimG.rotation.x = Math.PI / 2;
        rimG.position.y = ry;
        g.add(rimG);
      }

      // Ярус 3: капитель и светящаяся столешница цвета игрока
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.62, 0.14, 24), podiumMarble);
      cap.position.y = 1.0;
      g.add(cap);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.06, 48), neon(colorHex, 1.9));
      top.position.y = 1.1;
      g.add(top);

      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 3.6),
        new THREE.MeshBasicMaterial({
          map: radialGlow(glowCss, 0.1), transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.5
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.02;
      g.add(glow);

      const light = new THREE.PointLight(colorHex, 2.4, 6.5, 2);
      light.position.y = 1.7;
      g.add(light);

      // Световой пилон за постаментом — игрок «подсветлен» как на афише.
      // Спрайт вместо плоскости: билборд всегда смотрит в камеру, поэтому
      // сбоку не видно «срезанных по диагонали» граней
      const pillar = new THREE.Sprite(new THREE.SpriteMaterial({
        map: lightPillar(glowCss), transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      }));
      pillar.scale.set(1.15, 4.6, 1);
      pillar.position.set(0, 2.3, -0.75);
      g.add(pillar);
      g.position.set(x, FLOOR_Y, -0.3);
      scene.add(g);
      podiums.push(g);
      return g;
    };
    makePodium(-2.85, 0xf5c542, '#f5c542', 'СОЗДАТЕЛЬ');
    makePodium(2.85, 0x22d3ee, '#22d3ee', 'СОПЕРНИК');

    /* ── Свет: тёплый прожектор сверху + цветные контровые ─────────────── */
    scene.add(new THREE.AmbientLight(0x6a5aa8, 0.7));

    const spot = new THREE.SpotLight(0xfff0c0, 62, 30, Math.PI / 5.8, 0.95, 1.5);
    spot.position.set(0.6, 8.4, 2.6);
    spot.target.position.set(0, 0, 0);
    if (quality === 'high') {
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0016;
      spot.shadow.camera.near = 1;
      spot.shadow.camera.far = 22;
    }
    scene.add(spot);
    scene.add(spot.target);

    // Псевдообъёмный конус луча: настоящий volumetrics слишком дорог, а
    // аддитивный конус с градиентом даёт тот же «луч прожектора» в пыли
    // Конус луча: у ConeGeometry вершина на +Y, основание на −Y. НЕ вращаем его
    // на π — иначе луч расходился бы ВВЕРХ от пола, а не от прожектора вниз.
    const beamH = 9.4;
    const beamGeo = new THREE.ConeGeometry(2.9, beamH, 40, 1, true);
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffe6a8) }, uOpacity: { value: 0.065 } },
      vertexShader: /* glsl */`
        varying float vFall;
        varying vec3 vNormalV;
        void main() {
          // 0 у вершины (лампа), 1 у основания (пол): ярче там, где свет лёг
          vFall = (4.7 - position.y) / 9.4;
          // normalMatrix даёт вектор в ПРОСТРАНСТВЕ ВИДА — именно то, что нужно
          // для «смотрит ли поверхность поперёк взгляда»
          vNormalV = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFall;
        varying vec3 vNormalV;
        void main() {
          // Светлее к широкому концу и только на силуэте конуса: середину
          // насквозь видеть не должны, иначе луч выглядит стеклянной воронкой
          float edge = 1.0 - abs(dot(normalize(vNormalV), vec3(0.0, 0.0, 1.0)));
          float a = uOpacity * pow(clamp(vFall, 0.0, 1.0), 1.7) * pow(edge, 2.0);
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    // Вершина у самого прожектора (y = 8.4), основание почти у пола (−1.15)
    beam.position.set(0.6, 8.4 - beamH / 2, 2.0);
    beam.rotation.z = -0.06;
    scene.add(beam);

    const rimLight = new THREE.DirectionalLight(0xc026d3, 2.2);
    rimLight.position.set(-5.5, 2.5, -4);
    scene.add(rimLight);
    const fillLight = new THREE.DirectionalLight(0x22d3ee, 1.1);
    fillLight.position.set(5, 1.5, -3);
    scene.add(fillLight);
    const bounceLight = new THREE.PointLight(0xffd76a, 3.2, 9, 2);
    bounceLight.position.set(0, FLOOR_Y + 0.6, 0.8);
    scene.add(bounceLight);

    /* ── Частицы: пыль в луче и дым от приземления ─────────────────────── */
    const dust = new ParticleField(quality === 'low' ? 60 : 170, glowSprite('#fff3d0', 0.1), {
      color: 0xffe6b0, size: 0.14, gravity: 0.02, drag: 0.995, opacity: 0.5, scale: 120
    });
    scene.add(dust.points);

    const impact = new ParticleField(quality === 'low' ? 60 : 180, smokeSprite(), {
      color: 0xd8cdf0, size: 0.9, gravity: 0.5, drag: 0.94,
      blending: THREE.NormalBlending, opacity: 0.45, scale: 260
    });
    scene.add(impact.points);

    const sparks = new ParticleField(quality === 'low' ? 50 : 150, glowSprite('#fff8dd', 0.3), {
      color: 0xffdf8a, size: 0.3, gravity: -2.6, drag: 0.96, opacity: 1, scale: 240
    });
    scene.add(sparks.points);

    // Ударное кольцо приземления + догоняющая вторая волна
    const shock = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.78, 72),
      additive(0xffd76a, 0)
    );
    shock.rotation.x = -Math.PI / 2;
    shock.position.y = FLOOR_Y + 0.03;
    shock.visible = false;
    scene.add(shock);
    const shock2 = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.66, 72),
      additive(0x22d3ee, 0)
    );
    shock2.rotation.x = -Math.PI / 2;
    shock2.position.y = FLOOR_Y + 0.025;
    shock2.visible = false;
    scene.add(shock2);

    // Вспышка на монете в момент касания
    const landFlash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite('#ffe9a8', 0.4), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    landFlash.scale.setScalar(3.4);
    scene.add(landFlash);
    let poolPulse = 0;
    let flashT = -1;
    let shock2T = -1;

    /* ══════════════════════════ АНИМАЦИЯ ════════════════════════════════ */
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const camTarget = new THREE.Vector3(0, 1.5, 6.6);
    let dustTimer = 0;
    let shake = 0;
    let squash = 0;
    let landedNotified = false;
    let shockT = -1;
    let lastFlipPhase: 'idle' | 'flipping' | 'result' = 'idle';
    /** Витринный угол Y на момент старта броска — разматываем, чтобы не было рывка. */
    let entryRotY: number | null = null;
    /** Было ли касание в прошлом кадре: эффект должен сработать один раз. */
    let prevImpact = false;

    const land = (y: number) => {
      shake = Math.min(1, shake + 0.75);
      squash = 1;
      shockT = 0;
      shock.visible = true;
      shock.position.set(0, FLOOR_Y + 0.03, 0);
      // Пыль и искры из-под монеты
      for (let i = 0; i < (quality === 'low' ? 16 : 42); i++) {
        const a = rng.rand() * Math.PI * 2;
        const sp = rng.range(0.9, 3.4);
        tmp.set(Math.cos(a) * 0.2, y, Math.sin(a) * 0.2);
        tmp2.set(Math.cos(a) * sp, rng.range(0.4, 1.9), Math.sin(a) * sp);
        impact.emit(tmp, tmp2, rng.range(0.6, 1.4), rng.range(0.5, 1.2));
      }
      for (let i = 0; i < (quality === 'low' ? 8 : 22); i++) {
        const a = rng.rand() * Math.PI * 2;
        tmp.set(Math.cos(a) * 0.25, y + 0.05, Math.sin(a) * 0.25);
        tmp2.set(Math.cos(a) * rng.range(1.4, 4.2), rng.range(1.2, 3.4), Math.sin(a) * rng.range(1.4, 4.2));
        sparks.emit(tmp, tmp2, rng.range(0.4, 0.9), rng.range(0.2, 0.45));
      }
      bounceLight.intensity = 9;
      poolPulse = 1;
      flashT = 0;
      shock2T = 0;
      landFlash.position.set(0, y + 0.4, 0);
      shock2.visible = false;
    };

    const stopLoop = startLoop(stage, (dt, elapsed) => {
      const s = stateRef.current;
      const phaseNow = s.phase;

      // Кольца и луч живут своей жизнью — кадр никогда не «замерзает»
      ringOuter.rotation.z = elapsed * 0.06;
      ringInner.rotation.z = -elapsed * 0.09;
      (ringInner.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(elapsed * 1.6) * 0.14;
      beamMat.uniforms.uOpacity.value = 0.14 + Math.sin(elapsed * 0.9) * 0.03;
      podiums.forEach((p, i) => {
        p.children.forEach((c) => {
          if ((c as THREE.PointLight).isPointLight) {
            (c as THREE.PointLight).intensity = 2.2 + Math.sin(elapsed * 1.8 + i * 2.1) * 0.6;
          }
        });
      });
      // Жаровни колоннады: живой огонь
      for (const f of flames) {
        const fl = 0.82 + Math.sin(elapsed * 7.3 + f.ph) * 0.12 + Math.sin(elapsed * 13.7 + f.ph * 2.3) * 0.07;
        f.s.scale.set(0.9 * fl, 1.1 * fl, 1);
        f.s.material.opacity = 0.75 + Math.sin(elapsed * 9.1 + f.ph) * 0.15;
      }
      sky.rotation.y = elapsed * 0.006;
      bounceLight.intensity += (3.2 - bounceLight.intensity) * (1 - Math.pow(0.02, dt));
      // Контактная тень монеты: ниже монета — плотнее и крупнее тень
      const coinH = Math.max(0, coin.position.y - REST_Y);
      (coinShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.42 - coinH * 0.24);
      coinShadow.scale.setScalar(Math.max(0.55, 1 - coinH * 0.18));

      // Пыль в луче прожектора
      dustTimer += dt;
      if (dustTimer > 0.14) {
        dustTimer = 0;
        tmp.set(rng.spread(2.1), FLOOR_Y + rng.range(0.2, 4.2), rng.spread(1.6));
        tmp2.set(rng.spread(0.08), rng.range(0.05, 0.22), rng.spread(0.08));
        dust.emit(tmp, tmp2, rng.range(3.5, 7), rng.range(0.08, 0.2));
      }

      /* ── Фаза витрины: монета медленно крутится, показывая обе стороны ── */
      if (phaseNow === 'idle') {
        if (lastFlipPhase !== 'idle') { landedNotified = false; shock.visible = false; }
        coin.rotation.set(0, elapsed * 0.62, 0);
        coin.position.y = SHOWCASE_Y + Math.sin(elapsed * 1.4) * 0.07;
        coin.scale.setScalar(1);
        squash = 0;

        // Медленный облёт: витрина должна показывать арену целиком
        const a = elapsed * 0.17;
        camTarget.set(Math.sin(a) * 1.9, SHOWCASE_Y + 1.0 + Math.sin(elapsed * 0.3) * 0.16, 6.3 + Math.cos(a) * 0.5);
        camera.position.lerp(camTarget, 1 - Math.pow(0.004, dt));
        camera.lookAt(0, SHOWCASE_Y, 0);
        camera.fov += (46 - camera.fov) * 0.05;
        camera.updateProjectionMatrix();
      } else if (phaseNow === 'flipping') {
        if (lastFlipPhase !== 'flipping') {
          landedNotified = false;
          shock.visible = false;
          prevImpact = false;
        }
        const traj = s.trajectory;
        if (!s.flipStartedAt) s.flipStartedAt = performance.now();
        const startedAt = s.flipStartedAt;
        const p = Math.min(1, Math.max(0, (performance.now() - startedAt) / FLIP_MS));
        // Витринное вращение вокруг Y разматывается за первые полсекунды:
        // без этого монета дёргалась в момент старта броска
        if (entryRotY === null) entryRotY = coin.rotation.y % (Math.PI * 2);

        // Траектория и грань считаются общей чистой функцией (flipMath.ts) —
        // она же проверяется тестом, поэтому «показать не ту сторону» нельзя.
        const f = sampleFlip(p, traj, s.result, prevImpact);
        prevImpact = f.impact;
        const y = f.y;

        coin.rotation.x = f.rotX;
        // Наклон вокруг своей оси грань не меняет, но добавляет жизни
        coin.rotation.z = f.rotZ;
        const unwind = (entryRotY ?? 0) * Math.max(0, 1 - p * 6);
        coin.rotation.y = unwind + Math.sin(p * Math.PI) * 0.22;
        coin.position.y = REST_Y + y;

        // Касание пола: пыль, ударное кольцо, тряска камеры — ровно один раз
        if (f.impact && p < 1) land(FLOOR_Y + 0.08);
        if (f.done && !landedNotified) {
          landedNotified = true;
          land(FLOOR_Y + 0.08);
          onFinishRef.current?.();
        }
        squash = Math.max(0, squash - dt * 4.2);
        // Монета обращена к камере диском в плоскости XY: жать по Z (толщине)
        // бессмысленно — сжатие не видно. Жмём по вертикали и раздаём в ширину.
        const k = Math.sin(Math.min(1, squash) * Math.PI);
        coin.scale.set(1 + k * 0.075, 1 - k * 0.095, 1 + k * 0.03);

        // Камера: поднимается за монетой, затем снижается к приземлению
        const lift = Math.min(1.5, y * 0.34);
        const closeness = p > 0.78 ? (p - 0.78) / 0.22 : 0;
        camTarget.set(
          Math.sin(p * 1.2) * 0.5,
          1.1 + lift * 0.55 - closeness * 0.7,
          6.4 - closeness * 1.5
        );
        camera.position.lerp(camTarget, 1 - Math.pow(0.002, dt));
        camera.lookAt(0, REST_Y + y * (p > 0.7 ? 0.55 : 0.8), 0);
        const fov = 46 + Math.min(6, y * 1.1) - closeness * 4;
        camera.fov += (fov - camera.fov) * (1 - Math.pow(0.02, dt));
        camera.updateProjectionMatrix();
      } else {
        /* ── Результат: монета стоит нужной гранью к камере, лёгкое дыхание ── */
        const wantTails = s.result === 'tails';
        const targetX = wantTails ? Math.PI : 0;
        // После броска rotation.x = 2π·k (+π) — численно не 0/π. Приравниваем
        // сразу на входе в фазу: 6π визуально неотличимо от 0, а lerp иначе
        // начал бы отматывать обороты назад.
        if (lastFlipPhase !== 'result') {
          coin.rotation.x = targetX;
          coin.rotation.z = 0;
          entryRotY = null;
        }
        coin.rotation.y = Math.sin(elapsed * 0.5) * 0.14;
        coin.position.y += (REST_Y - coin.position.y) * (1 - Math.pow(0.002, dt));
        squash = Math.max(0, squash - dt * 3);
        const k2 = Math.sin(Math.min(1, squash) * Math.PI);
        coin.scale.set(1 + k2 * 0.06, 1 - k2 * 0.08, 1);

        // Прожектор «дышит» на результате — акцент на исходе
        spot.intensity = 62 + Math.sin(elapsed * 2.2) * 8;

        camTarget.set(1.15, REST_Y + 1.0, 5.5);
        camera.position.lerp(camTarget, 1 - Math.pow(0.006, dt));
        camera.lookAt(0, REST_Y + 0.05, 0);
        camera.fov += (44 - camera.fov) * 0.05;
        camera.updateProjectionMatrix();
      }

      /* ── Эффекты приземления ─────────────────────────────────────────── */
      poolPulse = Math.max(0, poolPulse - dt * 2.2);
      (pool.material as THREE.MeshBasicMaterial).opacity = 0.4 + poolPulse * 0.45;
      if (flashT >= 0) {
        flashT += dt;
        const k = Math.max(0, 1 - flashT / 0.35);
        landFlash.material.opacity = k * k * 0.9;
        landFlash.scale.setScalar(3.4 + flashT * 6);
        if (k <= 0.01) flashT = -1;
      }
      if (shock2T >= 0) {
        shock2T += dt;
        if (shock2T > 0.09) {
          shock2.visible = true;
          const q = Math.max(0, 1 - (shock2T - 0.09) / 0.7);
          (shock2.material as THREE.MeshBasicMaterial).opacity = q * 0.6;
          shock2.scale.setScalar(1 + (shock2T - 0.09) * 9);
          if (q <= 0.01) shock2T = -1;
        }
      }
      if (shockT >= 0) {
        shockT += dt;
        const k = Math.min(1, shockT / 0.62);
        (shock.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
        shock.scale.setScalar(1 + easeOutCubic(k) * 5.4);
        if (k >= 1) { shock.visible = false; shockT = -1; }
      }

      dust.update(dt);
      impact.update(dt);
      sparks.update(dt);

      if (shake > 0) {
        shake = Math.max(0, shake - dt * 2.1);
        camera.position.x += rng.spread(shake * 0.22);
        camera.position.y += rng.spread(shake * 0.18);
      }

      lastFlipPhase = phaseNow;
    });

    stage.render();

    return () => {
      stopLoop();
      dust.dispose(); impact.dispose(); sparks.dispose();
      cancelled = true;
      disposeModel('coin.glb');
      disposeObject(coin);
      disposeObject(scene);
      beamGeo.dispose(); beamMat.dispose();
      stage.dispose();
    };
  }, []);

  return <div ref={ref} className="three-container" />;
}
