// Builds geometry for a 16x16x16 section. Blocks, light and climate are first
// copied into an 18^3 padded scratch volume so faces on the section edge can
// look at their neighbours without chunk lookups.
import { BLOCKS, B, SHAPE, shapeId, isOpaque, isCutout, isTranslucent, lightOpacity, tileFor, tileRotation } from '../data/blocks.js';
import { HEIGHT } from '../world/constants.js';
import { blockBoxes, stairBoxes, doorBox, edgeBox } from '../world/shapes.js';
import { grassTint } from '../world/worldgen.js';

const P = 18, P2 = P * P, PV = P * P * P;
const pBlocks = new Uint8Array(PV);
const pMeta = new Uint8Array(PV);
const pSky = new Uint8Array(PV);
const pBlk = new Uint8Array(PV);
const pTint = new Float32Array(P2 * 3 * 2); // grass rgb, foliage rgb per padded column
const pBiome = new Uint8Array(P2);

const pidx = (x, y, z) => (x + 1) + (z + 1) * P + (y + 1) * P2;

// ---------------------------------------------------------------- tables
let TEX = null; // Int16Array (id*16 + meta)*6 + face -> layer
let ROT = null;
let ANIM = null; // per layer: frames | fps << 4
let OVERLAY_GRASS = 0, GRASS_SNOWY = 0;

export function initMesher(tileIndex, anim) {
  TEX = new Int16Array(256 * 16 * 6);
  ROT = new Uint8Array(256 * 16 * 6);
  ANIM = new Uint8Array(256);
  for (const [name, a] of anim) ANIM[tileIndex.get(name)] = (a.frames & 15) | (a.fps << 4);
  const missing = tileIndex.get('missing');
  for (let id = 0; id < 256; id++) {
    if (!BLOCKS[id]) continue;
    for (let m = 0; m < 16; m++) {
      for (let f = 0; f < 6; f++) {
        const name = tileFor(id, m, f);
        const k = (id * 16 + m) * 6 + f;
        TEX[k] = tileIndex.has(name) ? tileIndex.get(name) : missing;
        ROT[k] = tileRotation(id, m, f);
      }
    }
  }
  OVERLAY_GRASS = tileIndex.get('grass_side_overlay');
  GRASS_SNOWY = tileIndex.get('grass_side_snowy');
}

const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.6 },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6 },
  { n: [0, 1, 0], v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8 },
  { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.8 },
];
export const FACE_SHADE = FACES.map((f) => f.shade);
const UVF = [
  (x, y, z) => [1 - z, 1 - y],
  (x, y, z) => [z, 1 - y],
  (x, y, z) => [x, z],
  (x, y, z) => [x, 1 - z],
  (x, y, z) => [x, 1 - y],
  (x, y, z) => [1 - x, 1 - y],
];
const delta = (dx, dy, dz) => dx + dz * P + dy * P2;
const FACE_N = FACES.map((f) => delta(...f.n));
// For each face/vertex: padded deltas of side1, side2, corner (relative to the block)
const AO_OFF = FACES.map((f) => {
  const axis = f.n.findIndex((c) => c !== 0);
  const tang = [0, 1, 2].filter((a) => a !== axis);
  return f.v.map((c) => {
    const a = [0, 0, 0], b = [0, 0, 0];
    a[tang[0]] = c[tang[0]] ? 1 : -1;
    b[tang[1]] = c[tang[1]] ? 1 : -1;
    const n = f.n;
    return [
      delta(n[0] + a[0], n[1] + a[1], n[2] + a[2]),
      delta(n[0] + b[0], n[1] + b[1], n[2] + b[2]),
      delta(n[0] + a[0] + b[0], n[1] + a[1] + b[1], n[2] + a[2] + b[2]),
    ];
  });
});
const CUBE_UV = FACES.map((f, fi) => f.v.map((c) => UVF[fi](c[0], c[1], c[2])));
const AO_CURVE = [0.48, 0.66, 0.83, 1.0];

function rotUV(u, v, r) {
  switch (r & 3) {
    case 1: return [v, 1 - u];
    case 2: return [1 - u, 1 - v];
    case 3: return [1 - v, u];
    default: return [u, v];
  }
}

// ---------------------------------------------------------------- buffer
class Buf {
  constructor() {
    this.cap = 4096;
    this.pos = new Int16Array(this.cap * 3);
    this.d1 = new Uint8Array(this.cap * 4);
    this.d2 = new Uint8Array(this.cap * 4);
    this.tint = new Uint8Array(this.cap * 4);
    this.flip = new Uint8Array(this.cap / 4);
    this.n = 0;
  }
  reset() {
    this.n = 0;
  }
  grow() {
    const nc = this.cap * 2;
    const g = (A, old, k) => { const a = new A(nc * k); a.set(old); return a; };
    this.pos = g(Int16Array, this.pos, 3);
    this.d1 = g(Uint8Array, this.d1, 4);
    this.d2 = g(Uint8Array, this.d2, 4);
    this.tint = g(Uint8Array, this.tint, 4);
    const f = new Uint8Array(nc / 4);
    f.set(this.flip);
    this.flip = f;
    this.cap = nc;
  }
  // x,y,z in block units (section local), u,v in 0..1
  vert(x, y, z, u, v, layer, overlay, sky, blk, shade, anim, tr, tg, tb) {
    if (this.n >= this.cap) this.grow();
    const n = this.n++;
    this.pos[n * 3] = Math.round(x * 16);
    this.pos[n * 3 + 1] = Math.round(y * 16);
    this.pos[n * 3 + 2] = Math.round(z * 16);
    this.d1[n * 4] = Math.round(u * 16);
    this.d1[n * 4 + 1] = Math.round(v * 16);
    this.d1[n * 4 + 2] = layer;
    this.d1[n * 4 + 3] = overlay;
    this.d2[n * 4] = Math.round(sky * 17);
    this.d2[n * 4 + 1] = Math.round(blk * 17);
    this.d2[n * 4 + 2] = Math.round(shade * 255);
    this.d2[n * 4 + 3] = anim;
    this.tint[n * 4] = tr;
    this.tint[n * 4 + 1] = tg;
    this.tint[n * 4 + 2] = tb;
  }
  setFlip(f) {
    this.flip[(this.n >> 2) - 1] = f;
  }
  result() {
    if (this.n === 0) return null;
    const quads = this.n >> 2;
    const big = this.n > 65535;
    const index = big ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const b = q * 4, o = q * 6;
      if (this.flip[q]) {
        index[o] = b + 1; index[o + 1] = b + 2; index[o + 2] = b + 3;
        index[o + 3] = b + 1; index[o + 4] = b + 3; index[o + 5] = b;
      } else {
        index[o] = b; index[o + 1] = b + 1; index[o + 2] = b + 2;
        index[o + 3] = b; index[o + 4] = b + 2; index[o + 5] = b + 3;
      }
    }
    return {
      pos: this.pos.slice(0, this.n * 3),
      d1: this.d1.slice(0, this.n * 4),
      d2: this.d2.slice(0, this.n * 4),
      tint: this.tint.slice(0, this.n * 4),
      index,
      vertices: this.n,
    };
  }
}
const opaqueBuf = new Buf();
const transBuf = new Buf();

// ---------------------------------------------------------------- padding
function fillPadded(world, c, s) {
  const y0 = s * 16;
  for (let pz = -1; pz <= 16; pz++) {
    for (let px = -1; px <= 16; px++) {
      const dx = px < 0 ? -1 : px > 15 ? 1 : 0;
      const dz = pz < 0 ? -1 : pz > 15 ? 1 : 0;
      let ch = c;
      if (dx || dz) ch = dx && dz ? c.diag(dx, dz) : dx ? (dx > 0 ? c.nb[0] : c.nb[1]) : dz > 0 ? c.nb[2] : c.nb[3];
      const lx = px & 15, lz = pz & 15;
      const col = lx | (lz << 4);
      const pc = (px + 1) + (pz + 1) * P;
      // Column climate
      if (ch) {
        const t = ch.temps[col] / 255, h = ch.humids[col] / 255, bio = ch.biomes[col];
        const g = grassTint(t, h, bio, 'grass');
        const f = grassTint(t, h, bio, 'foliage');
        pTint[pc * 6] = g[0]; pTint[pc * 6 + 1] = g[1]; pTint[pc * 6 + 2] = g[2];
        pTint[pc * 6 + 3] = f[0]; pTint[pc * 6 + 4] = f[1]; pTint[pc * 6 + 5] = f[2];
        pBiome[pc] = bio;
      }
      for (let py = -1; py <= 16; py++) {
        const y = y0 + py;
        const pi = pc + (py + 1) * P2;
        if (y < 0) {
          pBlocks[pi] = B.bedrock; pMeta[pi] = 0; pSky[pi] = 0; pBlk[pi] = 0;
        } else if (y >= HEIGHT || !ch) {
          pBlocks[pi] = ch ? 0 : B.stone; pMeta[pi] = 0; pSky[pi] = 15; pBlk[pi] = 0;
        } else {
          const i = col | (y << 8);
          pBlocks[pi] = ch.blocks[i];
          pMeta[pi] = ch.meta[i];
          pSky[pi] = ch.sky[i];
          pBlk[pi] = ch.blk[i];
        }
      }
    }
  }
  // Light for non-full blocks that block light (slabs, stairs, farmland):
  // borrow the brightest neighbour so they are not drawn black.
  for (let py = 0; py < 16; py++) for (let pz = -1; pz <= 16; pz++) for (let px = -1; px <= 16; px++) {
    const pi = pidx(px, py, pz);
    const id = pBlocks[pi];
    if (lightOpacity[id] < 15 || isOpaque[id] || id === 0) continue;
    let ms = 0, mb = 0;
    for (const d of FACE_N) {
      const ni = pi + d;
      if (ni < 0 || ni >= PV) continue;
      if (pSky[ni] > ms) ms = pSky[ni];
      if (pBlk[ni] > mb) mb = pBlk[ni];
    }
    pSky[pi] = ms ? ms - (ms > 0 ? 1 : 0) : 0;
    pBlk[pi] = mb ? mb - 1 : 0;
  }
}

// ---------------------------------------------------------------- emitters
function tintFor(id, pc) {
  const t = BLOCKS[id].tint;
  if (!t) return null;
  if (t === 'grass') return [pTint[pc * 6], pTint[pc * 6 + 1], pTint[pc * 6 + 2]];
  if (t === 'foliage') return [pTint[pc * 6 + 3], pTint[pc * 6 + 4], pTint[pc * 6 + 5]];
  if (t === 'birch') return [128, 167, 85];
  if (t === 'spruce') return [97, 153, 97];
  return null;
}

function cubeFace(buf, x, y, z, pi, f, layer, rot, overlay, tint, anim, smooth) {
  const face = FACES[f];
  const ni = pi + FACE_N[f];
  const tr = tint ? tint[0] : 255, tg = tint ? tint[1] : 255, tb = tint ? tint[2] : 255;
  const shade = face.shade;
  const ao = [0, 0, 0, 0];
  const lv = [0, 0, 0, 0, 0, 0, 0, 0];
  if (smooth) {
    const offs = AO_OFF[f];
    for (let k = 0; k < 4; k++) {
      const o = offs[k];
      const i1 = pi + o[0], i2 = pi + o[1], i3 = pi + o[2];
      const s1 = isOpaque[pBlocks[i1]], s2 = isOpaque[pBlocks[i2]], s3 = isOpaque[pBlocks[i3]];
      ao[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
      let sky = pSky[ni], blk = pBlk[ni], n = 1;
      if (!s1) { sky += pSky[i1]; blk += pBlk[i1]; n++; }
      if (!s2) { sky += pSky[i2]; blk += pBlk[i2]; n++; }
      if (!s3 && !(s1 && s2)) { sky += pSky[i3]; blk += pBlk[i3]; n++; }
      lv[k * 2] = sky / n;
      lv[k * 2 + 1] = blk / n;
    }
  } else {
    for (let k = 0; k < 4; k++) {
      ao[k] = 3;
      lv[k * 2] = pSky[ni];
      lv[k * 2 + 1] = pBlk[ni];
    }
  }
  const verts = face.v, uvs = CUBE_UV[f];
  for (let k = 0; k < 4; k++) {
    const c = verts[k];
    let [u, v] = uvs[k];
    if (rot) [u, v] = rotUV(u, v, rot);
    buf.vert(x + c[0], y + c[1], z + c[2], u, v, layer, overlay, lv[k * 2], lv[k * 2 + 1], shade * AO_CURVE[ao[k]], anim, tr, tg, tb);
  }
  const b0 = AO_CURVE[ao[0]] * (lv[0] + lv[1] + 1), b1 = AO_CURVE[ao[1]] * (lv[2] + lv[3] + 1);
  const b2 = AO_CURVE[ao[2]] * (lv[4] + lv[5] + 1), b3 = AO_CURVE[ao[3]] * (lv[6] + lv[7] + 1);
  buf.setFlip(b0 + b2 < b1 + b3 ? 1 : 0);
}

// One face of an arbitrary box (block-local coords), flat lit.
function boxFace(buf, x, y, z, bx, f, layer, rot, sky, blk, tint, anim, transform) {
  const face = FACES[f];
  const tr = tint ? tint[0] : 255, tg = tint ? tint[1] : 255, tb = tint ? tint[2] : 255;
  for (let k = 0; k < 4; k++) {
    const c = face.v[k];
    let lx = c[0] ? bx[3] : bx[0];
    let ly = c[1] ? bx[4] : bx[1];
    let lz = c[2] ? bx[5] : bx[2];
    let [u, v] = UVF[f](lx, ly, lz);
    if (rot) [u, v] = rotUV(u, v, rot);
    if (transform) [lx, ly, lz] = transform(lx, ly, lz);
    buf.vert(x + lx, y + ly, z + lz, u, v, layer, 255, sky, blk, face.shade, anim, tr, tg, tb);
  }
  buf.setFlip(0);
}

function emitBoxes(buf, x, y, z, pi, id, meta, boxes, opts = {}) {
  for (const bx of boxes) {
    for (let f = 0; f < 6; f++) {
      const onEdge = [bx[3] === 1, bx[0] === 0, bx[4] === 1, bx[1] === 0, bx[5] === 1, bx[2] === 0][f];
      const ni = pi + FACE_N[f];
      if (onEdge && isOpaque[pBlocks[ni]] && !opts.noCull) continue;
      if (opts.skipFaces && opts.skipFaces[f]) continue;
      const li = onEdge ? ni : pi;
      const layer = opts.layerFn ? opts.layerFn(f) : TEX[(id * 16 + (meta & 15)) * 6 + f];
      const rot = ROT[(id * 16 + (meta & 15)) * 6 + f];
      boxFace(buf, x, y, z, bx, f, layer, rot, pSky[li], pBlk[li], opts.tint || null, ANIM[layer], opts.transform);
    }
  }
}

function quad(buf, p, uvs, layer, sky, blk, shade, tint, anim, both) {
  const tr = tint ? tint[0] : 255, tg = tint ? tint[1] : 255, tb = tint ? tint[2] : 255;
  for (let k = 0; k < 4; k++) buf.vert(p[k][0], p[k][1], p[k][2], uvs[k][0], uvs[k][1], layer, 255, sky, blk, shade, anim, tr, tg, tb);
  buf.setFlip(0);
  if (both) {
    for (let k = 3; k >= 0; k--) buf.vert(p[k][0], p[k][1], p[k][2], uvs[k][0], uvs[k][1], layer, 255, sky, blk, shade, anim, tr, tg, tb);
    buf.setFlip(0);
  }
}

const QUAD_UV = [[0, 1], [1, 1], [1, 0], [0, 0]];

function hash2(x, z) {
  let h = Math.imul(x, 3129871) ^ Math.imul(z, 116129781);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function emitCross(buf, x, y, z, pi, id, meta, wx, wz, tint) {
  const layer = TEX[(id * 16 + (meta & 15)) * 6 + 2];
  const anim = ANIM[layer];
  let ox = 0, oz = 0;
  if (id === B.tall_grass || id === B.fern || (id >= B.dandelion && id <= B.oxeye_daisy)) {
    ox = (hash2(wx, wz) - 0.5) * 0.4;
    oz = (hash2(wz + 7, wx - 3) - 0.5) * 0.4;
  }
  const a = 0.15 + ox, b = 0.85 + ox, c = 0.15 + oz, d = 0.85 + oz;
  const h = id === B.fire ? 1.1 : 1;
  const sky = pSky[pi], blk = pBlk[pi];
  quad(buf, [[x + a, y, z + c], [x + b, y, z + d], [x + b, y + h, z + d], [x + a, y + h, z + c]], QUAD_UV, layer, sky, blk, 1, tint, anim, true);
  quad(buf, [[x + a, y, z + d], [x + b, y, z + c], [x + b, y + h, z + c], [x + a, y + h, z + d]], QUAD_UV, layer, sky, blk, 1, tint, anim, true);
}

function emitCrop(buf, x, y, z, pi, id, meta) {
  const layer = TEX[(id * 16 + (meta & 15)) * 6 + 2];
  const sky = pSky[pi], blk = pBlk[pi];
  const yb = y - 1 / 16;
  for (const o of [0.25, 0.75]) {
    quad(buf, [[x + o, yb, z], [x + o, yb, z + 1], [x + o, yb + 1, z + 1], [x + o, yb + 1, z]], QUAD_UV, layer, sky, blk, 0.9, null, 0, true);
    quad(buf, [[x, yb, z + o], [x + 1, yb, z + o], [x + 1, yb + 1, z + o], [x, yb + 1, z + o]], QUAD_UV, layer, sky, blk, 0.9, null, 0, true);
  }
}

const TORCH_BOX = [7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16];
function emitTorch(buf, x, y, z, pi, id, meta) {
  const layer = TEX[(id * 16) * 6 + 2];
  const sky = pSky[pi], blk = pBlk[pi];
  let transform = null;
  if (meta >= 1 && meta <= 4) {
    const f = (meta - 1) & 3;
    const dx = [0, -1, 0, 1][f], dz = [1, 0, -1, 0][f];
    transform = (lx, ly, lz) => [lx + dx * (-0.42 + ly * 0.4), ly + 0.2, lz + dz * (-0.42 + ly * 0.4)];
  }
  for (let f = 0; f < 6; f++) {
    if (f === 3 && !transform) continue;
    const bx = TORCH_BOX;
    const face = FACES[f];
    for (let k = 0; k < 4; k++) {
      const c = face.v[k];
      let lx = c[0] ? bx[3] : bx[0], ly = c[1] ? bx[4] : bx[1], lz = c[2] ? bx[5] : bx[2];
      let u, v;
      if (f === 2 || f === 3) {
        u = 7 / 16 + (c[0] ? 2 / 16 : 0);
        v = 6 / 16 + (c[2] ? 2 / 16 : 0);
        if (f === 3) v += 8 / 16;
      } else [u, v] = UVF[f](lx, ly, lz);
      if (transform) [lx, ly, lz] = transform(lx, ly, lz);
      buf.vert(x + lx, y + ly, z + lz, u, v, layer, 255, sky, blk, Math.max(0.75, face.shade), 0, 255, 255, 255);
    }
    buf.setFlip(0);
  }
}

function emitLadder(buf, x, y, z, pi, id, meta) {
  const layer = TEX[(id * 16) * 6 + 2];
  const sky = pSky[pi], blk = pBlk[pi];
  const f = meta & 3; // ladder faces this way; its wall is behind
  const t = 1 / 16;
  let p;
  switch (f) {
    case 0: p = [[x + 1, y, z + t], [x, y, z + t], [x, y + 1, z + t], [x + 1, y + 1, z + t]]; break; // wall at -z, faces +z
    case 1: p = [[x + 1 - t, y, z + 1], [x + 1 - t, y, z], [x + 1 - t, y + 1, z], [x + 1 - t, y + 1, z + 1]]; break;
    case 2: p = [[x, y, z + 1 - t], [x + 1, y, z + 1 - t], [x + 1, y + 1, z + 1 - t], [x, y + 1, z + 1 - t]]; break;
    default: p = [[x + t, y, z], [x + t, y, z + 1], [x + t, y + 1, z + 1], [x + t, y + 1, z]]; break;
  }
  // Wall faces the other way, so make sure the visible winding faces out.
  quad(buf, p, QUAD_UV, layer, sky, blk, 0.85, null, 0, true);
}

function fluidHeightAt(id, pi) {
  // Height of a fluid cell's surface, 1 when fluid sits above it.
  if (pBlocks[pi + P2] === id) return 1;
  const m = pMeta[pi];
  if (m & 8) return 1;
  return (8 - (m & 7)) / 9;
}

function cornerHeight(id, x, y, z, cx, cz) {
  // cx, cz in {0,1}: corner of the cell (x, z)
  let total = 0, weight = 0;
  for (let dz = cz - 1; dz <= cz; dz++) {
    for (let dx = cx - 1; dx <= cx; dx++) {
      const pi = pidx(x + dx, y, z + dz);
      const b = pBlocks[pi];
      if (b === id) {
        if (pBlocks[pi + P2] === id) return 1;
        const h = fluidHeightAt(id, pi);
        if ((pMeta[pi] & 15) === 0) { total += h * 10; weight += 10; } else { total += h; weight++; }
      } else if (!BLOCKS[b] || !BLOCKS[b].solid) {
        weight++;
      }
    }
  }
  return weight ? total / weight : 1;
}

function emitLiquid(buf, x, y, z, pi, id, meta) {
  const layer = TEX[(id * 16) * 6 + 2];
  const anim = ANIM[layer];
  const above = pBlocks[pi + P2];
  const covered = above === id;
  const h00 = covered ? 1 : cornerHeight(id, x, y, z, 0, 0);
  const h10 = covered ? 1 : cornerHeight(id, x, y, z, 1, 0);
  const h11 = covered ? 1 : cornerHeight(id, x, y, z, 1, 1);
  const h01 = covered ? 1 : cornerHeight(id, x, y, z, 0, 1);
  const sky = Math.max(pSky[pi], pSky[pi + P2]), blk = Math.max(pBlk[pi], pBlk[pi + P2]);
  const isWater = id === B.water;
  if (!covered) {
    // top, drawn from both sides so it can be seen from under water
    const p = [[x, y + h00, z], [x, y + h01, z + 1], [x + 1, y + h11, z + 1], [x + 1, y + h10, z]];
    quad(buf, p, [[0, 0], [0, 1], [1, 1], [1, 0]], layer, sky, blk, 1, null, anim, isWater);
  }
  const sides = [
    [0, [x + 1, z], [x + 1, z + 1], h10, h11, [1, 0, 0]],
    [1, [x, z + 1], [x, z], h01, h00, [-1, 0, 0]],
    [4, [x + 1, z + 1], [x, z + 1], h11, h01, [0, 0, 1]],
    [5, [x, z], [x + 1, z], h00, h10, [0, 0, -1]],
  ];
  for (const [f, a, b, ha, hb] of sides) {
    const ni = pi + FACE_N[f];
    const nb = pBlocks[ni];
    if (nb === id || isOpaque[nb]) continue;
    if (isWater && nb === B.ice) continue;
    const s = Math.max(pSky[ni], pSky[pi]), bl = Math.max(pBlk[ni], pBlk[pi]);
    const p = [[a[0], y, a[1]], [b[0], y, b[1]], [b[0], y + hb, b[1]], [a[0], y + ha, a[1]]];
    quad(buf, p, [[0, 1], [1, 1], [1, 1 - hb], [0, 1 - ha]], layer, s, bl, FACES[f].shade, null, anim, false);
  }
  const below = pBlocks[pi - P2];
  if (below !== id && !isOpaque[below]) {
    const p = [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]];
    quad(buf, p, [[0, 0], [1, 0], [1, 1], [0, 1]], layer, pSky[pi - P2], pBlk[pi - P2], 0.5, null, anim, false);
  }
}

function fenceLike(pi) {
  const b = pBlocks[pi];
  return isOpaque[b] || (BLOCKS[b] && (BLOCKS[b].fence || BLOCKS[b].shape === 'gate'));
}

function fenceBoxes(pi) {
  const boxes = [[6 / 16, 0, 6 / 16, 10 / 16, 1, 10 / 16]];
  const rails = [[6 / 16, 9 / 16], [12 / 16, 15 / 16]];
  const dirs = [[0, 1, (y0, y1) => [10 / 16, y0, 7 / 16, 1, y1, 9 / 16]], [1, -1, (y0, y1) => [0, y0, 7 / 16, 6 / 16, y1, 9 / 16]],
    [4, P, (y0, y1) => [7 / 16, y0, 10 / 16, 9 / 16, y1, 1]], [5, -P, (y0, y1) => [7 / 16, y0, 0, 9 / 16, y1, 6 / 16]]];
  for (const [, d, mk] of dirs) {
    if (!fenceLike(pi + d)) continue;
    for (const [a, b] of rails) boxes.push(mk(a, b));
  }
  return boxes;
}

function gateBoxes(meta) {
  const open = (meta & 4) !== 0;
  const alongX = (meta & 1) === 0;
  const boxes = [];
  const post = (a) => (alongX ? [a, 5 / 16, 7 / 16, a + 2 / 16, 1, 9 / 16] : [7 / 16, 5 / 16, a, 9 / 16, 1, a + 2 / 16]);
  boxes.push(post(0), post(14 / 16));
  const rails = [[6 / 16, 9 / 16], [12 / 16, 15 / 16]];
  if (!open) {
    for (const [a, b] of rails) boxes.push(alongX ? [2 / 16, a, 7 / 16, 14 / 16, b, 9 / 16] : [7 / 16, a, 2 / 16, 9 / 16, b, 14 / 16]);
    boxes.push(alongX ? [6 / 16, 9 / 16, 7 / 16, 10 / 16, 12 / 16, 9 / 16] : [7 / 16, 9 / 16, 6 / 16, 9 / 16, 12 / 16, 10 / 16]);
  } else {
    const swing = (meta & 2) ? -1 : 1;
    for (const [a, b] of rails) {
      if (alongX) {
        boxes.push(swing > 0 ? [0, a, 9 / 16, 2 / 16, b, 15 / 16] : [0, a, 1 / 16, 2 / 16, b, 7 / 16]);
        boxes.push(swing > 0 ? [14 / 16, a, 9 / 16, 1, b, 15 / 16] : [14 / 16, a, 1 / 16, 1, b, 7 / 16]);
      } else {
        boxes.push(swing > 0 ? [9 / 16, a, 0, 15 / 16, b, 2 / 16] : [1 / 16, a, 0, 7 / 16, b, 2 / 16]);
        boxes.push(swing > 0 ? [9 / 16, a, 14 / 16, 15 / 16, b, 1] : [1 / 16, a, 14 / 16, 7 / 16, b, 1]);
      }
    }
  }
  return boxes;
}

// ---------------------------------------------------------------- block emit
function emitBlock(x, y, z, pi, wx, wz) {
  const id = pBlocks[pi];
  if (id === 0) return;
  const meta = pMeta[pi];
  const shape = shapeId[id];
  const pc = pi % P2;
  switch (shape) {
    case SHAPE.cube: {
      const buf = isTranslucent[id] ? transBuf : opaqueBuf;
      const cut = isCutout[id];
      const trans = isTranslucent[id];
      const tint = tintFor(id, pc);
      const grass = id === B.grass_block;
      let snowy = false;
      if (grass) {
        const a = pBlocks[pi + P2];
        snowy = a === B.snow || a === B.snow_block;
      }
      const base = (id * 16 + (meta & 15)) * 6;
      for (let f = 0; f < 6; f++) {
        const nb = pBlocks[pi + FACE_N[f]];
        if (isOpaque[nb]) continue;
        if ((cut || trans) && nb === id && !BLOCKS[id].leaves) continue;
        let layer = TEX[base + f];
        let overlay = 255;
        let t = tint;
        if (grass && f !== 2) {
          t = null;
          if (f !== 3) {
            if (snowy) layer = GRASS_SNOWY;
            else { overlay = OVERLAY_GRASS; t = tint; }
          }
        }
        cubeFace(buf, x, y, z, pi, f, layer, ROT[base + f], overlay, grass && f !== 2 && overlay === 255 ? null : t, ANIM[layer], true);
      }
      return;
    }
    case SHAPE.cross:
    case SHAPE.fire:
      emitCross(opaqueBuf, x, y, z, pi, id, meta, wx, wz, tintFor(id, pc));
      return;
    case SHAPE.crop:
      emitCrop(opaqueBuf, x, y, z, pi, id, meta);
      return;
    case SHAPE.liquid:
      emitLiquid(id === B.water ? transBuf : opaqueBuf, x, y, z, pi, id, meta);
      return;
    case SHAPE.torch:
      emitTorch(opaqueBuf, x, y, z, pi, id, meta);
      return;
    case SHAPE.ladder:
      emitLadder(opaqueBuf, x, y, z, pi, id, meta);
      return;
    case SHAPE.slab:
      emitBoxes(opaqueBuf, x, y, z, pi, id, meta, meta === 2 ? [[0, 0, 0, 1, 1, 1]] : meta === 1 ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]]);
      return;
    case SHAPE.stairs:
      emitBoxes(opaqueBuf, x, y, z, pi, id, meta, stairBoxes(meta));
      return;
    case SHAPE.door: {
      const bx = doorBox(meta);
      emitBoxes(opaqueBuf, x, y, z, pi, id, meta, [bx], { noCull: true });
      return;
    }
    case SHAPE.cactus:
      emitBoxes(opaqueBuf, x, y, z, pi, id, meta, [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]], { skipFaces: [false, false, pBlocks[pi + P2] === id, pBlocks[pi - P2] === id, false, false] });
      return;
    case SHAPE.farmland:
      emitBoxes(opaqueBuf, x, y, z, pi, id, meta, [[0, 0, 0, 1, 15 / 16, 1]]);
      return;
    case SHAPE.snow:
      emitBoxes(opaqueBuf, x, y, z, pi, id, meta, [[0, 0, 0, 1, 2 / 16, 1]]);
      return;
    case SHAPE.bed:
      emitBoxes(opaqueBuf, x, y, z, pi, id, meta, [[0, 0, 0, 1, 9 / 16, 1]]);
      return;
    case SHAPE.chest:
      emitBoxes(opaqueBuf, x, y, z, pi, id, meta, [[1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16]]);
      return;
    case SHAPE.fence:
      emitBoxes(opaqueBuf, x, y, z, pi, id, meta, fenceBoxes(pi));
      return;
    case SHAPE.gate:
      emitBoxes(opaqueBuf, x, y, z, pi, id, meta, gateBoxes(meta));
      return;
    default:
      return;
  }
}

// Build both buffers for a section. Returns { opaque, trans } (either may be null).
export function buildSection(world, c, s) {
  // Skip empty sections quickly.
  const base = s << 12;
  let any = false;
  for (let i = 0; i < 4096; i++) if (c.blocks[base + i] !== 0) { any = true; break; }
  if (!any) return { opaque: null, trans: null };
  fillPadded(world, c, s);
  opaqueBuf.reset();
  transBuf.reset();
  const wx0 = c.cx * 16, wz0 = c.cz * 16;
  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      let pi = pidx(0, y, z);
      for (let x = 0; x < 16; x++, pi++) {
        if (pBlocks[pi] !== 0) emitBlock(x, y, z, pi, wx0 + x, wz0 + z);
      }
    }
  }
  return { opaque: opaqueBuf.result(), trans: transBuf.result() };
}

// Geometry for a single block in isolation (items, icons, falling blocks).
export function buildSingleBlock(id, meta, light = 15) {
  pBlocks.fill(0);
  pMeta.fill(0);
  pSky.fill(light);
  pBlk.fill(0);
  for (let i = 0; i < P2; i++) {
    pTint[i * 6] = 124; pTint[i * 6 + 1] = 189; pTint[i * 6 + 2] = 76;
    pTint[i * 6 + 3] = 92; pTint[i * 6 + 4] = 171; pTint[i * 6 + 5] = 60;
    pBiome[i] = 3;
  }
  const pi = pidx(0, 0, 0);
  pBlocks[pi] = id;
  pMeta[pi] = meta;
  opaqueBuf.reset();
  transBuf.reset();
  const shape = shapeId[id];
  if (shape === SHAPE.cube) {
    // No AO for isolated blocks.
    const base = (id * 16 + (meta & 15)) * 6;
    const tint = tintFor(id, pi % P2);
    const buf = isTranslucent[id] ? transBuf : opaqueBuf;
    for (let f = 0; f < 6; f++) {
      let layer = TEX[base + f], overlay = 255, t = tint;
      if (id === B.grass_block && f !== 2) {
        t = null;
        if (f !== 3) { overlay = OVERLAY_GRASS; t = tint; }
      }
      cubeFace(buf, 0, 0, 0, pi, f, layer, ROT[base + f], overlay, t, ANIM[layer], false);
    }
  } else if (shape === SHAPE.liquid) {
    emitLiquid(opaqueBuf, 0, 0, 0, pi, id, meta);
  } else {
    emitBlock(0, 0, 0, pi, 0, 0);
  }
  const a = opaqueBuf.result();
  const b = transBuf.result();
  return merge(a, b);
}

function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  const n = a.vertices + b.vertices;
  const cat = (A, x, y) => { const r = new A(x.length + y.length); r.set(x); r.set(y, x.length); return r; };
  const index = new Uint32Array(a.index.length + b.index.length);
  index.set(a.index);
  for (let i = 0; i < b.index.length; i++) index[a.index.length + i] = b.index[i] + a.vertices;
  return { pos: cat(Int16Array, a.pos, b.pos), d1: cat(Uint8Array, a.d1, b.d1), d2: cat(Uint8Array, a.d2, b.d2), tint: cat(Uint8Array, a.tint, b.tint), index, vertices: n };
}

export function tileLayer(id, meta, face) {
  return TEX[(id * 16 + (meta & 15)) * 6 + face];
}

export { blockBoxes, edgeBox };
