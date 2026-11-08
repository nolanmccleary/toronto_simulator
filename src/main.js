import * as THREE from '../vendor/three.module.js';
import { PALETTE, WEAPON, WEAPONS, PORTAL, GRAPPLE, DRACO, PUMP, GATLING, MISSILE, POWER, JET, CIVIC, NECRO, PLAYER } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Enemies } from './enemies.js';
import { Effects, glowSprite } from './effects.js';
import { Portals } from './portals.js';
import { Hazards } from './hazards.js';
import { Pickups } from './pickups.js';
import { Powerups } from './powerups.js';
import { Civic } from './civic.js';
import { Allies } from './allies.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { raycastWorld } from './raycast.js';
import { initAudio, sfx, toggleMute } from './audio.js';
import { accountUI } from './accountUI.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.id = 'game';
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(PLAYER.fovBase, innerWidth / innerHeight, 0.1, 4000);

const world = new World(scene);
const player = new Player(camera);
const effects = new Effects(scene);
const enemies = new Enemies(scene, effects);
const portals = new Portals(scene, effects);
const hazards = new Hazards(scene, effects);
const pickups = new Pickups(scene, effects);
const powerups = new Powerups(scene, effects);
const civic = new Civic(scene, effects);
const allies = new Allies(scene, effects);
allies.bind(world);
enemies.bind(world);
enemies.bindAllies(allies);
enemies.onReanimate = (data) => allies.reanimate(data); // dagger kills join the horde
hazards.bind(world);
pickups.bind(world);
powerups.bind(world);
player.portals = portals;
const input = new Input(renderer.domElement);
const hud = new HUD();

enemies.onWaveStart = (n) => { world.regenerate(player.pos); player.settleToGround(world); portals.reset(); player.releaseGrapple(); hud.showBanner('WAVE ' + n); };
enemies.onPlayerHurt = () => hud.flashDamage();
enemies.onBoss = (name) => { hud.showBanner('⚠ BOSSMAN ALERT', 2.6); sfx.over(); };
enemies.onKill = (pos) => { if (power === 'nightyute') wasted.push({ pos: pos.clone(), t: 0 }); }; // "WASTED" marker (Night Yute HUD only)
hazards.onPlayerHurt = () => hud.flashDamage();

let state = 'menu';       // menu | playing | paused | dead
let weapon = 0;           // index into WEAPONS
let weaponCd = 0;
let grappleCd = 0;
let switchCd = 0;
let firePrev = false;    // for semi-auto (Draco) edge detection
let hardcore = false;     // Torontomans one-hit-death
let clock = performance.now();
let worldTime = 0;

// --- Power modes: Somali Samurai + XM01-Night Yute ---
const KATANA_REACH = 5.0;
const KATANA_CD = 0.3;
let power = null;                // null | 'somali' | 'nightyute'
let driving = false;            // Brampton Berserker: inside the impounded Civic
let powerPermanent = false;      // invoked from /console → infinite + indefinite
let powerSnapshot = 100;         // health to restore on revert
let swingCd = 0;
let kTaps = 0, kTapTimer = 0;    // 6 K-taps to tap out of a /console-invoked mode

// neCROmancer state
let necroCharge = 0;             // 0..1 summon bar
let summonProgress = 0;          // 0..1 while holding E to raise a GOLUMN
let daggerCd = 0, hexPrev = false;
let consoleOpen = false;
const wasted = [];               // transient "WASTED" markers {pos, t}
const _proj = new THREE.Vector3();

// Drizzy arsenal state.
let gatlingCd = 0, gatSpin = 0;
let lockTarget = null, lockProgress = 0;
const missiles = [];             // {pos, vel, target, life, group}

// First-person neon katana (viewmodel attached to the camera). Blade runs along +Y;
// the group origin is the grip, so poses rotate around the hand.
const katana = new THREE.Group();
(() => {
  const bladeGeo = new THREE.BoxGeometry(0.04, 1.0, 0.09);
  const blade = new THREE.Mesh(bladeGeo, new THREE.MeshBasicMaterial({ color: 0x7cf2ff }));
  blade.position.y = 0.72;
  const bladeEdge = new THREE.LineSegments(new THREE.EdgesGeometry(bladeGeo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
  bladeEdge.position.y = 0.72;
  const tsuba = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.18), new THREE.MeshBasicMaterial({ color: 0x20252f }));
  tsuba.position.y = 0.18;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.05), new THREE.MeshBasicMaterial({ color: 0x12141c }));
  grip.position.y = 0;
  const gripWrap = new THREE.LineSegments(new THREE.EdgesGeometry(grip.geometry), new THREE.LineBasicMaterial({ color: 0x7cf2ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending }));
  gripWrap.position.copy(grip.position);
  katana.add(blade, bladeEdge, tsuba, grip, gripWrap);
  katana.visible = false;
  camera.add(katana);
  scene.add(camera); // camera must be in the scene graph for its child to render
})();
const katanaState = { swinging: false, t: 0, idleT: 0 };
// Poses: position [x,y,z] + rotation [x,y,z]. idle = held ready (tip up-left),
// wind = cocked up-right, slash = swept down-left (a diagonal cut).
const KPOSE = {
  idle:  { p: [0.62, -0.95, -1.25], r: [0.2, 0.3, 0.5] },
  wind:  { p: [0.78, -0.72, -1.15], r: [-0.2, 0.6, -0.55] },
  slash: { p: [0.1, -1.0, -1.1],   r: [0.6, -0.25, 1.5] },
  guard: { p: [0.22, -0.5, -0.95],  r: [0.0, 0.2, 1.3] },   // blade raised across the view
};
function applyPose(a, b, t) {
  katana.position.set(a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t);
  katana.rotation.set(a.r[0] + (b.r[0] - a.r[0]) * t, a.r[1] + (b.r[1] - a.r[1]) * t, a.r[2] + (b.r[2] - a.r[2]) * t);
}

// Drizzy gatling viewmodel — a spinning cluster of barrels, lower-right.
const gatling = new THREE.Group();
const gatBarrels = new THREE.Group();
(() => {
  const barMat = new THREE.MeshBasicMaterial({ color: 0x3a4150 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), barMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, -0.5);
    gatBarrels.add(bar);
  }
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.5, 12), new THREE.MeshBasicMaterial({ color: 0x14171f }));
  housing.rotation.x = Math.PI / 2; housing.position.z = 0.1;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 16), new THREE.MeshBasicMaterial({ color: GATLING.color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }));
  ring.position.z = -0.14;
  gatling.add(gatBarrels, housing, ring);
  gatling.position.set(0.42, -0.42, -0.7);
  gatling.rotation.set(0.05, -0.06, 0);
  gatling.visible = false;
  camera.add(gatling);
})();

// neCROmancer ceremonial dagger (viewmodel) — small blade, lower-right.
const dagger = new THREE.Group();
(() => {
  const bg = new THREE.BoxGeometry(0.035, 0.42, 0.06);
  const blade = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xcdbbff })); blade.position.y = 0.3;
  const bladeE = new THREE.LineSegments(new THREE.EdgesGeometry(bg), new THREE.LineBasicMaterial({ color: NECRO.color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })); bladeE.position.y = 0.3;
  const gd = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.06), new THREE.MeshBasicMaterial({ color: 0x1a1222 })); gd.position.y = 0.08;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.045), new THREE.MeshBasicMaterial({ color: 0x120a16 }));
  dagger.add(blade, bladeE, gd, grip, glowSprite(effects.glowTex, NECRO.color, 0.9));
  dagger.visible = false; camera.add(dagger);
})();
const daggerState = { swinging: false, t: 0, idleT: 0 };
// Reverse (icepick) grip held point-forward, then a fast straight thrust — not a swing.
const GPOSE = {
  idle:   { p: [0.34, -0.42, -0.6],  r: [-1.0, 0.22, 0.15] },
  back:   { p: [0.4, -0.44, -0.48],  r: [-0.82, 0.32, 0.22] }, // small cock back
  thrust: { p: [0.14, -0.34, -1.12], r: [-1.4, 0.06, 0.03] },  // punch forward (−z)
};
function applyDagger(a, b, t) {
  dagger.position.set(a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t);
  dagger.rotation.set(a.r[0] + (b.r[0] - a.r[0]) * t, a.r[1] + (b.r[1] - a.r[1]) * t, a.r[2] + (b.r[2] - a.r[2]) * t);
}
function animateDagger(dt) {
  if (!daggerState.swinging) { daggerState.idleT += dt; applyDagger(GPOSE.idle, GPOSE.idle, 0); dagger.position.y += Math.sin(daggerState.idleT * 2) * 0.012; return; }
  const T = (daggerState.t += dt);
  if (T < 0.06) applyDagger(GPOSE.idle, GPOSE.back, T / 0.06);                                 // cock back
  else if (T < 0.14) applyDagger(GPOSE.back, GPOSE.thrust, 1 - Math.pow(1 - (T - 0.06) / 0.08, 3)); // snap forward
  else if (T < 0.3) applyDagger(GPOSE.thrust, GPOSE.idle, (T - 0.14) / 0.16);                  // retract
  else daggerState.swinging = false;
}

// Summoning hands — both hands up doing the "6-7" weighing motion during the GOLUMN cast.
function makeNecroHand() {
  const g = new THREE.Group();
  const palmGeo = new THREE.BoxGeometry(0.16, 0.2, 0.1);
  g.add(new THREE.Mesh(palmGeo, new THREE.MeshBasicMaterial({ color: 0x14101c })));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(palmGeo), new THREE.LineBasicMaterial({ color: NECRO.color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })));
  for (let f = 0; f < 4; f++) {
    const fg = new THREE.BoxGeometry(0.03, 0.12, 0.03);
    const fm = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0x14101c })); fm.position.set(-0.05 + f * 0.033, 0.15, 0.02);
    const fe = new THREE.LineSegments(new THREE.EdgesGeometry(fg), new THREE.LineBasicMaterial({ color: NECRO.color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })); fe.position.copy(fm.position);
    g.add(fm, fe);
  }
  g.add(glowSprite(effects.glowTex, NECRO.color, 0.9));
  return g;
}
const necroHands = new THREE.Group();
const handL = makeNecroHand(), handR = makeNecroHand();
handL.position.set(-0.34, -0.52, -0.68); handR.position.set(0.34, -0.52, -0.68);
necroHands.add(handL, handR); necroHands.visible = false; necroHands._t = 0; camera.add(necroHands);
function animateNecroHands(dt, active) {
  necroHands.visible = active;
  if (!active) return;
  necroHands._t += dt;
  const s = Math.sin(necroHands._t * 9);
  handL.position.y = -0.5 + s * 0.09; handR.position.y = -0.5 - s * 0.09; // 6 … 7 … 6 … 7
  handL.rotation.z = s * 0.3; handR.rotation.z = -s * 0.3;
}

// --- Held weapon viewmodels (Strap / Draco / Pump), lower-right, barrel toward -z ---
// Minimal neon-edged geometry, same visual language as the katana & Gat. Only the
// currently selected weapon is visible, and only while no power mode is active.
const guns = {};        // name -> { group, base:{p,r}, ads?:{p,r} }
let vmKick = 0;         // 0..1 recoil on the held gun, decays each frame
let vmIdleT = 0;        // idle-sway clock
let vmAds = 0;          // 0..1 aim-down-sights blend (pump iron sights)
function gunPart(geo, fill, line, opacity = 0.85) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: fill }));
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: line, transparent: true, opacity, blending: THREE.AdditiveBlending })));
  return m;
}
function makeGun(name, base, build) {
  const g = new THREE.Group();
  build(g);
  g.position.set(base.p[0], base.p[1], base.p[2]);
  g.rotation.set(base.r[0], base.r[1], base.r[2]);
  g.visible = false;
  camera.add(g);
  guns[name] = { group: g, base };
}
const GUN_BODY = 0x12151c, GUN_TUBE = 0x0e1016;
// Modeling helpers for the viewmodels.
const place = (m, x, y, z, rx = 0) => { m.position.set(x, y, z); if (rx) m.rotation.x = rx; return m; };
const box = (w, h, d, line, op = 1) => gunPart(new THREE.BoxGeometry(w, h, d), GUN_BODY, line, op);
const tubeZ = (r, len, line, seg = 16) => { const m = gunPart(new THREE.CylinderGeometry(r, r, len, seg), GUN_TUBE, line, 0.85); m.rotation.x = Math.PI / 2; return m; };
const taperZ = (r1, r2, len, line) => { const m = gunPart(new THREE.CylinderGeometry(r1, r2, len, 16), GUN_TUBE, line, 0.85); m.rotation.x = Math.PI / 2; return m; };
const glow = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
const guard = (color) => { const m = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 6, 18), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 })); m.rotation.y = Math.PI / 2; return m; };
const lensDisc = (r, color) => new THREE.Mesh(new THREE.CircleGeometry(r, 18), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));

makeGun('strap', { p: [0.25, -0.29, -0.55], r: [0.06, -0.12, 0.02] }, (g) => {
  const c = PALETTE.primary; // teal compact carbine
  g.add(place(box(0.1, 0.13, 0.36, c), 0, 0, -0.06));          // receiver
  g.add(place(box(0.08, 0.04, 0.14, c), 0, 0.085, -0.02));     // top cover / sight rib
  g.add(place(tubeZ(0.026, 0.32, c), 0, 0.02, -0.34));         // barrel
  g.add(place(taperZ(0.04, 0.03, 0.07, c), 0, 0.02, -0.52));   // flash hider
  g.add(place(glow(0.014, 0.014, 0.26, c), 0, 0.093, -0.12));  // glowing top rail
  g.add(place(box(0.018, 0.05, 0.018, c, 0.8), 0, 0.1, -0.3)); // front sight post
  g.add(place(guard(c), 0, -0.075, 0.0));                      // trigger guard
  g.add(place(box(0.065, 0.19, 0.08, c), 0, -0.15, 0.07, 0.36));   // grip
  g.add(place(box(0.05, 0.18, 0.055, c), 0, -0.145, -0.09, -0.12)); // magazine
});
makeGun('draco', { p: [0.24, -0.25, -0.56], r: [0.045, -0.1, 0.015] }, (g) => {
  const c = 0xffd166; // amber precision rifle
  g.add(place(box(0.09, 0.11, 0.58, c), 0, 0, -0.12));         // long receiver
  g.add(place(tubeZ(0.019, 0.64, c), 0, 0.008, -0.62));        // long barrel
  g.add(place(taperZ(0.04, 0.03, 0.09, c), 0, 0.008, -0.96));  // muzzle brake
  g.add(place(tubeZ(0.04, 0.28, c, 20), 0, 0.12, -0.14));      // scope tube
  g.add(place(box(0.016, 0.07, 0.016, c, 0.8), 0, 0.07, -0.03));  // scope mount
  g.add(place(box(0.016, 0.07, 0.016, c, 0.8), 0, 0.07, -0.25));  // scope mount
  g.add(place(lensDisc(0.034, c), 0, 0.12, -0.005));          // glowing rear lens
  g.add(place(box(0.05, 0.035, 0.12, c, 0.8), 0, 0.045, 0.2));    // cheek riser
  g.add(place(guard(c), 0, -0.075, 0.02));
  g.add(place(box(0.065, 0.18, 0.08, c), 0, -0.14, 0.11, 0.3));   // grip
  g.add(place(box(0.07, 0.12, 0.22, c), 0, -0.03, 0.33));      // stock
});
makeGun('pump', { p: [0.25, -0.29, -0.55], r: [0.05, -0.12, 0.02] }, (g) => {
  const c = 0xff8c42; // orange shotgun
  g.add(place(box(0.1, 0.12, 0.44, c), 0, 0, -0.04));          // receiver
  g.add(place(tubeZ(0.044, 0.5, c), 0, 0.045, -0.42));         // wide barrel
  g.add(place(taperZ(0.055, 0.05, 0.05, c), 0, 0.045, -0.68)); // choke
  g.add(place(tubeZ(0.028, 0.44, c), 0, -0.035, -0.4));        // tube magazine
  g.add(place(box(0.085, 0.07, 0.15, c), 0, -0.035, -0.3));    // pump foregrip
  g.add(place(glow(0.013, 0.013, 0.13, c), 0, 0.006, -0.33));  // slide accent
  g.add(place(box(0.02, 0.035, 0.018, c, 0.8), 0, 0.105, -0.52)); // bead sight
  g.add(place(guard(c), 0, -0.07, 0.02));
  g.add(place(box(0.075, 0.19, 0.09, c), 0, -0.14, 0.13, 0.3));  // grip
  g.add(place(box(0.08, 0.13, 0.22, c), 0, -0.02, 0.33));      // stock
});
// Iron-sight pose: centre the gun so the bead (local y≈0.105, z≈-0.52) lands on the crosshair.
guns.pump.ads = { p: [0.0, -0.105, -0.5], r: [0, 0, 0] };
// Show only the held gun, and only when free (no power mode / not driving the Civic).
function updateGunVisibility() {
  const show = (power || driving) ? null : WEAPONS[weapon];
  for (const name in guns) guns[name].group.visible = (name === show);
}
function updateViewmodels(dt) {
  vmKick = Math.max(0, vmKick - dt * 7);
  vmIdleT += dt;
  // Pump iron sights: ramp the ADS blend up while right-click is held.
  const aiming = !power && WEAPONS[weapon] === 'pump' && input.firing2;
  vmAds += ((aiming ? 1 : 0) - vmAds) * Math.min(1, dt * 14);
  for (const name in guns) {
    const { group, base, ads } = guns[name];
    if (!group.visible) continue;
    const t = ads ? vmAds : 0;                 // only the pump has an ADS pose
    const calm = 1 - t * 0.85;                 // steadier hold while aiming
    const sway = Math.sin(vmIdleT * 1.6) * 0.004 * calm;
    const swayR = Math.sin(vmIdleT * 1.1) * 0.01 * calm;
    const px = base.p[0] + (t ? (ads.p[0] - base.p[0]) * t : 0);
    const py = base.p[1] + (t ? (ads.p[1] - base.p[1]) * t : 0);
    const pz = base.p[2] + (t ? (ads.p[2] - base.p[2]) * t : 0);
    const rx = base.r[0] + (t ? (ads.r[0] - base.r[0]) * t : 0);
    const ry = base.r[1] + (t ? (ads.r[1] - base.r[1]) * t : 0);
    const rz = base.r[2] + (t ? (ads.r[2] - base.r[2]) * t : 0);
    group.position.set(px, py + sway, pz + vmKick * 0.12); // recoil shoves it back
    group.rotation.set(rx - vmKick * 0.25, ry, rz + swayR); // ...and kicks the muzzle up
  }
}

// --- Brampton Berserker: driver's-seat interior (steering wheel + left hand + dash) ---
const civicInterior = new THREE.Group();
const wheelSpin = new THREE.Group();   // the rim + hand, rotates with steering
(() => {
  const red = CIVIC.color;
  const edge = (geo, op = 1) => new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: red, transparent: true, opacity: op, blending: THREE.AdditiveBlending }));
  const dark = (geo) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x16090c }));
  // Steering wheel: a big rim + spokes in a pivot tilted back toward the driver.
  const pivot = new THREE.Group();
  pivot.position.set(0.0, -0.36, -0.52);
  pivot.rotation.x = -0.92;
  const rimGeo = new THREE.TorusGeometry(0.32, 0.03, 12, 32);
  wheelSpin.add(dark(rimGeo), edge(rimGeo));
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3) - Math.PI / 2;  // spokes to bottom-left/right + top
    const spokeGeo = new THREE.BoxGeometry(0.03, 0.28, 0.02);
    const s = dark(spokeGeo); s.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0); s.rotation.z = a - Math.PI / 2;
    const se = edge(spokeGeo, 0.9); se.position.copy(s.position); se.rotation.copy(s.rotation);
    wheelSpin.add(s, se);
  }
  const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.04, 14);
  const hub = dark(hubGeo); hub.rotation.x = Math.PI / 2; wheelSpin.add(hub, (() => { const e = edge(hubGeo, 0.8); e.rotation.x = Math.PI / 2; return e; })());
  // Left hand gripping the 9-o'clock position (turns with the wheel).
  const hand = new THREE.Group();
  const palmGeo = new THREE.BoxGeometry(0.14, 0.17, 0.11);
  hand.add(dark(palmGeo), edge(palmGeo));
  for (let f = 0; f < 4; f++) {
    const fg = new THREE.BoxGeometry(0.12, 0.035, 0.03);
    const fm = dark(fg); fm.position.set(0.04, 0.06 - f * 0.038, 0.06);
    const fe = edge(fg, 0.9); fe.position.copy(fm.position);
    hand.add(fm, fe);
  }
  const thumbGeo = new THREE.BoxGeometry(0.04, 0.09, 0.03);
  const thumb = dark(thumbGeo); thumb.position.set(0.0, 0.02, 0.09); thumb.rotation.z = 0.5;
  hand.add(thumb, (() => { const e = edge(thumbGeo, 0.9); e.position.copy(thumb.position); e.rotation.copy(thumb.rotation); return e; })());
  hand.position.set(-0.32, 0, 0.03);
  wheelSpin.add(hand);
  pivot.add(wheelSpin);
  civicInterior.add(pivot);
  // Dashboard lip across the bottom + A-pillar hints up the sides.
  const dashGeo = new THREE.BoxGeometry(2.0, 0.34, 0.5);
  const dash = dark(dashGeo); dash.position.set(0, -0.82, -0.7);
  const dashE = edge(dashGeo, 0.85); dashE.position.copy(dash.position);
  civicInterior.add(dash, dashE);
  civicInterior.visible = false;
  camera.add(civicInterior);
})();

const _cf = new THREE.Vector3(), _cr = new THREE.Vector3(), _cEuler = new THREE.Euler();
function driveCamera() {
  const yaw = civic.yaw;
  _cf.set(-Math.sin(yaw), 0, -Math.cos(yaw)); // car forward
  _cr.set(-_cf.z, 0, _cf.x);                  // car right
  camera.position.set(
    civic.pos.x - _cr.x * 0.42 - _cf.x * 0.15, // left of centre, a touch back
    1.3,
    civic.pos.z - _cr.z * 0.42 - _cf.z * 0.15,
  );
  camera.quaternion.setFromEuler(_cEuler.set(-0.15, yaw, 0, 'YXZ')); // look down a little at the wheel/hood
}
function updateCivicInterior(dt) {
  wheelSpin.rotation.z = -civic.wheel * 1.2; // visually turn the wheel with steering
}

// Grapple rope visual.
const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: PALETTE.primary, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
rope.frustumCulled = false; rope.visible = false;
scene.add(rope);
function updateRope() {
  if (player.grapple.active) {
    const ray = player.getRay();
    ropeGeo.setFromPoints([muzzlePoint(ray).clone(), player.grapple.point]);
    rope.visible = true;
  } else rope.visible = false;
}

// --- Weapons ---
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
function muzzlePoint(ray) {
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  return _muzzle.copy(ray.origin).addScaledVector(ray.dir, 0.5).addScaledVector(_right, 0.16).addScaledVector(_up, -0.14);
}
// Let the player's own fire hit their parked Civic — enough to detonate it as a bomb.
function shootCivic(ray, dmg, range) {
  if (!civic.alive || driving) return;
  const t = civic.rayHit(ray, range);
  if (t == null) return;
  civic.damage(dmg);
  effects.muzzle(ray.origin.clone().addScaledVector(ray.dir, t), CIVIC.color);
  if (civic.hp <= 0) explodeCivic();
}
function fireStrap() {
  const ray = player.getRay();
  const mz = muzzlePoint(ray).clone();
  const res = enemies.hitscan(ray, {
    damage: WEAPON.damage, range: WEAPON.range,
    falloff: { start: WEAPON.falloffStart, end: WEAPON.falloffEnd, min: WEAPON.falloffMin },
  });
  shootCivic(ray, WEAPON.damage, WEAPON.range);
  effects.tracer(mz, res.end, PALETTE.primary);
  effects.muzzle(mz, PALETTE.white);
  vmKick = 0.5;
  sfx.shoot();
}
function firePump(ads = false) {
  const spread = ads ? PUMP.spreadAds : PUMP.spread;
  const mz = muzzlePoint(player.getRay()).clone();
  // A fan of pellets; each is its own hitscan against the nearest thing in its path.
  for (let i = 0; i < PUMP.pellets; i++) {
    const ray = player.getRay();
    ray.dir.x += (Math.random() - 0.5) * spread;
    ray.dir.y += (Math.random() - 0.5) * spread;
    ray.dir.z += (Math.random() - 0.5) * spread;
    ray.dir.normalize();
    const res = enemies.hitscan(ray, {
      damage: PUMP.damage, range: PUMP.range,
      falloff: { start: PUMP.falloffStart, end: PUMP.falloffEnd, min: PUMP.falloffMin },
    });
    shootCivic(ray, PUMP.damage, PUMP.range);
    effects.tracer(mz, res.end, PALETTE.hazard);
  }
  effects.muzzle(mz, PALETTE.white);
  vmKick = 1.0;
  sfx.shoot();
}
function fireDraco() {
  const ray = player.getRay();
  const mz = muzzlePoint(ray).clone();
  // Sniper: no falloff, and the round punches through everything in line.
  const res = enemies.hitscan(ray, { damage: DRACO.damage, range: DRACO.range, pierce: true });
  shootCivic(ray, DRACO.damage, DRACO.range);
  effects.beam(mz, res.end, 0xfff2b0, { radius: 0.11, life: 0.32 });
  effects.tracer(mz, res.end, PALETTE.white);
  effects.muzzle(mz, PALETTE.white);
  effects.muzzle(res.end, 0xfff2b0);
  vmKick = 1.0;
  sfx.snipe();
}
function firePortal(which) {
  const ray = player.getRay();
  const hit = portals.raycast(ray, world);
  const color = which === 'A' ? PALETTE.portalA : PALETTE.portalB;
  const mz = muzzlePoint(ray).clone();
  if (hit) { effects.tracer(mz, hit.point, color); portals.place(which, hit); }
  else { effects.tracer(mz, ray.origin.clone().addScaledVector(ray.dir, PORTAL.range), color); }
}
function setWeapon(i) {
  weapon = (i + WEAPONS.length) % WEAPONS.length;
  player.releaseGrapple();
  player.scopeFov = null; hud.setScoped(false);
  hud.setWeapon(WEAPONS[weapon]);
  updateGunVisibility();
  sfx.swap();
}

// Right-click zipline (shared by Strap and the power modes).
function tryGrapple() {
  if (input.firing2 && !player.grapple.active && grappleCd <= 0) {
    grappleCd = GRAPPLE.cooldown;
    const ray = player.getRay();
    const hit = raycastWorld(ray, world, GRAPPLE.range, { skipBoundary: true });
    if (hit) { player.startGrapple(hit.point); effects.tracer(muzzlePoint(ray).clone(), hit.point, PALETTE.primary); sfx.zip(); }
  }
}

// --- Power modes ---
// permanent (from /console) = infinite HP + indefinite; otherwise aux-HP package mode.
function engagePower(kind, { permanent = false, aux = POWER.auxHp } = {}) {
  if (power || driving) return;
  power = kind; powerPermanent = permanent; powerSnapshot = player.health;
  player.invuln = permanent;                 // console = infinite; package = aux shield
  player.auxHp = permanent ? 0 : aux;
  player.scopeFov = null;
  if (kind === 'somali') {
    player.speedMul = POWER.somaliSpeed; player.flySpeedMul = POWER.somaliSpeed; player.jetpackEnabled = false;
  } else if (kind === 'nightyute') {
    player.speedMul = POWER.nightGroundSpeed; player.flySpeedMul = POWER.nightFlySpeed;
    player.jetpackEnabled = true; player.fuel = JET.fuelMax;
  } else { // necro
    player.speedMul = NECRO.speed; player.flySpeedMul = NECRO.speed; player.jetpackEnabled = false;
    allies.reset(); necroCharge = 0; summonProgress = 0; daggerState.swinging = false;
  }
  katana.visible = (kind === 'somali');
  gatling.visible = (kind === 'nightyute');
  dagger.visible = (kind === 'necro');
  updateGunVisibility(); // hide the held gun while a power mode is active
  hud.setPowerMode(kind);
  hud.showBanner(kind === 'somali' ? 'WALLAHI MODE ACTIVATED' : kind === 'nightyute' ? 'NIGHT YUTE ONLINE' : 'neCROmancer SUMMONED', 2.4);
  sfx.wave();
}
function disengagePower() {
  if (!power) return;
  power = null; powerPermanent = false;
  player.invuln = false; player.auxHp = 0;
  player.speedMul = 1; player.flySpeedMul = 1; player.jetpackEnabled = false; player.flying = false;
  player.guarding = false;
  katana.visible = false; gatling.visible = false; dagger.visible = false; katanaState.swinging = false;
  clearDrizzy(); clearNecro();
  player.health = Math.min(PLAYER.maxHealth, powerSnapshot); // save as before
  wasted.length = 0; kTaps = 0;
  hud.setPowerMode(null);
  hud.setWeapon(WEAPONS[weapon]);
  updateGunVisibility(); // bring the held gun back
}
function resetPower() {
  power = null; powerPermanent = false; swingCd = 0; kTaps = 0; wasted.length = 0;
  player.invuln = false; player.auxHp = 0; player.speedMul = 1; player.flySpeedMul = 1;
  player.jetpackEnabled = false; player.flying = false; player.guarding = false;
  katana.visible = false; gatling.visible = false; dagger.visible = false; katanaState.swinging = false;
  clearDrizzy(); clearNecro();
  updateGunVisibility();
  hud.setPowerMode(null);
}

// Dismiss the whole horde + necro viewmodels/state.
function clearNecro() {
  allies.reset();
  necroCharge = 0; summonProgress = 0; daggerState.swinging = false;
  necroHands.visible = false;
  player.frozen = false;
}

// --- Brampton Berserker (impounded Civic) ---
function enterCivic({ permanent = false } = {}) {
  if (driving || power || !civic.alive) return;
  driving = true;
  civic.invincible = permanent;
  player.vehicle = civic;        // enemy hits now drain the Civic's HP
  player.hitRadius = CIVIC.radius; // and connect against the whole car body, not a point
  player.releaseGrapple();
  player.scopeFov = null; hud.setScoped(false);
  updateGunVisibility();         // hide the held gun
  civicInterior.visible = true;
  hud.setCivicMode(true);
  hud.showBanner('BRAMPTON BERSERKER MODE ENGAGED', 2.4);
  sfx.wave();
}
function spawnAndDrive(pos, yaw, opts) {
  if (!civic.alive) civic.spawn(pos, yaw);
  enterCivic(opts);
}
function leaveCivicHud() {
  driving = false;
  player.vehicle = null;
  player.hitRadius = PLAYER.radius;
  civicInterior.visible = false;
  hud.setCivicMode(false);
  hud.setWeapon(WEAPONS[weapon]);
  updateGunVisibility();
}
function exitCivic() {
  if (!driving) return;
  // step out the driver's door (to the car's left)
  const yaw = civic.yaw, lx = -Math.cos(yaw), lz = Math.sin(yaw);
  leaveCivicHud();
  player.pos.set(civic.pos.x + lx * 2.6, 0, civic.pos.z + lz * 2.6);
  player.vel.set(0, 0, 0);
  player.yaw = yaw; player.pitch = 0;
}
function explodeCivic() {
  const wasDriving = driving;
  civic.explode(enemies);
  if (wasDriving) { leaveCivicHud(); player.pos.set(civic.pos.x, 0, civic.pos.z); player.vel.set(0, 0, 0); player.yaw = civic.yaw; }
  hud.showBanner('CIVIC REPOSSESSED', 2.4);
  sfx.over();
}
function resetCivic() {
  if (driving) leaveCivicHud();
  civic.dispose();
}

function animateKatana(dt) {
  if (!katanaState.swinging) {
    katanaState.idleT += dt;
    if (player.guarding) {
      // Braced guard stance — a tight shimmer, no loose sway.
      applyPose(KPOSE.guard, KPOSE.guard, 0);
      katana.position.y += Math.sin(katanaState.idleT * 7) * 0.006;
      return;
    }
    // Gentle idle sway so it feels alive.
    applyPose(KPOSE.idle, KPOSE.idle, 0);
    katana.position.y += Math.sin(katanaState.idleT * 1.8) * 0.015;
    katana.rotation.z += Math.sin(katanaState.idleT * 1.3) * 0.03;
    return;
  }
  const T = (katanaState.t += dt);
  if (T < 0.08) applyPose(KPOSE.idle, KPOSE.wind, T / 0.08);              // quick cock back
  else if (T < 0.22) applyPose(KPOSE.wind, KPOSE.slash, 1 - Math.pow(1 - (T - 0.08) / 0.14, 3)); // fast cut
  else if (T < 0.42) applyPose(KPOSE.slash, KPOSE.idle, (T - 0.22) / 0.20); // recover
  else { katanaState.swinging = false; }
}

function powerUpdate(dt) {
  if (power === 'somali') somaliWeapons(dt);
  else if (power === 'nightyute') nightyuteWeapons(dt);
  else if (power === 'necro') necroWeapons(dt);
  for (let i = wasted.length - 1; i >= 0; i--) { wasted[i].t += dt; if (wasted[i].t > 0.6) wasted.splice(i, 1); }
}

// neCROmancer: dagger (left, reanimates kills), hex (right, focus-fire the horde),
// a summon bar → hold E to raise a GOLUMN while the hands do the 6-7.
function necroWeapons(dt) {
  daggerCd -= dt;
  const summoning = summonProgress > 0;
  if (input.firing && daggerCd <= 0 && !summoning) {
    daggerCd = NECRO.dagger.cooldown;
    daggerState.swinging = true; daggerState.t = 0;
    enemies.daggerSweep(player, NECRO.dagger.range, NECRO.dagger.damage);
  }
  // right-click hexes the aimed enemy — the horde focus-fires it
  const hexEdge = input.firing2 && !hexPrev; hexPrev = input.firing2;
  if (hexEdge) {
    const tgt = enemies.lockTarget(player.getRay(), NECRO.hexCone);
    if (tgt && tgt !== enemies.boss && player.pos.distanceTo(tgt.pos) < NECRO.hexRange) { allies.setHex(tgt); sfx.lock(); }
  }
  // summon bar fills; hold E when full to cast
  const casting = necroCharge >= 1 && input.down('KeyE');
  if (necroCharge < 1) necroCharge = Math.min(1, necroCharge + dt / NECRO.charge);
  if (casting) {
    summonProgress += dt / NECRO.summonHold;
    if (summonProgress >= 1) {
      allies.summonGolumn(player.pos.clone().addScaledVector(player._fwd, 4.5));
      necroCharge = 0; summonProgress = 0;
      hud.showBanner('CRODIE SUMMONED', 2.0); sfx.over();
    }
  } else if (summonProgress > 0) {
    summonProgress = Math.max(0, summonProgress - dt * 2.5); // released early → recedes
  }
  const showHands = summonProgress > 0;
  player.frozen = showHands;        // rooted while summoning — no run or jump
  dagger.visible = !showHands;
  animateDagger(dt);
  animateNecroHands(dt, showHands);
  allies.update(dt, enemies, player, worldTime);
}

// Somali Samurai: Sauga Sabre. Left-click swings; hold right-click to raise a
// guard that parries frontal melee and reflects projectiles (can't swing while up).
function somaliWeapons(dt) {
  swingCd -= dt;
  const guarding = input.firing2;
  player.guarding = guarding;
  if (guarding) player.guardDir.copy(player._fwd); // horizontal facing
  if (input.firing && !guarding && swingCd <= 0) {
    swingCd = KATANA_CD;
    katanaState.swinging = true; katanaState.t = 0;
    enemies.katanaSweep(player, KATANA_REACH);
    sfx.slice();
  }
  animateKatana(dt);
}

// Night Yute: Gat (left) + lock-on guided missiles (right) — never both at once.
function nightyuteWeapons(dt) {
  gatlingCd -= dt;
  const locking = input.firing2;               // right-click = missiles
  const firingGat = input.firing && !locking;  // can't Gat while locking missiles
  if (firingGat && gatlingCd <= 0) { gatlingCd = GATLING.cooldown; fireGatling(); }
  gatSpin += dt * (firingGat ? 24 : 3);
  gatBarrels.rotation.z = gatSpin;

  if (locking) {
    const tgt = enemies.lockTarget(player.getRay(), MISSILE.lockCone);
    if (tgt && tgt === lockTarget) {
      const was = lockProgress;
      lockProgress += dt / MISSILE.lockTime;
      if ((lockProgress * 5 | 0) !== (was * 5 | 0)) sfx.lock();
      if (lockProgress >= 1) { fireMissile(lockTarget); lockProgress = 0; sfx.locked(); }
    } else { lockTarget = tgt; lockProgress = 0; }
  } else { lockTarget = null; lockProgress = 0; }
  if (lockTarget && !enemies.hasTarget(lockTarget)) { lockTarget = null; lockProgress = 0; }

  updateMissiles(dt);
}

function fireGatling() {
  const ray = player.getRay();
  ray.dir.x += (Math.random() - 0.5) * GATLING.spread;
  ray.dir.y += (Math.random() - 0.5) * GATLING.spread;
  ray.dir.z += (Math.random() - 0.5) * GATLING.spread;
  ray.dir.normalize();
  const mz = muzzlePoint(ray).clone();
  const res = enemies.hitscan(ray, { damage: GATLING.damage, range: GATLING.range });
  shootCivic(ray, GATLING.damage, GATLING.range);
  effects.tracer(mz, res.end, GATLING.color);   // thin tracer only — no strobing muzzle flash
  sfx.gat();
}

function fireMissile(target) {
  const mz = muzzlePoint(player.getRay()).clone();
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 8), new THREE.MeshBasicMaterial({ color: MISSILE.color }));
  group.add(body, glowSprite(effects.glowTex, MISSILE.color, 1.6));
  group.position.copy(mz);
  scene.add(group);
  // Loft the launch: up + toward the target, so it clears cover before homing down.
  const to = target.pos.clone().sub(mz); to.y = 0;
  const dir = to.normalize().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.85, 0)).normalize();
  missiles.push({ pos: mz.clone(), vel: dir.multiplyScalar(MISSILE.speed), target, life: MISSILE.life, group });
  sfx.missile();
}

function missileInSolid(pos) {
  for (const c of world.colliders) {
    if (pos.x > c.min.x && pos.x < c.max.x && pos.y > c.min.y && pos.y < c.max.y && pos.z > c.min.z && pos.z < c.max.z) return true;
  }
  return false;
}

const _mv = new THREE.Vector3(), _aim = new THREE.Vector3();
function updateMissiles(dt) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    m.life -= dt;
    if (m.target && !enemies.hasTarget(m.target)) m.target = null;
    if (m.target) {
      // Aim above the target while far away (fly over barriers), drop onto it when close.
      const dist = m.pos.distanceTo(m.target.pos);
      _aim.copy(m.target.pos); _aim.y += Math.min(1, dist / 16) * MISSILE.loft;
      _mv.copy(_aim).sub(m.pos).normalize().multiplyScalar(MISSILE.speed);
      m.vel.lerp(_mv, Math.min(1, MISSILE.turn * dt)).normalize().multiplyScalar(MISSILE.speed); // limited turn radius
    }
    m.pos.addScaledVector(m.vel, dt);
    m.group.position.copy(m.pos);
    m.group.quaternion.setFromUnitVectors(_mv.set(0, 1, 0), m.vel.clone().normalize());

    const tr = m.target ? (m.target.radius || m.target.hitR || 1) : 0;
    const hit = m.target && m.pos.distanceTo(m.target.pos) < MISSILE.hitR + tr;
    const oob = Math.abs(m.pos.x) > world.half + 2 || Math.abs(m.pos.z) > world.half + 2 || m.pos.y < 0;
    // Detonate on a barrier it couldn't clear (ignore its first moment above the ground).
    const wall = m.pos.y < 20 && missileInSolid(m.pos);
    if (hit || wall || m.life <= 0 || oob) {
      enemies.splash(m.pos.clone(), MISSILE.splashR, MISSILE.damage);
      effects.flash(m.pos.clone(), MISSILE.color, 8, 0.4);
      effects.burst(m.pos.clone(), MISSILE.color);
      scene.remove(m.group); m.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      missiles.splice(i, 1);
    }
  }
}

function clearDrizzy() {
  gatling.visible = false;
  lockTarget = null; lockProgress = 0;
  for (const m of missiles) { scene.remove(m.group); m.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
  missiles.length = 0;
  hud.setLock(0, false);
}

// Project enemies/boss to screen for the fighter-jet target HUD.
function updateJetHud() {
  const W = innerWidth, H = innerHeight, entries = [];
  const add = (src, pos, label, isWasted) => {
    _proj.copy(pos).project(camera);
    if (_proj.z > 1) return;
    const e = {
      x: (_proj.x * 0.5 + 0.5) * W, y: (-_proj.y * 0.5 + 0.5) * H,
      label, wasted: isWasted, dist: isWasted ? null : Math.round(player.pos.distanceTo(pos)),
    };
    if (src && src === lockTarget) e.lock = lockProgress;
    entries.push(e);
  };
  for (const e of enemies.list) add(e, e.pos, 'yute', false);
  if (enemies.bossAlive) add(enemies.boss, enemies.boss.pos, 'BOSSMAN', false);
  for (const w of wasted) add(null, w.pos, 'WASTED', true);
  hud.updateTargets(entries);

  const hdg = ((Math.round(player.yaw * 180 / Math.PI) % 360) + 360) % 360;
  const spd = Math.round(Math.hypot(player.vel.x, player.vel.z) * 12);
  const alt = Math.round(player.pos.y * 20);
  hud.setJetReadouts(hdg, spd, alt);
  hud.setLock(lockTarget ? lockProgress : 0, !!lockTarget);
}

// --- State transitions ---
function beginPlay() {
  player.reset();
  player.hardcore = hardcore;
  world.regenerate(player.pos);
  portals.reset();
  enemies.reset();
  hazards.reset();
  pickups.reset();
  powerups.reset();
  weaponCd = 0;
  resetPower();
  resetCivic();
  setWeapon(0);
  hud.setHealth(player.health, PLAYER.maxHealth);
  hud.hideBoss();
  hud.showPrompt(null);
  hud.showStart(false);
  hud.showGameOver(false);
  hud.showBanner('GET READY', 2.0);
  hud.showCompass(true);
  state = 'playing';
}

function gameOver() {
  state = 'dead';
  hud.hideBoss();
  hud.showCompass(false);
  input.exitLock();
  sfx.over();
  hud.showGameOver(true, enemies.score, enemies.wave);
  accountUI.reportScore(enemies.score, enemies.wave); // posts the run if logged in
}

input.onLockChange((locked) => {
  if (locked) {
    if (state === 'paused') { state = 'playing'; hud.showStart(false); }
    else if (state === 'menu' || state === 'dead') { beginPlay(); }
  } else if (state === 'playing' && player.alive && !consoleOpen) {
    state = 'paused';
    hud.setStartMode('paused');
    hud.showStart(true);
  }
});

function requestPlay() {
  initAudio();
  if (state === 'paused') hud.setStartMode('paused');
  input.requestLock();
}

document.getElementById('start').addEventListener('click', requestPlay);
document.getElementById('gameover').addEventListener('click', () => { initAudio(); input.requestLock(); });

const hc = document.getElementById('hardcore-toggle');
hc.addEventListener('click', (e) => {
  e.stopPropagation();
  hardcore = !hardcore;
  hc.classList.toggle('on', hardcore);
  hud.setHardcore(hardcore);
});

addEventListener('keydown', (e) => {
  if (consoleOpen) return; // the console input handles its own keys
  if (e.code === 'KeyM') { const m = toggleMute(); hud.showBanner(m ? 'MUTED' : 'SOUND ON', 0.9); }
  if (state !== 'playing') return;

  // "/" opens the mode console (pauses the game).
  if (e.code === 'Slash') { e.preventDefault(); openConsole(); return; }

  // Tap out of a /console-invoked (indefinite) mode with six K presses.
  if (e.code === 'KeyK' && !e.repeat) {
    kTaps += 1; kTapTimer = 1.3;
    if (kTaps >= 6) {
      if (power && powerPermanent) { kTaps = 0; disengagePower(); }
      else if (driving && civic.invincible) { kTaps = 0; exitCivic(); civic.dispose(); }
    }
    return;
  }

  // "E" — enter/exit the Civic, or activate the power-up package you're standing on.
  if (e.code === 'KeyE' && !e.repeat) {
    if (driving) { exitCivic(); return; }
    if (civic.alive && civic.nearPlayer(player)) { enterCivic(); return; }
    if (!power) {
      const mode = powerups.nearMode(player);
      if (mode === 'civic') { powerups.consume(); spawnAndDrive(player.pos.clone(), player.yaw); }
      else if (mode) { powerups.consume(); engagePower(mode, { permanent: false, aux: POWER.auxHp }); }
    }
    return;
  }

  if (power || driving) return; // weapon switching disabled during power modes / driving
  if (e.code === 'Digit1') setWeapon(0);
  if (e.code === 'Digit2') setWeapon(1);
  if (e.code === 'Digit3') setWeapon(2);
});

// --- Mode console ("/") — pauses the game; type a mode to invoke it indefinitely ---
function openConsole() { consoleOpen = true; input.exitLock(); hud.showConsole(true); }
function closeConsole() { consoleOpen = false; hud.showConsole(false); }
function parseMode(s) {
  s = (s || '').toLowerCase();
  if (/somali|samurai|wallahi/.test(s)) return 'somali';
  if (/yute|drizzy|xm01|night/.test(s)) return 'nightyute';
  if (/brampton|berserker|civic|honda/.test(s)) return 'civic';
  if (/necro|cromancer|summon|golum|gollum/.test(s)) return 'necro';
  return null;
}
const consoleInput = document.getElementById('console-input');
consoleInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.code === 'Enter') {
    const raw = consoleInput.value.trim();
    const mode = parseMode(raw);
    const normal = /1\s*$/.test(raw); // trailing "1" → normal mortal version instead of infinite
    const opts = normal ? { permanent: false, aux: POWER.auxHp } : { permanent: true };
    consoleInput.value = ''; closeConsole();
    if (mode === 'civic') { if (!power && !driving) spawnAndDrive(player.pos.clone(), player.yaw, opts); }
    else if (mode) engagePower(mode, opts);
    state = 'paused'; hud.setStartMode('paused'); hud.showStart(true); // pointer-lock lost → resume overlay
  } else if (e.code === 'Escape') {
    consoleInput.value = ''; closeConsole();
    state = 'paused'; hud.setStartMode('paused'); hud.showStart(true);
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Loop ---
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  let dt = (now - clock) / 1000;
  clock = now;
  if (dt > 0.05) dt = 0.05;
  worldTime += dt;

  if (state === 'playing' && !consoleOpen) {
    weaponCd -= dt; grappleCd -= dt;
    if (kTapTimer > 0) { kTapTimer -= dt; if (kTapTimer <= 0) kTaps = 0; }
    enemies.pendingCharge = 0; // (charge system removed; keep the accumulator clear)

    if (driving) {
      civic.update(dt, input, world, enemies, worldTime);
      player.pos.copy(civic.pos);   // enemies target the car; its hits drain the Civic
      player.yaw = civic.yaw;       // compass reads the car's heading
      input.consumeLook();          // discard mouse-look while driving (view is locked forward)
      driveCamera();
      updateCivicInterior(dt);
      hud.showPrompt(null);
      if (civic.hp <= 0) explodeCivic();
    } else if (power) {
      powerUpdate(dt);
      hud.showPrompt(null);
    } else {
      const w = input.consumeWheel();
      switchCd -= dt;
      if (w && switchCd <= 0) { setWeapon(weapon + w); switchCd = 0.3; }
      const fireEdge = input.firing && !firePrev; // rising edge (for semi-auto)
      firePrev = input.firing;
      const wk = WEAPONS[weapon];
      if (wk !== 'draco' && wk !== 'pump' && player.scopeFov) { player.scopeFov = null; hud.setScoped(false); }

      if (wk === 'strap') {
        if (input.firing && weaponCd <= 0) { weaponCd = WEAPON.cooldown; fireStrap(); }
        tryGrapple(); // right-click zipline (no manual disengage)
      } else if (wk === 'slider') { // portal gun: left = orange, right = blue
        if (weaponCd <= 0) {
          if (input.firing) { weaponCd = PORTAL.cooldown; firePortal('A'); }
          else if (input.firing2) { weaponCd = PORTAL.cooldown; firePortal('B'); }
        }
      } else if (wk === 'pump') { // shotgun: semi-auto spread, right-click aims down (zoom + choke)
        const ads = input.firing2;
        player.scopeFov = ads ? PUMP.adsFov : null;
        if (fireEdge && weaponCd <= 0) { weaponCd = PUMP.cooldown; firePump(ads); }
      } else { // draco (sniper): semi-auto, scope on right-mouse
        const scoped = input.firing2;
        player.scopeFov = scoped ? DRACO.scopeFov : null;
        hud.setScoped(scoped);
        if (fireEdge && weaponCd <= 0) { weaponCd = DRACO.cooldown; fireDraco(); }
      }
    }
    if (!driving) updateViewmodels(dt);

    if (!driving) {
      const ev = player.update(dt, input, world);
      if (player._enteringPortal) portals.teleport(player, player._enteringPortal);
      updateRope();
      if (ev.jumped) sfx.jump();
      if (ev.launched) sfx.launch();
    }

    enemies.update(dt, player, worldTime, hazards.activeZones());
    portals.update(dt);
    hazards.update(dt, player, enemies.wave, enemies.state === 'active', portals, enemies);
    pickups.update(dt, player, true);
    // Offer a package only when free (not powered-up / driving); don't stack a 2nd Civic.
    powerups.update(dt, player, !power && !driving, civic.alive ? ['civic'] : null);
    const nearCivic = civic.alive && !driving && civic.nearPlayer(player);
    hud.showPrompt(power || driving ? null : (nearCivic ? 'civic-enter' : powerups.nearMode(player)));

    // Aux-HP package modes revert (restoring health) once the shield is spent.
    if (power && !powerPermanent && player.auxHp <= 0) disengagePower();

    if (power === 'nightyute') updateJetHud();
    if (enemies.bossAlive) {
      const bss = enemies.boss;
      hud.setBoss(bss.name, (bss.hp + (bss.shield || 0)) / (bss.maxHp + (bss.shieldMax || 0)));
    } else hud.hideBoss();

    hud.setHealth(player.health, PLAYER.maxHealth);
    hud.setStats(enemies.wave, enemies.score, enemies.remaining);
    hud.setCompass(player.yaw);
    hud.setPortalStatus(!power && !driving && WEAPONS[weapon] === 'slider', portals.a.active, portals.b.active);
    if (driving) hud.setCivicHealth(civic.invincible ? Infinity : civic.hp, civic.maxHp);
    else hud.setPowerStatus(power, powerPermanent ? Infinity : player.auxHp, POWER.auxHp, player.jetpackEnabled ? player.fuel / JET.fuelMax : -1);
    hud.setNecro(power === 'necro', necroCharge, summonProgress, allies.count);

    if (!player.alive) gameOver();
  }

  if (state !== 'playing') rope.visible = false;
  effects.update(dt);
  world.update(worldTime, dt);
  hud.update(dt);
  renderer.render(scene, camera);
}

hud.setHealth(PLAYER.maxHealth, PLAYER.maxHealth);
hud.setWeapon(WEAPONS[0]);
accountUI.init(); // account forms + leaderboard

// Dev-only inspection hook (inert without ?dev in the URL). Used for automated testing.
if (new URLSearchParams(location.search).has('dev')) {
  window.__t = {
    THREE, player, enemies, world, portals, hazards, pickups, powerups, effects, camera, scene, input, raycastWorld, GRAPPLE, katana,
    beginPlay, fireStrap, fireDraco, firePump, firePortal, setWeapon, engagePower, disengagePower, fireGatling, fireMissile, gatling, guns,
    civic, spawnAndDrive, enterCivic, exitCivic, explodeCivic, allies,
    get state() { return state; }, set state(v) { state = v; },
    get driving() { return driving; },
    get necroCharge() { return necroCharge; }, set necroCharge(v) { necroCharge = v; },
    get weapon() { return weapon; },
    get power() { return power; },
    get powerPermanent() { return powerPermanent; },
    get missiles() { return missiles; },
    get wasted() { return wasted; },
    get lockTarget() { return lockTarget; },
    get lockProgress() { return lockProgress; },
    get hardcore() { return hardcore; }, set hardcore(v) { hardcore = v; player.hardcore = v; },
  };
}

loop();
