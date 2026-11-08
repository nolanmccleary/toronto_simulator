import * as THREE from '../vendor/three.module.js';
import { glowSprite } from './effects.js';

// Power-mode packages that appear one-at-a-time on the ground. Stand near one and press 6.
const MODES = ['somali', 'nightyute', 'civic'];
const COLORS = { somali: 0xff3b3b, nightyute: 0x5ad6ff, civic: 0xff8c2a };
const CFG = { radius: 2.8, life: 22, respawn: 8, respawnVar: 6, first: 6 };

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
    const box = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const core = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x0b0a16 }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
    group.add(core, edges, glowSprite(this.glowTex, color, 4.2));
    // Tall beacon beam so it's findable from across the arena.
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 26, 14, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = 12; group.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(CFG.radius - 0.3, CFG.radius, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -1.3; group.add(ring);
    group.position.set(x, y, z);
    this.scene.add(group);
    this.active = { group, mode, color, x, z, y, t: 0, bob: 0, ring, core, edges };
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

  update(dt, player, canSpawn, blocked = null) {
    if (!this.active) {
      if (canSpawn) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          // pick the next allowed mode (skip any that are blocked, e.g. a Civic already in the world)
          let mode = null;
          for (let i = 0; i < MODES.length; i++) {
            const cand = MODES[(this.next + i) % MODES.length];
            if (!blocked || !blocked.includes(cand)) { mode = cand; this.next = this.next + i + 1; break; }
          }
          if (mode) this._spawn(mode); else this.spawnTimer = 2;
        }
      }
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
