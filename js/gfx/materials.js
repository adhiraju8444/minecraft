// Shaders shared by terrain, block-shaped entities, mobs and particles.
import * as THREE from '../../vendor/three.module.min.js';

// Shared lighting uniforms (one object referenced by every material).
export const LIGHT_UNIFORMS = {
  uTime: { value: 0 },
  uSkyDarken: { value: 0 },
  uSkyTint: { value: new THREE.Color(1, 1, 1) },
  uGamma: { value: 0.5 },
  uFlicker: { value: 1 },
  uFogColor: { value: new THREE.Color(0.75, 0.85, 1) },
  uFogNear: { value: 80 },
  uFogFar: { value: 128 },
  uNightVision: { value: 0 },
};

const LIGHT_GLSL = /* glsl */ `
uniform float uSkyDarken;
uniform vec3 uSkyTint;
uniform float uGamma;
uniform float uFlicker;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uNightVision;
float lightCurve(float l) {
  float b = l / (3.0 * (1.0 - l) + 1.0);
  float g = 1.0 - pow(1.0 - b, 4.0);
  return mix(b, g, uGamma) * 0.95 + 0.05;
}
vec3 lightColor(float skyLevel, float blockLevel) {
  float sky = max(0.0, skyLevel * 15.0 - uSkyDarken) / 15.0;
  vec3 s = vec3(lightCurve(sky)) * uSkyTint;
  vec3 b = vec3(lightCurve(blockLevel)) * vec3(1.0, 0.88, 0.72) * uFlicker;
  vec3 c = max(s, b);
  return mix(c, vec3(1.0), uNightVision);
}
vec3 applyFog(vec3 c, float dist) {
  float f = clamp((dist - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  return mix(c, uFogColor, f);
}
`;

const CHUNK_VERT = /* glsl */ `
in vec4 aD1;
in vec4 aD2;
in vec4 aTint;
uniform float uTime;
uniform vec3 uEntityLight; // x sky, y block, z > 0.5 to use instead of vertex light
out vec2 vUv;
out float vLayer;
out float vOverlay;
out vec2 vLight;
out float vShade;
out vec3 vTint;
out float vDist;
void main() {
  vec3 p = position / 16.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = aD1.xy / 16.0;
  float layer = aD1.z;
  float anim = aD2.w;
  if (anim > 0.5) {
    float frames = mod(anim, 16.0);
    float fps = floor(anim / 16.0);
    layer += mod(floor(uTime * fps), frames);
  }
  vLayer = layer;
  vOverlay = aD1.w;
  vLight = uEntityLight.z > 0.5 ? uEntityLight.xy : aD2.xy / 255.0;
  vShade = aD2.z / 255.0;
  vTint = aTint.rgb / 255.0;
  vDist = length(mv.xyz);
}
`;

const CHUNK_FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uAlphaTest;
uniform float uOpacity;
uniform vec3 uColorMul;
${LIGHT_GLSL}
in vec2 vUv;
in float vLayer;
in float vOverlay;
in vec2 vLight;
in float vShade;
in vec3 vTint;
in float vDist;
void main() {
  vec4 c = texture(uTex, vec3(vUv, vLayer));
  if (vOverlay < 254.5) {
    vec4 o = texture(uTex, vec3(vUv, vOverlay));
    c.rgb = mix(c.rgb, o.rgb * vTint, o.a);
  } else {
    c.rgb *= vTint;
  }
  if (c.a < uAlphaTest) discard;
  c.rgb *= lightColor(vLight.x, vLight.y) * vShade * uColorMul;
  c.rgb = applyFog(c.rgb, vDist);
  c.a *= uOpacity;
  gl_FragColor = c;
}
`;

export function makeChunkMaterial(texArray, { translucent = false, entity = false } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...LIGHT_UNIFORMS,
      uTex: { value: texArray },
      uAlphaTest: { value: translucent ? 0.02 : 0.5 },
      uOpacity: { value: 1 },
      uEntityLight: { value: new THREE.Vector3(0, 0, entity ? 1 : 0) },
      uColorMul: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: CHUNK_VERT,
    fragmentShader: CHUNK_FRAG,
    transparent: translucent,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  return m;
}

// Plain textured meshes (mobs, item sprites): face shading from normals.
const ENTITY_VERT = /* glsl */ `
out vec2 vUv;
out float vShade;
out float vDist;
void main() {
  vUv = uv;
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vShade = n.y > 0.5 ? 1.0 : n.y < -0.5 ? 0.5 : abs(n.x) > 0.5 ? 0.6 : 0.8;
  vShade = mix(vShade, 1.0, 0.15);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const ENTITY_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uLight;
uniform float uHurt;
uniform float uFlash;
uniform float uOpacity;
uniform float uFullbright;
uniform vec3 uTint;
${LIGHT_GLSL}
in vec2 vUv;
in float vShade;
in float vDist;
void main() {
  vec4 c = texture(uMap, vUv);
  if (c.a < 0.5) discard;
  vec3 l = uFullbright > 0.5 ? vec3(1.0) : lightColor(uLight.x, uLight.y);
  c.rgb *= l * vShade * uTint;
  c.rgb = mix(c.rgb, vec3(1.0, 0.15, 0.1), uHurt * 0.55);
  c.rgb = mix(c.rgb, vec3(1.0), uFlash);
  c.rgb = applyFog(c.rgb, vDist);
  gl_FragColor = vec4(c.rgb, c.a * uOpacity);
}
`;

export function makeEntityMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...LIGHT_UNIFORMS,
      uMap: { value: map },
      uLight: { value: new THREE.Vector2(1, 0) },
      uHurt: { value: 0 },
      uFlash: { value: 0 },
      uOpacity: { value: 1 },
      uFullbright: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: ENTITY_VERT,
    fragmentShader: ENTITY_FRAG,
  });
}

// Particles: world-space billboards prepared on the CPU.
const PART_VERT = /* glsl */ `
in vec3 aUvl; // u, v, layer
in vec4 aCol; // rgb tint, light (sky*15 + blk packed)
out vec3 vUvl;
out vec4 vCol;
out float vDist;
void main() {
  vUvl = aUvl;
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const PART_FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTex;
${LIGHT_GLSL}
in vec3 vUvl;
in vec4 vCol;
in float vDist;
void main() {
  vec4 c = texture(uTex, vUvl);
  if (c.a < 0.4) discard;
  float sky = floor(vCol.a / 16.0) / 15.0;
  float blk = mod(vCol.a, 16.0) / 15.0;
  vec3 l = vCol.a > 255.5 ? vec3(1.0) : lightColor(sky, blk);
  c.rgb *= vCol.rgb * l;
  c.rgb = applyFog(c.rgb, vDist);
  gl_FragColor = c;
}
`;
export function makeParticleMaterial(texArray) {
  return new THREE.ShaderMaterial({
    uniforms: { ...LIGHT_UNIFORMS, uTex: { value: texArray } },
    vertexShader: PART_VERT,
    fragmentShader: PART_FRAG,
    side: THREE.DoubleSide,
  });
}
