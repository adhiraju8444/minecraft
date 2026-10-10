// Per-block game rules: what holds a block up, what happens when neighbours
// change, and slow world changes driven by random ticks.
import { B, BLOCKS, isOpaque, isLiquid, isSolid, isReplaceable } from '../data/blocks.js';
import { fluidTick, tickRate, checkMixing } from './fluids.js';
import { placeTree } from './worldgen.js';
import { FACING_DX, FACING_DZ } from './constants.js';

export const RANDOM_TICK = new Uint8Array(256);
for (const name of ['grass_block', 'wheat', 'carrots', 'potatoes', 'oak_sapling', 'birch_sapling', 'spruce_sapling', 'sugar_cane', 'cactus',
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'farmland', 'ice', 'snow', 'lava', 'brown_mushroom', 'red_mushroom']) RANDOM_TICK[B[name]] = 1;

const SOIL = new Set([B.grass_block, B.dirt, B.farmland]);
const LOGS = new Set([B.oak_log, B.birch_log, B.spruce_log]);
const LEAVES = new Set([B.oak_leaves, B.birch_leaves, B.spruce_leaves]);

function solidTop(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (isOpaque[id]) return true;
  const b = BLOCKS[id];
  if (!b) return false;
  if (b.shape === 'slab') return world.getMeta(x, y, z) !== 0;
  if (b.shape === 'stairs') return (world.getMeta(x, y, z) & 4) !== 0;
  return b.shape === 'fence' || b.shape === 'farmland' || b.shape === 'chest' || (b.leaves === true);
}

function waterNear(world, x, y, z) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const id = world.getBlock(x + dx, y, z + dz);
    if (id === B.water || id === B.ice) return true;
  }
  return false;
}

// Can block `id` (with meta) stay at this position?
export function canStay(world, x, y, z, id, meta) {
  const b = BLOCKS[id];
  if (!b || !b.support) return true;
  const below = world.getBlock(x, y - 1, z);
  if (below === 255) return true; // unloaded: assume fine
  switch (b.support) {
    case 'soil':
      return SOIL.has(below);
    case 'sand':
      return below === B.sand || below === B.dirt || below === B.grass_block;
    case 'mushroom':
      return isOpaque[below] === 1;
    case 'farmland':
      return below === B.farmland;
    case 'sugar_cane':
      if (below === B.sugar_cane) return true;
      if (below !== B.grass_block && below !== B.dirt && below !== B.sand) return false;
      return waterNear(world, x, y - 1, z);
    case 'cactus': {
      if (below !== B.cactus && below !== B.sand) return false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = world.getBlock(x + dx, y, z + dz);
        if (n !== 255 && (isSolid[n] || isLiquid[n] === 1 && n === B.lava)) return false;
      }
      return true;
    }
    case 'torch': {
      if (meta === 0) return solidTop(world, x, y - 1, z);
      const f = (meta - 1) & 3; // the torch points this way; its wall is behind it
      const wid = world.getBlock(x - FACING_DX[f], y, z - FACING_DZ[f]);
      return wid === 255 || isOpaque[wid] === 1;
    }
    case 'wall': {
      const f = meta & 3;
      const wid = world.getBlock(x - FACING_DX[f], y, z - FACING_DZ[f]);
      return wid === 255 || isOpaque[wid] === 1;
    }
    case 'solid_below':
      return solidTop(world, x, y - 1, z) && below !== B.ice;
    case 'door':
      if (meta & 8) return below === B.oak_door;
      return solidTop(world, x, y - 1, z) && world.getBlock(x, y + 1, z) === B.oak_door;
    case 'bed': {
      const f = meta & 3;
      const head = (meta & 4) !== 0;
      const ox = head ? -FACING_DX[f] : FACING_DX[f];
      const oz = head ? -FACING_DZ[f] : FACING_DZ[f];
      const other = world.getBlock(x + ox, y, z + oz);
      return other === B.red_bed || other === 255;
    }
    case 'fire':
      return solidTop(world, x, y - 1, z) || flammableNeighbor(world, x, y, z);
    default:
      return true;
  }
}

// Remove a block and drop its items (support lost, washed away...).
export function popBlock(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (id === 0 || id === 255) return;
  const meta = world.getMeta(x, y, z);
  world.setBlock(x, y, z, 0, 0);
  world.game.dropBlockItems(x, y, z, id, meta);
}

export function neighborChanged(world, x, y, z, fx, fy, fz) {
  const id = world.getBlock(x, y, z);
  if (id === 0 || id === 255) return;
  const b = BLOCKS[id];
  if (isLiquid[id]) {
    if (id === B.lava && checkMixing(world, x, y, z)) return;
    world.scheduleTick(x, y, z, tickRate(id));
    return;
  }
  if (b.gravity) {
    world.scheduleTick(x, y, z, 2);
    return;
  }
  if (b.support && !canStay(world, x, y, z, id, world.getMeta(x, y, z))) {
    if (id === B.fire) world.setBlock(x, y, z, 0, 0);
    else popBlock(world, x, y, z);
    return;
  }
  if (id === B.farmland) {
    const above = world.getBlock(x, y + 1, z);
    if (isOpaque[above]) world.setBlock(x, y, z, B.dirt, 0);
    return;
  }
  if (LEAVES.has(id)) {
    const m = world.getMeta(x, y, z);
    if (!(m & 1) && !(m & 2)) world.setBlock(x, y, z, id, m | 2, 0);
  }
}

// Called after a block has been set (with NOTIFY).
export function onBlockChanged(world, x, y, z, old, id, meta) {
  if (isLiquid[id]) {
    if (id === B.lava && checkMixing(world, x, y, z)) return;
    world.scheduleTick(x, y, z, tickRate(id));
  } else if (BLOCKS[id] && BLOCKS[id].gravity) {
    world.scheduleTick(x, y, z, 2);
  } else if (id === B.fire) {
    world.scheduleTick(x, y, z, 30 + Math.floor(Math.random() * 10));
  }
  if (LOGS.has(old) && !LOGS.has(id)) markLeavesForDecay(world, x, y, z);
}

function markLeavesForDecay(world, x, y, z) {
  for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    const id = world.getBlock(x + dx, y + dy, z + dz);
    if (!LEAVES.has(id)) continue;
    const m = world.getMeta(x + dx, y + dy, z + dz);
    if (!(m & 1)) world.setBlock(x + dx, y + dy, z + dz, id, m | 2, 0);
  }
}

export function scheduledTick(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (isLiquid[id]) {
    fluidTick(world, x, y, z);
    return;
  }
  const b = BLOCKS[id];
  if (!b) return;
  if (b.gravity) {
    const below = world.getBlock(x, y - 1, z);
    if (below !== 255 && y > 0 && (below === 0 || isLiquid[below] || below === B.fire || (isReplaceable[below] && !isSolid[below]))) {
      const meta = world.getMeta(x, y, z);
      world.setBlock(x, y, z, 0, 0);
      world.game.spawnFallingBlock(x, y, z, id, meta);
    }
    return;
  }
  if (id === B.fire) fireTick(world, x, y, z);
}

// ---------------------------------------------------------------- fire
function flammability(id) {
  const b = BLOCKS[id];
  return b && b.flammable ? b.flammable : null;
}
function flammableNeighbor(world, x, y, z) {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    if (flammability(world.getBlock(x + dx, y + dy, z + dz))) return true;
  }
  return false;
}
function encouragement(world, x, y, z) {
  if (world.getBlock(x, y, z) !== 0) return 0;
  let e = 0;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const f = flammability(world.getBlock(x + dx, y + dy, z + dz));
    if (f && f[0] > e) e = f[0];
  }
  return e;
}
function tryBurn(world, x, y, z, chance, age) {
  const id = world.getBlock(x, y, z);
  const f = flammability(id);
  if (!f) return;
  if (Math.random() * chance < f[1]) {
    if (id === B.tnt) {
      world.setBlock(x, y, z, 0, 0);
      world.game.primeTNT(x, y, z, 80);
      return;
    }
    if (Math.random() * (age + 10) < 5 && !world.isRainingAt(x, y + 1, z)) {
      world.setBlock(x, y, z, B.fire, Math.min(15, age + Math.floor(Math.random() * 5 / 4)));
    } else {
      world.setBlock(x, y, z, 0, 0);
    }
  }
}
function fireTick(world, x, y, z) {
  if (!world.rules.doFireTick) return;
  if (!canStay(world, x, y, z, B.fire, 0)) {
    world.setBlock(x, y, z, 0, 0);
    return;
  }
  if (world.isRainingAt(x, y, z) && Math.random() < 0.6) {
    world.setBlock(x, y, z, 0, 0);
    return;
  }
  let age = world.getMeta(x, y, z);
  if (age < 15) {
    age = Math.min(15, age + Math.floor(Math.random() * 3 / 2));
    world.setBlock(x, y, z, B.fire, age, 0);
  }
  world.scheduleTick(x, y, z, 30 + Math.floor(Math.random() * 10));
  const below = world.getBlock(x, y - 1, z);
  if (!flammableNeighbor(world, x, y, z)) {
    if (!solidTop(world, x, y - 1, z) || age > 3) world.setBlock(x, y, z, 0, 0);
    return;
  }
  if (age === 15 && Math.random() < 0.25 && !flammability(below)) {
    world.setBlock(x, y, z, 0, 0);
    return;
  }
  tryBurn(world, x + 1, y, z, 300, age);
  tryBurn(world, x - 1, y, z, 300, age);
  tryBurn(world, x, y - 1, z, 250, age);
  tryBurn(world, x, y + 1, z, 250, age);
  tryBurn(world, x, y, z + 1, 300, age);
  tryBurn(world, x, y, z - 1, 300, age);
  const diff = world.game.difficulty ?? 2;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 4; dy++) {
    if (dx === 0 && dy === 0 && dz === 0) continue;
    const k = dy > 1 ? 100 + (dy - 1) * 100 : 100;
    const e = encouragement(world, x + dx, y + dy, z + dz);
    if (e <= 0) continue;
    const l = (e + 40 + diff * 7) / (age + 30);
    if (l > 0 && Math.random() * k <= l && !world.isRainingAt(x + dx, y + dy + 1, z + dz)) {
      world.setBlock(x + dx, y + dy, z + dz, B.fire, Math.min(15, age + Math.floor(Math.random() * 5 / 4)));
    }
  }
}

// ---------------------------------------------------------------- random ticks
function lightAbove(world, x, y, z) {
  return world.lightAt(x, y + 1, z);
}

function hydrated(world, x, y, z) {
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = 0; dy <= 1; dy++) {
    if (world.getBlock(x + dx, y + dy, z + dz) === B.water) return true;
  }
  return world.isRainingAt(x, y + 1, z);
}

function cropGrowthFactor(world, x, y, z) {
  let f = 1;
  const below = world.getBlock(x, y - 1, z);
  if (below === B.farmland) f += world.getMeta(x, y - 1, z) > 0 ? 3 : 1;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (dx === 0 && dz === 0) continue;
    if (world.getBlock(x + dx, y - 1, z + dz) === B.farmland) f += world.getMeta(x + dx, y - 1, z + dz) > 0 ? 0.75 : 0.25;
  }
  return f;
}

export function growCrop(world, x, y, z, id, amount) {
  const m = world.getMeta(x, y, z);
  if (m >= 7) return false;
  world.setBlock(x, y, z, id, Math.min(7, m + amount), 0);
  return true;
}

function leavesConnected(world, x, y, z) {
  // BFS through leaves (up to 4 steps) looking for a log.
  const seen = new Set();
  let frontier = [[x, y, z]];
  for (let step = 0; step <= 4; step++) {
    const next = [];
    for (const [px, py, pz] of frontier) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = px + dx, ny = py + dy, nz = pz + dz;
        const k = nx + ',' + ny + ',' + nz;
        if (seen.has(k)) continue;
        seen.add(k);
        const id = world.getBlock(nx, ny, nz);
        if (LOGS.has(id) || id === 255) return true;
        if (LEAVES.has(id)) next.push([nx, ny, nz]);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return false;
}

export function growTree(world, x, y, z, type, rng) {
  const height = type === 'spruce' ? 9 : 7;
  for (let i = 1; i < height; i++) {
    const id = world.getBlock(x, y + i, z);
    if (id !== 0 && !LEAVES.has(id)) return false;
  }
  world.setBlock(x, y, z, 0, 0, 0);
  const placed = [];
  placeTree({ x, y, z, type, hRoll: Math.floor(rng() * 3), leafSeed: Math.floor(rng() * 1e9) }, (wx, wy, wz, id, m, onlyAir) => {
    const cur = world.getBlock(wx, wy, wz);
    if (onlyAir && cur !== 0 && cur !== B.tall_grass && cur !== B.snow) return;
    if (!onlyAir && cur !== 0 && !LEAVES.has(cur) && cur !== B.tall_grass && cur !== B.snow && !(wx === x && wy === y && wz === z)) return;
    world.setBlock(wx, wy, wz, id, m, 0);
    placed.push([wx, wy, wz]);
  });
  const below = world.getBlock(x, y - 1, z);
  if (below === B.grass_block || below === B.farmland) world.setBlock(x, y - 1, z, B.dirt, 0, 0);
  return placed.length > 0;
}

export function randomTick(world, x, y, z, id, meta, r) {
  switch (id) {
    case B.grass_block: {
      const above = world.getBlock(x, y + 1, z);
      const l = lightAbove(world, x, y, z);
      if (l < 4 && (isOpaque[above] || isLiquid[above])) {
        world.setBlock(x, y, z, B.dirt, 0);
      } else if (l >= 9) {
        for (let n = 0; n < 4; n++) {
          const tx = x + Math.floor(r() * 3) - 1, ty = y + Math.floor(r() * 5) - 3, tz = z + Math.floor(r() * 3) - 1;
          if (world.getBlock(tx, ty, tz) !== B.dirt) continue;
          const a = world.getBlock(tx, ty + 1, tz);
          if (isOpaque[a] || isLiquid[a]) continue;
          if (world.lightAt(tx, ty + 1, tz) >= 4) world.setBlock(tx, ty, tz, B.grass_block, 0);
        }
      }
      break;
    }
    case B.wheat:
    case B.carrots:
    case B.potatoes: {
      if (meta >= 7 || lightAbove(world, x, y - 1, z) < 9) break;
      const f = cropGrowthFactor(world, x, y, z);
      if (r() < 1 / (Math.floor(25 / f) + 1)) growCrop(world, x, y, z, id, 1);
      break;
    }
    case B.oak_sapling:
    case B.birch_sapling:
    case B.spruce_sapling: {
      if (lightAbove(world, x, y - 1, z) < 9 || r() > 1 / 7) break;
      if ((meta & 1) === 0) world.setBlock(x, y, z, id, 1, 0);
      else growTree(world, x, y, z, BLOCKS[id].sapling, r);
      break;
    }
    case B.sugar_cane:
    case B.cactus: {
      if (world.getBlock(x, y + 1, z) !== 0) break;
      let h = 1;
      while (world.getBlock(x, y - h, z) === id) h++;
      if (h >= 3) break;
      if (meta >= 15) {
        world.setBlock(x, y, z, id, 0, 0);
        if (canStay(world, x, y + 1, z, id, 0)) world.setBlock(x, y + 1, z, id, 0);
      } else world.setBlock(x, y, z, id, meta + 1, 0);
      break;
    }
    case B.oak_leaves:
    case B.birch_leaves:
    case B.spruce_leaves: {
      if ((meta & 1) || !(meta & 2)) break;
      if (leavesConnected(world, x, y, z)) world.setBlock(x, y, z, id, meta & ~2, 0);
      else popBlock(world, x, y, z);
      break;
    }
    case B.farmland: {
      if (hydrated(world, x, y, z)) {
        if (meta !== 7) world.setBlock(x, y, z, id, 7, 0);
      } else if (meta > 0) world.setBlock(x, y, z, id, meta - 1, 0);
      else {
        const above = world.getBlock(x, y + 1, z);
        if (!BLOCKS[above] || !BLOCKS[above].crop) world.setBlock(x, y, z, B.dirt, 0);
      }
      break;
    }
    case B.ice:
      if (world.getBlockLight(x, y, z) > 11 || world.getBlockLight(x, y + 1, z) > 11) world.setBlock(x, y, z, B.water, 0);
      break;
    case B.snow:
      if (world.getBlockLight(x, y, z) > 11) world.setBlock(x, y, z, 0, 0);
      break;
    case B.brown_mushroom:
    case B.red_mushroom: {
      if (r() > 0.04) break;
      const tx = x + Math.floor(r() * 3) - 1, tz = z + Math.floor(r() * 3) - 1, ty = y + Math.floor(r() * 2) - Math.floor(r() * 2);
      if (world.getBlock(tx, ty, tz) === 0 && isOpaque[world.getBlock(tx, ty - 1, tz)] && world.lightAt(tx, ty, tz) < 13) world.setBlock(tx, ty, tz, id, 0);
      break;
    }
    case B.lava: {
      if (!world.rules.doFireTick || r() > 0.3) break;
      const tx = x + Math.floor(r() * 3) - 1, ty = y + 1 + Math.floor(r() * 2), tz = z + Math.floor(r() * 3) - 1;
      if (world.getBlock(tx, ty, tz) === 0 && flammableNeighbor(world, tx, ty, tz)) world.setBlock(tx, ty, tz, B.fire, 0);
      break;
    }
    default:
      break;
  }
}

// Bone meal on a block. Returns true if it did something.
export function applyBoneMeal(world, x, y, z, r = Math.random) {
  const id = world.getBlock(x, y, z);
  const b = BLOCKS[id];
  if (!b) return false;
  if (b.crop) return growCrop(world, x, y, z, id, 2 + Math.floor(r() * 4));
  if (b.sapling && typeof b.sapling === 'string' && b.shape === 'cross' && id !== B.oak_leaves) {
    if (r() < 0.45) {
      const meta = world.getMeta(x, y, z);
      if ((meta & 1) === 0) world.setBlock(x, y, z, id, 1, 0);
      else growTree(world, x, y, z, b.sapling, r);
    }
    return true;
  }
  if (id === B.grass_block) {
    for (let n = 0; n < 64; n++) {
      let tx = x, ty = y + 1, tz = z;
      const steps = Math.floor(n / 16);
      for (let s = 0; s < steps; s++) {
        tx += Math.floor(r() * 3) - 1;
        ty += Math.floor(r() * 3) - 1;
        tz += Math.floor(r() * 3) - 1;
      }
      if (world.getBlock(tx, ty - 1, tz) !== B.grass_block || world.getBlock(tx, ty, tz) !== 0) continue;
      const roll = r();
      const plant = roll < 0.8 ? B.tall_grass : roll < 0.9 ? B.dandelion : B.poppy;
      world.setBlock(tx, ty, tz, plant, 0);
    }
    return true;
  }
  return false;
}
