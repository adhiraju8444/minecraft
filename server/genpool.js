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
    this.rr = 0;
    this.sync = null;
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL(import.meta.url), { workerData: { genWorker: true, seed } });
        w.on('message', (m) => this.done(m));
        w.on('error', (e) => {
          console.error('[gen] worker failed, generating on the main thread:', e.message);
          this.workers = this.workers.filter((x) => x !== w);
        });
        w.unref();
        this.workers.push(w);
      }
    } catch (e) {
      console.error('[gen] workers unavailable:', e.message);
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
      if (this.workers.length) {
        this.workers[this.rr++ % this.workers.length].postMessage({ cx, cz });
      } else {
        // No workers: generate right away on this thread.
        setImmediate(() => this.done({ cx, cz, ...this.generateSync(cx, cz) }));
      }
    });
  }

  generateSync(cx, cz) {
    if (!this.sync) this.sync = new WorldGen(this.seed);
    return this.sync.generate(cx, cz);
  }

  close() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
