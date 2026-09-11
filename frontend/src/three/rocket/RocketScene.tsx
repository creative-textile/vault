import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Props {
  phase: 'idle' | 'flying' | 'crashed' | 'cashed';
  multiplier?: number;
  onReady?: () => void;
}

export default function RocketScene({ phase, multiplier = 1 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ phase, multiplier, rocket: null as THREE.Group | null, particles: null as THREE.Points | null });

  useEffect(() => {
    stateRef.current.phase = phase;
    stateRef.current.multiplier = multiplier;
  }, [phase, multiplier]);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

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
      starPos[i*3] = (Math.random() - 0.5) * 100;
      starPos[i*3+1] = (Math.random() - 0.5) * 100;
      starPos[i*3+2] = (Math.random() - 0.5) * 100 - 20;
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
        new THREE.MeshStandardMaterial({ color: Math.random() > 0.5 ? 0xff4444 : 0xeeeeee })
      );
      piece.userData = {
        vx: (Math.random() - 0.5) * 0.3,
        vy: Math.random() * 0.3,
        vz: (Math.random() - 0.5) * 0.3,
        vr: new THREE.Vector3(Math.random() * 0.2, Math.random() * 0.2, Math.random() * 0.2)
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
        // Плавный набор высоты (логарифмически замедляется)
        const targetAlt = Math.log(1 + t * 0.6) * 4;
        altitude += (targetAlt - altitude) * 0.08;
        rocket.position.y = 0.3 + altitude;
        flame.scale.y = 1 + Math.random() * 0.5;
        (flame.material as THREE.MeshBasicMaterial).opacity = 0.9;
        flameLight.intensity = 2 + Math.random() * 2;

        // Звёзды летят вниз
        stars.rotation.z = t * 0.5;
        // Камера плотно следует за ракетой (чтобы всегда оставалась в кадре)
        camera.position.y = 1.5 + altitude;
        camera.position.z = 8;

        // Тряска при множителе > 3
        if (stateRef.current.multiplier >= 3) {
          rocket.position.x = (Math.random() - 0.5) * 0.1;
          rocket.position.z = (Math.random() - 0.5) * 0.1;
        }
      } else if (phase === 'idle') {
        rocket.rotation.y = Math.sin(t * 0.5) * 0.2;
        rocket.position.y = 0.3 + Math.sin(t * 2) * 0.05;
        (flame.material as THREE.MeshBasicMaterial).opacity = 0;
        flameLight.intensity = 0;
        altitude = 0;
        camera.position.lerp(cameraBase, 0.05);
        rocket.position.x = 0; rocket.position.z = 0;
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
        // Приземление
        flameLight.intensity = 0;
        (flame.material as THREE.MeshBasicMaterial).opacity = 0;
        rocket.position.y = 0.3 + Math.sin(t * 2) * 0.02;
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
  }, []);

  return <div ref={ref} className="three-container" />;
}
