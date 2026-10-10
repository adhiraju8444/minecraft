// Box models for creatures and the player. Skins are painted procedurally
// into a canvas; every design here is original to this game.
import * as THREE from '../../vendor/three.module.min.js';
import { mulberry32 } from '../util/rng.js';
import { makeEntityMaterial } from './materials.js';

// ---------------------------------------------------------------- painting
function shadeHex(c, f) {
  return [Math.max(0, Math.min(255, c[0] * f)), Math.max(0, Math.min(255, c[1] * f)), Math.max(0, Math.min(255, c[2] * f))];
}
function css(c) {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}
class Painter {
  constructor(g, seed) {
    this.g = g;
    this.r = mulberry32(seed);
  }
  px(x, y, c) {
    this.g.fillStyle = css(c);
    this.g.fillRect(x, y, 1, 1);
  }
  rect(x, y, w, h, c) {
    this.g.fillStyle = css(c);
    this.g.fillRect(x, y, w, h);
  }
  noise(x, y, w, h, c, amt = 0.08) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, shadeHex(c, 1 + (this.r() - 0.5) * 2 * amt));
  }
  // Blotchy two-colour pattern
  patches(x, y, w, h, c, chance) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = Math.sin((x + i) * 0.9 + (y + j) * 0.4) + Math.cos((x + i) * 0.35 - (y + j) * 1.1);
      if (v > 1.4 - chance * 2) this.px(x + i, y + j, shadeHex(c, 0.9 + this.r() * 0.2));
    }
  }
}

// Shelf packer for skin regions.
class Packer {
  constructor(w) {
    this.w = w;
    this.x = 0;
    this.y = 0;
    this.row = 0;
  }
  alloc(w, h) {
    if (this.x + w > this.w) {
      this.x = 0;
      this.y += this.row;
      this.row = 0;
    }
    const r = [this.x, this.y];
    this.x += w;
    this.row = Math.max(this.row, h);
    return r;
  }
  get height() {
    return this.y + this.row;
  }
}

// Box with per-face UV rects. Sizes in pixels (1/16 block).
function boxGeo(from, size, uv, texW, texH, inflate = 0) {
  const [w, h, d] = size;
  const x0 = (from[0] - inflate) / 16, y0 = (from[1] - inflate) / 16, z0 = (from[2] - inflate) / 16;
  const x1 = (from[0] + w + inflate) / 16, y1 = (from[1] + h + inflate) / 16, z1 = (from[2] + d + inflate) / 16;
  const [u, v] = uv;
  const R = {
    top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
  };
  const faces = [
    ['front', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]],
    ['back', [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]],
    ['left', [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]],
    ['right', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]],
    ['top', [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]],
    ['bottom', [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]],
  ];
  const st = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const pos = [], nor = [], uvs = [], idx = [];
  for (const [name, verts, n] of faces) {
    const [ru, rv, rw, rh] = R[name];
    const base = pos.length / 3;
    verts.forEach((p, k) => {
      pos.push(...p);
      nor.push(...n);
      uvs.push((ru + st[k][0] * rw) / texW, (rv + (1 - st[k][1]) * rh) / texH);
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return { geo: g, rects: R };
}

// ---------------------------------------------------------------- definitions
// part: { size, from (relative to pivot), pivot (relative to parent pivot or model origin), parent, paint(face, P, rect) }
const SKIN = [196, 152, 118];
const C = (r, g, b) => [r, g, b];

function humanoid(opts) {
  const aw = opts.armW || 4, lw = opts.legW || 4;
  const ax = aw === 2 ? 5 : 6;
  return {
    body: { size: [8, 12, 4], pivot: [0, 24, 0], from: [-4, -12, -2], paint: opts.body },
    head: { size: [8, 8, 8], pivot: [0, 24, 0], from: [-4, 0, -4], paint: opts.head },
    rightArm: { size: [aw, 12, aw], pivot: [-ax, 22, 0], from: [-aw / 2, -10, -aw / 2], paint: opts.arm },
    leftArm: { size: [aw, 12, aw], pivot: [ax, 22, 0], from: [-aw / 2, -10, -aw / 2], paint: opts.arm },
    rightLeg: { size: [lw, 12, lw], pivot: [-2, 12, 0], from: [-lw / 2, -12, -lw / 2], paint: opts.leg },
    leftLeg: { size: [lw, 12, lw], pivot: [2, 12, 0], from: [-lw / 2, -12, -lw / 2], paint: opts.leg },
  };
}

function face(P, r, opts) {
  // r: [x, y, w, h] of the front face of a head
  const [x, y, w] = r;
  const { eye, eyeHi, mouth, brow } = opts;
  P.rect(x + 1, y + 4, 2, 1, eyeHi || [240, 240, 240]);
  P.rect(x + w - 3, y + 4, 2, 1, eyeHi || [240, 240, 240]);
  P.px(x + 2, y + 4, eye);
  P.px(x + w - 3, y + 4, eye);
  if (brow) {
    P.rect(x + 1, y + 3, 2, 1, brow);
    P.rect(x + w - 3, y + 3, 2, 1, brow);
  }
  if (mouth) P.rect(x + 3, y + 6, 2, 1, mouth);
}

export const MODELS = {
  player: {
    tex: [64, 64],
    // "The Wanderer": black hair, red headband, mustard jacket with a red
    // scarf and satchel strap, charcoal trousers and tan boots.
    parts: humanoid({
      head: (f, P, [x, y, w, h]) => {
        const hair = C(28, 24, 26), band = C(196, 44, 40);
        P.noise(x, y, w, h, SKIN, 0.04);
        if (f === 'top') P.noise(x, y, w, h, hair, 0.12);
        else if (f === 'back') {
          P.noise(x, y, w, h - 1, hair, 0.12);
          P.rect(x, y + 2, w, 1, band);
          P.px(x + 3, y + 3, band);
          P.px(x + 4, y + 4, band);
        } else if (f === 'left' || f === 'right') {
          P.noise(x, y, w, 3, hair, 0.12);
          P.noise(f === 'left' ? x : x + w - 2, y, 2, h - 2, hair, 0.12);
          P.rect(x, y + 2, w, 1, band);
        } else if (f === 'front') {
          P.noise(x, y, w, 2, hair, 0.12);
          P.rect(x, y + 2, w, 1, band);
          P.px(x, y + 3, hair);
          P.px(x + w - 1, y + 3, hair);
          P.rect(x + 1, y + 4, 2, 1, C(250, 250, 250));
          P.rect(x + w - 3, y + 4, 2, 1, C(250, 250, 250));
          P.px(x + 1, y + 4, C(70, 44, 26));
          P.px(x + w - 2, y + 4, C(70, 44, 26));
          P.rect(x + 3, y + 6, 2, 1, C(160, 96, 78));
        } else P.noise(x, y, w, h, shadeHex(SKIN, 0.9), 0.03);
      },
      body: (f, P, [x, y, w, h]) => {
        const jacket = C(214, 164, 52), scarf = C(190, 46, 42), strap = C(104, 66, 36);
        P.noise(x, y, w, h, jacket, 0.07);
        if (f === 'front') {
          P.noise(x, y, w, 3, scarf, 0.08);
          P.rect(x + 5, y + 3, 2, 3, scarf);
          for (let i = 0; i < 8; i++) P.px(x + i, y + 3 + i, strap);
          P.rect(x + 3, y + 4, 1, h - 6, shadeHex(jacket, 0.75));
          P.rect(x, y + h - 2, w, 2, C(58, 56, 62));
        } else if (f === 'back') {
          P.noise(x, y, w, 2, scarf, 0.08);
          for (let i = 0; i < 8; i++) P.px(x + 7 - i, y + 3 + i, strap);
          P.rect(x, y + h - 2, w, 2, C(58, 56, 62));
        } else if (f === 'left' || f === 'right') {
          P.noise(x, y, w, 2, scarf, 0.08);
          P.rect(x, y + h - 2, w, 2, C(58, 56, 62));
          if (f === 'left') P.rect(x + 1, y + 7, 2, 3, C(126, 82, 44));
        } else if (f === 'top') P.noise(x, y, w, h, scarf, 0.08);
      },
      arm: (f, P, [x, y, w, h]) => {
        const jacket = C(214, 164, 52);
        P.noise(x, y, w, h, jacket, 0.07);
        if (f !== 'top' && f !== 'bottom') {
          P.rect(x, y + h - 4, w, 1, shadeHex(jacket, 0.7));
          P.noise(x, y + h - 3, w, 3, SKIN, 0.04);
        }
        if (f === 'bottom') P.noise(x, y, w, h, SKIN, 0.04);
      },
      leg: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(58, 56, 62), 0.07);
        if (f !== 'top') P.noise(x, y + h - 4, w, 4, C(176, 136, 92), 0.07);
        if (f === 'bottom') P.noise(x, y, w, h, C(120, 88, 56), 0.05);
      },
    }),
  },

  zombie: {
    tex: [64, 64],
    parts: humanoid({
      head: (f, P, [x, y, w, h]) => {
        const skin = C(112, 140, 116);
        P.noise(x, y, w, h, skin, 0.1);
        P.patches(x, y, w, h, C(86, 112, 92), 0.25);
        if (f === 'top') P.noise(x, y, w, h, C(60, 62, 48), 0.15);
        if (f === 'front') {
          P.rect(x + 1, y + 3, 2, 2, C(26, 30, 26));
          P.rect(x + w - 3, y + 3, 2, 2, C(26, 30, 26));
          P.px(x + 2, y + 4, C(220, 60, 40));
          P.px(x + w - 3, y + 4, C(220, 60, 40));
          P.rect(x + 2, y + 6, 4, 1, C(40, 46, 40));
          P.px(x + 3, y + 7, C(40, 46, 40));
        }
      },
      body: (f, P, [x, y, w, h]) => {
        const cloth = C(150, 128, 88);
        P.noise(x, y, w, h, cloth, 0.12);
        if (f === 'front' || f === 'back') {
          P.px(x + 2, y + 9, C(112, 140, 116));
          P.px(x + 5, y + 4, C(112, 140, 116));
          P.px(x + 6, y + 5, C(112, 140, 116));
          for (let i = 0; i < w; i += 2) P.px(x + i, y + h - 1, C(108, 90, 60));
          P.rect(x, y + 8, w, 1, C(100, 80, 50));
        }
      },
      arm: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(112, 140, 116), 0.1);
        P.patches(x, y, w, h, C(86, 112, 92), 0.2);
        if (f !== 'bottom' && f !== 'top') P.noise(x, y, w, 3, C(150, 128, 88), 0.12);
      },
      leg: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(70, 66, 74), 0.1);
        if (f !== 'top') P.noise(x, y + h - 2, w, 2, C(112, 140, 116), 0.1);
      },
    }),
  },

  skeleton: {
    tex: [64, 64],
    parts: humanoid({
      armW: 2,
      legW: 2,
      head: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(214, 210, 196), 0.06);
        if (f === 'front') {
          P.rect(x + 1, y + 3, 2, 2, C(30, 28, 30));
          P.rect(x + w - 3, y + 3, 2, 2, C(30, 28, 30));
          P.px(x + 4, y + 5, C(60, 58, 58));
          P.px(x + 3, y + 5, C(60, 58, 58));
          P.rect(x + 1, y + 7, w - 2, 1, C(150, 146, 136));
          for (let i = 1; i < w - 1; i += 2) P.px(x + i, y + 7, C(40, 40, 40));
        }
      },
      body: (f, P, [x, y, w, h]) => {
        P.rect(x, y, w, h, C(70, 66, 64));
        if (f === 'front' || f === 'back') {
          P.rect(x + 3, y, 2, h, C(206, 202, 188));
          for (let j = 1; j < 8; j += 2) P.rect(x + 1, y + j, w - 2, 1, C(206, 202, 188));
          P.rect(x + 1, y + h - 2, w - 2, 1, C(190, 186, 172));
        } else P.noise(x, y, w, h, C(206, 202, 188), 0.06);
      },
      arm: (f, P, [x, y, w, h]) => P.noise(x, y, w, h, C(206, 202, 188), 0.06),
      leg: (f, P, [x, y, w, h]) => P.noise(x, y, w, h, C(200, 196, 182), 0.06),
    }),
  },

  pig: {
    tex: [64, 64],
    parts: {
      body: { size: [10, 8, 15], pivot: [0, 13, 0], from: [-5, -4, -7.5], paint: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(236, 168, 160), 0.06);
        if (f === 'bottom') P.noise(x, y, w, h, C(214, 146, 140), 0.05);
      } },
      head: { size: [8, 8, 7], pivot: [0, 13, 7], from: [-4, -4, 0], paint: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(240, 174, 166), 0.05);
        if (f === 'front') {
          P.rect(x + 1, y + 2, 2, 1, C(40, 30, 30));
          P.rect(x + w - 3, y + 2, 2, 1, C(40, 30, 30));
          P.px(x + 1, y + 2, C(250, 250, 250));
          P.px(x + w - 2, y + 2, C(250, 250, 250));
        }
      } },
      snout: { parent: 'head', size: [4, 3, 1], pivot: [0, 0, 7], from: [-2, -2.5, 0], paint: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(220, 130, 128), 0.05);
        if (f === 'front') { P.px(x + 1, y + 1, C(120, 60, 60)); P.px(x + 2, y + 1, C(120, 60, 60)); }
      } },
      earL: { parent: 'head', size: [2, 2, 1], pivot: [3, 4, 2], from: [-1, 0, 0], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(220, 150, 146), 0.05) },
      earR: { parent: 'head', size: [2, 2, 1], pivot: [-3, 4, 2], from: [-1, 0, 0], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(220, 150, 146), 0.05) },
      legFR: { size: [3, 6, 3], pivot: [-3, 7, 5], from: [-1.5, -7, -1.5], paint: legPaint(C(230, 160, 152), C(120, 80, 70)) },
      legFL: { size: [3, 6, 3], pivot: [3, 7, 5], from: [-1.5, -7, -1.5], paint: legPaint(C(230, 160, 152), C(120, 80, 70)) },
      legBR: { size: [3, 6, 3], pivot: [-3, 7, -5], from: [-1.5, -7, -1.5], paint: legPaint(C(230, 160, 152), C(120, 80, 70)) },
      legBL: { size: [3, 6, 3], pivot: [3, 7, -5], from: [-1.5, -7, -1.5], paint: legPaint(C(230, 160, 152), C(120, 80, 70)) },
    },
  },

  cow: {
    tex: [64, 64],
    parts: {
      body: { size: [12, 10, 18], pivot: [0, 19, 0], from: [-6, -5, -9], paint: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(238, 226, 206), 0.05);
        P.patches(x, y, w, h, C(92, 62, 40), 0.45);
        if (f === 'bottom') P.rect(x + 3, y + 3, 6, 4, C(236, 170, 170));
      } },
      head: { size: [8, 8, 6], pivot: [0, 20, 9], from: [-4, -4, 0], paint: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(92, 62, 40), 0.06);
        if (f === 'front') {
          P.noise(x + 1, y + 5, 6, 3, C(232, 190, 170), 0.04);
          P.px(x + 2, y + 6, C(110, 70, 60));
          P.px(x + 5, y + 6, C(110, 70, 60));
          P.rect(x + 1, y + 2, 2, 1, C(250, 250, 250));
          P.rect(x + 5, y + 2, 2, 1, C(250, 250, 250));
          P.px(x + 2, y + 2, C(20, 20, 20));
          P.px(x + 5, y + 2, C(20, 20, 20));
          P.rect(x + 3, y, 2, 2, C(238, 226, 206));
        }
      } },
      hornL: { parent: 'head', size: [1, 3, 1], pivot: [4, 3, 3], from: [0, 0, -0.5], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(220, 214, 196), 0.05) },
      hornR: { parent: 'head', size: [1, 3, 1], pivot: [-4, 3, 3], from: [-1, 0, -0.5], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(220, 214, 196), 0.05) },
      legFR: { size: [4, 12, 4], pivot: [-4, 12, 6], from: [-2, -12, -2], paint: legPaint(C(238, 226, 206), C(60, 44, 34)) },
      legFL: { size: [4, 12, 4], pivot: [4, 12, 6], from: [-2, -12, -2], paint: legPaint(C(92, 62, 40), C(60, 44, 34)) },
      legBR: { size: [4, 12, 4], pivot: [-4, 12, -7], from: [-2, -12, -2], paint: legPaint(C(92, 62, 40), C(60, 44, 34)) },
      legBL: { size: [4, 12, 4], pivot: [4, 12, -7], from: [-2, -12, -2], paint: legPaint(C(238, 226, 206), C(60, 44, 34)) },
    },
  },

  sheep: {
    tex: [64, 64],
    parts: {
      body: { size: [8, 8, 14], pivot: [0, 17, 0], from: [-4, -4, -7], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(206, 176, 166), 0.06) },
      wool: { size: [10, 10, 16], pivot: [0, 17, 0], from: [-5, -5, -8], paint: woolPaint },
      head: { size: [6, 6, 7], pivot: [0, 19, 8], from: [-3, -3, 0], paint: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(70, 64, 62), 0.06);
        if (f === 'top' || f === 'left' || f === 'right' || f === 'back') P.noise(x, y, w, Math.min(h, 3), C(232, 230, 222), 0.05);
        if (f === 'front') {
          P.px(x + 1, y + 2, C(240, 230, 200));
          P.px(x + 4, y + 2, C(240, 230, 200));
          P.px(x + 2, y + 4, C(40, 34, 34));
          P.px(x + 3, y + 4, C(40, 34, 34));
        }
      } },
      legFR: { size: [3, 8, 3], pivot: [-3, 12, 6], from: [-1.5, -12, -1.5], paint: legPaint(C(232, 230, 222), C(70, 64, 62), 6) },
      legFL: { size: [3, 8, 3], pivot: [3, 12, 6], from: [-1.5, -12, -1.5], paint: legPaint(C(232, 230, 222), C(70, 64, 62), 6) },
      legBR: { size: [3, 8, 3], pivot: [-3, 12, -6], from: [-1.5, -12, -1.5], paint: legPaint(C(232, 230, 222), C(70, 64, 62), 6) },
      legBL: { size: [3, 8, 3], pivot: [3, 12, -6], from: [-1.5, -12, -1.5], paint: legPaint(C(232, 230, 222), C(70, 64, 62), 6) },
    },
  },

  chicken: {
    tex: [64, 32],
    parts: {
      body: { size: [6, 6, 7], pivot: [0, 7, 0], from: [-3, -2, -4], paint: (f, P, [x, y, w, h]) => P.noise(x, y, w, h, C(246, 244, 236), 0.05) },
      head: { size: [4, 5, 3], pivot: [0, 9, 3], from: [-2, 0, 0], paint: (f, P, [x, y, w, h]) => {
        P.noise(x, y, w, h, C(248, 246, 240), 0.04);
        if (f === 'front') { P.px(x, y + 1, C(20, 20, 20)); P.px(x + 3, y + 1, C(20, 20, 20)); }
      } },
      beak: { parent: 'head', size: [2, 1, 2], pivot: [0, 2, 3], from: [-1, 0, 0], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(240, 170, 40), 0.05) },
      wattle: { parent: 'head', size: [1, 2, 1], pivot: [0, 0, 3], from: [-0.5, 0, 0], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(210, 40, 40), 0.05) },
      comb: { parent: 'head', size: [1, 2, 3], pivot: [0, 5, 1.5], from: [-0.5, 0, -1.5], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(214, 44, 40), 0.05) },
      wingL: { size: [1, 4, 5], pivot: [3, 8, 0], from: [0, -4, -3], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(232, 230, 220), 0.06) },
      wingR: { size: [1, 4, 5], pivot: [-3, 8, 0], from: [-1, -4, -3], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(232, 230, 220), 0.06) },
      legL: { size: [1, 5, 1], pivot: [1, 5, 0], from: [-0.5, -5, -0.5], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(232, 164, 40), 0.05) },
      legR: { size: [1, 5, 1], pivot: [-1, 5, 0], from: [-0.5, -5, -0.5], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], C(232, 164, 40), 0.05) },
    },
  },

  spider: {
    tex: [128, 64],
    parts: (() => {
      const body = C(56, 30, 64), stripe = C(214, 128, 34);
      const parts = {
        abdomen: { size: [10, 8, 12], pivot: [0, 9, -3], from: [-5, -4, -12], paint: (f, P, [x, y, w, h]) => {
          P.noise(x, y, w, h, body, 0.1);
          if (f === 'top') for (let j = 2; j < h; j += 4) P.rect(x + 2, y + j, w - 4, 1, stripe);
          if (f === 'back') { P.rect(x + 3, y + 2, w - 6, 1, stripe); }
        } },
        thorax: { size: [6, 6, 6], pivot: [0, 9, 0], from: [-3, -3, -3], paint: (f, P, r) => P.noise(r[0], r[1], r[2], r[3], shadeHex(body, 0.85), 0.1) },
        head: { size: [8, 7, 7], pivot: [0, 9, 3], from: [-4, -3.5, 0], paint: (f, P, [x, y, w, h]) => {
          P.noise(x, y, w, h, body, 0.1);
          if (f === 'front') {
            const eye = C(255, 186, 40);
            for (const [ex, ey] of [[1, 2], [6, 2], [2, 1], [5, 1], [3, 3], [4, 3], [1, 4], [6, 4]]) P.px(x + ex, y + ey, eye);
            P.rect(x + 2, y + 5, 4, 1, C(30, 14, 30));
          }
        } },
      };
      const leg = (f, P, r) => P.noise(r[0], r[1], r[2], r[3], shadeHex(body, 0.9), 0.15);
      for (let i = 0; i < 4; i++) {
        const z = 2 - i * 1.5;
        parts['legL' + i] = { size: [16, 2, 2], pivot: [3, 9, z], from: [0, -1, -1], paint: leg };
        parts['legR' + i] = { size: [16, 2, 2], pivot: [-3, 9, z], from: [-16, -1, -1], paint: leg };
      }
      return parts;
    })(),
  },
};

function legPaint(main, hoof, hoofH = 2) {
  return (f, P, [x, y, w, h]) => {
    P.noise(x, y, w, h, main, 0.06);
    if (f !== 'top') P.noise(x, y + h - hoofH, w, hoofH, hoof, 0.06);
    if (f === 'bottom') P.noise(x, y, w, h, hoof, 0.06);
  };
}
function woolPaint(f, P, [x, y, w, h]) {
  P.noise(x, y, w, h, C(234, 232, 226), 0.08);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if ((i + j * 2) % 5 === 0) P.px(x + i, y + j, C(214, 212, 204));
}

// ---------------------------------------------------------------- build
const built = new Map();

function buildModel(type) {
  if (built.has(type)) return built.get(type);
  const def = MODELS[type];
  const [W] = def.tex;
  const packer = new Packer(W);
  const allocs = {};
  for (const [name, p] of Object.entries(def.parts)) {
    const [w, h, d] = p.size.map(Math.ceil);
    allocs[name] = packer.alloc(2 * (w + d), d + h);
  }
  const H = Math.max(def.tex[1], Math.pow(2, Math.ceil(Math.log2(packer.height || 1))));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const P = new Painter(g, type.length * 977);
  const geos = {};
  const partRects = {};
  for (const [name, p] of Object.entries(def.parts)) {
    const { geo, rects } = boxGeo(p.from, p.size, allocs[name], W, H, p.inflate || 0);
    geos[name] = geo;
    partRects[name] = rects;
    for (const [faceName, r] of Object.entries(rects)) {
      if (p.paint) p.paint(faceName, P, [r[0], r[1], Math.ceil(r[2]), Math.ceil(r[3])]);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  const res = { def, geos, tex, canvas, partRects };
  built.set(type, res);
  return res;
}

// A model instance: root group (origin at feet, facing +z) and part groups.
export function createModel(type) {
  const b = buildModel(type);
  const mat = makeEntityMaterial(b.tex);
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const parts = {};
  const order = Object.entries(b.def.parts).sort((a, c) => (a[1].parent ? 1 : 0) - (c[1].parent ? 1 : 0));
  for (const [name, p] of order) {
    const pivot = new THREE.Group();
    pivot.position.set(p.pivot[0] / 16, p.pivot[1] / 16, p.pivot[2] / 16);
    const mesh = new THREE.Mesh(b.geos[name], mat);
    pivot.add(mesh);
    pivot.userData.mesh = mesh;
    (p.parent ? parts[p.parent] : inner).add(pivot);
    parts[name] = pivot;
  }
  return { type, root, inner, parts, material: mat };
}

export function modelTexture(type) {
  return buildModel(type).tex;
}

// Shared skin canvas (used by the first-person arm).
export function modelCanvas(type) {
  return buildModel(type).canvas;
}

export function partGeometry(type, part) {
  return buildModel(type).geos[part];
}

// Flat front view of a humanoid model, drawn from its skin (inventory portrait).
export function portraitCanvas(type) {
  const b = buildModel(type);
  const out = document.createElement('canvas');
  out.width = 20;
  out.height = 36;
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  const draw = (part, dx, dy) => {
    const r = b.partRects[part].front;
    g.drawImage(b.canvas, r[0], r[1], r[2], r[3], dx, dy, r[2], r[3]);
  };
  draw('head', 6, 2);
  draw('body', 6, 10);
  draw('rightArm', 2, 10);
  draw('leftArm', 14, 10);
  draw('rightLeg', 6, 22);
  draw('leftLeg', 10, 22);
  out.style.imageRendering = 'pixelated';
  return out;
}
