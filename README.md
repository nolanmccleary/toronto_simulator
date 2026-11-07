# Toronto Simulator

A first-person PvE survival shooter for the browser. Minimal, geometric, neon-on-dusk —
the only Toronto thing in it is the CN Tower silhouette on the horizon. Fluid, aggressive
movement; portals; a brutal zipline; climbable everything; and waves of geometric enemies.

## Run

No build step, no dependencies — just a tiny static server (Node ≥ 18):

```bash
npm start
# → http://localhost:5173
```

Any static host works too (plain HTML + ES modules + a vendored Three.js).

## Controls

- **WASD** move · **Mouse** look · **Space** jump (variable height; coyote-time + buffered)
- **Scroll** / **1** **2** — switch weapon
- **STRAP** (gun): **L-Click** shoot · **R-Click** fire the **zipline** — latches a structure and
  brutally yanks you to it (gravity cut, no manual disengage, you ride it in)
- **SLIDER** (portal gun): **L-Click** orange portal · **R-Click** blue portal — dash through one,
  come out the other with your momentum and view transformed (Portal-style)
- Hold **W** into any structure to **climb** it · step on an **amber pad** to launch
- Avoid the **red spikes**
- **Esc** pause · **M** mute

## Systems

- **Movement feel** — snappy ground accel, air control that preserves fling momentum, coyote
  time, jump buffering, variable jump height, dynamic FOV with speed, camera lean, landing dip,
  view bob. Portal flings and zipline yanks are the fun.
- **Enemies** (5 types, each a distinct animated model): *grunt* (diamond), *runner* (dart),
  *brute* (spiked mine), *shooter* (orbiting rings, fires projectiles), *blinker* (teleports).
  They **climb** structures to reach you on high ground, and they **avoid** active spike patches.
- **Weapons** — STRAP (hitscan, wall-occluded) + zipline; SLIDER (momentum-preserving portals).
- **Hazards** — telegraphed floor spikes erupt and must be dodged. **Route them through a portal
  pair**: place a portal inside an active spike patch and the spikes erupt out the linked portal,
  one-shotting enemies there.
- **Arena** — a new, more interesting layout every round (platforms, towers, ziggurats, bridges,
  arches, pillar fields, cover, launch pads). On each wave the old layout **sinks into the ground**
  and the new one **rises out of it** — no flash.
- **Difficulty** — starts at round-4 intensity and climbs from there.
- **TORONTOMANS MODE** — toggle on the menu; one hit and you're done.

## Structure

```
index.html / styles.css   markup, HUD, menu
server.mjs                zero-dependency static server
vendor/three.module.js    Three.js r169 (vendored, no runtime CDN)
src/
  config.js    all tunables + palette
  main.js      bootstrap, game loop, state machine, weapon/hazard/portal orchestration
  world.js     arena, procedural layouts, rise/sink animation, CN Tower, dusk sky, terrain climb
  player.js    first-person controller: movement feel, collision, climb, launch, portals, zipline
  enemies.js   typed enemy models + AI (melee/ranged/teleport), climbing, projectiles, hitscan
  portals.js   portal placement, raycast, momentum-preserving teleport
  hazards.js   telegraphed spikes, damage, portal-routed eruptions
  effects.js   additive-glow halos, tracers, muzzle flashes, bursts
  raycast.js   ray-vs-AABB + world raycast (shared)
  input.js     keyboard + pointer-lock mouse + wheel
  hud.js       DOM HUD
  audio.js     procedural WebAudio sfx (no asset files)
```

Everything is unlit `MeshBasicMaterial` + neon edge lines + additive glow sprites on a gradient
skydome — no post-processing, no lights. All sound is synthesized.

> Dev note: append `?dev` to the URL to expose `window.__t` for inspection/automated testing. Inert otherwise.
