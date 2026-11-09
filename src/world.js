import * as THREE from '../vendor/three.module.js';
import { PALETTE, ARENA } from './config.js';
import { glowSprite, makeGlowTexture } from './effects.js';

// Flat, geometric, neon-on-dusk. No lights, no shadows — colour, edges and glow only.
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const randi = (a, b) => a + ((Math.random() * (b - a + 1)) | 0);

// Structures rise out of / sink into the ground on each new round.
const RISE_DEPTH = 30, RISE_DUR = 0.8, SINK_DUR = 0.55;
// Neon accents for the arena architecture — a cohesive cool palette (teal/cyan/blue/
// violet) with magenta + pink as rarer hot pops. Weighted by repetition, no clashing
// greens/ambers (those are reserved for pads & pickups).
const STRUCTURE_COLORS = [0x4bd8c4, 0x4bd8c4, 0x3fb8ff, 0x3fb8ff, 0x5a74ff, 0x8b63ff, 0xff4d9d, 0xff7aa8];
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeIn = (p) => p * p * p;

function gradientSky() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.00, '#070615');   // deep-space indigo (zenith)
  grad.addColorStop(0.34, '#1b1140');   // indigo
  grad.addColorStop(0.58, '#3f2466');   // violet
  grad.addColorStop(0.75, '#7d3474');   // magenta dusk
  grad.addColorStop(0.86, '#ff6450');   // sunset coral
  grad.addColorStop(0.93, '#ffb062');   // warm horizon band
  grad.addColorStop(1.00, '#2a1636');   // ground haze
  g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.SphereGeometry(3000, 32, 16);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  return new THREE.Mesh(geo, mat);
}

// A soft radial gradient texture (bright centre → transparent) for glows/pools.
function radialTex(inner = 'rgba(120,255,220,0.9)', outer = 'rgba(120,255,220,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The CN Tower: tapering shaft, main observation pod, SkyPod, long antenna mast.
function cnTowerInto(grp, mat, x) {
  const add = (geo, y) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, 0); grp.add(m); };
  const H = 320;
  add(new THREE.CylinderGeometry(5, 15, H, 24), H / 2);                 // shaft
  const podY = H * 0.74;
  add(new THREE.CylinderGeometry(24, 24, 20, 24), podY);                // main pod
  add(new THREE.CylinderGeometry(15, 30, 11, 24), podY - 12);           // pod underside
  const upperH = 92;
  add(new THREE.CylinderGeometry(2.4, 5, upperH, 16), podY + 10 + upperH / 2); // upper shaft
  add(new THREE.CylinderGeometry(8.5, 8.5, 10, 20), podY + 10 + upperH * 0.66); // SkyPod
  const antH = 162;
  add(new THREE.CylinderGeometry(0.3, 2, antH, 12), podY + 10 + upperH + antH / 2); // antenna
}

// Toronto's skyline as seen from Lake Ontario: CN Tower + Rogers Centre dome, the
// financial-district tower cluster, and condo towers fanning out on both sides.
function torontoSkyline() {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: PALETTE.silhouette, fog: false });
  const box = (x, w, h, d = 15, y = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, 0); grp.add(m); };
  const tower = (x, w, h, capH = 0) => { box(x, w, h); if (capH) box(x, w * 0.55, capH, 10, h); }; // optional slimmer cap

  // West waterfront condos (CityPlace / Fort York).
  tower(-404, 24, 150); tower(-370, 20, 198, 20); tower(-340, 26, 132);
  tower(-302, 22, 226, 16); tower(-268, 30, 168); tower(-236, 18, 150, 22);

  // Rogers Centre (SkyDome) — low wide dome beside the tower.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(58, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.scale.set(1, 0.42, 1); dome.position.set(-120, 12, 22); grp.add(dome);
  box(-120, 130, 22, 72);

  // CN Tower.
  cnTowerInto(grp, mat, -176);

  // Financial district — the bank-tower cluster stepping up then down.
  tower(-54, 34, 236, 14); tower(-14, 30, 300); tower(26, 42, 330, 18);
  tower(72, 34, 300, 14); tower(114, 30, 258); tower(152, 38, 214, 12); tower(188, 26, 190);

  // East condos tapering off.
  tower(226, 24, 184, 14); tower(260, 28, 150); tower(294, 20, 208, 18);
  tower(332, 26, 140); tower(374, 30, 172); tower(412, 22, 126);

  grp.position.set(10, 0, -860);
  return grp;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.half = ARENA.half;
    this.glowTex = makeGlowTexture();

    this.colliders = [];
    this.pads = [];
    this._staticColliders = [];
    this._pulsers = [];      // static (grid, border)
    this._dynPulsers = [];   // per-layout (pads)
    this.targets = [];       // standable high points (for pad aiming / portals)
    this.structures = [];    // active rising structures
    this.outgoing = [];      // structures sinking away
    this._cur = null;        // structure group currently being built

    scene.fog = new THREE.Fog(0x1a1030, 60, 260);
    scene.add(gradientSky());
    scene.add(torontoSkyline());
    this._buildAtmosphere();
    this._buildFloor();
    this._buildBoundary();

    this.dynamic = new THREE.Group();
    scene.add(this.dynamic);
    this.regenerate();
  }

  // Setting sun, stars, a glowing ground pool and slow-drifting embers. All additive so
  // the bloom pass lights them up.
  _buildAtmosphere() {
    const sc = this.scene;
    // --- sun, low behind the skyline ---
    const sun = new THREE.Group();
    const spr = (tex, size, op) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); s.scale.setScalar(size); return s; };
    sun.add(spr(radialTex('rgba(255,180,110,1)', 'rgba(255,90,70,0)'), 520, 0.9));   // outer halo
    sun.add(spr(radialTex('rgba(255,235,200,1)', 'rgba(255,150,90,0)'), 230, 1.0));  // core
    sun.position.set(70, 120, -1100);
    sc.add(sun);

    // --- stars (upper sky only) ---
    const N = 520, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = 0.15 + Math.random() * 0.85; // bias upward
      const th = u * Math.PI * 2, ph = Math.acos(v);
      const r = 1600;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.9 + 80;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(sGeo, new THREE.PointsMaterial({ map: radialTex('rgba(210,228,255,1)', 'rgba(170,205,255,0)'), size: 6, sizeAttenuation: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sc.add(stars); this._stars = stars;

    // --- drifting embers (small bokeh fireflies) ---
    const M = 180, ep = new Float32Array(M * 3);
    this._emberV = new Float32Array(M);
    for (let i = 0; i < M; i++) {
      ep[i * 3] = (Math.random() * 2 - 1) * this.half;
      ep[i * 3 + 1] = Math.random() * 42;
      ep[i * 3 + 2] = (Math.random() * 2 - 1) * this.half;
      this._emberV[i] = 1.0 + Math.random() * 2.2;
    }
    const eGeo = new THREE.BufferGeometry(); eGeo.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    this._embers = new THREE.Points(eGeo, new THREE.PointsMaterial({ map: radialTex('rgba(255,200,140,1)', 'rgba(255,120,80,0)'), size: 0.42, sizeAttenuation: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    sc.add(this._embers);
  }

  _buildFloor() {
    // Dark blue-indigo floor (not black) so the ground still reads at grazing angles.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.half * 2, this.half * 2),
      new THREE.MeshBasicMaterial({ color: 0x0b1222 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Two grids: a brighter 1-unit lattice + a faint coarse one for depth.
    const grid = new THREE.GridHelper(this.half * 2, this.half, PALETTE.primary, PALETTE.primary);
    grid.material.transparent = true; grid.material.opacity = 0.2;
    grid.position.y = 0.01; this.scene.add(grid);
    const grid2 = new THREE.GridHelper(this.half * 2, this.half / 4, 0x3fb8ff, 0x3fb8ff);
    grid2.material.transparent = true; grid2.material.opacity = 0.12;
    grid2.position.y = 0.015; this.scene.add(grid2);
    this._pulsers.push((t) => { grid.material.opacity = 0.16 + 0.07 * (0.5 + 0.5 * Math.sin(t * 1.6)); });
  }

  _buildBoundary() {
    const h = this.half;
    const pts = [
      new THREE.Vector3(-h, 0.03, -h), new THREE.Vector3(h, 0.03, -h),
      new THREE.Vector3(h, 0.03, h), new THREE.Vector3(-h, 0.03, h),
      new THREE.Vector3(-h, 0.03, -h),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: PALETTE.primary, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }),
    );
    this.scene.add(line);
    this._pulsers.push((t) => { line.material.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.6)); });

    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const s = glowSprite(this.glowTex, PALETTE.primary, 4);
      s.position.set(sx * h, 1.5, sz * h);
      this.scene.add(s);
    }

    // Visible, grappleable boundary cage: vertical ribs + a top rail. Translucent so the
    // horizon and CN Tower still read through it.
    const Hw = ARENA.wallHeight;
    const ribMat = new THREE.LineBasicMaterial({ color: PALETTE.primary, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending });
    const ribs = [];
    const addRib = (x, z) => ribs.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, Hw, z));
    for (let d = -h; d <= h; d += 6) { addRib(d, -h); addRib(d, h); addRib(-h, d); addRib(h, d); }
    const ribGeo = new THREE.BufferGeometry().setFromPoints(ribs);
    this.scene.add(new THREE.LineSegments(ribGeo, ribMat));
    const topPts = [
      new THREE.Vector3(-h, Hw, -h), new THREE.Vector3(h, Hw, -h),
      new THREE.Vector3(h, Hw, h), new THREE.Vector3(-h, Hw, h), new THREE.Vector3(-h, Hw, -h),
    ];
    const topLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(topPts),
      new THREE.LineBasicMaterial({ color: PALETTE.primary, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
    this.scene.add(topLine);

    const t = 2, H = ARENA.wallHeight;
    const wall = (min, max) => this._staticColliders.push({ min, max, climbable: false, boundary: true });
    wall(new THREE.Vector3(-h - t, 0, -h - t), new THREE.Vector3(h + t, H, -h));
    wall(new THREE.Vector3(-h - t, 0, h), new THREE.Vector3(h + t, H, h + t));
    wall(new THREE.Vector3(-h - t, 0, -h), new THREE.Vector3(-h, H, h));
    wall(new THREE.Vector3(h, 0, -h), new THREE.Vector3(h + t, H, h));
  }

  _collider(min, max, climbable = true) { this.colliders.push({ min, max, climbable }); }

  // --- Structure context (each feature is its own group so it can rise/sink on its own) ---
  _beginStructure() {
    const g = new THREE.Group();
    g.position.y = -RISE_DEPTH;             // starts underground
    this.dynamic.add(g);
    this.structures.push({ group: g, t: 0, delay: rand(0, 0.3) });
    this._cur = g;
    // each feature takes a neon accent so the arena reads as a colourful city, not all teal
    this._curColor = pick(STRUCTURE_COLORS);
    return g;
  }

  // A dark neon-edged box, added to the current structure. Everything is climbable.
  _box(cx, cy, cz, w, h, d, { color = this._curColor || PALETTE.primary, opacity = 0.92 } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    // very dark tinted fill so buildings read by their glowing edges, not bright slabs
    const fillCol = new THREE.Color(color).multiplyScalar(0.05).getHex();
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: fillCol, transparent: true, opacity }));
    fill.position.set(cx, cy, cz);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
    );
    edges.position.set(cx, cy, cz);
    this._cur.add(fill, edges);
    this._collider(
      new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
      new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
      true,
    );
  }

  _rungs(cx, cz, hw, h) {
    for (let y = 0.9; y < h - 0.3; y += 1.0) {
      const p = hw + 0.02;
      const pts = [[cx - p, y, cz - p], [cx + p, y, cz - p], [cx + p, y, cz + p], [cx - p, y, cz + p], [cx - p, y, cz - p]];
      this._cur.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts.map((q) => new THREE.Vector3(...q))),
        new THREE.LineBasicMaterial({ color: PALETTE.white, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending }),
      ));
    }
  }

  // --- Architecture pieces (~2x scale; each returns a standable "target") ---
  _platform(x, z) {
    const s = rand(13, 21), h = pick([4.4, 5.6, 7.2]);
    this._box(x, h / 2, z, s, h, s, { opacity: 0.95 });
    this.targets.push({ x, y: h, z });
    return s / 2;
  }

  _tower(x, z) { // stacked, shrinking tiers you can climb like stairs
    const tiers = randi(4, 5);
    let s = rand(13, 18), y = 0;
    for (let i = 0; i < tiers; i++) {
      const h = rand(3, 4.2);
      this._box(x, y + h / 2, z, s, h, s);
      y += h; s *= rand(0.62, 0.74);
    }
    this.targets.push({ x, y, z });
    return rand(7, 9);
  }

  _ziggurat(x, z) { // offset stepped blocks — a jagged climb
    const tiers = randi(4, 5);
    let s = rand(16, 20), y = 0, ox = 0, oz = 0;
    for (let i = 0; i < tiers; i++) {
      const h = rand(2.6, 3.6);
      this._box(x + ox, y + h / 2, z + oz, s, h, s * rand(0.7, 1));
      y += h; s *= 0.68; ox += rand(-1, 1) * s * 0.4; oz += rand(-1, 1) * s * 0.4;
    }
    this.targets.push({ x: x + ox, y, z: z + oz });
    return 10;
  }

  _bridge(x, z) { // two legs + a raised span to run across
    const span = rand(20, 32), h = rand(6, 9), ang = rand(0, Math.PI);
    const dx = Math.cos(ang), dz = Math.sin(ang);
    for (const s of [-1, 1]) this._box(x + dx * span / 2 * s, h / 2, z + dz * span / 2 * s, 4, h, 4);
    const deckGeo = new THREE.BoxGeometry(span, 1.1, 4.4);
    const deck = new THREE.Mesh(deckGeo, new THREE.MeshBasicMaterial({ color: 0x0b0a16, transparent: true, opacity: 0.92 }));
    const de = new THREE.LineSegments(new THREE.EdgesGeometry(deckGeo), new THREE.LineBasicMaterial({ color: PALETTE.primary, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
    deck.position.set(x, h + 0.55, z); de.position.copy(deck.position);
    deck.rotation.y = -ang; de.rotation.y = -ang;
    this._cur.add(deck, de);
    const c = Math.cos(-ang), sn = Math.sin(-ang);
    // approximate the rotated deck with an AABB collider
    this.colliders.push({
      min: new THREE.Vector3(x - (Math.abs(c) * span + Math.abs(sn) * 4.4) / 2, h, z - (Math.abs(sn) * span + Math.abs(c) * 4.4) / 2),
      max: new THREE.Vector3(x + (Math.abs(c) * span + Math.abs(sn) * 4.4) / 2, h + 1.1, z + (Math.abs(sn) * span + Math.abs(c) * 4.4) / 2),
      climbable: true,
    });
    this.targets.push({ x, y: h, z });
    return span / 2;
  }

  _arch(x, z) { // gateway: two legs + a lintel
    const w = rand(11, 18), h = rand(8, 11);
    for (const s of [-1, 1]) this._box(x + s * w / 2, h / 2, z, 3, h, 3);
    this._box(x, h + 1.6, z, w + 3, 3.2, 3);
    this.targets.push({ x, y: h + 3.2, z });
    return w / 2 + 2;
  }

  _pillarField(x, z) { // a cluster of climb pillars
    const n = randi(4, 6), spread = rand(6, 10);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, h = rand(9, 15);
      const px = x + Math.cos(a) * spread, pz = z + Math.sin(a) * spread;
      this._box(px, h / 2, pz, 2.6, h, 2.6);
      this._rungs(px, pz, 1.3, h);
      this.targets.push({ x: px, y: h, z: pz });
    }
    return spread + 2;
  }

  _pillar(x, z) {
    const h = rand(10, 15);
    this._box(x, h / 2, z, 3.2, h, 3.2);
    this._rungs(x, z, 1.6, h);
    this.targets.push({ x, y: h, z });
    return 2.1;
  }

  _cover(x, z) {
    const w = rand(3.5, 7), d = rand(3.5, 7), h = rand(3.5, 6);
    this._box(x, h / 2, z, w, h, d);
    this.targets.push({ x, y: h, z });
    return Math.max(w, d) / 2;
  }

  // Low, jumpable block — a stepping stone (player jump height ~1.85).
  _lowBlock(x, z) {
    const w = rand(3, 6), d = rand(3, 6), h = rand(1.0, 1.7);
    this._box(x, h / 2, z, w, h, d);
    this.targets.push({ x, y: h, z });
    return Math.max(w, d) / 2;
  }

  // An ascending staircase of low steps — parkour your way up to platform height.
  _steps(x, z) {
    const ang = rand(0, Math.PI * 2), dx = Math.cos(ang), dz = Math.sin(ang);
    const n = randi(4, 6), rise = rand(1.2, 1.5), depth = rand(2.4, 3.2), w = rand(3.5, 5.5);
    for (let i = 0; i < n; i++) {
      const h = (i + 1) * rise, px = x + dx * depth * i, pz = z + dz * depth * i;
      this._box(px, h / 2, pz, w, h, depth * 1.1);
      if (i === n - 1) this.targets.push({ x: px, y: h, z: pz });
    }
    return (n * depth) / 2;
  }

  _launchPad(cx, cz, target) {
    this._beginStructure();
    const g = this._cur;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.25, 32),
      new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.85 }));
    disc.position.set(cx, 0.13, cz); g.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.9, 32),
      new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.05, cz); g.add(ring);
    const glow = glowSprite(this.glowTex, PALETTE.accent, 5);
    glow.position.set(cx, 1.2, cz); g.add(glow);
    this._dynPulsers.push((t) => {
      glow.material.opacity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3));
      ring.scale.setScalar(0.9 + 0.2 * (0.5 + 0.5 * Math.sin(t * 3)));
    });
    const dir = new THREE.Vector3(target.x - cx, 0, target.z - cz);
    const dist = Math.max(1, dir.length()); dir.normalize();
    this.pads.push({
      min: new THREE.Vector3(cx - 2.4, 0, cz - 2.4),
      max: new THREE.Vector3(cx + 2.4, 1.2, cz + 2.4),
      dir, up: Math.min(34, 13 + (target.y || 0) * 1.9), forward: Math.min(32, dist * 1.1),
    });
  }

  // Build a fresh, more interesting layout. Called at the start of every round.
  regenerate(avoid = { x: 0, z: 24 }) {
    // Sink the current structures away.
    for (const s of this.structures) {
      s.phase = 'sink'; s.t = 0; s.delay = 0;
      s.group.traverse((o) => { if (o.material) o.material._base = o.material.opacity; });
      this.outgoing.push(s);
    }
    this.structures = [];
    this.colliders = this._staticColliders.slice();
    this.pads = [];
    this._dynPulsers = [];
    this.targets = [];

    const placed = [];
    const clear = (x, z, r) => {
      if (Math.hypot(x - 0, z - 24) < 7 + r) return false;
      if (Math.hypot(x - avoid.x, z - avoid.z) < 6 + r) return false;
      for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < p.r + r + 2.5) return false;
      return true;
    };
    const bound = this.half - 6;
    const feature = (builder, approxR) => {
      for (let i = 0; i < 30; i++) {
        const x = rand(-bound, bound), z = rand(-bound, bound);
        if (clear(x, z, approxR)) {
          this._beginStructure();
          const r = builder(x, z);
          placed.push({ x, z, r: r || approxR });
          return;
        }
      }
    };

    // Big central features from the richer set (~2x density).
    const bigs = [this._platform, this._tower, this._ziggurat, this._bridge, this._arch];
    for (let i = 0, n = randi(3, 4); i < n; i++) feature(pick(bigs).bind(this), 10);

    // Medium pieces.
    const mids = [this._platform, this._arch, this._bridge, this._pillarField];
    for (let i = 0, n = randi(2, 4); i < n; i++) feature(pick(mids).bind(this), 8);

    // Pillars + scattered cover — lots of it, for parkour.
    for (let i = 0, n = randi(4, 6); i < n; i++) feature(this._pillar.bind(this), 2.2);
    for (let i = 0, n = randi(6, 10); i < n; i++) feature(this._cover.bind(this), 3.5);

    // Low, jumpable geometry — stepping stones and staircases that link the ground up.
    for (let i = 0, n = randi(7, 11); i < n; i++) feature(this._lowBlock.bind(this), 3);
    for (let i = 0, n = randi(2, 3); i < n; i++) feature(this._steps.bind(this), 6);

    if (this.targets.length === 0) this.targets.push({ x: 0, y: 4, z: 0 });

    // Launch pads aimed at random high targets.
    const padBound = this.half - 4;
    for (let i = 0, n = randi(3, 5); i < n; i++) {
      const target = pick(this.targets);
      const ang = rand(0, Math.PI * 2), dd = rand(12, 20);
      const px = Math.max(-padBound, Math.min(padBound, target.x + Math.cos(ang) * dd));
      const pz = Math.max(-padBound, Math.min(padBound, target.z + Math.sin(ang) * dd));
      if (clear(px, pz, 2.6)) { placed.push({ x: px, z: pz, r: 2.6 }); this._launchPad(px, pz, target); }
    }
  }

  update(t, dt = 0) {
    for (const p of this._pulsers) p(t);
    for (const p of this._dynPulsers) p(t);

    // Drifting embers (rise + gentle sway, wrap at the ceiling).
    if (this._embers) {
      const a = this._embers.geometry.attributes.position, arr = a.array, h = this.half;
      for (let i = 0; i < this._emberV.length; i++) {
        arr[i * 3 + 1] += this._emberV[i] * dt;
        arr[i * 3] += Math.sin(t * 0.5 + i) * 0.4 * dt;
        if (arr[i * 3 + 1] > 46) { arr[i * 3 + 1] = 0; arr[i * 3] = (Math.random() * 2 - 1) * h; arr[i * 3 + 2] = (Math.random() * 2 - 1) * h; }
      }
      a.needsUpdate = true;
    }
    if (this._stars) this._stars.material.opacity = 0.75 + 0.2 * Math.sin(t * 0.8);

    // Rising structures.
    for (const s of this.structures) {
      if (s.group.position.y >= -0.001) continue;
      s.t += dt;
      const p = Math.max(0, Math.min(1, (s.t - s.delay) / RISE_DUR));
      s.group.position.y = -RISE_DEPTH * (1 - easeOut(p));
    }
    // Sinking structures.
    for (let i = this.outgoing.length - 1; i >= 0; i--) {
      const s = this.outgoing[i];
      s.t += dt;
      const p = Math.min(1, s.t / SINK_DUR);
      s.group.position.y = -RISE_DEPTH * easeIn(p);
      s.group.traverse((o) => { if (o.material && o.material._base != null) o.material.opacity = o.material._base * (1 - p); });
      if (p >= 1) {
        this.dynamic.remove(s.group);
        s.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
        this.outgoing.splice(i, 1);
      }
    }
  }

  // Height of the tallest structure directly under (x,z) — the surface enemies ride/climb.
  terrainHeight(x, z) {
    let h = 0;
    for (const c of this.colliders) {
      if (c.boundary) continue;
      if (x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z && c.max.y > h) h = c.max.y;
    }
    return h;
  }

  spawnPoint(playerPos) {
    const h = this.half - 5;
    for (let i = 0; i < 12; i++) {
      const edge = Math.floor(Math.random() * 4);
      const u = (Math.random() * 2 - 1) * h;
      let x, z;
      if (edge === 0) { x = u; z = -h; }
      else if (edge === 1) { x = u; z = h; }
      else if (edge === 2) { x = -h; z = u; }
      else { x = h; z = u; }
      if (Math.hypot(x - playerPos.x, z - playerPos.z) > 14) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(h, 0, 0);
  }
}
