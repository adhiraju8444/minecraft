// Procedural 16x16 block textures. Every tile is painted from code with a
// seeded RNG, so the game ships without any image assets.
import { mulberry32, hashString } from '../util/rng.js';
import { WOOL_COLORS } from '../data/blocks.js';

export const TILE = 16;

export class Tile {
  constructor() {
    this.d = new Uint8ClampedArray(TILE * TILE * 4);
  }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    const i = (y * 16 + x) * 4;
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
    this.d[i + 3] = c.length > 3 ? c[3] : a;
  }
  setw(x, y, c, a = 255) {
    this.set(x & 15, y & 15, c, a);
  }
  get(x, y) {
    const i = ((y & 15) * 16 + (x & 15)) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  alpha(x, y) {
    return this.d[((y & 15) * 16 + (x & 15)) * 4 + 3];
  }
  fill(c, a = 255) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.set(x, y, c, a);
  }
  copyFrom(o) {
    this.d.set(o.d);
    return this;
  }
  clone() {
    return new Tile().copyFrom(this);
  }
  each(fn) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) fn(x, y);
  }
}

export const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Tileable value noise over a 16x16 tile.
function vnoise(r, cells) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const s = cells / 16;
  return (x, y) => {
    const fx = x * s, fy = y * s;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const a = g[(y0 % cells) * cells + (x0 % cells)];
    const b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
    const c = g[((y0 + 1) % cells) * cells + (x0 % cells)];
    const d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function wrapDist(ax, ay, bx, by) {
  let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  if (dx > 8) dx = 16 - dx;
  if (dy > 8) dy = 16 - dy;
  return Math.sqrt(dx * dx + dy * dy);
}

function wrapDelta(a, b) {
  let d = a - b;
  if (d > 8) d -= 16;
  if (d < -8) d += 16;
  return d;
}

function noisy(t, r, base, amt, n = null, namt = 0) {
  t.each((x, y) => {
    const f = 1 + (r() - 0.5) * amt + (n ? (n(x, y) - 0.5) * namt : 0);
    t.set(x, y, mul(base, f));
  });
}

// ---------------------------------------------------------------- painters
const P = {};

P.stone = (t, r) => {
  const n = vnoise(r, 4), n2 = vnoise(r, 8);
  t.each((x, y) => {
    const v = 122 + (n(x, y) - 0.5) * 26 + (n2(x, y) - 0.5) * 22 + (r() - 0.5) * 12;
    t.set(x, y, [v, v, v + 1]);
  });
  for (let k = 0; k < 5; k++) {
    let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    const len = 2 + Math.floor(r() * 4);
    for (let i = 0; i < len; i++) {
      const c = t.get(x, y);
      t.setw(x, y, mul(c, 0.82));
      x++;
      if (r() < 0.3) y += r() < 0.5 ? 1 : -1;
    }
  }
};

function cobble(t, r, base, mortar, moss) {
  const pts = [];
  for (let i = 0; i < 11; i++) pts.push([r() * 16, r() * 16, (r() - 0.5) * 0.3]);
  const mn = vnoise(r, 4);
  t.each((x, y) => {
    let d1 = 99, d2 = 99, id = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = wrapDist(x + 0.5, y + 0.5, pts[i][0], pts[i][1]);
      if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
    }
    let c;
    if (d2 - d1 < 1.0) c = mul(mortar, 0.9 + r() * 0.2);
    else {
      const p = pts[id];
      const lx = wrapDelta(x + 0.5, p[0]), ly = wrapDelta(y + 0.5, p[1]);
      const light = 1 + p[2] - (lx + ly) * 0.035 + (r() - 0.5) * 0.12;
      c = mul(base, light);
    }
    if (moss && mn(x, y) > 0.55 + r() * 0.1) c = mix(c, [72, 108, 44], 0.75);
    t.set(x, y, c);
  });
}
P.cobblestone = (t, r) => cobble(t, r, [128, 128, 128], [70, 70, 72], false);
P.mossy_cobblestone = (t, r) => cobble(t, r, [124, 126, 120], [64, 68, 62], true);

P.dirt = (t, r) => {
  const n = vnoise(r, 4);
  t.each((x, y) => {
    const f = 1 + (n(x, y) - 0.5) * 0.18 + (r() - 0.5) * 0.16;
    t.set(x, y, mul([134, 96, 67], f));
  });
  for (let i = 0; i < 14; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), mul([96, 68, 47], 0.9 + r() * 0.2));
  for (let i = 0; i < 8; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), mul([160, 120, 86], 0.95 + r() * 0.1));
  for (let i = 0; i < 3; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [128, 120, 112]);
};

P.grass_top = (t, r) => {
  const n = vnoise(r, 8);
  t.each((x, y) => {
    const v = 168 + (n(x, y) - 0.5) * 30 + (r() - 0.5) * 46;
    t.set(x, y, [v, v, v]);
  });
};

P.grass_side_overlay = (t, r) => {
  t.fill([0, 0, 0], 0);
  for (let x = 0; x < 16; x++) {
    const depth = 3 + (r() < 0.5 ? 1 : 0) + (r() < 0.25 ? 1 : 0) + (r() < 0.1 ? 1 : 0);
    for (let y = 0; y < depth; y++) {
      const v = 160 + (r() - 0.5) * 50 - y * 6;
      t.set(x, y, [v, v, v]);
    }
  }
};

P.grass_side = (t, r, get) => {
  t.copyFrom(get('dirt'));
};

P.grass_side_snowy = (t, r, get) => {
  t.copyFrom(get('dirt'));
  for (let x = 0; x < 16; x++) {
    const depth = 3 + (r() < 0.5 ? 1 : 0) + (r() < 0.2 ? 1 : 0);
    for (let y = 0; y < depth; y++) t.set(x, y, mul([240, 248, 252], 0.92 + r() * 0.08));
  }
};

P.snow = (t, r) => {
  t.each((x, y) => t.set(x, y, mul([242, 250, 252], 0.94 + r() * 0.06)));
  for (let i = 0; i < 10; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [218, 232, 240]);
};

P.ice = (t, r) => {
  t.each((x, y) => t.set(x, y, mul([150, 190, 248], 0.92 + r() * 0.1), 190));
  for (let k = 0; k < 4; k++) {
    let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    for (let i = 0; i < 5; i++) {
      t.setw(x, y, [220, 236, 255], 210);
      x++;
      y--;
    }
  }
};

P.sand = (t, r) => {
  const n = vnoise(r, 8);
  t.each((x, y) => t.set(x, y, mul([219, 207, 163], 1 + (n(x, y) - 0.5) * 0.08 + (r() - 0.5) * 0.08)));
  for (let i = 0; i < 12; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [196, 180, 136]);
  for (let i = 0; i < 6; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [236, 228, 196]);
};

P.sandstone_side = (t, r) => {
  const n = vnoise(r, 8);
  t.each((x, y) => {
    let c = mul([216, 203, 155], 1 + (n(x, y) - 0.5) * 0.06 + (r() - 0.5) * 0.05);
    if (y === 3 || y === 9) c = mul(c, 0.88);
    if (y <= 2) c = mul(c, 1.05);
    t.set(x, y, c);
  });
};
P.sandstone_top = (t, r) => {
  t.each((x, y) => t.set(x, y, mul([220, 208, 162], 0.96 + r() * 0.06)));
};
P.sandstone_bottom = (t, r) => {
  t.each((x, y) => t.set(x, y, mul([212, 198, 150], 0.94 + r() * 0.08)));
  for (let i = 0; i < 10; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [186, 170, 124]);
};

P.gravel = (t, r) => {
  const pts = [];
  const cols = [[136, 126, 126], [108, 100, 100], [160, 150, 148], [122, 110, 100], [96, 92, 92], [150, 136, 124]];
  for (let i = 0; i < 26; i++) pts.push([r() * 16, r() * 16, cols[Math.floor(r() * cols.length)]]);
  t.each((x, y) => {
    let d1 = 99, d2 = 99, id = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = wrapDist(x + 0.5, y + 0.5, pts[i][0], pts[i][1]);
      if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
    }
    let c = mul(pts[id][2], 0.92 + r() * 0.14);
    if (d2 - d1 < 0.6) c = mul(c, 0.7);
    t.set(x, y, c);
  });
};

P.bedrock = (t, r) => {
  const n = vnoise(r, 8);
  t.each((x, y) => {
    const v = n(x, y) * 0.6 + r() * 0.4;
    const c = v < 0.35 ? [40, 40, 40] : v < 0.55 ? [86, 86, 86] : v < 0.75 ? [118, 118, 118] : [160, 160, 160];
    t.set(x, y, c);
  });
};

P.clay = (t, r) => {
  const n = vnoise(r, 4);
  t.each((x, y) => t.set(x, y, mul([160, 166, 179], 1 + (n(x, y) - 0.5) * 0.06 + (r() - 0.5) * 0.05)));
};

P.granite = (t, r) => {
  t.each((x, y) => {
    const v = r();
    const c = v < 0.2 ? [120, 78, 64] : v < 0.6 ? [154, 106, 89] : v < 0.85 ? [176, 128, 110] : [196, 156, 140];
    t.set(x, y, c);
  });
};
P.diorite = (t, r) => {
  const n = vnoise(r, 8);
  t.each((x, y) => {
    const v = r() * 0.6 + n(x, y) * 0.4;
    const c = v < 0.3 ? [120, 120, 122] : v < 0.6 ? [190, 190, 192] : [228, 228, 228];
    t.set(x, y, c);
  });
};
P.andesite = (t, r) => {
  const n = vnoise(r, 8);
  t.each((x, y) => {
    const v = r() * 0.5 + n(x, y) * 0.5;
    const c = v < 0.35 ? [112, 112, 112] : v < 0.7 ? [134, 134, 136] : [156, 156, 156];
    t.set(x, y, c);
  });
};

function bark(t, r, base, dark, light) {
  const colShade = [];
  for (let x = 0; x < 16; x++) colShade.push(0.85 + r() * 0.3);
  t.each((x, y) => {
    let c = mul(base, colShade[x] * (0.95 + r() * 0.1));
    t.set(x, y, c);
  });
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(r() * 16);
    const y0 = Math.floor(r() * 16), len = 3 + Math.floor(r() * 8);
    for (let i = 0; i < len; i++) t.setw(x, y0 + i, mul(dark, 0.9 + r() * 0.2));
  }
  for (let k = 0; k < 4; k++) {
    const x = Math.floor(r() * 16), y0 = Math.floor(r() * 16), len = 2 + Math.floor(r() * 4);
    for (let i = 0; i < len; i++) t.setw(x, y0 + i, light);
  }
}
function logTop(t, r, inner, ringC, barkC) {
  t.each((x, y) => {
    const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
    const d = Math.max(dx, dy) + Math.min(dx, dy) * 0.25;
    let c;
    if (x === 0 || y === 0 || x === 15 || y === 15) c = mul(barkC, 0.9 + r() * 0.2);
    else c = Math.floor(d) % 2 === 0 ? mul(inner, 0.96 + r() * 0.08) : mul(ringC, 0.96 + r() * 0.08);
    t.set(x, y, c);
  });
}
P.oak_log = (t, r) => bark(t, r, [107, 84, 51], [70, 54, 32], [130, 104, 66]);
P.oak_log_top = (t, r) => logTop(t, r, [176, 144, 88], [150, 118, 70], [107, 84, 51]);
P.birch_log = (t, r) => {
  t.each((x, y) => t.set(x, y, mul([216, 215, 206], 0.94 + r() * 0.08)));
  for (let k = 0; k < 9; k++) {
    const y = Math.floor(r() * 16), x0 = Math.floor(r() * 16), len = 2 + Math.floor(r() * 4);
    for (let i = 0; i < len; i++) t.setw(x0 + i, y, mul([48, 46, 40], 0.9 + r() * 0.3));
    if (r() < 0.5) t.setw(x0 + 1, y + 1, [72, 70, 62]);
  }
};
P.birch_log_top = (t, r) => logTop(t, r, [206, 186, 132], [184, 164, 112], [216, 215, 206]);
P.spruce_log = (t, r) => bark(t, r, [60, 40, 20], [40, 26, 12], [78, 54, 28]);
P.spruce_log_top = (t, r) => logTop(t, r, [130, 96, 56], [104, 76, 42], [60, 40, 20]);

P.hay_side = (t, r) => {
  t.each((x, y) => {
    let c = mul([196, 160, 40], 0.85 + r() * 0.25);
    if ((x + Math.floor(r() * 2)) % 3 === 0) c = mul(c, 0.85);
    if (y === 3 || y === 4 || y === 11 || y === 12) c = mul([120, 60, 30], 0.9 + r() * 0.2);
    t.set(x, y, c);
  });
};
P.hay_top = (t, r) => {
  t.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let c = mul([200, 166, 48], 0.85 + r() * 0.25);
    if (Math.floor(d) % 3 === 0) c = mul(c, 0.8);
    t.set(x, y, c);
  });
};

function planks(t, r, base) {
  for (let b = 0; b < 4; b++) {
    const shade = 0.92 + r() * 0.14;
    const seam = Math.floor(r() * 16);
    for (let yy = 0; yy < 4; yy++) {
      const y = b * 4 + yy;
      for (let x = 0; x < 16; x++) {
        let c = mul(base, shade * (0.95 + r() * 0.08));
        if (yy === 3) c = mul(c, 0.72);
        if (yy === 0) c = mul(c, 1.05);
        if (x === seam && yy < 3) c = mul(c, 0.75);
        if (r() < 0.06) c = mul(c, 0.86);
        t.set(x, y, c);
      }
    }
  }
}
P.oak_planks = (t, r) => planks(t, r, [162, 130, 78]);
P.birch_planks = (t, r) => planks(t, r, [196, 176, 118]);
P.spruce_planks = (t, r) => planks(t, r, [114, 84, 48]);

function leaves(t, r, holes) {
  const n = vnoise(r, 8);
  let sum = [0, 0, 0], cnt = 0;
  t.each((x, y) => {
    const v = 150 + (n(x, y) - 0.5) * 60 + (r() - 0.5) * 70;
    t.set(x, y, [v, v, v]);
    sum[0] += v; cnt++;
  });
  const avg = sum[0] / cnt;
  t.each((x, y) => {
    if (r() < holes) t.set(x, y, [avg, avg, avg], 0);
  });
}
P.oak_leaves = (t, r) => leaves(t, r, 0.2);
P.birch_leaves = (t, r) => leaves(t, r, 0.22);
P.spruce_leaves = (t, r) => {
  leaves(t, r, 0.14);
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    if (t.alpha(x, y)) t.set(x, y, [110, 110, 110]);
  }
};

P.glass = (t, r) => {
  t.fill([200, 220, 228], 0);
  for (let i = 0; i < 16; i++) {
    t.set(i, 0, [220, 238, 244]);
    t.set(i, 15, [190, 214, 224]);
    t.set(0, i, [220, 238, 244]);
    t.set(15, i, [190, 214, 224]);
  }
  for (const [x, y] of [[3, 3], [4, 2], [2, 4], [11, 4], [12, 3], [5, 9], [6, 8]]) t.set(x, y, [236, 248, 252], 220);
};

function oreOn(t, r, get, colors, clusters = 4) {
  t.copyFrom(get('stone'));
  for (let c = 0; c < clusters; c++) {
    const cx = 2 + Math.floor(r() * 12), cy = 2 + Math.floor(r() * 12);
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const x = cx + Math.floor(r() * 3) - 1, y = cy + Math.floor(r() * 3) - 1;
      t.set(x, y, colors[0]);
      if (r() < 0.6) t.set(x + 1, y, colors[1]);
      if (r() < 0.3) t.set(x, y - 1, colors[2] || colors[0]);
    }
  }
}
P.coal_ore = (t, r, get) => oreOn(t, r, get, [[38, 38, 38], [60, 60, 60], [20, 20, 20]], 5);
P.iron_ore = (t, r, get) => oreOn(t, r, get, [[216, 175, 147], [190, 146, 118], [236, 206, 186]]);
P.gold_ore = (t, r, get) => oreOn(t, r, get, [[252, 222, 70], [216, 170, 30], [255, 250, 160]]);
P.diamond_ore = (t, r, get) => oreOn(t, r, get, [[94, 232, 222], [40, 170, 168], [210, 255, 252]]);
P.lapis_ore = (t, r, get) => oreOn(t, r, get, [[32, 72, 186], [20, 46, 130], [70, 120, 230]], 5);

function metalBlock(t, r, base, light, dark) {
  t.each((x, y) => {
    let c = mul(base, 0.97 + r() * 0.05);
    if (x === 0 || y === 0) c = light;
    if (x === 15 || y === 15) c = dark;
    if ((y === 5 || y === 10) && x > 0 && x < 15) c = mul(base, 0.9);
    t.set(x, y, c);
  });
}
P.iron_block = (t, r) => metalBlock(t, r, [216, 216, 216], [244, 244, 244], [160, 160, 160]);
P.gold_block = (t, r) => metalBlock(t, r, [246, 208, 60], [255, 246, 150], [196, 140, 20]);
P.diamond_block = (t, r) => metalBlock(t, r, [104, 222, 214], [190, 255, 250], [40, 150, 150]);
P.coal_block = (t, r) => {
  t.each((x, y) => t.set(x, y, mul([26, 26, 28], 0.8 + r() * 0.5)));
};
P.lapis_block = (t, r) => {
  t.each((x, y) => {
    let c = mul([36, 70, 168], 0.85 + r() * 0.3);
    if (x === 0 || y === 0) c = [70, 110, 210];
    if (x === 15 || y === 15) c = [22, 44, 110];
    t.set(x, y, c);
  });
  for (let i = 0; i < 8; i++) t.set(1 + Math.floor(r() * 14), 1 + Math.floor(r() * 14), [220, 190, 80]);
};

P.bricks = (t, r) => {
  t.each((x, y) => {
    const row = Math.floor(y / 4);
    const off = row % 2 === 0 ? 0 : 4;
    const mortar = y % 4 === 3 || (x + off) % 8 === 7;
    if (mortar) t.set(x, y, mul([172, 162, 152], 0.9 + r() * 0.15));
    else {
      const brick = Math.floor((x + off) / 8) + row * 3;
      const shade = 0.88 + ((brick * 37) % 10) / 40;
      let c = mul([150, 72, 56], shade * (0.92 + r() * 0.14));
      if (y % 4 === 0) c = mul(c, 1.1);
      t.set(x, y, c);
    }
  });
};

function stoneBricks(t, r, moss, cracked) {
  const mn = vnoise(r, 4);
  t.each((x, y) => {
    const row = Math.floor(y / 8);
    const off = row === 0 ? 0 : 8;
    const yy = y % 8, xx = (x + off) % 16;
    let c = mul([122, 122, 122], 0.93 + r() * 0.1);
    if (yy === 7 || xx === 15) c = [74, 74, 76];
    else if (yy === 0 || xx === 0) c = [150, 150, 150];
    else if (yy === 6 || xx === 14) c = [104, 104, 104];
    if (moss && mn(x, y) > 0.55) c = mix(c, [74, 110, 46], 0.7 + r() * 0.2);
    t.set(x, y, c);
  });
  if (cracked) {
    let x = 3 + Math.floor(r() * 4), y = 1;
    for (let i = 0; i < 14; i++) {
      t.setw(x, y, [60, 60, 62]);
      y++;
      x += Math.floor(r() * 3) - 1;
    }
  }
}
P.stone_bricks = (t, r) => stoneBricks(t, r, false, false);
P.mossy_stone_bricks = (t, r) => stoneBricks(t, r, true, false);
P.cracked_stone_bricks = (t, r) => stoneBricks(t, r, false, true);

P.smooth_stone = (t, r) => {
  t.each((x, y) => {
    let c = mul([160, 160, 160], 0.97 + r() * 0.05);
    if (x === 0 || y === 0 || x === 15 || y === 15) c = [130, 130, 130];
    t.set(x, y, c);
  });
};
P.smooth_stone_slab_side = (t, r) => {
  t.each((x, y) => {
    let c = mul([164, 164, 164], 0.97 + r() * 0.05);
    if (y === 0 || y === 8) c = [186, 186, 186];
    if (y === 7 || y === 15) c = [120, 120, 120];
    if (x === 0 || x === 15) c = mul(c, 0.9);
    t.set(x, y, c);
  });
};

P.obsidian = (t, r) => {
  const n = vnoise(r, 8);
  t.each((x, y) => {
    const v = n(x, y);
    let c = mul([20, 16, 32], 0.8 + v * 0.6);
    if (r() < 0.06) c = [70, 46, 110];
    t.set(x, y, c);
  });
};

P.glowstone = (t, r) => {
  const pts = [];
  for (let i = 0; i < 9; i++) pts.push([r() * 16, r() * 16, 0.75 + r() * 0.35]);
  t.each((x, y) => {
    let d1 = 99, d2 = 99, id = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = wrapDist(x + 0.5, y + 0.5, pts[i][0], pts[i][1]);
      if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
    }
    let c = d2 - d1 < 0.9 ? [140, 96, 50] : mul([252, 210, 120], pts[id][2] * (0.92 + r() * 0.12));
    if (d1 < 1.2) c = [255, 244, 200];
    t.set(x, y, c);
  });
};

P.tnt_side = (t, r) => {
  t.each((x, y) => {
    let c = mul([200, 52, 36], 0.9 + r() * 0.15);
    if (x % 4 === 3) c = mul(c, 0.8);
    if (y >= 5 && y <= 10) c = [232, 228, 220];
    if (y === 5 || y === 10) c = [180, 176, 170];
    t.set(x, y, c);
  });
  // A stylised blast mark across the white band.
  const mark = ['..#..#..#..#..', '.###.##.###.#.', '..#..#.#.#..#.'];
  for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 14; xx++) if (mark[yy][xx] === '#') t.set(xx + 1, 6 + yy, [40, 34, 30]);
};
P.tnt_top = (t, r) => {
  t.each((x, y) => {
    let c = mul([212, 70, 52], 0.9 + r() * 0.15);
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d < 3) c = [220, 210, 190];
    if (d < 1) c = [60, 50, 40];
    t.set(x, y, c);
  });
};
P.tnt_bottom = (t, r) => {
  t.each((x, y) => t.set(x, y, mul([190, 56, 40], 0.9 + r() * 0.15)));
};

P.bookshelf = (t, r, get) => {
  t.copyFrom(get('oak_planks'));
  const books = [[150, 40, 34], [52, 84, 150], [60, 120, 52], [180, 150, 60], [110, 60, 120], [200, 200, 190], [140, 90, 50]];
  for (const shelfY of [1, 9]) {
    let x = 1;
    while (x < 15) {
      const w = r() < 0.75 ? 1 : 2;
      const h = 4 + Math.floor(r() * 3);
      const c = books[Math.floor(r() * books.length)];
      for (let xx = 0; xx < w && x + xx < 15; xx++) {
        for (let y = 0; y < 6; y++) {
          const yy = shelfY + y;
          if (y < 6 - h) t.set(x + xx, yy, [44, 30, 18]);
          else t.set(x + xx, yy, mul(c, xx === 0 ? 1 : 0.8));
        }
      }
      x += w;
    }
    for (let xx = 0; xx < 16; xx++) t.set(xx, shelfY + 6, [96, 72, 40]);
  }
};

function tableTop(t, r, get) {
  t.copyFrom(get('oak_planks'));
  t.each((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) t.set(x, y, [90, 64, 36]);
    if ((x === 5 || x === 10 || y === 5 || y === 10) && x > 0 && y > 0 && x < 15 && y < 15) t.set(x, y, [120, 92, 54]);
  });
}
P.crafting_table_top = (t, r, get) => tableTop(t, r, get);
P.crafting_table_side = (t, r, get) => {
  t.copyFrom(get('oak_planks'));
  for (let x = 0; x < 16; x++) {
    t.set(x, 0, [196, 160, 100]);
    t.set(x, 1, [110, 80, 46]);
  }
  // hanging saw
  for (let y = 4; y < 12; y++) for (let x = 3; x < 6; x++) t.set(x, y, [170, 170, 176]);
  for (let y = 4; y < 12; y += 2) t.set(2, y, [130, 130, 136]);
  for (let y = 11; y < 14; y++) t.set(4, y, [90, 60, 30]);
  // hammer
  for (let y = 5; y < 13; y++) t.set(11, y, [110, 76, 40]);
  for (let x = 9; x < 14; x++) for (let y = 4; y < 6; y++) t.set(x, y, [96, 96, 104]);
};
P.crafting_table_front = (t, r, get) => {
  t.copyFrom(get('oak_planks'));
  for (let x = 0; x < 16; x++) {
    t.set(x, 0, [196, 160, 100]);
    t.set(x, 1, [110, 80, 46]);
  }
  // pliers and a small chisel
  for (let i = 0; i < 7; i++) {
    t.set(3 + i, 5 + i, [140, 140, 148]);
    t.set(9 - i, 5 + i, [120, 120, 128]);
  }
  for (let y = 4; y < 13; y++) t.set(12, y, y < 8 ? [180, 180, 186] : [120, 80, 40]);
};

function furnaceBase(t, r, get) {
  t.copyFrom(get('cobblestone'));
  t.each((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) t.set(x, y, mul(t.get(x, y), 0.8));
  });
}
P.furnace_side = (t, r, get) => furnaceBase(t, r, get);
P.furnace_top = (t, r, get) => {
  t.copyFrom(get('smooth_stone'));
};
function furnaceFront(t, r, get, lit) {
  furnaceBase(t, r, get);
  for (let x = 3; x < 13; x++) for (let y = 3; y < 7; y++) t.set(x, y, mul([92, 92, 92], 0.9 + r() * 0.1));
  for (let x = 3; x < 13; x++) t.set(x, 3, [150, 150, 150]);
  for (let x = 4; x < 12; x++) {
    for (let y = 9; y < 14; y++) {
      let c = [24, 22, 22];
      if (lit) {
        const h = 13 - y;
        c = h < 2 ? [255, 200 - r() * 60, 40] : h < 3 ? [230, 110, 30] : r() < 0.4 ? [200, 70, 20] : [40, 22, 16];
      }
      t.set(x, y, c);
    }
  }
  for (let x = 3; x < 13; x++) t.set(x, 8, [70, 70, 70]);
  for (let y = 8; y < 15; y++) {
    t.set(3, y, [70, 70, 70]);
    t.set(12, y, [70, 70, 70]);
  }
}
P.furnace_front = (t, r, get) => furnaceFront(t, r, get, false);
P.furnace_front_on = (t, r, get) => furnaceFront(t, r, get, true);

function chestWood(t, r) {
  t.each((x, y) => {
    let c = mul([168, 112, 44], 0.9 + r() * 0.15);
    if ((y + Math.floor(x / 5)) % 4 === 0) c = mul(c, 0.88);
    t.set(x, y, c);
  });
}
P.chest_top = (t, r) => {
  chestWood(t, r);
  t.each((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) t.set(x, y, [70, 44, 20]);
  });
};
P.chest_side = (t, r) => {
  chestWood(t, r);
  t.each((x, y) => {
    if (x === 0 || x === 15 || y === 15 || y === 2) t.set(x, y, [70, 44, 20]);
    if (y === 6 || y === 7) t.set(x, y, [58, 36, 16]);
  });
};
P.chest_front = (t, r, get) => {
  t.copyFrom(get('chest_side'));
  for (let y = 5; y < 10; y++) for (let x = 6; x < 10; x++) t.set(x, y, y === 5 || x === 6 ? [220, 220, 226] : [150, 150, 160]);
  t.set(7, 8, [40, 40, 44]);
  t.set(8, 8, [40, 40, 44]);
};

P.torch = (t) => {
  t.fill([0, 0, 0], 0);
  for (let y = 7; y < 16; y++) {
    t.set(7, y, [124, 92, 52]);
    t.set(8, y, [92, 66, 34]);
  }
  t.set(7, 6, [255, 236, 120]);
  t.set(8, 6, [255, 210, 70]);
  t.set(7, 7, [255, 180, 60]);
  t.set(8, 7, [234, 120, 30]);
  t.set(7, 5, [255, 255, 200]);
  t.set(8, 5, [255, 230, 120]);
};

P.ladder = (t, r) => {
  t.fill([0, 0, 0], 0);
  for (let y = 0; y < 16; y++) {
    for (const x of [2, 13]) {
      t.set(x, y, [140, 104, 56]);
      t.set(x + (x === 2 ? 1 : -1), y, [104, 76, 40]);
    }
  }
  for (const y of [1, 5, 9, 13]) {
    for (let x = 2; x < 14; x++) t.set(x, y, mul([154, 116, 64], 0.95 + r() * 0.1));
    for (let x = 4; x < 12; x++) t.set(x, y + 1, [92, 66, 34]);
  }
};

function doorPanel(t, r, top) {
  planks(t, r, [156, 122, 70]);
  t.each((x, y) => {
    if (x === 0 || x === 15) t.set(x, y, [96, 70, 38]);
    if (top && y === 0) t.set(x, y, [96, 70, 38]);
    if (!top && y === 15) t.set(x, y, [96, 70, 38]);
  });
  if (top) {
    for (const [x0, y0] of [[3, 3], [9, 3]]) {
      for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 4; x++) t.set(x, y, [0, 0, 0], 0);
    }
  } else {
    for (let y = 3; y < 13; y++) {
      t.set(3, y, [110, 82, 44]);
      t.set(12, y, [110, 82, 44]);
    }
    t.set(12, 1, [60, 60, 66]);
    t.set(13, 1, [60, 60, 66]);
  }
}
P.oak_door_top = (t, r) => doorPanel(t, r, true);
P.oak_door_bottom = (t, r) => doorPanel(t, r, false);

P.cactus_side = (t, r) => {
  t.fill([0, 0, 0], 0);
  for (let y = 0; y < 16; y++) {
    for (let x = 1; x < 15; x++) {
      let c = mul([88, 140, 48], 0.9 + r() * 0.15);
      if (x === 4 || x === 11) c = mul(c, 0.78);
      if (x === 1 || x === 14) c = mul(c, 0.7);
      t.set(x, y, c);
    }
  }
  for (let i = 0; i < 10; i++) t.set(1 + Math.floor(r() * 14), Math.floor(r() * 16), [230, 230, 200]);
};
P.cactus_top = (t, r) => {
  t.fill([0, 0, 0], 0);
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    t.set(x, y, mul(d > 5 ? [70, 120, 40] : [110, 164, 64], 0.92 + r() * 0.12));
  }
};
P.cactus_bottom = (t, r) => P.cactus_top(t, r);

P.pumpkin_side = (t, r) => {
  t.each((x, y) => {
    let c = mul([214, 120, 26], 0.92 + r() * 0.1);
    if (x % 4 === 0) c = mul(c, 0.8);
    if (y === 0 || y === 15) c = mul(c, 0.85);
    t.set(x, y, c);
  });
};
P.pumpkin_top = (t, r) => {
  t.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let c = mul([206, 114, 24], 0.92 + r() * 0.1);
    if (Math.floor(d) % 3 === 2) c = mul(c, 0.85);
    if (d < 1.5) c = [96, 76, 30];
    t.set(x, y, c);
  });
};
function carvedFace(t, r, get, lit) {
  t.copyFrom(get('pumpkin_side'));
  const inside = lit ? [255, 214, 70] : [52, 30, 10];
  const eye = (x0, y0) => {
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (x >= 2 - y || y === 2) t.set(x0 + x, y0 + y, inside);
  };
  eye(3, 4);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (x <= y || y === 2) t.set(10 + x, 4 + y, inside);
  for (let x = 3; x < 13; x++) t.set(x, 10, inside);
  for (let x = 4; x < 12; x++) if (x !== 6 && x !== 9) t.set(x, 11, inside);
  t.set(5, 9, inside);
  t.set(10, 9, inside);
}
P.pumpkin_face = (t, r, get) => carvedFace(t, r, get, false);
P.jack_o_lantern = (t, r, get) => carvedFace(t, r, get, true);

P.melon_side = (t, r) => {
  t.each((x, y) => {
    let c = mul([108, 152, 34], 0.9 + r() * 0.12);
    if ((x + (y % 5 === 0 ? 1 : 0)) % 4 === 1) c = mul([62, 100, 22], 0.9 + r() * 0.15);
    t.set(x, y, c);
  });
};
P.melon_top = (t, r) => {
  t.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let c = mul([112, 156, 36], 0.9 + r() * 0.12);
    if (Math.floor(d) % 3 === 1) c = mul([70, 110, 26], 0.95);
    if (d < 1) c = [86, 70, 30];
    t.set(x, y, c);
  });
};

// Plants (cross-shaped). Transparent background.
function stem(t, x, y0, y1, c) {
  for (let y = y0; y <= y1; y++) t.set(x, y, c);
}
P.tall_grass = (t, r) => {
  t.fill([0, 0, 0], 0);
  for (let i = 0; i < 9; i++) {
    let x = 1 + Math.floor(r() * 14);
    const h = 6 + Math.floor(r() * 9);
    for (let y = 15; y > 15 - h; y--) {
      const v = 140 + (15 - y) * 5 + r() * 30;
      t.set(x, y, [v, v, v]);
      if (r() < 0.2) x += r() < 0.5 ? 1 : -1;
      x = Math.max(0, Math.min(15, x));
    }
  }
};
P.fern = (t, r) => {
  t.fill([0, 0, 0], 0);
  for (const cx of [4, 8, 12]) {
    const h = 9 + Math.floor(r() * 5);
    for (let i = 0; i < h; i++) {
      const y = 15 - i;
      const x = cx + Math.round(Math.sin(i * 0.3) * 0.8);
      t.set(x, y, [130, 130, 130]);
      if (i > 2 && i % 2 === 0) {
        const w = Math.max(1, Math.floor((h - i) / 3));
        for (let k = 1; k <= w; k++) {
          const a = 165 + r() * 30, b = 160 + r() * 30;
          t.set(x - k, y - (k > 1 ? 1 : 0), [a, a, a]);
          t.set(x + k, y - (k > 1 ? 1 : 0), [b, b, b]);
        }
      }
    }
  }
};
P.dead_bush = (t, r) => {
  t.fill([0, 0, 0], 0);
  const c = [124, 84, 40];
  const branch = (x, y, dx, len) => {
    for (let i = 0; i < len; i++) {
      t.set(x, y, mul(c, 0.85 + r() * 0.3));
      y--;
      if (r() < 0.6) x += dx;
    }
  };
  stem(t, 8, 12, 15, c);
  branch(8, 12, -1, 7);
  branch(8, 12, 1, 7);
  branch(7, 10, -1, 4);
  branch(9, 9, 1, 5);
  branch(8, 11, 0, 6);
};
function flower(t, r, petal, center, kind) {
  t.fill([0, 0, 0], 0);
  const stemC = [64, 124, 40];
  stem(t, 8, 8, 15, stemC);
  t.set(7, 12, stemC);
  t.set(6, 11, [80, 146, 50]);
  t.set(9, 13, stemC);
  t.set(10, 12, [80, 146, 50]);
  if (kind === 'cup') {
    for (const [x, y] of [[7, 4], [8, 4], [9, 4], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [7, 7], [8, 7], [9, 7]]) t.set(x, y, mul(petal, 0.9 + r() * 0.2));
    t.set(8, 5, center);
    t.set(8, 6, center);
  } else if (kind === 'star') {
    for (const [x, y] of [[8, 3], [8, 4], [6, 5], [10, 5], [5, 6], [11, 6], [7, 5], [9, 5], [7, 7], [9, 7], [6, 8], [10, 8], [8, 8], [7, 6], [9, 6]]) t.set(x, y, mul(petal, 0.85 + r() * 0.25));
    t.set(8, 6, center);
    t.set(8, 5, mul(center, 0.9));
  } else {
    for (const [x, y] of [[8, 3], [7, 4], [9, 4], [6, 5], [10, 5], [6, 6], [10, 6], [7, 7], [9, 7], [8, 7], [5, 5], [11, 5], [7, 3], [9, 3]]) t.set(x, y, mul(petal, 0.9 + r() * 0.15));
    t.set(8, 5, center);
    t.set(8, 4, center);
    t.set(7, 5, center);
    t.set(9, 5, center);
    t.set(8, 6, center);
    t.set(7, 6, mul(center, 0.85));
    t.set(9, 6, mul(center, 0.85));
  }
}
P.dandelion = (t, r) => flower(t, r, [250, 214, 40], [232, 170, 20], 'cup');
P.poppy = (t, r) => flower(t, r, [214, 30, 26], [40, 20, 20], 'cup');
P.cornflower = (t, r) => flower(t, r, [70, 100, 220], [40, 50, 140], 'star');
P.oxeye_daisy = (t, r) => flower(t, r, [244, 244, 236], [240, 200, 40], 'daisy');

function sapling(t, r, leaf, trunk, conical) {
  t.fill([0, 0, 0], 0);
  stem(t, 8, 9, 15, trunk);
  stem(t, 7, 12, 15, mul(trunk, 0.8));
  if (conical) {
    for (let y = 1; y < 12; y++) {
      const w = Math.floor((y - 1) / 2.2) + (y % 3 === 0 ? 0 : 1);
      for (let x = 8 - w; x <= 8 + w; x++) if (r() > 0.12) t.set(x, y, mul(leaf, 0.75 + r() * 0.4));
    }
  } else {
    for (let y = 1; y < 11; y++) for (let x = 2; x < 15; x++) {
      const d = Math.hypot(x - 8, (y - 5.5) * 1.2);
      if (d < 5.5 && r() > 0.18) t.set(x, y, mul(leaf, 0.7 + r() * 0.45));
    }
  }
}
P.oak_sapling = (t, r) => sapling(t, r, [70, 140, 40], [104, 78, 40], false);
P.birch_sapling = (t, r) => sapling(t, r, [118, 168, 70], [210, 208, 196], false);
P.spruce_sapling = (t, r) => sapling(t, r, [48, 92, 52], [74, 50, 24], true);

P.brown_mushroom = (t, r) => {
  t.fill([0, 0, 0], 0);
  stem(t, 7, 10, 15, [222, 212, 190]);
  stem(t, 8, 10, 15, [196, 186, 164]);
  for (let y = 6; y < 10; y++) {
    const w = y === 6 ? 2 : y === 7 ? 4 : 5;
    for (let x = 8 - w; x < 8 + w; x++) t.set(x, y, mul([150, 110, 80], 0.9 + r() * 0.2));
  }
};
P.red_mushroom = (t, r) => {
  t.fill([0, 0, 0], 0);
  stem(t, 7, 10, 15, [230, 224, 210]);
  stem(t, 8, 10, 15, [200, 194, 180]);
  for (let y = 4; y < 10; y++) {
    const w = y === 4 ? 2 : y === 5 ? 4 : 5;
    for (let x = 8 - w; x < 8 + w; x++) t.set(x, y, mul([212, 34, 30], 0.88 + r() * 0.2));
  }
  for (const [x, y] of [[6, 5], [10, 6], [4, 8], [8, 7], [11, 8]]) t.set(x, y, [245, 240, 236]);
};

P.sugar_cane = (t, r) => {
  t.fill([0, 0, 0], 0);
  for (const x of [3, 8, 12]) {
    for (let y = 0; y < 16; y++) {
      let c = mul([150, 196, 104], 0.88 + r() * 0.12);
      if ((y + x) % 5 === 0) c = [116, 152, 70];
      t.set(x, y, c);
      t.set(x + 1, y, mul(c, 0.8));
    }
    t.set(x - 1, (x * 3) % 16, [120, 180, 80]);
    t.set(x + 2, (x * 5 + 4) % 16, [120, 180, 80]);
  }
};

function cropStage(t, r, stage, maxStage, ripe) {
  t.fill([0, 0, 0], 0);
  const h = Math.round(3 + (stage / maxStage) * 11);
  for (const cx of [2, 5, 8, 11, 14]) {
    for (let i = 0; i < h; i++) {
      const y = 15 - i;
      const x = cx + (i > h / 2 && cx % 2 ? 1 : 0);
      const frac = i / h;
      let c = stage === maxStage && ripe ? mix([150, 130, 50], ripe, frac) : mix([60, 120, 30], [110, 170, 50], frac);
      t.set(x, y, mul(c, 0.85 + r() * 0.25));
    }
    if (stage === maxStage && ripe) {
      for (let i = 0; i < 4; i++) {
        t.set(cx - 1, 15 - h + 1 + i, mul(ripe, 0.85 + r() * 0.2));
        t.set(cx + 1, 15 - h + 1 + i, mul(ripe, 0.75 + r() * 0.2));
      }
    }
  }
}
for (let s = 0; s < 8; s++) P['wheat_' + s] = (t, r) => cropStage(t, r, s, 7, [214, 188, 84]);
function rootCrop(t, r, stage, root) {
  t.fill([0, 0, 0], 0);
  const h = 4 + stage * 3;
  for (const cx of [3, 8, 12]) {
    for (let i = 0; i < h; i++) {
      const y = 15 - i;
      t.set(cx, y, mul([70, 140, 40], 0.85 + r() * 0.3));
      if (i > 1 && i % 2 === 0) {
        t.set(cx - 1, y, mul([90, 160, 50], 0.85 + r() * 0.3));
        t.set(cx + 1, y - 1, mul([60, 130, 36], 0.85 + r() * 0.3));
      }
    }
    if (stage === 3) {
      t.set(cx, 15, root);
      t.set(cx + 1, 15, mul(root, 0.8));
      t.set(cx, 14, mul(root, 0.9));
    }
  }
}
for (let s = 0; s < 4; s++) {
  P['carrots_' + s] = (t, r) => rootCrop(t, r, s, [240, 130, 30]);
  P['potatoes_' + s] = (t, r) => rootCrop(t, r, s, [200, 170, 90]);
}

P.farmland = (t, r) => {
  t.each((x, y) => {
    let c = mul([140, 100, 66], 0.9 + r() * 0.15);
    if (y % 4 === 0) c = mul(c, 0.7);
    if (x === 0 || x === 15) c = mul(c, 0.85);
    t.set(x, y, c);
  });
};
P.farmland_moist = (t, r) => {
  t.each((x, y) => {
    let c = mul([82, 54, 32], 0.9 + r() * 0.15);
    if (y % 4 === 0) c = mul(c, 0.7);
    t.set(x, y, c);
  });
};

// Bed: the mattress is the top 9 px of a block, so side textures draw the
// frame in rows 7..15 (the part of the tile a 9px tall box samples).
P.bed_head_top = (t, r) => {
  t.each((x, y) => {
    let c = mul([170, 34, 34], 0.92 + r() * 0.1);
    if (y < 7) c = mul([236, 236, 236], 0.95 + r() * 0.05);
    if (y === 7) c = [200, 200, 200];
    if (x === 0 || x === 15) c = mul(c, 0.85);
    t.set(x, y, c);
  });
};
P.bed_foot_top = (t, r) => {
  t.each((x, y) => {
    let c = mul([170, 34, 34], 0.92 + r() * 0.1);
    if (y === 13) c = [130, 24, 24];
    if (x === 0 || x === 15) c = mul(c, 0.85);
    t.set(x, y, c);
  });
};
function bedSide(t, r, head) {
  t.fill([0, 0, 0], 0);
  for (let y = 7; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = null;
      if (y < 10) c = head && x < 7 ? [236, 236, 236] : mul([170, 34, 34], 0.92 + r() * 0.1);
      else if (y < 13) c = mul([150, 112, 60], 0.9 + r() * 0.15);
      else if ((head && x < 3) || (!head && x > 12)) c = [110, 80, 40];
      if (c) t.set(x, y, c);
    }
  }
}
P.bed_head_side = (t, r) => bedSide(t, r, true);
P.bed_foot_side = (t, r) => bedSide(t, r, false);
P.bed_head_end = (t, r) => {
  t.fill([0, 0, 0], 0);
  for (let y = 7; y < 16; y++) for (let x = 0; x < 16; x++) {
    let c = null;
    if (y < 13) c = mul([150, 112, 60], 0.9 + r() * 0.15);
    if (y < 10 && x > 1 && x < 14) c = [236, 236, 236];
    if (y >= 13 && (x < 3 || x > 12)) c = [110, 80, 40];
    if (c) t.set(x, y, c);
  }
};
P.bed_foot_end = (t, r) => {
  t.fill([0, 0, 0], 0);
  for (let y = 7; y < 16; y++) for (let x = 0; x < 16; x++) {
    let c = null;
    if (y < 10) c = mul([170, 34, 34], 0.92 + r() * 0.1);
    else if (y < 13) c = mul([150, 112, 60], 0.9 + r() * 0.15);
    else if (x < 3 || x > 12) c = [110, 80, 40];
    if (c) t.set(x, y, c);
  }
};

for (const [c, , rgb] of WOOL_COLORS) {
  P[c + '_wool'] = (t, r) => {
    t.each((x, y) => {
      const knit = ((x + y) % 4 === 0 ? 0.92 : 1) * ((x - y + 16) % 4 === 0 ? 0.94 : 1);
      t.set(x, y, mul(rgb, knit * (0.94 + r() * 0.08)));
    });
  };
}

// Particles
function blobParticle(t, r, c, radius, soft) {
  t.fill([0, 0, 0], 0);
  t.each((x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < radius - (soft ? r() * 1.5 : 0)) t.set(x, y, mul(c, 0.85 + r() * 0.3));
  });
}
P.particle_smoke = (t, r) => blobParticle(t, r, [200, 200, 200], 6, true);
P.particle_poof = (t, r) => blobParticle(t, r, [236, 236, 236], 7, true);
P.particle_flame = (t, r) => {
  t.fill([0, 0, 0], 0);
  t.each((x, y) => {
    const d = Math.hypot((x - 7.5) * 1.3, y - 9);
    if (d < 6 - (8 - y) * 0.3) t.set(x, y, d < 2.5 ? [255, 240, 160] : d < 4 ? [255, 180, 50] : [230, 90, 20]);
  });
};
P.particle_bubble = (t) => {
  t.fill([0, 0, 0], 0);
  t.each((x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 6 && d > 4.5) t.set(x, y, [200, 230, 255]);
  });
  t.set(5, 5, [255, 255, 255]);
  t.set(6, 5, [255, 255, 255]);
};
P.particle_splash = (t) => {
  t.fill([0, 0, 0], 0);
  t.each((x, y) => {
    const d = Math.hypot(x - 7.5, (y - 8) * 0.8);
    if (d < 5) t.set(x, y, [80, 130, 230]);
  });
};
P.particle_crit = (t) => {
  t.fill([0, 0, 0], 0);
  for (let i = 2; i < 14; i++) {
    t.set(i, 7, [255, 255, 255]);
    t.set(i, 8, [255, 255, 255]);
    t.set(7, i, [255, 255, 255]);
    t.set(8, i, [255, 255, 255]);
  }
};
P.particle_heart = (t) => {
  t.fill([0, 0, 0], 0);
  const rows = ['..XX...XX..', '.XXXX.XXXX.', 'XXXXXXXXXXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..XXXXXXX..', '...XXXXX...', '....XXX....', '.....X.....'];
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === 'X' && t.set(x + 2, y + 3, [230, 40, 50])));
};
P.particle_spark = (t) => blobParticle(t, () => 0.5, [255, 255, 255], 3, false);

// Animated tiles: generated as consecutive frames.
export const ANIMATED = {
  water_still: { frames: 8, fps: 5 },
  lava_still: { frames: 8, fps: 3 },
  fire: { frames: 8, fps: 10 },
};

function waterFrame(t, r, f) {
  const base = [44, 92, 200];
  t.each((x, y) => {
    const w = Math.sin((x * 0.6 + y * 0.35) + f * (Math.PI * 2 / 8)) * 0.5 + Math.sin((x * -0.3 + y * 0.7) + f * (Math.PI * 2 / 8) * 2) * 0.5;
    const c = mul(base, 0.92 + w * 0.08 + (r() - 0.5) * 0.04);
    t.set(x, y, c, 175);
  });
}
function lavaFrame(t, r, f, noiseA, noiseB) {
  t.each((x, y) => {
    const ph = f / 8;
    const v = noiseA((x + ph * 16) % 16, (y + ph * 8) % 16) * 0.6 + noiseB((x - ph * 8 + 16) % 16, y) * 0.4;
    const c = v > 0.62 ? [255, 236, 120] : v > 0.48 ? [250, 160, 30] : v > 0.35 ? [222, 92, 16] : [180, 54, 10];
    t.set(x, y, mul(c, 0.95 + r() * 0.08));
  });
}
function fireFrame(t, r, f) {
  t.fill([0, 0, 0], 0);
  const heat = new Float32Array(16 * 20);
  const rr = mulberry32(1234 + f * 77);
  for (let x = 0; x < 16; x++) heat[19 * 16 + x] = 0.7 + rr() * 0.6;
  for (let y = 18; y >= 0; y--) {
    for (let x = 0; x < 16; x++) {
      const below = heat[(y + 1) * 16 + x];
      const l = heat[(y + 1) * 16 + ((x + 15) % 16)];
      const rt = heat[(y + 1) * 16 + ((x + 1) % 16)];
      heat[y * 16 + x] = Math.max(0, (below * 2 + l + rt) / 4 - 0.035 - rr() * 0.05);
    }
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const h = heat[(y + 4) * 16 + x];
      if (h < 0.2) continue;
      const c = h > 0.75 ? [255, 246, 170] : h > 0.55 ? [255, 196, 60] : h > 0.38 ? [240, 120, 20] : [200, 60, 10];
      t.set(x, y, c, 255);
    }
  }
}

// Destroy (crack) overlay stages.
// The same crack network is revealed a little more at every stage.
const CRACK_WALKS = (() => {
  const rr = mulberry32(777);
  const walks = [];
  for (let k = 0; k < 9; k++) {
    const ang = (k / 9) * Math.PI * 2 + rr() * 0.5;
    let x = 7.5 + Math.cos(ang) * 1.2, y = 7.5 + Math.sin(ang) * 1.2;
    const pts = [];
    for (let i = 0; i < 12; i++) {
      pts.push([Math.floor(x), Math.floor(y)]);
      const a = ang + (rr() - 0.5) * 1.6;
      x += Math.cos(a) * 0.95;
      y += Math.sin(a) * 0.95;
    }
    walks.push(pts);
  }
  return walks;
})();
function destroyStage(t, stage) {
  t.fill([0, 0, 0], 0);
  const walks = Math.min(CRACK_WALKS.length, 2 + stage);
  const len = 2 + Math.floor(stage * 1.1);
  for (let k = 0; k < walks; k++) {
    for (let i = 0; i < len; i++) {
      const [x, y] = CRACK_WALKS[k][i];
      t.setw(x, y, [18, 18, 18], 190);
    }
  }
}

// ---------------------------------------------------------------- build
export function generateTiles() {
  const tiles = new Map();
  const anim = new Map();
  const get = (name) => {
    if (!tiles.has(name)) paint(name);
    return tiles.get(name);
  };
  function paint(name) {
    const painter = P[name];
    const t = new Tile();
    if (!painter) {
      // Magenta/black checker for anything missing.
      t.each((x, y) => t.set(x, y, ((x >> 3) + (y >> 3)) % 2 ? [255, 0, 255] : [0, 0, 0]));
    } else {
      painter(t, mulberry32(hashString(name)), get);
    }
    tiles.set(name, t);
  }
  for (const name of Object.keys(P)) get(name);
  get('missing');

  const names = [];
  const list = [];
  for (const [name, t] of tiles) {
    names.push(name);
    list.push(t);
  }
  // Animated sequences go at the end so their frames are contiguous.
  const lavaRng = mulberry32(99);
  const lavaA = vnoise(lavaRng, 4), lavaB = vnoise(lavaRng, 8);
  for (const [name, a] of Object.entries(ANIMATED)) {
    anim.set(name, { start: list.length, frames: a.frames, fps: a.fps });
    for (let f = 0; f < a.frames; f++) {
      const t = new Tile();
      const r = mulberry32(hashString(name) + f * 31);
      if (name === 'water_still') waterFrame(t, r, f);
      else if (name === 'lava_still') lavaFrame(t, r, f, lavaA, lavaB);
      else fireFrame(t, r, f);
      names.push(f === 0 ? name : `${name}#${f}`);
      list.push(t);
    }
  }
  for (let s = 0; s < 10; s++) {
    const t = new Tile();
    destroyStage(t, s);
    names.push('destroy_' + s);
    list.push(t);
  }

  const index = new Map();
  names.forEach((n, i) => index.set(n, i));
  const data = new Uint8Array(list.length * 1024);
  list.forEach((t, i) => data.set(t.d, i * 1024));
  return { names, index, data, count: list.length, anim, tiles: list };
}

// Default tints for the inventory (biome tint is applied in the world).
export const DEFAULT_TINTS = {
  grass: [124, 189, 76],
  foliage: [92, 171, 60],
  birch: [128, 167, 85],
  spruce: [97, 153, 97],
};
