// Terrain generation worker.
import { WorldGen } from './worldgen.js';

let gen = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    gen = new WorldGen(m.seed);
    return;
  }
  if (m.type === 'gen') {
    const r = gen.generate(m.cx, m.cz);
    self.postMessage(
      { type: 'chunk', cx: m.cx, cz: m.cz, ...r },
      [r.blocks.buffer, r.meta.buffer, r.biomes.buffer, r.temps.buffer, r.humids.buffer, r.heights.buffer]
    );
  }
};
