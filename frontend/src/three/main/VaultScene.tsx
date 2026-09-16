/**
 * 🏦 ВИТРИНА ХРАНИЛИЩА — герой-сцена онбординга (v4).
 *
 * Фидбек раунда Q: «монеты из сейфа выглядят странно, лучше наполнить сейф
 * красивыми слитками». Концепция: ХРАНИЛИЩЕ, полное золота. Композиция:
 *  - полированный чёрный мраморный подиум с золотым кантом;
 *  - сейф v2 с распахнутой дверью; внутри — ПИРАМИДА ЗОЛОТЫХ СЛИТКОВ
 *    (процедурные, с клеймом «VAULT 999.9»), тёплый луч из проёма;
 *  - пара слитков небрежно лежит на подиуме у сейфа — богатство «выплёскивается»;
 *  - колонны зала и мягкие ореолы для глубины; тёплый свет БЕЗ циана.
 *
 * Монет больше нет вообще: фонтан и стопки удалены — они читались как мусор.
 * Техника: прозрачный фон (сцена встроена в карточку), bloom выключен —
 * свечение спрайтами и аддитивными плоскостями с круглой альфой.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createStageSafe, startLoop, detectQuality } from '../lib/stage';
import { createRng } from '../lib/rng';
import { gold, polishedGold, disposeObject } from '../lib/materials';
import { blackMarble, radialGlow, radialFade, glowSprite, neonRing, ingotStamp } from '../lib/textures';
import { ParticleField } from '../lib/particles';
import { loadModel, disposeModel, acquireRoot } from '../lib/models';

const FLOOR_Y = -1.22;

/* ═══════════════ СЛИТОК ══════════════════════════════════════════════ */

/** Геометрия слитка: трапеция в сечении, лёгкая фаска — как настоящий. */
function buildIngotGeometry(): THREE.ExtrudeGeometry {
  const w = 0.42;   // низ
  const tw = 0.30;  // верх
  const h = 0.15;   // высота
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(tw / 2, h);
  shape.lineTo(-tw / 2, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.62, bevelEnabled: true, bevelThickness: 0.014,
    bevelSize: 0.012, bevelSegments: 2
  });
  geo.translate(0, 0, -0.31); // центр по длине
  return geo;
}

export default function VaultScene({ size = 300 }: { size?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const quality = detectQuality();
    const rng = createRng('vault-hero-showcase');

    const stage = createStageSafe({
      container,
      preset: 'vault',
      quality,
      transparent: true,
      background: null,
      fog: null,
      bloom: 0,
      fov: 40,
      position: [0, 0.34, 5.5],
      exposure: 1.12,
      statsId: 'vault'
    });
    if (!stage) return;
    const { scene, camera } = stage;

    /* ═══════════════ ГЛУБИНА: ореолы и колонны зала ══════════════════════ */
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite('#ff9d2e', 0.5), transparent: true, opacity: 0.46,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    aura.scale.setScalar(8.5);
    aura.position.set(0, 0.2, -2.4);
    scene.add(aura);
    const auraViolet = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite('#7c3aed', 0.5), transparent: true, opacity: 0.26,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    auraViolet.scale.setScalar(10);
    auraViolet.position.set(1.4, 0.7, -3.4);
    scene.add(auraViolet);

    // Колонны зала: мрамор с золотыми поясами, уходят в темноту
    const columnMat = new THREE.MeshStandardMaterial({
      map: blackMarble(), color: 0x8a8a9a, roughness: 0.5, metalness: 0.3, envMapIntensity: 0.5
    });
    const columns: THREE.Group[] = [];
    for (const [cx, cz, s] of [[-3.6, -3.4, 1], [3.7, -3.1, 0.9], [-4.8, -4.6, 1.15], [4.9, -4.8, 1.1]] as const) {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * s, 0.3 * s, 5.2 * s, 24), columnMat);
      shaft.position.y = 2.4 * s;
      g.add(shaft);
      for (const by of [0.12, 4.9 * s]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.3 * s, 0.035, 8, 32), polishedGold());
        band.rotation.x = Math.PI / 2;
        band.position.y = by;
        g.add(band);
      }
      g.position.set(cx, FLOOR_Y, cz);
      scene.add(g);
      columns.push(g);
    }

    /* ═══════════════ ПОЛ ЗАЛА: мрамор, тающий к краям карточки ═══════════
     * Фидбек: «под колоннами нет поверхности». Диск лежит на уровне базы
     * колонн и растворяется радиальной альфой — колонны больше не висят.
     */
    const hallFloor = new THREE.Mesh(
      new THREE.CircleGeometry(11, 72),
      new THREE.MeshStandardMaterial({
        map: blackMarble(), color: 0x3a3a4c, roughness: 0.34, metalness: 0.42,
        envMapIntensity: 0.7, transparent: true, alphaMap: radialFade(),
        depthWrite: true
      })
    );
    hallFloor.rotation.x = -Math.PI / 2;
    hallFloor.position.y = FLOOR_Y - 0.30;
    scene.add(hallFloor);

    /* ═══════════════ ПОДИУМ: полированный мрамор с кантом ════════════════ */
    const marble = new THREE.MeshPhysicalMaterial({
      map: blackMarble(), color: 0xb8b8c8, metalness: 0.42, roughness: 0.16,
      envMapIntensity: 1.35, clearcoat: 0.7, clearcoatRoughness: 0.16
    });
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.72, 0.24, 96), marble);
    podium.position.y = FLOOR_Y - 0.12;
    scene.add(podium);
    const podium2 = new THREE.Mesh(
      new THREE.CylinderGeometry(2.95, 3.2, 0.18, 96),
      new THREE.MeshStandardMaterial({ map: blackMarble(), color: 0x55556a, roughness: 0.4, metalness: 0.35 })
    );
    podium2.position.y = FLOOR_Y - 0.32;
    scene.add(podium2);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(2.51, 0.025, 10, 128), polishedGold());
    trim.rotation.x = Math.PI / 2;
    trim.position.y = FLOOR_Y - 0.005;
    scene.add(trim);
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 7.2),
      new THREE.MeshBasicMaterial({
        map: neonRing('#f5c542', 0.02), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.5
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = FLOOR_Y - 0.225;
    scene.add(ring);

    // Лужа тёплого света на мраморе
    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 4.6),
      new THREE.MeshBasicMaterial({
        map: radialGlow('#ffd76a', 0.05), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.42
      })
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(0.2, FLOOR_Y + 0.012, 0.6);
    scene.add(spill);

    /* ═══════════════ СЕЙФ v2: распахнут, внутри золото ═══════════════════ */
    const safe = new THREE.Group();
    safe.position.y = FLOOR_Y + 0.02;
    safe.rotation.y = -0.34;
    scene.add(safe);

    const goldLight = new THREE.PointLight(0xffc44d, 9, 6.5, 2);
    safe.add(goldLight);

    const shaft = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 3.4, 40, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffca4a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        toneMapped: false
      })
    );
    shaft.rotation.x = Math.PI / 2 - 0.28;
    shaft.position.set(0.1, 0.9, 1.5);
    safe.add(shaft);

    /* ═══════════════ СЛИТКИ: пирамида в сейфе + пара на подиуме ══════════
     * Кладём после загрузки модели — позиция считается от реального бокса
     * интерьера (узел `safe_interior`), поэтому не зависит от нормализации.
     */
    const ingotGeo = buildIngotGeometry();
    const ingotMat = new THREE.MeshPhysicalMaterial({
      color: 0xf0b429, metalness: 1, roughness: 0.2, envMapIntensity: 1.3,
      clearcoat: 0.34, clearcoatRoughness: 0.22
    });
    const stampTex = ingotStamp();
    const stampMat = new THREE.MeshBasicMaterial({
      map: stampTex, transparent: true, toneMapped: false, depthWrite: false
    });
    const stampGeo = new THREE.PlaneGeometry(0.44, 0.15);
    const ingotGroup = new THREE.Group();
    safe.add(ingotGroup);
    /** Верхние точки слитков — источники бликов-искр. */
    const sparkleAnchors: THREE.Vector3[] = [];

    /** Положить слиток; `stamped` — клеймо на верхней грани. */
    const placeIngot = (x: number, y: number, z: number, rotY = 0, rotX = 0, stamped = false): THREE.Mesh => {
      const bar = new THREE.Mesh(ingotGeo, ingotMat);
      bar.position.set(x, y, z);
      bar.rotation.set(rotX, rotY, 0);
      if (stamped) {
        const st = new THREE.Mesh(stampGeo, stampMat);
        st.position.y = 0.152;
        st.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
        bar.add(st);
      }
      ingotGroup.add(bar);
      return bar;
    };

    let cancelled = false;
    let modelHolder: THREE.Group | null = null;
    loadModel('safe.glb', { quality }).then((m) => {
      if (cancelled || !m) return;
      const clone = acquireRoot(m);
      modelHolder = new THREE.Group();
      modelHolder.add(clone);
      modelHolder.scale.setScalar(0.78);
      safe.add(modelHolder);
      modelHolder.updateMatrixWorld(true);
      const doorNode = clone.getObjectByName('safe_door');
      if (doorNode) {
        doorNode.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -1.02);
        doorNode.position.z += 0.16;
      }
      // лоадер уже центрировал X/Z; ставим низ модели на подиум
      modelHolder.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(modelHolder);
      const bottomLocal = safe.worldToLocal(new THREE.Vector3(0, bb.min.y, 0)).y;
      modelHolder.position.y += -0.02 - bottomLocal;
      const lightAnchor = clone.getObjectByName('Anchor_Light');
      if (lightAnchor) lightAnchor.attach(goldLight);
      goldLight.position.set(0, 1.0, -0.4);
      (shaft.material as THREE.MeshBasicMaterial).opacity = 0.15;

      /* ── Наполнение: от бокса интерьера в локальных координатах сейфа ── */
      const interior = clone.getObjectByName('safe_interior');
      const ib = interior
        ? new THREE.Box3().setFromObject(interior)
        : bb.clone();
      const min = safe.worldToLocal(ib.min.clone());
      const max = safe.worldToLocal(ib.max.clone());
      const floorY = min.y + 0.02;
      const frontZ = max.z - 0.42;         // передний ряд у самого проёма
      const rowZ = 0.66;                    // шаг рядов вглубь
      const stepX = 0.46;                   // шаг слитков по X
      const barH = 0.178;                   // высота слитка с фаской

      // Пирамида у проёма: 4 → 3 → 2, второй ряд 3 → 2 за ней.
      // Верхние ярусы сдвинуты на полшага — слитки лежат в ложементах.
      const rows: Array<[number, number, number]> = [
        [4, 0, frontZ], [3, 1, frontZ], [2, 2, frontZ],
        [3, 0, frontZ - rowZ], [2, 1, frontZ - rowZ]
      ];
      for (const [count, layer, z] of rows) {
        const rowW = (count - 1) * stepX;
        for (let i = 0; i < count; i++) {
          const x = -rowW / 2 + i * stepX;
          placeIngot(
            x + rng.spread(0.012),
            floorY + layer * barH,
            z + rng.spread(0.015),
            rng.spread(0.06), 0,
            layer === 0 && Math.abs(x) < 0.8
          );
        }
      }
      // Акцентный слиток набекрень на вершине пирамиды
      placeIngot(0.1, floorY + 2 * barH, frontZ - 0.1, 0.5, 0, true);
      // Два слитка прислонены к задней стенке — ловят луч
      placeIngot(-0.62, floorY + 0.3, min.z + 0.28, 0.2, -1.02, true);
      placeIngot(0.55, floorY + 0.3, min.z + 0.24, -0.3, -1.08, true);

      // Подсветка самой пирамиды
      const pileLight = new THREE.PointLight(0xffd77a, 5, 3.4, 2);
      pileLight.position.set(0, floorY + 0.9, frontZ + 0.2);
      ingotGroup.add(pileLight);

      // Якоря бликов — верхушки передних слитков
      for (const [sx, sy, sz] of [[0, floorY + 3 * barH, frontZ], [-0.7, floorY + barH, frontZ], [0.66, floorY + barH, frontZ - rowZ]] as const) {
        sparkleAnchors.push(new THREE.Vector3(sx, sy + 0.1, sz));
      }
    });

    // Пара слитков на подиуме: богатство «выплёскивается» из хранилища
    const podiumBars = new THREE.Group();
    scene.add(podiumBars);
    const pb1 = new THREE.Mesh(ingotGeo, ingotMat);
    pb1.position.set(2.14, FLOOR_Y + 0.075, 1.12);
    pb1.rotation.y = -0.55;
    const pb1s = new THREE.Mesh(stampGeo, stampMat);
    pb1s.position.y = 0.152;
    pb1s.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    pb1.add(pb1s);
    podiumBars.add(pb1);
    const pb2 = new THREE.Mesh(ingotGeo, ingotMat);
    pb2.position.set(1.96, FLOOR_Y + 0.24, 0.98);
    pb2.rotation.y = -0.34;
    podiumBars.add(pb2);
    const pb3 = new THREE.Mesh(ingotGeo, ingotMat);
    pb3.position.set(-2.24, FLOOR_Y + 0.075, 0.94);
    pb3.rotation.y = 0.8;
    podiumBars.add(pb3);
    sparkleAnchors.push(new THREE.Vector3(2.14, FLOOR_Y + 0.3, 1.12));
    sparkleAnchors.push(new THREE.Vector3(-2.24, FLOOR_Y + 0.24, 0.94));

    /* ═══════════════ СВЕТ: тёплый, без циана ═════════════════════════════ */
    scene.add(new THREE.AmbientLight(0x8a7a66, 0.72));
    const key = new THREE.DirectionalLight(0xffd9a0, 2.6);
    key.position.set(-2.5, 3.5, 3.2);
    scene.add(key);
    // Контровой — глубже и холоднее, светит ИЗ-ЗА сейфа, чтобы золото на
    // переднем плане не окрашивалось в розовый
    const rimViolet = new THREE.DirectionalLight(0x6d4fd6, 1.1);
    rimViolet.position.set(3.2, 2.4, -4.2);
    scene.add(rimViolet);
    // Тёплая подсветка спереди слева — слитки на подиуме остаются золотыми
    const warmFill = new THREE.DirectionalLight(0xffc880, 0.8);
    warmFill.position.set(-3.4, 0.6, 3.6);
    scene.add(warmFill);
    const fillAmber = new THREE.DirectionalLight(0xff9d5c, 0.7);
    fillAmber.position.set(-3, -0.8, 2.2);
    scene.add(fillAmber);

    /* ═══════════════ ЧАСТИЦЫ: пыль в луче и искры на золоте ══════════════ */
    const motes = new ParticleField(quality === 'low' ? 50 : 150, glowSprite('#ffe9a8', 0.18), {
      color: 0xffd76a, size: 0.18, gravity: 0.14, drag: 0.99, opacity: 0.85, scale: 180
    });
    scene.add(motes.points);
    const sparkles = new ParticleField(quality === 'low' ? 26 : 80, glowSprite('#ffffff', 0.5), {
      color: 0xfff6dd, size: 0.12, gravity: -0.04, drag: 0.995, opacity: 0.9, scale: 150
    });
    scene.add(sparkles.points);

    /* ═══════════════ АНИМАЦИЯ ════════════════════════════════════════════ */
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const camTarget = new THREE.Vector3(0, 0.34, 5.5);
    let moteTimer = 0;

    const stopLoop = startLoop(stage, (dt, elapsed) => {
      const a = elapsed * 0.1;
      camTarget.set(Math.sin(a) * 0.8, 0.3 + Math.sin(elapsed * 0.21) * 0.1, 5.45 + Math.cos(a) * 0.3);
      camera.position.lerp(camTarget, 1 - Math.pow(0.02, dt));
      camera.lookAt(0, 0.1 + Math.sin(elapsed * 0.17) * 0.04, 0);

      // Сейф дышит; золото пульсирует
      safe.position.y = FLOOR_Y + 0.02 + Math.sin(elapsed * 0.7) * 0.02;
      safe.rotation.y = -0.34 + Math.sin(elapsed * 0.23) * 0.06;
      const breathe = 0.82 + Math.sin(elapsed * 1.5) * 0.18;
      goldLight.intensity = 9 * breathe;
      (spill.material as THREE.MeshBasicMaterial).opacity = 0.36 * breathe;
      if ((shaft.material as THREE.MeshBasicMaterial).opacity > 0) {
        (shaft.material as THREE.MeshBasicMaterial).opacity = 0.12 * breathe;
      }
      aura.material.opacity = 0.4 + Math.sin(elapsed * 0.9) * 0.05;
      ring.rotation.z = elapsed * 0.1;

      // Пыль в луче из проёма
      moteTimer += dt;
      if (moteTimer > 0.06) {
        moteTimer = 0;
        tmp.set(0.3 + rng.spread(0.5), 0.4 + rng.spread(0.5), 0.8 + rng.spread(0.3));
        tmp2.set(rng.spread(0.3), rng.range(0.1, 0.6), rng.range(0.4, 1.3));
        motes.emit(tmp, tmp2, rng.range(1.4, 2.8), rng.range(0.07, 0.2));
      }
      // Искры на верхушках слитков
      if (sparkleAnchors.length && rng.rand() < dt * 9) {
        const p = sparkleAnchors[rng.int(0, sparkleAnchors.length - 1)];
        tmp.copy(p);
        tmp.x += rng.spread(0.3);
        tmp.z += rng.spread(0.24);
        tmp2.set(rng.spread(0.2), rng.range(0.05, 0.3), rng.spread(0.2));
        sparkles.emit(tmp, tmp2, rng.range(0.35, 0.9), rng.range(0.06, 0.14));
      }
      motes.update(dt);
      sparkles.update(dt);
    });

    stage.render();

    return () => {
      cancelled = true;
      if (modelHolder) safe.remove(modelHolder);
      disposeModel('safe.glb');
      stopLoop();
      motes.dispose();
      sparkles.dispose();
      ingotGeo.dispose();
      ingotMat.dispose();
      stampGeo.dispose();
      stampMat.dispose();
      stampTex.dispose();
      marble.dispose();
      columnMat.dispose();
      disposeObject(safe);
      disposeObject(podiumBars);
      disposeObject(scene);
      stage.dispose();
    };
  }, []);

  return <div ref={ref} style={{ width: '100%', height: size }} />;
}
