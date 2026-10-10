// Deterministic pseudo-random helpers. Everything world-related is derived
// from the world seed so terrain is reproducible.

export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

// Integer hash of a few ints, used for per-chunk / per-column seeds.
export function hash3(seed, x, y, z = 0) {
  let h = seed | 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = (h ^ (h >>> 15)) | 0;
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h ^ (z | 0), 0x27d4eb2f);
  h = (h ^ (h >>> 16)) | 0;
  return h;
}

export class Random {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  float() {
    return this.next();
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  range(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  seed32() {
    return (this.next() * 4294967296) | 0;
  }
}

// Turns whatever the player typed in the seed box into a 32-bit seed.
export function seedFromInput(text) {
  const t = (text || '').trim();
  if (!t) return (Math.random() * 4294967296) | 0;
  if (/^-?\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n)) return n | 0;
  }
  return hashString(t);
}
