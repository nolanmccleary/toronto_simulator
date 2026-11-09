import * as THREE from '../vendor/three.module.js';
import { HAZARD, PALETTE, PLAYER } from './config.js';
import { glowSprite } from './effects.js';
import { sfx } from './audio.js';

const _up = new THREE.Vector3(0, 1, 0);

// A cluster of spikes (local +y = up/out). Used for floor hazards and portal outlets.
function spikeCluster(glowTex, color) {
  const g = new THREE.Group();
  const cones = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, rr = i === 0 ? 0 : HAZARD.radius * 0.55;
    const geo = new THREE.ConeGeometry(0.44, 2.7, 5);
    const cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x160505 }));
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
    cone.position.set(Math.cos(a) * rr, 1.35, Math.sin(a) * rr); edge.position.copy(cone.position);
    g.add(cone, edge); cones.push(cone, edge);
  }
  const glow = glowSprite(glowTex, color, HAZARD.radius * 2.2); glow.position.y = 1.2;
  g.add(glow);
  return { group: g, cones, glow };
}

// A soft blue flame jet (local +y = jet direction): a tapering column of flickering
// billboard glows — hot white-blue at the base fading to deep blue at the tip.
function flameCluster(glowTex, color) {
  const g = new THREE.Group();
  const puffs = [];
  const H = HAZARD.flameReach, N = 11;
  const cold = new THREE.Color(0x2a6cff), hot = new THREE.Color(0x8fd4ff); // deep blue → light blue, no white
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);                              // 0 = base, 1 = tip
    const size = (1.7 - t * 1.15) * (0.8 + Math.random() * 0.3);
    const col = cold.clone().lerp(hot, Math.pow(1 - t, 1.4)).getHex();
    const s = glowSprite(glowTex, col, size);
    s.position.set((Math.random() - 0.5) * 0.5, t * H * 0.85 + 0.35, (Math.random() - 0.5) * 0.5);
    s.material.opacity = 0.55 * (1 - t * 0.45);
    s.userData.phase = Math.random() * Math.PI * 2;
    s.userData.baseY = s.position.y;
    s.userData.baseSize = size;
    s.userData.baseOp = s.material.opacity;
    g.add(s); puffs.push(s);
  }
  return { group: g, cones: puffs, glow: puffs[0] };
}

function orient(group, point, normal) {
  group.position.copy(point);
  group.quaternion.setFromUnitVectors(_up, normal);
}

class Hazard {
  constructor(scene, glowTex, opts) {
    this.scene = scene;
    this.kind = opts.kind;
    this.activeTime = opts.activeTime;
    this.color = this.kind === 'flame' ? PALETTE.flame : PALETTE.danger;
    this.phase = 'warn';
    this.t = 0; this.tickTimer = 0; this.piping = false; this.outlet = null;

    if (this.kind === 'flame') {
      this.point = opts.point.clone();
      this.normal = opts.normal.clone();
      this.center = this.point.clone().addScaledVector(this.normal, HAZARD.flameReach * 0.5);
      this.x = this.center.x; this.z = this.center.z; this.y = this.center.y;
      this.zoneR = HAZARD.flameRadius;
      this._buildFlame(glowTex);
    } else {
      this.x = opts.x; this.z = opts.z; this.y = 0;
      this.center = new THREE.Vector3(this.x, 1, this.z);
      this.zoneR = HAZARD.radius;
      this._buildSpike(glowTex);
    }
  }

  _buildSpike(glowTex) {
    const R = HAZARD.radius;
    this.group = new THREE.Group();
    this.group.position.set(this.x, 0, this.z);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.92, R, 40),
      new THREE.MeshBasicMaterial({ color: this.color, side: THREE.DoubleSide, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.04;
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(R, 40),
      new THREE.MeshBasicMaterial({ color: this.color, side: THREE.DoubleSide, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.fill.rotation.x = -Math.PI / 2; this.fill.position.y = 0.03;
    const sc = spikeCluster(glowTex, this.color);
    this.cones = sc.cones; this.glow = sc.glow; this.spikes = sc.group;
    this.spikes.visible = false; this.spikes.scale.y = 0.01;
    this.group.add(this.ring, this.fill, this.spikes);
    this.scene.add(this.group);
  }

  _buildFlame(glowTex) {
    this.group = new THREE.Group();
    // Warning glow on the wall, then the flame jet.
    this.warn = glowSprite(glowTex, this.color, 2.2);
    const fc = flameCluster(glowTex, this.color);
    this.cones = fc.cones; this.glow = fc.glow; this.flames = fc.group;
    this.flames.visible = false;
    this.group.add(this.warn, this.flames);
    orient(this.group, this.point, this.normal);
    // warn sprite sits on the wall face
    this.warn.position.set(0, 0, 0);
    this.scene.add(this.group);
  }

  // Player damage test for the active phase.
  hitsPlayer(player) {
    if (this.kind === 'flame') {
      const cx = player.pos.x, cy = player.pos.y + PLAYER.height * 0.5, cz = player.pos.z;
      return Math.hypot(cx - this.center.x, cy - this.center.y, cz - this.center.z) < HAZARD.flameRadius + PLAYER.radius;
    }
    return Math.hypot(player.pos.x - this.x, player.pos.z - this.z) < HAZARD.radius && player.pos.y < HAZARD.safeHeight;
  }

  dispose() {
    if (this.outlet) { this.scene.remove(this.outlet.group); this.outlet = null; }
    this.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}

export class Hazards {
  constructor(scene, effects) {
    this.scene = scene;
    this.glowTex = effects.glowTex;
    this.list = [];
    this.world = null;
    this.onPlayerHurt = null;
    this.reset();
  }

  bind(world) { this.world = world; }

  reset() {
    for (const h of this.list) h.dispose();
    this.list = [];
    this.spawnTimer = 1.0;
  }

  activeZones() {
    const out = [];
    for (const h of this.list) if (h.phase === 'active') out.push({ x: h.x, z: h.z, r: h.zoneR });
    return out;
  }

  _activeTime(wave) { return Math.max(HAZARD.activeMin, HAZARD.activeBase - HAZARD.activePerWave * (wave - 1)); }
  _interval(wave) { return Math.max(HAZARD.intervalMin, HAZARD.interval - HAZARD.intervalPerWave * (wave - 1)); }

  _nearPlayer(player) {
    const h = this.world.half - 5;
    const a = Math.random() * Math.PI * 2, r = HAZARD.nearMin + Math.random() * (HAZARD.nearMax - HAZARD.nearMin);
    return {
      x: Math.max(-h, Math.min(h, player.pos.x + Math.cos(a) * r)),
      z: Math.max(-h, Math.min(h, player.pos.z + Math.sin(a) * r)),
    };
  }

  // A wall face near the player, oriented to jet flames toward them.
  _wallFaceNear(player) {
    const cs = this.world.colliders.filter((c) => (c.max.y - c.min.y) >= 3);
    if (!cs.length) return null;
    const dist = (c) => {
      const px = Math.max(c.min.x, Math.min(player.pos.x, c.max.x));
      const pz = Math.max(c.min.z, Math.min(player.pos.z, c.max.z));
      return Math.hypot(player.pos.x - px, player.pos.z - pz);
    };
    // Prefer walls a comfortable distance away (not right on top of the player).
    let pool = cs.filter((c) => { const d = dist(c); return d >= HAZARD.nearMin && d <= HAZARD.nearMax + 6; });
    if (!pool.length) { cs.sort((a, b) => dist(a) - dist(b)); pool = cs; }
    const c = pool[Math.floor(Math.random() * pool.length)];
    const cxm = (c.min.x + c.max.x) / 2, czm = (c.min.z + c.max.z) / 2;
    const dxp = player.pos.x - cxm, dzp = player.pos.z - czm;
    let nx = 0, nz = 0, ax, az;
    if (Math.abs(dxp) > Math.abs(dzp)) {
      nx = dxp > 0 ? 1 : -1; ax = nx > 0 ? c.max.x : c.min.x;
      az = czm + (Math.random() * 2 - 1) * (c.max.z - c.min.z) * 0.3;
    } else {
      nz = dzp > 0 ? 1 : -1; az = nz > 0 ? c.max.z : c.min.z;
      ax = cxm + (Math.random() * 2 - 1) * (c.max.x - c.min.x) * 0.3;
    }
    const ay = Math.min(c.max.y - 0.5, 1.5 + Math.random() * 4.5);
    return { point: new THREE.Vector3(ax, ay, az), normal: new THREE.Vector3(nx, 0, nz) };
  }

  _spawn(player, wave) {
    const activeTime = this._activeTime(wave);
    let hz;
    if (Math.random() < HAZARD.flameChance) {
      const face = this._wallFaceNear(player);
      if (face) hz = new Hazard(this.scene, this.glowTex, { kind: 'flame', activeTime, ...face });
    }
    if (!hz) {
      const p = this._nearPlayer(player);
      hz = new Hazard(this.scene, this.glowTex, { kind: 'spike', activeTime, x: p.x, z: p.z });
    }
    this.list.push(hz);
    sfx.blink();
  }

  update(dt, player, wave, active, portals, enemies) {
    // Spawn pacing — occasional hazards, not a constant barrage.
    if (active) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this._spawn(player, wave); this.spawnTimer = this._interval(wave) * (0.85 + Math.random() * 0.4); }
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const hz = this.list[i];
      hz.t += dt;
      if (hz.phase === 'warn') {
        const k = Math.min(1, hz.t / HAZARD.warnTime);
        const pulse = 0.6 + 0.4 * Math.sin(hz.t * 22);
        if (hz.kind === 'flame') hz.warn.material.opacity = 0.2 + 0.6 * k * pulse;
        else { hz.fill.material.opacity = 0.1 + 0.35 * k * pulse; hz.ring.material.opacity = 0.5 + 0.5 * k; }
        if (hz.t >= HAZARD.warnTime) {
          hz.phase = 'active'; hz.t = 0;
          if (hz.kind === 'flame') { hz.flames.visible = true; hz.warn.material.opacity = 0; }
          else hz.spikes.visible = true;
          sfx.hurt();
        }
      } else if (hz.phase === 'active') {
        if (hz.kind === 'flame') {
          for (const c of hz.cones) {
            const fl = 0.5 + 0.5 * Math.sin(hz.t * 15 + c.userData.phase);
            const fl2 = 0.5 + 0.5 * Math.sin(hz.t * 24 + c.userData.phase * 1.7);
            c.scale.setScalar(c.userData.baseSize * (0.8 + 0.32 * fl));
            c.material.opacity = c.userData.baseOp * (0.6 + 0.6 * fl2);
            c.position.y = c.userData.baseY + Math.sin(hz.t * 8 + c.userData.phase) * 0.22;
          }
        } else {
          hz.spikes.scale.y = Math.min(1, hz.t / 0.12);
          hz.fill.material.opacity = 0.3;
        }
        hz.tickTimer -= dt;
        if (hz.tickTimer <= 0 && hz.hitsPlayer(player)) {
          hz.tickTimer = HAZARD.tickInterval;
          player.takeDamage(HAZARD.damage);
          sfx.hurt();
          this.onPlayerHurt?.();
        }
        if (hz.t >= hz.activeTime) { hz.phase = 'fade'; hz.t = 0; }
      } else { // fade
        const k = 1 - Math.min(1, hz.t / HAZARD.fadeTime);
        if (hz.kind === 'flame') hz.flames.scale.setScalar(k);
        else { hz.spikes.scale.y = Math.max(0.01, k); hz.ring.material.opacity = 0.5 * k; hz.fill.material.opacity = 0.2 * k; }
        hz.glow.material.opacity = k;
        if (hz.t >= HAZARD.fadeTime) { hz.dispose(); this.list.splice(i, 1); }
      }
    }

    if (portals && enemies) this._route(portals, enemies, dt);
  }

  // A portal placed inside an active hazard routes it through to the linked portal,
  // one-shotting enemies at the outlet, with a persistent matching eruption there.
  _route(portals, enemies, dt) {
    for (const hz of this.list) {
      if (hz.phase !== 'active') { this._clearOutlet(hz); hz.piping = false; continue; }
      let out = null;
      for (const inP of [portals.a, portals.b]) {
        if (!inP.active) continue;
        if (Math.hypot(hz.x - inP.pos.x, hz.z - inP.pos.z) > hz.zoneR) continue;
        const o = inP === portals.a ? portals.b : portals.a;
        if (o.active) out = o;
      }
      if (out) {
        enemies.killNear(out.pos, hz.zoneR);
        if (!hz.outlet) this._makeOutlet(hz, out);
        else orient(hz.outlet.group, out.pos, out.normal);
        hz.outlet.t += dt;
        if (hz.kind === 'flame') hz.outlet.cones.forEach((c) => { c.scale.setScalar(c.userData.baseSize * (0.8 + 0.3 * Math.sin(hz.outlet.t * 15 + c.userData.phase))); });
        hz.piping = true;
      } else { this._clearOutlet(hz); hz.piping = false; }
    }
  }

  _makeOutlet(hz, portal) {
    const c = hz.kind === 'flame' ? flameCluster(this.glowTex, hz.color) : spikeCluster(this.glowTex, hz.color);
    orient(c.group, portal.pos, portal.normal);
    this.scene.add(c.group);
    hz.outlet = { group: c.group, cones: c.cones, glow: c.glow, t: 0 };
  }

  _clearOutlet(hz) {
    if (!hz.outlet) return;
    this.scene.remove(hz.outlet.group);
    hz.outlet.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    hz.outlet = null;
  }
}
