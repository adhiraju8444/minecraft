// Small A* over walkable cells for mob navigation.
import { BLOCKS, B, isSolid, isLiquid } from '../data/blocks.js';

function passable(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (id === 255) return false;
  if (id === B.lava || id === B.fire || id === B.cactus) return false;
  if (!isSolid[id]) return true;
  const b = BLOCKS[id];
  // Open doors and gates can be walked through.
  if (b.shape === 'door') return (world.getMeta(x, y, z) & 4) !== 0;
  if (b.shape === 'gate') return (world.getMeta(x, y, z) & 4) !== 0;
  return false;
}

function standable(world, x, y, z) {
  const below = world.getBlock(x, y - 1, z);
  if (below === 255) return false;
  if (isLiquid[world.getBlock(x, y, z)] === 1 && world.getBlock(x, y, z) === B.water) return true;
  if (!isSolid[below]) return false;
  const b = BLOCKS[below];
  if (b.shape === 'fence' || b.shape === 'gate' || b.shape === 'cactus') return false;
  return true;
}

function clear(world, x, y, z, h) {
  for (let i = 0; i < h; i++) if (!passable(world, x, y + i, z)) return false;
  return true;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function findPath(world, sx, sy, sz, tx, ty, tz, opts = {}) {
  const maxNodes = opts.maxNodes || 300;
  const height = opts.height || 2;
  const maxDrop = opts.maxDrop ?? 3;
  const reach = opts.reach ?? 1.5;
  const key = (x, y, z) => `${x},${y},${z}`;
  const h = (x, y, z) => Math.abs(x - tx) + Math.abs(y - ty) * 1.5 + Math.abs(z - tz);
  const start = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), parent: null };
  const open = [start];
  const seen = new Map([[key(sx, sy, sz), start]]);
  const closed = new Set();
  let best = start;
  let expanded = 0;
  while (open.length && expanded < maxNodes) {
    // pop lowest f
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const ck = key(cur.x, cur.y, cur.z);
    if (closed.has(ck)) continue;
    closed.add(ck);
    expanded++;
    if (h(cur.x, cur.y, cur.z) < h(best.x, best.y, best.z)) best = cur;
    if (Math.abs(cur.x - tx) + Math.abs(cur.z - tz) <= reach && Math.abs(cur.y - ty) <= 1) {
      best = cur;
      break;
    }
    for (const [dx, dz] of DIRS) {
      const nx = cur.x + dx, nz = cur.z + dz;
      let ny = null;
      if (clear(world, nx, cur.y, nz, height)) {
        // walk or drop
        let y = cur.y;
        let d = 0;
        while (d <= maxDrop && !standable(world, nx, y, nz)) {
          y--;
          d++;
          if (!passable(world, nx, y, nz)) { y = null; break; }
        }
        if (y !== null && d <= maxDrop && standable(world, nx, y, nz)) ny = y;
      } else if (clear(world, nx, cur.y + 1, nz, height) && clear(world, cur.x, cur.y + height, cur.z, 1) && standable(world, nx, cur.y + 1, nz)) {
        ny = cur.y + 1; // jump up one block
      }
      if (ny === null) continue;
      const k = key(nx, ny, nz);
      if (closed.has(k)) continue;
      let cost = 1 + (ny < cur.y ? 0.5 : ny > cur.y ? 0.6 : 0);
      if (world.getBlock(nx, ny, nz) === B.water) cost += 2;
      const g = cur.g + cost;
      const ex = seen.get(k);
      if (ex && ex.g <= g) continue;
      const node = { x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), parent: cur };
      seen.set(k, node);
      open.push(node);
    }
  }
  const path = [];
  for (let n = best; n; n = n.parent) path.push([n.x, n.y, n.z]);
  path.reverse();
  return path.length > 1 ? path.slice(1) : [];
}

export function groundBelow(world, x, y, z, range = 6) {
  for (let yy = y + 2; yy >= y - range; yy--) {
    if (standable(world, x, yy, z) && clear(world, x, yy, z, 2)) return yy;
  }
  return null;
}
