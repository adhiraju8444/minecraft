// Streams chunks in around the player: reads saved chunks from storage,
// asks generator workers for new ones, and unloads distant chunks. In a
// multiplayer game, chunks that players have changed come from the server
// (`remote`); everything else is still generated here from the seed.
import { chunkKey } from './constants.js';
import { Chunk } from './chunk.js';
import { WorldGen } from './worldgen.js';

export class ChunkLoader {
  constructor(world, storage, hooks, remote = null) {
    this.world = world;
    this.storage = storage; // may be null (menu world)
    this.hooks = hooks; // { onLoaded(chunk, data, fromSave), onUnload(chunk) }
    this.remote = remote; // multiplayer connection, or null
    this.netWait = new Map(); // chunk key -> time requested from the server
    this.pending = new Set();
    this.arrived = [];
    this.workers = [];
    this.rr = 0;
    this.inFlight = 0;
    this.syncGen = null;
    this.destroyed = false;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./genworker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this.onWorkerMessage(e.data);
        w.onerror = (e) => {
          console.warn('Generator worker failed, generating on the main thread', e.message);
          this.fallback();
        };
        w.postMessage({ type: 'init', seed: world.seed });
        this.workers.push(w);
      }
    } catch (err) {
      console.warn('Workers unavailable, generating on the main thread', err);
      this.fallback();
    }
    this.maxInFlight = Math.max(4, this.workers.length * 3);
  }

  fallback() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    if (!this.syncGen) this.syncGen = new WorldGen(this.world.seed);
    // Anything that was in flight has to be re-requested.
    this.pending.clear();
    this.inFlight = 0;
  }

  onWorkerMessage(m) {
    if (this.destroyed || m.type !== 'chunk') return;
    this.inFlight--;
    this.arrived.push({ data: m, fromSave: false });
  }

  request(cx, cz) {
    const key = chunkKey(cx, cz);
    this.pending.add(key);
    if (this.remote && this.remote.isChanged(cx, cz)) {
      this.requestNet(cx, cz);
      return;
    }
    const st = this.storage;
    if (st && st.hasChunk(cx, cz)) {
      this.inFlight++;
      st.loadChunk(cx, cz).then((rec) => {
        if (this.destroyed) return;
        this.inFlight--;
        if (rec) this.arrived.push({ data: rec, fromSave: true });
        else this.generate(cx, cz);
      }).catch(() => {
        this.inFlight--;
        this.generate(cx, cz);
      });
      return;
    }
    this.generate(cx, cz);
  }

  requestNet(cx, cz) {
    this.inFlight++;
    this.netWait.set(chunkKey(cx, cz), performance.now());
    this.remote.requestChunk(cx, cz);
  }

  // A changed chunk arrived from the server.
  receiveNet(cx, cz, data) {
    const key = chunkKey(cx, cz);
    if (!this.netWait.delete(key) || this.destroyed) return;
    this.inFlight--;
    this.arrived.push({ data: { cx, cz, ...data }, fromSave: true, fromNet: true });
  }

  // The server has nothing stored for this chunk: generate it here.
  receiveGenerate(key) {
    if (!this.netWait.delete(key) || this.destroyed) return;
    this.inFlight--;
    const cz = (key % 65536) - 32768, cx = (key - (cz + 32768)) / 65536 - 32768;
    this.generate(cx, cz);
  }

  generate(cx, cz) {
    if (this.workers.length) {
      this.inFlight++;
      this.workers[this.rr++ % this.workers.length].postMessage({ type: 'gen', cx, cz });
    } else {
      // Main-thread fallback: generate later in update() within a time budget.
      this.syncQueue = this.syncQueue || [];
      this.syncQueue.push([cx, cz]);
    }
  }

  // Returns true when every chunk within `radius` of the player is loaded.
  update(px, pz, renderDist, budgetMs = 8) {
    const world = this.world;
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    const loadR = renderDist + 1;
    const t0 = performance.now();

    // Integrate arrived chunks (lighting is the expensive part).
    this.arrived.sort((a, b) => dist2(a.data, pcx, pcz) - dist2(b.data, pcx, pcz));
    while (this.arrived.length && performance.now() - t0 < budgetMs) {
      const { data, fromSave, fromNet } = this.arrived.shift();
      const key = chunkKey(data.cx, data.cz);
      if (world.getChunk(data.cx, data.cz)) {
        this.pending.delete(key);
        continue;
      }
      if (Math.max(Math.abs(data.cx - pcx), Math.abs(data.cz - pcz)) > loadR + 2) {
        this.pending.delete(key);
        continue;
      }
      // Someone changed this chunk while it was being generated here: fetch the real one.
      if (this.remote && !fromNet && this.remote.isChanged(data.cx, data.cz)) {
        this.requestNet(data.cx, data.cz);
        continue;
      }
      this.pending.delete(key);
      const c = new Chunk(data.cx, data.cz, data);
      if (fromSave) c.modified = false;
      this.hooks.onBeforeAdd?.(c, data, fromSave);
      world.addChunk(c);
      this.hooks.onLoaded?.(c, data, fromSave);
    }

    // Main-thread generation fallback
    if (this.syncQueue && this.syncQueue.length) {
      this.syncQueue.sort((a, b) => (a[0] - pcx) ** 2 + (a[1] - pcz) ** 2 - ((b[0] - pcx) ** 2 + (b[1] - pcz) ** 2));
      while (this.syncQueue.length && performance.now() - t0 < budgetMs) {
        const [cx, cz] = this.syncQueue.shift();
        const r = this.syncGen.generate(cx, cz);
        this.arrived.push({ data: { cx, cz, ...r }, fromSave: false });
      }
    }

    // Ask again for chunks the server has not answered (lost or slow).
    if (this.netWait.size) {
      const now = performance.now();
      for (const [key, t] of this.netWait) {
        if (now - t < 10000) continue;
        const cz = (key % 65536) - 32768, cx = (key - (cz + 32768)) / 65536 - 32768;
        this.netWait.set(key, now);
        this.remote.requestChunk(cx, cz);
      }
    }

    // Request missing chunks, nearest first.
    let missing = 0;
    if (this.inFlight < this.maxInFlight) {
      const want = [];
      for (let dz = -loadR; dz <= loadR; dz++) {
        for (let dx = -loadR; dx <= loadR; dx++) {
          if (dx * dx + dz * dz > (loadR + 0.5) * (loadR + 0.5)) continue;
          const cx = pcx + dx, cz = pcz + dz;
          const key = chunkKey(cx, cz);
          if (world.chunks.has(key) || this.pending.has(key)) continue;
          want.push([dx * dx + dz * dz, cx, cz]);
        }
      }
      missing = want.length;
      want.sort((a, b) => a[0] - b[0]);
      for (const [, cx, cz] of want) {
        if (this.inFlight >= this.maxInFlight) break;
        this.request(cx, cz);
      }
    }

    // Unload far chunks
    const unloadR = renderDist + 3;
    for (const c of world.chunks.values()) {
      if (Math.abs(c.cx - pcx) > unloadR || Math.abs(c.cz - pcz) > unloadR) {
        this.hooks.onUnload?.(c);
        world.removeChunk(c);
      }
    }
    return missing === 0 && this.arrived.length === 0 && this.pending.size === 0;
  }

  // Are all chunks in the square of radius r around the player loaded?
  areaLoaded(px, pz, r) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (!this.world.getChunk(pcx + dx, pcz + dz)) return false;
    return true;
  }

  destroy() {
    this.destroyed = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}

function dist2(d, cx, cz) {
  return (d.cx - cx) ** 2 + (d.cz - cz) ** 2;
}
