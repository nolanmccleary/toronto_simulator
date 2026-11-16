import * as THREE from '../vendor/three.module.js';
import { CAMO, PLAYER } from './config.js';
import { glowSprite } from './effects.js';

// The camo hat: a stealth drop. One sits on the ground at a time (it's a special, not a
// commodity like health orbs); walk over it to cloak. A tall faint beacon makes it findable
// from across the arena. Collecting it just fires onCollect — main.js owns the stealth state.
export class CamoHats {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.glowTex = effects.glowTex;
    this.world = null;
    this.active = null;        // at most one on the ground
    this.spawnTimer = CAMO.first;
    this.onCollect = null;     // set by main: () => void
  }

  bind(world) { this.world = world; }

  reset() { if (this.active) this._dispose(this.active); this.active = null; this.spawnTimer = CAMO.first; }

  _dispose(o) {
    this.scene.remove(o.group);
    o.group.traverse((m) => { m.geometry?.dispose?.(); m.material?.dispose?.(); });
  }

  // A floppy boonie hat: wide brim disc, rounded crown, a darker band, and a pale
  // dapple wireframe so it reads as "camo" rather than just a green blob.
  _spawn() {
    const h = this.world.half - 5;
    const x = (Math.random() * 2 - 1) * h, z = (Math.random() * 2 - 1) * h;
    const y = this.world.terrainHeight(x, z) + 1.1;
    const c = CAMO.color;
    const group = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.07, 24), new THREE.MeshBasicMaterial({ color: 0x3f8a2e }));
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: c }));
    crown.position.y = 0.05;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 20), new THREE.MeshBasicMaterial({ color: 0x2e6b24 }));
    band.position.y = 0.07;
    const dapple = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.SphereGeometry(0.41, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2)),
      new THREE.LineBasicMaterial({ color: 0xbfff8a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }));
    dapple.position.y = 0.05;
    group.add(brim, band, crown, dapple, glowSprite(this.glowTex, c, 2.6));
    // Faint findable beacon (subtler than a power package's beam).
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 22, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = 10; group.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.9, 28),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -1.0; group.add(ring);
    group.position.set(x, y, z);
    this.scene.add(group);
    this.active = { group, ring, x, y, z, t: 0, bob: Math.random() * 6 };
  }

  // `free` = the player can pick things up right now (not in a power mode / not driving).
  // The hat still bobs and ages when not free, but it only spawns and is collectible then.
  update(dt, player, free) {
    if (!this.active) {
      if (free) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) this._spawn();
      }
      return;
    }
    const o = this.active; o.t += dt; o.bob += dt;
    o.group.position.y = o.y + Math.sin(o.bob * 2) * 0.18;
    o.group.rotation.y += dt * 1.3;
    const left = CAMO.life - o.t;
    if (left < 1.5) o.ring.material.opacity = 0.45 * Math.max(0.15, left / 1.5); // fade before vanishing

    // Collect on walk-over.
    const pc = player.pos.y + PLAYER.height * 0.5;
    if (free && Math.hypot(player.pos.x - o.x, pc - o.group.position.y, player.pos.z - o.z) < CAMO.radius + PLAYER.radius) {
      this.effects.flash(o.group.position.clone(), CAMO.color, 6, 0.5);
      this.effects.burst(o.group.position.clone(), CAMO.color);
      this._dispose(o); this.active = null;
      this.spawnTimer = CAMO.interval + Math.random() * CAMO.intervalVar;
      this.onCollect?.();
      return;
    }
    if (o.t >= CAMO.life) { this._dispose(o); this.active = null; this.spawnTimer = CAMO.interval + Math.random() * CAMO.intervalVar; }
  }
}
