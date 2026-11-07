// Toronto Simulator — central tunables & palette.
// Kept in one place so the whole game reads from a single, minimal source of truth.

export const PALETTE = {
  // Dusk sky gradient (top -> horizon). Interesting but restrained: indigo into a warm sunset band.
  skyTop:     '#140f28',
  skyMid:     '#3a2a5e',
  skyGlow:    '#ff8b63',
  skyHorizon: '#ffd9a0',

  fog:        0x241a3d, // mid-dusk purple so the arena dissolves into the horizon

  // Foreground is three accents + white. That's the whole language.
  primary: 0x53f0d0, // teal — player, world lines, friendly geometry
  hazard:  0xff5d73, // coral — enemies
  accent:  0xffd166, // amber — launch pads / pickups
  white:   0xffffff,

  silhouette: 0x0d0b16, // CN Tower + horizon forms (near-black, faintly blue)

  portalA: 0xff8c42, // orange portal
  portalB: 0x4aa8ff, // blue portal
  danger:  0xff3b1f, // spike hazards (lava-red, "avoid")
  flame:   0x37c4ff, // flame hazards (electric blue)
};

// CSS-string mirror for the DOM HUD.
export const CSS = {
  primary: '#53f0d0',
  hazard:  '#ff5d73',
  accent:  '#ffd166',
  dim:     'rgba(230,235,255,0.55)',
};

export const PLAYER = {
  radius: 0.4,
  height: 1.7,
  eyeHeight: 1.6,
  walkSpeed: 8.6,
  runBoost: 1.0,         // reserved
  airControl: 0.5,
  accel: 95,             // ground acceleration (snappy)
  airAccel: 42,          // air acceleration
  gravity: 26,
  jumpSpeed: 9.8,
  jumpCut: 0.45,         // vel.y multiplier when jump released early (variable height)
  coyoteTime: 0.11,      // grace to jump after leaving ground
  jumpBuffer: 0.12,      // grace to buffer a jump before landing
  climbSpeed: 5.5,
  maxHealth: 100,
  lookSensitivity: 0.0022,

  // Game-feel camera
  fovBase: 80,
  fovSpeedKick: 16,      // max extra FOV from speed
  fovLerp: 7,
  maxRoll: 0.055,        // camera lean on strafe (rad)
  rollLerp: 9,
  bobAmp: 0.05,
  bobFreq: 10.5,
  landingDip: 0.03,      // per unit of impact speed
  dipRecover: 11,
};

// Selectable weapons, cycled with the scroll wheel or number keys.
// 'strap' = fast hitscan + zipline, 'slider' = portal gun, 'draco' = scoped semi-auto sniper.
export const WEAPONS = ['strap', 'slider', 'draco'];

export const WEAPON = {
  range: 200,
  damage: 26,
  cooldown: 0.16,     // seconds between shots
  // Damage falls off with distance.
  falloffStart: 18,   // full damage within this range
  falloffEnd: 62,     // minimum damage beyond this
  falloffMin: 0.34,   // damage multiplier at/after falloffEnd
};

export const DRACO = {
  range: 260,
  damage: 100,        // big hit
  cooldown: 0.85,     // slow; also semi-auto (must release between shots)
  scopeFov: 30,       // zoom when right-mouse is held
};

export const PORTAL = {
  radius: 1.4,
  cooldown: 0.22,       // between placements
  range: 140,
  exitOffset: 0.9,      // push player this far out of the exit portal
  teleportLockout: 0.28,// no re-teleport for this long after passing through
};

// Zipline/grapple — STRAP right-click. Latches a structure and brutally yanks you in.
// No manual disengage: once locked you ride it to the anchor. Gravity is cut while reeling.
export const GRAPPLE = {
  range: 95,
  pull: 110,      // hard yank acceleration
  maxSpeed: 46,   // cap while reeling
  minSpeed: 22,   // always moving at least this fast toward the anchor
  arrive: 3.0,    // detach when this close (keeps momentum → fling)
  cooldown: 0.25,
  maxTime: 2.5,   // safety release if something blocks the path
};

export const ARENA = {
  half: 52,       // arena extends [-half, half] on x/z
  wallHeight: 10,
};

export const WAVES = {
  baseCount: 4,
  perWave: 1,              // gentler ramp in enemy count
  spawnInterval: 0.6,      // seconds between spawns within a wave
  intermission: 2.5,       // seconds between waves
  firstIntermission: 1.4,  // quicker start to the first round
  difficultyOffset: 2,     // round 1 plays like the old wave 3
};

// Shared enemy tuning + gentle per-wave scaling applied on top of each type.
export const ENEMY = {
  contactInterval: 0.7,            // how often a touching enemy can hurt you
  hpScalePerWave: 0.09,            // +9% HP per wave
  speedScalePerWave: 0.03,         // +3% speed per wave
  speedScaleCap: 1.6,
};

// Enemy roster. `behavior` drives the AI; everything else is cosmetic/stats.
//   melee    — chase and bump
//   ranged   — keep distance, fire projectiles
//   teleport — chase, but blink around to stay unpredictable
export const ENEMY_TYPES = {
  grunt:   { color: 0xff5d73, shape: 'octahedron',  radius: 0.75, hp: 60,  speed: 2.6, damage: 9,  behavior: 'melee' },
  runner:  { color: 0xff3d9a, shape: 'tetrahedron', radius: 0.55, hp: 32,  speed: 5.8, damage: 7,  behavior: 'melee', climber: false },
  brute:   { color: 0xff8c42, shape: 'box',         radius: 1.15, hp: 165, speed: 1.7, damage: 22, behavior: 'melee' },
  shooter: { color: 0xb47dff, shape: 'icosahedron', radius: 0.8,  hp: 70,  speed: 2.2, damage: 0,  behavior: 'ranged',
             standoff: 17, shootInterval: 2.1, projSpeed: 15, projDamage: 12 },
  blinker: { color: 0x6cb0ff, shape: 'octahedron',  radius: 0.68, hp: 50,  speed: 3.1, damage: 11, behavior: 'teleport',
             blinkInterval: 2.6, blinkRange: 11 },
  // --- the wider ecosystem ---
  swarm:   { color: 0xbdff5a, shape: 'tetrahedron', radius: 0.42, hp: 15,  speed: 6.7, damage: 5,  behavior: 'swarm', climber: false }, // weak, fast, in packs
  bomber:  { color: 0xff6a1f, shape: 'octahedron',  radius: 0.72, hp: 42,  speed: 5.4, damage: 0,  behavior: 'bomber' },     // rushes + detonates
  warden:  { color: 0x6affd8, shape: 'icosahedron', radius: 0.95, hp: 140, speed: 1.6, damage: 10, behavior: 'warden' },     // shields nearby allies
  mortar:  { color: 0xb45cff, shape: 'cone',        radius: 0.85, hp: 72,  speed: 1.9, damage: 0,  behavior: 'mortar', standoff: 30 }, // lobs AoE strikes
  pulsar:  { color: 0xff4db0, shape: 'octahedron',  radius: 0.78, hp: 88,  speed: 2.6, damage: 8,  behavior: 'pulsar' },     // shockwave AoE
};

// Ecosystem tuning.
export const SWARM_PACK = 4;                                               // swarmlings per spawn
export const BOMB = { trigger: 3.6, fuseTime: 0.45, radius: 5.5, damage: 36 };
export const WARDEN = { radius: 9, factor: 0.6 };                          // 60% damage reduction to allies in range
export const MORTAR = { interval: 3.2, warnTime: 1.1, radius: 4.6, damage: 26, range: 60 };
export const PULSAR = { interval: 2.8, radius: 6, damage: 22 };

// Health orbs: spawn/despawn around the arena; walk over one to heal.
export const PICKUP = { heal: 25, radius: 1.9, interval: 7, intervalVar: 5, maxActive: 3, life: 15, color: 0x5effb0 };

// Power modes: Somali Samurai (sabre) and XM01-Night Yute (Gat + missiles + jetpack).
// Both grant 30 auxiliary HP when picked up as a package; invoked from the /console they're infinite.
export const POWER = {
  auxHp: 30,
  somaliSpeed: 2.0,         // ground run multiplier
  nightGroundSpeed: 1.0,    // Night Yute runs at normal speed on the ground...
  nightFlySpeed: 2.2,       // ...and is fast while flying the jetpack
};
export const JET = { fuelMax: 2.4, thrust: 34, maxRise: 10, drain: 1.0, refill: 0.75 };

// Night Yute arsenal: left = Gat, right = lock-on guided missiles.
export const GATLING = { cooldown: 0.055, damage: 15, range: 220, spread: 0.012, color: 0xffe08a };
export const MISSILE = {
  lockTime: 1.05,   // slower to lock (and thus slower cadence)
  speed: 34,
  turn: 4.5,        // limited turn radius → it arcs, can't snap
  loft: 4.5,        // aims this far above the target when far, so it flies over cover
  damage: 95,       // hits hard
  splashR: 6.5,
  life: 5,
  hitR: 1.8,
  lockCone: 0.22,   // ~13° aim cone; locks around barriers (no line-of-sight needed)
  color: 0xffd166,
};

export const PROJECTILE = {
  radius: 0.28,
  life: 4.0,
};

// Telegraphed hazards: a warning builds, then spikes erupt from the floor or blue
// flames jet from a wall. Both are avoidable and can be routed through a portal pair.
export const HAZARD = {
  radius: 3.3,
  warnTime: 1.1,         // telegraph window
  activeBase: 4.6,       // starting "lethal" duration
  activePerWave: 0.18,   // shrinks each round → the portal window tightens
  activeMin: 1.2,
  fadeTime: 0.4,
  interval: 2.6,         // base seconds between spawns (near-constant presence)
  intervalMin: 1.2,
  intervalPerWave: 0.12,
  damage: 20,
  tickInterval: 0.45,
  safeHeight: 3.0,       // standing above this (on a platform) is safe from spikes

  // Spawn close to the player so camping doesn't work.
  nearMin: 5,
  nearMax: 13,

  // Flame (wall) hazards.
  flameChance: 0.5,      // fraction of spawns that are flames
  flameRadius: 3.1,
  flameReach: 4.8,       // how far flames jet out of the wall
};
