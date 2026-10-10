// Block registry. Every block in the world is a numeric id (0-255) plus a
// 4-bit metadata value. This file describes how each block looks, behaves,
// breaks and what it drops.

export const BLOCKS = new Array(256).fill(null);
export const B = {}; // name -> id

const DEFAULTS = {
  shape: 'cube',
  solid: true,
  opaque: true,
  cutout: false,
  translucent: false,
  light: 0,
  hardness: 1,
  tool: null, // 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'shears' | 'sword'
  level: 0, // minimum tool tier to harvest when requiresTool
  requiresTool: false,
  sound: 'stone',
  replaceable: false,
  flammable: null, // [encouragement, flammability]
  tint: null, // 'grass' | 'foliage' | 'birch' | 'spruce'
  gravity: false,
  slip: 0.6,
  tab: 'building',
  noItem: false,
  xp: null, // [min, max] dropped when mined with proper tool
  use: null, // name of interaction handler
  support: null, // name of support rule
};

function reg(id, name, display, props = {}) {
  const def = Object.assign({}, DEFAULTS, props);
  def.id = id;
  def.name = name;
  def.display = display;
  if (def.shape !== 'cube' && props.opaque === undefined) def.opaque = false;
  if (def.opacity === undefined) def.opacity = def.opaque ? 15 : 0;
  if (def.blast === undefined) def.blast = def.hardness < 0 ? 3600000 : def.hardness * 5;
  if (!def.tex) def.tex = name;
  BLOCKS[id] = def;
  B[name] = id;
  return def;
}

const plant = (extra) =>
  Object.assign(
    { shape: 'cross', solid: false, opaque: false, cutout: true, hardness: 0, sound: 'grass', replaceable: false, tab: 'decoration', support: 'soil', flammable: [60, 100] },
    extra
  );
const ore = (extra) => Object.assign({ hardness: 3, tool: 'pickaxe', requiresTool: true, level: 1 }, extra);

reg(0, 'air', 'Air', { shape: 'none', solid: false, opaque: false, hardness: 0, replaceable: true, noItem: true });
reg(1, 'stone', 'Stone', { hardness: 1.5, tool: 'pickaxe', requiresTool: true, blast: 30, drops: () => [['cobblestone', 1]] });
reg(2, 'grass_block', 'Grass Block', {
  hardness: 0.6, tool: 'shovel', sound: 'grass', tint: 'grass',
  tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
  drops: () => [['dirt', 1]],
});
reg(3, 'dirt', 'Dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
reg(4, 'cobblestone', 'Cobblestone', { hardness: 2, tool: 'pickaxe', requiresTool: true, blast: 30 });
reg(5, 'oak_planks', 'Oak Planks', { hardness: 2, tool: 'axe', sound: 'wood', flammable: [5, 20], blast: 15 });
reg(6, 'bedrock', 'Bedrock', { hardness: -1, blast: 3600000, noDrop: true });
reg(7, 'water', 'Water', {
  shape: 'liquid', solid: false, opaque: false, translucent: true, opacity: 2, hardness: 100,
  replaceable: true, noItem: true, tex: 'water_still', sound: 'water',
});
reg(8, 'lava', 'Lava', {
  shape: 'liquid', solid: false, opaque: false, opacity: 15, light: 15, hardness: 100,
  replaceable: true, noItem: true, tex: 'lava_still', sound: 'lava',
});
reg(9, 'sand', 'Sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
reg(10, 'gravel', 'Gravel', {
  hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true,
  drops: (m, r) => (r() < 0.1 ? [['flint', 1]] : [['gravel', 1]]),
});
reg(11, 'gold_ore', 'Gold Ore', ore({ level: 2 }));
reg(12, 'iron_ore', 'Iron Ore', ore({ level: 1 }));
reg(13, 'coal_ore', 'Coal Ore', ore({ level: 0, drops: () => [['coal', 1]], xp: [0, 2] }));
reg(14, 'oak_log', 'Oak Log', { hardness: 2, tool: 'axe', sound: 'wood', flammable: [5, 5], tex: { end: 'oak_log_top', side: 'oak_log' }, axis: true });
reg(15, 'oak_leaves', 'Oak Leaves', {
  opaque: false, cutout: true, opacity: 1, hardness: 0.2, tool: 'shears', sound: 'grass', tint: 'foliage',
  flammable: [30, 60], tab: 'decoration', leaves: true, sapling: 'oak_sapling', apple: true,
});
reg(16, 'glass', 'Glass', { opaque: false, cutout: true, hardness: 0.3, sound: 'glass', noDrop: true, tab: 'building' });
reg(17, 'lapis_ore', 'Lapis Lazuli Ore', ore({ level: 1, drops: (m, r) => [['lapis_lazuli', 4 + Math.floor(r() * 5)]], xp: [2, 5] }));
reg(18, 'lapis_block', 'Block of Lapis Lazuli', { hardness: 3, tool: 'pickaxe', requiresTool: true, level: 1 });
reg(19, 'sandstone', 'Sandstone', { hardness: 0.8, tool: 'pickaxe', requiresTool: true, tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' } });
reg(20, 'diamond_ore', 'Diamond Ore', ore({ level: 2, drops: () => [['diamond', 1]], xp: [3, 7] }));
reg(21, 'diamond_block', 'Block of Diamond', { hardness: 5, tool: 'pickaxe', requiresTool: true, level: 2, sound: 'metal' });
reg(22, 'gold_block', 'Block of Gold', { hardness: 3, tool: 'pickaxe', requiresTool: true, level: 2, sound: 'metal' });
reg(23, 'iron_block', 'Block of Iron', { hardness: 5, tool: 'pickaxe', requiresTool: true, level: 1, sound: 'metal' });
reg(24, 'coal_block', 'Block of Coal', { hardness: 5, tool: 'pickaxe', requiresTool: true, flammable: [5, 5] });
reg(25, 'bricks', 'Bricks', { hardness: 2, tool: 'pickaxe', requiresTool: true, blast: 30 });
reg(26, 'tnt', 'TNT', { hardness: 0, sound: 'grass', tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, use: 'tnt', flammable: [15, 100], tab: 'misc' });
reg(27, 'bookshelf', 'Bookshelf', { hardness: 1.5, tool: 'axe', sound: 'wood', tex: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, drops: () => [['book', 3]], flammable: [30, 20] });
reg(28, 'mossy_cobblestone', 'Mossy Cobblestone', { hardness: 2, tool: 'pickaxe', requiresTool: true, blast: 30 });
reg(29, 'obsidian', 'Obsidian', { hardness: 50, tool: 'pickaxe', requiresTool: true, level: 3, blast: 6000 });
reg(30, 'torch', 'Torch', { shape: 'torch', solid: false, opaque: false, cutout: true, light: 14, hardness: 0, sound: 'wood', tab: 'decoration', support: 'torch' });
reg(31, 'fire', 'Fire', { shape: 'fire', solid: false, opaque: false, cutout: true, light: 15, hardness: 0, replaceable: true, noItem: true, noDrop: true, tex: 'fire', support: 'fire' });
reg(32, 'chest', 'Chest', { shape: 'chest', opaque: false, solid: true, hardness: 2.5, tool: 'axe', sound: 'wood', tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' }, facing: true, use: 'chest', tab: 'decoration', flammable: null });
reg(33, 'crafting_table', 'Crafting Table', { hardness: 2.5, tool: 'axe', sound: 'wood', tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' }, facing: true, use: 'crafting', tab: 'decoration', flammable: [5, 20] });
reg(34, 'furnace', 'Furnace', { hardness: 3.5, tool: 'pickaxe', requiresTool: true, tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, facing: true, use: 'furnace', tab: 'decoration' });
reg(35, 'lit_furnace', 'Furnace', { hardness: 3.5, tool: 'pickaxe', requiresTool: true, light: 13, tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on' }, facing: true, use: 'furnace', noItem: true, drops: () => [['furnace', 1]] });
reg(36, 'wheat', 'Wheat Crops', {
  shape: 'crop', solid: false, opaque: false, cutout: true, hardness: 0, sound: 'grass', noItem: true, support: 'farmland', crop: { item: 'wheat', seed: 'wheat_seeds', stages: 8 },
  drops: (m, r) => {
    if (m >= 7) return [['wheat', 1], ['wheat_seeds', 1 + Math.floor(r() * 3)]];
    return [['wheat_seeds', 1]];
  },
});
reg(37, 'farmland', 'Farmland', { shape: 'farmland', opaque: false, opacity: 15, hardness: 0.6, tool: 'shovel', sound: 'gravel', noItem: true, drops: () => [['dirt', 1]] });
reg(38, 'oak_door', 'Oak Door', { shape: 'door', opaque: false, cutout: true, hardness: 3, tool: 'axe', sound: 'wood', noItem: true, use: 'door', support: 'door', drops: (m) => ((m & 8) ? [] : [['oak_door', 1]]) });
reg(39, 'ladder', 'Ladder', { shape: 'ladder', solid: true, opaque: false, cutout: true, hardness: 0.4, tool: 'axe', sound: 'wood', tab: 'decoration', support: 'wall', climbable: true, flammable: null });
reg(40, 'cobblestone_stairs', 'Cobblestone Stairs', { shape: 'stairs', opaque: false, opacity: 15, hardness: 2, tool: 'pickaxe', requiresTool: true, tex: 'cobblestone' });
reg(41, 'oak_stairs', 'Oak Stairs', { shape: 'stairs', opaque: false, opacity: 15, hardness: 2, tool: 'axe', sound: 'wood', tex: 'oak_planks', flammable: [5, 20] });
reg(42, 'smooth_stone_slab', 'Smooth Stone Slab', { shape: 'slab', opaque: false, opacity: 15, hardness: 2, tool: 'pickaxe', requiresTool: true, tex: { top: 'smooth_stone', bottom: 'smooth_stone', side: 'smooth_stone_slab_side' }, slab: true });
reg(43, 'oak_slab', 'Oak Slab', { shape: 'slab', opaque: false, opacity: 15, hardness: 2, tool: 'axe', sound: 'wood', tex: 'oak_planks', slab: true, flammable: [5, 20] });
reg(44, 'cobblestone_slab', 'Cobblestone Slab', { shape: 'slab', opaque: false, opacity: 15, hardness: 2, tool: 'pickaxe', requiresTool: true, tex: 'cobblestone', slab: true });
reg(45, 'snow', 'Snow', { shape: 'snow', solid: false, opaque: false, hardness: 0.1, tool: 'shovel', requiresTool: true, sound: 'snow', replaceable: true, support: 'solid_below', drops: () => [['snowball', 1]], tab: 'decoration' });
reg(46, 'ice', 'Ice', { opaque: false, translucent: true, opacity: 2, hardness: 0.5, tool: 'pickaxe', sound: 'glass', slip: 0.98, noDrop: true });
reg(47, 'snow_block', 'Snow Block', { tex: 'snow', hardness: 0.2, tool: 'shovel', requiresTool: true, sound: 'snow', drops: () => [['snowball', 4]] });
reg(48, 'cactus', 'Cactus', { shape: 'cactus', opaque: false, cutout: true, hardness: 0.4, sound: 'wool', tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, support: 'cactus', tab: 'decoration' });
reg(49, 'clay', 'Clay', { hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: () => [['clay_ball', 4]] });
reg(50, 'sugar_cane', 'Sugar Cane', plant({ support: 'sugar_cane', tab: 'materials', flammable: null }));
reg(51, 'pumpkin', 'Pumpkin', { hardness: 1, tool: 'axe', sound: 'wood', tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_side' }, tab: 'building' });
reg(52, 'jack_o_lantern', "Jack o'Lantern", { hardness: 1, tool: 'axe', sound: 'wood', light: 15, tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, facing: true, tab: 'building' });
reg(53, 'melon', 'Melon', { hardness: 1, tool: 'axe', sound: 'wood', tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' }, drops: (m, r) => [['melon_slice', 3 + Math.floor(r() * 5)]] });
reg(54, 'glowstone', 'Glowstone', { opaque: true, light: 15, hardness: 0.3, sound: 'glass', drops: (m, r) => [['glowstone_dust', 2 + Math.floor(r() * 3)]] });
reg(55, 'birch_log', 'Birch Log', { hardness: 2, tool: 'axe', sound: 'wood', flammable: [5, 5], tex: { end: 'birch_log_top', side: 'birch_log' }, axis: true });
reg(56, 'birch_leaves', 'Birch Leaves', { opaque: false, cutout: true, opacity: 1, hardness: 0.2, tool: 'shears', sound: 'grass', tint: 'birch', flammable: [30, 60], tab: 'decoration', leaves: true, sapling: 'birch_sapling' });
reg(57, 'birch_planks', 'Birch Planks', { hardness: 2, tool: 'axe', sound: 'wood', flammable: [5, 20], blast: 15 });
reg(58, 'spruce_log', 'Spruce Log', { hardness: 2, tool: 'axe', sound: 'wood', flammable: [5, 5], tex: { end: 'spruce_log_top', side: 'spruce_log' }, axis: true });
reg(59, 'spruce_leaves', 'Spruce Leaves', { opaque: false, cutout: true, opacity: 1, hardness: 0.2, tool: 'shears', sound: 'grass', tint: 'spruce', flammable: [30, 60], tab: 'decoration', leaves: true, sapling: 'spruce_sapling' });
reg(60, 'spruce_planks', 'Spruce Planks', { hardness: 2, tool: 'axe', sound: 'wood', flammable: [5, 20], blast: 15 });
reg(61, 'tall_grass', 'Grass', plant({ replaceable: true, tint: 'grass', tool: 'shears', drops: (m, r) => (r() < 0.125 ? [['wheat_seeds', 1]] : []), shearDrop: true }));
reg(62, 'fern', 'Fern', plant({ replaceable: true, tint: 'grass', tool: 'shears', drops: (m, r) => (r() < 0.125 ? [['wheat_seeds', 1]] : []), shearDrop: true }));
reg(63, 'dead_bush', 'Dead Bush', plant({ replaceable: true, support: 'sand', drops: (m, r) => [['stick', Math.floor(r() * 3)]], shearDrop: true }));
reg(64, 'dandelion', 'Dandelion', plant({}));
reg(65, 'poppy', 'Poppy', plant({}));
reg(66, 'cornflower', 'Cornflower', plant({}));
reg(67, 'oxeye_daisy', 'Oxeye Daisy', plant({}));
reg(68, 'oak_sapling', 'Oak Sapling', plant({ sapling: 'oak' }));
reg(69, 'birch_sapling', 'Birch Sapling', plant({ sapling: 'birch' }));
reg(70, 'spruce_sapling', 'Spruce Sapling', plant({ sapling: 'spruce' }));
reg(71, 'brown_mushroom', 'Brown Mushroom', plant({ support: 'mushroom', light: 1, flammable: null }));
reg(72, 'red_mushroom', 'Red Mushroom', plant({ support: 'mushroom', flammable: null }));
reg(73, 'stone_bricks', 'Stone Bricks', { hardness: 1.5, tool: 'pickaxe', requiresTool: true, blast: 30 });
reg(74, 'smooth_stone', 'Smooth Stone', { hardness: 2, tool: 'pickaxe', requiresTool: true, blast: 30 });
reg(75, 'red_bed', 'Red Bed', { shape: 'bed', opaque: false, solid: true, hardness: 0.2, sound: 'wood', noItem: true, use: 'bed', support: 'bed', drops: (m) => ((m & 4) ? [] : [['red_bed', 1]]), flammable: [5, 20] });
reg(76, 'oak_fence', 'Oak Fence', { shape: 'fence', opaque: false, hardness: 2, tool: 'axe', sound: 'wood', tex: 'oak_planks', tab: 'decoration', flammable: [5, 20], fence: true });
reg(77, 'oak_fence_gate', 'Oak Fence Gate', { shape: 'gate', opaque: false, hardness: 2, tool: 'axe', sound: 'wood', tex: 'oak_planks', tab: 'decoration', use: 'gate', flammable: [5, 20] });
reg(78, 'carrots', 'Carrots', {
  shape: 'crop', solid: false, opaque: false, cutout: true, hardness: 0, sound: 'grass', noItem: true, support: 'farmland', crop: { item: 'carrot', seed: 'carrot', stages: 8 },
  drops: (m, r) => (m >= 7 ? [['carrot', 1 + Math.floor(r() * 4)]] : [['carrot', 1]]),
});
reg(79, 'potatoes', 'Potatoes', {
  shape: 'crop', solid: false, opaque: false, cutout: true, hardness: 0, sound: 'grass', noItem: true, support: 'farmland', crop: { item: 'potato', seed: 'potato', stages: 8 },
  drops: (m, r) => (m >= 7 ? [['potato', 1 + Math.floor(r() * 4)]] : [['potato', 1]]),
});
reg(80, 'brick_stairs', 'Brick Stairs', { shape: 'stairs', opaque: false, opacity: 15, hardness: 2, tool: 'pickaxe', requiresTool: true, tex: 'bricks' });
reg(81, 'stone_brick_stairs', 'Stone Brick Stairs', { shape: 'stairs', opaque: false, opacity: 15, hardness: 1.5, tool: 'pickaxe', requiresTool: true, tex: 'stone_bricks' });
reg(82, 'brick_slab', 'Brick Slab', { shape: 'slab', opaque: false, opacity: 15, hardness: 2, tool: 'pickaxe', requiresTool: true, tex: 'bricks', slab: true });
reg(83, 'stone_brick_slab', 'Stone Brick Slab', { shape: 'slab', opaque: false, opacity: 15, hardness: 1.5, tool: 'pickaxe', requiresTool: true, tex: 'stone_bricks', slab: true });
reg(84, 'sandstone_slab', 'Sandstone Slab', { shape: 'slab', opaque: false, opacity: 15, hardness: 2, tool: 'pickaxe', requiresTool: true, tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, slab: true });
reg(85, 'hay_block', 'Hay Bale', { hardness: 0.5, tool: 'hoe', sound: 'grass', tex: { end: 'hay_top', side: 'hay_side' }, axis: true, flammable: [60, 20] });
reg(86, 'mossy_stone_bricks', 'Mossy Stone Bricks', { hardness: 1.5, tool: 'pickaxe', requiresTool: true });
reg(87, 'cracked_stone_bricks', 'Cracked Stone Bricks', { hardness: 1.5, tool: 'pickaxe', requiresTool: true });
reg(88, 'granite', 'Granite', { hardness: 1.5, tool: 'pickaxe', requiresTool: true });
reg(89, 'diorite', 'Diorite', { hardness: 1.5, tool: 'pickaxe', requiresTool: true });
reg(90, 'andesite', 'Andesite', { hardness: 1.5, tool: 'pickaxe', requiresTool: true });
reg(91, 'spruce_stairs', 'Spruce Stairs', { shape: 'stairs', opaque: false, opacity: 15, hardness: 2, tool: 'axe', sound: 'wood', tex: 'spruce_planks', flammable: [5, 20] });
reg(92, 'birch_stairs', 'Birch Stairs', { shape: 'stairs', opaque: false, opacity: 15, hardness: 2, tool: 'axe', sound: 'wood', tex: 'birch_planks', flammable: [5, 20] });
reg(93, 'stone_stairs', 'Stone Stairs', { shape: 'stairs', opaque: false, opacity: 15, hardness: 1.5, tool: 'pickaxe', requiresTool: true, tex: 'stone' });

export const WOOL_COLORS = [
  ['white', 'White', [233, 236, 236]],
  ['orange', 'Orange', [240, 118, 19]],
  ['magenta', 'Magenta', [189, 68, 179]],
  ['light_blue', 'Light Blue', [58, 175, 217]],
  ['yellow', 'Yellow', [248, 198, 39]],
  ['lime', 'Lime', [112, 185, 25]],
  ['pink', 'Pink', [237, 141, 172]],
  ['gray', 'Gray', [62, 68, 71]],
  ['light_gray', 'Light Gray', [142, 142, 134]],
  ['cyan', 'Cyan', [21, 137, 145]],
  ['purple', 'Purple', [121, 42, 172]],
  ['blue', 'Blue', [53, 57, 157]],
  ['brown', 'Brown', [114, 71, 40]],
  ['green', 'Green', [84, 109, 27]],
  ['red', 'Red', [160, 39, 34]],
  ['black', 'Black', [20, 21, 25]],
];
WOOL_COLORS.forEach(([c, d], i) => {
  reg(96 + i, c + '_wool', d + ' Wool', { hardness: 0.8, tool: 'shears', sound: 'wool', flammable: [30, 60], tab: 'building', wool: true });
});

// Fast lookup tables used by the mesher, lighting and physics.
export const isOpaque = new Uint8Array(256);
export const isSolid = new Uint8Array(256);
export const lightEmit = new Uint8Array(256);
export const lightOpacity = new Uint8Array(256);
export const isLiquid = new Uint8Array(256);
export const isReplaceable = new Uint8Array(256);
export const isCutout = new Uint8Array(256);
export const isTranslucent = new Uint8Array(256);
export const shapeId = new Uint8Array(256);
export const SHAPES = ['none', 'cube', 'cross', 'crop', 'liquid', 'torch', 'slab', 'stairs', 'door', 'ladder', 'cactus', 'farmland', 'snow', 'bed', 'fence', 'gate', 'chest', 'fire'];
export const SHAPE = Object.fromEntries(SHAPES.map((s, i) => [s, i]));

// Unloaded terrain reads as this id: it is solid and opaque so nothing can
// walk or fall into chunks that have not arrived yet.
export const UNLOADED = 255;

for (let i = 0; i < 256; i++) {
  const b = BLOCKS[i];
  if (!b) continue;
  isOpaque[i] = b.opaque && b.shape === 'cube' ? 1 : 0;
  isSolid[i] = b.solid ? 1 : 0;
  lightEmit[i] = b.light;
  lightOpacity[i] = b.opacity;
  isLiquid[i] = b.shape === 'liquid' ? 1 : 0;
  isReplaceable[i] = b.replaceable ? 1 : 0;
  isCutout[i] = b.cutout ? 1 : 0;
  isTranslucent[i] = b.translucent ? 1 : 0;
  shapeId[i] = SHAPE[b.shape];
}
isOpaque[UNLOADED] = 1;
isSolid[UNLOADED] = 1;
lightOpacity[UNLOADED] = 15;
shapeId[UNLOADED] = SHAPE.none;

export function blockDef(id) {
  return BLOCKS[id] || BLOCKS[0];
}

// Resolve the tile name for a block face given its metadata.
// face: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
const FACE_OF_FACING = [4, 1, 5, 0];
export function tileFor(id, meta, face) {
  const b = BLOCKS[id];
  if (!b) return 'missing';
  const t = b.tex;
  if (b.crop) {
    const st = b.name === 'wheat' ? meta & 7 : Math.min(3, Math.floor((meta & 7) / 2));
    return b.name + '_' + st;
  }
  if (b.name === 'farmland') {
    if (face === 2) return meta > 0 ? 'farmland_moist' : 'farmland';
    return 'dirt';
  }
  if (b.name === 'oak_door') return meta & 8 ? 'oak_door_top' : 'oak_door_bottom';
  if (b.name === 'red_bed') {
    const head = (meta & 4) !== 0;
    if (face === 2) return head ? 'bed_head_top' : 'bed_foot_top';
    if (face === 3) return 'oak_planks';
    const f = meta & 3;
    const endFace = head ? FACE_OF_FACING[f] : FACE_OF_FACING[(f + 2) & 3];
    if (face === endFace) return head ? 'bed_head_end' : 'bed_foot_end';
    return head ? 'bed_head_side' : 'bed_foot_side';
  }
  if (typeof t === 'string') return t;
  if (b.axis) {
    const axis = meta & 3; // 0 = y, 1 = x, 2 = z
    const endFaces = axis === 0 ? [2, 3] : axis === 1 ? [0, 1] : [4, 5];
    return endFaces.includes(face) ? t.end : t.side;
  }
  if (face === 2) return t.top || t.side;
  if (face === 3) return t.bottom || t.top || t.side;
  if (t.front && b.facing && face === FACE_OF_FACING[meta & 3]) return t.front;
  return t.side;
}

// Quarter turns applied to a face's UVs (used for sideways logs and beds).
export function tileRotation(id, meta, face) {
  const b = BLOCKS[id];
  if (!b) return 0;
  if (b.axis) {
    const axis = meta & 3;
    if (axis === 1 && face !== 0 && face !== 1) return 1;
    if (axis === 2 && (face === 0 || face === 1)) return 1;
    if (axis === 2 && (face === 2 || face === 3)) return 0;
    if (axis === 1 && (face === 2 || face === 3)) return 1;
  }
  if (b.name === 'red_bed' && face === 2) {
    // Bed top textures are drawn with the headboard at the top of the tile.
    const f = meta & 3;
    return [2, 3, 0, 1][f];
  }
  return 0;
}

export const DYE_FOR_WOOL = WOOL_COLORS.map(([c]) => c + '_dye');
