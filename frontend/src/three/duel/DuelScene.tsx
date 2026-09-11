import { useEffect, useRef } from 'react';
import * as THREE from 'three';

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

export default function DuelScene({ phase, result, trajectory }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ phase, result, trajectory, coin: null as THREE.Mesh | null });

  useEffect(() => {
    stateRef.current.phase = phase;
    stateRef.current.result = result;
    stateRef.current.trajectory = trajectory;
  }, [phase, result, trajectory]);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const w = container.clientWidth, h = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);

    const camera = new THREE.PerspectiveCamera(50, w/h, 0.1, 100);
    camera.position.set(0, 2, 7);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);

    // Арена
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.5, 48),
      new THREE.MeshStandardMaterial({ color: 0x332266, metalness: 0.3 })
    );
    floor.rotation.x = -Math.PI/2;
    floor.position.y = -0.5;
    scene.add(floor);

    // Свет
    scene.add(new THREE.AmbientLight(0x8888ff, 0.5));
    const spot = new THREE.SpotLight(0xffd700, 1.5, 20, Math.PI/4);
    spot.position.set(0, 8, 2);
    scene.add(spot);

    // Монета — цилиндр с двумя цветами
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.2, 48),
      [
        new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 1, roughness: 0.2 }), // решка (сторона цилиндра)
        new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 1, roughness: 0.2 }), // верх (tails)
        new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.1 })  // низ (heads)
      ]
    );
    coin.rotation.x = Math.PI/2;
    scene.add(coin);
    stateRef.current.coin = coin;

    // Текст (упрощённо — цветные диски)
    const headMark = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd700 })
    );
    headMark.position.set(0, 0, -0.11);
    headMark.rotation.x = Math.PI/2;
    // Имитация "орла" — звезда из кружков
    for (let i = 0; i < 5; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0xffffff })
      );
      const ang = (i/5)*Math.PI*2 - Math.PI/2;
      dot.position.set(Math.cos(ang)*0.6, Math.sin(ang)*0.6, 0);
      coin.add(dot);
    }

    // Постаменты
    const pL = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.3, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x4444aa })
    );
    pL.position.set(-2, -0.6, 0);
    scene.add(pL);
    const pR = pL.clone();
    pR.position.x = 2;
    scene.add(pR);

    let animId = 0;
    let t = 0;
    let flipProgress = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      t += 0.016;
      const phase = stateRef.current.phase;
      const traj = stateRef.current.trajectory;

      if (phase === 'flipping' && traj && typeof traj === 'object') {
        flipProgress += 0.015;
        if (flipProgress > 1) flipProgress = 1;

        // Траектория: парабола
        const rotSpeed = typeof traj.rotation_speed === 'number' ? traj.rotation_speed : 8;
        const h = typeof traj.height === 'number' ? traj.height : 2.5;
        const finalAngle = typeof traj.final_angle === 'number' ? traj.final_angle : 0;
        coin.position.y = -0.3 + Math.sin(flipProgress * Math.PI) * h;
        coin.rotation.x = finalAngle * Math.PI/180 + flipProgress * Math.PI * 2 * rotSpeed;

        if (flipProgress >= 1) {
          // Финальное положение
          if (stateRef.current.result === 'heads') {
            coin.rotation.x = 0; // белая сторона к камере
          } else {
            coin.rotation.x = Math.PI; // золотая
          }
          coin.position.y = 0;
        }
      } else if (phase === 'idle') {
        coin.rotation.y = t;
        coin.position.y = 0;
        flipProgress = 0;
      } else if (phase === 'result') {
        // Монета покачивается на месте
        coin.rotation.z = Math.sin(t*3) * 0.05;
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
