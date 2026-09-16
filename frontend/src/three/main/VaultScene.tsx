/**
 * 🏦 ВИТРИНА ХРАНИЛИЩА — герой-сцена онбординга и главного экрана (v2).
 *
 * Первое, что видит игрок, поэтому сцена продаёт продукт: настоящая модель
 * сейфа (та же, что в зале взлома) с распахнутой дверью и золотом внутри,
 * луч света из проёма с пылью, монеты-валюта кольцом ПЕРЕД сейфом (не сквозь
 * дверь), двухъярусный подиум с неоновыми кольцами.
 *
 * v2 по фидбеку: убраны аддитивные «квадратные» ореолы (свечение теперь
 * круглыми спрайтами), монеты больше не пересекают дверь, интерьер сейфа —
 * настоящий (модель v2 со сквозным проёмом), свет из проёма — под Anchor_Light.
 *
 * Техника: ПРОЗРАЧНЫЙ фон (сцена встроена в карточку онбординга), bloom
 * выключен (composer съедает альфу) — ореолы спрайтами и аддитивными
 * плоскостями с круглой альфой. createStageSafe: без WebGL онбординг остаётся
 * читаемым.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createStageSafe, startLoop, detectQuality } from '../lib/stage';
import { createRng } from '../lib/rng';
import { gold, polishedGold, disposeObject } from '../lib/materials';
import { brushedMetal, radialGlow, glowSprite, neonRing, coinFace } from '../lib/textures';
import { ParticleField } from '../lib/particles';
import { loadModel, disposeModel, acquireRoot } from '../lib/models';

const FLOOR_Y = -1.22;
const HINGE_X = -1.06;

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
      bloom: 0,                                  // composer съедает альфу
      fov: 40,
      position: [0, 0.34, 5.5],
      exposure: 1.12,
      statsId: 'vault'
    });
    if (!stage) return;
    const { scene, camera } = stage;

    /* ═══════════════ МЯГКИЙ ОРЕОЛ — круглый спрайт, не квадрат ═══════════ */
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite('#ff9d2e', 0.5), transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    aura.scale.setScalar(8.5);
    aura.position.set(0, 0.15, -2.2);
    scene.add(aura);
    const auraViolet = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite('#7c3aed', 0.5), transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    auraViolet.scale.setScalar(10.5);
    auraViolet.position.set(0.6, 0.5, -3.1);
    scene.add(auraViolet);

    /* ═══════════════════════════ ПОДИУМ ══════════════════════════════════ */
    const podiumTex = brushedMetal({ base: 40, strength: 20, circular: true });
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(2.05, 2.25, 0.22, 72),
      new THREE.MeshStandardMaterial({
        map: podiumTex, color: 0x2b2c42, metalness: 0.72, roughness: 0.36, envMapIntensity: 0.8
      })
    );
    podium.position.y = FLOOR_Y - 0.11;
    scene.add(podium);
    // вторая, нижняя ступень — подиум читается как постамент, а не блин
    const podium2 = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.72, 0.16, 72),
      new THREE.MeshStandardMaterial({ color: 0x191a2c, metalness: 0.6, roughness: 0.5 })
    );
    podium2.position.y = FLOOR_Y - 0.3;
    scene.add(podium2);
    // золотой кант между ступенями
    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(2.06, 0.022, 10, 96),
      polishedGold()
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = FLOOR_Y - 0.21;
    scene.add(trim);

    const podiumRing = new THREE.Mesh(
      new THREE.PlaneGeometry(5.4, 5.4),
      new THREE.MeshBasicMaterial({
        map: neonRing('#22d3ee', 0.022), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.85
      })
    );
    podiumRing.rotation.x = -Math.PI / 2;
    podiumRing.position.y = FLOOR_Y + 0.005;
    scene.add(podiumRing);

    const podiumRing2 = new THREE.Mesh(
      new THREE.PlaneGeometry(6.6, 6.6),
      new THREE.MeshBasicMaterial({
        map: neonRing('#a855f7', 0.018), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.55
      })
    );
    podiumRing2.rotation.x = -Math.PI / 2;
    podiumRing2.position.y = FLOOR_Y - 0.215;
    scene.add(podiumRing2);

    // Лужа золотого света, вытекшего из сейфа (круглая альфа — без квадрата)
    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 4.4),
      new THREE.MeshBasicMaterial({
        map: radialGlow('#ffd76a', 0.05), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.5
      })
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(0.15, FLOOR_Y + 0.008, 0.5);
    scene.add(spill);

    /* ═══════════════════════ СЕЙФ: модель v2 ═════════════════════════════
     * Та же модель, что в зале взлома (кэш общий — файл качается один раз).
     * Клон с позой распахнутой двери; интерьер настоящий, свет — под якорь.
     * Пока модель едет — показываем только подиум и ореол (не процедурный
     * «квадратный» сейф: первое впечатление не должно быть халтурным).
     */
    const safe = new THREE.Group();
    safe.position.y = 0.06;
    safe.rotation.y = -0.30;                      // трёхчетвертной ракурс
    scene.add(safe);

    let cancelled = false;
    let modelHolder: THREE.Group | null = null;
    const goldLight = new THREE.PointLight(0xffc44d, 9, 6.5, 2);
    goldLight.position.set(0, -0.1, -0.2);
    safe.add(goldLight);

    // Луч из проёма: конус аддитивного золота к зрителю
    const shaft = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 3.4, 40, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffca4a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        toneMapped: false
      })
    );
    shaft.rotation.x = Math.PI / 2 - 0.28;
    shaft.position.set(0.1, -0.1, 1.5);
    safe.add(shaft);

    loadModel('safe.glb', { quality }).then((m) => {
      if (cancelled || !m) return;
      const clone = acquireRoot(m);
      modelHolder = new THREE.Group();
      modelHolder.add(clone);
      modelHolder.scale.setScalar(0.72);          // витрина компактнее взлома
      safe.add(modelHolder);
      modelHolder.updateMatrixWorld(true);
      const doorNode = clone.getObjectByName('safe_door');
      if (doorNode) {
        doorNode.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -1.02);
        doorNode.position.z += 0.16;
      }
      let hingeNode = clone.getObjectByName('safe');
      if (!hingeNode || hingeNode === clone) {
        hingeNode = clone.children.find((c) => c.name === 'safe') ?? clone;
      }
      const hv = new THREE.Vector3();
      hingeNode.getWorldPosition(hv);
      const want = new THREE.Vector3(HINGE_X, 0, 0.26);
      safe.updateMatrixWorld(true);
      const delta = safe.worldToLocal(want.clone()).sub(safe.worldToLocal(hv.clone()));
      modelHolder.position.add(delta);
      const lightAnchor = clone.getObjectByName('Anchor_Light');
      if (lightAnchor) lightAnchor.attach(goldLight);
      (shaft.material as THREE.MeshBasicMaterial).opacity = 0.16;
    });

    /* ═══════════ МОНЕТЫ: кольцо ПЕРЕД сейфом — не сквозь дверь ═══════════ */
    const coinR = 0.155;
    const coinGeo = new THREE.CylinderGeometry(coinR, coinR, 0.028, 40);
    coinGeo.rotateX(Math.PI / 2);                  // плоскость монеты ⟂ Z
    const coinMats = [
      new THREE.MeshPhysicalMaterial({
        map: coinFace('heads'), metalness: 1, roughness: 0.22, envMapIntensity: 1.8, clearcoat: 0.4
      }),
      new THREE.MeshPhysicalMaterial({
        map: coinFace('tails'), metalness: 1, roughness: 0.22, envMapIntensity: 1.8, clearcoat: 0.4
      })
    ];
    const coinSide = gold({ roughness: 0.2 });

    interface Orbit { mesh: THREE.Mesh; radius: number; speed: number; phase: number; yBase: number; spin: number; }
    const orbits: Orbit[] = [];
    const COUNT = quality === 'low' ? 7 : 13;
    for (let i = 0; i < COUNT; i++) {
      const mesh = new THREE.Mesh(coinGeo, [coinSide, coinMats[i % 2], coinMats[(i + 1) % 2]]);
      const o: Orbit = {
        mesh,
        radius: 1.15 + rng.range(0, 0.55),
        speed: rng.range(0.16, 0.4) * (rng.rand() < 0.3 ? -1 : 1),
        phase: rng.rand() * Math.PI * 2,
        yBase: rng.range(-0.35, 0.85),
        spin: rng.range(0.7, 2.6)
      };
      scene.add(mesh);
      orbits.push(o);
    }
    // кольцо лежит в наклонённой плоскости ПЕРЕД сейфом (z > 1.15): дверь и
    // корпус остаются чистыми
    const ringTilt = 0.32;
    const orbitPos = (t: number, o: Orbit, out: THREE.Vector3) => {
      const x = Math.cos(t) * o.radius;
      const z = Math.sin(t) * o.radius;
      out.set(
        0.45 + x,
        o.yBase + z * Math.sin(ringTilt) * 0.6 + Math.sin(t * 1.7) * 0.1,
        1.75 + z * Math.cos(ringTilt) * 0.45
      );
    };

    /* ═══════════════════════════ СВЕТ ════════════════════════════════════ */
    scene.add(new THREE.AmbientLight(0x6b6398, 0.95));
    const key = new THREE.DirectionalLight(0xfff1cd, 2.5);
    key.position.set(-2.6, 3.4, 3.6);
    scene.add(key);
    const rimViolet = new THREE.DirectionalLight(0x8b5cf6, 2.1);
    rimViolet.position.set(3.4, 1.4, -2.6);
    scene.add(rimViolet);
    const rimCyan = new THREE.DirectionalLight(0x22d3ee, 1.15);
    rimCyan.position.set(-3.2, -0.6, 1.4);
    scene.add(rimCyan);

    /* ═══════════════════════════ ЧАСТИЦЫ ═════════════════════════════════ */
    const motes = new ParticleField(quality === 'low' ? 55 : 160, glowSprite('#ffe9a8', 0.18), {
      color: 0xffd76a, size: 0.19, gravity: 0.16, drag: 0.99, opacity: 0.85, scale: 180
    });
    scene.add(motes.points);

    const sparkles = new ParticleField(quality === 'low' ? 30 : 90, glowSprite('#ffffff', 0.5), {
      color: 0xfff6dd, size: 0.13, gravity: -0.05, drag: 0.995, opacity: 0.9, scale: 150
    });
    scene.add(sparkles.points);

    /* ═══════════════════════════ АНИМАЦИЯ ════════════════════════════════ */
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const camTarget = new THREE.Vector3(0, 0.34, 5.5);
    let moteTimer = 0;

    const stopLoop = startLoop(stage, (dt, elapsed) => {
      const a = elapsed * 0.11;
      camTarget.set(Math.sin(a) * 0.85, 0.34 + Math.sin(elapsed * 0.21) * 0.12, 5.45 + Math.cos(a) * 0.35);
      camera.position.lerp(camTarget, 1 - Math.pow(0.02, dt));
      camera.lookAt(0, 0.05 + Math.sin(elapsed * 0.17) * 0.04, 0);

      // Сейф дышит
      safe.position.y = 0.06 + Math.sin(elapsed * 0.7) * 0.028;
      safe.rotation.y = -0.30 + Math.sin(elapsed * 0.23) * 0.075;

      // Свет изнутри пульсирует — золото «дышит»
      const breathe = 0.82 + Math.sin(elapsed * 1.5) * 0.18;
      goldLight.intensity = 9 * breathe;
      (spill.material as THREE.MeshBasicMaterial).opacity = 0.42 * breathe;
      (shaft.material as THREE.MeshBasicMaterial).opacity =
        (shaft.material as THREE.MeshBasicMaterial).opacity > 0 ? 0.13 * breathe : 0;
      aura.material.opacity = 0.42 + Math.sin(elapsed * 0.9) * 0.06;
      podiumRing.rotation.z = elapsed * 0.16;
      podiumRing2.rotation.z = -elapsed * 0.11;
      (podiumRing.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(elapsed * 1.3) * 0.16;

      // Монеты кольцом перед сейфом
      for (const o of orbits) {
        const t = elapsed * o.speed + o.phase;
        orbitPos(t, o, o.mesh.position);
        o.mesh.rotation.y = elapsed * o.spin + o.phase;
        o.mesh.rotation.x = Math.sin(t) * 0.5;
        const depth = (o.mesh.position.z + 1.4) / 2.8;
        o.mesh.scale.setScalar(0.86 + Math.max(0, Math.min(1, depth)) * 0.2);
      }

      // Золотая пыль вытекает из проёма вдоль луча
      moteTimer += dt;
      if (moteTimer > 0.06) {
        moteTimer = 0;
        tmp.set(rng.spread(0.55), rng.range(-0.55, 0.6), 0.2 + rng.spread(0.25));
        tmp2.set(rng.spread(0.34), rng.range(0.16, 0.72), rng.range(0.5, 1.5));
        motes.emit(tmp, tmp2, rng.range(1.6, 3.2), rng.range(0.08, 0.22));
      }
      if (rng.rand() < dt * 7) {
        const o = orbits[rng.int(0, orbits.length - 1)];
        tmp.copy(o.mesh.position);
        tmp2.set(rng.spread(0.3), rng.range(0.1, 0.5), rng.spread(0.3));
        sparkles.emit(tmp, tmp2, rng.range(0.4, 1.0), rng.range(0.07, 0.16));
      }
      motes.update(dt);
      sparkles.update(dt);
    });

    stage.render();

    return () => {
      cancelled = true;
      if (modelHolder) safe.remove(modelHolder);   // клон делит геометрию с кэшем
      disposeModel('safe.glb');
      stopLoop();
      motes.dispose();
      sparkles.dispose();
      coinGeo.dispose();
      coinMats.forEach((m) => m.dispose());
      disposeObject(safe);
      disposeObject(scene);
      stage.dispose();
    };
  }, []);

  return <div ref={ref} style={{ width: '100%', height: size }} />;
}
