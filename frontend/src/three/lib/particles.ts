/**
 * Пул частиц: дым, искры, угли, пыль, блики.
 *
 * Один THREE.Points на тип эффекта вместо сотен отдельных мешей — иначе
 * draw calls съедают кадр на мобильном GPU. Частицы живут в предварительно
 * выделенных Float32Array и переиспользуются по кругу (никаких аллокаций в
 * кадре, значит и никакого сборщика мусора посреди полёта).
 *
 * Размер считается в вершинном шейдере от расстояния до камеры, поэтому
 * частицы не «плывут» при наезде камеры и выглядят объёмными.
 */
import * as THREE from 'three';

export interface ParticleFieldOptions {
  color?: number;
  size?: number;
  gravity?: number;
  drag?: number;
  blending?: THREE.Blending;
  opacity?: number;
  /** Множитель размера в шейдере (подбирается под масштаб сцены). */
  scale?: number;
}

export class ParticleField {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly count: number;
  private readonly gravity: number;
  private readonly drag: number;
  private cursor = 0;

  constructor(count: number, texture: THREE.Texture, opts: ParticleFieldOptions = {}) {
    this.count = Math.max(1, count);
    this.gravity = opts.gravity ?? 0;
    this.drag = opts.drag ?? 0.985;
    this.pos = new Float32Array(this.count * 3);
    this.alpha = new Float32Array(this.count);
    this.size = new Float32Array(this.count);
    this.vel = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    this.maxLife = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.pos[i * 3 + 1] = -9999;               // неактивные частицы за кадром
      this.size[i] = opts.size ?? 1;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: texture },
        uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
        uScale: { value: opts.scale ?? 260 },
        uOpacity: { value: opts.opacity ?? 1 }
      },
      vertexShader: /* glsl */`
        attribute float aAlpha;
        attribute float aSize;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          float a = t.a * vAlpha * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * t.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: opts.blending ?? THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /**
   * Выпустить частицу. `p` и `v` читаются сразу и не сохраняются, поэтому
   * можно передавать один и тот же временный вектор раз за разом.
   */
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size?: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = life;
    this.maxLife[i] = life;
    if (size !== undefined) this.size[i] = size;
    this.alpha[i] = 1;
  }

  update(dt: number): void {
    let touched = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) { this.alpha[i] = 0; touched = true; }
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = k * k;                        // квадратичный спад мягче
      this.vel[i * 3 + 1] += this.gravity * dt;
      const d = Math.pow(this.drag, dt * 60);       // drag не зависит от FPS
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] *= d; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -9999;
      touched = true;
    }
    if (!touched) return;
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }

  setScale(scale: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
  }

  setColor(color: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(color);
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.life[i] = 0;
      this.alpha[i] = 0;
      this.pos[i * 3 + 1] = -9999;
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
