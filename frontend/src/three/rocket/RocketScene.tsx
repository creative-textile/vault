import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface Props {
  phase: 'idle' | 'flying' | 'crashed' | 'cashed';
  multiplier?: number;
  cashoutAt?: number;
  crashAt?: number;
  onReady?: () => void;
  seed?: string;
}

export default function RocketScene({ phase, multiplier = 1, cashoutAt = 1, crashAt = 1, seed = 'vault-rocket' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [ghostMultiplier, setGhostMultiplier] = useState<number | null>(null);
  const lastGhostUiRef = useRef(0);
  const stateRef = useRef({ phase, multiplier, cashoutAt, crashAt, cashedStarted: phase === 'cashed' ? performance.now() : 0, rocket: null as THREE.Group | null, particles: null as THREE.Points | null });

  useEffect(() => {
    if (phase === 'cashed' && stateRef.current.phase !== 'cashed') stateRef.current.cashedStarted = performance.now();
    stateRef.current.phase = phase;
    stateRef.current.multiplier = multiplier;
    stateRef.current.cashoutAt = cashoutAt;
    stateRef.current.crashAt = crashAt;
    if (phase !== 'cashed') setGhostMultiplier(null);
  }, [phase, multiplier, cashoutAt, crashAt]);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    let hash=2166136261; for(const c of seed) hash=Math.imul(hash^c.charCodeAt(0),16777619);
    const rand=()=>{ hash=(Math.imul(hash,1664525)+1013904223)>>>0; return hash/0x100000000; };
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a2a, 0.05);

    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 200);
    camera.position.set(0, 2, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Звёзды
    const starGeo = new THREE.BufferGeometry();
    const starCount = 500;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i*3] = (rand() - 0.5) * 100;
      starPos[i*3+1] = (rand() - 0.5) * 100;
      starPos[i*3+2] = (rand() - 0.5) * 100 - 20;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.1 })
    );
    scene.add(stars);

    // Площадка
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2, 2.2, 0.3, 32),
      new THREE.MeshStandardMaterial({ color: 0x444466, metalness: 0.7 })
    );
    pad.position.y = -1;
    scene.add(pad);

    // Ракета
    const rocket = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.6, 2.2, 24),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.6 })
    );
    rocket.add(body);
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 0.8, 24),
      new THREE.MeshStandardMaterial({ color: 0xff4444, metalness: 0.6 })
    );
    nose.position.y = 1.5;
    rocket.add(nose);
    const rocketWindow = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x4488ff, metalness: 0.9, emissive: 0x2244aa, emissiveIntensity: 0.5 })
    );
    rocketWindow.position.y = 0.5;
    rocketWindow.position.z = 0.45;
    rocket.add(rocketWindow);
    const finL = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 0.6, 4),
      new THREE.MeshStandardMaterial({ color: 0xff4444 })
    );
    finL.position.set(-0.5, -0.9, 0);
    finL.rotation.z = Math.PI / 2;
    rocket.add(finL);
    const finR = finL.clone();
    finR.position.x = 0.5;
    finR.rotation.z = -Math.PI / 2;
    rocket.add(finR);

    // Огонь
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 1.3, 12),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0 })
    );
    flame.position.y = -1.7;
    flame.rotation.x = Math.PI;
    rocket.add(flame);

    rocket.position.y = 0.3;
    scene.add(rocket);
    stateRef.current.rocket = rocket;

    // После кэшаута оригинал приземляется, а полупрозрачный «призрак»
    // бесплатно доигрывает исходную/красивую траекторию до обязательного взрыва.
    const ghost = rocket.clone(true);
    ghost.traverse((obj:any) => {
      if (obj.material) {
        obj.material = obj.material.clone();
        obj.material.transparent = true;
        obj.material.opacity = 0.3;
        obj.material.depthWrite = false;
      }
    });
    ghost.visible = false;
    scene.add(ghost);

    // Свет
    const ambient = new THREE.AmbientLight(0x6666aa, 0.6);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(5, 10, 5);
    scene.add(dir);
    const flameLight = new THREE.PointLight(0xff6600, 0, 10);
    flameLight.position.y = -1;
    rocket.add(flameLight);

    // Обломки (для взрыва)
    const debrisGroup = new THREE.Group();
    for (let i = 0; i < 20; i++) {
      const piece = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshStandardMaterial({ color: rand() > 0.5 ? 0xff4444 : 0xeeeeee })
      );
      piece.userData = {
        vx: (rand() - 0.5) * 0.3,
        vy: rand() * 0.3,
        vz: (rand() - 0.5) * 0.3,
        vr: new THREE.Vector3(rand() * 0.2, rand() * 0.2, rand() * 0.2)
      };
      piece.visible = false;
      debrisGroup.add(piece);
    }
    scene.add(debrisGroup);

    let animId = 0;
    let t = 0;
    let altitude = 0;
    const cameraBase = new THREE.Vector3(0, 2, 8);

    const animate = () => {
      animId = requestAnimationFrame(animate);
      t += 0.016;

      const phase = stateRef.current.phase;

      if (phase === 'flying') {
        rocket.visible = true;
        ghost.visible = false;
        // Плавный набор высоты (логарифмически замедляется)
        const targetAlt = Math.log(1 + t * 0.6) * 4;
        altitude += (targetAlt - altitude) * 0.08;
        rocket.position.y = 0.3 + altitude;
        flame.scale.y = 1 + rand() * 0.5;
        (flame.material as THREE.MeshBasicMaterial).opacity = 0.9;
        flameLight.intensity = 2 + rand() * 2;

        // Звёзды летят вниз
        stars.rotation.z = t * 0.5;
        // Камера плотно следует за ракетой (чтобы всегда оставалась в кадре)
        camera.position.y = 1.5 + altitude;
        camera.position.z = 8;

        // Тряска при множителе > 3
        if (stateRef.current.multiplier >= 3) {
          rocket.position.x = (rand() - 0.5) * 0.1;
          rocket.position.z = (rand() - 0.5) * 0.1;
        }
      } else if (phase === 'idle') {
        rocket.rotation.y = Math.sin(t * 0.5) * 0.2;
        rocket.position.y = 0.3 + Math.sin(t * 2) * 0.05;
        (flame.material as THREE.MeshBasicMaterial).opacity = 0;
        flameLight.intensity = 0;
        altitude = 0;
        camera.position.lerp(cameraBase, 0.05);
        rocket.position.x = 0; rocket.position.z = 0;
        ghost.visible = false;
        stars.rotation.z = 0;
        debrisGroup.children.forEach(c => { c.visible = false; c.position.set(0, 0, 0); });
      } else if (phase === 'crashed') {
        // Взрыв — разлетающиеся обломки
        (flame.material as THREE.MeshBasicMaterial).opacity = 0;
        flameLight.intensity = 3;
        rocket.visible = false;
        debrisGroup.position.copy(rocket.position);
        debrisGroup.children.forEach(c => {
          c.visible = true;
          c.position.x += c.userData.vx;
          c.position.y += c.userData.vy - 0.01;
          c.position.z += c.userData.vz;
          c.rotation.x += c.userData.vr.x;
          c.rotation.y += c.userData.vr.y;
        });
      } else if (phase === 'cashed') {
        // Результат по ТЗ: настоящая ракета уже приземлилась, её призрак летит
        // дальше по той же e^(0.075t) и взрывается в сохранённой точке.
        flameLight.intensity = 0;
        (flame.material as THREE.MeshBasicMaterial).opacity = 0;
        rocket.visible = true;
        rocket.position.set(0, 0.3 + Math.sin(t * 2) * 0.02, 0);
        const from = Math.max(1.01, stateRef.current.cashoutAt);
        const to = Math.max(from, stateRef.current.crashAt);
        const fullMs = Math.max(900, Math.log(to / from) / 0.075 * 1000);
        const passed = Math.max(0, performance.now() - stateRef.current.cashedStarted);
        const ghostMult = Math.min(to, from * Math.exp(0.075 * passed / 1000));
        const ghostAlt = Math.log(1 + Math.max(0, Math.log(ghostMult) / 0.075) * 0.6) * 4;
        ghost.position.set(0, 0.3 + ghostAlt, 0);
        ghost.visible = passed < fullMs;
        // Камера следует за призраком, иначе длинный красивый полёт уходит за кадр.
        camera.position.y += ((1.5 + ghostAlt) - camera.position.y) * 0.08;
        camera.position.z = 8;
        if (performance.now() - lastGhostUiRef.current > 80 || passed >= fullMs) {
          lastGhostUiRef.current = performance.now();
          setGhostMultiplier(ghostMult);
        }
        if (passed >= fullMs) {
          debrisGroup.position.copy(ghost.position);
          debrisGroup.children.forEach(c => {
            c.visible = true;
            c.position.x += c.userData.vx;
            c.position.y += c.userData.vy - 0.01;
            c.position.z += c.userData.vz;
            c.rotation.x += c.userData.vr.x;
            c.rotation.y += c.userData.vr.y;
          });
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [seed]);

  return <div style={{position:'relative'}}>
    <div ref={ref} className="three-container" />
    {phase === 'cashed' && ghostMultiplier !== null && <div style={{position:'absolute',top:12,left:'50%',transform:'translateX(-50%)',textAlign:'center',padding:'8px 14px',borderRadius:12,background:'rgba(5,7,20,.78)',whiteSpace:'nowrap',pointerEvents:'none'}}>
      <div className="text-green" style={{fontWeight:900}}>✅ Кэшаут зафиксирован x{cashoutAt.toFixed(2)}</div>
      <div className="text-accent" style={{fontSize:22,fontWeight:900}}>{ghostMultiplier >= crashAt ? '💥' : '👻'} x{ghostMultiplier.toFixed(2)}</div>
      <small className="text-dim">{ghostMultiplier >= crashAt ? 'Финальная точка' : 'Призрак летит дальше'}</small>
    </div>}
  </div>;
}
