import * as THREE from '../vendor/three.module.js';
import { ENEMY, ENEMY_TYPES, WEAPON, WAVES, PLAYER, PROJECTILE, PALETTE,
         SWARM_PACK, BOMB, WARDEN, MORTAR, PULSAR, GUARD, NECRO } from './config.js';
import { glowSprite } from './effects.js';
import { raycastWorld } from './raycast.js';
import { Boss, bossTypeForWave } from './boss.js';
import { sfx } from './audio.js';

const ENEMY_CLIMB = 8.5; // vertical climb/descend speed as enemies ride terrain
function hoverFor(r) { return Math.max(0.95, r + 0.35); }

const _up = new THREE.Vector3(0, 1, 0);
const _tmp = new THREE.Vector3();

// Each enemy type gets a distinct, animated composite silhouette.
// Exported so reanimated allies can reuse the same shapes with a friendly tint.
export function buildModel(key, def, glowTex) {
  const r = def.radius;
  const g = new THREE.Group();
  const fill = () => new THREE.MeshBasicMaterial({ color: 0x140810 });
  const emat = (op = 0.95) => new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: op, blending: THREE.AdditiveBlending });
  const wire = (geo, op) => new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat(op));
  const solid = (geo) => new THREE.Mesh(geo, fill());
  const glow = glowSprite(glowTex, def.color, r * 3.0);
  let animate;

  if (key === 'runner') {
    // A dart that points where it's going.
    const cone = new THREE.ConeGeometry(r * 0.8, r * 2.8, 4);
    const core = solid(cone), e = wire(cone, 0.95);
    core.rotation.x = Math.PI / 2; e.rotation.x = Math.PI / 2;
    const spin = new THREE.Group(); spin.add(core, e);
    g.add(spin, glow);
    animate = (dt, en, dir) => {
      if (dir) g.rotation.y = Math.atan2(dir.x, dir.z);
      spin.rotation.z += dt * 9;
    };
  } else if (key === 'brute') {
    // Heavy spiked mine.
    const box = new THREE.BoxGeometry(r * 1.25, r * 1.25, r * 1.25);
    const shell = new THREE.Group();
    shell.add(solid(box), wire(box, 0.95));
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const sg = new THREE.ConeGeometry(r * 0.38, r * 0.95, 4);
      const sp = solid(sg), se = wire(sg, 0.9);
      const q = new THREE.Quaternion().setFromUnitVectors(_up, _tmp.set(x, y, z));
      sp.quaternion.copy(q); se.quaternion.copy(q);
      sp.position.set(x * r, y * r, z * r); se.position.copy(sp.position);
      shell.add(sp, se);
    }
    g.add(shell, glow);
    animate = (dt, en) => { shell.rotation.y += dt * 0.8; shell.rotation.x += dt * 0.35; glow.scale.setScalar(r * 3 * (1 + 0.1 * Math.sin(en.bob * 4))); };
  } else if (key === 'shooter') {
    // Floating eye with orbiting rings that flare before it fires.
    const ico = new THREE.IcosahedronGeometry(r, 0);
    const spin = new THREE.Group(); spin.add(solid(ico), wire(ico, 0.95));
    const ringMat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.55, r * 0.07, 8, 30), ringMat);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(r * 1.55, r * 0.07, 8, 30), ringMat.clone());
    ring2.rotation.y = Math.PI / 2;
    g.add(spin, ring, ring2, glow);
    animate = (dt, en) => {
      spin.rotation.y += dt * 1.0; spin.rotation.x += dt * 0.5;
      ring.rotation.x += dt * 1.6; ring.rotation.z += dt * 0.8;
      ring2.rotation.y += dt * 1.3; ring2.rotation.x += dt * 0.5;
      const k = 1 - Math.min(1, en.shootTimer / 0.5);   // flare as the shot nears
      glow.scale.setScalar(r * 3 * (1 + 0.5 * k));
      ringMat.opacity = 0.55 + 0.45 * k;
    };
  } else if (key === 'blinker') {
    // Interpenetrating tetrahedra (a star) that flickers.
    const tg = new THREE.TetrahedronGeometry(r * 1.2);
    const spin = new THREE.Group();
    const e1 = wire(tg, 0.95), e2 = wire(tg, 0.95);
    const c1 = solid(tg), c2 = solid(tg);
    c2.rotation.set(Math.PI, Math.PI / 3, 0); e2.rotation.copy(c2.rotation);
    spin.add(c1, e1, c2, e2);
    g.add(spin, glow);
    animate = (dt, en) => {
      spin.rotation.y += dt * 3.2; spin.rotation.x += dt * 1.8;
      const fl = 0.5 + 0.5 * Math.abs(Math.sin(en.bob * 9));
      e1.material.opacity = fl; e2.material.opacity = fl; glow.material.opacity = fl;
    };
  } else if (key === 'swarm') { // tiny fast gnat
    const tg = new THREE.TetrahedronGeometry(r * 1.3);
    const spin = new THREE.Group(); spin.add(solid(tg), wire(tg, 0.95));
    g.add(spin, glow);
    animate = (dt) => { spin.rotation.y += dt * 9; spin.rotation.x += dt * 6; };
  } else if (key === 'bomber') { // volatile core that flashes as it primes
    const oct = new THREE.OctahedronGeometry(r, 0);
    const spin = new THREE.Group(); spin.add(solid(oct), wire(oct, 0.95));
    const shell = wire(new THREE.BoxGeometry(r * 1.3, r * 1.3, r * 1.3), 0.5);
    g.add(spin, shell, glow);
    animate = (dt, en) => {
      spin.rotation.y += dt * 2.5; shell.rotation.x -= dt * 1.5;
      const f = en.fuse > 0 ? (1 + 0.4 * Math.sin(en.fuse * 45)) : 1;
      glow.scale.setScalar(r * 3 * f);
    };
  } else if (key === 'warden') { // support: visible force-field dome
    const ico = new THREE.IcosahedronGeometry(r, 0);
    const spin = new THREE.Group(); spin.add(solid(ico), wire(ico, 0.95));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.7, 0.07, 8, 30), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(WARDEN.radius, 20, 14),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
    g.add(spin, ring, dome, glow);
    animate = (dt, en) => { spin.rotation.y += dt * 1.0; ring.rotation.x += dt * 1.6; ring.rotation.z += dt * 0.6; dome.material.opacity = 0.05 + 0.03 * (0.5 + 0.5 * Math.sin(en.bob * 2)); };
  } else if (key === 'mortar') { // artillery barrel
    const cone = new THREE.ConeGeometry(r * 0.9, r * 2.2, 6);
    const spin = new THREE.Group(); const m = solid(cone), e2 = wire(cone, 0.95);
    spin.add(m, e2);
    g.add(spin, glow);
    animate = (dt, en) => { spin.rotation.y += dt * 1.2; const k = 1 - Math.min(1, (en.fireTimer || 9) / 0.6); glow.scale.setScalar(r * 3 * (1 + 0.4 * k)); };
  } else if (key === 'pulsar') { // shockwave emitter
    const oct = new THREE.OctahedronGeometry(r, 0);
    const spin = new THREE.Group(); spin.add(solid(oct), wire(oct, 0.95));
    const shell = wire(new THREE.IcosahedronGeometry(r * 1.6, 0), 0.4);
    g.add(spin, shell, glow);
    animate = (dt, en) => { spin.rotation.y += dt * 3; const k = 1 - Math.min(1, (en.pulseTimer || 9) / 0.6); shell.scale.setScalar(1 + 0.35 * k); glow.scale.setScalar(r * 3 * (1 + 0.6 * k)); };
  } else { // grunt — diamond in a counter-rotating wire shell
    const oct = new THREE.OctahedronGeometry(r, 0);
    const spin = new THREE.Group(); spin.add(solid(oct), wire(oct, 0.95));
    const shell = wire(new THREE.OctahedronGeometry(r * 1.5, 0), 0.38);
    g.add(spin, shell, glow);
    animate = (dt) => {
      spin.rotation.y += dt * 2.0; spin.rotation.x += dt * 0.8;
      shell.rotation.y -= dt * 1.2; shell.rotation.z += dt * 0.6;
    };
  }
  return { group: g, animate, glow };
}

class Enemy {
  constructor(scene, glowTex, typeKey, def, pos, hp, speed) {
    this.type = typeKey;
    this.def = def;
    this.behavior = def.behavior;
    this.radius = def.radius;
    this.damage = def.damage;
    this.color = def.color;
    this.hp = hp; this.maxHp = hp;
    this.speed = speed;
    this.hover = hoverFor(def.radius);
    this.pos = new THREE.Vector3(pos.x, this.hover, pos.z);
    this.contactTimer = 0;
    this.bob = Math.random() * Math.PI * 2;
    this.shootTimer = (def.shootInterval || 2) * (0.4 + Math.random() * 0.6);
    this.blinkTimer = (def.blinkInterval || 2) * (0.5 + Math.random() * 0.6);
    this.shield = 0;                                             // set each frame by wardens
    this.fuse = 0;                                               // bomber priming timer
    this.fireTimer = MORTAR.interval * (0.5 + Math.random() * 0.6);
    this.pulseTimer = PULSAR.interval * (0.5 + Math.random() * 0.6);

    const model = buildModel(typeKey, def, glowTex);
    this.group = model.group;
    this.animateModel = model.animate;
    this.glow = model.glow;
    this.group.position.copy(this.pos);
    scene.add(this.group);
    this.scene = scene;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}

export class Enemies {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.glowTex = effects.glowTex;
    this.list = [];
    this.projectiles = [];
    this.strikes = [];        // telegraphed mortar AoE zones
    this.boss = null;
    this.player = null;
    this.pendingCharge = 0;   // weighted charge for the Pressa bar (read+reset by main)
    this.world = null;
    this.onWaveStart = null;
    this.onPlayerHurt = null;
    this.onBoss = null;       // (name) => void, when a bossman spawns
    this.onKill = null;       // (pos) => void, when the player destroys an enemy
    this.onReanimate = null;  // (data) => void, when the necro dagger kills an enemy
    this.allies = null;       // Allies manager (set in necro mode); enemies fight these too
    this.reset();
  }

  reset() {
    for (const e of this.list) e.dispose();
    for (const p of this.projectiles) this.scene.remove(p.group);
    if (this.boss) this.boss.dispose();
    this.list = [];
    this.projectiles = [];
    this.strikes = [];
    this.boss = null;
    this._bossSpawned = false;
    this.pendingCharge = 0;
    this.state = 'intermission';
    this.wave = 0;
    this.score = 0;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.intermission = WAVES.firstIntermission;
  }

  bind(world) { this.world = world; }
  bindAllies(allies) { this.allies = allies; }

  // The hostile an enemy fights: the player by default, or a nearby ally if one is
  // closer (the player is slightly preferred so enemies still press toward you).
  _threat(e, player) {
    let best = { pos: player.pos, hostile: player, radius: player.hitRadius || PLAYER.radius };
    const allies = this.allies;
    if (allies && allies.list.length) {
      let bd = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z) * NECRO.playerBias;
      for (const a of allies.list) {
        const d = Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z);
        if (d < bd && d < NECRO.enemyAggroAlly) { bd = d; best = { pos: a.pos, hostile: a, radius: a.radius }; }
      }
    }
    return best;
  }

  get remaining() { return this.toSpawn + this.list.length + (this.bossAlive ? 1 : 0); }
  get bossAlive() { return !!this.boss && !this.boss.dead; }

  // Weighted roster that unlocks tougher types as difficulty climbs.
  _pickType() {
    const w = this._diff;
    const weights = { grunt: w >= 5 ? 0.7 : 1 };
    if (w >= 2) weights.runner = 0.55;
    if (w >= 3) { weights.runner = 0.75; weights.swarm = 0.5; }
    if (w >= 4) weights.brute = 0.35;
    if (w >= 5) { weights.shooter = 0.45; weights.bomber = 0.35; }
    if (w >= 6) { weights.blinker = 0.4; weights.warden = 0.25; }
    if (w >= 7) { weights.mortar = 0.3; weights.pulsar = 0.3; }
    let total = 0; for (const k in weights) total += weights[k];
    let r = Math.random() * total;
    for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
    return 'grunt';
  }

  _beginWave() {
    this.wave += 1;
    this._diff = this.wave + WAVES.difficultyOffset; // round 1 already feels like wave 4
    const d = this._diff;
    this.toSpawn = WAVES.baseCount + WAVES.perWave * (d - 1);
    this.spawnTimer = 0;
    this.state = 'active';
    this._hpScale = 1 + ENEMY.hpScalePerWave * (d - 1);
    this._speedScale = Math.min(ENEMY.speedScaleCap, 1 + ENEMY.speedScalePerWave * (d - 1));
    this._bossSpawned = false;
    sfx.wave();
    this.onWaveStart?.(this.wave);
  }

  _spawnOne(playerPos) {
    const key = this._pickType();
    if (key === 'swarm') { // swarmlings arrive as a pack
      const base = this.world.spawnPoint(playerPos);
      for (let i = 0; i < SWARM_PACK; i++) {
        this.spawnAt('swarm', new THREE.Vector3(base.x + (Math.random() - 0.5) * 6, 0, base.z + (Math.random() - 0.5) * 6));
      }
    } else {
      this.spawnAt(key, this.world.spawnPoint(playerPos));
    }
  }

  // Spawn a specific enemy type at a position (used by _spawnOne and boss adds).
  spawnAt(key, pos) {
    const def = ENEMY_TYPES[key];
    const hp = Math.round(def.hp * (this._hpScale || 1));
    const speed = def.speed * (this._speedScale || 1);
    this.list.push(new Enemy(this.scene, this.glowTex, key, def, pos, hp, speed));
  }

  _spawnBoss(player) {
    this.boss = new Boss(this.scene, this.glowTex, bossTypeForWave(this.wave), this.wave, player);
    this.onBoss?.(this.boss.name);
  }

  _spawnProjectile(from, target, speed, damage, color) {
    const dir = target.clone().sub(from).normalize();
    const geo = new THREE.SphereGeometry(PROJECTILE.radius, 10, 10);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color })));
    group.add(glowSprite(this.glowTex, color, PROJECTILE.radius * 6));
    group.position.copy(from);
    this.scene.add(group);
    this.projectiles.push({ pos: from.clone(), vel: dir.multiplyScalar(speed), life: PROJECTILE.life, damage, group });
    sfx.eshoot();
  }

  // Mortar: a ground ring telegraphs (expands over warnTime), then detonates as AoE.
  _spawnStrike(x, z, color) {
    this.effects.groundRing(new THREE.Vector3(x, 0, z), color, MORTAR.radius, MORTAR.warnTime);
    this.strikes.push({ x, z, color, t: 0 });
  }

  _updateStrikes(dt, player) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t += dt;
      if (s.t >= MORTAR.warnTime) {
        this.effects.flash(new THREE.Vector3(s.x, 0.6, s.z), s.color, 9, 0.4);
        if (Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < MORTAR.radius && player.pos.y < 3) {
          player.takeDamage(MORTAR.damage); this.onPlayerHurt?.();
        }
        if (this.allies) for (const a of this.allies.list) {
          if (Math.hypot(a.pos.x - s.x, a.pos.z - s.z) < MORTAR.radius) a.takeDamage(MORTAR.damage);
        }
        this.strikes.splice(i, 1);
      }
    }
  }

  // Circle-vs-AABB push-out so grounded non-climbers can't enter or scale structures.
  _blockStructures(e) {
    const r = e.radius;
    for (const c of this.world.colliders) {
      if (c.boundary || c.max.y <= e.hover - 0.1) continue;
      const cx = Math.max(c.min.x, Math.min(e.pos.x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(e.pos.z, c.max.z));
      const dx = e.pos.x - cx, dz = e.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) { e.pos.x = cx + (dx / d) * r; e.pos.z = cz + (dz / d) * r; }
      else if (d <= 1e-4) { e.pos.x = c.max.x + r; }
    }
  }

  // Bomber detonation — AoE that hurts the player and can chain even on a close kill.
  _detonateBomber(e, player, byPlayer) {
    this.effects.flash(e.pos.clone(), e.color, 11, 0.45);
    this.effects.groundRing(e.pos.clone(), e.color, BOMB.radius, 0.45);
    this.effects.burst(e.pos, e.color);
    if (player) {
      const d = Math.hypot(player.pos.x - e.pos.x, (player.pos.y + PLAYER.height * 0.5) - e.pos.y, player.pos.z - e.pos.z);
      if (d < BOMB.radius + (player.hitRadius || PLAYER.radius)) { player.takeDamage(BOMB.damage); this.onPlayerHurt?.(); }
    }
    if (this.allies) for (const a of this.allies.list) { // bombs catch the horde too
      if (Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z) < BOMB.radius + a.radius) a.takeDamage(BOMB.damage);
    }
    if (byPlayer) this.onKill?.(e.pos);
    e.dispose();
    const i = this.list.indexOf(e); if (i >= 0) this.list.splice(i, 1);
    if (byPlayer) { this.score += 1; this.pendingCharge += e.maxHp; }
    sfx.kill();
  }

  update(dt, player, t, hazardZones) {
    this._hazardZones = hazardZones;
    this.player = player;
    if (this.state === 'intermission') {
      this.intermission -= dt;
      if (this.intermission <= 0) this._beginWave();
    } else {
      this.spawnTimer -= dt;
      if (this.toSpawn > 0 && this.spawnTimer <= 0) {
        this._spawnOne(player.pos);
        this.toSpawn -= 1;
        this.spawnTimer = WAVES.spawnInterval;
      }
      for (const e of this.list) e.shield = 0;                 // wardens re-apply below
      for (let i = this.list.length - 1; i >= 0; i--) this._updateEnemy(this.list[i], dt, player); // reverse: bombers may remove themselves

      const addsClear = this.toSpawn === 0 && this.list.length === 0;
      // The bossman only arrives once every regular enemy is cleared.
      if (addsClear && !this._bossSpawned) { this._bossSpawned = true; this._spawnBoss(player); }
      if (this.boss) {
        this.boss.update(dt, player, this);
        if (this.boss.gone) { this.pendingCharge += this.boss.maxHp * 0.6; this.boss.dispose(); this.boss = null; }
      }
      // Wave clears once the adds are gone AND the bossman has been slain and faded.
      if (addsClear && this._bossSpawned && !this.boss) {
        this.state = 'intermission';
        this.intermission = WAVES.intermission;
      }
    }
    this._updateStrikes(dt, player);
    this._updateProjectiles(dt, player);
  }

  _updateEnemy(e, dt, player) {
    const tgt = this._threat(e, player);       // player, or a nearby ally
    const tp = tgt.pos;
    const dx = tp.x - e.pos.x;
    const dz = tp.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = dx / d, nz = dz / d;

    const b = e.behavior;
    if (b === 'ranged' || b === 'mortar') {
      const def = e.def, standoff = def.standoff;
      let dir = 0;
      if (d < standoff * 0.8) dir = -1;        // too close → retreat
      else if (d > standoff * 1.2) dir = 1;    // too far → approach
      e.pos.x += nx * e.speed * dir * dt;
      e.pos.z += nz * e.speed * dir * dt;
      if (b === 'ranged') {
        e.shootTimer -= dt;
        if (e.shootTimer <= 0 && d < 46) {
          const target = new THREE.Vector3(tp.x, (tp.y || 0) + PLAYER.height * 0.5, tp.z);
          this._spawnProjectile(e.pos.clone(), target, def.projSpeed, def.projDamage, e.color);
          e.shootTimer = def.shootInterval * (0.8 + Math.random() * 0.5);
        }
      } else { // mortar — lob a telegraphed AoE strike at the target's feet
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && d < MORTAR.range) {
          this._spawnStrike(tp.x, tp.z, e.color);
          e.fireTimer = MORTAR.interval * (0.85 + Math.random() * 0.3);
          sfx.eshoot();
        }
      }
    } else if (b === 'bomber') {
      e.pos.x += nx * e.speed * dt;
      e.pos.z += nz * e.speed * dt;
      if (d < BOMB.trigger) {
        e.fuse += dt;
        if (e.fuse > BOMB.fuseTime) { this._detonateBomber(e, player, false); return; }
      }
    } else if (b === 'warden') {
      e.pos.x += nx * e.speed * dt;
      e.pos.z += nz * e.speed * dt;
      for (const o of this.list) {                 // shield nearby allies
        if (o === e) continue;
        if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < WARDEN.radius) o.shield = Math.max(o.shield, WARDEN.factor);
      }
    } else if (b === 'pulsar') {
      e.pos.x += nx * e.speed * dt;
      e.pos.z += nz * e.speed * dt;
      e.pulseTimer -= dt;
      if (e.pulseTimer <= 0) {
        this.effects.groundRing(e.pos.clone(), e.color, PULSAR.radius, 0.5);
        const h = tgt.hostile, hp = h.pos;
        if (Math.hypot(hp.x - e.pos.x, hp.z - e.pos.z) < PULSAR.radius && (hp.y || 0) < 3) {
          h.takeDamage(PULSAR.damage); if (h === player) this.onPlayerHurt?.();
        }
        e.pulseTimer = PULSAR.interval;
      }
    } else {
      // melee + swarm + teleport all chase
      let mx = nx, mz = nz;
      if (b === 'swarm') { const w = Math.sin(e.bob * 6) * 0.7; mx = nx - nz * w; mz = nz + nx * w; } // erratic weave
      e.pos.x += mx * e.speed * dt;
      e.pos.z += mz * e.speed * dt;
      if (b === 'teleport') {
        e.blinkTimer -= dt;
        if (e.blinkTimer <= 0 && d > 3) {
          const h = this.world.half - 3;
          const ang = Math.random() * Math.PI * 2;
          const rad = e.def.blinkRange * (0.5 + Math.random() * 0.5);
          this.effects.burst(e.pos, e.color);
          e.pos.x = Math.max(-h, Math.min(h, tp.x + Math.cos(ang) * rad));
          e.pos.z = Math.max(-h, Math.min(h, tp.z + Math.sin(ang) * rad));
          this.effects.burst(e.pos, e.color);
          e.blinkTimer = e.def.blinkInterval * (0.8 + Math.random() * 0.5);
          sfx.blink();
        }
      }
    }

    // Steer around active spike patches (enemies don't nominally walk over spikes).
    if (this._hazardZones) {
      for (const z of this._hazardZones) {
        const zx = e.pos.x - z.x, zz = e.pos.z - z.z;
        const zd = Math.hypot(zx, zz), rr = z.r + e.radius + 0.5;
        if (zd < rr && zd > 1e-3) { e.pos.x = z.x + (zx / zd) * rr; e.pos.z = z.z + (zz / zd) * rr; }
      }
    }

    // Keep enemies inside the arena (retreating shooters / blinks can't leave).
    const lim = this.world.half - e.radius - 0.3;
    e.pos.x = Math.max(-lim, Math.min(lim, e.pos.x));
    e.pos.z = Math.max(-lim, Math.min(lim, e.pos.z));

    // Movement up/down: climbers ride terrain; non-climbers stay grounded and are
    // blocked by building footprints (runners/swarms can't scale structures).
    e.bob += dt;
    let targetY;
    if (e.def.climber === false) {
      this._blockStructures(e);
      targetY = e.hover;
    } else {
      targetY = this.world.terrainHeight(e.pos.x, e.pos.z) + e.hover;
    }
    const dy = targetY - e.pos.y;
    e.pos.y += Math.sign(dy) * Math.min(Math.abs(dy), ENEMY_CLIMB * dt);
    e.group.position.set(e.pos.x, e.pos.y + Math.sin(e.bob * 3) * 0.14, e.pos.z);
    e.animateModel(dt, e, { x: nx, z: nz });

    // Contact damage against the current threat (player or an ally).
    if (e.contactTimer > 0) e.contactTimer -= dt;
    if (e.damage > 0) {
      const h = tgt.hostile, hp = h.pos;
      const horiz = Math.hypot(hp.x - e.pos.x, hp.z - e.pos.z);
      const vert = h === player
        ? (player.pos.y < e.pos.y + e.radius && player.pos.y + PLAYER.height > e.pos.y - e.radius)
        : Math.abs((hp.y || 0) - e.pos.y) < e.radius + (tgt.radius || 1) + 1.5;
      if (horiz < (tgt.radius || 0.6) + e.radius && vert && e.contactTimer <= 0) {
        e.contactTimer = ENEMY.contactInterval;
        if (h === player && this._guardBlocks(player, e.pos, GUARD.meleeArc)) {
          // Parried: no damage, shove the attacker back off the blade.
          const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z, d = Math.hypot(dx, dz) || 1;
          e.pos.x += (dx / d) * 1.4; e.pos.z += (dz / d) * 1.4;
          this.effects.burst(e.pos.clone(), 0x7cf2ff);
          sfx.swap();
        } else {
          h.takeDamage(e.damage);
          if (h === player) { sfx.hurt(); this.onPlayerHurt?.(); }
          else this.effects.burst(e.pos.clone(), e.color);
        }
      }
    }
  }

  // True if the player is guarding and `srcPos` lies within the frontal guard arc.
  _guardBlocks(player, srcPos, arc = GUARD.arcCos) {
    if (!player.guarding) return false;
    const dx = srcPos.x - player.pos.x, dz = srcPos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    return (dx / d) * player.guardDir.x + (dz / d) * player.guardDir.z >= arc;
  }

  _updateProjectiles(dt, player) {
    const h = this.world.half + 2;
    const cx = player.pos.x, cy = player.pos.y + PLAYER.height * 0.5, cz = player.pos.z;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.pos.addScaledVector(p.vel, dt);
      p.group.position.copy(p.pos);
      p.life -= dt;
      let consumed = false;

      if (p.reflected) {
        // Deflected shot: now hurts the enemies it strikes.
        for (const e of this.list) {
          if (Math.hypot(p.pos.x - e.pos.x, p.pos.y - e.pos.y, p.pos.z - e.pos.z) < e.radius + PROJECTILE.radius) {
            this._damage(e, p.damage, p.pos.clone());
            this.effects.burst(p.pos.clone(), 0x7cf2ff);
            consumed = true; break;
          }
        }
        if (!consumed && this.boss && !this.boss.dead &&
            Math.hypot(p.pos.x - this.boss.pos.x, p.pos.y - this.boss.pos.y, p.pos.z - this.boss.pos.z) < this.boss.hitR + PROJECTILE.radius) {
          this._damageBoss(p.damage, p.pos.clone()); consumed = true;
        }
      } else {
        const dPlayer = Math.hypot(p.pos.x - cx, p.pos.y - cy, p.pos.z - cz);
        // Guard bubble: swat frontal shots out of the air well before they land.
        if (player.guarding && dPlayer < GUARD.reach && this._guardBlocks(player, p.pos)) {
          // Reflect it back at the sender, re-owned by the player and stronger.
          p.vel.negate().multiplyScalar(GUARD.reflectSpeed);
          p.reflected = true;
          p.damage = Math.round(p.damage * GUARD.reflectDamage);
          p.life = PROJECTILE.life;
          p.group.children.forEach((o) => o.material?.color?.setHex(0x7cf2ff));
          this.effects.burst(p.pos.clone(), 0x7cf2ff);
          sfx.swap();
        } else if (dPlayer < (player.hitRadius || PLAYER.radius) + PROJECTILE.radius) {
          player.takeDamage(p.damage);
          sfx.hurt();
          this.onPlayerHurt?.();
          this.effects.burst(p.pos, p.group.children[0].material.color.getHex());
          consumed = true;
        } else if (this.allies) { // enemy shots also hit the horde
          for (const a of this.allies.list) {
            if (Math.hypot(p.pos.x - a.pos.x, p.pos.y - a.pos.y, p.pos.z - a.pos.z) < a.radius + PROJECTILE.radius) {
              a.takeDamage(p.damage);
              this.effects.burst(p.pos.clone(), p.group.children[0].material.color.getHex());
              consumed = true; break;
            }
          }
        }
      }

      const gone = p.life <= 0 || p.pos.y < 0 || Math.abs(p.pos.x) > h || Math.abs(p.pos.z) > h;
      if (consumed || gone) {
        this.scene.remove(p.group);
        p.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
        this.projectiles.splice(i, 1);
      }
    }
  }

  // Instantly destroy every enemy within `radius` of a point (portal-piped spikes).
  killNear(point, radius) {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (Math.hypot(e.pos.x - point.x, e.pos.y - point.y, e.pos.z - point.z) < radius + e.radius) {
        this._kill(e, true); n += 1;
      }
    }
    if (n) sfx.kill();
    return n;
  }

  // Pressa/Drizzy katana sweep: one-shot every enemy within `radius` of the player,
  // and deal heavy damage to the bossman. Returns the list of positions wiped (for the HUD).
  katanaSweep(player, radius) {
    const hits = [];
    const px = player.pos.x, py = player.pos.y + PLAYER.height * 0.5, pz = player.pos.z;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (Math.hypot(e.pos.x - px, e.pos.y - py, e.pos.z - pz) < radius + e.radius) {
        hits.push(e.pos.clone());
        this._kill(e, true);
      }
    }
    if (this.boss && !this.boss.dead) {
      const d = Math.hypot(this.boss.pos.x - px, this.boss.pos.y - py, this.boss.pos.z - pz);
      if (d < radius + this.boss.hitR + 1) { hits.push(this.boss.pos.clone()); this.boss.hit(this.boss.maxHp * 0.136, this.effects); }
    }
    if (hits.length) sfx.kill();
    return hits;
  }

  // neCROmancer dagger: short, weak melee. Any enemy it finishes is reanimated as an ally.
  daggerSweep(player, radius, damage) {
    const px = player.pos.x, py = player.pos.y + PLAYER.height * 0.5, pz = player.pos.z;
    let hit = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (Math.hypot(e.pos.x - px, e.pos.y - py, e.pos.z - pz) < radius + e.radius) {
        hit = true;
        e.hp -= damage * (1 - (e.shield || 0));
        if (e.hp <= 0) {
          this.onReanimate?.({ type: e.type, def: e.def, pos: e.pos.clone(), color: e.color, maxHp: e.maxHp, radius: e.radius, damage: e.damage });
          this._remove(e); // reanimated, not destroyed — no score/charge
        } else { this.effects.muzzle(e.pos.clone(), NECRO.allyColor); sfx.hit(); }
      }
    }
    if (this.boss && !this.boss.dead) {
      const d = Math.hypot(this.boss.pos.x - px, this.boss.pos.y - py, this.boss.pos.z - pz);
      if (d < radius + this.boss.hitR + 1) { this.boss.hit(damage, this.effects); hit = true; }
    }
    if (hit) sfx.slice();
    return hit;
  }

  _remove(e) {
    e.dispose();
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
  }

  _bossHitT(ray) {
    if (!this.boss || this.boss.dead) return null;
    const e = this.boss, hitR = e.hitR;
    const ocx = ray.origin.x - e.pos.x, ocy = ray.origin.y - e.pos.y, ocz = ray.origin.z - e.pos.z;
    const b = ocx * ray.dir.x + ocy * ray.dir.y + ocz * ray.dir.z;
    const c = ocx * ocx + ocy * ocy + ocz * ocz - hitR * hitR;
    const disc = b * b - c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t = -b - sq; if (t < 0) t = -b + sq;
    return t < 0 ? null : t;
  }

  _damageBoss(amount, point) {
    if (!this.boss || this.boss.dead) return;
    this.boss.hit(amount, this.effects);
    this.effects.muzzle(point, this.boss.color);
  }

  // The nearest enemy/boss under an aim ray that isn't occluded by world geometry.
  // Used by Drizzy missile lock-on. Returns the target object or null.
  aimTarget(ray, range = WEAPON.range) {
    const wall = this.world ? raycastWorld(ray, this.world, range) : null;
    const limit = wall ? wall.t : range;
    let best = null, bestT = limit;
    for (const e of this.list) {
      const t = this._rayHitT(ray, e);
      if (t == null || t > bestT) continue;
      bestT = t; best = e;
    }
    const bt = this._bossHitT(ray);
    if (bt != null && bt <= bestT) best = this.boss;
    return best;
  }

  // Missile lock: the enemy/boss nearest the aim direction within a cone, ignoring
  // walls (so you can lock around barriers — the missile arcs over/around them).
  lockTarget(ray, cone) {
    let best = null, bestAng = cone;
    const consider = (obj, pos, radius) => {
      const tx = pos.x - ray.origin.x, ty = pos.y - ray.origin.y, tz = pos.z - ray.origin.z;
      const dist = Math.hypot(tx, ty, tz); if (dist < 0.01) return;
      const dot = (tx * ray.dir.x + ty * ray.dir.y + tz * ray.dir.z) / dist;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot))) - Math.atan2(radius, dist); // forgive target size
      if (ang < bestAng) { bestAng = ang; best = obj; }
    };
    for (const e of this.list) consider(e, e.pos, e.radius);
    if (this.boss && !this.boss.dead) consider(this.boss, this.boss.pos, this.boss.hitR);
    return best;
  }

  // Is a lock target still valid (alive and present)?
  hasTarget(target) {
    if (!target) return false;
    if (target === this.boss) return !this.boss.dead;
    return this.list.indexOf(target) !== -1;
  }

  // Missile splash: damage every enemy + boss within radius of a point.
  splash(point, radius, damage) {
    for (const e of [...this.list]) {
      if (Math.hypot(e.pos.x - point.x, e.pos.y - point.y, e.pos.z - point.z) < radius + e.radius) {
        this._damage(e, damage, e.pos.clone());
      }
    }
    if (this.boss && !this.boss.dead && Math.hypot(this.boss.pos.x - point.x, this.boss.pos.y - point.y, this.boss.pos.z - point.z) < radius + this.boss.hitR) {
      this._damageBoss(damage, point);
    }
  }

  // Nearest hit distance along the ray for an enemy, or null. hitR forgives aim slightly.
  _rayHitT(ray, e) {
    const hitR = e.radius * 1.2;
    const ocx = ray.origin.x - e.pos.x, ocy = ray.origin.y - e.pos.y, ocz = ray.origin.z - e.pos.z;
    const b = ocx * ray.dir.x + ocy * ray.dir.y + ocz * ray.dir.z;
    const c = ocx * ocx + ocy * ocy + ocz * ocz - hitR * hitR;
    const disc = b * b - c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t = -b - sq;
    if (t < 0) t = -b + sq;
    return t < 0 ? null : t;
  }

  _damage(e, dmg, point) {
    e.hp -= dmg * (1 - (e.shield || 0));        // warden force field reduces incoming damage
    if (e.hp <= 0) {
      if (e.type === 'bomber') this._detonateBomber(e, this.player, true);
      else this._kill(e);
      return true;
    }
    this.effects.muzzle(point, e.color);
    sfx.hit();
    return false;
  }

  // Remove an enemy, award score + weighted Pressa charge.
  _kill(e, silent = false) {
    this.onKill?.(e.pos);
    this.effects.burst(e.pos, e.color);
    e.dispose();
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    this.score += 1;
    this.pendingCharge += e.maxHp;      // tougher enemies charge the bar faster
    if (!silent) sfx.kill();
  }

  // Hitscan occluded by world geometry. Options:
  //   damage, range, falloff {start,end,min}, pierce (hit every enemy along the ray).
  // Returns the world-space endpoint for a tracer.
  hitscan(ray, { damage = WEAPON.damage, range = WEAPON.range, falloff = null, pierce = false } = {}) {
    const wall = this.world ? raycastWorld(ray, this.world, range) : null;
    const limit = wall ? wall.t : range;
    const dmgAt = (t) => {
      if (!falloff) return damage;
      const k = Math.max(0, Math.min(1, (t - falloff.start) / (falloff.end - falloff.start)));
      return damage * (1 - k * (1 - falloff.min));
    };

    const bossT = this._bossHitT(ray);

    if (pierce) {
      let any = false;
      for (const e of [...this.list]) {           // copy: _damage may splice
        const t = this._rayHitT(ray, e);
        if (t == null || t > limit) continue;
        this._damage(e, dmgAt(t), ray.origin.clone().addScaledVector(ray.dir, t));
        any = true;
      }
      if (bossT != null && bossT <= limit) { this._damageBoss(dmgAt(bossT), ray.origin.clone().addScaledVector(ray.dir, bossT)); any = true; }
      return { end: ray.origin.clone().addScaledVector(ray.dir, limit), hit: any };
    }

    // Nearest target (enemy or boss).
    let best = null, bestT = limit;
    for (const e of this.list) {
      const t = this._rayHitT(ray, e);
      if (t == null || t > bestT) continue;
      bestT = t; best = e;
    }
    const bossClosest = bossT != null && bossT <= bestT;
    const end = ray.origin.clone().addScaledVector(ray.dir, bossClosest ? bossT : (best ? bestT : limit));
    if (bossClosest) { this._damageBoss(dmgAt(bossT), end); return { end, hit: true }; }
    if (best) this._damage(best, dmgAt(bestT), end);
    return { end, hit: !!best };
  }
}
