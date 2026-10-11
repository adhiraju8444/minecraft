// Deterministic terrain generator. Pure functions of (seed, x, z) so it can
// run inside a worker and still agree across chunk borders.
import { Simplex } from '../util/noise.js';
import { Random, hash3 } from '../util/rng.js';
import { B } from '../data/blocks.js';
import { CHUNK, HEIGHT, SEA_LEVEL } from './constants.js';

export const BIOME = {
  OCEAN: 0, DEEP_OCEAN: 1, BEACH: 2, PLAINS: 3, FOREST: 4, BIRCH_FOREST: 5, TAIGA: 6,
  SNOWY_PLAINS: 7, DESERT: 8, MOUNTAINS: 9, SWAMP: 10, RIVER: 11, FROZEN_OCEAN: 12,
  SNOWY_TAIGA: 13, SNOWY_BEACH: 14, FROZEN_RIVER: 15,
};
export const BIOME_NAMES = [
  'Ocean', 'Deep Ocean', 'Beach', 'Plains', 'Forest', 'Birch Forest', 'Taiga', 'Snowy Plains',
  'Desert', 'Mountains', 'Swamp', 'River', 'Frozen Ocean', 'Snowy Taiga', 'Snowy Beach', 'Frozen River',
];
const SNOWY = new Set([BIOME.SNOWY_PLAINS, BIOME.FROZEN_OCEAN, BIOME.SNOWY_TAIGA, BIOME.SNOWY_BEACH, BIOME.FROZEN_RIVER]);
export function isSnowyBiome(b) {
  return SNOWY.has(b);
}
// Trees per chunk (expected value) for each biome.
const TREE_DENSITY = [0, 0, 0, 0.35, 9, 8, 7, 0.3, 0, 1.5, 2.5, 0, 0, 5, 0, 0];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

const CONT_SPLINE = [[-1, 28], [-0.5, 34], [-0.28, 48], [-0.14, 57], [-0.05, 61], [0, 63], [0.08, 65], [0.25, 68], [0.5, 72], [1, 80]];
function spline(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return pts[pts.length - 1][1];
}

export class WorldGen {
  constructor(seed) {
    this.seed = seed | 0;
    const r = new Random(this.seed);
    this.nCont = new Simplex(r.seed32());
    this.nErosion = new Simplex(r.seed32());
    this.nPeaks = new Simplex(r.seed32());
    this.nDetail = new Simplex(r.seed32());
    this.nTemp = new Simplex(r.seed32());
    this.nHumid = new Simplex(r.seed32());
    this.nRiver = new Simplex(r.seed32());
    this.nCave1 = new Simplex(r.seed32());
    this.nCave2 = new Simplex(r.seed32());
    this.nCave3 = new Simplex(r.seed32());
    this.nMisc = new Simplex(r.seed32());
    this.nFlower = new Simplex(r.seed32());
  }

  // Height, biome and climate for one world column.
  column(x, z) {
    const c = this.nCont.fbm2(x / 900, z / 900, 4) * 1.15;
    const e = this.nErosion.fbm2(x / 520 + 37, z / 520, 3) * 1.2;
    const pk = this.nPeaks.ridged2(x / 280, z / 280, 4);
    const d = this.nDetail.fbm2(x / 64, z / 64, 3);
    let h = spline(CONT_SPLINE, c);
    const hills = smooth(0.4, -0.5, e);
    h += d * (2.5 + 9 * hills);
    const m = smooth(0.02, 0.3, c) * smooth(-0.05, -0.5, e);
    // The only non-exact maths in terrain generation. Engines agree on pow to
    // within the last bit, which practically never moves a block height.
    h += m * Math.pow(pk, 1.6) * 64;
    const rv = Math.abs(this.nRiver.fbm2(x / 560, z / 560, 3));
    let river = 0;
    if (c > -0.12) {
      river = (1 - smooth(0.012, 0.055, rv)) * (1 - Math.min(1, m * 1.6)) * smooth(-0.12, -0.02, c);
      if (river > 0) h = lerp(h, SEA_LEVEL - 4, river);
    }
    h = Math.max(6, Math.min(HEIGHT - 10, Math.round(h)));

    const temp = Math.max(-1, Math.min(1, this.nTemp.fbm2(x / 1400, z / 1400, 2) * 1.7 + d * 0.05));
    const humid = Math.max(-1, Math.min(1, this.nHumid.fbm2(x / 1100, z / 1100, 2) * 1.7));
    let biome;
    const cold = temp < -0.45;
    if (h < SEA_LEVEL) {
      if (river > 0.45) biome = cold ? BIOME.FROZEN_RIVER : BIOME.RIVER;
      else if (cold) biome = BIOME.FROZEN_OCEAN;
      else biome = h < 44 ? BIOME.DEEP_OCEAN : BIOME.OCEAN;
    } else if (h <= SEA_LEVEL + 2 && c < 0.06 && river < 0.2 && m < 0.2) {
      biome = cold ? BIOME.SNOWY_BEACH : BIOME.BEACH;
    } else if (m > 0.35 && h > 84) {
      biome = BIOME.MOUNTAINS;
    } else if (cold) {
      biome = humid > 0 ? BIOME.SNOWY_TAIGA : BIOME.SNOWY_PLAINS;
    } else if (temp < -0.15) {
      biome = BIOME.TAIGA;
    } else if (temp > 0.42 && humid < 0.15) {
      biome = BIOME.DESERT;
    } else if (humid > 0.4 && h < SEA_LEVEL + 7) {
      biome = BIOME.SWAMP;
    } else if (humid > 0.02) {
      biome = this.nMisc.noise2(x / 300, z / 300) > 0.35 ? BIOME.BIRCH_FOREST : BIOME.FOREST;
    } else {
      biome = BIOME.PLAINS;
    }
    return { h, biome, temp, humid, river };
  }

  // Cave noise sampled on a 4-block lattice and trilinearly interpolated so
  // that any chunk computes identical values along shared borders.
  caveSample(gx, gy, gz) {
    const a = this.nCave1.noise3(gx / 42, gy / 26, gz / 42);
    const b = this.nCave2.noise3(gx / 42, gy / 26, gz / 42);
    const c = this.nCave3.noise3(gx / 90, gy / 48, gz / 90);
    return [a, b, c];
  }

  caveAt(x, y, z) {
    const gx = Math.floor(x / 4) * 4, gy = Math.floor(y / 4) * 4, gz = Math.floor(z / 4) * 4;
    const tx = (x - gx) / 4, ty = (y - gy) / 4, tz = (z - gz) / 4;
    const s = [];
    for (let i = 0; i < 8; i++) s.push(this.caveSample(gx + (i & 1) * 4, gy + ((i >> 1) & 1) * 4, gz + ((i >> 2) & 1) * 4));
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const c00 = lerp(s[0][k], s[1][k], tx), c10 = lerp(s[2][k], s[3][k], tx);
      const c01 = lerp(s[4][k], s[5][k], tx), c11 = lerp(s[6][k], s[7][k], tx);
      out[k] = lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
    }
    return out;
  }

  static isCave(n1, n2, n3, y, h) {
    if (y <= 0) return false;
    const t = n1 * n1 + n2 * n2;
    const depthBoost = y < 30 ? 1.25 : 1;
    let cave = t < 0.0078 * depthBoost || (n3 > 0.58 && y < 54 && y > 6);
    if (!cave) return false;
    if (y > h - 4) cave = t < 0.0022; // only narrow tunnels break the surface
    return cave;
  }

  // Tree candidates for a chunk (world coords). Shared with neighbours.
  treesFor(cx, cz) {
    const r = new Random(hash3(this.seed, cx, cz, 7));
    const out = [];
    for (let i = 0; i < 12; i++) {
      const lx = r.int(16), lz = r.int(16);
      const roll = r.float();
      const typeRoll = r.float();
      const hRoll = r.int(4);
      const leafSeed = r.seed32();
      const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
      const col = this.column(x, z);
      const dens = TREE_DENSITY[col.biome];
      if (roll >= dens / 12) continue;
      if (col.h < SEA_LEVEL || col.h > HEIGHT - 20) continue;
      if (col.biome === BIOME.MOUNTAINS && col.h > 98) continue;
      const [n1, n2, n3] = this.caveAt(x, col.h, z);
      if (WorldGen.isCave(n1, n2, n3, col.h, col.h)) continue;
      let type = 'oak';
      if (col.biome === BIOME.BIRCH_FOREST) type = typeRoll < 0.85 ? 'birch' : 'oak';
      else if (col.biome === BIOME.FOREST) type = typeRoll < 0.2 ? 'birch' : 'oak';
      else if (col.biome === BIOME.TAIGA || col.biome === BIOME.SNOWY_TAIGA || col.biome === BIOME.SNOWY_PLAINS) type = 'spruce';
      else if (col.biome === BIOME.MOUNTAINS) type = typeRoll < 0.6 ? 'spruce' : 'oak';
      out.push({ x, z, y: col.h + 1, type, hRoll, leafSeed, biome: col.biome });
    }
    return out;
  }

  generate(cx, cz) {
    const blocks = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const meta = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const biomes = new Uint8Array(256);
    const temps = new Uint8Array(256);
    const humids = new Uint8Array(256);
    const heights = new Int16Array(18 * 18);
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const rnd = new Random(hash3(this.seed, cx, cz, 1));
    const idx = (x, y, z) => x | (z << 4) | (y << 8);

    // Column info including a one-block border (for sugar cane / water checks).
    const cols = new Array(18 * 18);
    for (let z = -1; z <= 16; z++) {
      for (let x = -1; x <= 16; x++) {
        const c = this.column(ox + x, oz + z);
        cols[(z + 1) * 18 + (x + 1)] = c;
        heights[(z + 1) * 18 + (x + 1)] = c.h;
      }
    }
    const colAt = (x, z) => cols[(z + 1) * 18 + (x + 1)];

    // Cave noise lattice for this chunk: 5 x 33 x 5 samples.
    const lat = new Float32Array(5 * 33 * 5 * 3);
    for (let gz = 0; gz < 5; gz++) for (let gy = 0; gy < 33; gy++) for (let gx = 0; gx < 5; gx++) {
      const s = this.caveSample(ox + gx * 4, gy * 4, oz + gz * 4);
      const o = ((gz * 33 + gy) * 5 + gx) * 3;
      lat[o] = s[0];
      lat[o + 1] = s[1];
      lat[o + 2] = s[2];
    }
    const latAt = (gx, gy, gz, k) => lat[((gz * 33 + gy) * 5 + gx) * 3 + k];
    const caveN = [0, 0, 0];
    const sampleCave = (x, y, z) => {
      const gx = x >> 2, gy = y >> 2, gz = z >> 2;
      const tx = (x & 3) / 4, ty = (y & 3) / 4, tz = (z & 3) / 4;
      for (let k = 0; k < 3; k++) {
        const c00 = lerp(latAt(gx, gy, gz, k), latAt(gx + 1, gy, gz, k), tx);
        const c10 = lerp(latAt(gx, gy + 1, gz, k), latAt(gx + 1, gy + 1, gz, k), tx);
        const c01 = lerp(latAt(gx, gy, gz + 1, k), latAt(gx + 1, gy, gz + 1, k), tx);
        const c11 = lerp(latAt(gx, gy + 1, gz + 1, k), latAt(gx + 1, gy + 1, gz + 1, k), tx);
        caveN[k] = lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
      }
      return caveN;
    };

    // ---- Terrain columns
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const col = colAt(x, z);
        const { h, biome } = col;
        biomes[z * 16 + x] = biome;
        temps[z * 16 + x] = Math.round((col.temp * 0.5 + 0.5) * 255);
        humids[z * 16 + x] = Math.round((col.humid * 0.5 + 0.5) * 255);
        const underwater = h < SEA_LEVEL;
        let top = B.grass_block, filler = B.dirt, depth = 3 + rnd.int(2), deep = 0, deepBlock = 0;
        switch (biome) {
          case BIOME.DESERT: top = B.sand; filler = B.sand; depth = 3; deep = 3; deepBlock = B.sandstone; break;
          case BIOME.BEACH: case BIOME.SNOWY_BEACH: top = B.sand; filler = B.sand; depth = 3; deep = 1; deepBlock = B.sandstone; break;
          case BIOME.MOUNTAINS:
            if (h > 96) { top = B.stone; filler = B.stone; }
            else if (h > 88 && rnd.chance(0.5)) { top = B.stone; filler = B.stone; }
            break;
          default: break;
        }
        if (underwater) {
          const floorNoise = this.nMisc.noise2((ox + x) / 24, (oz + z) / 24);
          if (h > SEA_LEVEL - 6 || biome === BIOME.RIVER || biome === BIOME.FROZEN_RIVER) { top = floorNoise > 0.3 ? B.gravel : B.sand; filler = B.sand; }
          else if (floorNoise > 0.1) { top = B.gravel; filler = B.gravel; }
          else { top = B.dirt; filler = B.dirt; }
          if (biome === BIOME.SWAMP) { top = B.dirt; filler = B.dirt; }
        }
        for (let y = 0; y <= h; y++) {
          let id = B.stone;
          if (y === h) id = top;
          else if (y >= h - depth) id = filler;
          else if (deep && y >= h - depth - deep) id = deepBlock;
          blocks[idx(x, y, z)] = id;
        }
        // Bedrock floor, ragged on top.
        blocks[idx(x, 0, z)] = B.bedrock;
        for (let y = 1; y < 5; y++) if (rnd.float() < (5 - y) / 5) blocks[idx(x, y, z)] = B.bedrock;
        // Water
        for (let y = h + 1; y <= SEA_LEVEL; y++) blocks[idx(x, y, z)] = B.water;
        if (underwater && isSnowyBiome(biome)) blocks[idx(x, SEA_LEVEL, z)] = B.ice;
        // Caves
        const limit = underwater ? h - 8 : h <= SEA_LEVEL + 2 ? h - 6 : h;
        for (let y = 1; y <= limit; y++) {
          const i = idx(x, y, z);
          const cur = blocks[i];
          if (cur === B.bedrock || cur === B.water) continue;
          const n = sampleCave(x, y, z);
          if (WorldGen.isCave(n[0], n[1], n[2], y, h)) blocks[i] = y <= 10 ? B.lava : 0;
        }
      }
    }

    // ---- Ores and stone variants
    const vein = (id, size, minY, maxY, count) => {
      for (let n = 0; n < count; n++) {
        let x = rnd.int(16), y = rnd.range(minY, maxY), z = rnd.int(16);
        for (let i = 0; i < size; i++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < HEIGHT) {
            const k = idx(x, y, z);
            if (blocks[k] === B.stone) blocks[k] = id;
          }
          x += rnd.range(-1, 1);
          y += rnd.range(-1, 1);
          z += rnd.range(-1, 1);
        }
      }
    };
    const blob = (id, radius, minY, maxY, count) => {
      for (let n = 0; n < count; n++) {
        const bx = rnd.int(16), by = rnd.range(minY, maxY), bz = rnd.int(16);
        const r2 = radius * radius;
        for (let dy = -radius; dy <= radius; dy++) for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy + dz * dz > r2 + rnd.float() * 2) continue;
          const x = bx + dx, y = by + dy, z = bz + dz;
          if (x < 0 || x > 15 || z < 0 || z > 15 || y < 1 || y >= HEIGHT) continue;
          const k = idx(x, y, z);
          if (blocks[k] === B.stone) blocks[k] = id;
        }
      }
    };
    blob(B.granite, 3, 5, 75, 1);
    blob(B.diorite, 3, 5, 75, 1);
    blob(B.andesite, 3, 5, 75, 1);
    blob(B.dirt, 2, 5, 70, 2);
    blob(B.gravel, 2, 5, 70, 2);
    vein(B.coal_ore, 14, 5, 110, 18);
    vein(B.iron_ore, 9, 5, 64, 16);
    vein(B.gold_ore, 8, 5, 32, 2);
    vein(B.lapis_ore, 7, 8, 30, 1);
    vein(B.diamond_ore, 7, 4, 15, 1);

    // ---- Clay patches under shallow water
    for (let n = 0; n < 3; n++) {
      const x = rnd.int(16), z = rnd.int(16);
      const c = colAt(x, z);
      if (c.h >= SEA_LEVEL - 1 || c.h < SEA_LEVEL - 6) continue;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dz * dz > 5) continue;
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || xx > 15 || zz < 0 || zz > 15) continue;
        const hh = colAt(xx, zz).h;
        for (let y = hh - 1; y <= hh; y++) {
          const k = idx(xx, y, zz);
          if (blocks[k] === B.sand || blocks[k] === B.dirt || blocks[k] === B.gravel) blocks[k] = B.clay;
        }
      }
    }

    // ---- Trees from this chunk and its neighbours
    const setIn = (wx, y, wz, id, m = 0, onlyAir = false) => {
      const x = wx - ox, z = wz - oz;
      if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= HEIGHT) return;
      const k = idx(x, y, z);
      const cur = blocks[k];
      if (onlyAir && cur !== 0 && cur !== B.tall_grass && cur !== B.fern && cur !== B.snow) return;
      if (!onlyAir && cur !== 0 && cur !== B.oak_leaves && cur !== B.birch_leaves && cur !== B.spruce_leaves && cur !== B.tall_grass && cur !== B.fern && cur !== B.snow) return;
      blocks[k] = id;
      meta[k] = m;
    };
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const t of this.treesFor(cx + dx, cz + dz)) {
          placeTree(t, setIn);
          // Ground under a trunk becomes dirt.
          const lx = t.x - ox, lz = t.z - oz;
          if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
            const k = idx(lx, t.y - 1, lz);
            if (blocks[k] === B.grass_block) blocks[k] = B.dirt;
          }
        }
      }
    }

    // ---- Small plants and surface features (inside this chunk only)
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const col = colAt(x, z);
        const { h, biome } = col;
        if (h < SEA_LEVEL || h >= HEIGHT - 2) continue;
        const ground = blocks[idx(x, h, z)];
        const above = idx(x, h + 1, z);
        if (blocks[above] !== 0) continue;
        const wx = ox + x, wz = oz + z;
        const roll = rnd.float();
        if (ground === B.grass_block) {
          // Sugar cane near water
          if (h === SEA_LEVEL && roll < 0.12) {
            const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, az]) => colAt(x + ax, z + az).h < SEA_LEVEL);
            if (wet) {
              const hgt = 1 + rnd.int(3);
              for (let i = 1; i <= hgt; i++) blocks[idx(x, h + i, z)] = B.sugar_cane;
              continue;
            }
          }
          let grassChance = 0.06;
          if (biome === BIOME.PLAINS) grassChance = 0.3;
          else if (biome === BIOME.FOREST || biome === BIOME.BIRCH_FOREST || biome === BIOME.SWAMP) grassChance = 0.14;
          else if (biome === BIOME.TAIGA) grassChance = 0.12;
          else if (biome === BIOME.SNOWY_PLAINS || biome === BIOME.SNOWY_TAIGA) grassChance = 0.02;
          const flowerPatch = this.nFlower.noise2(wx / 40, wz / 40);
          if (roll < grassChance) {
            blocks[above] = biome === BIOME.TAIGA || biome === BIOME.SNOWY_TAIGA ? (rnd.chance(0.6) ? B.fern : B.tall_grass) : B.tall_grass;
          } else if (roll < grassChance + (flowerPatch > 0.35 ? 0.08 : 0.012) && biome !== BIOME.SNOWY_PLAINS && biome !== BIOME.SNOWY_TAIGA) {
            const kind = this.nFlower.noise2(wx / 13 + 50, wz / 13);
            blocks[above] = kind > 0.4 ? B.cornflower : kind > 0.05 ? B.dandelion : kind > -0.35 ? B.poppy : B.oxeye_daisy;
          } else if (roll > 0.9994 && (biome === BIOME.PLAINS || biome === BIOME.FOREST)) {
            blocks[above] = B.pumpkin;
            meta[above] = rnd.int(4);
          } else if (roll > 0.996 && (biome === BIOME.FOREST || biome === BIOME.TAIGA || biome === BIOME.SWAMP)) {
            blocks[above] = rnd.chance(0.5) ? B.brown_mushroom : B.red_mushroom;
          }
        } else if (ground === B.sand && biome === BIOME.DESERT) {
          if (roll < 0.008 && x > 0 && x < 15 && z > 0 && z < 15) {
            const hgt = 1 + rnd.int(3);
            let ok = true;
            for (let i = 1; i <= hgt && ok; i++) {
              for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (blocks[idx(x + ax, h + i, z + az)] !== 0) ok = false;
            }
            if (ok) for (let i = 1; i <= hgt; i++) blocks[idx(x, h + i, z)] = B.cactus;
          } else if (roll > 0.993) {
            blocks[above] = B.dead_bush;
          }
        } else if (ground === B.sand && h === SEA_LEVEL && roll < 0.08 && biome !== BIOME.SNOWY_BEACH) {
          const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, az]) => colAt(x + ax, z + az).h < SEA_LEVEL);
          if (wet) {
            const hgt = 1 + rnd.int(3);
            for (let i = 1; i <= hgt; i++) blocks[idx(x, h + i, z)] = B.sugar_cane;
          }
        }
      }
    }

    // ---- Snow cover in cold biomes and on high peaks
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const col = colAt(x, z);
        const snowy = isSnowyBiome(col.biome) || (col.biome === BIOME.MOUNTAINS && col.h > 100);
        if (!snowy) continue;
        let y = HEIGHT - 2;
        while (y > 0 && blocks[idx(x, y, z)] === 0) y--;
        const top = blocks[idx(x, y, z)];
        if (top === B.water || top === B.lava || top === B.ice || top === B.cactus || top === B.sugar_cane) continue;
        if (top === B.tall_grass || top === B.fern || top === B.dandelion || top === B.poppy) {
          blocks[idx(x, y, z)] = B.snow;
          continue;
        }
        if (y + 1 < HEIGHT) blocks[idx(x, y + 1, z)] = B.snow;
      }
    }

    // ---- Passive animals at generation time
    const spawns = [];
    const grassy = (b) => b === BIOME.PLAINS || b === BIOME.FOREST || b === BIOME.BIRCH_FOREST || b === BIOME.TAIGA || b === BIOME.MOUNTAINS || b === BIOME.SWAMP;
    if (rnd.chance(0.11)) {
      const c0 = colAt(8, 8);
      if (grassy(c0.biome)) {
        const kinds = c0.biome === BIOME.SWAMP ? ['pig', 'chicken'] : ['pig', 'cow', 'sheep', 'chicken', 'sheep', 'cow'];
        const kind = rnd.pick(kinds);
        const n = 2 + rnd.int(3);
        for (let i = 0; i < n; i++) {
          const x = rnd.int(16), z = rnd.int(16);
          const c = colAt(x, z);
          if (blocks[idx(x, c.h, z)] !== B.grass_block) continue;
          spawns.push({ type: kind, x: ox + x + 0.5, y: c.h + 1, z: oz + z + 0.5 });
        }
      }
    }

    return { blocks, meta, biomes, temps, humids, heights, spawns };
  }

  findSpawn() {
    for (let r = 0; r < 600; r += 8) {
      const steps = Math.max(1, Math.floor((r * 2 * Math.PI) / 8));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        const c = this.column(x, z);
        if (c.h >= SEA_LEVEL + 1 && c.h < 90 && c.biome !== BIOME.BEACH && c.biome !== BIOME.SNOWY_BEACH && c.biome !== BIOME.DESERT) {
          return { x: x + 0.5, y: c.h + 1, z: z + 0.5 };
        }
      }
    }
    const c = this.column(0, 0);
    return { x: 0.5, y: Math.max(c.h, SEA_LEVEL) + 1, z: 0.5 };
  }
}

// ---- Trees
export function placeTree(t, set) {
  const r = new Random(t.leafSeed);
  const { x, y, z } = t;
  if (t.type === 'spruce') {
    const height = 7 + t.hRoll + r.int(2);
    const log = B.spruce_log, leaf = B.spruce_leaves;
    const top = y + height - 1;
    const bottomLeaf = y + 2 + r.int(2);
    let i = 0;
    for (let ly = top + 1; ly >= bottomLeaf; ly--, i++) {
      let rad = i === 0 ? 0 : i % 2 === 1 ? 1 : Math.min(3, 1 + Math.floor((i + 1) / 3));
      if (ly === top + 1) rad = 0;
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        const dist = Math.abs(dx) + Math.abs(dz);
        if (dist > rad + (rad >= 2 ? 1 : 0)) continue;
        if (rad >= 2 && Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
        set(x + dx, ly, z + dz, leaf, 0, true);
      }
    }
    for (let i2 = 0; i2 < height; i2++) set(x, y + i2, z, log, 0);
    return;
  }
  const birch = t.type === 'birch';
  const height = (birch ? 5 : 4) + Math.min(2, t.hRoll);
  const log = birch ? B.birch_log : B.oak_log;
  const leaf = birch ? B.birch_leaves : B.oak_leaves;
  const top = y + height; // first block above the trunk
  for (let ly = top - 3; ly <= top; ly++) {
    const rel = ly - top;
    const rad = rel <= -2 ? 2 : 1;
    for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
      if (corner && (rel === 0 || r.chance(0.5))) continue;
      set(x + dx, ly, z + dz, leaf, 0, true);
    }
  }
  for (let i = 0; i < height; i++) set(x, y + i, z, log, 0);
}

// Grass / foliage colours from climate, in the spirit of a biome colour map.
export function grassTint(temp01, humid01, biome, kind) {
  if (biome === BIOME.SWAMP) return kind === 'grass' ? [106, 112, 57] : [106, 112, 57];
  const t = temp01, h = humid01 * t;
  const hotDry = [191, 183, 85], hotWet = [71, 205, 51], cold = [128, 180, 151], cool = [104, 180, 78];
  let c;
  if (t < 0.4) c = lerpC(cold, cool, t / 0.4);
  else c = lerpC(lerpC(cool, hotDry, (t - 0.4) / 0.6), hotWet, Math.min(1, h * 1.4));
  if (kind === 'foliage') c = [c[0] * 0.85, c[1] * 0.92, c[2] * 0.8];
  return c;
}
function lerpC(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
