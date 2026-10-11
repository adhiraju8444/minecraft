import { CHUNK, HEIGHT, chunkKey, DAY_LENGTH } from './constants.js';
import { BLOCKS, B, UNLOADED, isLiquid } from '../data/blocks.js';
import { lightNewChunk, relightCell, markCellDirty } from './light.js';
import { WorldGen } from './worldgen.js';
import * as behaviors from './behaviors.js';
import { createTileEntity, tickTileEntity } from './tileentities.js';
import { mulberry32 } from '../util/rng.js';

export const NOTIFY = 1;
export const SILENT = 0;

function posKey(x, y, z) {
  return ((x + 1048576) * 2097152 + (z + 1048576)) * 128 + y;
}
function keyPos(k) {
  const y = k % 128;
  const r = (k - y) / 128;
  const z = (r % 2097152) - 1048576;
  const x = Math.floor(r / 2097152) - 1048576;
  return [x, y, z];
}

export class World {
  constructor(game, opts) {
    this.game = game;
    this.seed = opts.seed | 0;
    this.gen = new WorldGen(this.seed);
    this.chunks = new Map();
    this.entities = [];
    this.time = opts.time ?? 1000; // time of day in ticks
    this.day = opts.day ?? 0;
    this.tickCount = opts.tickCount ?? 0;
    this.scheduled = new Map(); // dueTick -> array of keys
    this.scheduledSet = new Set();
    this.rng = mulberry32((this.seed ^ 0x5bd1e995) | 0);
    this.weather = Object.assign({ raining: false, timer: 12000 + Math.floor(Math.random() * 24000), strength: 0 }, opts.weather || {});
    this.rules = Object.assign({ doDaylightCycle: true, keepInventory: false, doMobSpawning: true, doFireTick: true, randomTickSpeed: 3 }, opts.rules || {});
    this.activeTiles = new Set(); // tile entities that need ticking
    this._lc = null;
    this._lx = 0;
    this._lz = 0;
  }

  // ---------------------------------------------------------- chunks
  getChunk(cx, cz) {
    if (this._lc && this._lx === cx && this._lz === cz) return this._lc;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) {
      this._lc = c;
      this._lx = cx;
      this._lz = cz;
    }
    return c || null;
  }

  addChunk(c) {
    this.chunks.set(chunkKey(c.cx, c.cz), c);
    const n = [this.getChunk(c.cx + 1, c.cz), this.getChunk(c.cx - 1, c.cz), this.getChunk(c.cx, c.cz + 1), this.getChunk(c.cx, c.cz - 1)];
    c.nb = n;
    if (n[0]) n[0].nb[1] = c;
    if (n[1]) n[1].nb[0] = c;
    if (n[2]) n[2].nb[3] = c;
    if (n[3]) n[3].nb[2] = c;
    lightNewChunk(c);
    // Neighbours' border meshes depend on this chunk now.
    for (const nb of n) if (nb) nb.markAllDirty();
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const d = this.getChunk(c.cx + dx, c.cz + dz);
      if (d) d.markAllDirty();
    }
    for (const te of c.tileEntities.values()) if (te.ticks) this.activeTiles.add(te);
  }

  removeChunk(c) {
    this.chunks.delete(chunkKey(c.cx, c.cz));
    if (this._lc === c) this._lc = null;
    if (c.nb[0]) c.nb[0].nb[1] = null;
    if (c.nb[1]) c.nb[1].nb[0] = null;
    if (c.nb[2]) c.nb[2].nb[3] = null;
    if (c.nb[3]) c.nb[3].nb[2] = null;
    c.nb = [null, null, null, null];
    for (const te of c.tileEntities.values()) this.activeTiles.delete(te);
  }

  isChunkLoaded(cx, cz) {
    return this.getChunk(cx, cz) !== null;
  }

  isLoadedAt(x, z) {
    return this.getChunk(x >> 4, z >> 4) !== null;
  }

  // ---------------------------------------------------------- blocks
  getBlock(x, y, z) {
    if (y < 0) return B.bedrock;
    if (y >= HEIGHT) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return UNLOADED;
    return c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  getMeta(x, y, z) {
    if (y < 0 || y >= HEIGHT) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.meta[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  getSkyLight(x, y, z) {
    if (y >= HEIGHT) return 15;
    if (y < 0) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 15;
    return c.sky[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  getBlockLight(x, y, z) {
    if (y >= HEIGHT || y < 0) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.blk[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  // How much the sky is darkened right now (0 day .. 11 night), as the
  // game logic sees it (mob spawning, crop growth...).
  skyDarken() {
    const f = this.daylight();
    let d = Math.round((1 - f) * 11);
    if (this.weather.raining) d = Math.max(d, 3);
    return d;
  }

  // Effective light level at a position (what an F3 screen shows).
  lightAt(x, y, z) {
    return Math.max(this.getBlockLight(x, y, z), this.getSkyLight(x, y, z) - this.skyDarken());
  }

  getBiome(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.biomes[(x & 15) | ((z & 15) << 4)];
  }

  // Highest y with a non-air block (for rain, spawning). -1 if none.
  topY(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return -1;
    const col = (x & 15) | ((z & 15) << 4);
    for (let y = c.maxY; y >= 0; y--) if (c.blocks[col | (y << 8)] !== 0) return y;
    return -1;
  }

  // Highest y that blocks rain (solid or liquid).
  rainY(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    const col = (x & 15) | ((z & 15) << 4);
    for (let y = c.maxY; y >= 0; y--) {
      const id = c.blocks[col | (y << 8)];
      if (id !== 0 && (BLOCKS[id].solid || isLiquid[id] || BLOCKS[id].leaves)) return y;
    }
    return 0;
  }

  setBlock(x, y, z, id, meta = 0, flags = NOTIFY) {
    if (y < 0 || y >= HEIGHT) return false;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return false;
    // A multiplayer client only predicts its own edits locally; the server
    // runs the block rules and sends back the real result.
    const fromPlayer = this.remote && !this.applyingRemote;
    const wanted = flags;
    if (this.remote) flags = SILENT;
    const i = (x & 15) | ((z & 15) << 4) | (y << 8);
    const old = c.blocks[i];
    const oldMeta = c.meta[i];
    if (old === id && oldMeta === meta) return false;
    c.blocks[i] = id;
    c.meta[i] = meta;
    if (id !== 0 && y > c.maxY) c.maxY = y;
    c.modified = true;
    c.changed = true;
    if (old !== id) {
      const te = c.tileEntities.get(i);
      if (te) {
        // Lit/unlit furnace swaps keep their contents.
        const keep = (old === B.furnace && id === B.lit_furnace) || (old === B.lit_furnace && id === B.furnace);
        if (!keep) {
          c.tileEntities.delete(i);
          this.activeTiles.delete(te);
          if (!this.remote) this.spillTile(te);
        } else te.blockId = id;
      }
      if (!c.tileEntities.has(i)) {
        const nte = createTileEntity(id, x, y, z);
        if (nte) {
          c.tileEntities.set(i, nte);
          if (nte.ticks) this.activeTiles.add(nte);
        }
      }
    }
    if (c.lit && old !== id) relightCell(c, i, old, id);
    markCellDirty(c, i);
    if (this.onChange) this.onChange(x, y, z, id, meta);
    if (fromPlayer) this.remote.sendSet(x, y, z, id, meta, wanted);
    if (flags & NOTIFY) {
      this.notifyNeighbors(x, y, z);
      behaviors.onBlockChanged(this, x, y, z, old, id, meta);
    }
    return true;
  }

  // Apply a block that came from the server (no echo back, no block rules).
  applyRemote(x, y, z, id, meta) {
    this.applyingRemote = true;
    try {
      return this.setBlock(x, y, z, id, meta, SILENT);
    } finally {
      this.applyingRemote = false;
    }
  }

  // Chests and furnaces drop what they held when they are broken.
  spillTile(te) {
    if (!te.items || !this.game || !this.game.dropItem) return;
    for (let k = 0; k < te.items.length; k++) {
      const s = te.items[k];
      if (s && s.count > 0) this.game.dropItem(te.x + 0.5, te.y + 0.5, te.z + 0.5, s, null, true);
      te.items[k] = null;
    }
  }

  setMeta(x, y, z, meta, notify = false) {
    return this.setBlock(x, y, z, this.getBlock(x, y, z), meta, notify ? NOTIFY : SILENT);
  }

  notifyNeighbors(x, y, z) {
    behaviors.neighborChanged(this, x + 1, y, z, x, y, z);
    behaviors.neighborChanged(this, x - 1, y, z, x, y, z);
    behaviors.neighborChanged(this, x, y + 1, z, x, y, z);
    behaviors.neighborChanged(this, x, y - 1, z, x, y, z);
    behaviors.neighborChanged(this, x, y, z + 1, x, y, z);
    behaviors.neighborChanged(this, x, y, z - 1, x, y, z);
  }

  getTileEntity(x, y, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return null;
    return c.tileEntities.get((x & 15) | ((z & 15) << 4) | (y << 8)) || null;
  }

  markTileDirty(te) {
    // On a multiplayer client the server owns container contents.
    if (this.remote) {
      this.remote.sendTile(te);
      return;
    }
    const c = this.getChunk(te.x >> 4, te.z >> 4);
    if (c) {
      c.modified = true;
      c.changed = true;
    }
    if (this.onTileChange) this.onTileChange(te);
  }

  // ---------------------------------------------------------- ticks
  scheduleTick(x, y, z, delay) {
    const k = posKey(x, y, z);
    if (this.scheduledSet.has(k)) return;
    this.scheduledSet.add(k);
    const due = this.tickCount + Math.max(1, delay);
    let list = this.scheduled.get(due);
    if (!list) this.scheduled.set(due, (list = []));
    list.push(k);
  }

  runScheduled() {
    const list = this.scheduled.get(this.tickCount);
    if (!list) return;
    this.scheduled.delete(this.tickCount);
    for (const k of list) {
      this.scheduledSet.delete(k);
      const [x, y, z] = keyPos(k);
      if (!this.isLoadedAt(x, z)) continue;
      behaviors.scheduledTick(this, x, y, z);
    }
  }

  randomTicks(cx0, cz0, radius) {
    const speed = this.rules.randomTickSpeed;
    if (speed <= 0) return;
    const r = this.rng;
    for (let cz = cz0 - radius; cz <= cz0 + radius; cz++) {
      for (let cx = cx0 - radius; cx <= cx0 + radius; cx++) {
        const c = this.getChunk(cx, cz);
        if (!c) continue;
        const sections = (c.maxY >> 4) + 1;
        for (let s = 0; s < sections; s++) {
          for (let n = 0; n < speed; n++) {
            const v = (r() * 4096) | 0;
            const i = (s << 12) | v;
            const id = c.blocks[i];
            if (id === 0 || !behaviors.RANDOM_TICK[id]) continue;
            const x = (cx << 4) | (i & 15), z = (cz << 4) | ((i >> 4) & 15), y = i >> 8;
            behaviors.randomTick(this, x, y, z, id, c.meta[i], r);
          }
        }
      }
    }
  }

  tickTiles() {
    for (const te of this.activeTiles) tickTileEntity(this, te);
  }

  // ---------------------------------------------------------- time
  // 0..1 brightness of daylight, smooth across dawn and dusk.
  daylight() {
    const a = this.celestialAngle();
    let f = 1 - (Math.cos(a * Math.PI * 2) * 2 + 0.5);
    f = Math.max(0, Math.min(1, f));
    let v = 1 - f;
    if (this.weather.strength > 0) v *= 1 - this.weather.strength * 0.3;
    return v;
  }

  // 0 = noon, 0.5 = midnight, as in the classic sun model.
  celestialAngle(partial = 0) {
    const t = ((this.time + partial) % DAY_LENGTH) / DAY_LENGTH - 0.25;
    let f = t < 0 ? t + 1 : t;
    const g = f;
    f = 1 - (Math.cos(f * Math.PI) + 1) / 2;
    return g + (f - g) / 3;
  }

  isNight() {
    const t = this.time % DAY_LENGTH;
    return t > 12542 && t < 23460;
  }

  tickTime() {
    this.tickCount++;
    if (this.rules.doDaylightCycle) {
      this.time++;
      if (this.time >= DAY_LENGTH) {
        this.time -= DAY_LENGTH;
        this.day++;
      }
    }
    // Weather (a multiplayer client gets it from the server)
    const w = this.weather;
    if (!this.remote) w.timer--;
    if (w.timer <= 0 && !this.remote) {
      w.raining = !w.raining;
      w.timer = w.raining ? 12000 + Math.floor(Math.random() * 12000) : 12000 + Math.floor(Math.random() * 156000);
    }
    w.strength += w.raining ? 0.01 : -0.01;
    w.strength = Math.max(0, Math.min(1, w.strength));
  }

  // Is this column exposed to rain right now?
  isRainingAt(x, y, z) {
    if (!this.weather.raining) return false;
    return this.rainY(x, z) < y;
  }

  // ---------------------------------------------------------- helpers
  forEachChunk(fn) {
    for (const c of this.chunks.values()) fn(c);
  }

  serializeScheduled() {
    const out = [];
    for (const [due, list] of this.scheduled) for (const k of list) out.push([k, due - this.tickCount]);
    return out;
  }
}
