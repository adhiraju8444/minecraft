import * as THREE from '../../vendor/three.module.min.js';
import { Simplex } from '../util/noise.js';
import { mulberry32 } from '../util/rng.js';
import { isSnowyBiome } from '../world/worldgen.js';

const CLOUD_Y = 112;

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = opts.linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = opts.linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.generateMipmaps = false;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function sunTexture() {
  return canvasTex(32, 32, (g) => {
    const grd = g.createRadialGradient(16, 16, 4, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,240,180,0.9)');
    grd.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#fffbe6';
    g.fillRect(9, 9, 14, 14);
    g.fillStyle = '#fff3b0';
    g.fillRect(11, 11, 10, 10);
  }, { linear: false });
}

function moonTexture() {
  return canvasTex(32, 32, (g) => {
    g.fillStyle = 'rgba(200,210,240,0.12)';
    g.fillRect(4, 4, 24, 24);
    g.fillStyle = '#e4e8f2';
    g.fillRect(10, 10, 12, 12);
    g.fillStyle = '#bcc3d6';
    for (const [x, y, w] of [[12, 12, 3], [17, 14, 2], [13, 18, 2], [18, 19, 2]]) g.fillRect(x, y, w, w);
  });
}

function cloudTexture(seed) {
  const n = new Simplex(seed);
  return canvasTex(256, 256, (g) => {
    const img = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        // tileable by sampling a torus
        const a = (x / 256) * Math.PI * 2, b = (y / 256) * Math.PI * 2;
        const v = n.noise3(Math.cos(a) * 3, Math.sin(a) * 3, Math.cos(b) * 3 + Math.sin(b) * 1.7) * 0.7 +
          n.noise3(Math.cos(a) * 7 + 9, Math.sin(a) * 7, Math.sin(b) * 7) * 0.3;
        const on = v > 0.12;
        const i = (y * 256 + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = on ? 255 : 0;
      }
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true });
}

const DOME_VERT = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const DOME_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec4 uSunset;
uniform vec3 uVoid;
in vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.45, h));
  vec2 sd = normalize(uSunDir.xz + vec2(1e-4));
  vec2 vd = normalize(d.xz + vec2(1e-4));
  float toward = max(0.0, dot(sd, vd));
  float glow = uSunset.a * pow(toward, 3.0) * (1.0 - smoothstep(0.0, 0.5, abs(h - 0.05)));
  c = mix(c, uSunset.rgb, clamp(glow, 0.0, 1.0));
  c = mix(c, uVoid, smoothstep(-0.05, -0.35, h));
  gl_FragColor = vec4(c, 1.0);
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uOffset;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFar;
in vec2 vUv;
in float vDist;
void main() {
  vec4 t = texture(uMap, vUv + uOffset);
  if (t.a < 0.5) discard;
  float f = clamp(vDist / uFar, 0.0, 1.0);
  float a = 0.82 * (1.0 - f * f);
  gl_FragColor = vec4(mix(uColor, uFogColor, f * 0.6), a);
}
`;
const CLOUD_VERT = /* glsl */ `
out vec2 vUv;
out float vDist;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xz);
  gl_Position = projectionMatrix * mv;
}
`;

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunset: { value: new THREE.Vector4(1, 0.5, 0.2, 0) },
        uVoid: { value: new THREE.Color(0.05, 0.05, 0.12) },
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // Stars
    const r = mulberry32(42);
    const pts = [];
    for (let i = 0; i < 1400; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pts.push(Math.cos(a) * s * 90, u * 90, Math.sin(a) * s * 90);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    // Sky objects stay in the opaque pass (drawn before terrain) and blend additively.
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.celestial = new THREE.Group();
    this.celestial.add(this.stars);

    const sunMat = new THREE.MeshBasicMaterial({ map: sunTexture(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), sunMat);
    this.sun.position.set(0, 80, 0);
    this.sun.rotation.x = Math.PI / 2;
    this.sun.renderOrder = -8;
    const moonMat = new THREE.MeshBasicMaterial({ map: moonTexture(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), moonMat);
    this.moon.position.set(0, -80, 0);
    this.moon.rotation.x = -Math.PI / 2;
    this.moon.renderOrder = -8;
    this.celestial.add(this.sun, this.moon);
    this.group.add(this.celestial);

    // Clouds
    const size = 256 * 12;
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: cloudTexture(7) },
        uOffset: { value: new THREE.Vector2() },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uFogColor: { value: new THREE.Color() },
        uFar: { value: 400 },
      },
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cg = new THREE.PlaneGeometry(size, size, 1, 1);
    cg.rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(cg, this.cloudMat);
    this.clouds.renderOrder = 5;
    this.clouds.frustumCulled = false;
    this.cloudSize = size;
    scene.add(this.clouds);

    // Precipitation
    this.rain = new Precipitation(scene);

    this.fogColor = new THREE.Color();
    this.skyTop = new THREE.Color();
  }

  update(game, camera, partial, opts) {
    const world = game.world;
    const angle = world.celestialAngle(partial);
    const day = world.daylight();
    const rain = world.weather.strength;
    const cam = camera.position;

    this.group.position.copy(cam);
    this.celestial.rotation.set(0, 0, angle * Math.PI * 2);

    const sunDir = new THREE.Vector3(-Math.sin(angle * Math.PI * 2), Math.cos(angle * Math.PI * 2), 0);
    const nightTop = new THREE.Color(0.006, 0.01, 0.035);
    const dayTop = new THREE.Color(0.47, 0.65, 1.0);
    const nightFog = new THREE.Color(0.02, 0.03, 0.07);
    const dayFog = new THREE.Color(0.73, 0.84, 1.0);
    const top = nightTop.clone().lerp(dayTop, day);
    const fog = nightFog.clone().lerp(dayFog, day);
    const grey = new THREE.Color(0.5, 0.52, 0.56).multiplyScalar(0.25 + day * 0.75);
    top.lerp(grey, rain * 0.75);
    fog.lerp(grey, rain * 0.75);

    // Sunrise / sunset glow
    const sunset = Math.max(0, 1 - Math.abs(sunDir.y) * 3.2);
    const ss = sunset * sunset * (1 - rain);
    const sunsetCol = new THREE.Color(1.0, 0.45 + 0.2 * sunDir.y, 0.2);
    this.domeMat.uniforms.uSunset.value.set(sunsetCol.r, sunsetCol.g, sunsetCol.b, ss * 0.85);
    this.domeMat.uniforms.uSunDir.value.copy(sunDir);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const facing = Math.max(0, fwd.x * Math.sign(sunDir.x || 1)) * ss;
    fog.lerp(sunsetCol, facing * 0.45);

    this.domeMat.uniforms.uTop.value.copy(top);
    this.domeMat.uniforms.uHorizon.value.copy(fog);
    this.domeMat.uniforms.uVoid.value.copy(fog).multiplyScalar(0.35);
    this.skyTop.copy(top);
    this.fogColor.copy(fog);

    this.starMat.color.setScalar(Math.max(0, 1 - day * 1.6) * (1 - rain) * 0.9);
    this.sun.material.color.setScalar(1 - rain);
    this.moon.material.color.setScalar(1 - rain);

    // Clouds drift west to east.
    const t = (world.tickCount + partial) * 0.03;
    const cs = 12;
    const snapX = Math.floor(cam.x / cs) * cs, snapZ = Math.floor(cam.z / cs) * cs;
    this.clouds.position.set(snapX, CLOUD_Y, snapZ);
    const tex = 256 * cs;
    this.cloudMat.uniforms.uOffset.value.set(((snapX + t) / tex) % 1, (-snapZ / tex) % 1);
    const cb = 0.2 + 0.8 * day;
    this.cloudMat.uniforms.uColor.value.setRGB(cb * (1 - rain * 0.4), cb * (1 - rain * 0.4), cb * (1 - rain * 0.35) + 0.02);
    this.cloudMat.uniforms.uFogColor.value.copy(fog);
    this.cloudMat.uniforms.uFar.value = Math.max(160, opts.renderDist * 16 * 1.6);
    this.clouds.visible = opts.clouds;

    this.rain.update(game, camera, partial, rain);
  }
}

class Precipitation {
  constructor(scene) {
    this.max = 900;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 4 * 3);
    this.col = new Float32Array(this.max * 4 * 4);
    const idx = new Uint32Array(this.max * 6);
    for (let i = 0; i < this.max; i++) {
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.drops = [];
    const r = mulberry32(5);
    for (let i = 0; i < this.max; i++) this.drops.push({ ox: (r() - 0.5) * 26, oz: (r() - 0.5) * 26, y: r() * 24, v: 0.8 + r() * 0.4, ph: r() * 10 });
  }

  update(game, camera, partial, strength) {
    const g = this.mesh.geometry;
    if (strength <= 0.01) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const world = game.world;
    const cam = camera.position;
    const n = Math.floor(this.max * strength);
    const time = (world.tickCount + partial);
    const rx = Math.cos(game.player.yaw), rz = -Math.sin(game.player.yaw);
    let q = 0;
    for (let i = 0; i < n; i++) {
      const d = this.drops[i];
      const x = Math.floor(cam.x + d.ox) + 0.5 + (d.ph % 1) * 0.6 - 0.3;
      const z = Math.floor(cam.z + d.oz) + 0.5 + ((d.ph * 7) % 1) * 0.6 - 0.3;
      const ground = world.rainY(Math.floor(x), Math.floor(z)) + 1;
      const snow = isSnowyBiome(world.getBiome(Math.floor(x), Math.floor(z)));
      const speed = snow ? 0.12 : 0.9 * d.v;
      const span = 22;
      let y = cam.y + 11 - ((time * speed + d.ph * 37) % span);
      if (y < ground) continue;
      const h = snow ? 0.09 : 0.6;
      const w = snow ? 0.09 : 0.025;
      let sx = 0, sz = 0;
      if (snow) {
        sx = Math.sin(time * 0.05 + d.ph) * 0.3;
        sz = Math.cos(time * 0.04 + d.ph) * 0.3;
      }
      const o = q * 12;
      const px = x + sx, pz = z + sz;
      this.pos[o] = px - rx * w; this.pos[o + 1] = y; this.pos[o + 2] = pz - rz * w;
      this.pos[o + 3] = px + rx * w; this.pos[o + 4] = y; this.pos[o + 5] = pz + rz * w;
      this.pos[o + 6] = px + rx * w; this.pos[o + 7] = y + h; this.pos[o + 8] = pz + rz * w;
      this.pos[o + 9] = px - rx * w; this.pos[o + 10] = y + h; this.pos[o + 11] = pz - rz * w;
      const light = world.getSkyLight(Math.floor(px), Math.floor(y), Math.floor(pz)) / 15;
      const b = (0.35 + 0.65 * world.daylight()) * (0.4 + 0.6 * light);
      for (let k = 0; k < 4; k++) {
        const c = q * 16 + k * 4;
        if (snow) { this.col[c] = b; this.col[c + 1] = b; this.col[c + 2] = b; this.col[c + 3] = 0.9; }
        else { this.col[c] = 0.6 * b; this.col[c + 1] = 0.7 * b; this.col[c + 2] = 0.95 * b; this.col[c + 3] = 0.45; }
      }
      q++;
    }
    g.setDrawRange(0, q * 6);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}
