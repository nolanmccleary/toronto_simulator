import * as THREE from '../vendor/three.module.js';
import { PICKUP, PLAYER } from './config.js';
import { glowSprite } from './effects.js';
import { sfx } from './audio.js';

// Health orbs that appear and fade around the arena; walk into one to heal.
export class Pickups {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.glowTex = effects.glowTex;
    this.world = null;
    this.list = [];
    this.spawnTimer = 3;
  }

  bind(world) { this.world = world; }

  reset() {
    for (const o of this.list) this._dispose(o);
    this.list = [];
    this.spawnTimer = 3;
  }

  _dispose(o) {
    this.scene.remove(o.group);
    o.group.traverse((m) => { m.geometry?.dispose?.(); m.material?.dispose?.(); });
  }

  _spawn() {
    const h = this.world.half - 4;
    const x = (Math.random() * 2 - 1) * h, z = (Math.random() * 2 - 1) * h;
    const y = this.world.terrainHeight(x, z) + 1.1;
    const group = new THREE.Group();
    const geo = new THREE.OctahedronGeometry(0.42, 0);
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: PICKUP.color })));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })));
    const glow = glowSprite(this.glowTex, PICKUP.color, 2.4);
    group.add(glow);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 24), new THREE.MeshBasicMaterial({ color: PICKUP.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -1.0;
    group.add(ring);
    group.position.set(x, y, z);
    this.scene.add(group);
    this.list.push({ group, glow, x, y, z, t: 0, bob: Math.random() * 6 });
  }

  update(dt, player, active) {
    if (active) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.list.length < PICKUP.maxActive) {
        this._spawn();
        this.spawnTimer = PICKUP.interval + Math.random() * PICKUP.intervalVar;
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t += dt; o.bob += dt;
      o.group.position.y = o.y + Math.sin(o.bob * 2) * 0.18;
      o.group.rotation.y += dt * 1.6;
      // fade out near end of life
      const left = PICKUP.life - o.t;
      if (left < 1.5) o.glow.material.opacity = Math.max(0.1, left / 1.5);

      // collect?
      const pc = player.pos.y + PLAYER.height * 0.5;
      if (Math.hypot(player.pos.x - o.x, pc - o.group.position.y, player.pos.z - o.z) < PICKUP.radius + PLAYER.radius) {
        player.health = Math.min(PLAYER.maxHealth, player.health + PICKUP.heal);
        this.effects.flash(o.group.position.clone(), PICKUP.color, 5, 0.4);
        this.effects.burst(o.group.position.clone(), PICKUP.color);
        sfx.heal();
        this._dispose(o); this.list.splice(i, 1);
        continue;
      }
      if (o.t >= PICKUP.life) { this._dispose(o); this.list.splice(i, 1); }
    }
  }
}
