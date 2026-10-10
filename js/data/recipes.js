// Crafting and smelting recipes.
// Shaped recipe: { pattern: ['XX', 'XX'], key: { X: 'item' | '#tag' }, result: [name, count] }
// Shapeless recipe: { shapeless: ['item', ...], result: [name, count] }
import { I, ITEMS, itemMatches, TIERS, ARMOR_MATS, ARMOR_PIECES } from './items.js';
import { WOOL_COLORS } from './blocks.js';

export const RECIPES = [];
const shaped = (pattern, key, result, count = 1) => RECIPES.push({ pattern, key, result: [result, count] });
const shapeless = (items, result, count = 1) => RECIPES.push({ shapeless: items, result: [result, count] });

// Wood
for (const w of ['oak', 'birch', 'spruce']) {
  shapeless([`${w}_log`], `${w}_planks`, 4);
}
shaped(['#', '#'], { '#': '#planks' }, 'stick', 4);
shaped(['##', '##'], { '#': '#planks' }, 'crafting_table');
shaped(['###', '# #', '###'], { '#': '#planks' }, 'chest');
shaped(['###', '# #', '###'], { '#': 'cobblestone' }, 'furnace');
shaped(['C', 'S'], { C: '#coals', S: 'stick' }, 'torch', 4);
shaped(['S S', 'SSS', 'S S'], { S: 'stick' }, 'ladder', 3);
shaped(['##', '##', '##'], { '#': '#planks' }, 'oak_door', 3);
shaped(['#S#', '#S#'], { '#': '#planks', S: 'stick' }, 'oak_fence', 3);
shaped(['S#S', 'S#S'], { '#': '#planks', S: 'stick' }, 'oak_fence_gate');
shaped(['WWW', '###'], { W: '#wool', '#': '#planks' }, 'red_bed');
shaped(['# #', ' # '], { '#': '#planks' }, 'bowl', 4);
shaped(['###', 'BBB', '###'], { '#': '#planks', B: 'book' }, 'bookshelf');
shaped(['###'], { '#': 'oak_planks' }, 'oak_slab', 6);
shaped(['#  ', '## ', '###'], { '#': 'oak_planks' }, 'oak_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'birch_planks' }, 'birch_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'spruce_planks' }, 'spruce_stairs', 4);

// Stone
shaped(['##', '##'], { '#': 'stone' }, 'stone_bricks', 4);
shaped(['##', '##'], { '#': 'sand' }, 'sandstone');
shaped(['##', '##'], { '#': 'brick' }, 'bricks');
shaped(['##', '##'], { '#': 'clay_ball' }, 'clay');
shaped(['##', '##'], { '#': 'snowball' }, 'snow_block');
shaped(['##', '##'], { '#': 'glowstone_dust' }, 'glowstone');
shaped(['###'], { '#': 'cobblestone' }, 'cobblestone_slab', 6);
shaped(['###'], { '#': 'smooth_stone' }, 'smooth_stone_slab', 6);
shaped(['###'], { '#': 'bricks' }, 'brick_slab', 6);
shaped(['###'], { '#': 'stone_bricks' }, 'stone_brick_slab', 6);
shaped(['###'], { '#': 'sandstone' }, 'sandstone_slab', 6);
shaped(['#  ', '## ', '###'], { '#': 'cobblestone' }, 'cobblestone_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'bricks' }, 'brick_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'stone_bricks' }, 'stone_brick_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'stone' }, 'stone_stairs', 4);
shaped(['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' }, 'tnt');
shapeless(['cobblestone', 'wheat_seeds'], 'mossy_cobblestone');
shapeless(['stone_bricks', 'wheat_seeds'], 'mossy_stone_bricks');

// Storage blocks
for (const [ingot, block] of [['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'], ['diamond', 'diamond_block'], ['coal', 'coal_block'], ['lapis_lazuli', 'lapis_block'], ['wheat', 'hay_block']]) {
  shaped(['###', '###', '###'], { '#': ingot }, block);
  shapeless([block], ingot, 9);
}

// Tools and weapons
const TOOL_MAT_ING = { wooden: '#planks', stone: 'cobblestone', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const mat of Object.keys(TIERS)) {
  const m = TOOL_MAT_ING[mat];
  shaped(['XXX', ' S ', ' S '], { X: m, S: 'stick' }, `${mat}_pickaxe`);
  shaped(['XX', 'XS', ' S'], { X: m, S: 'stick' }, `${mat}_axe`);
  shaped(['X', 'S', 'S'], { X: m, S: 'stick' }, `${mat}_shovel`);
  shaped(['XX', ' S', ' S'], { X: m, S: 'stick' }, `${mat}_hoe`);
  shaped(['X', 'X', 'S'], { X: m, S: 'stick' }, `${mat}_sword`);
}
shaped([' I', 'I '], { I: 'iron_ingot' }, 'shears');
shapeless(['iron_ingot', 'flint'], 'flint_and_steel');
shaped(['I I', ' I '], { I: 'iron_ingot' }, 'bucket');
shaped([' S#', 'S #', ' S#'], { S: 'stick', '#': 'string' }, 'bow');
shaped(['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' }, 'arrow', 4);

// Armor
const ARMOR_ING = { leather: 'leather', golden: 'gold_ingot', iron: 'iron_ingot', diamond: 'diamond' };
const ARMOR_PATTERNS = [['XXX', 'X X'], ['X X', 'XXX', 'XXX'], ['XXX', 'X X', 'X X'], ['X X', 'X X']];
for (const mat of Object.keys(ARMOR_MATS)) {
  ARMOR_PIECES.forEach((piece, i) => shaped(ARMOR_PATTERNS[i], { X: ARMOR_ING[mat] }, `${mat}_${piece}`));
}

// Food
shaped(['WWW'], { W: 'wheat' }, 'bread');
shapeless(['bowl', 'brown_mushroom', 'red_mushroom'], 'mushroom_stew');
shaped(['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' }, 'golden_apple');
shapeless(['pumpkin', 'sugar', 'egg'], 'pumpkin_pie');
shapeless(['sugar_cane'], 'sugar');
shaped(['###'], { '#': 'sugar_cane' }, 'paper', 3);
shapeless(['paper', 'paper', 'paper', 'leather'], 'book');
shapeless(['pumpkin', 'torch'], 'jack_o_lantern');

// Dyes and wool
shapeless(['bone'], 'bone_meal', 3);
shapeless(['dandelion'], 'yellow_dye');
shapeless(['poppy'], 'red_dye');
shapeless(['cornflower'], 'lapis_lazuli'); // cornflower gives blue dye (lapis doubles as blue)
shapeless(['oxeye_daisy'], 'light_gray_dye');
shapeless(['red_dye', 'yellow_dye'], 'orange_dye', 2);
shapeless(['red_dye', 'bone_meal'], 'pink_dye', 2);
shapeless(['lapis_lazuli', 'bone_meal'], 'light_blue_dye', 2);
shapeless(['green_dye', 'bone_meal'], 'lime_dye', 2);
shapeless(['lapis_lazuli', 'green_dye'], 'cyan_dye', 2);
shapeless(['lapis_lazuli', 'red_dye'], 'purple_dye', 2);
shapeless(['purple_dye', 'pink_dye'], 'magenta_dye', 2);
shapeless(['black_dye', 'bone_meal'], 'gray_dye', 2);
shapeless(['gray_dye', 'bone_meal'], 'light_gray_dye', 2);
shapeless(['coal', 'coal'], 'black_dye');
shapeless(['dirt', 'bone_meal'], 'brown_dye');
shaped(['SS', 'SS'], { S: 'string' }, 'white_wool');
for (const [c] of WOOL_COLORS) {
  if (c === 'white') continue;
  const dye = c === 'blue' ? 'lapis_lazuli' : `${c}_dye`;
  shapeless([dye, 'white_wool'], `${c}_wool`);
}

// Drop any recipe that references an item which does not exist (keeps the
// list honest if something is renamed).
for (let i = RECIPES.length - 1; i >= 0; i--) {
  const r = RECIPES[i];
  const names = r.shapeless ? r.shapeless : Object.values(r.key);
  const ok = I[r.result[0]] !== undefined && names.every((n) => n.startsWith('#') || I[n] !== undefined);
  if (!ok) {
    console.warn('Dropping recipe with unknown item', r);
    RECIPES.splice(i, 1);
  }
}

// grid: array of stacks (or null), size w*h. Returns { result, recipe } or null.
export function matchRecipe(grid, w, h) {
  // Bounding box of non-empty cells
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y * w + x]) {
        count++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!count) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const cell = (x, y) => grid[(y + minY) * w + (x + minX)];

  for (const r of RECIPES) {
    if (r.shapeless) {
      if (r.shapeless.length !== count) continue;
      const remaining = r.shapeless.slice();
      let ok = true;
      for (const s of grid) {
        if (!s) continue;
        const idx = remaining.findIndex((ing) => itemMatches(s.id, ing));
        if (idx < 0) { ok = false; break; }
        remaining.splice(idx, 1);
      }
      if (ok && remaining.length === 0) return { result: r.result, recipe: r };
      continue;
    }
    const ph = r.pattern.length;
    const pw = Math.max(...r.pattern.map((l) => l.length));
    if (pw !== bw || ph !== bh) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < ph && ok; y++) {
        for (let x = 0; x < pw && ok; x++) {
          const px = mirror ? pw - 1 - x : x;
          const ch = r.pattern[y][px] || ' ';
          const s = cell(x, y);
          if (ch === ' ') {
            if (s) ok = false;
          } else if (!s || !itemMatches(s.id, r.key[ch])) ok = false;
        }
      }
      if (ok) return { result: r.result, recipe: r };
    }
  }
  return null;
}

// ---- Smelting ----
export const SMELTING = {
  iron_ore: ['iron_ingot', 0.7],
  gold_ore: ['gold_ingot', 1.0],
  sand: ['glass', 0.1],
  cobblestone: ['stone', 0.1],
  stone: ['smooth_stone', 0.1],
  stone_bricks: ['cracked_stone_bricks', 0.1],
  clay_ball: ['brick', 0.3],
  clay: ['bricks', 0.3],
  oak_log: ['charcoal', 0.15],
  birch_log: ['charcoal', 0.15],
  spruce_log: ['charcoal', 0.15],
  cactus: ['green_dye', 1],
  porkchop: ['cooked_porkchop', 0.35],
  beef: ['cooked_beef', 0.35],
  chicken: ['cooked_chicken', 0.35],
  mutton: ['cooked_mutton', 0.35],
  potato: ['baked_potato', 0.35],
  diamond_ore: ['diamond', 1.0],
  coal_ore: ['coal', 0.1],
  lapis_ore: ['lapis_lazuli', 0.2],
};

export function smeltResult(id) {
  const d = ITEMS[id];
  if (!d) return null;
  return SMELTING[d.name] || null;
}

export function fuelValue(id) {
  const d = ITEMS[id];
  return d ? d.fuel || 0 : 0;
}
