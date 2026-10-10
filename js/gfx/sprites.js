// 16x16 item sprites. Most are hand-drawn ASCII templates with a palette;
// tools are drawn procedurally so every material shares one silhouette.
import { Tile, mul } from './tiles.js';

const OUT = [34, 28, 24];

// Template helper: '.' is transparent, other chars come from the palette.
function tpl(rows, pal) {
  const t = new Tile();
  t.fill([0, 0, 0], 0);
  for (let y = 0; y < 16; y++) {
    const row = (rows[y] || '').padEnd(16, '.');
    for (let x = 0; x < 16; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const c = pal[ch] || OUT;
      t.set(x, y, c);
    }
  }
  return t;
}

function outline(t, color = OUT) {
  const add = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (t.alpha(x, y)) continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < 16 && ny < 16 && t.alpha(nx, ny) && !t._outline?.has(ny * 16 + nx);
      });
      if (n) add.push([x, y]);
    }
  }
  for (const [x, y] of add) t.set(x, y, color);
}

const MATS = {
  wooden: [[186, 148, 90], [150, 116, 64], [104, 78, 40]],
  stone: [[170, 170, 170], [130, 130, 130], [86, 86, 86]],
  iron: [[252, 252, 252], [216, 216, 216], [150, 150, 156]],
  golden: [[255, 248, 160], [246, 208, 60], [190, 140, 20]],
  diamond: [[204, 255, 250], [84, 224, 212], [34, 146, 146]],
  leather: [[196, 132, 86], [160, 101, 64], [112, 66, 38]],
};
const STICK = [137, 103, 48];
const STICK_D = [96, 70, 32];

function shadeSet(t, pts, mat) {
  const set = new Set(pts.map(([x, y]) => y * 16 + x));
  const has = (x, y) => set.has(y * 16 + x);
  for (const [x, y] of pts) {
    let c = mat[1];
    if (!has(x, y - 1) || !has(x - 1, y)) c = mat[0];
    if (!has(x, y + 1) || !has(x + 1, y)) c = mat[2];
    if ((!has(x, y - 1) || !has(x - 1, y)) && (!has(x, y + 1) || !has(x + 1, y))) c = mat[1];
    t.set(x, y, c);
  }
}

function handle(t, from, to) {
  for (let i = from; i <= to; i++) t.set(2 + i, 13 - i, i % 2 ? STICK_D : STICK);
}

function drawTool(type, material) {
  const m = MATS[material] || MATS.iron;
  const t = new Tile();
  t.fill([0, 0, 0], 0);
  if (type === 'sword') {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const s = x + y;
        if (y < 1 || y > 9 || x < 5) continue;
        if (s === 14) t.set(x, y, m[0]);
        else if (s === 15) t.set(x, y, m[1]);
        else if (s === 16 && y > 1) t.set(x, y, m[2]);
      }
    }
    t.set(14, 0, m[0]);
    t.set(15, 0, m[1]);
    const guard = material === 'wooden' ? [90, 64, 30] : mul(m[2], 0.9);
    for (let k = -2; k <= 2; k++) t.set(5 + k, 10 + k, guard);
    t.set(4, 11, STICK);
    t.set(3, 12, STICK_D);
    t.set(2, 13, STICK);
    t.set(1, 14, guard);
  } else if (type === 'pickaxe') {
    handle(t, 0, 8);
    const outer = [[4, 2], [5, 1], [6, 1], [7, 1], [8, 1], [9, 2], [10, 2], [11, 3], [12, 4], [13, 5], [13, 6], [14, 7], [14, 8], [14, 9], [14, 10], [13, 11]];
    const inner = [[5, 2], [6, 2], [7, 2], [8, 2], [9, 3], [10, 3], [11, 4], [12, 5], [12, 6], [13, 7], [13, 8], [13, 9], [13, 10]];
    for (const [x, y] of outer) t.set(x, y, m[0]);
    for (const [x, y] of inner) t.set(x, y, m[1]);
    for (const [x, y] of [[4, 2], [13, 11], [4, 3], [12, 11]]) t.set(x, y, m[2]);
  } else if (type === 'axe') {
    handle(t, 0, 10);
    const pts = [];
    const rows = { 1: [6, 8], 2: [5, 9], 3: [5, 10], 4: [5, 10], 5: [6, 9], 6: [7, 8] };
    for (const [y, [a, b]] of Object.entries(rows)) for (let x = a; x <= b; x++) pts.push([x, +y]);
    shadeSet(t, pts, m);
  } else if (type === 'shovel') {
    handle(t, 0, 7);
    const pts = [];
    const rows = { 1: [12, 13], 2: [11, 14], 3: [10, 14], 4: [9, 13], 5: [9, 12], 6: [10, 11] };
    for (const [y, [a, b]] of Object.entries(rows)) for (let x = a; x <= b; x++) pts.push([x, +y]);
    shadeSet(t, pts, m);
  } else if (type === 'hoe') {
    handle(t, 0, 9);
    const pts = [[8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [7, 3], [8, 3], [12, 3], [13, 3], [7, 4]];
    shadeSet(t, pts, m);
  }
  outline(t);
  return t;
}

const ARMOR_TPL = {
  helmet: [
    '................',
    '................',
    '................',
    '....KKKKKKKK....',
    '...KLLHHHHHHK...',
    '..KLHHHHHHHHDK..',
    '..KHHHHHHHHHDK..',
    '..KHHKKKKKKHDK..',
    '..KHDK....KHDK..',
    '..KKK......KKK..',
  ],
  chestplate: [
    '................',
    '..KKK......KKK..',
    '.KLHHKKKKKKHHDK.',
    '.KLHHHHHHHHHHDK.',
    '.KHHHHHHHHHHHDK.',
    '.KKKKLHHHHHDKKK.',
    '....KLHHHHHDK...',
    '....KLHHHHHDK...',
    '....KLHHHHHDK...',
    '....KLHHHHHDK...',
    '....KHHHHHHDK...',
    '....KKKKKKKKK...',
  ],
  leggings: [
    '................',
    '................',
    '...KKKKKKKKKK...',
    '...KLHHHHHHDK...',
    '...KLHHHHHHDK...',
    '...KLHHKKHHDK...',
    '...KLHK..KHDK...',
    '...KLHK..KHDK...',
    '...KLHK..KHDK...',
    '...KLHK..KHDK...',
    '...KLHK..KHDK...',
    '...KKKK..KKKK...',
  ],
  boots: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '...KKKK..KKKK...',
    '...KLHK..KHDK...',
    '...KLHK..KHDK...',
    '..KLHHK..KHHDK..',
    '..KHHHK..KHHHK..',
    '..KKKKK..KKKKK..',
  ],
};

function drawArmor(piece, material) {
  const m = MATS[material] || MATS.iron;
  return tpl(ARMOR_TPL[piece], { K: mul(m[2], 0.45), L: m[0], H: m[1], D: m[2] });
}

const LUMP = [
  '................',
  '................',
  '................',
  '......KKK.......',
  '....KKgGGKK.....',
  '...KgGGGGGDK....',
  '...KGGgGGGDK....',
  '..KGGGGGGGGDK...',
  '..KGGGGGGGDDK...',
  '..KDGGGGGDDK....',
  '...KDDGGDDK.....',
  '....KKDDDK......',
  '......KKK.......',
];
const PILE = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......KK.......',
  '......KWWK......',
  '.....KWgWLK.....',
  '....KWWWWWLK....',
  '...KWWgWWWLLK...',
  '..KWWWWWWgWLLK..',
  '..KKKKKKKKKKKK..',
];
const BALL = [
  '................',
  '................',
  '................',
  '................',
  '......KKKK......',
  '....KKLLCCKK....',
  '...KLLCCCCCCK...',
  '...KLCCCCCCDK...',
  '...KCCCCCCCDK...',
  '...KCCCCCCDDK...',
  '....KCCCCDDK....',
  '.....KKKKKK.....',
];
const DYE = [
  '................',
  '................',
  '......KKKK......',
  '.....KWWWWK.....',
  '......KCCK......',
  '.....KCCCCK.....',
  '....KLCCCCCK....',
  '...KLCCCCCCDK...',
  '...KCCCCCCCDK...',
  '...KCCCCCCDDK...',
  '....KCCCCDDK....',
  '.....KKKKKK.....',
];
const MEAT = [
  '................',
  '................',
  '................',
  '.....KKKKKK.....',
  '...KKMMMMMMKK...',
  '..KMLMMMMMMMMK..',
  '.KMLMMFFMMMMMDK.',
  '.KMMMFFFFMMMMDK.',
  '.KMMMMFFMMMMDDK.',
  '..KMMMMMMMMDDK..',
  '...KKMMMMDDKWK..',
  '.....KKKKKKWWK..',
  '..........KWK...',
  '...........K....',
];
const DRUMSTICK = [
  '................',
  '................',
  '....KKKKK.......',
  '...KMMMMMK......',
  '..KMLMMMMMK.....',
  '..KMMMMMMMMK....',
  '..KMMMFMMMMK....',
  '..KMMMMMMMDK....',
  '...KMMMMMDDK....',
  '....KMMDDDKK....',
  '.....KKKKWK.....',
  '.........KWK....',
  '..........KWWK..',
  '..........KWWK..',
  '...........KK...',
];
const BUCKET = [
  '................',
  '.....KKKKKK.....',
  '....K......K....',
  '...K........K...',
  '..KKKKKKKKKKKK..',
  '..KIIIIIIIIIIK..',
  '..KLWWWWWWWWDK..',
  '...KLWWWWWWDK...',
  '...KLWWWWWWDK...',
  '...KLWWWWWWDK...',
  '....KLWWWWDK....',
  '....KLWWWWDK....',
  '.....KKKKKK.....',
];
const APPLE = [
  '................',
  '........K.......',
  '.......KSK.KK...',
  '........KKLLK...',
  '....KKKKKKKK....',
  '...KRRRRRRRRK...',
  '..KRWRRRRRRRDK..',
  '..KRWRRRRRRRDK..',
  '..KRRRRRRRRRDK..',
  '..KRRRRRRRRDDK..',
  '..KRRRRRRRRDDK..',
  '...KRRRRRRDDK...',
  '....KRRKKRDK....',
  '.....KK..KK.....',
];
const BOWL = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..KKKKKKKKKKKK..',
  '..KIIIIIIIIIIK..',
  '..KBBBBBBBBBBK..',
  '...KBBBBBBBBK...',
  '....KDBBBBDK....',
  '.....KKKKKK.....',
];

const T = {};
T.coal = () => tpl(LUMP, { K: [16, 16, 16], D: [34, 34, 34], G: [56, 56, 58], g: [100, 100, 104] });
T.charcoal = () => tpl(LUMP, { K: [20, 16, 12], D: [40, 32, 24], G: [62, 50, 38], g: [104, 88, 70] });
T.lapis_lazuli = () => tpl(LUMP, { K: [14, 26, 70], D: [26, 52, 140], G: [40, 80, 190], g: [120, 160, 240] });
T.diamond = () => tpl([
  '................',
  '................',
  '....KKKKKKKK....',
  '...KWLLWLLLLK...',
  '..KLWLLLLLLDDK..',
  '.KLLLLLLLLLLDDK.',
  '.KDLLLLLLLLLDDK.',
  '..KDLLLLLLLDDK..',
  '...KDLLLLLDDK...',
  '....KDLLLDDK....',
  '.....KDLDDK.....',
  '......KDDK......',
  '.......KK.......',
], { K: [14, 70, 70], W: [230, 255, 255], L: [96, 232, 222], D: [40, 166, 162] });
const INGOT = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '....KKKKKKKKK...',
  '...KWLLLLLLLLK..',
  '..KLLLLLLLLLLDK.',
  '.KLLLLLLLLLLDDK.',
  '.KDDDDDDDDDDDDK.',
  '.KKKKKKKKKKKKKK.',
];
T.iron_ingot = () => tpl(INGOT, { K: [60, 60, 64], W: [255, 255, 255], L: [222, 222, 222], D: [150, 150, 156] });
T.gold_ingot = () => tpl(INGOT, { K: [110, 70, 10], W: [255, 255, 200], L: [250, 214, 70], D: [196, 140, 20] });
T.brick = () => tpl(INGOT, { K: [60, 24, 16], W: [210, 120, 96], L: [170, 82, 60], D: [120, 54, 40] });
T.flint = () => tpl([
  '................',
  '................',
  '.......KK.......',
  '......KDGK......',
  '.....KDGgGK.....',
  '....KDGGgGGK....',
  '....KDGGGGGK....',
  '...KDDGGGGGGK...',
  '...KDGGGGGGGK...',
  '...KDDGGGGGDK...',
  '....KDDGGGDDK...',
  '.....KKDDDKK....',
  '.......KKK......',
], { K: [16, 16, 18], D: [36, 36, 40], G: [70, 70, 76], g: [130, 130, 140] });
T.string = () => tpl([
  '................',
  '................',
  '...........WW...',
  '..........W..W..',
  '.........W...W..',
  '........W...W...',
  '.......W...W....',
  '......W...W.....',
  '.....W...W......',
  '....W...W.......',
  '...W...W........',
  '...W..W.........',
  '....WW..........',
], { W: [236, 236, 236] });
T.feather = () => tpl([
  '................',
  '............KK..',
  '...........KWWK.',
  '..........KWWWK.',
  '.........KWWWWK.',
  '........KWWWWK..',
  '.......KWWWLK...',
  '......KWWWLK....',
  '.....KWWWLK.....',
  '....KWWLLK......',
  '...KWLLKK.......',
  '...KLKK.........',
  '..KQK...........',
  '.KQK............',
  '.KK.............',
], { K: [90, 90, 96], W: [246, 246, 246], L: [200, 200, 206], Q: [210, 190, 150] });
T.leather = () => tpl([
  '................',
  '................',
  '...KKKKKKKKKK...',
  '..KLBBBBBBBBDK..',
  '..KBBBBBBBBBDK..',
  '...KBBBBBBBBDK..',
  '...KBBBBBBBBK...',
  '..KBBBBBBBBBDK..',
  '..KBBBBBBBBBDK..',
  '..KLBBBBBBBDDK..',
  '...KBBBBBBDDK...',
  '...KKKKKKKKKK...',
], { K: [60, 34, 18], L: [190, 120, 70], B: [156, 92, 52], D: [110, 62, 32] });
T.bone = () => tpl([
  '................',
  '...........KK...',
  '..........KWWK..',
  '.........KWWWWK.',
  '..........KWWDK.',
  '.........KWWDK..',
  '........KWWDK...',
  '.......KWWDK....',
  '......KWWDK.....',
  '.....KWWDK......',
  '....KWWDK.......',
  '...KWWDK........',
  '.KWWWDK.........',
  'KWWWWK..........',
  '.KWWK...........',
  '..KK............',
], { K: [90, 86, 74], W: [240, 236, 222], D: [196, 190, 170] });
T.bone_meal = () => tpl(PILE, { K: [120, 120, 130], W: [246, 246, 250], L: [210, 210, 220], g: [230, 230, 236] });
T.sugar = () => tpl(PILE, { K: [140, 140, 150], W: [255, 255, 255], L: [220, 220, 230], g: [200, 200, 210] });
T.glowstone_dust = () => tpl(PILE, { K: [130, 90, 30], W: [255, 226, 120], L: [230, 170, 60], g: [255, 250, 200] });
T.gunpowder = () => tpl(PILE, { K: [40, 40, 40], W: [110, 110, 110], L: [80, 80, 80], g: [150, 150, 150] });
T.wheat = () => tpl([
  '................',
  '..........K.....',
  '.........KYK....',
  '....K...KYYK....',
  '...KYK..KYK..K..',
  '...KYYK.KYK.KYK.',
  '....KYYKKYKKYYK.',
  '.....KYYKYKYYK..',
  '......KYYYYYK...',
  '.......KGGGK....',
  '.......KGGK.....',
  '......KGGGK.....',
  '......KGKGK.....',
  '.....KGK.KGK....',
  '.....KK...KK....',
], { K: [90, 70, 20], Y: [222, 196, 90], G: [170, 160, 60] });
T.wheat_seeds = () => tpl([
  '................',
  '................',
  '................',
  '......K....K....',
  '.....KSK..KSK...',
  '......K....K....',
  '..K......K......',
  '.KSK....KSK.....',
  '..K......K......',
  '.......K....K...',
  '......KSK..KSK..',
  '.......K....K...',
], { K: [50, 80, 20], S: [140, 190, 70] });
T.paper = () => tpl([
  '................',
  '................',
  '...KKKKKKKKKK...',
  '...KWWWWWWWWK...',
  '...KWLLLLLLWK...',
  '...KWWWWWWWWK...',
  '...KWLLLLLWWK...',
  '...KWWWWWWWWK...',
  '...KWLLLLLLWK...',
  '...KWWWWWWWWK...',
  '...KWLLLLWWWK...',
  '...KWWWWWWWWK...',
  '...KKKKKKKKKK...',
], { K: [120, 120, 110], W: [246, 244, 236], L: [190, 190, 186] });
T.book = () => tpl([
  '................',
  '................',
  '....KKKKKKKKKK..',
  '...KBBBBBBBBBK..',
  '..KBBBBBBBBBKWK.',
  '..KBBBBBBBBBKWK.',
  '..KBBGGGGBBBKWK.',
  '..KBBBBBBBBBKWK.',
  '..KBBBBBBBBBKWK.',
  '..KBBBBBBBBBKWK.',
  '..KBBBBBBBBBKWK.',
  '..KKKKKKKKKKWWK.',
  '...KWWWWWWWWWK..',
  '....KKKKKKKKKK..',
], { K: [50, 26, 14], B: [120, 66, 36], G: [220, 190, 80], W: [236, 232, 220] });
T.clay_ball = () => tpl(BALL, { K: [80, 84, 96], L: [200, 204, 214], C: [160, 166, 180], D: [120, 126, 140] });
T.snowball = () => tpl(BALL, { K: [140, 150, 170], L: [255, 255, 255], C: [240, 246, 252], D: [200, 214, 228] });
T.egg = () => tpl([
  '................',
  '................',
  '................',
  '......KKKK......',
  '.....KWWWWK.....',
  '....KWWWWWWK....',
  '....KWWWWWLK....',
  '...KWWWWWWWLK...',
  '...KWWWWWWWLK...',
  '...KWWWWWWLLK...',
  '....KWWWWLLK....',
  '.....KKKKKK.....',
], { K: [140, 120, 90], W: [246, 232, 204], L: [214, 196, 160] });
T.rotten_flesh = () => tpl([
  '................',
  '................',
  '....KKKK........',
  '...KRRGRK.......',
  '..KRGGRRRKK.....',
  '..KRRRRGGRRK....',
  '...KRGRRRRRRK...',
  '....KKRRGRRRRK..',
  '......KRRRGGRK..',
  '.......KRRRRK...',
  '........KKKK....',
], { K: [50, 30, 20], R: [150, 76, 50], G: [100, 120, 50] });
T.bowl = () => tpl(BOWL, { K: [60, 40, 20], I: [70, 50, 26], B: [150, 110, 60], D: [110, 76, 40] });
T.mushroom_stew = () => tpl(BOWL, { K: [60, 40, 20], I: [190, 140, 90], B: [150, 110, 60], D: [110, 76, 40] });
T.apple = () => tpl(APPLE, { K: [70, 14, 14], S: [100, 70, 30], L: [70, 160, 50], R: [220, 30, 30], W: [255, 160, 160], D: [160, 20, 20] });
T.golden_apple = () => tpl(APPLE, { K: [110, 70, 10], S: [100, 70, 30], L: [70, 160, 50], R: [250, 210, 60], W: [255, 255, 200], D: [200, 150, 20] });
T.bread = () => tpl([
  '................',
  '................',
  '................',
  '................',
  '.....KKKKKK.....',
  '...KKCCCCCCKK...',
  '..KCCLCCLCCLCK..',
  '.KCCLCCLCCLCCDK.',
  '.KCCCCCCCCCCDDK.',
  '.KBCCCCCCCCDDBK.',
  '..KBBBBBBBBBBK..',
  '...KKKKKKKKKK...',
], { K: [80, 46, 14], C: [196, 136, 60], L: [236, 196, 120], D: [150, 96, 40], B: [120, 70, 26] });
const raw = (m, l, f, d) => ({ K: mul(d, 0.5), M: m, L: l, F: f, D: d, W: [240, 236, 220] });
T.porkchop = () => tpl(MEAT, raw([240, 140, 140], [255, 190, 190], [255, 220, 220], [200, 100, 100]));
T.cooked_porkchop = () => tpl(MEAT, raw([190, 120, 70], [220, 160, 100], [240, 210, 160], [140, 80, 40]));
T.beef = () => tpl(MEAT, raw([200, 50, 46], [236, 100, 90], [240, 220, 220], [150, 30, 30]));
T.cooked_beef = () => tpl(MEAT, raw([120, 70, 40], [160, 100, 60], [200, 160, 120], [80, 44, 22]));
T.mutton = () => tpl(MEAT, raw([210, 70, 60], [240, 120, 110], [250, 236, 230], [160, 40, 36]));
T.cooked_mutton = () => tpl(MEAT, raw([150, 90, 56], [190, 130, 80], [230, 200, 160], [100, 60, 32]));
T.chicken = () => tpl(DRUMSTICK, raw([246, 196, 176], [255, 226, 210], [255, 240, 230], [210, 150, 130]));
T.cooked_chicken = () => tpl(DRUMSTICK, raw([210, 150, 80], [236, 190, 120], [250, 220, 160], [160, 100, 46]));
T.carrot = () => tpl([
  '................',
  '...........KK.K.',
  '..........KGGKGK',
  '..........KGGGK.',
  '.........KOKGK..',
  '........KOOOK...',
  '.......KOOOOK...',
  '......KOOOOK....',
  '.....KOOOOK.....',
  '....KOOOOK......',
  '...KOOODK.......',
  '..KOODK.........',
  '..KODK..........',
  '..KK............',
], { K: [110, 50, 10], G: [80, 170, 50], O: [246, 140, 30], D: [200, 100, 20] });
const POTATO = [
  '................',
  '................',
  '................',
  '.....KKKKK......',
  '....KPPPPPKK....',
  '...KPLPPPPPPK...',
  '...KPPPPDPPPK...',
  '..KPPPPPPPPPDK..',
  '..KPPDPPPPPPDK..',
  '..KPPPPPPPPDDK..',
  '...KPPPPPPDDK...',
  '....KKPPPDDK....',
  '......KKKKK.....',
];
T.potato = () => tpl(POTATO, { K: [100, 76, 30], P: [214, 180, 100], L: [240, 214, 150], D: [170, 136, 66] });
T.baked_potato = () => tpl(POTATO, { K: [90, 56, 20], P: [210, 160, 70], L: [250, 220, 140], D: [160, 110, 40] });
T.melon_slice = () => tpl([
  '................',
  '................',
  '................',
  '................',
  '................',
  '.KKKKKKKKKKKKKK.',
  '.KRRRRRRRRRRRRK.',
  '.KRRSRRRRSRRRRK.',
  '..KRRRRSRRRRRK..',
  '..KLRRRRRRRRLK..',
  '...KGLLLLLLGK...',
  '....KGGGGGGK....',
  '.....KKKKKK.....',
], { K: [40, 60, 20], R: [230, 60, 50], S: [30, 20, 20], L: [200, 230, 150], G: [90, 140, 40] });
T.cookie = () => tpl(BALL, { K: [90, 50, 20], L: [220, 160, 90], C: [196, 130, 60], D: [70, 40, 20] });
T.pumpkin_pie = () => tpl([
  '................',
  '................',
  '................',
  '................',
  '................',
  '....KKKKKKKK....',
  '...KOOOOOOOOK...',
  '..KOOOOOOOOOOK..',
  '..KCCCCCCCCCCK..',
  '..KCDCCDCCDCCK..',
  '...KCCCCCCCCK...',
  '....KKKKKKKK....',
], { K: [90, 50, 20], O: [230, 130, 40], C: [220, 180, 110], D: [180, 140, 80] });
T.shears = () => tpl([
  '................',
  '................',
  '..........KK....',
  '.........KWWK...',
  '........KWWLK...',
  '...KK..KWWLK....',
  '..KWWKKWWLK.....',
  '..KWLLWWLK......',
  '...KKWWLKKK.....',
  '....KHHKKHHK....',
  '...KHHK..KHHK...',
  '...KHK....KHK...',
  '...KHHK..KHHK...',
  '....KKK..KKK....',
], { K: [50, 50, 56], W: [236, 236, 240], L: [170, 170, 180], H: [170, 60, 50] });
T.flint_and_steel = () => tpl([
  '................',
  '................',
  '....KKKKKK......',
  '...KWWWWWWK.....',
  '..KWKKKKKWK.....',
  '..KWK...KWK.....',
  '..KWK...KKK.....',
  '..KWK...........',
  '..KWK....KKK....',
  '..KWKK..KDGGK...',
  '...KWWK.KDGGGK..',
  '....KKK.KDDGGK..',
  '.........KDDK...',
  '..........KK....',
], { K: [40, 40, 44], W: [200, 200, 210], D: [40, 40, 44], G: [90, 90, 96] });
const bucketPal = (inside) => ({ K: [50, 50, 56], I: inside, L: [236, 236, 240], W: [190, 190, 198], D: [130, 130, 140] });
T.bucket = () => tpl(BUCKET, bucketPal([70, 70, 76]));
T.water_bucket = () => tpl(BUCKET, bucketPal([50, 100, 220]));
T.lava_bucket = () => tpl(BUCKET, bucketPal([250, 120, 20]));
T.milk_bucket = () => tpl(BUCKET, bucketPal([252, 252, 252]));
T.bow = () => tpl([
  '................',
  '....KKKKK.......',
  '...KBBBBBK......',
  '....KK..KBK.....',
  '.....SK..KBK....',
  '......S...KBK...',
  '.......S...KBK..',
  '........S...KBK.',
  '.........S..KBK.',
  '..........S.KBK.',
  '...........SKBK.',
  '............KBK.',
  '...........KBBK.',
  '..........KBBK..',
  '..........KKK...',
], { K: [60, 40, 20], B: [150, 104, 50], S: [230, 230, 230] });
T.arrow = () => tpl([
  '................',
  '............KKK.',
  '...........KTTK.',
  '..........KTTTK.',
  '.........KSKTK..',
  '........KSK.K...',
  '.......KSK......',
  '......KSK.......',
  '.....KSK........',
  '....KSK.........',
  '.KFKSK..........',
  '.KFFK...........',
  '..KFFK..........',
  '.KFKFFK.........',
  '.KK.KK..........',
], { K: [40, 34, 30], T: [190, 190, 196], S: [140, 104, 50], F: [240, 240, 240] });
T.oak_door = () => tpl([
  '.....KKKKKK.....',
  '.....KPPPPK.....',
  '.....KP..PK.....',
  '.....KP..PK.....',
  '.....KPPPPK.....',
  '.....KPPPPK.....',
  '.....KPPPPK.....',
  '.....KPPPPK.....',
  '.....KPPDPK.....',
  '.....KPPPPK.....',
  '.....KPPPPK.....',
  '.....KPPPPK.....',
  '.....KPPPPK.....',
  '.....KPPPPK.....',
  '.....KKKKKK.....',
], { K: [80, 56, 28], P: [160, 124, 72], D: [60, 60, 66] });
T.red_bed = () => tpl([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.KKKKKKKKKKKKKK.',
  '.KWWWRRRRRRRRRK.',
  '.KWWWRRRRRRRRRK.',
  '.KRRRRRRRRRRRRK.',
  '.KPPPPPPPPPPPPK.',
  '.KPKKKKKKKKKKPK.',
  '.KKK........KKK.',
], { K: [60, 30, 20], W: [240, 240, 240], R: [180, 36, 36], P: [150, 112, 60] });
T.stick = () => {
  const t = new Tile();
  t.fill([0, 0, 0], 0);
  for (let i = 0; i < 10; i++) t.set(3 + i, 12 - i, i % 2 ? STICK_D : STICK);
  outline(t, [40, 28, 14]);
  return t;
};

const DYE_RGB = {
  orange: [240, 118, 19], magenta: [189, 68, 179], light_blue: [58, 175, 217], yellow: [248, 198, 39],
  lime: [112, 185, 25], pink: [237, 141, 172], gray: [72, 78, 82], light_gray: [150, 150, 144], cyan: [21, 137, 145],
  purple: [121, 42, 172], brown: [114, 71, 40], green: [84, 109, 27], red: [176, 40, 34], black: [30, 30, 34],
};
for (const [c, rgb] of Object.entries(DYE_RGB)) {
  T[c + '_dye'] = () => tpl(DYE, { K: mul(rgb, 0.4), W: [220, 210, 190], C: rgb, L: mul(rgb, 1.25), D: mul(rgb, 0.75) });
}

// Returns a Tile for an item icon spec { sprite, material }.
export function drawSprite(spec) {
  if (spec.material && ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'].includes(spec.sprite)) return drawTool(spec.sprite, spec.material);
  if (spec.material && ARMOR_TPL[spec.sprite]) return drawArmor(spec.sprite, spec.material);
  const fn = T[spec.sprite];
  if (fn) return fn();
  const t = new Tile();
  t.each((x, y) => t.set(x, y, ((x >> 2) + (y >> 2)) % 2 ? [255, 0, 255] : [0, 0, 0]));
  return t;
}

export function hasSprite(name) {
  return !!T[name];
}
