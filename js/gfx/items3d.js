// Item visuals: a sprite atlas, 3D meshes for dropped/held items, and the
// inventory icons (block items are rendered with WebGL from the real block
// geometry so slabs, stairs, fences etc. show their true shape).
import * as THREE from '../../vendor/three.module.min.js';
import { ITEMS } from '../data/items.js';
import { BLOCKS } from '../data/blocks.js';
import { drawSprite } from './sprites.js';
import { DEFAULT_TINTS } from './tiles.js';
import { buildSingleBlock } from './mesher.js';
import { makeChunkMaterial, makeEntityMaterial, LIGHT_UNIFORMS } from './materials.js';

const COLS = 32;

export function chunkGeometry(data) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
  g.setAttribute('aD1', new THREE.BufferAttribute(data.d1, 4));
  g.setAttribute('aD2', new THREE.BufferAttribute(data.d2, 4));
  g.setAttribute('aTint', new THREE.BufferAttribute(data.tint, 4));
  g.setIndex(new THREE.BufferAttribute(data.index, 1));
  return g;
}

export class ItemModels {
  constructor(gfx, tiles) {
    this.gfx = gfx;
    this.tiles = tiles;
    this.cells = new Map(); // item id -> atlas cell
    this.geoCache = new Map();
    this.icons = new Map(); // item id -> data URL
    this.buildAtlas();
    this.blockMat = makeChunkMaterial(gfx.texArray, { entity: true });
    this.blockMatTrans = makeChunkMaterial(gfx.texArray, { entity: true, translucent: true });
    this.spriteMat = makeEntityMaterial(this.atlasTex);
  }

  isBlockModel(id) {
    const d = ITEMS[id];
    return !!(d && d.icon && d.icon.block !== undefined);
  }

  spriteTileFor(def) {
    if (def.icon.sprite) return drawSprite(def.icon);
    if (def.icon.tile) {
      const t = this.tiles.tiles[this.tiles.index.get(def.icon.tile)];
      const b = BLOCKS[def.block];
      const tint = b && b.tint ? DEFAULT_TINTS[b.tint] : null;
      if (!tint) return t;
      const c = t.clone();
      for (let i = 0; i < 256; i++) {
        c.d[i * 4] = (c.d[i * 4] * tint[0]) / 255;
        c.d[i * 4 + 1] = (c.d[i * 4 + 1] * tint[1]) / 255;
        c.d[i * 4 + 2] = (c.d[i * 4 + 2] * tint[2]) / 255;
      }
      return c;
    }
    return null;
  }

  buildAtlas() {
    const canvas = document.createElement('canvas');
    const ids = ITEMS.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
    const rows = Math.ceil(ids.length / COLS);
    canvas.width = COLS * 16;
    canvas.height = rows * 16;
    this.atlasRows = rows;
    const g = canvas.getContext('2d');
    let cell = 0;
    for (const id of ids) {
      const d = ITEMS[id];
      const t = this.spriteTileFor(d);
      if (!t) continue;
      const img = new ImageData(new Uint8ClampedArray(t.d), 16, 16);
      g.putImageData(img, (cell % COLS) * 16, Math.floor(cell / COLS) * 16);
      this.cells.set(id, cell);
      cell++;
    }
    this.atlasCanvas = canvas;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    this.atlasTex = tex;
  }

  // 16x16 RGBA of an item's flat sprite (for particles, icons).
  spritePixels(id) {
    const cell = this.cells.get(id);
    if (cell === undefined) return null;
    const g = this.atlasCanvas.getContext('2d');
    return g.getImageData((cell % COLS) * 16, Math.floor(cell / COLS) * 16, 16, 16);
  }

  // Extruded voxel geometry for a sprite (1 unit wide, centred).
  spriteGeometry(id) {
    const px = this.spritePixels(id);
    if (!px) return new THREE.BufferGeometry();
    const cell = this.cells.get(id);
    const cu = (cell % COLS) * 16, cv = Math.floor(cell / COLS) * 16;
    const W = COLS * 16, H = this.atlasRows * 16;
    const pos = [], nor = [], uv = [], idx = [];
    const a = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && px.data[(y * 16 + x) * 4 + 3] > 127;
    const t = 1 / 32;
    const push = (verts, n, u, v) => {
      const base = pos.length / 3;
      for (const p of verts) { pos.push(...p); nor.push(...n); uv.push(u, v); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (!a(x, y)) continue;
        const x0 = x / 16 - 0.5, x1 = (x + 1) / 16 - 0.5;
        const y0 = 0.5 - (y + 1) / 16, y1 = 0.5 - y / 16;
        const u = (cu + x + 0.5) / W, v = (cv + y + 0.5) / H;
        push([[x0, y0, t], [x1, y0, t], [x1, y1, t], [x0, y1, t]], [0, 0, 1], u, v);
        push([[x1, y0, -t], [x0, y0, -t], [x0, y1, -t], [x1, y1, -t]], [0, 0, -1], u, v);
        if (!a(x - 1, y)) push([[x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t]], [-1, 0, 0], u, v);
        if (!a(x + 1, y)) push([[x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t]], [1, 0, 0], u, v);
        if (!a(x, y - 1)) push([[x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t]], [0, 1, 0], u, v);
        if (!a(x, y + 1)) push([[x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t]], [0, -1, 0], u, v);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  blockGeometry(blockId, meta = 0) {
    const data = buildSingleBlock(blockId, meta);
    if (!data) return new THREE.BufferGeometry();
    const g = chunkGeometry(data);
    g.translate(-8, -8, -8);
    return g;
  }

  geometry(id) {
    let g = this.geoCache.get(id);
    if (!g) {
      g = this.isBlockModel(id) ? this.blockGeometry(ITEMS[id].block, defaultMeta(id)) : this.spriteGeometry(id);
      this.geoCache.set(id, g);
    }
    return g;
  }

  // A new mesh instance with its own material (so light can vary per item).
  createMesh(id) {
    const block = this.isBlockModel(id);
    const translucent = block && BLOCKS[ITEMS[id].block].translucent;
    const mat = (block ? (translucent ? this.blockMatTrans : this.blockMat) : this.spriteMat).clone();
    const mesh = new THREE.Mesh(this.geometry(id), mat);
    mesh.userData.block = block;
    return mesh;
  }

  setMeshLight(mesh, sky, blk) {
    const u = mesh.material.uniforms;
    if (u.uEntityLight) u.uEntityLight.value.set(sky / 15, blk / 15, 1);
    else u.uLight.value.set(sky / 15, blk / 15);
  }

  // ---------------------------------------------------------------- icons
  renderIcons() {
    const renderer = this.gfx.renderer;
    const size = 64;
    const rt = new THREE.WebGLRenderTarget(size, size);
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-0.88, 0.88, 0.88, -0.88, 0.1, 10);
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    const pixels = new Uint8Array(size * size * 4);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g2 = canvas.getContext('2d');
    // Icons are lit evenly and unfogged.
    const saved = { near: LIGHT_UNIFORMS.uFogNear.value, far: LIGHT_UNIFORMS.uFogFar.value, dark: LIGHT_UNIFORMS.uSkyDarken.value, gamma: LIGHT_UNIFORMS.uGamma.value, tint: LIGHT_UNIFORMS.uSkyTint.value.clone() };
    LIGHT_UNIFORMS.uFogNear.value = 1e5;
    LIGHT_UNIFORMS.uFogFar.value = 1e5 + 1;
    LIGHT_UNIFORMS.uSkyDarken.value = 0;
    LIGHT_UNIFORMS.uGamma.value = 0.5;
    LIGHT_UNIFORMS.uSkyTint.value.setRGB(1, 1, 1);
    const prevClear = renderer.getClearAlpha();
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    renderer.setClearColor(0x000000, 0);

    for (let id = 0; id < ITEMS.length; id++) {
      const d = ITEMS[id];
      if (!d) continue;
      if (!this.isBlockModel(id)) {
        const px = this.spritePixels(id);
        if (!px) continue;
        const c = document.createElement('canvas');
        c.width = 16;
        c.height = 16;
        c.getContext('2d').putImageData(px, 0, 0);
        this.icons.set(id, c.toDataURL());
        continue;
      }
      const mesh = this.createMesh(id);
      mesh.material.uniforms.uEntityLight.value.set(1, 0, 1);
      const b = BLOCKS[d.block];
      const pivot = new THREE.Group();
      pivot.add(mesh);
      pivot.rotation.set(Math.PI / 6, -Math.PI / 4, 0, 'XYZ');
      mesh.scale.setScalar(b.shape === 'fence' || b.shape === 'gate' ? 1.05 : 1);
      scene.add(pivot);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
      scene.remove(pivot);
      mesh.material.dispose();
      const img = g2.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * size * 4;
        img.data.set(pixels.subarray(src, src + size * 4), y * size * 4);
      }
      g2.clearRect(0, 0, size, size);
      g2.putImageData(img, 0, 0);
      this.icons.set(id, canvas.toDataURL());
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevColor, prevClear);
    rt.dispose();
    LIGHT_UNIFORMS.uFogNear.value = saved.near;
    LIGHT_UNIFORMS.uFogFar.value = saved.far;
    LIGHT_UNIFORMS.uSkyDarken.value = saved.dark;
    LIGHT_UNIFORMS.uGamma.value = saved.gamma;
    LIGHT_UNIFORMS.uSkyTint.value.copy(saved.tint);
  }

  icon(id) {
    return this.icons.get(id) || '';
  }
}

// Meta used when showing a block item (e.g. stairs facing the viewer).
export function defaultMeta(id) {
  const d = ITEMS[id];
  const b = d && BLOCKS[d.block];
  if (!b) return 0;
  if (b.shape === 'stairs') return 0;
  if (b.facing) return 0;
  return 0;
}
