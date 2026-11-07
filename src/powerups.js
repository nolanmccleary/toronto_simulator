import * as THREE from '../vendor/three.module.js';
import { glowSprite } from './effects.js';

// Power-mode packages that appear one-at-a-time on the ground. Stand near one and press 6.
const MODES = ['somali', 'nightyute'];
const COLORS = { somali: 0xff3b3b, nightyute: 0x5ad6ff };
const CFG = { radius: 2.6, life: 20, respawn: 9, respawnVar: 7, first: 12 };

export class Powerups {
  constructor(scene, effects) {
    this.scene = scene;
    this.glowTex = effects.glowTex;
    this.world = null;
    this.active = null;       // only one package exists at a time
    this.spawnTimer = CFG.first;
    this.next = 0;            // alternate which mode spawns
  }

  bind(world) { this.world = world; }

  reset() { if (this.active) this._dispose(this.active); this.active = null; this.spawnTimer = CFG.first; this.next = 0; }

  _dispose(pk) {
    this.scene.remove(pk.group);
    pk.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }

  _spawn(mode) {
    const h = this.world.half - 6;
    const x = (Math.random() * 2 - 1) * h, z = (Math.random() * 2 - 1) * h;
    const y = this.world.terrainHeight(x, z) + 1.3;
    const color = COLORS[mode];
    const group = new THREE.Group();
    const box = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    group.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x0b0a16 })));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })));
    group.add(glowSprite(this.glowTex, color, 3.2));
    const ring = new THREE.Mesh(new THREE.RingGeometry(CFG.radius - 0.25, CFG.radius, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -1.2; group.add(ring);
    group.position.set(x, y, z);
    this.scene.add(group);
    this.active = { group, mode, color, x, z, y, t: 0, bob: 0, ring };
  }

  // The mode of the package the player is standing on, or null.
  nearMode(player) {
    if (!this.active) return null;
    const a = this.active;
    return (Math.hypot(player.pos.x - a.x, player.pos.z - a.z) < CFG.radius && Math.abs(player.pos.y - a.y) < 4) ? a.mode : null;
  }

  consume() {
    if (!this.active) return;
    this._dispose(this.active); this.active = null;
    this.spawnTimer = CFG.respawn + Math.random() * CFG.respawnVar;
  }

  update(dt, player, canSpawn) {
    if (!this.active) {
      if (canSpawn) { this.spawnTimer -= dt; if (this.spawnTimer <= 0) { this._spawn(MODES[this.next % MODES.length]); this.next++; } }
      return;
    }
    const a = this.active; a.t += dt; a.bob += dt;
    a.group.position.y = a.y + Math.sin(a.bob * 2) * 0.2;
    a.group.rotation.y += dt * 1.2;
    const left = CFG.life - a.t;
    if (left < 2) a.ring.material.opacity = 0.35 * Math.max(0.15, left / 2); // fade before vanishing
    if (a.t >= CFG.life) { this._dispose(a); this.active = null; this.spawnTimer = CFG.respawn + Math.random() * CFG.respawnVar; }
  }
}
