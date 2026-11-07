import * as THREE from '../vendor/three.module.js';
import { PALETTE, WEAPON, WEAPONS, PORTAL, GRAPPLE, DRACO, GATLING, MISSILE, POWER, JET, PLAYER } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Enemies } from './enemies.js';
import { Effects, glowSprite } from './effects.js';
import { Portals } from './portals.js';
import { Hazards } from './hazards.js';
import { Pickups } from './pickups.js';
import { Powerups } from './powerups.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { raycastWorld } from './raycast.js';
import { initAudio, sfx, toggleMute } from './audio.js';

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
enemies.bind(world);
hazards.bind(world);
pickups.bind(world);
powerups.bind(world);
player.portals = portals;
const input = new Input(renderer.domElement);
const hud = new HUD();

enemies.onWaveStart = (n) => { world.regenerate(player.pos); portals.reset(); player.releaseGrapple(); hud.showBanner('WAVE ' + n); };
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
const KATANA_REACH = 8.5;
const KATANA_CD = 0.3;
let power = null;                // null | 'somali' | 'nightyute'
let powerPermanent = false;      // invoked from /console → infinite + indefinite
let powerSnapshot = 100;         // health to restore on revert
let swingCd = 0;
let kTaps = 0, kTapTimer = 0;    // 6 K-taps to tap out of a /console-invoked mode
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
function fireStrap() {
  const ray = player.getRay();
  const mz = muzzlePoint(ray).clone();
  const res = enemies.hitscan(ray, {
    damage: WEAPON.damage, range: WEAPON.range,
    falloff: { start: WEAPON.falloffStart, end: WEAPON.falloffEnd, min: WEAPON.falloffMin },
  });
  effects.tracer(mz, res.end, PALETTE.primary);
  effects.muzzle(mz, PALETTE.white);
  sfx.shoot();
}
function fireDraco() {
  const ray = player.getRay();
  const mz = muzzlePoint(ray).clone();
  // Sniper: no falloff, and the round punches through everything in line.
  const res = enemies.hitscan(ray, { damage: DRACO.damage, range: DRACO.range, pierce: true });
  effects.beam(mz, res.end, 0xfff2b0, { radius: 0.11, life: 0.32 });
  effects.tracer(mz, res.end, PALETTE.white);
  effects.muzzle(mz, PALETTE.white);
  effects.muzzle(res.end, 0xfff2b0);
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
  if (power) return;
  power = kind; powerPermanent = permanent; powerSnapshot = player.health;
  player.invuln = permanent;                 // console = infinite; package = aux shield
  player.auxHp = permanent ? 0 : aux;
  player.scopeFov = null;
  if (kind === 'somali') {
    player.speedMul = POWER.somaliSpeed; player.flySpeedMul = POWER.somaliSpeed; player.jetpackEnabled = false;
  } else {
    player.speedMul = POWER.nightGroundSpeed; player.flySpeedMul = POWER.nightFlySpeed;
    player.jetpackEnabled = true; player.fuel = JET.fuelMax;
  }
  katana.visible = (kind === 'somali');
  gatling.visible = (kind === 'nightyute');
  hud.setPowerMode(kind);
  hud.showBanner(kind === 'somali' ? 'SOMALI MODE ACTIVATED' : 'XM01-NIGHT YUTE', 2.4);
  sfx.wave();
}
function disengagePower() {
  if (!power) return;
  power = null; powerPermanent = false;
  player.invuln = false; player.auxHp = 0;
  player.speedMul = 1; player.flySpeedMul = 1; player.jetpackEnabled = false; player.flying = false;
  katana.visible = false; gatling.visible = false; katanaState.swinging = false;
  clearDrizzy();
  player.health = Math.min(PLAYER.maxHealth, powerSnapshot); // save as before
  wasted.length = 0; kTaps = 0;
  hud.setPowerMode(null);
  hud.setWeapon(WEAPONS[weapon]);
}
function resetPower() {
  power = null; powerPermanent = false; swingCd = 0; kTaps = 0; wasted.length = 0;
  player.invuln = false; player.auxHp = 0; player.speedMul = 1; player.flySpeedMul = 1;
  player.jetpackEnabled = false; player.flying = false;
  katana.visible = false; gatling.visible = false; katanaState.swinging = false;
  clearDrizzy();
  hud.setPowerMode(null);
}

function animateKatana(dt) {
  if (!katanaState.swinging) {
    // Gentle idle sway so it feels alive.
    katanaState.idleT += dt;
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
  else nightyuteWeapons(dt);
  for (let i = wasted.length - 1; i >= 0; i--) { wasted[i].t += dt; if (wasted[i].t > 0.6) wasted.splice(i, 1); }
}

// Somali Samurai: Sauga Sabre only (no zipline, no HUD).
function somaliWeapons(dt) {
  swingCd -= dt;
  if (input.firing && swingCd <= 0) {
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
  setWeapon(0);
  hud.setHealth(player.health, PLAYER.maxHealth);
  hud.hideBoss();
  hud.showPrompt(null);
  hud.showStart(false);
  hud.showGameOver(false);
  hud.showBanner('GET READY', 2.0);
  state = 'playing';
}

function gameOver() {
  state = 'dead';
  hud.hideBoss();
  input.exitLock();
  sfx.over();
  hud.showGameOver(true, enemies.score, enemies.wave);
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
    if (power && powerPermanent && kTaps >= 6) { kTaps = 0; disengagePower(); }
    return;
  }

  // "6" activates the power-up package you're standing near.
  if (e.code === 'Digit6' && !power) {
    const mode = powerups.nearMode(player);
    if (mode) { powerups.consume(); engagePower(mode, { permanent: false, aux: POWER.auxHp }); }
    return;
  }

  if (power) return; // weapon switching disabled during power modes
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
  return null;
}
const consoleInput = document.getElementById('console-input');
consoleInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.code === 'Enter') {
    const mode = parseMode(consoleInput.value);
    consoleInput.value = ''; closeConsole();
    if (mode) engagePower(mode, { permanent: true });
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

    if (power) {
      powerUpdate(dt);
      hud.showPrompt(null);
    } else {
      const w = input.consumeWheel();
      switchCd -= dt;
      if (w && switchCd <= 0) { setWeapon(weapon + w); switchCd = 0.3; }
      const fireEdge = input.firing && !firePrev; // rising edge (for semi-auto)
      firePrev = input.firing;
      const wk = WEAPONS[weapon];
      if (wk !== 'draco' && player.scopeFov) { player.scopeFov = null; hud.setScoped(false); }

      if (wk === 'strap') {
        if (input.firing && weaponCd <= 0) { weaponCd = WEAPON.cooldown; fireStrap(); }
        tryGrapple(); // right-click zipline (no manual disengage)
      } else if (wk === 'slider') { // portal gun: left = orange, right = blue
        if (weaponCd <= 0) {
          if (input.firing) { weaponCd = PORTAL.cooldown; firePortal('A'); }
          else if (input.firing2) { weaponCd = PORTAL.cooldown; firePortal('B'); }
        }
      } else { // draco (sniper): semi-auto, scope on right-mouse
        const scoped = input.firing2;
        player.scopeFov = scoped ? DRACO.scopeFov : null;
        hud.setScoped(scoped);
        if (fireEdge && weaponCd <= 0) { weaponCd = DRACO.cooldown; fireDraco(); }
      }
    }

    const ev = player.update(dt, input, world);
    if (player._enteringPortal) portals.teleport(player, player._enteringPortal);
    updateRope();
    if (ev.jumped) sfx.jump();
    if (ev.launched) sfx.launch();

    enemies.update(dt, player, worldTime, hazards.activeZones());
    portals.update(dt);
    hazards.update(dt, player, enemies.wave, enemies.state === 'active', portals, enemies);
    pickups.update(dt, player, true);
    powerups.update(dt, player, !power); // only offer a package when not already powered up
    hud.showPrompt(power ? null : powerups.nearMode(player));

    // Aux-HP package modes revert (restoring health) once the shield is spent.
    if (power && !powerPermanent && player.auxHp <= 0) disengagePower();

    if (power === 'nightyute') updateJetHud();
    if (enemies.bossAlive) {
      const bss = enemies.boss;
      hud.setBoss(bss.name, (bss.hp + (bss.shield || 0)) / (bss.maxHp + (bss.shieldMax || 0)));
    } else hud.hideBoss();

    hud.setHealth(player.health, PLAYER.maxHealth);
    hud.setStats(enemies.wave, enemies.score, enemies.remaining);
    hud.setPortalStatus(!power && WEAPONS[weapon] === 'slider', portals.a.active, portals.b.active);
    hud.setPowerStatus(power, powerPermanent ? Infinity : player.auxHp, POWER.auxHp, player.jetpackEnabled ? player.fuel / JET.fuelMax : -1);

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

// Dev-only inspection hook (inert without ?dev in the URL). Used for automated testing.
if (new URLSearchParams(location.search).has('dev')) {
  window.__t = {
    THREE, player, enemies, world, portals, hazards, pickups, powerups, effects, camera, scene, input, raycastWorld, GRAPPLE, katana,
    beginPlay, fireStrap, fireDraco, firePortal, setWeapon, engagePower, disengagePower, fireGatling, fireMissile, gatling,
    get state() { return state; }, set state(v) { state = v; },
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
