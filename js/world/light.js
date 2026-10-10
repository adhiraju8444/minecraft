// Flood-fill lighting with two channels: sky light (sunlight that falls
// straight down at full strength and spreads sideways) and block light
// (torches, lava, glowstone...). Both range 0..15.
import { lightOpacity, lightEmit } from '../data/blocks.js';
import { HEIGHT } from './constants.js';

class Queue {
  constructor() {
    this.c = [];
    this.i = new Int32Array(1 << 16);
    this.l = new Uint8Array(1 << 16);
    this.head = 0;
    this.tail = 0;
  }
  push(chunk, idx, level = 0) {
    if (this.tail >= this.i.length) this.grow();
    this.c[this.tail] = chunk;
    this.i[this.tail] = idx;
    this.l[this.tail] = level;
    this.tail++;
  }
  grow() {
    if (this.head > 0) {
      // compact
      const n = this.tail - this.head;
      this.i.copyWithin(0, this.head, this.tail);
      this.l.copyWithin(0, this.head, this.tail);
      this.c.copyWithin(0, this.head, this.tail);
      this.c.length = n;
      this.tail = n;
      this.head = 0;
      if (this.tail < this.i.length * 0.75) return;
    }
    const ni = new Int32Array(this.i.length * 2);
    ni.set(this.i);
    this.i = ni;
    const nl = new Uint8Array(this.l.length * 2);
    nl.set(this.l);
    this.l = nl;
  }
  get empty() {
    return this.head >= this.tail;
  }
  reset() {
    this.head = 0;
    this.tail = 0;
    this.c.length = 0;
  }
}

const addQ = new Queue();
const remQ = new Queue();

// Mark the section holding a cell (and any section whose mesh samples it) dirty.
export function markCellDirty(c, i) {
  const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
  const s = y >> 4;
  c.sections[s].dirty = true;
  const sy = y & 15;
  if (sy === 0 && s > 0) c.sections[s - 1].dirty = true;
  else if (sy === 15 && s < c.sections.length - 1) c.sections[s + 1].dirty = true;
  if (x === 0 || x === 15 || z === 0 || z === 15) {
    const ex = x === 0 ? c.nb[1] : x === 15 ? c.nb[0] : null;
    const ez = z === 0 ? c.nb[3] : z === 15 ? c.nb[2] : null;
    if (ex) ex.sections[s].dirty = true;
    if (ez) ez.sections[s].dirty = true;
    if (ex && ez) {
      const d = c.diag(x === 0 ? -1 : 1, z === 0 ? -1 : 1);
      if (d) d.sections[s].dirty = true;
    }
  }
}

// Neighbour iteration helpers. dir: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
let nC = null;
let nI = 0;
function neighbor(c, i, dir) {
  const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
  switch (dir) {
    case 0: if (x < 15) { nC = c; nI = i + 1; } else { nC = c.nb[0]; nI = i - 15; } break;
    case 1: if (x > 0) { nC = c; nI = i - 1; } else { nC = c.nb[1]; nI = i + 15; } break;
    case 2: if (y < HEIGHT - 1) { nC = c; nI = i + 256; } else nC = null; break;
    case 3: if (y > 0) { nC = c; nI = i - 256; } else nC = null; break;
    case 4: if (z < 15) { nC = c; nI = i + 16; } else { nC = c.nb[2]; nI = i - 240; } break;
    case 5: if (z > 0) { nC = c; nI = i - 16; } else { nC = c.nb[3]; nI = i + 240; } break;
  }
  return nC !== null && nC.lit;
}

function propagate(sky) {
  const q = addQ;
  while (q.head < q.tail) {
    const c = q.c[q.head];
    const i = q.i[q.head];
    q.head++;
    const arr = sky ? c.sky : c.blk;
    const level = arr[i];
    if (level <= 1) continue;
    for (let d = 0; d < 6; d++) {
      if (!neighbor(c, i, d)) continue;
      const nc = nC, ni = nI;
      const op = lightOpacity[nc.blocks[ni]];
      if (op >= 15) continue;
      let nl = level - (op > 1 ? op : 1);
      if (sky && d === 3 && level === 15 && op === 0) nl = 15;
      const narr = sky ? nc.sky : nc.blk;
      if (nl > narr[ni]) {
        narr[ni] = nl;
        markCellDirty(nc, ni);
        q.push(nc, ni);
      }
    }
  }
  q.reset();
}

function unpropagate(sky) {
  const q = remQ;
  while (q.head < q.tail) {
    const c = q.c[q.head];
    const i = q.i[q.head];
    const level = q.l[q.head];
    q.head++;
    for (let d = 0; d < 6; d++) {
      if (!neighbor(c, i, d)) continue;
      const nc = nC, ni = nI;
      const narr = sky ? nc.sky : nc.blk;
      const nl = narr[ni];
      if (nl === 0) continue;
      if (nl < level || (sky && d === 3 && level === 15 && nl === 15)) {
        narr[ni] = 0;
        markCellDirty(nc, ni);
        q.push(nc, ni, nl);
        if (!sky) {
          const e = lightEmit[nc.blocks[ni]];
          if (e > 0) {
            narr[ni] = e;
            addQ.push(nc, ni);
          }
        }
      } else {
        addQ.push(nc, ni);
      }
    }
  }
  q.reset();
}

// Initial lighting for a freshly loaded chunk.
export function lightNewChunk(c) {
  const b = c.blocks, sky = c.sky, blk = c.blk;
  sky.fill(0);
  blk.fill(0);
  // Sun columns
  for (let col = 0; col < 256; col++) {
    let level = 15;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const i = col | (y << 8);
      const op = lightOpacity[b[i]];
      if (op) level = op >= 15 ? 0 : Math.max(0, level - op);
      if (level === 0) break;
      sky[i] = level;
    }
  }
  c.lit = true;
  // Sky seeds: lit cells next to darker see-through cells.
  const top = Math.min(HEIGHT - 1, c.maxY + 1);
  for (let y = 0; y <= top; y++) {
    for (let col = 0; col < 256; col++) {
      const i = col | (y << 8);
      const l = sky[i];
      if (l <= 1) continue;
      for (let d = 0; d < 6; d++) {
        if (d === 2) continue;
        if (!neighbor(c, i, d)) continue;
        if (lightOpacity[nC.blocks[nI]] >= 15) continue;
        if (nC.sky[nI] < l - 1) {
          addQ.push(c, i);
          break;
        }
      }
    }
  }
  // Light flowing in from neighbours that are already lit.
  seedFromNeighbors(c, true);
  propagate(true);

  // Block light from emitters
  for (let i = 0; i < b.length; i++) {
    const e = lightEmit[b[i]];
    if (e) {
      blk[i] = e;
      addQ.push(c, i);
    }
  }
  seedFromNeighbors(c, false);
  propagate(false);
}

function seedFromNeighbors(c, sky) {
  for (let d = 0; d < 4; d++) {
    const n = c.nb[d];
    if (!n || !n.lit) continue;
    const arr = sky ? n.sky : n.blk;
    // Border column of the neighbour that touches this chunk.
    for (let y = 0; y < HEIGHT; y++) {
      for (let k = 0; k < 16; k++) {
        let lx, lz;
        if (d === 0) { lx = 0; lz = k; } // neighbour at +x: its x=0 column
        else if (d === 1) { lx = 15; lz = k; }
        else if (d === 2) { lx = k; lz = 0; }
        else { lx = k; lz = 15; }
        const i = lx | (lz << 4) | (y << 8);
        if (arr[i] > 1) addQ.push(n, i);
      }
    }
  }
}

// Re-light around a cell after its block changed.
export function relightCell(c, i, oldId, newId) {
  const oldOp = lightOpacity[oldId], newOp = lightOpacity[newId];
  const oldE = lightEmit[oldId], newE = lightEmit[newId];
  if (oldE !== newE || oldOp !== newOp) {
    // Block light
    const cur = c.blk[i];
    if (cur > 0) {
      c.blk[i] = 0;
      markCellDirty(c, i);
      remQ.push(c, i, cur);
      unpropagate(false);
    }
    if (newE > 0) {
      c.blk[i] = newE;
      markCellDirty(c, i);
      addQ.push(c, i);
    }
    for (let d = 0; d < 6; d++) if (neighbor(c, i, d)) addQ.push(nC, nI);
    propagate(false);
  }
  if (oldOp !== newOp) {
    const cur = c.sky[i];
    if (cur > 0) {
      c.sky[i] = 0;
      markCellDirty(c, i);
      remQ.push(c, i, cur);
      unpropagate(true);
    }
    for (let d = 0; d < 6; d++) if (neighbor(c, i, d)) addQ.push(nC, nI);
    propagate(true);
  }
}
