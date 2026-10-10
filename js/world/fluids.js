// Flowing water and lava. Level 0 is a source; 1..7 spread outward; bit 8
// marks a falling column. Water spreads 7 blocks, lava 3, and two adjacent
// water sources over solid ground create a new source.
import { B, BLOCKS, isLiquid, isSolid } from '../data/blocks.js';

const H = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function tickRate(id) {
  return id === B.lava ? 30 : 5;
}

function dropOff(id) {
  return id === B.lava ? 2 : 1;
}

function blocksFlow(id) {
  if (id === 255) return true;
  const b = BLOCKS[id];
  if (!b) return true;
  if (b.shape === 'door' || b.shape === 'ladder' || id === B.sugar_cane) return true;
  return isSolid[id] === 1;
}

function canFlowInto(world, x, y, z, fluid) {
  const id = world.getBlock(x, y, z);
  if (id === fluid) return false;
  if (fluid === B.water && id === B.lava) return false;
  if (fluid === B.lava && id === B.water) return true;
  if (isLiquid[id]) return false;
  return !blocksFlow(id);
}

function depthAt(world, x, y, z, fluid) {
  if (world.getBlock(x, y, z) !== fluid) return -1;
  const m = world.getMeta(x, y, z);
  return m >= 8 ? 0 : m;
}

function flowInto(world, x, y, z, fluid, meta) {
  const id = world.getBlock(x, y, z);
  if (id !== 0 && !isLiquid[id]) {
    // Washing away a plant / torch drops it.
    world.game.dropBlockItems(x, y, z, id, world.getMeta(x, y, z));
  }
  world.setBlock(x, y, z, fluid, meta);
  world.scheduleTick(x, y, z, tickRate(fluid));
}

function flowCost(world, x, y, z, fluid, recurse, from, maxDepth) {
  let best = 1000;
  for (let d = 0; d < 4; d++) {
    if (d === from) continue;
    const nx = x + H[d][0], nz = z + H[d][1];
    const id = world.getBlock(nx, y, nz);
    if (blocksFlow(id) || (id === fluid && world.getMeta(nx, y, nz) === 0)) continue;
    if (!blocksFlow(world.getBlock(nx, y - 1, nz))) return recurse;
    if (recurse < maxDepth) {
      const c = flowCost(world, nx, y, nz, fluid, recurse + 1, d ^ 1, maxDepth);
      if (c < best) best = c;
    }
  }
  return best;
}

function flowDirections(world, x, y, z, fluid) {
  const cost = [1000, 1000, 1000, 1000];
  const maxDepth = fluid === B.lava ? 2 : 4;
  for (let d = 0; d < 4; d++) {
    const nx = x + H[d][0], nz = z + H[d][1];
    const id = world.getBlock(nx, y, nz);
    if (blocksFlow(id) || (id === fluid && world.getMeta(nx, y, nz) === 0)) continue;
    if (!blocksFlow(world.getBlock(nx, y - 1, nz))) cost[d] = 0;
    else cost[d] = flowCost(world, nx, y, nz, fluid, 1, d ^ 1, maxDepth);
  }
  const min = Math.min(...cost);
  return cost.map((c) => c === min);
}

// Lava touching water hardens.
export function checkMixing(world, x, y, z) {
  if (world.getBlock(x, y, z) !== B.lava) return false;
  const touches = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => world.getBlock(x + dx, y + dy, z + dz) === B.water);
  if (!touches) return false;
  const meta = world.getMeta(x, y, z);
  if (meta === 0) world.setBlock(x, y, z, B.obsidian, 0);
  else if ((meta & 7) <= 4) world.setBlock(x, y, z, B.cobblestone, 0);
  else return false;
  world.game.fizz(x, y, z);
  return true;
}

export function fluidTick(world, x, y, z) {
  const fluid = world.getBlock(x, y, z);
  if (!isLiquid[fluid]) return;
  if (fluid === B.lava && checkMixing(world, x, y, z)) return;
  const drop = dropOff(fluid);
  let meta = world.getMeta(x, y, z);
  let depth = meta;

  if (meta !== 0) {
    let min = -1, sources = 0;
    for (const [dx, dz] of H) {
      const d = depthAt(world, x + dx, y, z + dz, fluid);
      if (d < 0) continue;
      if (world.getMeta(x + dx, y, z + dz) === 0) sources++;
      if (min < 0 || d < min) min = d;
    }
    let nd = min < 0 ? -1 : min + drop;
    if (nd >= 8) nd = -1;
    const above = world.getBlock(x, y + 1, z);
    if (above === fluid) {
      const am = world.getMeta(x, y + 1, z);
      nd = am >= 8 ? am : am + 8;
    }
    if (fluid === B.water && sources >= 2) {
      const below = world.getBlock(x, y - 1, z);
      if ((isSolid[below] && !isLiquid[below]) || (below === B.water && world.getMeta(x, y - 1, z) === 0)) nd = 0;
    }
    if (nd !== meta) {
      if (nd < 0) {
        world.setBlock(x, y, z, 0, 0);
        return;
      }
      world.setBlock(x, y, z, fluid, nd);
      world.scheduleTick(x, y, z, tickRate(fluid));
      meta = nd;
      depth = nd;
    }
  }

  // Spread
  const belowId = world.getBlock(x, y - 1, z);
  if (canFlowInto(world, x, y - 1, z, fluid)) {
    if (fluid === B.lava && belowId === B.water) {
      world.setBlock(x, y - 1, z, B.stone, 0);
      world.game.fizz(x, y - 1, z);
      return;
    }
    flowInto(world, x, y - 1, z, fluid, depth >= 8 ? depth : (depth & 7) | 8);
    return;
  }
  if (depth === 0 || (blocksFlow(belowId) && belowId !== fluid) || (depth >= 8 && blocksFlow(belowId))) {
    const nd = depth >= 8 ? 1 : depth + drop;
    if (nd >= 8) return;
    const dirs = flowDirections(world, x, y, z, fluid);
    for (let d = 0; d < 4; d++) {
      if (!dirs[d]) continue;
      const nx = x + H[d][0], nz = z + H[d][1];
      if (!canFlowInto(world, nx, y, nz, fluid)) continue;
      if (fluid === B.lava && world.getBlock(nx, y, nz) === B.water) continue;
      flowInto(world, nx, y, nz, fluid, nd);
    }
  }
}

// Flow direction (for pushing entities and rendering).
export function flowVector(world, x, y, z) {
  const fluid = world.getBlock(x, y, z);
  if (!isLiquid[fluid]) return [0, 0];
  const m = world.getMeta(x, y, z);
  const my = m >= 8 ? 0 : m;
  let fx = 0, fz = 0;
  for (const [dx, dz] of H) {
    const id = world.getBlock(x + dx, y, z + dz);
    let diff;
    if (id === fluid) {
      const nm = world.getMeta(x + dx, y, z + dz);
      diff = (nm >= 8 ? 0 : nm) - my;
    } else if (!blocksFlow(id) && world.getBlock(x + dx, y - 1, z + dz) === fluid) {
      diff = 8; // an open edge with fluid falling below pulls strongly
    } else continue;
    fx += dx * diff;
    fz += dz * diff;
  }
  const len = Math.hypot(fx, fz);
  return len > 0 ? [fx / len, fz / len] : [0, 0];
}
