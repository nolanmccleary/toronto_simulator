import * as THREE from '../vendor/three.module.js';
import { PORTAL, PLAYER, PALETTE } from './config.js';
import { glowSprite } from './effects.js';
import { raycastWorld } from './raycast.js';
import { sfx } from './audio.js';

// Scratch vectors (avoid per-frame allocation).
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _n = new THREE.Vector3(), _ref = new THREE.Vector3(), _m = new THREE.Matrix4();

function newPortal(color) {
  return { active: false, color, pos: new THREE.Vector3(),
    right: new THREE.Vector3(), up: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0), group: null };
}

export class Portals {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.glowTex = effects.glowTex;
    this.a = newPortal(PALETTE.portalA);
    this.b = newPortal(PALETTE.portalB);
    this.lockout = 0;
    this._pulse = 0;
  }

  reset() {
    for (const p of [this.a, this.b]) { p.active = false; if (p.group) p.group.visible = false; }
    this.lockout = 0;
  }

  bothActive() { return this.a.active && this.b.active; }

  _buildVisual(color) {
    const g = new THREE.Group();
    const r = PORTAL.radius;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.82, r, 48),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const film = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.82, 48),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    g.add(film, ring, glowSprite(this.glowTex, color, r * 3));
    this.scene.add(g);
    return g;
  }

  // Place portal 'A' or 'B' using a surface hit {point, normal}.
  place(which, hit) {
    const p = which === 'A' ? this.a : this.b;
    const n = _n.copy(hit.normal).normalize();
    const refUp = Math.abs(n.y) > 0.9 ? _ref.set(0, 0, -1) : _ref.set(0, 1, 0);
    p.right.crossVectors(refUp, n).normalize();
    p.up.crossVectors(n, p.right).normalize();
    p.normal.copy(n);
    p.pos.copy(hit.point).addScaledVector(n, 0.05);
    if (!p.group) p.group = this._buildVisual(p.color);
    p.group.quaternion.setFromRotationMatrix(_m.makeBasis(p.right, p.up, p.normal));
    p.group.position.copy(p.pos);
    p.group.visible = true;
    p.active = true;
    this.effects.muzzle(hit.point, p.color);
    sfx.portal();
  }

  // Raycast the world (colliders + floor) for a placement point. Returns {point, normal} or null.
  raycast(ray, world) {
    const best = raycastWorld(ray, world, PORTAL.range);
    return best ? { point: best.point, normal: best.normal } : null;
  }

  // Does an active portal cover this surface contact? Returns the portal, or null.
  // Called from the player's collision code: a contact that lands on a portal becomes a teleport.
  holeAt(point, normal) {
    if (this.lockout > 0) return null;
    for (const p of [this.a, this.b]) {
      if (!p.active) continue;
      const other = p === this.a ? this.b : this.a;
      if (!other.active) continue;
      if (p.normal.dot(normal) < 0.9) continue;
      const rel = _v1.copy(point).sub(p.pos);
      const along = rel.dot(p.normal);
      if (Math.abs(along) > 0.8) continue;
      const planar = _v2.copy(rel).addScaledVector(p.normal, -along).length();
      if (planar < PORTAL.radius * 0.9) return p;
    }
    return null;
  }

  // Send the player through inP, emerging from the linked portal with momentum/view transformed.
  teleport(player, inP) {
    const outP = inP === this.a ? this.b : this.a;
    if (!outP.active) return false;
    const h2 = PLAYER.height * 0.5;

    // Body-centre through the in-portal frame, flipped 180° about up, into the out-portal frame.
    const center = _v1.set(player.pos.x, player.pos.y + h2, player.pos.z).sub(inP.pos);
    const lx = -center.dot(inP.right), ly = center.dot(inP.up), lz = -center.dot(inP.normal);
    const out = _v3.copy(outP.pos)
      .addScaledVector(outP.right, lx).addScaledVector(outP.up, ly).addScaledVector(outP.normal, lz)
      .addScaledVector(outP.normal, PORTAL.exitOffset);

    // Velocity (direction only).
    const v = player.vel;
    const vx = -v.dot(inP.right), vy = v.dot(inP.up), vz = -v.dot(inP.normal);
    player.vel.copy(_v4.copy(outP.right).multiplyScalar(vx).addScaledVector(outP.up, vy).addScaledVector(outP.normal, vz));

    // View direction.
    const f = _v5.set(0, 0, -1).applyQuaternion(player.camera.quaternion);
    const fx = -f.dot(inP.right), fy = f.dot(inP.up), fz = -f.dot(inP.normal);
    const fo = _v6.copy(outP.right).multiplyScalar(fx).addScaledVector(outP.up, fy).addScaledVector(outP.normal, fz).normalize();
    player.yaw = Math.atan2(-fo.x, -fo.z);
    const lim = Math.PI / 2 - 0.02;
    player.pitch = Math.max(-lim, Math.min(lim, Math.asin(Math.max(-1, Math.min(1, fo.y)))));

    player.pos.set(out.x, out.y - h2, out.z);
    if (player.pos.y < 0) player.pos.y = 0;
    player.addFovKick?.(12);
    player._syncCamera();

    this.lockout = PORTAL.teleportLockout;
    this.effects.burst(inP.pos, inP.color);
    this.effects.burst(outP.pos, outP.color);
    sfx.teleport();
    return true;
  }

  update(dt) {
    if (this.lockout > 0) this.lockout -= dt;
    this._pulse += dt;
    const s = 0.95 + 0.1 * Math.sin(this._pulse * 4);
    for (const p of [this.a, this.b]) if (p.active && p.group) p.group.scale.setScalar(s);
  }
}
