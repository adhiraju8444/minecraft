// Entities in a multiplayer game are simulated by the server. The browser
// keeps a stand-in ("proxy") for each one: the normal entity class for
// drawing, moved smoothly toward the positions the server sends.
import * as THREE from '../../vendor/three.module.min.js';
import { Mob, MOB_TYPES } from '../entity/mobs.js';
import { ItemEntity, XPOrb, FallingBlock, PrimedTNT, Projectile } from '../entity/objects.js';
import { Player } from '../game/player.js';
import { ITEMS } from '../data/items.js';
import { MF, PF } from './protocol.js';

const LERP_TICKS = 3;

const TAU = Math.PI * 2;
function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (!Number.isFinite(d)) return 0;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}
const finite = (st) => Array.isArray(st) && st.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e8);

// ---------------------------------------------------------------- other players
export class PlayerView extends Player {
  constructor(world, name) {
    super(world, 0, 0, 0);
    this.name = name;
    this.displayName = name;
    this.remote = true;
    this.targetable = true;
    this.blocksPlacement = true;
    this.heldId = 0;
    this.lastSwing = 0;
  }

  createMesh(gfx) {
    super.createMesh(gfx);
    this.gfx = gfx;
    this.tag = makeNameTag(this.name);
    this.tag.position.set(0, 2.15, 0);
    this.mesh.add(this.tag);
    this.setHeld(this.heldId, true);
  }

  setHeld(id, force = false) {
    if (id === this.heldMeshId && !force) return;
    this.heldId = id;
    if (!this.mesh || !this.gfx) return;
    if (this.heldMesh) {
      this.heldMesh.parent?.remove(this.heldMesh);
      this.heldMesh.material.dispose();
      this.heldMesh = null;
    }
    this.heldMeshId = id;
    if (!id || !ITEMS[id]) return;
    const m = this.gfx.items.createMesh(id);
    if (m.userData.block) {
      m.scale.setScalar(0.22);
      m.position.set(0, -0.62, 0.1);
      m.rotation.set(0, Math.PI / 4, 0);
    } else {
      // Flat items are held edge-on with the handle in the fist and the
      // top pointing forward and up (sprites run from bottom-left to top-right).
      m.scale.setScalar(0.55);
      m.position.set(-0.02, -0.42, 0.24);
      m.rotation.set(0, -Math.PI / 2, 0);
    }
    this.model.parts.rightArm.add(m);
    this.heldMesh = m;
  }

  updateMesh(partial, visible) {
    super.updateMesh(partial, visible);
    if (!this.mesh || !visible) return;
    if (this.heldMesh) {
      const [sky, blk] = this.lightAt();
      this.gfx.items.setMeshLight(this.heldMesh, sky, blk);
      // Lower the item while the arm swings forward to look natural.
    }
    if (this.tag) {
      // Sneaking players' names do not show through walls.
      this.tag.material.depthTest = !!this.sneaking;
      this.tag.material.opacity = this.sneaking ? 0.5 : 1;
      this.tag.visible = !this.sleeping;
    }
  }

  disposeMesh() {
    if (this.tag) {
      this.tag.material.map.dispose();
      this.tag.material.dispose();
      this.tag = null;
    }
    if (this.heldMesh) {
      this.heldMesh.material.dispose();
      this.heldMesh = null;
      this.heldMeshId = undefined;
    }
    super.disposeMesh();
  }
}

function makeNameTag(name) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '28px "Pixelify Sans", monospace';
  g.font = font;
  const w = Math.ceil(g.measureText(name).width) + 20;
  c.width = w;
  c.height = 40;
  g.font = font;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, w, 40);
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillText(name, w / 2, 21);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const s = new THREE.Sprite(mat);
  s.scale.set((w / 40) * 0.3, 0.3, 1);
  s.renderOrder = 10;
  s.userData.ownMaterial = false;
  return s;
}

// ---------------------------------------------------------------- creating proxies
// s = spawn record from the server: { i: id, k: kind, st: state, ... }
export function createProxy(world, s, net) {
  const st = s.st;
  if (!finite(st) || st.length < 3) return null;
  const [x, y, z] = st;
  let e = null;
  switch (s.k) {
    case 'm': {
      if (typeof s.ty !== 'string' || !Object.prototype.hasOwnProperty.call(MOB_TYPES, s.ty)) return null;
      const f = st[7] | 0;
      e = new Mob(world, s.ty, x, y, z, { baby: !!(f & MF.BABY), sheared: !!(f & MF.SHEARED), wool: st[8] | 0, health: st[6], yaw: st[3] });
      if (!e.def) return null;
      e.headYaw = e.pHeadYaw = st[4];
      e.headPitch = st[5];
      e.netFlags = 0;
      e.onPlayerAttack = (player, dmg, crit) => net.attack(e, player, dmg, crit);
      e.onInteract = (player, stack) => net.useEntity(e, player, stack);
      e.knockback = () => {};
      break;
    }
    case 'i':
      if (!ITEMS[s.it]) return null;
      e = new ItemEntity(world, x, y, z, { id: s.it, count: st[3] || 1, dmg: s.dm || 0 });
      break;
    case 'x':
      e = new XPOrb(world, x, y, z, s.n || 1);
      break;
    case 'f':
      e = new FallingBlock(world, 0, y, 0, s.b, s.m || 0);
      break;
    case 't':
      e = new PrimedTNT(world, 0, y, 0, s.f || 80);
      break;
    case 'p':
      e = new Projectile(world, null, x, y, z, 0, 0, 0, s.kind);
      e.crit = !!s.c;
      e.yaw = e.pyaw = st[3] || 0;
      e.pitch = e.ppitch = st[4] || 0;
      break;
    case 'P':
      e = new PlayerView(world, String(s.n || 'Player').slice(0, 16));
      e.onPlayerAttack = (player, dmg, crit) => net.attack(e, player, dmg, crit);
      e.knockback = () => {};
      break;
    default:
      return null;
  }
  e.netId = s.i;
  e.proxy = true;
  e.vx = e.vy = e.vz = 0;
  e.pickup = undefined; // the server decides who picks things up
  e.teleport(x, y, z);
  e.tx = x;
  e.ty = y;
  e.tz = z;
  e.lerp = 0;
  applyState(e, st, true);
  return e;
}

// Latest state from the server.
export function applyState(e, st, first = false) {
  if (!finite(st)) return;
  if (!first) {
    e.tx = st[0];
    e.ty = st[1];
    e.tz = st[2];
    e.lerp = LERP_TICKS;
  }
  if (e instanceof Mob) {
    e.tyaw = st[3];
    e.tHeadYaw = st[4];
    e.tHeadPitch = st[5];
    e.health = st[6];
    const f = st[7] | 0, prev = e.netFlags | 0;
    e.netFlags = f;
    if (f & MF.HURT && !(prev & MF.HURT)) e.hurtTime = 10;
    if (f & MF.DEAD) e.health = 0;
    e.fireTicks = f & MF.FIRE ? 1 : 0;
    e.aiming = f & MF.AIM ? 1 : 0;
    e.eatingGrass = f & MF.EATING ? 1 : 0;
    if (f & MF.SWING && !(prev & MF.SWING)) e.swingTicks = 8;
    const baby = !!(f & MF.BABY), sheared = !!(f & MF.SHEARED), wool = st[8] | 0;
    if (baby !== e.baby) {
      e.baby = baby;
      e.setSize(e.def.w * (baby ? 0.5 : 1), e.def.h * (baby ? 0.5 : 1));
      e.rebuildModel = true;
    }
    if (sheared !== e.sheared || wool !== e.wool) {
      e.sheared = sheared;
      e.wool = wool;
      e.rebuildModel = true;
    }
    if (first) e.yaw = e.pyaw = st[3];
  } else if (e instanceof ItemEntity) {
    const n = st[3] | 0;
    if (n > 0 && n !== e.stack.count) {
      e.stack.count = n;
      if (e.mesh) e.disposeMesh(); // redrawn with the new stack size
    }
  } else if (e instanceof Projectile) {
    e.tyaw = st[3];
    e.tpitch = st[4];
  } else if (e instanceof PlayerView) {
    e.tyaw = st[3];
    e.tpitch = st[4];
    const f = st[5] | 0;
    e.sneaking = !!(f & PF.SNEAK);
    e.flying = !!(f & PF.FLY);
    if (f & PF.HURT && !e.netHurt) e.hurtTime = 10;
    e.netHurt = !!(f & PF.HURT);
    e.health = f & PF.DEAD ? 0 : 20;
    e.setHeld(st[6] | 0);
    if (st[11] !== e.lastSwing) {
      if (!first) e.swing();
      e.lastSwing = st[11];
    }
    const sl = st[12] | 0;
    e.sleeping = sl > 0 ? { x: Math.floor(st[0]), y: Math.floor(st[1]), z: Math.floor(st[2]), f: (sl - 1) & 3 } : null;
    if (first) {
      e.yaw = e.pyaw = e.renderYaw = st[3];
      e.pitch = st[4];
    }
  }
}

// One client tick of a proxy: glide toward the server position and animate.
export function proxyTick(e) {
  e.px = e.x;
  e.py = e.y;
  e.pz = e.z;
  e.pyaw = e.yaw;
  e.ppitch = e.pitch;
  e.age++;
  if (e.lerp > 0) {
    const n = e.lerp--;
    e.setPos(e.x + (e.tx - e.x) / n, e.y + (e.ty - e.y) / n, e.z + (e.tz - e.z) / n);
    if (e.tyaw !== undefined) e.yaw += angleDiff(e.tyaw, e.yaw) / n;
    if (e.tpitch !== undefined) e.pitch += (e.tpitch - e.pitch) / n;
  }
  if (e.localInvuln > 0) e.localInvuln--;
  if (e instanceof Mob || e instanceof PlayerView) {
    e.pLimbAmount = e.limbAmount;
    let dist = Math.hypot(e.x - e.px, e.z - e.pz) * 4;
    if (dist > 1) dist = 1;
    e.limbAmount += (dist - e.limbAmount) * 0.4;
    e.limbSwing += e.limbAmount;
    if (e.hurtTime > 0) e.hurtTime--;
    if (e.health <= 0) e.deathTime++;
    else e.deathTime = 0;
  }
  if (e instanceof Mob) {
    e.pHeadYaw = e.headYaw;
    if (e.tHeadYaw !== undefined) e.headYaw += angleDiff(e.tHeadYaw, e.headYaw) * 0.5;
    if (e.tHeadPitch !== undefined) e.headPitch += (e.tHeadPitch - e.headPitch) * 0.5;
  } else if (e instanceof PlayerView) {
    e.pSwing = e.swingProgress(1);
    if (e.swinging) {
      e.swingTime++;
      if (e.swingTime >= 6) {
        e.swingTime = 0;
        e.swinging = false;
      }
    }
    e.renderYaw += angleDiff(e.yaw, e.renderYaw) * (e.limbAmount > 0.1 ? 0.3 : 0.08);
    if (Math.abs(angleDiff(e.yaw, e.renderYaw)) > 0.9) e.renderYaw = e.yaw - Math.sign(angleDiff(e.yaw, e.renderYaw)) * 0.9;
  } else if (e instanceof PrimedTNT) {
    if (e.fuse > 0) e.fuse--;
  }
}

// What a player can do to an animal by right-clicking it (see Mob.onInteract).
export function wouldInteract(e, stack) {
  if (!(e instanceof Mob) || !stack) return false;
  const def = ITEMS[stack.id];
  if (!def) return false;
  if (e.type === 'sheep') {
    if (def.name === 'shears') return !e.sheared && !e.baby;
    if (def.name.endsWith('_dye') || def.name === 'lapis_lazuli' || def.name === 'bone_meal') return true;
  }
  if (e.type === 'cow' && def.name === 'bucket') return true;
  return !!(e.def.food && e.def.food.includes(def.name));
}
