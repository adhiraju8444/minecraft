// Renders every block tile and item sprite to a PNG contact sheet.
import fs from 'node:fs';
import { encodePNG } from './png.mjs';
import { generateTiles } from '../js/gfx/tiles.js';
import { drawSprite } from '../js/gfx/sprites.js';
import { ITEMS } from '../js/data/items.js';

const out = process.argv[2] || 'art.png';
const scale = 4;
const tiles = generateTiles();
const sprites = [];
for (const it of ITEMS) if (it && it.icon && it.icon.sprite) sprites.push(drawSprite(it.icon));
const all = [...tiles.tiles, ...sprites];
const cols = 16;
const rows = Math.ceil(all.length / cols);
const W = cols * 18 * scale, H = rows * 18 * scale;
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < img.length; i += 4) { img[i] = 70; img[i + 1] = 90; img[i + 2] = 110; img[i + 3] = 255; }
all.forEach((t, i) => {
  const ox = (i % cols) * 18 + 1, oy = Math.floor(i / cols) * 18 + 1;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const s = (y * 16 + x) * 4;
    const a = t.d[s + 3] / 255;
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      const d = (((oy + y) * scale + sy) * W + (ox + x) * scale + sx) * 4;
      for (let c = 0; c < 3; c++) img[d + c] = img[d + c] * (1 - a) + t.d[s + c] * a;
    }
  }
});
fs.writeFileSync(out, encodePNG(W, H, img));
console.log('tiles', tiles.count, 'sprites', sprites.length, '->', out);
