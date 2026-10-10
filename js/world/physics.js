import { blockBoxes } from './shapes.js';
import { isLiquid, isSolid, BLOCKS, B } from '../data/blocks.js';
import { HEIGHT } from './constants.js';

export class AABB {
  constructor(x0, y0, z0, x1, y1, z1) {
    this.x0 = x0; this.y0 = y0; this.z0 = z0;
    this.x1 = x1; this.y1 = y1; this.z1 = z1;
  }
  static of(x, y, z, w, h) {
    return new AABB(x - w / 2, y, z - w / 2, x + w / 2, y + h, z + w / 2);
  }
  set(x, y, z, w, h) {
    this.x0 = x - w / 2; this.y0 = y; this.z0 = z - w / 2;
    this.x1 = x + w / 2; this.y1 = y + h; this.z1 = z + w / 2;
    return this;
  }
  clone() {
    return new AABB(this.x0, this.y0, this.z0, this.x1, this.y1, this.z1);
  }
  offset(dx, dy, dz) {
    this.x0 += dx; this.x1 += dx;
    this.y0 += dy; this.y1 += dy;
    this.z0 += dz; this.z1 += dz;
    return this;
  }
  expand(dx, dy, dz) {
    const r = this.clone();
    if (dx < 0) r.x0 += dx; else r.x1 += dx;
    if (dy < 0) r.y0 += dy; else r.y1 += dy;
    if (dz < 0) r.z0 += dz; else r.z1 += dz;
    return r;
  }
  grow(dx, dy, dz) {
    return new AABB(this.x0 - dx, this.y0 - dy, this.z0 - dz, this.x1 + dx, this.y1 + dy, this.z1 + dz);
  }
  intersects(o) {
    return this.x1 > o.x0 && this.x0 < o.x1 && this.y1 > o.y0 && this.y0 < o.y1 && this.z1 > o.z0 && this.z0 < o.z1;
  }
  clipX(o, dx) {
    if (o.y1 <= this.y0 || o.y0 >= this.y1 || o.z1 <= this.z0 || o.z0 >= this.z1) return dx;
    if (dx > 0 && o.x1 <= this.x0) { const d = this.x0 - o.x1; if (d < dx) dx = d; }
    else if (dx < 0 && o.x0 >= this.x1) { const d = this.x1 - o.x0; if (d > dx) dx = d; }
    return dx;
  }
  clipY(o, dy) {
    if (o.x1 <= this.x0 || o.x0 >= this.x1 || o.z1 <= this.z0 || o.z0 >= this.z1) return dy;
    if (dy > 0 && o.y1 <= this.y0) { const d = this.y0 - o.y1; if (d < dy) dy = d; }
    else if (dy < 0 && o.y0 >= this.y1) { const d = this.y1 - o.y0; if (d > dy) dy = d; }
    return dy;
  }
  clipZ(o, dz) {
    if (o.x1 <= this.x0 || o.x0 >= this.x1 || o.y1 <= this.y0 || o.y0 >= this.y1) return dz;
    if (dz > 0 && o.z1 <= this.z0) { const d = this.z0 - o.z1; if (d < dz) dz = d; }
    else if (dz < 0 && o.z0 >= this.z1) { const d = this.z1 - o.z0; if (d > dz) dz = d; }
    return dz;
  }
}

// All block collision boxes touching an AABB (world space).
export function collisionBoxes(world, box) {
  const out = [];
  const x0 = Math.floor(box.x0), x1 = Math.floor(box.x1 + 1e-7);
  const y0 = Math.floor(box.y0) - 1, y1 = Math.floor(box.y1 + 1e-7);
  const z0 = Math.floor(box.z0), z1 = Math.floor(box.z1 + 1e-7);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        if (y >= HEIGHT) continue;
        const id = y < 0 ? B.bedrock : world.getBlock(x, y, z);
        if (!isSolid[id]) continue;
        const meta = id === 255 ? 0 : world.getMeta(x, y, z);
        const boxes = id === 255 ? [[0, 0, 0, 1, 1, 1]] : blockBoxes(world, x, y, z, id, meta, 'collide');
        for (const b of boxes) {
          const a = new AABB(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
          if (a.intersects(box)) out.push(a);
        }
      }
    }
  }
  return out;
}

// Moves an entity-like object { box, onGround, collidedH, collidedV, stepHeight }
// by (dx, dy, dz) with block collision, including step-up. Returns the actual motion.
export function moveBox(world, e, dx, dy, dz) {
  const ox = dx, oy = dy, oz = dz;
  const box = e.box;
  let boxes = collisionBoxes(world, box.expand(dx, dy, dz));
  for (const b of boxes) dy = b.clipY(box, dy);
  box.offset(0, dy, 0);
  for (const b of boxes) dx = b.clipX(box, dx);
  box.offset(dx, 0, 0);
  for (const b of boxes) dz = b.clipZ(box, dz);
  box.offset(0, 0, dz);

  const wasOnGround = e.onGround || (oy !== dy && oy < 0);
  const step = e.stepHeight || 0;
  if (step > 0 && wasOnGround && (dx !== ox || dz !== oz)) {
    // Try stepping up onto a ledge.
    const saveBox = box.clone();
    const sdx = dx, sdy = dy, sdz = dz;
    box.x0 = saveBox.x0 - dx; box.x1 = saveBox.x1 - dx;
    box.y0 = saveBox.y0 - dy; box.y1 = saveBox.y1 - dy;
    box.z0 = saveBox.z0 - dz; box.z1 = saveBox.z1 - dz;
    let ux = ox, uy = step, uz = oz;
    boxes = collisionBoxes(world, box.expand(ox, step, oz));
    for (const b of boxes) uy = b.clipY(box, uy);
    box.offset(0, uy, 0);
    for (const b of boxes) ux = b.clipX(box, ux);
    box.offset(ux, 0, 0);
    for (const b of boxes) uz = b.clipZ(box, uz);
    box.offset(0, 0, uz);
    let down = -uy;
    for (const b of boxes) down = b.clipY(box, down);
    box.offset(0, down, 0);
    if (sdx * sdx + sdz * sdz >= ux * ux + uz * uz) {
      box.x0 = saveBox.x0; box.x1 = saveBox.x1;
      box.y0 = saveBox.y0; box.y1 = saveBox.y1;
      box.z0 = saveBox.z0; box.z1 = saveBox.z1;
      dx = sdx; dy = sdy; dz = sdz;
    } else {
      dx = ux; dz = uz; dy = uy + down;
    }
  }

  e.collidedH = dx !== ox || dz !== oz;
  e.collidedX = dx !== ox;
  e.collidedZ = dz !== oz;
  e.collidedV = dy !== oy;
  e.onGround = oy !== dy && oy < 0;
  return [dx, dy, dz];
}

export function boxCollides(world, box) {
  return collisionBoxes(world, box).length > 0;
}

// Liquid level of a block as a fraction of a full block (0 when not liquid).
export function liquidHeight(meta) {
  if (meta & 8) return 1;
  return (8 - (meta & 7)) / 9;
}

// Does the box touch liquid of the given id (or any liquid when id omitted)?
export function inLiquid(world, box, id = 0) {
  const x0 = Math.floor(box.x0), x1 = Math.floor(box.x1);
  const y0 = Math.floor(box.y0), y1 = Math.floor(box.y1);
  const z0 = Math.floor(box.z0), z1 = Math.floor(box.z1);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    const b = world.getBlock(x, y, z);
    if (!isLiquid[b] || (id && b !== id)) continue;
    const top = y + liquidHeight(world.getMeta(x, y, z));
    if (box.y0 < top) return true;
  }
  return false;
}

// Ray-box test; returns { t, face } or null. face: 0 +x 1 -x 2 +y 3 -y 4 +z 5 -z
function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT, face = -1;
  const axes = [[ox, dx, b.x0, b.x1, 1, 0], [oy, dy, b.y0, b.y1, 3, 2], [oz, dz, b.z0, b.z1, 5, 4]];
  for (const [o, d, lo, hi, fLo, fHi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    let f1 = fLo, f2 = fHi;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; f1 = fHi; f2 = fLo; }
    if (t1 > tmin) { tmin = t1; face = f1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (face < 0) return null;
  return { t: tmin, face };
}

// Voxel ray cast. opts.liquids: stop at liquid sources/blocks.
export function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, opts = {}) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
  let tmx = dx > 0 ? (x + 1 - ox) * tdx : (ox - x) * tdx;
  let tmy = dy > 0 ? (y + 1 - oy) * tdy : (oy - y) * tdy;
  let tmz = dz > 0 ? (z + 1 - oz) * tdz : (oz - z) * tdz;
  if (!isFinite(tmx)) tmx = Infinity;
  if (!isFinite(tmy)) tmy = Infinity;
  if (!isFinite(tmz)) tmz = Infinity;
  for (let n = 0; n < 200; n++) {
    if (y >= 0 && y < HEIGHT) {
      const id = world.getBlock(x, y, z);
      if (id !== 0 && id !== 255) {
        const meta = world.getMeta(x, y, z);
        if (isLiquid[id]) {
          if (opts.liquids && (opts.anyLiquid || meta === 0)) {
            const r = rayBox(ox, oy, oz, dx, dy, dz, new AABB(x, y, z, x + 1, y + 1, z + 1), maxDist);
            if (r) return { x, y, z, id, meta, face: r.face, t: r.t, px: ox + dx * r.t, py: oy + dy * r.t, pz: oz + dz * r.t };
          }
        } else {
          const boxes = blockBoxes(world, x, y, z, id, meta, 'select');
          let best = null;
          for (const b of boxes) {
            const r = rayBox(ox, oy, oz, dx, dy, dz, new AABB(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]), maxDist);
            if (r && (!best || r.t < best.t)) best = r;
          }
          if (best) return { x, y, z, id, meta, face: best.face, t: best.t, px: ox + dx * best.t, py: oy + dy * best.t, pz: oz + dz * best.t };
        }
      }
    }
    if (tmx < tmy && tmx < tmz) {
      if (tmx > maxDist) break;
      x += stepX; tmx += tdx;
    } else if (tmy < tmz) {
      if (tmy > maxDist) break;
      y += stepY; tmy += tdy;
    } else {
      if (tmz > maxDist) break;
      z += stepZ; tmz += tdz;
    }
  }
  return null;
}

export function rayAABB(ox, oy, oz, dx, dy, dz, box, maxT) {
  return rayBox(ox, oy, oz, dx, dy, dz, box, maxT);
}

export function blockSlipperiness(world, x, y, z) {
  const b = BLOCKS[world.getBlock(x, y, z)];
  return b ? b.slip : 0.6;
}
