/**
 * 🏦 ВИТРИНА ХРАНИЛИЩА — герой-сцена онбординга и главного экрана.
 *
 * Это первое, что видит игрок, поэтому задача сцены — продать: открытый сейф,
 * из которого льётся золотой свет, слитки, монеты на орбитах и пыль в луче.
 *
 * Прежняя версия — серый ящик с торусом и четырьмя шариками, десять жёлтых
 * цилиндров по полу. Никакого «дорогого казино» в ней не было.
 *
 * Технические решения:
 *  - ПРОЗРАЧНЫЙ фон (transparent + background: null): сцена встроена в карточку
 *    онбординга и не должна перекрывать градиент страницы чёрным квадратом.
 *  - Bloom поэтому ВЫКЛЮЧЕН: EffectComposer рендерит в собственную цель и
 *    прозрачность теряется — фон стал бы чёрным. Свечение сделано аддитивными
 *    плоскостями (radialGlow/neonRing) — они честно смешиваются с альфой и
 *    дают тот же эффект ореола дешевле.
 *  - Туман тоже выключен: FogExp2 тянет цвет к своему, и на прозрачном фоне
 *    появился бы серый ореол вокруг сейфа.
 *  - Дверь с фаской (LatheGeometry), заклёпки, штурвал, петли — тот же набор
 *    признаков сейфа, что и в SafeCrackScene: оба экрана должны выглядеть
 *    одним продуктом.
 *  - createStageSafe: без WebGL онбординг остаётся читаемым (вернётся null).
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createStageSafe, startLoop, detectQuality } from '../lib/stage';
import { createRng } from '../lib/rng';
import { gold, polishedGold, chrome, darkSteel, disposeObject } from '../lib/materials';
import { brushedMetal, radialGlow, glowSprite, neonRing, coinFace } from '../lib/textures';
import { ParticleField } from '../lib/particles';
import { loadModel, disposeModel, acquireRoot } from '../lib/models';

const FLOOR_Y = -1.22;
const DOOR_R = 1.02;
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
      bloom: 0,                                  // см. шапку: composer съедает альфу
      fov: 40,
      position: [0, 0.34, 5.5],
      exposure: 1.12,
      statsId: 'vault'
    });
    if (!stage) return;
    const { scene, camera } = stage;

    /* ═══════════════════ ОРЕОЛ ЗА СЕЙФОМ (вместо bloom) ═════════════════ */
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(7.4, 7.4),
      new THREE.MeshBasicMaterial({
        map: radialGlow('#ffb52e', 0.02), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.42
      })
    );
    halo.position.set(0, 0.1, -1.9);
    scene.add(halo);

    const haloViolet = new THREE.Mesh(
      new THREE.PlaneGeometry(8.6, 8.6),
      new THREE.MeshBasicMaterial({
        map: radialGlow('#7c3aed', 0.02), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.3
      })
    );
    haloViolet.position.set(0, 0.1, -2.6);
    scene.add(haloViolet);

    /* ═══════════════════════════ ПОДИУМ ═════════════════════════════════ */
    const podiumTex = brushedMetal({ base: 40, strength: 20, circular: true });
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(2.05, 2.25, 0.22, 64),
      new THREE.MeshStandardMaterial({
        map: podiumTex, color: 0x2b2c42, metalness: 0.72, roughness: 0.36, envMapIntensity: 0.8
      })
    );
    podium.position.y = FLOOR_Y - 0.11;
    scene.add(podium);

    // Неоновое кольцо по кромке подиума
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
    podiumRing2.position.y = FLOOR_Y + 0.002;
    scene.add(podiumRing2);

    // Лужа золотого света, вытекшего из сейфа
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

    /* ═══════════════════════════ КОРПУС СЕЙФА ═══════════════════════════ */
    const safe = new THREE.Group();
    safe.position.y = 0.06;
    safe.rotation.y = -0.30;                      // трёхчетвертной ракурс
    scene.add(safe);

    const bodyMat = darkSteel({ roughness: 0.44 });
    bodyMat.envMapIntensity = 0.85;
    bodyMat.map = brushedMetal({ base: 66, strength: 22 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.34, 1.6), bodyMat);
    body.position.set(0, 0, -0.72);
    safe.add(body);

    const frameMat = darkSteel({ roughness: 0.3 });
    frameMat.envMapIntensity = 1.15;
    frameMat.map = brushedMetal({ base: 80, strength: 18 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.72, 2.56, 0.2), frameMat);
    frame.position.set(0, 0, 0.12);
    safe.add(frame);

    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(DOOR_R + 0.14, 0.115, 14, 64),
      chrome()
    );
    collar.position.z = 0.2;
    safe.add(collar);

    /* ── Внутренности: золото, которое и продаёт игру ───────────────────── */
    const inner = new THREE.Group();
    inner.position.z = -0.55;
    safe.add(inner);

    const cavity = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR_R * 1.86, DOOR_R * 1.86, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x241803, roughness: 0.88, metalness: 0.15, side: THREE.BackSide })
    );
    inner.add(cavity);

    const innerGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 2.9),
      new THREE.MeshBasicMaterial({
        map: radialGlow('#ffca4a', 0.03), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.95
      })
    );
    innerGlow.position.z = -0.42;
    inner.add(innerGlow);

    const barGeo = new THREE.BoxGeometry(0.4, 0.15, 0.23);
    const barMat = polishedGold();
    const bars: THREE.Mesh[] = [];
    for (let row = 0; row < 3; row++) {
      const n = 3 - row;
      for (let i = 0; i < n; i++) {
        const b = new THREE.Mesh(barGeo, barMat);
        b.position.set((i - (n - 1) / 2) * 0.44, -0.6 + row * 0.165, -0.18 + rng.spread(0.04));
        b.rotation.y = rng.spread(0.12);
        inner.add(b);
        bars.push(b);
      }
    }
    const goldLight = new THREE.PointLight(0xffc44d, 9, 6.5, 2);
    goldLight.position.set(0, -0.1, -0.2);
    inner.add(goldLight);

    /* ── Дверь: распахнута, свет льётся наружу ─────────────────────────── */
    const doorPivot = new THREE.Group();
    doorPivot.position.set(HINGE_X, 0, 0.26);
    safe.add(doorPivot);

    const profile: THREE.Vector2[] = [];
    const bev = 0.06;
    const halfT = 0.115;
    profile.push(new THREE.Vector2(0.0001, -halfT));
    profile.push(new THREE.Vector2(DOOR_R - bev, -halfT));
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      profile.push(new THREE.Vector2(DOOR_R - bev + Math.sin(a) * bev, -halfT + bev - Math.cos(a) * bev));
    }
    for (let i = 8; i >= 1; i--) {
      const a = (i / 8) * (Math.PI / 2);
      profile.push(new THREE.Vector2(DOOR_R - bev + Math.sin(a) * bev, halfT - bev + Math.cos(a) * bev));
    }
    profile.push(new THREE.Vector2(DOOR_R - bev, halfT));
    profile.push(new THREE.Vector2(0.0001, halfT));

    const doorGeo = new THREE.LatheGeometry(profile, 72);
    doorGeo.rotateX(Math.PI / 2);
    const doorMat = darkSteel({ roughness: 0.26 });
    doorMat.envMapIntensity = 1.3;
    doorMat.map = brushedMetal({ base: 92, strength: 20, circular: true });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.x = -HINGE_X;
    doorPivot.add(door);
    doorPivot.rotation.y = 1.02;                   // открыта на игрока

    const rivetGeo = new THREE.SphereGeometry(0.042, 12, 9);
    const rivetMat = chrome();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = new THREE.Mesh(rivetGeo, rivetMat);
      r.position.set(-HINGE_X + Math.cos(a) * (DOOR_R - 0.085), Math.sin(a) * (DOOR_R - 0.085), halfT + 0.01);
      r.scale.z = 0.6;
      doorPivot.add(r);
    }

    // Штурвал на внешней стороне двери
    const wheel = new THREE.Group();
    wheel.position.set(-HINGE_X, 0, halfT + 0.09);
    doorPivot.add(wheel);
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.042, 12, 48), chrome()));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.12, 28), polishedGold());
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.38, 12), chrome());
      spoke.position.set(Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0);
      spoke.rotation.z = a + Math.PI / 2;
      wheel.add(spoke);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 9), gold({ roughness: 0.18 }));
      knob.position.set(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.05);
      wheel.add(knob);
    }

    // Петли
    const hingeParts: THREE.Mesh[] = [];
    for (const hy of [-0.62, 0.62]) {
      const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.46, 0.3), chrome());
      hinge.position.set(HINGE_X + 0.02, hy, 0.14);
      safe.add(hinge);
      hingeParts.push(hinge);
    }

    /* ═══ 3D-МОДЕЛЬ СЕЙФА (ТЗ): клон с распахнутой дверью вместо корпуса ═══
     * Сейф тут — витрина: дверь открыта, свет льётся. Модель берём клоном
     * (safe.glb уже в кэше у SafeCrackScene — файл качается один раз),
     * дверь позой ставим вручную (микшер у клона общий не нужен), а золото
     * и ореол остаются процедурными VFX поверх.
     */
    let cancelled = false;
    let modelHolder: THREE.Group | null = null;
    const hideOnModel: THREE.Object3D[] = [body, frame, collar, doorPivot, ...hingeParts, cavity, ...bars];
    loadModel('safe.glb', { quality }).then((m) => {
      if (cancelled || !m) return;
      const clone = acquireRoot(m);
      modelHolder = new THREE.Group();
      modelHolder.add(clone);
      modelHolder.scale.setScalar(0.72);          // витрина меньше взлома
      safe.add(modelHolder);
      modelHolder.updateMatrixWorld(true);
      // Дверь — распахнута, как в процедурной витрине
      const doorNode = clone.getObjectByName('safe_door');
      if (doorNode) {
        doorNode.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -1.02);
        doorNode.position.z += 0.16;
      }
      // Петля модели — на ось петли витрины (локально в группе safe)
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
      hideOnModel.forEach((o) => { o.visible = false; });
      const lightAnchor = clone.getObjectByName('Anchor_Light');
      if (lightAnchor) lightAnchor.attach(goldLight);
    });

    /* ═══════════════════════ МОНЕТЫ НА ОРБИТАХ ══════════════════════════ */
    // Монеты — та же чеканка, что и в дуэли: игрок узнаёт «свою» валюту
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

    interface Orbit { mesh: THREE.Mesh; radius: number; speed: number; phase: number; tilt: number; yBase: number; spin: number; }
    const orbits: Orbit[] = [];
    const COUNT = quality === 'low' ? 7 : 13;
    for (let i = 0; i < COUNT; i++) {
      const mesh = new THREE.Mesh(coinGeo, [coinSide, coinMats[i % 2], coinMats[(i + 1) % 2]]);
      const o: Orbit = {
        mesh,
        radius: 1.5 + rng.range(0, 1.25),
        speed: rng.range(0.16, 0.42) * (rng.rand() < 0.22 ? -1 : 1),
        phase: rng.rand() * Math.PI * 2,
        tilt: rng.spread(0.42),
        yBase: rng.range(-0.55, 0.95),
        spin: rng.range(0.7, 2.6)
      };
      scene.add(mesh);
      orbits.push(o);
    }

    /* ═══════════════════════════ СВЕТ ═══════════════════════════════════ */
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

    /* ═══════════════════════════ ЧАСТИЦЫ ════════════════════════════════ */
    const motes = new ParticleField(quality === 'low' ? 55 : 160, glowSprite('#ffe9a8', 0.18), {
      color: 0xffd76a, size: 0.19, gravity: 0.16, drag: 0.99, opacity: 0.85, scale: 180
    });
    scene.add(motes.points);

    const sparkles = new ParticleField(quality === 'low' ? 30 : 90, glowSprite('#ffffff', 0.5), {
      color: 0xfff6dd, size: 0.13, gravity: -0.05, drag: 0.995, opacity: 0.9, scale: 150
    });
    scene.add(sparkles.points);

    /* ═══════════════════════════ АНИМАЦИЯ ═══════════════════════════════ */
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const camTarget = new THREE.Vector3(0, 0.34, 5.5);
    let moteTimer = 0;

    const stopLoop = startLoop(stage, (dt, elapsed) => {
      // Медленный облёт: герой должен быть живым, но не отвлекать от текста
      const a = elapsed * 0.11;
      camTarget.set(Math.sin(a) * 0.85, 0.34 + Math.sin(elapsed * 0.21) * 0.12, 5.45 + Math.cos(a) * 0.35);
      camera.position.lerp(camTarget, 1 - Math.pow(0.02, dt));
      camera.lookAt(0, 0.05 + Math.sin(elapsed * 0.17) * 0.04, 0);

      // Сейф дышит
      safe.position.y = 0.06 + Math.sin(elapsed * 0.7) * 0.028;
      safe.rotation.y = -0.30 + Math.sin(elapsed * 0.23) * 0.075;
      wheel.rotation.z = elapsed * 0.28;

      // Свет изнутри пульсирует — золото «дышит»
      const breathe = 0.82 + Math.sin(elapsed * 1.5) * 0.18;
      goldLight.intensity = 9 * breathe;
      (innerGlow.material as THREE.MeshBasicMaterial).opacity = 0.9 * breathe;
      (spill.material as THREE.MeshBasicMaterial).opacity = 0.42 * breathe;
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.36 + Math.sin(elapsed * 0.9) * 0.07;
      podiumRing.rotation.z = elapsed * 0.16;
      podiumRing2.rotation.z = -elapsed * 0.11;
      (podiumRing.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(elapsed * 1.3) * 0.16;

      bars.forEach((b, i) => {
        b.rotation.y = Math.sin(elapsed * 0.5 + i * 0.7) * 0.06;
      });

      // Монеты по орбитам: каждая со своим наклоном и вращением
      for (const o of orbits) {
        const t = elapsed * o.speed + o.phase;
        o.mesh.position.set(
          Math.cos(t) * o.radius,
          o.yBase + Math.sin(t * 1.7) * 0.22 + Math.sin(elapsed * 0.6 + o.phase) * 0.06,
          Math.sin(t) * o.radius * 0.72 + o.tilt
        );
        o.mesh.rotation.y = elapsed * o.spin + o.phase;
        o.mesh.rotation.x = Math.sin(t) * 0.5;
        // Монета, ушедшая за сейф, чуть тусклее — дешёвая имитация глубины
        const depth = (o.mesh.position.z + 1.4) / 2.8;
        o.mesh.scale.setScalar(0.86 + Math.max(0, Math.min(1, depth)) * 0.2);
      }

      // Золотая пыль вытекает из сейфа
      moteTimer += dt;
      if (moteTimer > 0.06) {
        moteTimer = 0;
        tmp.set(rng.spread(0.55), rng.range(-0.55, 0.6), -0.1 + rng.spread(0.25));
        tmp2.set(rng.spread(0.34), rng.range(0.16, 0.72), rng.range(0.5, 1.5));
        motes.emit(tmp, tmp2, rng.range(1.6, 3.2), rng.range(0.08, 0.22));
      }
      // Искры на металле — редкие, чтобы не «шумело»
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
      barGeo.dispose();
      coinGeo.dispose();
      rivetGeo.dispose();
      doorGeo.dispose();
      coinMats.forEach((m) => m.dispose());
      disposeObject(safe);
      disposeObject(scene);
      stage.dispose();
    };
  }, []);

  return <div ref={ref} style={{ width: '100%', height: size }} />;
}
