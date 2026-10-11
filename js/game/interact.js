// Mining, harvesting and placing blocks.
import { B, BLOCKS, isReplaceable, isLiquid, isSolid } from '../data/blocks.js';
import { ITEMS, I } from '../data/items.js';
import { canStay } from '../world/behaviors.js';
import { blockBoxes } from '../world/shapes.js';
import { AABB } from '../world/physics.js';
import { FACE_DIRS, faceToFacing } from '../world/constants.js';

export function toolOf(stack) {
  if (!stack) return null;
  const d = ITEMS[stack.id];
  return d && d.tool ? d.tool : null;
}

export function canHarvest(blockId, stack) {
  const b = BLOCKS[blockId];
  if (!b) return false;
  if (!b.requiresTool) return true;
  const t = toolOf(stack);
  return !!t && t.type === b.tool && t.tier >= b.level;
}

// Fraction of the block broken per tick.
export function breakSpeed(player, blockId) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness < 0) return 0;
  if (b.hardness === 0) return 1;
  const stack = player.inventory.selectedStack();
  const t = toolOf(stack);
  let speed = 1;
  if (t) {
    if (t.type === b.tool && t.type !== 'shears') speed = t.speed;
    else if (t.type === 'shears' && b.leaves) speed = 15;
    else if (t.type === 'shears' && b.wool) speed = 5;
    else if (t.type === 'sword' && (b.leaves || b.shape === 'cross' || blockId === B.pumpkin || blockId === B.melon)) speed = 1.5;
  }
  if (player.eyeMedium() === B.water) speed /= 5;
  if (!player.onGround && !player.flying) speed /= 5;
  const harvest = canHarvest(blockId, stack);
  return speed / b.hardness / (harvest ? 30 : 100);
}

// Items a block yields when broken by the player.
export function blockDrops(blockId, meta, stack, rng = Math.random) {
  const b = BLOCKS[blockId];
  if (!b || b.noDrop && !(toolOf(stack)?.type === 'shears' && b.leaves)) return [];
  if (!canHarvest(blockId, stack)) return [];
  const t = toolOf(stack);
  const shears = t && t.type === 'shears';
  if (b.leaves) {
    if (shears) return [{ id: blockId, count: 1, dmg: 0 }];
    const out = [];
    if (rng() < 0.05 && b.sapling) out.push({ id: I[b.sapling], count: 1, dmg: 0 });
    if (b.apple && rng() < 0.005) out.push({ id: I.apple, count: 1, dmg: 0 });
    return out;
  }
  if (shears && b.shearDrop) return [{ id: blockId, count: 1, dmg: 0 }];
  if (b.slab && meta === 2) return [{ id: blockId, count: 2, dmg: 0 }];
  if (b.drops) {
    return b.drops(meta, rng)
      .filter(([, n]) => n > 0)
      .map(([name, n]) => ({ id: I[name], count: n, dmg: 0 }))
      .filter((s) => s.id !== undefined);
  }
  if (b.noItem || b.noDrop) return [];
  return [{ id: blockId, count: 1, dmg: 0 }];
}

// Same as above but for blocks knocked out by the world (no tool checks).
export function naturalDrops(blockId, meta) {
  const b = BLOCKS[blockId];
  if (!b || b.noDrop) return [];
  if (b.leaves) {
    const out = [];
    if (Math.random() < 0.05 && b.sapling) out.push({ id: I[b.sapling], count: 1, dmg: 0 });
    if (b.apple && Math.random() < 0.005) out.push({ id: I.apple, count: 1, dmg: 0 });
    return out;
  }
  if (b.drops) {
    if (b.requiresTool) return [];
    return b.drops(meta, Math.random).filter(([, n]) => n > 0).map(([name, n]) => ({ id: I[name], count: n, dmg: 0 })).filter((s) => s.id !== undefined);
  }
  if (b.noItem || b.requiresTool) return [];
  return [{ id: blockId, count: 1, dmg: 0 }];
}

export function xpForBlock(blockId) {
  const b = BLOCKS[blockId];
  if (!b || !b.xp) return 0;
  return b.xp[0] + Math.floor(Math.random() * (b.xp[1] - b.xp[0] + 1));
}

// Horizontal facing (0 S, 1 W, 2 N, 3 E) of where the player looks.
export function lookFacing(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 3 : 1;
  return fz > 0 ? 0 : 2;
}

function entitiesBlock(game, x, y, z, id, meta) {
  if (!isSolid[id]) return false;
  const boxes = blockBoxes(game.world, x, y, z, id, meta, 'collide');
  const ents = [...game.players, ...game.world.entities.filter((e) => e.blocksPlacement)];
  for (const e of ents) {
    if (!e || e.dead || (e.isPlayer && e.mode === 'spectator')) continue;
    for (const b of boxes) {
      const a = new AABB(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
      if (a.intersects(e.box)) return true;
    }
  }
  return false;
}

// Try to place the selected block item at the ray hit. Returns true on success.
export function placeBlockFromItem(game, player, hit, stack) {
  const world = game.world;
  const def = ITEMS[stack.id];
  let blockId = def.block;
  if (def.use === 'plant') blockId = B[def.plants];
  if (!blockId) return false;
  const bdef = BLOCKS[blockId];
  const face = hit.face;
  const n = FACE_DIRS[face];
  let x = hit.x, y = hit.y, z = hit.z;
  const target = world.getBlock(x, y, z);
  const tmeta = world.getMeta(x, y, z);

  // Slab stacking
  if (bdef.slab && target === blockId && tmeta !== 2) {
    if ((face === 2 && tmeta === 0) || (face === 3 && tmeta === 1)) {
      if (entitiesBlock(game, x, y, z, blockId, 2)) return false;
      world.setBlock(x, y, z, blockId, 2);
      return finishPlace(game, player, x, y, z, blockId, stack);
    }
  }
  const replaceTarget = isReplaceable[target] && target !== blockId && !(target === B.snow && blockId === B.snow);
  if (!replaceTarget) {
    x += n[0]; y += n[1]; z += n[2];
  }
  if (y < 0 || y >= 128) return false;
  const cur = world.getBlock(x, y, z);
  if (bdef.slab && cur === blockId && world.getMeta(x, y, z) !== 2) {
    if (entitiesBlock(game, x, y, z, blockId, 2)) return false;
    world.setBlock(x, y, z, blockId, 2);
    return finishPlace(game, player, x, y, z, blockId, stack);
  }
  if (!isReplaceable[cur]) return false;
  if (cur === 255) return false;

  // Work out metadata from how it was placed.
  const look = lookFacing(player.yaw);
  let meta = 0;
  const hy = hit.py - hit.y;
  if (bdef.axis) meta = face === 0 || face === 1 ? 1 : face === 4 || face === 5 ? 2 : 0;
  else if (bdef.facing) meta = (look + 2) & 3;
  else if (bdef.shape === 'stairs') meta = look | (face === 3 || (face !== 2 && hy > 0.5) ? 4 : 0);
  else if (bdef.slab) meta = face === 3 || (face !== 2 && hy > 0.5) ? 1 : 0;
  else if (bdef.shape === 'torch') {
    if (face === 2) meta = 0;
    else if (face === 3) return false;
    else meta = 1 + faceToFacing(face);
    if (!canStay(world, x, y, z, blockId, meta)) {
      if (meta !== 0 && canStay(world, x, y, z, blockId, 0)) meta = 0;
      else return false;
    }
  } else if (bdef.shape === 'ladder') {
    if (face < 2 || face > 3) meta = faceToFacing(face);
    else return false;
  } else if (bdef.shape === 'gate') meta = look;
  else if (blockId === B.oak_leaves || blockId === B.birch_leaves || blockId === B.spruce_leaves) meta = 1;

  if (bdef.support && !canStay(world, x, y, z, blockId, meta)) return false;
  if (entitiesBlock(game, x, y, z, blockId, meta)) return false;
  // Do not place liquids' neighbours weirdly: placing into water waterlogs nothing.
  world.setBlock(x, y, z, blockId, meta);
  return finishPlace(game, player, x, y, z, blockId, stack);
}

function finishPlace(game, player, x, y, z, blockId, stack) {
  game.audio.blockSound(BLOCKS[blockId].sound, 'place', x + 0.5, y + 0.5, z + 0.5);
  if (player.mode !== 'creative') {
    stack.count--;
    if (stack.count <= 0) player.inventory.setSelected(null);
    player.inventory.changed();
  }
  player.swing();
  return true;
}

// Doors and beds are two blocks.
export function placeDoor(game, player, hit, stack) {
  const world = game.world;
  if (hit.face !== 2) return false;
  const x = hit.x, y = hit.y + 1, z = hit.z;
  if (!isReplaceable[world.getBlock(x, y, z)] || !isReplaceable[world.getBlock(x, y + 1, z)]) return false;
  const f = lookFacing(player.yaw);
  if (!canStay(world, x, y, z, B.oak_door, 0) && !isSolid[world.getBlock(x, y - 1, z)]) return false;
  if (entitiesBlock(game, x, y, z, B.oak_door, f) || entitiesBlock(game, x, y + 1, z, B.oak_door, f | 8)) return false;
  world.setBlock(x, y + 1, z, B.oak_door, f | 8, 0);
  world.setBlock(x, y, z, B.oak_door, f);
  return finishPlace(game, player, x, y, z, B.oak_door, stack);
}

export function placeBed(game, player, hit, stack) {
  const world = game.world;
  if (hit.face !== 2) return false;
  const f = lookFacing(player.yaw);
  const x = hit.x, y = hit.y + 1, z = hit.z;
  const hx = x + FACE_DIRS[[4, 1, 5, 0][f]][0], hz = z + FACE_DIRS[[4, 1, 5, 0][f]][2];
  if (!isReplaceable[world.getBlock(x, y, z)] || !isReplaceable[world.getBlock(hx, y, hz)]) return false;
  if (!isSolid[world.getBlock(x, y - 1, z)] || !isSolid[world.getBlock(hx, y - 1, hz)]) return false;
  if (entitiesBlock(game, x, y, z, B.red_bed, f) || entitiesBlock(game, hx, y, hz, B.red_bed, f | 4)) return false;
  world.setBlock(hx, y, hz, B.red_bed, f | 4, 0);
  world.setBlock(x, y, z, B.red_bed, f);
  return finishPlace(game, player, x, y, z, B.red_bed, stack);
}

// Toggle a door (both halves) and return true.
export function toggleDoor(game, x, y, z) {
  const world = game.world;
  const lowerY = world.getMeta(x, y, z) & 8 ? y - 1 : y;
  const lower = world.getMeta(x, lowerY, z);
  const open = !(lower & 4);
  const nm = (lower & ~4) | (open ? 4 : 0);
  world.setBlock(x, lowerY, z, B.oak_door, nm, 0);
  if (world.getBlock(x, lowerY + 1, z) === B.oak_door) world.setBlock(x, lowerY + 1, z, B.oak_door, (nm & 7) | 8, 0);
  game.audio.play(open ? 'door_open' : 'door_close', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  return true;
}

export function toggleGate(game, player, x, y, z) {
  const world = game.world;
  const meta = world.getMeta(x, y, z);
  const open = !(meta & 4);
  let nm = meta & 3;
  if (open) {
    // Swing away from the player.
    const alongX = (meta & 1) === 0;
    const side = alongX ? (player.z > z + 0.5 ? 1 : 0) : (player.x > x + 0.5 ? 1 : 0);
    nm = (meta & 1) | (side ? 2 : 0) | 4;
  }
  world.setBlock(x, y, z, B.oak_fence_gate, nm, 0);
  game.audio.play(open ? 'door_open' : 'door_close', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  return true;
}

export function liquidUnder(world, x, y, z) {
  return isLiquid[world.getBlock(x, y, z)];
}
