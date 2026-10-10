// Small HUD icons and the title logo, drawn in code.

function grid(rows, pal) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x];
    if (ch === '.' || !pal[ch]) continue;
    g.fillStyle = pal[ch];
    g.fillRect(x, y, 1, 1);
  }
  return c.toDataURL();
}

const HEART = [
  '.KK...KK.',
  'KRRK.KRRK',
  'KRWRKRRRK',
  'KRRRRRRRK',
  '.KRRRRRK.',
  '..KRRRK..',
  '...KRK...',
  '....K....',
];
const HUNGER = [
  '.....KKK.',
  '....KMMMK',
  '...KMLMMK',
  '..KMMMMMK',
  '.KBKMMMK.',
  'KBBK.KK..',
  'KBK......',
  '.K.......',
];
const ARMOR = [
  'KKK...KKK',
  'KAAKKKAAK',
  'KALAAAAAK',
  'KAAAAAAAK',
  '.KAAAAAK.',
  '.KAAAAAK.',
  '.KAAAAAK.',
  '..KKKKK..',
];
const BUBBLE = [
  '..KKKK..',
  '.KWBBBK.',
  'KWBBBBBK',
  'KBBBBBBK',
  'KBBBBBBK',
  'KBBBBBDK',
  '.KBBBDK.',
  '..KKKK..',
];

function halfOf(rows, cols) {
  return rows.map((r) => r.slice(0, cols) + '.'.repeat(r.length - cols));
}
function emptyOf(rows) {
  return rows.map((r) => r.replace(/[^.K]/g, 'E'));
}

export function hudIcons() {
  const heartPal = { K: '#1b0b0b', R: '#e8303a', W: '#ffb4b4' };
  const hungerPal = { K: '#24140a', M: '#c8763a', L: '#f0b27a', B: '#efe6d2' };
  const armorPal = { K: '#202227', A: '#c9ccd3', L: '#ffffff' };
  const emptyPal = { K: '#1a1a1e', E: '#3b3d45' };
  const out = {
    heart: grid(HEART, heartPal),
    heartHalf: grid(halfOf(HEART, 5), heartPal),
    heartEmpty: grid(emptyOf(HEART), emptyPal),
    heartFlash: grid(emptyOf(HEART), { K: '#ffffff', E: '#3b3d45' }),
    hunger: grid(HUNGER, hungerPal),
    hungerHalf: grid(HUNGER.map((r) => r.slice(0, 4).replace(/[M L]/g, (c) => c) + r.slice(4).replace(/[ML]/g, 'E')), { ...hungerPal, E: '#3b3d45' }),
    hungerEmpty: grid(emptyOf(HUNGER), emptyPal),
    hungerSick: grid(HUNGER, { K: '#141e0a', M: '#7c9a3a', L: '#a8c070', B: '#d6dcc0' }),
    armor: grid(ARMOR, armorPal),
    armorHalf: grid(ARMOR.map((r) => r.slice(0, 5) + r.slice(5).replace(/[AL]/g, 'E')), { ...armorPal, E: '#3b3d45' }),
    armorEmpty: grid(emptyOf(ARMOR), emptyPal),
    bubble: grid(BUBBLE, { K: '#0d2340', W: '#ffffff', B: '#5aa0ff', D: '#2d6ad0' }),
    bubblePop: grid(BUBBLE.map((r) => r.replace(/B/g, '.').replace(/D/g, '.')), { K: '#0d2340', W: '#ffffff' }),
  };
  return out;
}

// Logo: the game name in a pixel font, filled with a stone texture and
// extruded downward.
export function drawLogo(canvas, text = 'BLOCKFORGE') {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const fontSize = Math.floor(H * 0.62);
  const font = `700 ${fontSize}px "Pixelify Sans", "Courier New", monospace`;
  // Draw text mask
  const mask = document.createElement('canvas');
  mask.width = W;
  mask.height = H;
  const mg = mask.getContext('2d');
  mg.font = font;
  mg.textAlign = 'center';
  mg.textBaseline = 'middle';
  let size = fontSize;
  while (mg.measureText(text).width > W * 0.94 && size > 10) {
    size -= 2;
    mg.font = `700 ${size}px "Pixelify Sans", "Courier New", monospace`;
  }
  mg.fillStyle = '#fff';
  mg.fillText(text, W / 2, H * 0.45);
  // Pixelate the mask
  const px = Math.max(2, Math.round(size / 18));
  const sw = Math.ceil(W / px), sh = Math.ceil(H / px);
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sg = small.getContext('2d');
  sg.imageSmoothingEnabled = true;
  sg.drawImage(mask, 0, 0, sw, sh);
  const md = sg.getImageData(0, 0, sw, sh).data;
  const on = (x, y) => x >= 0 && y >= 0 && x < sw && y < sh && md[(y * sw + x) * 4 + 3] > 110;
  const depth = 3;
  // Extrusion (dark) then outline then face with stone texture.
  for (let d = depth; d >= 1; d--) {
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      if (!on(x, y - d)) continue;
      const v = 40 + d * 6;
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(x * px, y * px, px, px);
    }
  }
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (on(x, y)) continue;
    if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1)) {
      g.fillStyle = '#16161a';
      g.fillRect(x * px, y * px, px, px);
    }
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (!on(x, y)) continue;
    const top = !on(x, y - 1);
    const shadeBand = y / sh;
    let v = 150 + rnd() * 40 - shadeBand * 40;
    if (top) v += 40;
    if (!on(x, y + 1)) v -= 30;
    const warm = shadeBand > 0.5 ? 12 : 0;
    g.fillStyle = `rgb(${v + warm | 0},${v | 0},${v - 6 - warm | 0})`;
    g.fillRect(x * px, y * px, px, px);
  }
}

export const SPLASHES = [
  'Made entirely of cubes!', 'Now generating terrain!', 'Dig straight down? Maybe not!', 'Torches are your friends!',
  'Sheep come in many colors!', 'Every world is unique!', 'Synthesized sounds!', 'Bring a bed!', 'Mind the cliffs!',
  'Also try farming!', 'Watch out for spiders!', 'No downloads required!', 'Runs in your browser!', 'Procedurally pixelated!',
  'Infinite-ish!', 'Punch a tree to begin!', 'Water flows, lava glows!', 'Build something tall!', 'Smelt responsibly!',
  'Diamonds are deep!', 'Day, night, repeat!', 'Craft away!', 'Cows give milk!', 'Rain makes everything cozy!',
];
