// Non-living entities: dropped items, experience orbs, falling sand, TNT, arrows and thrown things.
import * as THREE from '../../vendor/three.module.min.js';
import { Entity } from './entity.js';
import { ITEMS, I, maxStack } from '../data/items.js';
import { B, BLOCKS, isLiquid, isSolid } from '../data/blocks.js';
import { sameItem } from '../game/inventory.js';
import { raycast, rayAABB, AABB } from '../world/physics.js';
import { chunkGeometry } from '../gfx/items3d.js';
import { buildSingleBlock } from '../gfx/mesher.js';
import { makeChunkMaterial, makeEntityMaterial } from '../gfx/materials.js';

// ---------------------------------------------------------------- items
export class ItemEntity extends Entity {
  constructor(world, x, y, z, stack) {
    super(world, x, y, z);
    this.setSize(0.25, 0.25);
    this.stack = stack;
    this.pickupDelay = 10;
    this.bobOffset = Math.random() * Math.PI * 2;
    this.lifetime = 6000;
    this.vx = (Math.random() - 0.5) * 0.2;
    this.vy = 0.2;
    this.vz = (Math.random() - 0.5) * 0.2;
  }

  tick() {
    this.baseTick();
    if (this.pickupDelay > 0) this.pickupDelay--;
    if (this.inWater) {
      // float upward
      this.vy += this.vy < 0.06 ? 0.005 : 0;
      this.vx *= 0.99;
      this.vz *= 0.99;
    } else this.vy -= 0.04;
    if (this.inLava) {
      this.game.audio.play('fizz', { x: this.x, y: this.y, z: this.z });
      this.remove();
      return;
    }
    this.move(this.vx, this.vy, this.vz);
    let fr = 0.98;
    if (this.onGround) fr = this.groundFriction() * 0.98;
    this.vx *= fr;
    this.vy *= 0.98;
    this.vz *= fr;
    if (this.onGround) this.vy *= -0.5;
    // Merge with nearby identical stacks
    if (this.age % 20 === 0) {
      for (const e of this.world.entities) {
        if (e === this || !(e instanceof ItemEntity) || e.dead) continue;
        if (!sameItem(e.stack, this.stack)) continue;
        if (Math.abs(e.x - this.x) > 0.6 || Math.abs(e.y - this.y) > 0.3 || Math.abs(e.z - this.z) > 0.6) continue;
        const max = maxStack(this.stack.id);
        if (this.stack.count + e.stack.count > max) continue;
        this.stack.count += e.stack.count;
        this.pickupDelay = Math.max(this.pickupDelay, e.pickupDelay);
        e.remove();
      }
    }
    if (this.age >= this.lifetime) this.remove();
  }

  pickup(player) {
    if (this.pickupDelay > 0 || this.dead) return;
    const before = this.stack.count;
    const left = player.inventory.add(this.stack);
    if (left < before) {
      this.game.audio.play('pop', { x: this.x, y: this.y, z: this.z, pitch: 1 + (Math.random() - 0.5) * 0.6 });
      this.game.onPickup?.(this, before - left);
      this.stack.count = left;
      if (left <= 0) {
        this.pickedBy = player;
        this.flyTicks = 3;
        this.remove();
      }
    }
  }

  createMesh(gfx) {
    const g = new THREE.Group();
    const m = gfx.items.createMesh(this.stack.id);
    const block = m.userData.block;
    const b = block ? BLOCKS[ITEMS[this.stack.id].block] : null;
    const small = b && b.shape !== 'cube';
    m.scale.setScalar(block ? (small ? 0.4 : 0.25) : 0.4);
    m.position.y = block ? 0.125 : 0.2;
    g.add(m);
    // Bigger stacks show extra copies.
    const extra = this.stack.count > 32 ? 3 : this.stack.count > 16 ? 2 : this.stack.count > 1 ? 1 : 0;
    for (let i = 0; i < extra; i++) {
      const c = new THREE.Mesh(m.geometry, m.material);
      c.scale.copy(m.scale);
      c.position.set((i % 2 ? 1 : -1) * 0.06, m.position.y + 0.04 * (i + 1), (i === 1 ? 1 : -1) * 0.05);
      if (!block) c.position.z = -0.03 * (i + 1);
      g.add(c);
    }
    this.itemMesh = m;
    this.mesh = g;
    gfx.entityGroup.add(g);
    this.meshCount = this.stack.count;
  }

  updateMesh(partial, visible) {
    if (!this.mesh) return;
    const [x, y, z] = this.lerpPos(partial);
    const t = this.age + partial;
    this.mesh.position.set(x, y + Math.sin(t / 10 + this.bobOffset) * 0.06 + 0.06, z);
    this.mesh.rotation.y = t / 20 + this.bobOffset;
    const [sky, blk] = this.lightAt();
    this.game.gfx.items.setMeshLight(this.itemMesh, sky, blk);
    this.mesh.visible = visible;
  }
}

// ---------------------------------------------------------------- xp
export class XPOrb extends Entity {
  constructor(world, x, y, z, value) {
    super(world, x, y, z);
    this.setSize(0.5, 0.5);
    this.value = value;
    this.vx = (Math.random() - 0.5) * 0.2;
    this.vy = Math.random() * 0.2;
    this.vz = (Math.random() - 0.5) * 0.2;
    this.delay = 5;
  }

  tick() {
    this.baseTick();
    if (this.delay > 0) this.delay--;
    this.vy -= 0.03;
    const p = this.game.nearestPlayer(this.x, this.y, this.z, 8, (q) => q.alive && q.mode !== 'spectator');
    if (p) {
      const dx = p.x - this.x, dy = p.y + p.eyeHeight() / 2 - this.y, dz = p.z - this.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / 8;
      if (d < 1) {
        const f = (1 - d) * (1 - d);
        this.vx += (dx / d / 8) * f * 0.1;
        this.vy += (dy / d / 8) * f * 0.1;
        this.vz += (dz / d / 8) * f * 0.1;
      }
    }
    this.move(this.vx, this.vy, this.vz);
    const fr = this.onGround ? 0.588 : 0.98;
    this.vx *= fr;
    this.vy *= 0.98;
    this.vz *= fr;
    if (this.onGround) this.vy *= -0.9;
    if (this.age > 6000) this.remove();
  }

  pickup(player) {
    if (this.delay > 0 || this.dead) return;
    player.addXP(this.value);
    this.game.audio.play('orb', { pitch: 0.8 + Math.random() * 0.5 });
    this.remove();
  }

  createMesh(gfx) {
    if (!XPOrb.mat) {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const g = c.getContext('2d');
      g.fillStyle = '#e9ff5c';
      g.fillRect(2, 2, 4, 4);
      g.fillStyle = '#7dff3a';
      g.fillRect(1, 3, 6, 2);
      g.fillRect(3, 1, 2, 6);
      g.fillStyle = '#fbffd2';
      g.fillRect(3, 3, 1, 1);
      const t = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      XPOrb.mat = new THREE.SpriteMaterial({ map: t, fog: false });
    }
    this.mesh = new THREE.Sprite(XPOrb.mat);
    this.mesh.userData.ownMaterial = false;
    const s = this.value > 10 ? 0.35 : this.value > 3 ? 0.28 : 0.2;
    this.mesh.scale.set(s, s, s);
    gfx.entityGroup.add(this.mesh);
  }

  updateMesh(partial, visible) {
    if (!this.mesh) return;
    const [x, y, z] = this.lerpPos(partial);
    this.mesh.position.set(x, y + 0.2, z);
    const pulse = 0.75 + Math.sin((this.age + partial) * 0.3) * 0.25;
    this.mesh.material.color.setRGB(pulse, 1, pulse * 0.6);
    this.mesh.visible = visible;
  }
}

// ---------------------------------------------------------------- falling blocks
function blockMesh(gfx, id, meta) {
  const data = buildSingleBlock(id, meta);
  const geo = chunkGeometry(data);
  geo.translate(-8, 0, -8);
  const mat = makeChunkMaterial(gfx.texArray, { entity: true });
  return new THREE.Mesh(geo, mat);
}

export class FallingBlock extends Entity {
  constructor(world, x, y, z, id, meta) {
    super(world, x + 0.5, y, z + 0.5);
    this.setSize(0.98, 0.98);
    this.blockId = id;
    this.blockMeta = meta;
  }

  tick() {
    this.baseTick();
    this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    const world = this.world;
    if (this.onGround || this.age > 600) {
      const bx = Math.floor(this.x), by = Math.floor(this.y + 0.1), bz = Math.floor(this.z);
      const cur = world.getBlock(bx, by, bz);
      this.remove();
      if ((cur === 0 || BLOCKS[cur].replaceable) && this.age <= 600) {
        if (cur !== 0 && !isLiquid[cur]) this.game.dropBlockItems(bx, by, bz, cur, world.getMeta(bx, by, bz));
        world.setBlock(bx, by, bz, this.blockId, this.blockMeta);
        this.game.audio.blockSound(BLOCKS[this.blockId].sound, 'place', bx + 0.5, by + 0.5, bz + 0.5);
      } else {
        this.game.dropItem(this.x, this.y + 0.5, this.z, { id: this.blockId, count: 1, dmg: 0 });
      }
    }
    // Crush things it lands on? Only damage the player for anvils (not here).
  }

  createMesh(gfx) {
    this.mesh = blockMesh(gfx, this.blockId, this.blockMeta);
    gfx.entityGroup.add(this.mesh);
  }

  updateMesh(partial, visible) {
    if (!this.mesh) return;
    const [x, y, z] = this.lerpPos(partial);
    this.mesh.position.set(x, y, z);
    const [sky, blk] = this.lightAt();
    this.mesh.material.uniforms.uEntityLight.value.set(sky / 15, blk / 15, 1);
    this.mesh.visible = visible;
  }
}

// ---------------------------------------------------------------- TNT
export class PrimedTNT extends Entity {
  constructor(world, x, y, z, fuse = 80) {
    super(world, x + 0.5, y, z + 0.5);
    this.setSize(0.98, 0.98);
    this.fuse = fuse;
    const a = Math.random() * Math.PI * 2;
    this.vx = -Math.sin(a) * 0.02;
    this.vy = 0.2;
    this.vz = -Math.cos(a) * 0.02;
    this.blocksPlacement = true;
  }

  tick() {
    this.baseTick();
    this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) {
      this.vx *= 0.7;
      this.vz *= 0.7;
      this.vy *= -0.5;
    }
    this.fuse--;
    if (this.age % 2 === 0) this.game.gfx.particles.emit('smoke', this.x, this.y + 1.1, this.z);
    if (this.fuse <= 0) {
      this.remove();
      this.game.explode(this.x, this.y + 0.49, this.z, 4, this);
    }
  }

  createMesh(gfx) {
    this.mesh = blockMesh(gfx, B.tnt, 0);
    gfx.entityGroup.add(this.mesh);
  }

  updateMesh(partial, visible) {
    if (!this.mesh) return;
    const [x, y, z] = this.lerpPos(partial);
    this.mesh.position.set(x, y, z);
    const f = this.fuse - partial + 1;
    let s = 1;
    if (f < 10) s = 1 + (1 - f / 10) * 0.3;
    this.mesh.scale.set(s, s, s);
    this.mesh.position.x -= (s - 1) * 0;
    const flash = Math.floor(f / 5) % 2 === 0 ? 0.6 : 0;
    const [sky, blk] = this.lightAt();
    this.mesh.material.uniforms.uEntityLight.value.set(sky / 15, blk / 15, 1);
    this.mesh.material.uniforms.uColorMul.value.setRGB(1 + flash * 1.5, 1 + flash * 1.5, 1 + flash * 1.5);
    this.mesh.visible = visible;
  }
}

// ---------------------------------------------------------------- arrows & throwables
export class Projectile extends Entity {
  constructor(world, shooter, x, y, z, vx, vy, vz, kind) {
    super(world, x, y, z);
    this.setSize(0.25, 0.25);
    this.shooter = shooter;
    this.kind = kind; // 'arrow' | 'snowball' | 'egg'
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.stuck = null;
    this.stuckTicks = 0;
    this.gravity = kind === 'arrow' ? 0.05 : 0.03;
    this.drag = 0.99;
    this.damageBase = 2;
    this.crit = false;
    this.pickupable = kind === 'arrow' && shooter && shooter.isPlayer && shooter.mode !== 'creative';
    this.updateRotation();
    this.pyaw = this.yaw;
    this.ppitch = this.pitch;
  }

  updateRotation() {
    const h = Math.hypot(this.vx, this.vz);
    this.yaw = Math.atan2(this.vx, this.vz);
    this.pitch = Math.atan2(this.vy, h);
  }

  tick() {
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.pyaw = this.yaw;
    this.ppitch = this.pitch;
    this.age++;
    if (this.stuck) {
      this.stuckTicks++;
      const s = this.stuck;
      if (this.world.getBlock(s.x, s.y, s.z) !== s.id) {
        this.stuck = null;
        this.vx = this.vz = 0;
        this.vy = 0;
      } else {
        if (this.stuckTicks > 1200) this.remove();
        return;
      }
    }
    const world = this.world;
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    const dx = this.vx / speed, dy = this.vy / speed, dz = this.vz / speed;
    const blockHit = raycast(world, this.x, this.y, this.z, dx, dy, dz, speed);
    let maxT = blockHit ? blockHit.t : speed;
    // Entity hits
    let hitEnt = null;
    const cands = [...this.game.players, ...world.entities];
    for (const e of cands) {
      if (!e || e === this || e.dead || !e.targetable && !e.isPlayer) continue;
      if (e === this.shooter && this.age < 5) continue;
      if (e.isPlayer && e.mode === 'spectator') continue;
      if (e.health !== undefined && e.health <= 0) continue;
      const r = rayAABB(this.x, this.y, this.z, dx, dy, dz, e.box.grow(0.3, 0.3, 0.3), maxT);
      if (r && r.t < maxT) {
        maxT = r.t;
        hitEnt = e;
      }
    }
    if (hitEnt) {
      this.hitEntity(hitEnt, speed);
      return;
    }
    if (blockHit) {
      this.setPos(blockHit.px - dx * 0.05, blockHit.py - dy * 0.05, blockHit.pz - dz * 0.05);
      this.hitBlock(blockHit);
      return;
    }
    this.setPos(this.x + this.vx, this.y + this.vy, this.z + this.vz);
    const inWater = isLiquid[world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))];
    const drag = inWater ? 0.6 : this.drag;
    this.vx *= drag; this.vy *= drag; this.vz *= drag;
    this.vy -= this.gravity;
    this.updateRotation();
    if (this.crit && this.age % 1 === 0) this.game.gfx.particles.emit('crit', this.x, this.y, this.z, { vx: 0, vy: 0, vz: 0, life: 5 });
    if (this.age > 1200 || this.y < -10) this.remove();
  }

  hitEntity(e, speed) {
    const game = this.game;
    if (this.kind === 'arrow') {
      let dmg = Math.ceil(speed * this.damageBase);
      if (this.crit) dmg += Math.floor(Math.random() * (dmg / 2 + 2));
      const source = { type: 'arrow', entity: this.shooter };
      const ok = e.isPlayer ? e.damage(dmg, source) : e.onArrowHit ? e.onArrowHit(this, dmg) : e.damage(dmg, source);
      if (ok) {
        if (e.knockback) {
          const h = Math.hypot(this.vx, this.vz) || 1;
          const kx = (this.vx / h) * 0.24, kz = (this.vz / h) * 0.24;
          if (e.push) e.push(kx, 0.1, kz);
          else {
            e.vx += kx;
            e.vz += kz;
            e.vy = Math.min(0.4, e.vy + 0.1);
          }
        }
        game.audio.play('arrow_hit', { x: this.x, y: this.y, z: this.z });
        if (this.shooter && this.shooter.isPlayer && !e.isPlayer) game.audio.play('ding');
        this.remove();
      } else {
        this.vx *= -0.1; this.vy *= -0.1; this.vz *= -0.1;
      }
    } else {
      if (this.kind === 'snowball') e.damage(0, { type: 'mob', entity: this.shooter });
      if (e.knockback) e.knockback(this.x - this.vx, this.z - this.vz, 0.3);
      this.burst();
      this.remove();
    }
  }

  hitBlock(hit) {
    const game = this.game;
    if (this.kind === 'arrow') {
      this.stuck = { x: hit.x, y: hit.y, z: hit.z, id: hit.id };
      this.stuckTicks = 0;
      this.vx = this.vy = this.vz = 0;
      this.crit = false;
      game.audio.play('arrow_hit', { x: this.x, y: this.y, z: this.z });
      if (hit.id === B.tnt && this.onFire) {
        this.world.setBlock(hit.x, hit.y, hit.z, 0, 0);
        game.primeTNT(hit.x, hit.y, hit.z, 80);
      }
    } else {
      this.burst();
      if (this.kind === 'egg' && Math.random() < 0.125) game.spawnMob('chicken', this.x, this.y, this.z, { baby: true });
      this.remove();
    }
  }

  burst() {
    const p = this.game.gfx.particles;
    const id = this.kind === 'snowball' ? I.snowball : I.egg;
    for (let i = 0; i < 8; i++) this.game.itemCrumb(this.x, this.y, this.z, id, (Math.random() - 0.5) * 0.15, Math.random() * 0.15, (Math.random() - 0.5) * 0.15);
    void p;
  }

  pickup(player) {
    if (!this.stuck || !this.pickupable || this.stuckTicks < 5) return;
    if (player.inventory.add({ id: I.arrow, count: 1, dmg: 0 }) === 0) {
      this.game.audio.play('pop', { x: this.x, y: this.y, z: this.z });
      this.remove();
    }
  }

  createMesh(gfx) {
    if (this.kind === 'arrow') {
      if (!Projectile.arrowGeo) {
        const shaft = new THREE.BoxGeometry(0.04, 0.04, 0.5);
        Projectile.arrowGeo = shaft;
        const c = document.createElement('canvas');
        c.width = c.height = 4;
        const g = c.getContext('2d');
        g.fillStyle = '#8c6a35';
        g.fillRect(0, 0, 4, 4);
        const t = new THREE.CanvasTexture(c);
        t.magFilter = t.minFilter = THREE.NearestFilter;
        Projectile.arrowMat = makeEntityMaterial(t);
        const tip = new THREE.BoxGeometry(0.08, 0.08, 0.1);
        tip.translate(0, 0, 0.27);
        Projectile.tipGeo = tip;
        const tc = document.createElement('canvas');
        tc.width = tc.height = 4;
        const tg = tc.getContext('2d');
        tg.fillStyle = '#b8b8c0';
        tg.fillRect(0, 0, 4, 4);
        const tt = new THREE.CanvasTexture(tc);
        tt.magFilter = tt.minFilter = THREE.NearestFilter;
        Projectile.tipMat = makeEntityMaterial(tt);
        const fl = new THREE.BoxGeometry(0.12, 0.12, 0.1);
        fl.translate(0, 0, -0.22);
        Projectile.flGeo = fl;
        const fc = document.createElement('canvas');
        fc.width = fc.height = 4;
        const fg = fc.getContext('2d');
        fg.fillStyle = '#eeeeee';
        fg.fillRect(0, 0, 4, 4);
        const ft = new THREE.CanvasTexture(fc);
        ft.magFilter = ft.minFilter = THREE.NearestFilter;
        Projectile.flMat = makeEntityMaterial(ft);
      }
      const g = new THREE.Group();
      for (const [geo, mat] of [[Projectile.arrowGeo, Projectile.arrowMat], [Projectile.tipGeo, Projectile.tipMat], [Projectile.flGeo, Projectile.flMat]]) {
        const m = new THREE.Mesh(geo, mat);
        m.userData.ownMaterial = false;
        g.add(m);
      }
      g.userData.ownMaterial = false;
      this.mesh = g;
    } else {
      const m = gfx.items.createMesh(this.kind === 'snowball' ? I.snowball : I.egg);
      m.scale.setScalar(0.35);
      this.itemMesh = m;
      this.mesh = m;
    }
    gfx.entityGroup.add(this.mesh);
  }

  updateMesh(partial, visible) {
    if (!this.mesh) return;
    const [x, y, z] = this.lerpPos(partial);
    this.mesh.position.set(x, y, z);
    if (this.kind === 'arrow') {
      this.mesh.rotation.set(-(this.ppitch + (this.pitch - this.ppitch) * partial), this.lerpYaw(partial), 0, 'YXZ');
    } else {
      const cam = this.game.gfx.camera;
      this.mesh.quaternion.copy(cam.quaternion);
      const [sky, blk] = this.lightAt();
      this.game.gfx.items.setMeshLight(this.itemMesh, sky, blk);
    }
    this.mesh.visible = visible;
  }
}

export { AABB, isSolid };
