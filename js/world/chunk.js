import { CHUNK_VOLUME, SECTIONS, HEIGHT } from './constants.js';

export class Chunk {
  constructor(cx, cz, data) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = data.blocks;
    this.meta = data.meta;
    this.sky = new Uint8Array(CHUNK_VOLUME);
    this.blk = new Uint8Array(CHUNK_VOLUME);
    this.biomes = data.biomes;
    this.temps = data.temps;
    this.humids = data.humids;
    // neighbours: +x, -x, +z, -z
    this.nb = [null, null, null, null];
    this.lit = false;
    this.modified = false; // needs saving
    this.changed = !!data.changed; // differs from freshly generated terrain
    this.tileEntities = new Map();
    this.sections = [];
    for (let s = 0; s < SECTIONS; s++) this.sections.push({ dirty: true, opaque: null, trans: null, built: false });
    this.meshVersion = 0;
    this.maxY = 0;
    this.recomputeMaxY();
  }

  recomputeMaxY() {
    const b = this.blocks;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const base = y << 8;
      for (let i = 0; i < 256; i++) {
        if (b[base + i] !== 0) {
          this.maxY = y;
          return;
        }
      }
    }
    this.maxY = 0;
  }

  markAllDirty() {
    for (const s of this.sections) s.dirty = true;
  }

  // Diagonal neighbour via the edge links.
  diag(dx, dz) {
    const a = dx > 0 ? this.nb[0] : this.nb[1];
    if (!a) return null;
    return dz > 0 ? a.nb[2] : a.nb[3];
  }
}
