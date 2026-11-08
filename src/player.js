import * as THREE from '../vendor/three.module.js';
import { PLAYER, GRAPPLE, JET } from './config.js';

const EPS = 0.001;
const _contact = new THREE.Vector3();
const _norm = new THREE.Vector3();
const _euler = new THREE.Euler();

function approach(cur, target, maxDelta) {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}
const damp = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.portals = null;          // set by main
    this.grapple = { active: false, point: new THREE.Vector3() };
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.pos = this.pos || new THREE.Vector3();
    this.vel = this.vel || new THREE.Vector3();
    this.pos.set(0, 0, 24);
    this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0;
    this.grounded = false;
    this.climbing = false;
    this.health = PLAYER.maxHealth;
    this.alive = true;
    this.hardcore = this.hardcore || false;
    this.invuln = false;      // console-invoked power modes: true (infinite)
    this.auxHp = 0;           // package power modes: damage hits this first, then reverts
    this.speedMul = 1;        // ground run multiplier
    this.flySpeedMul = 1;     // jetpack flight multiplier
    this.jetpackEnabled = false;
    this.flying = false;
    this.fuel = JET.fuelMax;
    this._hurtCooldown = 0;
    this.guarding = false;                                  // katana guard (Somali mode, right-click)
    this.guardDir = this.guardDir || new THREE.Vector3();   // horizontal facing held while guarding
    this.vehicle = null;                                    // Civic while driving: redirects takeDamage
    this.hitRadius = PLAYER.radius;                         // enemy-contact/projectile radius (grows while driving)

    // jump feel
    this.coyote = 0; this.jumpBuf = 0;
    this._spaceWas = false; this._jumpActive = false; this._cut = false;
    this._enteringPortal = null;
    this._climbContact = false; this._climbNormal = null;
    if (this.grapple) this.grapple.active = false;

    // camera feel
    this.roll = 0; this.camDip = 0; this.bobPhase = 0; this.bobAmt = 0;
    this.fov = PLAYER.fovBase; this.fovBoost = 0; this.scopeFov = null;
    this.camera.fov = PLAYER.fovBase;
    this.camera.updateProjectionMatrix();
    this._basis();
    this._updateCamera();
  }

  _basis() {
    this._fwd.set(Math.sin(this.yaw) * -1, 0, Math.cos(this.yaw) * -1).normalize();
    this._right.set(-this._fwd.z, 0, this._fwd.x); // cross(forward, up): screen-right
  }

  _updateCamera() {
    const bobY = Math.sin(this.bobPhase * 2) * PLAYER.bobAmp * this.bobAmt;
    const bobX = Math.sin(this.bobPhase) * PLAYER.bobAmp * this.bobAmt;
    const eye = PLAYER.eyeHeight - this.camDip + bobY;
    this.camera.position.set(
      this.pos.x + this._right.x * bobX,
      this.pos.y + eye,
      this.pos.z + this._right.z * bobX,
    );
    this.camera.quaternion.setFromEuler(_euler.set(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.rotateZ(this.roll);
  }

  _syncCamera() { this._basis(); this._updateCamera(); }

  getRay() {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    return { origin: this.camera.position.clone(), dir };
  }

  addFovKick(n) { this.fovBoost = Math.max(this.fovBoost, n); }

  startGrapple(point) { this.grapple.active = true; this.grapple.point.copy(point); this._grappleT = 0; this.addFovKick(9); }
  releaseGrapple() { this.grapple.active = false; }

  takeDamage(amount) {
    if (this.vehicle) { this.vehicle.damage(amount); return; } // driving: hits go to the Civic
    if (!this.alive || this.invuln) return;
    if (this.auxHp > 0) { this.auxHp = Math.max(0, this.auxHp - amount); return; } // aux shield absorbs
    this.health = this.hardcore ? 0 : Math.max(0, this.health - amount);
    if (this.health <= 0) this.alive = false;
  }

  update(dt, input, world) {
    const ev = { jumped: false, launched: false, landed: 0, climbStart: false };
    if (this._hurtCooldown > 0) this._hurtCooldown -= dt;

    // --- Look (finer while scoped) ---
    const look = input.consumeLook();
    const sens = PLAYER.lookSensitivity * (this.scopeFov ? this.scopeFov / PLAYER.fovBase : 1);
    this.yaw -= look.x * sens;
    this.pitch -= look.y * sens;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    this._basis();

    // --- Intent ---
    const m = input.moveAxis();
    const hasInput = m.x !== 0 || m.z !== 0;
    const wish = new THREE.Vector3().addScaledVector(this._fwd, m.z).addScaledVector(this._right, m.x);
    if (wish.lengthSq() > 1) wish.normalize();

    // --- Jump timers (coyote + buffer + variable height) ---
    const spaceDown = input.down('Space');
    const pressEdge = spaceDown && !this._spaceWas;
    this._spaceWas = spaceDown;
    if (this.jumpBuf > 0) this.jumpBuf -= dt;
    if (pressEdge) this.jumpBuf = PLAYER.jumpBuffer;

    const wasClimbing = this.climbing;
    this.climbing = this._climbContact && m.z > 0;
    if (this.climbing && !wasClimbing) ev.climbStart = true;

    if (this.climbing) {
      this.vel.y = PLAYER.climbSpeed;
      this.vel.x = approach(this.vel.x, this._fwd.x * 1.6, PLAYER.accel * dt);
      this.vel.z = approach(this.vel.z, this._fwd.z * 1.6, PLAYER.accel * dt);
      if (spaceDown) {
        this.climbing = false;
        this.vel.y = PLAYER.jumpSpeed;
        if (this._climbNormal) this.vel.addScaledVector(this._climbNormal, 6);
        this._jumpActive = true; this._cut = false;
        ev.jumped = true;
      }
    } else {
      const mul = this.flying ? this.flySpeedMul : this.speedMul;
      const target = wish.multiplyScalar(PLAYER.walkSpeed * mul);
      // Flying forward adds extra boost.
      if (this.flying && m.z > 0) target.addScaledVector(this._fwd, PLAYER.walkSpeed * 0.7);
      if (this.grounded) {
        const a = PLAYER.accel * dt;
        this.vel.x = approach(this.vel.x, target.x, a);
        this.vel.z = approach(this.vel.z, target.z, a);
      } else if (hasInput || this.flying) {
        const a = (this.flying ? PLAYER.accel : PLAYER.airAccel) * dt;
        this.vel.x = approach(this.vel.x, target.x, a);
        this.vel.z = approach(this.vel.z, target.z, a);
      }
      if (!this.grapple.active) this.vel.y -= PLAYER.gravity * dt; // zipline cuts gravity

      const canJump = this.grounded || this.coyote > 0;
      if (this.jetpackEnabled && pressEdge && !this.grounded && !this.flying && this.fuel > 0) {
        this.flying = true; // double-jump (airborne press) engages the jetpack — takes priority over coyote
      } else if (this.jumpBuf > 0 && canJump) {
        this.vel.y = PLAYER.jumpSpeed;
        this.grounded = false; this.coyote = 0; this.jumpBuf = 0;
        this._jumpActive = true; this._cut = false;
        ev.jumped = true;
      }
      if (!this.flying && this._jumpActive && !spaceDown && !this._cut && this.vel.y > 0) {
        this.vel.y *= PLAYER.jumpCut; this._cut = true;
      }

      // --- Jetpack ---
      if (this.flying) {
        if (spaceDown && this.fuel > 0) {
          this.vel.y += JET.thrust * dt;
          if (this.vel.y > JET.maxRise) this.vel.y = JET.maxRise;
          this.fuel = Math.max(0, this.fuel - JET.drain * dt);
          ev.thrusting = true;
        }
        if (this.grounded || (this.fuel <= 0 && !spaceDown)) this.flying = false;
      }
      if (this.grounded) { this.flying = false; this.fuel = Math.min(JET.fuelMax, this.fuel + JET.refill * dt); }
    }

    // --- Grapple / zipline: hard committal yank toward the anchor ---
    if (this.grapple.active) {
      this._grappleT += dt;
      const cx = this.pos.x, cy = this.pos.y + PLAYER.height * 0.5, cz = this.pos.z;
      const gx = this.grapple.point.x - cx, gy = this.grapple.point.y - cy, gz = this.grapple.point.z - cz;
      const dist = Math.hypot(gx, gy, gz);
      if (dist < GRAPPLE.arrive || this._grappleT > GRAPPLE.maxTime) {
        this.grapple.active = false;
        this.addFovKick(10);
      } else {
        const inv = 1 / dist, dx = gx * inv, dy = gy * inv, dz = gz * inv;
        this.vel.x += dx * GRAPPLE.pull * dt;
        this.vel.y += dy * GRAPPLE.pull * dt;
        this.vel.z += dz * GRAPPLE.pull * dt;
        // Guarantee a hard minimum speed straight at the anchor so it always yanks.
        const toward = this.vel.x * dx + this.vel.y * dy + this.vel.z * dz;
        if (toward < GRAPPLE.minSpeed) {
          const add = GRAPPLE.minSpeed - toward;
          this.vel.x += dx * add; this.vel.y += dy * add; this.vel.z += dz * add;
        }
        const sp = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
        if (sp > GRAPPLE.maxSpeed) { const k = GRAPPLE.maxSpeed / sp; this.vel.x *= k; this.vel.y *= k; this.vel.z *= k; }
        this.grounded = false; this._jumpActive = false;
      }
    }

    // --- Integrate with per-axis collision (portals turn contacts into teleports) ---
    this._climbContact = false;
    this._climbNormal = null;
    this._enteringPortal = null;
    this._moveAxis('x', this.vel.x * dt, world);
    this._moveAxis('z', this.vel.z * dt, world);
    const wasAir = !this.grounded;
    const preVelY = this.vel.y;
    this._moveAxisY(this.vel.y * dt, world);

    if (!this._enteringPortal) {
      if (this.grounded && wasAir) {
        const impact = Math.max(0, -preVelY);
        this.camDip = Math.min(0.3, impact * PLAYER.landingDip);
        this._jumpActive = false;
        if (impact > 3.5) ev.landed = impact;
      }
      this.coyote = this.grounded ? PLAYER.coyoteTime : this.coyote - dt;

      // --- Launch pads ---
      if (this.grounded) {
        for (const pad of world.pads) {
          if (this.pos.x >= pad.min.x && this.pos.x <= pad.max.x &&
              this.pos.z >= pad.min.z && this.pos.z <= pad.max.z && this.pos.y <= pad.max.y) {
            this.vel.y = pad.up;
            this.vel.x = pad.dir.x * pad.forward;
            this.vel.z = pad.dir.z * pad.forward;
            this.grounded = false; this._jumpActive = false;
            this.addFovKick(10);
            ev.launched = true;
            break;
          }
        }
      }
    }

    // --- Camera feel ---
    const targetRoll = -m.x * PLAYER.maxRoll * (this.grounded ? 1 : 0.55);
    this.roll = damp(this.roll, targetRoll, PLAYER.rollLerp, dt);
    this.camDip = damp(this.camDip, 0, PLAYER.dipRecover, dt);

    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    const moveFactor = this.grounded ? Math.min(1, hspeed / PLAYER.walkSpeed) : 0;
    this.bobPhase += dt * PLAYER.bobFreq * (0.35 + moveFactor);
    this.bobAmt = damp(this.bobAmt, moveFactor, 8, dt);

    let targetFov;
    if (this.scopeFov) {
      targetFov = this.scopeFov;
    } else {
      const extra = Math.min(PLAYER.fovSpeedKick, Math.max(0, hspeed - PLAYER.walkSpeed) * 2.4) + this.fovBoost;
      targetFov = PLAYER.fovBase + extra;
    }
    this.fov = damp(this.fov, targetFov, this.scopeFov ? 16 : PLAYER.fovLerp, dt);
    this.fovBoost *= Math.max(0, 1 - dt * 4);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this._updateCamera();

    return ev;
  }

  _overlaps(c) {
    if (this._enteringPortal) return false;
    const r = PLAYER.radius, h = PLAYER.height;
    return (
      this.pos.x - r < c.max.x && this.pos.x + r > c.min.x &&
      this.pos.y < c.max.y && this.pos.y + h > c.min.y &&
      this.pos.z - r < c.max.z && this.pos.z + r > c.min.z
    );
  }

  _portalHole(point, normal) {
    return this.portals ? this.portals.holeAt(point, normal) : null;
  }

  _moveAxis(axis, delta, world) {
    if (delta === 0) return;
    this.pos[axis] += delta;
    const r = PLAYER.radius;
    for (const c of world.colliders) {
      if (!this._overlaps(c)) continue;
      const surface = delta > 0 ? (axis === 'x' ? c.min.x : c.min.z) : (axis === 'x' ? c.max.x : c.max.z);
      _contact.set(this.pos.x, this.pos.y + PLAYER.height * 0.5, this.pos.z);
      _contact[axis] = surface;
      _norm.set(0, 0, 0); _norm[axis] = delta > 0 ? -1 : 1;
      const hole = this._portalHole(_contact, _norm);
      if (hole) { this._enteringPortal = hole; return; }

      this.pos[axis] = surface + (delta > 0 ? -r - EPS : r + EPS);
      this.vel[axis] = 0;
      if (c.climbable) {
        this._climbContact = true;
        this._climbNormal = new THREE.Vector3();
        this._climbNormal[axis] = delta > 0 ? -1 : 1;
      }
    }
  }

  _moveAxisY(delta, world) {
    this.grounded = false;
    this.pos.y += delta;
    const h = PLAYER.height;
    for (const c of world.colliders) {
      if (!this._overlaps(c)) continue;
      const landing = delta < 0;
      const surfaceY = landing ? c.max.y : c.min.y;
      _contact.set(this.pos.x, surfaceY, this.pos.z);
      _norm.set(0, landing ? 1 : -1, 0);
      const hole = this._portalHole(_contact, _norm);
      if (hole) { this._enteringPortal = hole; return; }

      if (landing) { this.pos.y = c.max.y + EPS; this.grounded = true; }
      else { this.pos.y = c.min.y - h - EPS; }
      this.vel.y = 0;
    }
    // Floor plane.
    if (this.pos.y <= 0) {
      if (this.portals && this.vel.y < 0) {
        _contact.set(this.pos.x, 0, this.pos.z);
        _norm.set(0, 1, 0);
        const hole = this._portalHole(_contact, _norm);
        if (hole) { this._enteringPortal = hole; return; }
      }
      this.pos.y = 0; this.vel.y = 0; this.grounded = true;
    }
  }
}
