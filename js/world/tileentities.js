// Blocks that hold items: chests and furnaces.
import { B } from '../data/blocks.js';
import { ITEMS, I, maxStack } from '../data/items.js';
import { smeltResult, fuelValue } from '../data/recipes.js';

export function createTileEntity(id, x, y, z) {
  if (id === B.chest) return { type: 'chest', x, y, z, items: new Array(27).fill(null) };
  if (id === B.furnace || id === B.lit_furnace) {
    return { type: 'furnace', x, y, z, items: [null, null, null], burn: 0, burnMax: 0, cook: 0, xp: 0, ticks: true, blockId: id };
  }
  return null;
}

export const COOK_TIME = 200;

function canSmelt(te) {
  const input = te.items[0];
  if (!input) return null;
  const res = smeltResult(input.id);
  if (!res) return null;
  const outId = I[res[0]];
  const out = te.items[2];
  if (!out) return res;
  if (out.id !== outId) return null;
  if (out.count + 1 > maxStack(outId)) return null;
  return res;
}

export function tickTileEntity(world, te) {
  if (te.type !== 'furnace') return;
  const wasBurning = te.burn > 0;
  let changed = false;
  if (te.burn > 0) te.burn--;
  const res = canSmelt(te);
  if (te.burn === 0 && res && te.items[1]) {
    const f = fuelValue(te.items[1].id);
    if (f > 0) {
      te.burn = te.burnMax = f;
      const fuel = te.items[1];
      const def = ITEMS[fuel.id];
      if (def.name === 'lava_bucket') te.items[1] = { id: I.bucket, count: 1, dmg: 0 };
      else {
        fuel.count--;
        if (fuel.count <= 0) te.items[1] = null;
      }
      changed = true;
    }
  }
  if (te.burn > 0 && res) {
    te.cook++;
    if (te.cook >= COOK_TIME) {
      te.cook = 0;
      const outId = I[res[0]];
      if (te.items[2]) te.items[2].count++;
      else te.items[2] = { id: outId, count: 1, dmg: 0 };
      te.items[0].count--;
      if (te.items[0].count <= 0) te.items[0] = null;
      te.xp += res[1];
      changed = true;
    }
  } else if (te.cook > 0) {
    te.cook = Math.max(0, te.cook - 2);
  }
  const burning = te.burn > 0;
  if (burning !== wasBurning) {
    const meta = world.getMeta(te.x, te.y, te.z);
    world.setBlock(te.x, te.y, te.z, burning ? B.lit_furnace : B.furnace, meta, 0);
    changed = true;
  }
  if (changed) world.markTileDirty(te);
}

export function serializeTile(te) {
  const items = te.items.map((s) => (s ? [ITEMS[s.id].name, s.count, s.dmg || 0] : null));
  const o = { type: te.type, x: te.x, y: te.y, z: te.z, items };
  if (te.type === 'furnace') Object.assign(o, { burn: te.burn, burnMax: te.burnMax, cook: te.cook, xp: te.xp });
  return o;
}

export function deserializeTile(o, blockId) {
  const te = createTileEntity(blockId, o.x, o.y, o.z);
  if (!te) return null;
  te.items = o.items.map((s) => (s && I[s[0]] !== undefined ? { id: I[s[0]], count: s[1], dmg: s[2] || 0 } : null));
  if (te.type === 'furnace') {
    te.burn = o.burn || 0;
    te.burnMax = o.burnMax || 0;
    te.cook = o.cook || 0;
    te.xp = o.xp || 0;
  }
  return te;
}
