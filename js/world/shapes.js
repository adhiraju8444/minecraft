// Block shapes as lists of boxes [x0, y0, z0, x1, y1, z1] in block-local units.
import { BLOCKS, SHAPE, shapeId, isOpaque } from '../data/blocks.js';

const FULL = [[0, 0, 0, 1, 1, 1]];
const NONE = [];

// Box hugging one horizontal edge of the cell. facing: 0 S(+z) 1 W(-x) 2 N(-z) 3 E(+x)
export function edgeBox(facing, t, y0 = 0, y1 = 1) {
  switch (facing & 3) {
    case 0: return [0, y0, 1 - t, 1, y1, 1];
    case 1: return [0, y0, 0, t, y1, 1];
    case 2: return [0, y0, 0, 1, y1, t];
    default: return [1 - t, y0, 0, 1, y1, 1];
  }
}

export function stairBoxes(meta) {
  const up = (meta & 4) !== 0;
  const f = meta & 3;
  const base = up ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
  const half = edgeBox(f, 0.5, up ? 0 : 0.5, up ? 0.5 : 1);
  return [base, half];
}

export function doorBox(meta) {
  const f = meta & 3;
  const open = (meta & 4) !== 0;
  const edge = open ? (f + 3) & 3 : f;
  return edgeBox(edge, 0.1875);
}

export function torchBox(meta) {
  if (meta === 0) return [0.4, 0, 0.4, 0.6, 0.6, 0.6];
  const facing = (meta - 1) & 3; // direction the torch points away from its wall
  switch (facing) {
    case 0: return [0.35, 0.2, 0, 0.65, 0.8, 0.3];
    case 1: return [0.7, 0.2, 0.35, 1, 0.8, 0.65];
    case 2: return [0.35, 0.2, 0.7, 0.65, 0.8, 1];
    default: return [0, 0.2, 0.35, 0.3, 0.8, 0.65];
  }
}

export function fenceConnects(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  const b = BLOCKS[id];
  if (!b) return false;
  return b.fence || b.shape === 'gate' || (isOpaque[id] === 1 && id !== 255);
}

function fenceBoxes(world, x, y, z, height) {
  const boxes = [[0.375, 0, 0.375, 0.625, height, 0.625]];
  if (!world) return boxes;
  if (fenceConnects(world, x + 1, y, z)) boxes.push([0.625, 0, 0.375, 1, height, 0.625]);
  if (fenceConnects(world, x - 1, y, z)) boxes.push([0, 0, 0.375, 0.375, height, 0.625]);
  if (fenceConnects(world, x, y, z + 1)) boxes.push([0.375, 0, 0.625, 0.625, height, 1]);
  if (fenceConnects(world, x, y, z - 1)) boxes.push([0.375, 0, 0, 0.625, height, 0.375]);
  return boxes;
}

// purpose: 'collide' or 'select'
export function blockBoxes(world, x, y, z, id, meta, purpose) {
  const s = shapeId[id];
  const sel = purpose === 'select';
  switch (s) {
    case SHAPE.none:
    case SHAPE.liquid:
    case SHAPE.fire:
      return NONE;
    case SHAPE.cube:
      return FULL;
    case SHAPE.cross:
      return sel ? [[0.15, 0, 0.15, 0.85, 0.8, 0.85]] : NONE;
    case SHAPE.crop:
      return sel ? [[0, 0, 0, 1, 0.12 + 0.11 * (meta & 7), 1]] : NONE;
    case SHAPE.torch:
      return sel ? [torchBox(meta)] : NONE;
    case SHAPE.slab:
      if (meta === 2) return FULL;
      return meta === 1 ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
    case SHAPE.stairs:
      return stairBoxes(meta);
    case SHAPE.door:
      return [doorBox(meta)];
    case SHAPE.ladder:
      return [edgeBox((meta + 2) & 3, 0.1875)];
    case SHAPE.cactus:
      return sel ? [[0.0625, 0, 0.0625, 0.9375, 1, 0.9375]] : [[0.0625, 0, 0.0625, 0.9375, 0.9375, 0.9375]];
    case SHAPE.farmland:
      return [[0, 0, 0, 1, 0.9375, 1]];
    case SHAPE.snow:
      return sel ? [[0, 0, 0, 1, 0.125, 1]] : NONE;
    case SHAPE.bed:
      return [[0, 0, 0, 1, 0.5625, 1]];
    case SHAPE.fence:
      return fenceBoxes(world, x, y, z, sel ? 1 : 1.5);
    case SHAPE.gate: {
      const open = (meta & 4) !== 0;
      const alongX = (meta & 1) === 0; // facing S/N -> gate spans x
      if (open) return sel ? [alongX ? [0, 0, 0.375, 1, 1, 0.625] : [0.375, 0, 0, 0.625, 1, 1]] : NONE;
      const h = sel ? 1 : 1.5;
      return [alongX ? [0, 0, 0.375, 1, h, 0.625] : [0.375, 0, 0, 0.625, h, 1]];
    }
    case SHAPE.chest:
      return [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]];
    default:
      return FULL;
  }
}

export function isFullCube(id, meta) {
  const s = shapeId[id];
  return s === SHAPE.cube || (s === SHAPE.slab && meta === 2);
}

// Top surface height of a block for things that rest on it.
export function topHeight(world, x, y, z, id, meta) {
  const boxes = blockBoxes(world, x, y, z, id, meta, 'collide');
  let h = 0;
  for (const b of boxes) if (b[4] > h) h = b[4];
  return h;
}
