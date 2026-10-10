import * as THREE from '../../vendor/three.module.min.js';
import { generateTiles } from './tiles.js';
import { initMesher, buildSection } from './mesher.js';
import { makeChunkMaterial, LIGHT_UNIFORMS } from './materials.js';
import { Sky } from './sky.js';
import { Particles } from './particles.js';
import { ItemModels, chunkGeometry } from './items3d.js';
import { Hand } from './hand.js';
import { SECTIONS } from '../world/constants.js';
import { blockBoxes } from '../world/shapes.js';
import { B, isLiquid } from '../data/blocks.js';
import { liquidHeight } from '../world/physics.js';

const SECTION_SPHERE_R = Math.sqrt(3) * 8 + 0.5;

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required');
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.autoClear = false;
    renderer.sortObjects = true;
    this.renderer = renderer;
    this.pixelRatio = 1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';

    // Terrain texture array
    this.tiles = generateTiles();
    const tex = new THREE.DataArrayTexture(this.tiles.data, 16, 16, this.tiles.count);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    this.texArray = tex;
    initMesher(this.tiles.index, this.tiles.anim);

    this.chunkMat = makeChunkMaterial(tex);
    this.waterMat = makeChunkMaterial(tex, { translucent: true });
    this.chunkGroup = new THREE.Group();
    this.scene.add(this.chunkGroup);
    this.entityGroup = new THREE.Group();
    this.scene.add(this.entityGroup);

    this.sky = new Sky(this.scene);
    this.particles = new Particles(this.scene, tex, this.tiles.index);
    this.items = new ItemModels(this, this.tiles);
    this.items.renderIcons();
    this.hand = new Hand(this);

    // Selection outline
    this.selection = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
    this.selection.visible = false;
    this.selection.renderOrder = 10;
    this.scene.add(this.selection);
    this.selKey = '';

    // Crack overlay
    const crackMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uLayer: { value: 0 } },
      vertexShader: 'out vec3 vP; out vec3 vN; void main(){ vP = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `precision highp sampler2DArray; uniform sampler2DArray uTex; uniform float uLayer; in vec3 vP; in vec3 vN;
        void main(){ vec3 p = vP + 0.5; vec2 uv = abs(vN.x) > 0.5 ? p.zy : abs(vN.y) > 0.5 ? p.xz : p.xy; vec4 c = texture(uTex, vec3(uv, uLayer)); if (c.a < 0.1) discard; gl_FragColor = vec4(c.rgb, c.a * 0.8); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 9;
    this.scene.add(this.crack);
    this.crackBase = this.tiles.index.get('destroy_0');

    this.meshes = new Map(); // chunk -> array of {opaque, trans}
    this.fovCurrent = 70;
    this.stats = { sections: 0, built: 0, drawn: 0 };
    this.tmpV = new THREE.Vector3();
    this.frustum = new THREE.Frustum();
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatio));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hand.setAspect(w / h);
  }

  setPixelRatio(r) {
    this.pixelRatio = r;
    this.resize();
  }

  // ---------------------------------------------------------- chunk meshes
  sectionMeshes(c) {
    let arr = this.meshes.get(c);
    if (!arr) {
      arr = new Array(SECTIONS).fill(null).map(() => ({ opaque: null, trans: null }));
      this.meshes.set(c, arr);
    }
    return arr;
  }

  setSectionGeometry(c, s, kind, data) {
    const arr = this.sectionMeshes(c);
    let mesh = arr[s][kind];
    if (!data) {
      if (mesh) {
        this.chunkGroup.remove(mesh);
        mesh.geometry.dispose();
        arr[s][kind] = null;
      }
      return;
    }
    const geo = chunkGeometry(data);
    for (const name of ['position', 'aD1', 'aD2', 'aTint']) geo.attributes[name].onUpload(releaseArray);
    geo.index.onUpload(releaseArray);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 8, 8), SECTION_SPHERE_R);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(16, 16, 16));
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    } else {
      mesh = new THREE.Mesh(geo, kind === 'opaque' ? this.chunkMat : this.waterMat);
      mesh.matrixAutoUpdate = false;
      mesh.position.set(c.cx * 16, s * 16, c.cz * 16);
      mesh.updateMatrix();
      if (kind === 'trans') mesh.renderOrder = 2;
      this.chunkGroup.add(mesh);
      arr[s][kind] = mesh;
    }
  }

  disposeChunk(c) {
    const arr = this.meshes.get(c);
    if (!arr) return;
    for (const sec of arr) {
      for (const k of ['opaque', 'trans']) {
        if (sec[k]) {
          this.chunkGroup.remove(sec[k]);
          sec[k].geometry.dispose();
        }
      }
    }
    this.meshes.delete(c);
  }

  clearAllChunks() {
    for (const c of [...this.meshes.keys()]) this.disposeChunk(c);
  }

  // Rebuild dirty sections, nearest first, within a time budget.
  updateMeshes(world, cx, cy, cz, renderDist, budgetMs) {
    const t0 = performance.now();
    const pcx = Math.floor(cx) >> 4, pcz = Math.floor(cz) >> 4, pcs = Math.floor(cy) >> 4;
    const todo = [];
    for (const c of world.chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (renderDist + 0.5) * (renderDist + 0.5)) {
        // Out of range: drop meshes but keep the chunk.
        if (this.meshes.has(c)) {
          this.disposeChunk(c);
          c.markAllDirty();
        }
        continue;
      }
      let need = false;
      for (const s of c.sections) if (s.dirty) { need = true; break; }
      if (!need) continue;
      if (!c.nb[0] || !c.nb[1] || !c.nb[2] || !c.nb[3] || !c.diag(1, 1) || !c.diag(1, -1) || !c.diag(-1, 1) || !c.diag(-1, -1)) continue;
      for (let s = 0; s < SECTIONS; s++) {
        if (!c.sections[s].dirty) continue;
        const ds = s - pcs;
        todo.push([dx * dx + dz * dz + ds * ds * 0.5, c, s]);
      }
    }
    todo.sort((a, b) => a[0] - b[0]);
    let built = 0;
    for (const [, c, s] of todo) {
      if (built > 0 && performance.now() - t0 > budgetMs) break;
      const sec = c.sections[s];
      sec.dirty = false;
      if (s > (c.maxY >> 4) + 1) {
        this.setSectionGeometry(c, s, 'opaque', null);
        this.setSectionGeometry(c, s, 'trans', null);
        continue;
      }
      const res = buildSection(world, c, s);
      this.setSectionGeometry(c, s, 'opaque', res.opaque);
      this.setSectionGeometry(c, s, 'trans', res.trans);
      built++;
    }
    this.stats.built = built;
    this.stats.pending = todo.length - built;
    return todo.length - built;
  }

  // ---------------------------------------------------------- selection & cracks
  setSelection(world, hit) {
    if (!hit) {
      this.selection.visible = false;
      this.crack.visible = false;
      this.selKey = '';
      return;
    }
    const key = `${hit.x},${hit.y},${hit.z},${hit.id},${hit.meta}`;
    if (key !== this.selKey) {
      this.selKey = key;
      const boxes = blockBoxes(world, hit.x, hit.y, hit.z, hit.id, hit.meta, 'select');
      const pts = [];
      const e = 0.002;
      for (const b of boxes) {
        const [x0, y0, z0, x1, y1, z1] = [b[0] - e, b[1] - e, b[2] - e, b[3] + e, b[4] + e, b[5] + e];
        const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
        for (const [a, d] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) pts.push(...c[a], ...c[d]);
      }
      this.selection.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.selection.geometry = g;
      this.selection.position.set(hit.x, hit.y, hit.z);
      // crack box covers the union of the selection boxes
      let mn = [1, 1, 1], mx = [0, 0, 0];
      for (const b of boxes) {
        mn = [Math.min(mn[0], b[0]), Math.min(mn[1], b[1]), Math.min(mn[2], b[2])];
        mx = [Math.max(mx[0], b[3]), Math.max(mx[1], b[4]), Math.max(mx[2], b[5])];
      }
      if (!boxes.length) { mn = [0, 0, 0]; mx = [1, 1, 1]; }
      this.crack.scale.set(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
      this.crack.position.set(hit.x + (mn[0] + mx[0]) / 2, hit.y + (mn[1] + mx[1]) / 2, hit.z + (mn[2] + mx[2]) / 2);
    }
    this.selection.visible = true;
  }

  setCrack(stage) {
    if (stage < 0 || !this.selection.visible) {
      this.crack.visible = false;
      return;
    }
    this.crack.visible = true;
    this.crack.material.uniforms.uLayer.value = this.crackBase + Math.min(9, stage);
  }

  // ---------------------------------------------------------- frame
  render(game, partial, opts) {
    const world = game.world;
    const cam = this.camera;
    const view = game.cameraView(partial);
    cam.position.copy(view.pos);
    cam.rotation.set(view.pitch, view.yaw, view.roll, 'YXZ');
    const targetFov = opts.fov * view.fovMul;
    this.fovCurrent += (targetFov - this.fovCurrent) * 0.25;
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    // Lighting uniforms
    const day = world.daylight();
    LIGHT_UNIFORMS.uTime.value = (world.tickCount + partial) / 20;
    LIGHT_UNIFORMS.uSkyDarken.value = (1 - day) * 11;
    const dusk = Math.max(0, 1 - Math.abs(day - 0.5) * 2.5);
    LIGHT_UNIFORMS.uSkyTint.value.setRGB(1 - (1 - day) * 0.15 + dusk * 0.05, 1 - (1 - day) * 0.1, 1 + (1 - day) * 0.05 - dusk * 0.08);
    LIGHT_UNIFORMS.uGamma.value = opts.gamma;
    LIGHT_UNIFORMS.uFlicker.value = 1 + Math.sin(LIGHT_UNIFORMS.uTime.value * 7.1) * 0.01 + Math.sin(LIGHT_UNIFORMS.uTime.value * 13.3) * 0.008;
    LIGHT_UNIFORMS.uNightVision.value = game.player.nightVision || 0;

    this.sky.update(game, cam, partial, opts);
    let fogColor = this.sky.fogColor.clone();
    let near = opts.renderDist * 16 * 0.62, far = opts.renderDist * 16 * 0.95;
    const medium = view.medium;
    if (medium === 'water') {
      fogColor = new THREE.Color(0.03, 0.1, 0.3).multiplyScalar(0.3 + 0.7 * day);
      near = 0;
      far = 22;
    } else if (medium === 'lava') {
      fogColor = new THREE.Color(0.6, 0.12, 0.01);
      near = 0;
      far = 2;
    } else if (world.weather.strength > 0) {
      far *= 1 - world.weather.strength * 0.25;
      near *= 1 - world.weather.strength * 0.5;
    }
    if (game.player.blindness) {
      fogColor = new THREE.Color(0, 0, 0);
      near = 0;
      far = 5;
    }
    LIGHT_UNIFORMS.uFogColor.value.copy(fogColor);
    LIGHT_UNIFORMS.uFogNear.value = near;
    LIGHT_UNIFORMS.uFogFar.value = far;
    this.sky.dome.visible = medium === 'air';
    this.sky.celestial.visible = medium === 'air';

    this.particles.render(cam, partial);

    this.renderer.setClearColor(fogColor, 1);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.scene, cam);
    if (view.firstPerson && opts.showHand) {
      this.hand.update(game, partial);
      this.hand.render(this.renderer);
    }
  }
}

function releaseArray() {
  this.array = null;
}

// Returns which medium a point is in: 'air', 'water' or 'lava'.
export function mediumAt(world, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const id = world.getBlock(bx, by, bz);
  if (!isLiquid[id]) return 'air';
  const top = by + liquidHeight(world.getMeta(bx, by, bz));
  if (y > top) return 'air';
  return id === B.lava ? 'lava' : 'water';
}
