import * as THREE from '../vendor/three.module.js';
import { CIVIC, PALETTE } from './config.js';
import { glowSprite } from './effects.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);
// Heading → horizontal forward (matches the player's convention so yaw lines up).
const fwdFromYaw = (yaw, out) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));

// The impounded Honda Civic. A persistent world entity: spawns on activation, stays
// parked when you step out, and keeps its HP until it's re-entered or repossessed.
export class Civic {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.glowTex = effects.glowTex;
    this.group = null;
    this.alive = false;      // exists in the world
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.wheel = 0;          // visual steering angle (-1..1)
    this.hp = CIVIC.hp;
    this.maxHp = CIVIC.hp;
    this.invincible = false; // console-invoked: never repossessed
    this._fwd = new THREE.Vector3();
    this._wheels = [];
    this._ramClocks = new Map(); // enemy -> last-ram time
  }

  // Build the neon Civic — a sport-compact silhouette (front = local -z, so group.rotation.y = yaw aligns it).
  _build() {
    const g = new THREE.Group();
    const c = CIVIC.color;
    const edgeMat = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
    const glassEdge = new THREE.LineBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const hubEdge = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x140a0e, transparent: true, opacity: 0.92 });
    const glassMat = new THREE.MeshBasicMaterial({ color: 0x13303c, transparent: true, opacity: 0.04, depthWrite: false }); // near-transparent — basically clear glass
    const part = (geo, x, y, z, rx = 0, ry = 0, rz = 0, em = edgeMat, fm = fillMat) => {
      const m = new THREE.Mesh(geo, fm); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), em); e.position.copy(m.position); e.rotation.copy(m.rotation); g.add(e);
      return m;
    };

    // Body: low wide hull (sill → beltline) + a beltline cap over the doors.
    part(new THREE.BoxGeometry(1.86, 0.64, 4.0), 0, 0.68, 0);
    part(new THREE.BoxGeometry(1.74, 0.2, 3.0), 0, 1.02, 0.1);
    // Hood + trunk decks (gentle slope).
    part(new THREE.BoxGeometry(1.7, 0.1, 1.3), 0, 1.0, -1.4, -0.05, 0, 0);
    part(new THREE.BoxGeometry(1.7, 0.1, 0.95), 0, 1.02, 1.45, 0.05, 0, 0);
    // Greenhouse. Windshield top rakes BACK toward the roof (+rot); backlight top rakes
    // FORWARD toward the roof (−rot) — i.e. both slope toward the cabin centre.
    part(new THREE.BoxGeometry(1.52, 0.72, 0.05), 0, 1.34, -0.46, 0.74, 0, 0, glassEdge, glassMat);  // windshield
    part(new THREE.BoxGeometry(1.46, 0.09, 1.22), 0, 1.62, 0.26);                                      // roof
    part(new THREE.BoxGeometry(1.5, 0.66, 0.05), 0, 1.34, 1.02, -0.72, 0, 0, glassEdge, glassMat);     // backlight
    for (const sx of [-0.79, 0.79]) part(new THREE.BoxGeometry(0.04, 0.46, 1.2), sx, 1.34, 0.28, 0, 0, 0, glassEdge, glassMat); // side glass
    // Fenders / wheel arches.
    for (const [fx, fz] of [[-0.95, -1.28], [0.95, -1.28], [-0.95, 1.4], [0.95, 1.4]]) part(new THREE.BoxGeometry(0.12, 0.5, 1.06), fx, 0.58, fz);

    // Wheels: tire + white hub, all four.
    const tireGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.3, 18);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.32, 10);
    this._wheels = [];
    for (const [wx, wz] of [[-0.92, -1.28], [0.92, -1.28], [-0.92, 1.4], [0.92, 1.4]]) {
      part(tireGeo, wx, 0.48, wz, 0, 0, Math.PI / 2);
      part(hubGeo, wx, 0.48, wz, 0, 0, Math.PI / 2, hubEdge);
    }
    // Yellow impound boot clamped on the front-left wheel.
    const bootGeo = new THREE.TorusGeometry(0.42, 0.08, 8, 14, Math.PI * 1.3);
    part(bootGeo, -1.07, 0.48, -1.28, 0, Math.PI / 2, 0,
      new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
      new THREE.MeshBasicMaterial({ color: 0xffcf3a }));

    // Lights + red underglow.
    for (const sx of [-0.66, 0.66]) { const hl = glowSprite(this.glowTex, 0xfff2c8, 1.0); hl.position.set(sx, 0.72, -2.12); g.add(hl); }
    for (const sx of [-0.72, 0.72]) { const tl = glowSprite(this.glowTex, c, 0.85); tl.position.set(sx, 0.74, 2.12); g.add(tl); }
    const under = glowSprite(this.glowTex, c, 5.5); under.position.set(0, 0.05, 0); g.add(under);
    this.underglow = under; // hidden while driving (the camera sits right on it and it'd wash the view red)

    this.group = g;
    this.scene.add(g);
  }

  spawn(pos, yaw = 0) {
    if (!this.group) this._build();
    this.alive = true;
    this.pos.set(pos.x, 0, pos.z);
    this.yaw = yaw;
    this.speed = 0; this.wheel = 0;
    this.hp = this.maxHp = CIVIC.hp;
    this._ramClocks.clear();
    this.group.visible = true;
    this._sync();
  }

  damage(amount) {
    if (!this.alive || this.invincible) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.effects) this.effects.flash?.(this._hood(), CIVIC.color, 3, 0.18);
  }

  _hood() { fwdFromYaw(this.yaw, this._fwd); return this.pos.clone().addScaledVector(this._fwd, 2).setY(0.8); }

  nearPlayer(player, r = 3.4) {
    return this.alive && Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) < r;
  }

  // Ray vs the car's bounding sphere. Returns the hit distance t, or null.
  // Lets the player shoot their own parked Civic (use it as a bomb).
  rayHit(ray, range = 300, R = 2.2) {
    const ox = ray.origin.x - this.pos.x, oy = ray.origin.y - (this.pos.y + 0.9), oz = ray.origin.z - this.pos.z;
    const b = ox * ray.dir.x + oy * ray.dir.y + oz * ray.dir.z;
    const c = ox * ox + oy * oy + oz * oz - R * R;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return (t >= 0 && t <= range) ? t : null;
  }

  // Blow up: area damage to enemies, debris, and remove from the world.
  explode(enemies) {
    const at = this.pos.clone().setY(1);
    enemies?.splash(at, CIVIC.explodeRadius, CIVIC.explodeDamage);
    this.effects?.flash?.(at, 0xff7a3c, 22, 0.6);
    this.effects?.burst?.(at, CIVIC.color);
    this.effects?.burst?.(at, 0xffb347);
    this.alive = false;
    if (this.group) this.group.visible = false;
  }

  dispose() {
    if (this.group) { this.scene.remove(this.group); this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); this.group = null; }
    this.alive = false; this._wheels = [];
  }

  // Drive one frame. Returns nothing; read .hp / .alive for state.
  update(dt, input, world, enemies, worldTime) {
    const m = input.moveAxis();          // m.z = W/S throttle, m.x = A/D steer
    const throttle = m.z;

    // longitudinal: accelerate / brake / coast, then clamp + drag.
    if (throttle > 0) this.speed += CIVIC.accel * dt;
    else if (throttle < 0) this.speed -= (this.speed > 0 ? CIVIC.brake : CIVIC.accel) * dt; // S brakes then reverses
    else this.speed -= this.speed * CIVIC.coast * dt;
    this.speed -= this.speed * CIVIC.drag * dt;
    this.speed = clamp(this.speed, -CIVIC.maxReverse, CIVIC.maxSpeed);
    if (Math.abs(this.speed) < 0.05 && throttle === 0) this.speed = 0;

    // steering: only turns while rolling; reverse flips the wheel.
    this.wheel = damp(this.wheel, m.x, 8, dt);
    const grip = Math.min(1, Math.abs(this.speed) / 3.5) * Math.sign(this.speed || 1);
    this.yaw -= m.x * CIVIC.turnRate * dt * grip;

    fwdFromYaw(this.yaw, this._fwd);
    this._move(this._fwd, this.speed * dt, world);
    this._ram(enemies, worldTime);
    this._sync();
  }

  _move(fwd, step, world) {
    let px = this.pos.x + fwd.x * step;
    let pz = this.pos.z + fwd.z * step;
    const R = CIVIC.radius;
    let scraped = false;
    // Two passes: resolving one collider can shove the car into another, so settle it.
    for (let pass = 0; pass < 2; pass++) {
      for (const col of world.colliders) {
        // Only collide with geometry that overlaps the car's height band: drive OVER low
        // stuff (max.y below the ride height) and UNDER high stuff (min.y above the roof).
        if (col.boundary || col.max.y <= CIVIC.rideMax || col.min.y >= CIVIC.clearance) continue;
        const cx = clamp(px, col.min.x, col.max.x), cz = clamp(pz, col.min.z, col.max.z);
        const dx = px - cx, dz = pz - cz, d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          px = cx + (dx / d) * R; pz = cz + (dz / d) * R;       // slide along the face
        } else {
          // Center is INSIDE the footprint — eject out the nearest face (else it wedges forever).
          const toMinX = px - col.min.x, toMaxX = col.max.x - px;
          const toMinZ = pz - col.min.z, toMaxZ = col.max.z - pz;
          if (Math.min(toMinX, toMaxX) < Math.min(toMinZ, toMaxZ)) px = toMinX < toMaxX ? col.min.x - R : col.max.x + R;
          else pz = toMinZ < toMaxZ ? col.min.z - R : col.max.z + R;
        }
        scraped = true;
      }
    }
    if (scraped) this.speed *= 0.85; // keep most momentum so it slides free instead of dying
    const lim = world.half - R;
    this.pos.x = clamp(px, -lim, lim);
    this.pos.z = clamp(pz, -lim, lim);
    this.pos.y = 0;
  }

  _ram(enemies, worldTime) {
    if (!enemies) return;
    const spd = Math.abs(this.speed);
    if (spd < CIVIC.ramMinSpeed) return;
    const dmg = CIVIC.ramBase + spd * CIVIC.ramPerSpeed;
    const R = CIVIC.radius;
    for (const e of [...enemies.list]) {
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const rr = R + e.radius;
      if (dx * dx + dz * dz > rr * rr) continue;
      const last = this._ramClocks.get(e) || -1;
      if (worldTime - last < CIVIC.ramCd) continue;
      this._ramClocks.set(e, worldTime);
      enemies._damage(e, dmg, e.pos.clone());
      const d = Math.hypot(dx, dz) || 1;             // knock it off the bumper
      e.pos.x += (dx / d) * 1.1; e.pos.z += (dz / d) * 1.1;
      this.effects?.burst?.(e.pos.clone(), CIVIC.color);
    }
    // boss: heavy contact ram on a cadence
    const b = enemies.boss;
    if (b && !b.dead) {
      const dx = b.pos.x - this.pos.x, dz = b.pos.z - this.pos.z, rr = R + b.hitR;
      if (dx * dx + dz * dz < rr * rr) {
        const last = this._ramClocks.get(b) || -1;
        if (worldTime - last >= CIVIC.ramCd) { this._ramClocks.set(b, worldTime); enemies._damageBoss(dmg, b.pos.clone()); }
      }
    }
  }

  _sync() {
    if (!this.group) return;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }
}
