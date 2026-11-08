import * as THREE from '../vendor/three.module.js';
import { NECRO, PLAYER, POWER, WARDEN, MORTAR, PULSAR, BOMB } from './config.js';
import { buildModel } from './enemies.js';
import { glowSprite } from './effects.js';

const hoverFor = (r) => Math.max(0.95, r + 0.35);

// The necromancer's horde: enemies killed by the dagger are reanimated here, plus
// summoned GOLUMNs. Allies hunt enemies (hexed target first); enemies fight back.
export class Allies {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.glowTex = effects.glowTex;
    this.list = [];
    this.hex = null;            // the enemy the horde is focus-firing
    this._lastGolumn = null;    // last summoned variant (to avoid immediate repeats)
    this.world = null;
    this._buildHexMarker();
  }

  bind(world) { this.world = world; }

  reset() {
    for (const a of this.list) this._dispose(a);
    this.list = [];
    this.hex = null;
    this._lastGolumn = null;
    this.hexMarker.visible = false;
  }

  _dispose(a) {
    this.scene.remove(a.group);
    a.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }

  _buildHexMarker() {
    const g = new THREE.Group();
    const cone = new THREE.ConeGeometry(0.7, 1.1, 4);
    const m = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0x120a16 }));
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(cone),
      new THREE.LineBasicMaterial({ color: NECRO.color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
    m.rotation.x = Math.PI; e.rotation.x = Math.PI; // point down at the target
    g.add(m, e, glowSprite(this.glowTex, NECRO.color, 3.2));
    g.visible = false;
    this.scene.add(g);
    this.hexMarker = g;
  }

  // ---- spawning ----
  reanimate(data) {
    const def = { ...data.def, color: NECRO.allyColor };
    const model = buildModel(data.type, def, this.glowTex);
    const hover = hoverFor(data.radius);
    const hpVal = Math.round(data.maxHp * NECRO.allyHpMul);
    const a = this._makeAlly({
      kind: 'reanimated', group: model.group, animateModel: model.animate, color: NECRO.allyColor,
      radius: data.radius, hover, behavior: data.def.behavior, def: data.def, fuse: 0,
      hp: hpVal, maxHp: hpVal, damage: Math.max(data.damage, NECRO.allyMinDamage),
      speed: NECRO.allySpeed, pos: new THREE.Vector3(data.pos.x, hover, data.pos.z),
    });
    this.scene.add(a.group);
    this.effects.burst(a.pos.clone(), NECRO.allyColor);
    this.list.push(a);
    return a;
  }

  summonGolumn(pos, variant) {
    const cfg = NECRO.golumn;
    if (!variant) { // random, but never the same type twice in a row
      const pool = ['beam', 'fire', 'heal'].filter((v) => v !== this._lastGolumn);
      variant = pool[(Math.random() * pool.length) | 0];
    }
    this._lastGolumn = variant;
    const col = variant === 'fire' ? cfg.fireColor : variant === 'heal' ? cfg.healColor : cfg.beamColor;
    const g = new THREE.Group();
    const dark = new THREE.MeshBasicMaterial({ color: 0x120a16 });
    const edge = (op = 0.95) => new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending });
    const edged = (geo, x, y, z) => { const m = new THREE.Mesh(geo, dark); m.position.set(x, y, z);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge()); e.position.copy(m.position); g.add(m, e); return m; };
    const bright = (geo, op = 0.85, c = col) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending }));
    let animate, bodyY;

    if (variant === 'beam') {            // a floating obelisk sentinel — a focusing crystal
      bodyY = 2.5;
      edged(new THREE.CylinderGeometry(0.05, 0.05, bodyY, 6), 0, bodyY / 2, 0);     // energy tether to the ground
      const shard = edged(new THREE.OctahedronGeometry(0.95), 0, bodyY, 0); shard.scale.y = 1.9;
      const core = bright(new THREE.OctahedronGeometry(0.42)); core.position.y = bodyY; g.add(core);
      const ring = bright(new THREE.TorusGeometry(1.35, 0.05, 8, 30), 0.6); ring.rotation.x = Math.PI / 2; ring.position.y = bodyY; g.add(ring);
      const ring2 = bright(new THREE.TorusGeometry(1.0, 0.04, 8, 30), 0.5); ring2.position.y = bodyY; g.add(ring2);
      animate = (dt, self) => { shard.rotation.y += dt * 0.8; ring.rotation.z += dt * 1.2; ring2.rotation.y += dt * 1.4; core.scale.setScalar(1 + 0.14 * Math.sin(self.bob * 4)); };
    } else if (variant === 'fire') {     // a squat molten brute — a cracked magma boulder
      bodyY = 1.4;
      const rock = edged(new THREE.IcosahedronGeometry(1.5, 0), 0, bodyY, 0);
      const coreF = bright(new THREE.IcosahedronGeometry(1.05, 0), 0.5, 0xffd089); coreF.position.y = bodyY; g.add(coreF);
      for (let k = 0; k < 6; k++) { const a2 = (k / 6) * Math.PI * 2; const v = edged(new THREE.ConeGeometry(0.26, 0.8, 4), Math.cos(a2) * 1.25, bodyY + 0.55, Math.sin(a2) * 1.25); v.rotation.x = -0.5; }
      animate = (dt, self, dir) => { if (dir) g.rotation.y = Math.atan2(dir.x, dir.z); rock.rotation.y += dt * 0.4; const p = 0.5 + 0.5 * Math.sin(self.bob * 6); coreF.scale.setScalar(1 + 0.15 * p); coreF.material.opacity = 0.35 + 0.3 * p; };
    } else {                             // a floating halo totem — serene healer
      bodyY = 2.2;
      edged(new THREE.CylinderGeometry(0.045, 0.045, bodyY, 6), 0, bodyY / 2, 0);  // tether
      const core = bright(new THREE.SphereGeometry(0.5, 16, 12)); core.position.y = bodyY; g.add(core);
      const halo = bright(new THREE.TorusGeometry(1.5, 0.06, 8, 32), 0.6); halo.rotation.x = Math.PI / 2; halo.position.y = bodyY; g.add(halo);
      const halo2 = bright(new THREE.TorusGeometry(1.1, 0.05, 8, 32), 0.5); halo2.position.y = bodyY; g.add(halo2);
      const motes = []; for (let k = 0; k < 4; k++) { const mt = glowSprite(this.glowTex, col, 0.9); g.add(mt); motes.push(mt); }
      animate = (dt, self) => {
        halo.rotation.z += dt * 0.6; halo2.rotation.y += dt * 0.9; core.scale.setScalar(1 + 0.1 * Math.sin(self.bob * 3));
        motes.forEach((mt, k) => { const ang = self.bob * 1.6 + k * (Math.PI / 2); mt.position.set(Math.cos(ang) * 1.5, bodyY + Math.sin(self.bob * 2 + k) * 0.3, Math.sin(ang) * 1.5); });
      };
    }
    g.add(glowSprite(this.glowTex, col, variant === 'fire' ? 6 : 5));
    const shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(variant === 'fire' ? 2.1 : 1.9, 16, 12),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    shieldMesh.position.y = bodyY; g.add(shieldMesh);
    g.position.set(pos.x, 0, pos.z);
    this.scene.add(g);
    const a = this._makeAlly({
      kind: 'golumn', variant, color: col, group: g, radius: cfg.radius, hover: 0, grounded: true,
      hp: cfg.hp, maxHp: cfg.hp, damage: cfg.melee, speed: cfg.speed, pos: new THREE.Vector3(pos.x, 0, pos.z),
      shield: cfg.shield, shieldMax: cfg.shield, shieldMesh, facing: 0, fireTimer: 0, healTimer: cfg.healInterval,
      animateModel: animate,
    });
    this.list.push(a);
    this.effects.flash(a.pos.clone().setY(bodyY), col, 14, 0.5);
    return a;
  }

  _makeAlly(props) {
    return {
      shield: 0, shieldMax: 0, ward: 0, attackTimer: 0, rangedTimer: NECRO.golumn.rangedInterval, bob: Math.random() * 6,
      // defaults the reused enemy-model animators read (avoid NaN on shooter/blinker types)
      shootTimer: 1.2, blinkTimer: 2, pulseTimer: 1.5, fuse: 0,
      ...props,
      takeDamage(amount) {
        if (this.ward) amount *= (1 - this.ward);                 // warden aura reduces incoming
        if (this.shield > 0) { const a = Math.min(this.shield, amount); this.shield -= a; amount -= a; }
        if (amount > 0) this.hp -= amount;
      },
    };
  }

  // ---- hex ----
  setHex(enemy) { this.hex = enemy || null; }

  // ---- per-frame ----
  update(dt, enemies, player, worldTime) {
    // Drop the hex if its target is gone.
    for (const a of this.list) a.ward = 0; // wardens re-apply below
    if (this.hex && (this.hex.dead || enemies.list.indexOf(this.hex) === -1)) this.hex = null;
    if (this.hex) {
      this.hexMarker.visible = true;
      this.hexMarker.position.set(this.hex.pos.x, this.hex.pos.y + this.hex.radius + 2.0 + Math.sin(worldTime * 4) * 0.15, this.hex.pos.z);
      this.hexMarker.rotation.y += dt * 2;
    } else this.hexMarker.visible = false;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      a.bob += dt;
      if (a.hp <= 0) { this.effects.burst(a.pos.clone(), a.kind === 'golumn' ? NECRO.golumnColor : NECRO.allyColor); this._dispose(a); this.list.splice(i, 1); continue; }

      const target = this._targetFor(a, enemies);
      if (!target) { // no foes: heal golumns still mend; everyone holds position
        if (a.kind === 'golumn' && a.variant === 'heal') this._golumnHeal(a, dt, player);
        this._settle(a, dt); continue;
      }

      const dx = target.pos.x - a.pos.x, dz = target.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const nx = dx / d, nz = dz / d;
      const reach = a.radius + target.radius;
      const beh = a.behavior;
      const standoff = (beh === 'ranged' || beh === 'mortar') ? (a.def.standoff || 20) : 0;

      // --- movement ---
      if (standoff) {                                     // ranged types keep their distance
        const dir = d < standoff * 0.8 ? -1 : d > standoff * 1.2 ? 1 : 0;
        a.pos.x += nx * a.speed * dir * dt; a.pos.z += nz * a.speed * dir * dt;
      } else if (d > reach) {                             // chargers close to melee
        a.pos.x += nx * a.speed * dt; a.pos.z += nz * a.speed * dt;
      }

      // --- melee (everyone but ranged/mortar) ---
      if (!standoff) {
        a.attackTimer -= dt;
        if (d < reach + 0.4 && a.attackTimer <= 0) {
          a.attackTimer = a.kind === 'golumn' ? NECRO.golumn.meleeInterval : NECRO.allyContact;
          this._hit(enemies, target, a.damage, target.pos.clone());
          this.effects.burst(target.pos.clone(), a.color || NECRO.allyColor);
        }
      }

      // --- special ability, matching the unit's living behavior ---
      if (a.kind === 'golumn') this._golumnAct(a, dt, enemies, player, nx, nz);
      else if (beh === 'ranged') this._allyRanged(a, dt, enemies, target, d);
      else if (beh === 'mortar') this._allyMortar(a, dt, enemies, target, d);
      else if (beh === 'pulsar') this._allyPulsar(a, dt, enemies);
      else if (beh === 'bomber') this._allyBomber(a, dt, enemies, d);
      else if (beh === 'warden') this._allyWarden(a);
      else if (beh === 'teleport') this._allyBlink(a, dt, target);

      // vertical placement: golumns stand, reanimated ride terrain like climbers
      const groundY = this.world ? this.world.terrainHeight(a.pos.x, a.pos.z) : 0;
      const ty = a.grounded ? groundY : groundY + a.hover;
      a.pos.y += Math.sign(ty - a.pos.y) * Math.min(Math.abs(ty - a.pos.y), 8.5 * dt);
      const lim = (this.world ? this.world.half : 52) - a.radius - 0.3;
      a.pos.x = Math.max(-lim, Math.min(lim, a.pos.x));
      a.pos.z = Math.max(-lim, Math.min(lim, a.pos.z));
      a.group.position.set(a.pos.x, a.pos.y + (a.grounded ? 0 : Math.sin(a.bob * 3) * 0.12), a.pos.z);
      a.animateModel?.(dt, a, { x: nx, z: nz });
    }
  }

  _settle(a, dt) { // no enemies: hold position with a little life
    const groundY = this.world ? this.world.terrainHeight(a.pos.x, a.pos.z) : 0;
    const ty = a.grounded ? groundY : groundY + a.hover;
    a.pos.y += Math.sign(ty - a.pos.y) * Math.min(Math.abs(ty - a.pos.y), 8.5 * dt);
    a.group.position.set(a.pos.x, a.pos.y + (a.grounded ? 0 : Math.sin(a.bob * 3) * 0.12), a.pos.z);
    a.animateModel?.(dt, a, null);
  }

  _hit(enemies, target, dmg, point) {
    if (target === enemies.boss) enemies._damageBoss(dmg, point);
    else enemies._damage(target, dmg, point);
  }

  // --- reanimated ability acts (each mirrors the living enemy, but damages enemies) ---
  _allyRanged(a, dt, enemies, target, d) {
    a.shootTimer -= dt;
    if (a.shootTimer <= 0 && d < 50) {
      a.shootTimer = (a.def.shootInterval || 2) * (0.8 + Math.random() * 0.4);
      this.effects.tracer(a.pos.clone().setY(a.pos.y + 0.4), target.pos.clone(), NECRO.allyColor);
      this._hit(enemies, target, a.def.projDamage || 12, target.pos.clone());
    }
  }
  _allyMortar(a, dt, enemies, target, d) {
    a.shootTimer -= dt;
    if (a.shootTimer <= 0 && d < MORTAR.range) {
      a.shootTimer = MORTAR.interval * (0.9 + Math.random() * 0.3);
      const p = target.pos.clone();
      this.effects.groundRing(new THREE.Vector3(p.x, 0, p.z), NECRO.allyColor, MORTAR.radius, 0.5);
      this.effects.flash(new THREE.Vector3(p.x, 0.6, p.z), NECRO.allyColor, 8, 0.4);
      enemies.splash(new THREE.Vector3(p.x, 1, p.z), MORTAR.radius, MORTAR.damage);
    }
  }
  _allyPulsar(a, dt, enemies) {
    a.pulseTimer -= dt;
    if (a.pulseTimer <= 0) {
      a.pulseTimer = PULSAR.interval;
      this.effects.groundRing(a.pos.clone(), NECRO.allyColor, PULSAR.radius, 0.5);
      enemies.splash(a.pos.clone().setY(1), PULSAR.radius, PULSAR.damage);
    }
  }
  _allyBomber(a, dt, enemies, d) {
    if (d >= BOMB.trigger) return;
    a.fuse += dt;
    if (a.fuse > BOMB.fuseTime) {
      this.effects.flash(a.pos.clone(), NECRO.allyColor, 11, 0.45);
      this.effects.groundRing(a.pos.clone(), NECRO.allyColor, BOMB.radius, 0.45);
      enemies.splash(a.pos.clone().setY(1), BOMB.radius, BOMB.damage);
      a.hp = 0; // kamikaze — removed next frame
    }
  }
  _allyWarden(a) {
    for (const o of this.list) {
      if (o === a) continue;
      if (Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z) < WARDEN.radius) o.ward = Math.max(o.ward || 0, WARDEN.factor);
    }
  }
  _allyBlink(a, dt, target) {
    a.blinkTimer -= dt;
    if (a.blinkTimer <= 0) {
      a.blinkTimer = (a.def.blinkInterval || 2.6) * (0.8 + Math.random() * 0.5);
      const ang = Math.random() * Math.PI * 2, rad = (a.def.blinkRange || 10) * 0.6;
      this.effects.burst(a.pos.clone(), NECRO.allyColor);
      a.pos.x = target.pos.x + Math.cos(ang) * rad; a.pos.z = target.pos.z + Math.sin(ang) * rad;
      this.effects.burst(a.pos.clone(), NECRO.allyColor);
    }
  }
  _golumnAct(a, dt, enemies, player, nx, nz) {
    const cfg = NECRO.golumn;
    if (a.variant === 'fire') this._golumnFire(a, dt, enemies, nx, nz);
    else if (a.variant === 'heal') this._golumnHeal(a, dt, player);
    else {
      a.rangedTimer -= dt;
      if (a.rangedTimer <= 0) {
        const rt = this._nearestEnemy(a, enemies, cfg.rangedRange);
        if (rt) { a.rangedTimer = cfg.rangedInterval; this.effects.beam(a.pos.clone().setY(2.4), rt.pos.clone(), cfg.beamColor, { radius: 0.09, life: 0.3 }); this._hit(enemies, rt, cfg.ranged, rt.pos.clone()); }
        else a.rangedTimer = 0.4;
      }
    }
    if (a.shieldMesh) a.shieldMesh.material.opacity = 0.05 + 0.18 * (a.shield / (a.shieldMax || 1));
  }

  // Flamethrower: a short forward cone (fx,fz = toward the target) that sears everything in it.
  _golumnFire(a, dt, enemies, fx, fz) {
    const cfg = NECRO.golumn;
    a.fireTimer -= dt;
    if (a.fireTimer > 0) return;
    a.fireTimer = cfg.fireTick;
    const origin = a.pos.clone().setY(1.7);
    for (let k = 0; k < 3; k++) { // flame particles along the cone
      const t = 0.4 + Math.random() * cfg.fireRange;
      const s = (Math.random() - 0.5) * cfg.fireArc;
      const dx = Math.cos(s) * fx - Math.sin(s) * fz, dz = Math.sin(s) * fx + Math.cos(s) * fz;
      this.effects.burst(origin.clone().add(new THREE.Vector3(dx * t, Math.random() * 1.6, dz * t)), cfg.fireColor);
    }
    for (const e of [...enemies.list]) {
      const ex = e.pos.x - a.pos.x, ez = e.pos.z - a.pos.z, dist = Math.hypot(ex, ez);
      if (dist > cfg.fireRange + e.radius || dist < 0.1) continue;
      if ((ex / dist) * fx + (ez / dist) * fz > Math.cos(cfg.fireArc)) this._hit(enemies, e, cfg.fireDamage, e.pos.clone());
    }
  }

  // Healing pulse: mends the necromancer and nearby allies (never above their max).
  _golumnHeal(a, dt, player) {
    const cfg = NECRO.golumn;
    a.healTimer -= dt;
    if (a.healTimer > 0) return;
    a.healTimer = cfg.healInterval;
    this.effects.groundRing(a.pos.clone(), cfg.healColor, cfg.healRadius * 0.5, 0.6);
    if (player && player.alive && Math.hypot(player.pos.x - a.pos.x, player.pos.z - a.pos.z) < cfg.healRadius) {
      let healed = false;
      if (player.health < PLAYER.maxHealth) { player.health = Math.min(PLAYER.maxHealth, player.health + cfg.healAmount); healed = true; }
      // top up the power-mode aux shield too (package modes only — not the infinite console mode)
      if (!player.invuln && player.auxHp > 0 && player.auxHp < POWER.auxHp) { player.auxHp = Math.min(POWER.auxHp, player.auxHp + cfg.healAmount); healed = true; }
      if (healed) this.effects.burst(player.pos.clone().setY(1), cfg.healColor);
    }
    for (const o of this.list) {
      if (o === a || o.hp >= o.maxHp) continue;
      if (Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z) < cfg.healRadius) {
        o.hp = Math.min(o.maxHp, o.hp + cfg.healAmount);
        this.effects.burst(o.pos.clone(), cfg.healColor);
      }
    }
  }

  _targetFor(a, enemies) {
    if (this.hex && enemies.list.indexOf(this.hex) !== -1) return this.hex;
    return this._nearestEnemy(a, enemies, Infinity);
  }

  _nearestEnemy(a, enemies, maxDist) {
    let best = null, bd = maxDist;
    for (const e of enemies.list) {
      const d = Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    if (enemies.boss && !enemies.boss.dead) {
      const d = Math.hypot(enemies.boss.pos.x - a.pos.x, enemies.boss.pos.z - a.pos.z);
      if (d < bd) best = enemies.boss; // allies will chip the bossman too
    }
    return best;
  }

  get count() { return this.list.length; }
}
