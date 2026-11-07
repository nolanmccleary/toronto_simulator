import * as THREE from '../vendor/three.module.js';
import { glowSprite } from './effects.js';
import { sfx } from './audio.js';
import { PLAYER } from './config.js';

// One unique bossman per level. Each looks and fights unlike anything else.
const DEFS = {
  orbital:   { name: 'THE EYE OF DUNDAS', color: 0xff3df0, hp: 480, hitR: 3.0, touch: 16 },
  hunter:    { name: 'THE STREAK',        color: 0xffcf3d, hp: 400, hitR: 2.4, touch: 10 },
  hive:      { name: 'THE HIVE',          color: 0x3dff9e, hp: 540, hitR: 3.0, touch: 16 },
  monolith:  { name: 'THE MEGALITH',      color: 0x7d5cff, hp: 760, hitR: 3.4, touch: 18 },
  aegis:     { name: 'THE AEGIS',         color: 0x6affd8, hp: 480, hitR: 3.0, touch: 16, shield: 420 },
  streetcar: { name: 'THE RED ROCKET',    color: 0xe8463a, hp: 880, hitR: 3.6, touch: 26 },
  tesla:     { name: 'THE OVERCHARGE',    color: 0x5ad6ff, hp: 600, hitR: 2.8, touch: 14 },
};
const HP_SCALE = 0.1; // per-wave boss HP growth
const ORDER = ['orbital', 'hunter', 'hive', 'monolith', 'aegis', 'streetcar', 'tesla'];
export function bossTypeForWave(wave) { return ORDER[((((wave - 1) % ORDER.length) + ORDER.length) % ORDER.length)]; }

const dark = () => new THREE.MeshBasicMaterial({ color: 0x120616 });
const emat = (c, op = 0.95) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending });
const wire = (geo, c, op) => new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat(c, op));

export class Boss {
  constructor(scene, glowTex, type, wave, player) {
    const d = DEFS[type];
    this.type = type; this.name = d.name; this.color = d.color; this.hitR = d.hitR; this.touch = d.touch;
    this.maxHp = Math.round(d.hp * (1 + HP_SCALE * (wave - 1)));
    this.hp = this.maxHp;
    this.shieldMax = Math.round((d.shield || 0) * (1 + HP_SCALE * (wave - 1)));
    this.shield = this.shieldMax;
    this.hitClock = 0;
    this.scene = scene; this.glowTex = glowTex;
    this.phase = 'spawn'; this.t = 0; this.dead = false; this.gone = false;
    this.contactTimer = 0; this.atkTimer = 1.8; this.sub = 'idle'; this.subT = 0;
    this.pos = new THREE.Vector3();
    this.group = new THREE.Group();
    this.group.scale.setScalar(0.01);
    scene.add(this.group);
    this._build(type, glowTex);
    this._spawnPos(player, type);
    this.group.position.copy(this.pos);
    sfx.wave();
  }

  _spawnPos(player, type) {
    const h = 20;
    if (type === 'monolith') {
      this.pos.set(THREE.MathUtils.clamp(player.pos.x, -h, h), -9, THREE.MathUtils.clamp(player.pos.z - 18, -h, h));
      this.restY = 4.6;
    } else if (type === 'hunter') {
      this.pos.set(-30, 2.4, -20); this.restY = 2.4;
    } else if (type === 'streetcar') {
      this.pos.set(-38, 2.6, THREE.MathUtils.clamp(player.pos.z, -h, h)); this.restY = 2.6;
    } else if (type === 'aegis' || type === 'tesla') {
      this.pos.set(0, 7.5, -18); this.restY = 7.5;
    } else {
      this.pos.set(0, 9, -18); this.restY = 9;
    }
  }

  _build(type, glowTex) {
    const c = this.color, g = this.group;
    this.glow = glowSprite(glowTex, c, this.hitR * 4);
    g.add(this.glow);
    if (type === 'orbital') {
      const ico = new THREE.IcosahedronGeometry(2.2, 0);
      this.spin = new THREE.Group(); this.spin.add(new THREE.Mesh(ico, dark()), wire(ico, c));
      this.iris = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 16), new THREE.MeshBasicMaterial({ color: c }));
      this.rings = [];
      for (let i = 0; i < 2; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(3.0 + i * 0.7, 0.12, 8, 40), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }));
        r.rotation.x = Math.random(); r.rotation.y = Math.random(); this.rings.push(r); g.add(r);
      }
      g.add(this.spin, this.iris);
    } else if (type === 'hunter') {
      const body = new THREE.ConeGeometry(1.3, 5.5, 4);
      this.spin = new THREE.Group();
      const m = new THREE.Mesh(body, dark()); m.rotation.x = Math.PI / 2;
      const e = wire(body, c); e.rotation.x = Math.PI / 2;
      this.spin.add(m, e);
      g.add(this.spin);
    } else if (type === 'hive') {
      const core = new THREE.DodecahedronGeometry(1.8, 0);
      this.spin = new THREE.Group(); this.spin.add(new THREE.Mesh(core, dark()), wire(core, c));
      const cageGeo = new THREE.IcosahedronGeometry(3.0, 0);
      this.cage = wire(cageGeo, c, 0.5);
      g.add(this.spin, this.cage);
    } else if (type === 'monolith') {
      const slab = new THREE.BoxGeometry(3.2, 9, 3.2);
      g.add(new THREE.Mesh(slab, dark()), wire(slab, c));
      const coreGeo = new THREE.BoxGeometry(1.2, 7, 1.2);
      this.core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }));
      g.add(this.core);
      this.glow.position.y = 3;
    } else if (type === 'aegis') {
      const ico = new THREE.IcosahedronGeometry(2.0, 0);
      this.spin = new THREE.Group(); this.spin.add(new THREE.Mesh(ico, dark()), wire(ico, c));
      this.dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 24, 18),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
      this.domeWire = wire(new THREE.IcosahedronGeometry(4.6, 1), c, 0.25);
      g.add(this.spin, this.dome, this.domeWire);
    } else if (type === 'streetcar') {
      const body = new THREE.BoxGeometry(2.6, 2.8, 8.5);
      g.add(new THREE.Mesh(body, dark()), wire(body, c));
      const strip = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.9, 7), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }));
      strip.position.y = 0.3; g.add(strip);
      this.body = g;
    } else { // tesla
      this.spin = new THREE.Group();
      const core = new THREE.OctahedronGeometry(1.6, 0);
      this.spin.add(new THREE.Mesh(core, dark()), wire(core, c));
      this.coils = [];
      for (let i = 0; i < 3; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(2.2 - i * 0.1, 0.1, 8, 36), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
        coil.rotation.x = Math.PI / 2; coil.position.y = -1.4 + i * 1.4; this.coils.push(coil); g.add(coil);
      }
      // rotating damage beam
      const beamGeo = new THREE.BoxGeometry(0.22, 0.22, 16);
      this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }));
      this.beam.position.z = -8; this.beamPivot = new THREE.Group(); this.beamPivot.add(this.beam);
      g.add(this.spin, this.beamPivot);
    }
  }

  // --- combat ---
  hit(amount, effects) {
    if (this.dead) return false;
    this.hitClock = 0;
    if (this.shield > 0) {
      this.shield -= amount;
      if (this.shield <= 0) { this.hp += this.shield; this.shield = 0; effects?.flash?.(this.pos, this.color, 10, 0.4); } // shield break
      if (this.hp > 0) return false;
    } else {
      this.hp -= amount;
    }
    if (this.hp <= 0) { this._startDeath(effects); return true; }
    return false;
  }

  _startDeath(effects) {
    this.dead = true; this.phase = 'dying'; this.t = 0;
    effects?.flash(this.pos, this.color, 14, 0.5);
    sfx.over();
  }

  _contact(dt, player) {
    if (this.contactTimer > 0) this.contactTimer -= dt;
    const d = Math.hypot(player.pos.x - this.pos.x, (player.pos.y + 0.9) - this.pos.y, player.pos.z - this.pos.z);
    if (d < this.hitR + PLAYER.radius + 0.4 && this.contactTimer <= 0) {
      this.contactTimer = 0.6; player.takeDamage(this.touch);
    }
  }

  update(dt, player, enemies) {
    this.t += dt;
    const fx = enemies.effects;
    if (this.phase === 'spawn') {
      const k = Math.min(1, this.t / 1.1);
      const e = 1 - Math.pow(1 - k, 3);
      this.group.scale.setScalar(0.01 + e * 0.99);
      if (this.type === 'monolith') this.pos.y = -9 + (this.restY + 9) * e;
      if (this.t > 1.1) { this.phase = 'active'; this.t = 0; if (this.type === 'monolith') fx.groundRing(this.pos, this.color, 12, 0.6); }
    } else if (this.phase === 'active') {
      this._behavior(dt, player, enemies, fx);
      this._contact(dt, player);
      this._clamp(enemies.world);
      this._animate(dt);
    } else if (this.phase === 'dying') {
      const k = this.t / 0.8;
      this.group.scale.setScalar(Math.max(0.01, 1 - k));
      if (this.type === 'monolith') this.group.rotation.z = k * 1.2;
      if (Math.random() < 0.4) fx.burst(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4)), this.color);
      if (this.t > 0.8) { fx.flash(this.pos, this.color, 18, 0.5); this.gone = true; }
    }
    this.group.position.copy(this.pos);
  }

  _clamp(world) {
    const lim = world.half - this.hitR - 1;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);
  }

  _animate(dt) {
    if (this.type === 'orbital') {
      this.spin.rotation.y += dt * 0.6; this.iris.position.set(0, 0, 0);
      this.rings[0].rotation.x += dt * 1.4; this.rings[0].rotation.z += dt * 0.7;
      this.rings[1].rotation.y += dt * 1.1; this.rings[1].rotation.x -= dt * 0.5;
    } else if (this.type === 'hunter') {
      this.spin.rotation.z += dt * 6;
    } else if (this.type === 'hive') {
      this.spin.rotation.y += dt * 1.2; this.spin.rotation.x += dt * 0.6;
      this.cage.rotation.y -= dt * 0.5;
      const p = 1 + 0.08 * Math.sin(this.t * 4); this.cage.scale.setScalar(p);
    } else if (this.type === 'monolith') {
      this.core.material.opacity = 0.4 + 0.25 * (0.5 + 0.5 * Math.sin(this.t * 3));
    } else if (this.type === 'aegis') {
      this.spin.rotation.y += dt * 0.8; this.spin.rotation.x += dt * 0.4;
      const s = this.shieldMax ? this.shield / this.shieldMax : 0;
      this.dome.material.opacity = 0.03 + 0.18 * s;          // dome fades as shield drops
      this.domeWire.material.opacity = 0.05 + 0.25 * s;
      this.domeWire.rotation.y += dt * 0.5;
    } else if (this.type === 'tesla') {
      this.spin.rotation.y += dt * 1.2;
      for (let i = 0; i < this.coils.length; i++) this.coils[i].rotation.z += dt * (1 + i * 0.4);
    }
  }

  // --- per-type behaviour ---
  _behavior(dt, player, enemies, fx) {
    const toP = new THREE.Vector3(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z);
    const dist = Math.max(0.01, toP.length());
    const dir = toP.clone().multiplyScalar(1 / dist);

    if (this.type === 'orbital') {
      // Hover at range, orbit slowly, fire radial volleys.
      const want = 22;
      const move = (dist - want) * 0.5;
      this.pos.addScaledVector(dir, move * dt);
      this.pos.x += -dir.z * 2.0 * dt; this.pos.z += dir.x * 2.0 * dt; // strafe
      this.pos.y += (this.restY - this.pos.y) * Math.min(1, dt * 2);
      this.atkTimer -= dt;
      if (this.atkTimer <= 0) {
        this.atkTimer = 2.3;
        // Spread burst aimed at the player (descends to ground level, so it actually connects).
        const pc = new THREE.Vector3(player.pos.x, player.pos.y + 0.85, player.pos.z);
        for (let i = 0; i < 14; i++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8);
          enemies._spawnProjectile(this.pos.clone(), pc.clone().add(off), 16, 13, this.color);
        }
        fx.flash(this.pos, this.color, 7, 0.3);
      }
    } else if (this.type === 'hunter') {
      // Telegraph, then dash straight through the player; repeat.
      this.subT -= dt;
      if (this.sub === 'idle') {
        this.pos.y += (this.restY - this.pos.y) * Math.min(1, dt * 3);
        if (this.subT <= 0) { this.sub = 'aim'; this.subT = 0.8; this.dashDir = dir.clone(); }
      } else if (this.sub === 'aim') {
        this.dashDir.lerp(dir, Math.min(1, dt * 2)).normalize();
        this.group.rotation.y = Math.atan2(this.dashDir.x, this.dashDir.z);
        if (this.subT <= 0) { this.sub = 'dash'; this.subT = 0.55; sfx.zip(); }
      } else if (this.sub === 'dash') {
        this.pos.addScaledVector(this.dashDir, 48 * dt);
        if (Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) < this.hitR + 1 && this.contactTimer <= 0) {
          this.contactTimer = 0.5; player.takeDamage(24);
        }
        if (this.subT <= 0) { this.sub = 'idle'; this.subT = 1.1; }
      }
    } else if (this.type === 'hive') {
      // Drift, periodically spit out fast drones.
      const want = 18;
      this.pos.addScaledVector(dir, (dist - want) * 0.35 * dt);
      this.pos.y += (this.restY - this.pos.y) * Math.min(1, dt * 2);
      this.atkTimer -= dt;
      if (this.atkTimer <= 0) {
        this.atkTimer = 3.0;
        for (let i = 0; i < 3; i++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6);
          enemies.spawnAt('runner', new THREE.Vector3(this.pos.x + off.x, 1, this.pos.z + off.z));
        }
        fx.flash(this.pos, this.color, 6, 0.3);
      }
    } else if (this.type === 'monolith') {
      // Slow stalk; periodic ground-slam shockwave.
      this.subT -= dt;
      if (this.sub === 'idle') {
        this.pos.addScaledVector(dir, 2.4 * dt);
        if (this.subT <= 0) { this.sub = 'tele'; this.subT = 0.9; fx.groundRing(this.pos, this.color, 9, 0.9); }
      } else if (this.sub === 'tele') {
        if (this.subT <= 0) {
          this.sub = 'idle'; this.subT = 3.2;
          fx.groundRing(this.pos, this.color, 11, 0.5); fx.flash(this.pos, this.color, 10, 0.4);
          const d2 = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
          if (d2 < 11 && player.pos.y < 3) player.takeDamage(30);
        }
      }
    } else if (this.type === 'aegis') {
      // Shielded fortress: hover, regen shield when left alone, keep summoning guards.
      const want = 20;
      this.pos.addScaledVector(dir, (dist - want) * 0.4 * dt);
      this.pos.x += -dir.z * 1.5 * dt; this.pos.z += dir.x * 1.5 * dt;
      this.pos.y += (this.restY - this.pos.y) * Math.min(1, dt * 2);
      this.hitClock += dt;
      if (this.shield < this.shieldMax && this.hitClock > 3.5) this.shield = Math.min(this.shieldMax, this.shield + (this.shieldMax / 7) * dt);
      this.atkTimer -= dt;
      if (this.atkTimer <= 0) {
        this.atkTimer = 5.0;
        enemies.spawnAt('warden', new THREE.Vector3(this.pos.x + (Math.random() - 0.5) * 6, 1, this.pos.z + (Math.random() - 0.5) * 6));
        enemies.spawnAt('bomber', new THREE.Vector3(this.pos.x + (Math.random() - 0.5) * 6, 1, this.pos.z + (Math.random() - 0.5) * 6));
        fx.flash(this.pos, this.color, 7, 0.3);
      }
    } else if (this.type === 'streetcar') {
      // The Red Rocket: telegraph a line, then barrel across the arena.
      this.pos.y += (this.restY - this.pos.y) * Math.min(1, dt * 3);
      this.subT -= dt;
      if (this.sub === 'idle') {
        if (this.subT <= 0) { this.sub = 'aim'; this.subT = 0.9; this.dashDir = dir.clone(); }
      } else if (this.sub === 'aim') {
        this.dashDir.lerp(dir, Math.min(1, dt * 2)).normalize();
        this.group.rotation.y = Math.atan2(this.dashDir.x, this.dashDir.z);
        if (this.subT <= 0) { this.sub = 'charge'; this.subT = 1.1; sfx.over(); }
      } else if (this.sub === 'charge') {
        this.pos.addScaledVector(this.dashDir, 40 * dt);
        fx.groundRing(this.pos, this.color, this.hitR + 1.5, 0.3);
        if (Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) < this.hitR + 2 && this.contactTimer <= 0) {
          this.contactTimer = 0.5; player.takeDamage(this.touch);
        }
        if (this.subT <= 0) { this.sub = 'idle'; this.subT = 1.4; }
      }
    } else if (this.type === 'tesla') {
      // Dynamo: drifts into range, sweeps a rotating beam + periodic shockwave rings.
      if (dist > 12) this.pos.addScaledVector(dir, 2.2 * dt);
      this.pos.y += (this.restY - this.pos.y) * Math.min(1, dt * 2);
      this.beamPivot.rotation.y += dt * 1.1;
      const toPlayer = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      let diff = Math.abs(((this.beamPivot.rotation.y - toPlayer + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (diff < 0.18 && dist < 16 && this.contactTimer <= 0) { this.contactTimer = 0.4; player.takeDamage(16); }
      this.atkTimer -= dt;
      if (this.atkTimer <= 0) { this.atkTimer = 3.6; this.ringT = 0.7; fx.groundRing(new THREE.Vector3(this.pos.x, 0, this.pos.z), this.color, 13, 0.7); }
      if (this.ringT > 0) {
        this.ringT -= dt;
        if (this.ringT <= 0 && dist < 13 && player.pos.y < 3) { player.takeDamage(20); this.ringT = 0; }
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
