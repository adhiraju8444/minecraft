// Renders a top-down map of generated terrain to check biomes and heights.
import fs from 'node:fs';
import { encodePNG } from './png.mjs';
import { WorldGen } from '../js/world/worldgen.js';
import { B, BLOCKS } from '../js/data/blocks.js';
import { SEA_LEVEL } from '../js/world/constants.js';

const seed = Number(process.argv[2] || 12345);
const R = Number(process.argv[3] || 12); // chunks radius
const gen = new WorldGen(seed);
const size = (R * 2) * 16;
const img = new Uint8Array(size * size * 4);
const COL = {
  [B.grass_block]: [96, 150, 60], [B.sand]: [220, 208, 160], [B.water]: [50, 90, 200], [B.stone]: [130, 130, 130],
  [B.snow]: [245, 250, 255], [B.ice]: [160, 200, 250], [B.gravel]: [120, 115, 110], [B.dirt]: [130, 95, 65],
  [B.oak_leaves]: [50, 110, 40], [B.birch_leaves]: [110, 150, 70], [B.spruce_leaves]: [40, 80, 50],
  [B.tall_grass]: [100, 160, 64], [B.cactus]: [80, 140, 40], [B.clay]: [160, 166, 180], [B.sugar_cane]: [150, 200, 100],
};
let t0 = performance.now(), n = 0;
for (let cz = -R; cz < R; cz++) for (let cx = -R; cx < R; cx++) {
  const ch = gen.generate(cx, cz); n++;
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    let y = 127;
    while (y > 0 && ch.blocks[x | (z << 4) | (y << 8)] === 0) y--;
    const id = ch.blocks[x | (z << 4) | (y << 8)];
    let c = COL[id] || [200, 0, 200];
    if (BLOCKS[id] && BLOCKS[id].shape === 'cross' && !COL[id]) c = [120, 170, 70];
    const shade = id === B.water ? 1 : 0.7 + (y - SEA_LEVEL) / 80;
    const px = (cx + R) * 16 + x, pz = (cz + R) * 16 + z;
    const o = (pz * size + px) * 4;
    img[o] = Math.min(255, c[0] * shade); img[o + 1] = Math.min(255, c[1] * shade); img[o + 2] = Math.min(255, c[2] * shade); img[o + 3] = 255;
  }
}
const dt = performance.now() - t0;
fs.writeFileSync(process.argv[4] || 'map.png', encodePNG(size, size, img));
console.log(`${n} chunks in ${dt.toFixed(0)}ms (${(dt / n).toFixed(2)} ms/chunk)`, 'spawn', gen.findSpawn());

// Cross-section through x = 0 to look at caves
const sec = gen.generate(0, 0);
let lines = [];
for (let y = 100; y >= 0; y -= 2) {
  let s = '';
  for (let z = 0; z < 16; z++) {
    const id = sec.blocks[8 | (z << 4) | (y << 8)];
    s += id === 0 ? ' ' : id === B.water ? '~' : id === B.lava ? 'L' : id === B.stone ? '#' : id === B.bedrock ? 'B' : (BLOCKS[id].name[0]);
  }
  lines.push(String(y).padStart(3) + ' ' + s);
}
console.log(lines.join('\n'));
