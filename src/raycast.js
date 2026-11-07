import * as THREE from '../vendor/three.module.js';

// Ray vs axis-aligned box. Returns entry {t, point, normal} or null (origin assumed outside).
export function rayAabb(o, d, min, max, range) {
  let tmin = -Infinity, tmax = Infinity, axis = 0;
  const lo = [min.x, min.y, min.z], hi = [max.x, max.y, max.z];
  const od = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-9) { if (od[a] < lo[a] || od[a] > hi[a]) return null; continue; }
    const inv = 1 / dd[a];
    let t1 = (lo[a] - od[a]) * inv, t2 = (hi[a] - od[a]) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) { tmin = t1; axis = a; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || tmin > range) return null;
  const point = new THREE.Vector3(o.x + d.x * tmin, o.y + d.y * tmin, o.z + d.z * tmin);
  const normal = new THREE.Vector3();
  normal.setComponent(axis, dd[axis] > 0 ? -1 : 1);
  return { t: tmin, point, normal };
}

// Nearest solid (colliders + floor) hit for a ray; returns {t, point, normal} or null.
// opts.skipBoundary ignores the arena perimeter walls (grapple can't latch the map edge).
export function raycastWorld(ray, world, range, opts = {}) {
  let best = null;
  for (const c of world.colliders) {
    if (opts.skipBoundary && c.boundary) continue;
    const h = rayAabb(ray.origin, ray.dir, c.min, c.max, range);
    if (h && (!best || h.t < best.t)) best = h;
  }
  if (!opts.skipBoundary && ray.dir.y < -1e-6) {
    const t = -ray.origin.y / ray.dir.y;
    if (t > 0 && t < range) {
      const px = ray.origin.x + ray.dir.x * t, pz = ray.origin.z + ray.dir.z * t;
      if (Math.abs(px) <= world.half && Math.abs(pz) <= world.half && (!best || t < best.t)) {
        best = { t, point: new THREE.Vector3(px, 0, pz), normal: new THREE.Vector3(0, 1, 0) };
      }
    }
  }
  return best;
}
