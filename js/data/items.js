// Item registry. Ids 1-255 are block items (same id as the block they place),
// ids from 256 are plain items. Saves store items by name so ids can shift.
import { BLOCKS, B, WOOL_COLORS } from './blocks.js';

export const ITEMS = [];
export const I = {}; // name -> id

const ITEM_DEFAULTS = {
  maxStack: 64,
  tab: 'materials',
  durability: 0,
  damage: 1, // attack damage
  tool: null, // { type, tier, speed }
  food: null, // { hunger, sat }
  armor: null, // { slot, points, material }
  fuel: 0,
  use: null,
  block: 0,
};

function add(id, name, display, props = {}) {
  const def = Object.assign({}, ITEM_DEFAULTS, props, { id, name, display });
  if (!def.icon) def.icon = { sprite: name };
  ITEMS[id] = def;
  I[name] = id;
  return def;
}

// ---- Block items ----
const BLOCK_ITEM_FUEL = {
  oak_planks: 300, birch_planks: 300, spruce_planks: 300, oak_log: 300, birch_log: 300, spruce_log: 300,
  crafting_table: 300, bookshelf: 300, chest: 300, oak_fence: 300, oak_fence_gate: 300, ladder: 300,
  oak_stairs: 300, spruce_stairs: 300, birch_stairs: 300, oak_slab: 150, coal_block: 16000,
  oak_sapling: 100, birch_sapling: 100, spruce_sapling: 100, white_wool: 100,
};
for (const b of BLOCKS) {
  if (!b || b.id === 0 || b.noItem) continue;
  const icon = ['cross', 'torch', 'ladder'].includes(b.shape) ? { tile: typeof b.tex === 'string' ? b.tex : b.name } : { block: b.id };
  add(b.id, b.name, b.display, {
    block: b.id,
    tab: b.tab,
    icon,
    fuel: BLOCK_ITEM_FUEL[b.name] || (b.wool ? 100 : 0),
  });
}

let nextId = 256;
function item(name, display, props) {
  return add(nextId++, name, display, props);
}

// ---- Materials ----
item('stick', 'Stick', { fuel: 100 });
item('coal', 'Coal', { fuel: 1600 });
item('charcoal', 'Charcoal', { fuel: 1600 });
item('diamond', 'Diamond');
item('iron_ingot', 'Iron Ingot');
item('gold_ingot', 'Gold Ingot');
item('lapis_lazuli', 'Lapis Lazuli');
item('flint', 'Flint');
item('string', 'String');
item('feather', 'Feather');
item('leather', 'Leather');
item('bone', 'Bone');
item('bone_meal', 'Bone Meal', { use: 'bone_meal' });
item('wheat', 'Wheat');
item('wheat_seeds', 'Wheat Seeds', { use: 'plant', plants: 'wheat' });
item('sugar', 'Sugar');
item('paper', 'Paper');
item('book', 'Book');
item('brick', 'Brick');
item('clay_ball', 'Clay Ball');
item('glowstone_dust', 'Glowstone Dust');
item('snowball', 'Snowball', { maxStack: 16, use: 'throw' });
item('gunpowder', 'Gunpowder');
item('rotten_flesh', 'Rotten Flesh', { tab: 'food', food: { hunger: 4, sat: 0.8, hungerEffect: 0.8 } });
item('egg', 'Egg', { maxStack: 16, use: 'throw' });
item('bowl', 'Bowl', { fuel: 100 });

// Dyes, one per wool colour. Lapis lazuli and bone meal act as blue/white dye too.
for (const [c, d] of WOOL_COLORS) {
  if (c === 'blue' || c === 'white') continue;
  item(c + '_dye', d + ' Dye');
}

// ---- Food ----
const food = (hunger, sat, extra = {}) => Object.assign({ tab: 'food', food: Object.assign({ hunger, sat }, extra) });
item('apple', 'Apple', food(4, 2.4));
item('golden_apple', 'Golden Apple', food(4, 9.6, { always: true, regen: 100 }));
item('bread', 'Bread', food(5, 6));
item('porkchop', 'Raw Porkchop', food(3, 1.8));
item('cooked_porkchop', 'Cooked Porkchop', food(8, 12.8));
item('beef', 'Raw Beef', food(3, 1.8));
item('cooked_beef', 'Steak', food(8, 12.8));
item('chicken', 'Raw Chicken', food(2, 1.2, { hungerEffect: 0.3 }));
item('cooked_chicken', 'Cooked Chicken', food(6, 7.2));
item('mutton', 'Raw Mutton', food(2, 1.2));
item('cooked_mutton', 'Cooked Mutton', food(6, 9.6));
item('carrot', 'Carrot', Object.assign(food(3, 3.6), { use: 'plant', plants: 'carrots' }));
item('potato', 'Potato', Object.assign(food(1, 0.6), { use: 'plant', plants: 'potatoes' }));
item('baked_potato', 'Baked Potato', food(5, 6));
item('melon_slice', 'Melon Slice', food(2, 1.2));
item('cookie', 'Cookie', food(2, 0.4));
item('mushroom_stew', 'Mushroom Stew', Object.assign(food(6, 7.2, { returns: 'bowl' }), { maxStack: 1 }));
item('pumpkin_pie', 'Pumpkin Pie', food(8, 4.8));

// ---- Tools ----
export const TIERS = {
  wooden: { tier: 0, speed: 2, durability: 59, bonus: 0, repair: 'planks', label: 'Wooden' },
  stone: { tier: 1, speed: 4, durability: 131, bonus: 1, repair: 'cobblestone', label: 'Stone' },
  iron: { tier: 2, speed: 6, durability: 250, bonus: 2, repair: 'iron_ingot', label: 'Iron' },
  golden: { tier: 0, speed: 12, durability: 32, bonus: 0, repair: 'gold_ingot', label: 'Golden' },
  diamond: { tier: 3, speed: 8, durability: 1561, bonus: 3, repair: 'diamond', label: 'Diamond' },
};
const TOOL_BASE = { sword: 5, axe: 4, pickaxe: 3, shovel: 2, hoe: 1 };
const TOOL_LABEL = { sword: 'Sword', axe: 'Axe', pickaxe: 'Pickaxe', shovel: 'Shovel', hoe: 'Hoe' };
for (const [mat, t] of Object.entries(TIERS)) {
  for (const type of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) {
    item(`${mat}_${type}`, `${t.label} ${TOOL_LABEL[type]}`, {
      maxStack: 1,
      tab: type === 'sword' ? 'combat' : 'tools',
      durability: t.durability,
      damage: type === 'hoe' ? 1 : TOOL_BASE[type] + t.bonus,
      tool: { type, tier: t.tier, speed: t.speed, material: mat },
      fuel: mat === 'wooden' ? 200 : 0,
      use: type === 'hoe' ? 'hoe' : null,
      icon: { sprite: type, material: mat },
    });
  }
}
item('shears', 'Shears', { maxStack: 1, tab: 'tools', durability: 238, tool: { type: 'shears', tier: 0, speed: 1.5 }, use: 'shears' });
item('flint_and_steel', 'Flint and Steel', { maxStack: 1, tab: 'tools', durability: 64, use: 'ignite' });
item('bucket', 'Bucket', { maxStack: 16, tab: 'tools', use: 'bucket' });
item('water_bucket', 'Water Bucket', { maxStack: 1, tab: 'tools', use: 'bucket', fluid: 'water' });
item('lava_bucket', 'Lava Bucket', { maxStack: 1, tab: 'tools', use: 'bucket', fluid: 'lava', fuel: 20000 });
item('milk_bucket', 'Milk Bucket', { maxStack: 1, tab: 'food', use: 'drink', food: { hunger: 0, sat: 0, always: true, returns: 'bucket', milk: true } });
item('bow', 'Bow', { maxStack: 1, tab: 'combat', durability: 384, use: 'bow', fuel: 300 });
item('arrow', 'Arrow', { tab: 'combat' });
item('oak_door', 'Oak Door', { tab: 'decoration', use: 'door', fuel: 200 });
item('red_bed', 'Red Bed', { maxStack: 1, tab: 'decoration', use: 'bed' });

// ---- Armor ----
export const ARMOR_MATS = {
  leather: { points: [1, 3, 2, 1], mult: 5, label: 'Leather' },
  golden: { points: [2, 5, 3, 1], mult: 7, label: 'Golden' },
  iron: { points: [2, 6, 5, 2], mult: 15, label: 'Iron' },
  diamond: { points: [3, 8, 6, 3], mult: 33, label: 'Diamond' },
};
export const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR_LABEL = ['Cap', 'Tunic', 'Pants', 'Boots'];
const ARMOR_BASE = [11, 16, 15, 13];
for (const [mat, a] of Object.entries(ARMOR_MATS)) {
  ARMOR_PIECES.forEach((piece, slot) => {
    const label = mat === 'leather' ? `Leather ${ARMOR_LABEL[slot]}` : `${a.label} ${piece[0].toUpperCase() + piece.slice(1)}`;
    item(`${mat}_${piece}`, label, {
      maxStack: 1,
      tab: 'combat',
      durability: ARMOR_BASE[slot] * a.mult,
      armor: { slot, points: a.points[slot], material: mat },
      icon: { sprite: piece, material: mat },
    });
  });
}

export function itemDef(id) {
  return ITEMS[id] || null;
}

export function itemByName(name) {
  const id = I[name];
  return id === undefined ? null : ITEMS[id];
}

export function maxStack(id) {
  const d = ITEMS[id];
  return d ? d.maxStack : 64;
}

export function makeStack(nameOrId, count = 1, dmg = 0) {
  const id = typeof nameOrId === 'number' ? nameOrId : I[nameOrId];
  if (id === undefined || !ITEMS[id]) return null;
  return { id, count, dmg };
}

export function stackDisplayName(stack) {
  const d = ITEMS[stack.id];
  return d ? d.display : 'Unknown';
}

// Tags group interchangeable ingredients (any planks, any log, ...)
export const TAGS = {
  planks: ['oak_planks', 'birch_planks', 'spruce_planks'],
  logs: ['oak_log', 'birch_log', 'spruce_log'],
  wool: WOOL_COLORS.map(([c]) => c + '_wool'),
  coals: ['coal', 'charcoal'],
  stone_tool_material: ['cobblestone'],
};

export function itemMatches(id, ingredient) {
  if (ingredient.startsWith('#')) {
    const list = TAGS[ingredient.slice(1)];
    return list ? list.some((n) => I[n] === id) : false;
  }
  return I[ingredient] === id;
}

export const BLOCK_ID = B;
