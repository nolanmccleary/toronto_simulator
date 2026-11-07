import * as THREE from '../vendor/three.module.js';

// A soft radial-gradient sprite texture — used for additive glow halos so neon reads
// without the cost/complexity of a full post-processing bloom pass.
export function makeGlowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Builds a billboarded glow sprite of a given color/size.
export function glowSprite(glowTex, color, size) {
  const mat = new THREE.SpriteMaterial({
    map: glowTex, color, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

// Transient visual effects with lifetimes: tracers, muzzle flashes, hit bursts.
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.glowTex = makeGlowTexture();
    this.items = []; // { obj, life, max, update? }
  }

  _add(obj, life, update) {
    this.scene.add(obj);
    this.items.push({ obj, life, max: life, update });
    return obj;
  }

  tracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this._add(new THREE.Line(geo, mat), 0.12);
  }

  muzzle(pos, color) {
    const s = glowSprite(this.glowTex, color, 1.2);
    s.position.copy(pos);
    this._add(s, 0.08);
  }

  // A thick, bright beam (Draco). Cylinder + additive glow that lingers and fades.
  beam(from, to, color, { radius = 0.09, life = 0.3 } = {}) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = Math.max(0.01, dir.length());
    const geo = new THREE.CylinderGeometry(radius, radius, len, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this._add(mesh, life);
    const g = glowSprite(this.glowTex, color, radius * 26);
    g.position.copy(to);
    this._add(g, life);
  }

  // Expanding ground ring (boss slams / shockwaves / spawn quakes).
  groundRing(pos, color, toR, life = 0.6) {
    const geo = new THREE.RingGeometry(0.9, 1.1, 48);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.08, pos.z);
    this._add(m, life, (o, k) => { o.scale.setScalar(Math.max(0.01, toR * (1 - k))); o.material.opacity = k * 0.9; });
  }

  // A brief expanding sphere flash (big impacts / boss deaths).
  flash(pos, color, size = 8, life = 0.4) {
    const s = glowSprite(this.glowTex, color, size);
    s.position.copy(pos);
    this._add(s, life, (o, k) => { o.scale.setScalar(size * (1.4 - k)); o.material.opacity = k; });
  }

  // Small expanding burst of glow sprites when an enemy dies.
  burst(pos, color) {
    for (let i = 0; i < 10; i++) {
      const s = glowSprite(this.glowTex, color, 0.9 + Math.random() * 0.6);
      s.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5)
        .normalize().multiplyScalar(5 + Math.random() * 6);
      this._add(s, 0.5, (o, k) => { // k = 0..1 remaining
        o.position.addScaledVector(v, 0.016);
        o.material.opacity = k;
        const sc = 0.3 + k * 1.0;
        o.scale.set(sc, sc, 1);
      });
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      if (it.update) it.update(it.obj, k);
      else if (it.obj.material) it.obj.material.opacity = k;
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        it.obj.geometry?.dispose?.();
        it.obj.material?.dispose?.();
        this.items.splice(i, 1);
      }
    }
  }
}
