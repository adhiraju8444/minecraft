// Terrain generation on worker threads so the 20 TPS game loop stays smooth.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { WorldGen } from '../js/world/worldgen.js';

if (!isMainThread && parentPort && workerData && workerData.genWorker) {
  const gen = new WorldGen(workerData.seed);
  parentPort.on('message', ({ cx, cz }) => {
    const r = gen.generate(cx, cz);
    parentPort.postMessage({ cx, cz, ...r }, [r.blocks.buffer, r.meta.buffer, r.biomes.buffer, r.temps.buffer, r.humids.buffer, r.heights.buffer]);
  });
}

export class GenPool {
  constructor(seed, size = Math.max(1, Math.min(3, os.cpus().length - 1))) {
    this.seed = seed;
    this.workers = [];
    this.waiting = new Map(); // "cx,cz" -> [resolve...]
    this.jobs = new Map(); // worker -> Set of "cx,cz" it is working on
    this.rr = 0;
    this.sync = null;
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL(import.meta.url), { workerData: { genWorker: true, seed } });
        this.jobs.set(w, new Set());
        w.on('message', (m) => {
          this.jobs.get(w)?.delete(m.cx + ',' + m.cz);
          this.done(m);
        });
        const lost = (why) => {
          if (!this.jobs.has(w)) return;
          const keys = [...this.jobs.get(w)];
          this.jobs.delete(w);
          this.workers = this.workers.filter((x) => x !== w);
          if (!this.closing) console.error(`[gen] a terrain worker stopped (${why}); ${this.workers.length ? 'using the others' : 'generating on the main thread'}`);
          // Hand its unfinished chunks to another worker (or do them here).
          for (const k of keys) {
            const [cx, cz] = k.split(',').map(Number);
            this.dispatch(cx, cz);
          }
        };
        w.on('error', (e) => lost(e.message));
        w.on('exit', (code) => lost('exit ' + code));
        w.unref();
        this.workers.push(w);
      }
    } catch (e) {
      console.error('[gen] workers unavailable:', e.message);
    }
  }

  dispatch(cx, cz) {
    if (this.closing) return;
    if (this.workers.length) {
      const w = this.workers[this.rr++ % this.workers.length];
      this.jobs.get(w).add(cx + ',' + cz);
      w.postMessage({ cx, cz });
    } else {
      setImmediate(() => this.done({ cx, cz, ...this.generateSync(cx, cz) }));
    }
  }

  done(m) {
    const key = m.cx + ',' + m.cz;
    const list = this.waiting.get(key);
    this.waiting.delete(key);
    if (list) for (const r of list) r(m);
  }

  generate(cx, cz) {
    const key = cx + ',' + cz;
    return new Promise((resolve) => {
      const list = this.waiting.get(key);
      if (list) {
        list.push(resolve);
        return;
      }
      this.waiting.set(key, [resolve]);
      this.dispatch(cx, cz);
    });
  }

  generateSync(cx, cz) {
    if (!this.sync) this.sync = new WorldGen(this.seed);
    return this.sync.generate(cx, cz);
  }

  close() {
    this.closing = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
