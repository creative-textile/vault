/**
 * Материалы зала: золото, хром, воронёная сталь, крашеный корпус, стекло, неон.
 *
 * Собраны в одном месте по двум причинам. Во-первых, «дорогой» вид даёт не
 * геометрия, а параметры PBR (metalness/roughness/clearcoat/envMapIntensity),
 * и подбирать их нужно единообразно для всех сцен. Во-вторых, материалы
 * обязаны переиспользоваться: каждый новый MeshStandardMaterial — это новая
 * компиляция шейдера, а на мобильном GPU десяток лишних программ означает
 * подтормаживание первых секунд полёта.
 */
import * as THREE from 'three';
import { brushedMetal, hullPanels } from './textures';

/** Золото: монеты, ручка сейфа, ободки, выигрышные суммы. */
export function gold(opts: { roughness?: number; envIntensity?: number } = {}): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffd76a,
    metalness: 1,
    roughness: opts.roughness ?? 0.22,
    envMapIntensity: opts.envIntensity ?? 1.55,
    roughnessMap: brushedMetal({ base: 96, strength: 40, circular: true })
  });
  return m;
}

/** Полированное золото с зеркальным блеском (гурт монеты, акценты). */
export function polishedGold(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xfff0b4,
    metalness: 1,
    roughness: 0.09,
    envMapIntensity: 1.9
  });
}

/** Хром/серебро: засовы, диски, крепеж. */
export function chrome(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xdfe4f2,
    metalness: 1,
    roughness: 0.13,
    envMapIntensity: 1.8
  });
}

/** Воронёная сталь: корпус сейфа, тёмные детали. */
export function darkSteel(opts: { roughness?: number } = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x3a3f57,
    metalness: 0.94,
    roughness: opts.roughness ?? 0.42,
    envMapIntensity: 1.1,
    roughnessMap: brushedMetal({ base: 150, strength: 34 })
  });
}

/** Крашеный корпус ракеты: белый перламутр с лаком (clearcoat). */
export function paintedHull(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf4f6fb,
    metalness: 0.18,
    roughness: 0.34,
    map: hullPanels(),
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    envMapIntensity: 1.15
  });
}

/** Красный лак: носовой обтекатель, кили, тревожные элементы. */
export function paintedRed(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd81f3f,
    metalness: 0.3,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.3
  });
}

/** Тёмный композит (углеродное волокно на вид): площадки, постаменты. */
export function composite(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x181c33,
    metalness: 0.55,
    roughness: 0.55,
    envMapIntensity: 0.85
  });
}

/**
 * Стекло иллюминатора: настоящее преломление (transmission), а не плоский
 * синий кружок. `thickness` даёт глубину, `iridescence` — лёгкий перелив.
 */
export function glass(opts: { color?: number; attenuation?: number } = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: opts.color ?? 0x9fd8ff,
    metalness: 0,
    roughness: 0.04,
    transmission: 0.94,
    thickness: 0.42,
    ior: 1.5,
    iridescence: 0.4,
    iridescenceIOR: 1.3,
    attenuationColor: new THREE.Color(0x2b7fff),
    attenuationDistance: opts.attenuation ?? 1.4,
    envMapIntensity: 2.1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    transparent: true
  });
}

/**
 * Неоновая emissive-поверхность: ленты, индикаторы, кольца арены.
 * `toneMapped: false` обязателен — иначе bloom не получит «горячих» значений
 * и свечение будет грязно-серым вместо яркого неона.
 */
export function neon(color: number, intensity = 2.6): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  m.color.multiplyScalar(intensity);
  return m;
}

/** Прозрачный аддитивный слой (пламя, ореолы, ударные волны). */
export function additive(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
}

/** Бархат/мягкая ткань арены: почти без бликов, глубокий цвет. */
export function velvet(color = 0x2a0f45): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0,
    roughness: 0.95,
    envMapIntensity: 0.4
  });
}

/** Рекурсивно освободить геометрию и материалы объекта (защита от утечек GPU). */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) {
      // Текстуры материала живут в общем кэше — их не трогаем
      mat.dispose();
    }
  });
}
