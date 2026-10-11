// Camera-facing particles rebuilt on the CPU every frame.
import * as THREE from '../../vendor/three.module.min.js';
import { makeParticleMaterial } from './materials.js';
import { tileLayer } from './mesher.js';
import { isSolid, BLOCKS } from '../data/blocks.js';
import { DEFAULT_TINTS } from './tiles.js';

const MAX = 1200;

export class Particles {
  constructor(scene, texArray, tileIndex) {
    this.tileIndex = tileIndex;
    this.list = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 4 * 3);
    this.uvl = new Float32Array(MAX * 4 * 3);
    this.col = new Float32Array(MAX * 4 * 4);
    const idx = new Uint32Array(MAX * 6);
    for (let i = 0; i < MAX; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aUvl', new THREE.BufferAttribute(this.uvl, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, makeParticleMaterial(texArray));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
  }

  layer(name) {
    return this.tileIndex.get(name) ?? 0;
  }

  add(p) {
    if (this.list.length >= MAX) this.list.shift();
    p.px = p.x; p.py = p.y; p.pz = p.z;
    p.age = 0;
    p.u0 = p.u0 ?? 0; p.v0 = p.v0 ?? 0; p.u1 = p.u1 ?? 1; p.v1 = p.v1 ?? 1;
    p.r = p.r ?? 1; p.g = p.g ?? 1; p.b = p.b ?? 1;
    p.gravity = p.gravity ?? 0.04;
    p.drag = p.drag ?? 0.98;
    p.collide = p.collide ?? true;
    p.size = p.size ?? 0.1;
    this.list.push(p);
    return p;
  }

  blockTint(id) {
    const t = BLOCKS[id] && BLOCKS[id].tint;
    if (!t) return [1, 1, 1];
    const c = DEFAULT_TINTS[t] || [255, 255, 255];
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }

  // Burst of fragments when a block is destroyed.
  blockBreak(x, y, z, id, meta) {
    if (this.tap) this.tap(x, y, z, id, meta); // multiplayer: share with others
    const layer = tileLayer(id, meta, 4);
    const [r, g, b] = id === 2 ? [1, 1, 1] : this.blockTint(id);
    const n = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      if (Math.random() < 0.35) continue;
      const px = x + (i + 0.5) / n, py = y + (j + 0.5) / n, pz = z + (k + 0.5) / n;
      const u = Math.floor(Math.random() * 12) / 16, v = Math.floor(Math.random() * 12) / 16;
      this.add({
        x: px, y: py, z: pz,
        vx: (px - x - 0.5) * 0.3 + (Math.random() - 0.5) * 0.08,
        vy: (py - y - 0.5) * 0.3 + Math.random() * 0.15,
        vz: (pz - z - 0.5) * 0.3 + (Math.random() - 0.5) * 0.08,
        life: 8 + Math.floor(Math.random() * 20), layer, u0: u, v0: v, u1: u + 4 / 16, v1: v + 4 / 16,
        size: 0.06 + Math.random() * 0.05, r, g, b,
      });
    }
  }

  // Small chips while a block is being mined.
  blockHit(hit) {
    const { x, y, z, face, id, meta } = hit;
    const layer = tileLayer(id, meta, face);
    const [r, g, b] = id === 2 ? [1, 1, 1] : this.blockTint(id);
    const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face];
    let px = x + Math.random(), py = y + Math.random(), pz = z + Math.random();
    if (n[0]) px = x + (n[0] > 0 ? 1.05 : -0.05);
    if (n[1]) py = y + (n[1] > 0 ? 1.05 : -0.05);
    if (n[2]) pz = z + (n[2] > 0 ? 1.05 : -0.05);
    const u = Math.floor(Math.random() * 12) / 16, v = Math.floor(Math.random() * 12) / 16;
    this.add({
      x: px, y: py, z: pz, vx: n[0] * 0.05 + (Math.random() - 0.5) * 0.04, vy: n[1] * 0.05 + Math.random() * 0.06, vz: n[2] * 0.05 + (Math.random() - 0.5) * 0.04,
      life: 6 + Math.floor(Math.random() * 10), layer, u0: u, v0: v, u1: u + 4 / 16, v1: v + 4 / 16, size: 0.04 + Math.random() * 0.03, r, g, b,
    });
  }

  emit(type, x, y, z, opts = {}) {
    switch (type) {
      case 'smoke':
        return this.add({ x, y, z, vx: (Math.random() - 0.5) * 0.02, vy: 0.02 + Math.random() * 0.02, vz: (Math.random() - 0.5) * 0.02, life: 20 + Math.random() * 20, layer: this.layer('particle_smoke'), gravity: -0.002, size: 0.12, r: 0.3, g: 0.3, b: 0.3, collide: false, ...opts });
      case 'poof':
        return this.add({ x, y, z, vx: (Math.random() - 0.5) * 0.15, vy: Math.random() * 0.1, vz: (Math.random() - 0.5) * 0.15, life: 10 + Math.random() * 10, layer: this.layer('particle_poof'), gravity: -0.004, size: 0.18, collide: false, ...opts });
      case 'flame':
        return this.add({ x, y, z, vx: 0, vy: 0.005, vz: 0, life: 10 + Math.random() * 10, layer: this.layer('particle_flame'), gravity: -0.001, size: 0.06, fullbright: true, collide: false, ...opts });
      case 'bubble':
        return this.add({ x, y, z, vx: (Math.random() - 0.5) * 0.02, vy: 0.04, vz: (Math.random() - 0.5) * 0.02, life: 15 + Math.random() * 15, layer: this.layer('particle_bubble'), gravity: -0.01, size: 0.06, collide: false, ...opts });
      case 'splash':
        return this.add({ x, y, z, vx: (Math.random() - 0.5) * 0.2, vy: 0.1 + Math.random() * 0.15, vz: (Math.random() - 0.5) * 0.2, life: 10 + Math.random() * 10, layer: this.layer('particle_splash'), gravity: 0.06, size: 0.06, ...opts });
      case 'crit':
        return this.add({ x, y, z, vx: (Math.random() - 0.5) * 0.4, vy: Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4, life: 8 + Math.random() * 8, layer: this.layer('particle_crit'), gravity: 0.02, size: 0.08, r: 0.9, g: 0.9, b: 1, collide: false, fullbright: true, ...opts });
      case 'heart':
        return this.add({ x, y, z, vx: 0, vy: 0.04, vz: 0, life: 20, layer: this.layer('particle_heart'), gravity: -0.002, size: 0.15, collide: false, fullbright: true, ...opts });
      case 'spark':
        return this.add({ x, y, z, vx: (Math.random() - 0.5) * 0.1, vy: Math.random() * 0.1, vz: (Math.random() - 0.5) * 0.1, life: 6 + Math.random() * 6, layer: this.layer('particle_spark'), gravity: 0.01, size: 0.04, collide: false, fullbright: true, ...opts });
      case 'drip':
        return this.add({ x, y, z, vx: 0, vy: 0, vz: 0, life: 40, layer: this.layer('particle_splash'), gravity: 0.03, size: 0.04, ...opts });
      case 'item': {
        // Crumbs of food / item sprite: layer comes from opts
        return this.add({ x, y, z, life: 10 + Math.random() * 10, size: 0.05, ...opts });
      }
      default:
        return null;
    }
  }

  tick(world) {
    const list = this.list;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.age++;
      if (p.age >= p.life) continue;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.vy -= p.gravity;
      let nx = p.x + p.vx, ny = p.y + p.vy, nz = p.z + p.vz;
      if (p.collide) {
        const id = world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (isSolid[id] && id !== 0) {
          if (!isSolid[world.getBlock(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))]) {
            ny = p.y;
          } else {
            ny = p.y;
          }
          p.vy = 0;
          p.vx *= 0.7;
          p.vz *= 0.7;
          if (isSolid[world.getBlock(Math.floor(nx), Math.floor(p.y), Math.floor(p.z))]) { nx = p.x; p.vx = 0; }
          if (isSolid[world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(nz))]) { nz = p.z; p.vz = 0; }
        }
      }
      p.x = nx; p.y = ny; p.z = nz;
      p.vx *= p.drag; p.vy *= p.drag; p.vz *= p.drag;
      if (!p.fullbright) {
        const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
        p.light = world.getSkyLight(bx, by, bz) * 16 + world.getBlockLight(bx, by, bz);
      }
      list[w++] = p;
    }
    list.length = w;
  }

  render(camera, partial) {
    const e = camera.matrixWorld.elements;
    this.right.set(e[0], e[1], e[2]);
    this.up.set(e[4], e[5], e[6]);
    const R = this.right, U = this.up;
    let q = 0;
    for (const p of this.list) {
      const x = p.px + (p.x - p.px) * partial, y = p.py + (p.y - p.py) * partial, z = p.pz + (p.z - p.pz) * partial;
      const s = p.size * (p.grow ? 1 + p.age / p.life : 1);
      const o = q * 12;
      const ax = (R.x + U.x) * s, ay = (R.y + U.y) * s, az = (R.z + U.z) * s;
      const bx = (R.x - U.x) * s, by = (R.y - U.y) * s, bz = (R.z - U.z) * s;
      this.pos[o] = x - ax; this.pos[o + 1] = y - ay; this.pos[o + 2] = z - az;
      this.pos[o + 3] = x + bx; this.pos[o + 4] = y + by; this.pos[o + 5] = z + bz;
      this.pos[o + 6] = x + ax; this.pos[o + 7] = y + ay; this.pos[o + 8] = z + az;
      this.pos[o + 9] = x - bx; this.pos[o + 10] = y - by; this.pos[o + 11] = z - bz;
      const u = q * 12;
      this.uvl[u] = p.u0; this.uvl[u + 1] = p.v1; this.uvl[u + 2] = p.layer;
      this.uvl[u + 3] = p.u1; this.uvl[u + 4] = p.v1; this.uvl[u + 5] = p.layer;
      this.uvl[u + 6] = p.u1; this.uvl[u + 7] = p.v0; this.uvl[u + 8] = p.layer;
      this.uvl[u + 9] = p.u0; this.uvl[u + 10] = p.v0; this.uvl[u + 11] = p.layer;
      const light = p.fullbright ? 256 : (p.light ?? 255);
      const c = q * 16;
      for (let k = 0; k < 4; k++) {
        this.col[c + k * 4] = p.r;
        this.col[c + k * 4 + 1] = p.g;
        this.col[c + k * 4 + 2] = p.b;
        this.col[c + k * 4 + 3] = light;
      }
      q++;
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, q * 6);
    g.attributes.position.needsUpdate = true;
    g.attributes.aUvl.needsUpdate = true;
    g.attributes.aCol.needsUpdate = true;
  }

  clear() {
    this.list.length = 0;
  }
}
