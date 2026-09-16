/**
 * 🏦 ВИТРИНА ХРАНИЛИЩА — герой-сцена онбординга (v3, переписана с нуля).
 *
 * Первое, что видит игрок — сцена обязана интриговать. Композиция:
 *  - полированный чёрный мраморный подиум с золотым кантом — отражает сейф;
 *  - настоящий сейф v2 с распахнутой дверью: золото внутри, луч света из
 *    проёма с пылью, свет под Anchor_Light;
 *  - ФОНТАН МОНЕТ из проёма — дуги к зрителю, всегда ПЕРЕД сейфом (не сквозь
 *    дверь), плюс стопки монет на подиуме;
 *  - колонны зала и мягкие ореолы для глубины; тёплый свет БЕЗ циана —
 *    золото не зеленеет.
 *
 * Техника: прозрачный фон (сцена встроена в карточку), bloom выключен —
 * свечение спрайтами и аддитивными плоскостями с круглой альфой.
 * Без WebGL/модели — подиум, ореолы и стопки монет: достойно даже в фолбэке.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createStageSafe, startLoop, detectQuality } from '../lib/stage';
import { createRng } from '../lib/rng';
import { gold, polishedGold, disposeObject } from '../lib/materials';
import { blackMarble, radialGlow, glowSprite, neonRing, coinFace } from '../lib/textures';
import { ParticleField } from '../lib/particles';
import { loadModel, disposeModel, acquireRoot } from '../lib/models';

const FLOOR_Y = -1.22;

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

    /* ═══════════════ СЕЙФ v2: распахнут, золото внутри ═══════════════════ */
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
    });

    /* ═══════════════ МОНЕТЫ: фонтан из проёма + стопки ═══════════════════
     * Дуги всегда впереди сейфа (z ≥ 0.8) и правее раскрытой двери — монеты
     * физически не могут пересечь дверцу. Тёплый PBR без циана — без зелени.
     */
    const coinGeo = new THREE.CylinderGeometry(0.155, 0.155, 0.028, 40);
    coinGeo.rotateX(Math.PI / 2);
    const coinMatHeads = new THREE.MeshPhysicalMaterial({
      map: coinFace('heads'), metalness: 1, roughness: 0.26, envMapIntensity: 1.15, clearcoat: 0.3
    });
    const coinMatTails = new THREE.MeshPhysicalMaterial({
      map: coinFace('tails'), metalness: 1, roughness: 0.26, envMapIntensity: 1.15, clearcoat: 0.3
    });
    const coinSide = gold({ roughness: 0.24 });

    interface Fountain { mesh: THREE.Mesh; ox: number; vy: number; vz: number; vx: number; ph: number; spin: number; }
    const fountains: Fountain[] = [];
    const FN = quality === 'low' ? 7 : 12;
    for (let i = 0; i < FN; i++) {
      const mesh = new THREE.Mesh(coinGeo, [coinSide, i % 2 ? coinMatHeads : coinMatTails, i % 2 ? coinMatTails : coinMatHeads]);
      scene.add(mesh);
      fountains.push({
        mesh,
        ox: rng.range(-0.15, 0.5),
        vx: rng.range(0.25, 0.8),
        vy: rng.range(0.9, 1.5),
        vz: rng.range(1.5, 2.3),
        ph: i / FN,
        spin: rng.range(2, 5) * (rng.rand() < 0.5 ? -1 : 1)
      });
    }
    // стартовая точка фонтана — у проёма, в мировых координатах сцены
    const emit = new THREE.Vector3(0.35, 0.35, 0.85);

    // Стопки монет на подиуме — «богатство лежит здесь»
    const stacks: THREE.Mesh[] = [];
    for (const [sx, sz, n, tilt] of [[1.55, 0.9, 6, 0], [1.85, 0.55, 4, 0.1], [1.3, 1.25, 5, -0.08], [-1.7, 0.9, 4, 0.06]] as const) {
      for (let i = 0; i < n; i++) {
        const c = new THREE.Mesh(coinGeo, [coinSide, coinMatHeads, coinMatTails]);
        c.position.set(sx + Math.sin(i * 5.1) * 0.015, FLOOR_Y + 0.016 + i * 0.03, sz + Math.sin(i * 3.7) * 0.015);
        c.rotation.y = i * 0.7;
        c.rotation.x = tilt * (i === n - 1 ? 3 : 0.2);
        scene.add(c);
        stacks.push(c);
      }
    }

    /* ═══════════════ СВЕТ: тёплый, без циана ═════════════════════════════ */
    scene.add(new THREE.AmbientLight(0x7a6a9a, 0.7));
    const key = new THREE.DirectionalLight(0xffd9a0, 2.6);
    key.position.set(-2.5, 3.5, 3.2);
    scene.add(key);
    const rimViolet = new THREE.DirectionalLight(0x8b5cf6, 1.7);
    rimViolet.position.set(3.5, 1.6, -2.8);
    scene.add(rimViolet);
    const fillAmber = new THREE.DirectionalLight(0xff9d5c, 0.7);
    fillAmber.position.set(-3, -0.8, 2.2);
    scene.add(fillAmber);

    /* ═══════════════ ЧАСТИЦЫ: пыль в луче и блики на монетах ═════════════ */
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

      // Фонтан монет: дуга из проёма к зрителю, появление/растворение масштабом
      for (const f of fountains) {
        const t = (elapsed * 0.34 + f.ph) % 1;
        const life = Math.sin(t * Math.PI);                 // 0→1→0
        const tt = t * 2.6;
        tmp.set(
          emit.x + f.ox + f.vx * tt,
          emit.y + f.vy * tt - 1.9 * tt * tt,
          emit.z + f.vz * tt
        );
        f.mesh.position.copy(tmp);
        f.mesh.rotation.y = elapsed * f.spin + f.ph * 7;
        f.mesh.rotation.x = Math.sin(elapsed * 1.3 + f.ph * 9) * 0.5;
        const s = 0.001 + life * (0.85 + 0.3 * Math.sin(f.ph * 20));
        f.mesh.scale.setScalar(Math.max(0.001, s));
        f.mesh.visible = life > 0.02;
      }

      // Пыль из проёма и блики на летящих монетах
      moteTimer += dt;
      if (moteTimer > 0.06) {
        moteTimer = 0;
        tmp.set(0.3 + rng.spread(0.5), 0.4 + rng.spread(0.5), 0.8 + rng.spread(0.3));
        tmp2.set(rng.spread(0.3), rng.range(0.1, 0.6), rng.range(0.4, 1.3));
        motes.emit(tmp, tmp2, rng.range(1.4, 2.8), rng.range(0.07, 0.2));
      }
      if (rng.rand() < dt * 8) {
        const f = fountains[rng.int(0, fountains.length - 1)];
        tmp.copy(f.mesh.position);
        tmp2.set(rng.spread(0.3), rng.range(0.1, 0.4), rng.spread(0.3));
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
      coinGeo.dispose();
      coinMatHeads.dispose();
      coinMatTails.dispose();
      coinSide.dispose();
      marble.dispose();
      columnMat.dispose();
      disposeObject(safe);
      disposeObject(scene);
      stage.dispose();
    };
  }, []);

  return <div ref={ref} style={{ width: '100%', height: size }} />;
}
