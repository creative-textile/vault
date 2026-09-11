import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Процедурная сцена с сейфом для онбординга и главного экрана.
 */
export default function VaultScene({ size = 300 }: { size?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 1.5, 5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Свет
    const ambient = new THREE.AmbientLight(0x8888ff, 0.6);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffd700, 1.2);
    dir.position.set(3, 5, 4);
    scene.add(dir);

    // Сейф
    const safeGroup = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.2, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x555566, metalness: 0.8, roughness: 0.4 })
    );
    safeGroup.add(body);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 2.0, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.9, roughness: 0.3 })
    );
    door.position.z = 0.95;
    safeGroup.add(door);

    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.08, 16, 32),
      new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 1, roughness: 0.2 })
    );
    handle.position.set(0, 0, 1.05);
    handle.rotation.x = Math.PI / 2;
    safeGroup.add(handle);

    const bolts = [
      [-0.8, 0.8], [0.8, 0.8], [-0.8, -0.8], [0.8, -0.8]
    ].map(([x, y]) => {
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 1 })
      );
      b.position.set(x, y, 1.02);
      safeGroup.add(b);
      return b;
    });

    // Пол
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(5, 32),
      new THREE.MeshStandardMaterial({ color: 0x1a1a3a, metalness: 0.3 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.2;
    scene.add(floor);

    // Монеты вокруг
    const coins: THREE.Mesh[] = [];
    for (let i = 0; i < 10; i++) {
      const c = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.05, 24),
        new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 1, roughness: 0.2 })
      );
      const angle = (i / 10) * Math.PI * 2;
      c.position.set(Math.cos(angle) * 2.2, -1.1, Math.sin(angle) * 2.2);
      c.rotation.x = Math.PI / 2;
      scene.add(c);
      coins.push(c);
    }

    scene.add(safeGroup);

    let animId = 0;
    let t = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      t += 0.01;
      safeGroup.rotation.y = Math.sin(t * 0.3) * 0.3;
      safeGroup.position.y = Math.sin(t * 0.8) * 0.05;
      coins.forEach((c, i) => {
        c.rotation.y = t * 2 + i;
        c.position.y = -1.1 + Math.abs(Math.sin(t * 2 + i)) * 0.2;
      });
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

  return <div ref={ref} style={{ width: '100%', height: size }} />;
}
