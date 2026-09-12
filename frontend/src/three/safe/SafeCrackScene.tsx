import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Props {
  phase: 'idle' | 'spinning' | 'result';
  code?: number[];
  drumSpeeds?: number[];
  onDrumStop?: (drumIndex: number, digit: number, position: number) => void;
  tapDrum?: (i: number) => void;
  crackable?: boolean;
}

export default function SafeCrackScene({ phase, code = [0,0,0], drumSpeeds = [2,2,2] }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ phase, code, drumSpeeds, drums: [] as THREE.Mesh[] });

  useEffect(() => {
    stateRef.current.phase = phase;
    stateRef.current.code = code;
    stateRef.current.drumSpeeds = drumSpeeds;
  }, [phase, code, drumSpeeds]);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const w = container.clientWidth, h = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a0000);

    const camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 100);
    camera.position.set(0, 0, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);

    // Красный мигающий свет
    const ambient = new THREE.AmbientLight(0x440000, 0.5);
    scene.add(ambient);
    const redLight = new THREE.PointLight(0xff0000, 2, 10);
    redLight.position.set(0, 0, 3);
    scene.add(redLight);
    const whiteLight = new THREE.PointLight(0xffffff, 1, 10);
    whiteLight.position.set(0, 2, 3);
    scene.add(whiteLight);

    // Сейф-дверь
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(5, 2.5, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.9 })
    );
    door.position.z = -0.5;
    scene.add(door);

    // Три барабана — цилиндры с цифрами (упрощённо: текстура не нужна, цветные кольца)
    const drums: THREE.Mesh[] = [];
    const digitColors = [0xffd700, 0xffffff, 0x00ff88];

    for (let i = 0; i < 3; i++) {
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.6, 0.5, 24),
        new THREE.MeshStandardMaterial({ color: digitColors[i], metalness: 0.8, roughness: 0.3 })
      );
      drum.rotation.x = Math.PI / 2;
      drum.position.set((i - 1) * 1.4, 0, 0);
      scene.add(drum);
      drums.push(drum);

      // Индикаторная стрелка сверху
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.15, 0.3, 3),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      arrow.position.set((i - 1) * 1.4, 0.85, 0);
      arrow.rotation.x = Math.PI;
      scene.add(arrow);

      // Ободки
      const ring1 = new THREE.Mesh(
        new THREE.TorusGeometry(0.65, 0.05, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
      );
      ring1.position.set((i - 1) * 1.4, 0, 0.26);
      scene.add(ring1);
      const ring2 = ring1.clone();
      ring2.position.z = -0.26;
      scene.add(ring2);
    }
    stateRef.current.drums = drums;

    let animId = 0;
    let t = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      t += 0.016;
      const phase = stateRef.current.phase;

      redLight.intensity = phase === 'spinning' ? 2 + Math.sin(t * 8) * 1.5 : 1;

      // code/drumSpeeds могут прийти как null (сейф ещё не взламывают) —
      // иначе в фазе 'result' исключение возникало бы на каждом кадре
      const speeds = stateRef.current.drumSpeeds || [2, 2, 2];
      const digits = stateRef.current.code || [0, 0, 0];
      if (phase === 'spinning') {
        drums.forEach((d, i) => {
          d.rotation.z += (speeds[i] ?? 2) * 0.05;
        });
      } else if (phase === 'idle') {
        drums.forEach(d => {
          d.rotation.z += 0.01;
        });
      } else if (phase === 'result') {
        // Выравнивание по коду
        drums.forEach((d, i) => {
          const target = ((digits[i] ?? 0) / 10) * Math.PI * 2;
          d.rotation.z += (target - d.rotation.z) * 0.1;
        });
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
