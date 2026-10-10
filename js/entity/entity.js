// Base entity physics and the shared parts of every living thing.
import { AABB, moveBox, inLiquid, boxCollides, blockSlipperiness, liquidHeight } from '../world/physics.js';
import { B, BLOCKS, isLiquid, isOpaque } from '../data/blocks.js';
import { flowVector } from '../world/fluids.js';

let nextEntityId = 1;

export class Entity {
  constructor(world, x, y, z) {
    this.id = nextEntityId++;
    this.world = world;
    this.game = world.game;
    this.w = 0.6;
    this.h = 1.8;
    this.x = x; this.y = y; this.z = z;
    this.px = x; this.py = y; this.pz = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.pyaw = 0; this.ppitch = 0;
    this.box = new AABB(0, 0, 0, 0, 0, 0);
    this.onGround = false;
    this.collidedH = false;
    this.collidedV = false;
    this.stepHeight = 0;
    this.fallDistance = 0;
    this.age = 0;
    this.dead = false;
    this.inWater = false;
    this.inLava = false;
    this.fireTicks = 0;
    this.noGravity = false;
    this.mesh = null;
    this.setPos(x, y, z);
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
    this.setPos(this.x, this.y, this.z);
  }

  setPos(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.box.set(x, y, z, this.w, this.h);
  }

  teleport(x, y, z) {
    this.setPos(x, y, z);
    this.px = x; this.py = y; this.pz = z;
    this.vx = this.vy = this.vz = 0;
    this.fallDistance = 0;
  }

  syncFromBox() {
    this.x = (this.box.x0 + this.box.x1) / 2;
    this.y = this.box.y0;
    this.z = (this.box.z0 + this.box.z1) / 2;
  }

  move(dx, dy, dz) {
    const [mx, my, mz] = moveBox(this.world, this, dx, dy, dz);
    this.syncFromBox();
    if (dx !== mx) this.vx = 0;
    if (dz !== mz) this.vz = 0;
    if (dy !== my) {
      if (this.onGround && this.fallDistance > 0) this.onLand(this.fallDistance);
      this.vy = 0;
    }
    if (this.onGround) {
      if (this.fallDistance > 0) this.onLand(this.fallDistance);
      this.fallDistance = 0;
    } else if (my < 0) this.fallDistance -= my;
    return [mx, my, mz];
  }

  onLand() {
    this.fallDistance = 0;
  }

  lerpPos(partial) {
    return [this.px + (this.x - this.px) * partial, this.py + (this.y - this.py) * partial, this.pz + (this.z - this.pz) * partial];
  }

  lerpYaw(partial) {
    let d = this.yaw - this.pyaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return this.pyaw + d * partial;
  }

  baseTick() {
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.pyaw = this.yaw;
    this.ppitch = this.pitch;
    this.age++;
    const wasInWater = this.inWater;
    this.inWater = inLiquid(this.world, this.box.grow(-0.001, -0.4, -0.001), B.water);
    this.inLava = inLiquid(this.world, this.box.grow(-0.1, -0.4, -0.1), B.lava);
    if (this.inWater) {
      if (!wasInWater && this.fallDistance > 1 && this.game.onSplash) this.game.onSplash(this);
      this.fallDistance = 0;
      this.fireTicks = 0;
      // Flowing water pushes things along.
      const f = this.waterFlow();
      if (f) {
        this.vx += f[0] * 0.014;
        this.vz += f[1] * 0.014;
      }
    }
    if (this.y < -64) this.outOfWorld();
  }

  waterFlow() {
    const x0 = Math.floor(this.box.x0), x1 = Math.floor(this.box.x1), y0 = Math.floor(this.box.y0), y1 = Math.floor(this.box.y1 - 0.4), z0 = Math.floor(this.box.z0), z1 = Math.floor(this.box.z1);
    let fx = 0, fz = 0, n = 0;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      if (this.world.getBlock(x, y, z) !== B.water) continue;
      const v = flowVector(this.world, x, y, z);
      fx += v[0];
      fz += v[1];
      n++;
    }
    if (!n || (fx === 0 && fz === 0)) return null;
    const l = Math.hypot(fx, fz);
    return [fx / l, fz / l];
  }

  outOfWorld() {
    this.remove();
  }

  isEyeInWater() {
    return this.eyeMedium() === B.water;
  }

  eyeHeight() {
    return this.h * 0.85;
  }

  eyeMedium() {
    const ey = this.y + this.eyeHeight();
    const bx = Math.floor(this.x), by = Math.floor(ey), bz = Math.floor(this.z);
    const id = this.world.getBlock(bx, by, bz);
    if (!isLiquid[id]) return 0;
    const top = by + liquidHeight(this.world.getMeta(bx, by, bz)) - 0.11;
    return ey < top ? id : 0;
  }

  // Standard ground/air/water movement (from input acceleration already applied to v).
  physicsStep(friction) {
    this.move(this.vx, this.vy, this.vz);
    if (!this.noGravity) this.vy -= 0.08;
    this.vy *= 0.98;
    this.vx *= friction;
    this.vz *= friction;
  }

  groundFriction() {
    if (!this.onGround) return 0.91;
    return blockSlipperiness(this.world, Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z)) * 0.91;
  }

  remove() {
    this.dead = true;
  }

  distanceTo(e) {
    return Math.hypot(e.x - this.x, e.y - this.y, e.z - this.z);
  }

  distanceSq(x, y, z) {
    return (x - this.x) ** 2 + (y - this.y) ** 2 + (z - this.z) ** 2;
  }

  // Rendering hooks (subclasses implement)
  createMesh() {}
  updateMesh() {}
  disposeMesh() {
    if (this.mesh) {
      this.mesh.parent?.remove(this.mesh);
      this.mesh.traverse?.((o) => {
        if (o.material && o.material.dispose && o.userData.ownMaterial !== false) o.material.dispose();
      });
      this.mesh = null;
    }
  }

  lightAt() {
    const x = Math.floor(this.x), y = Math.floor(this.y + this.h * 0.6), z = Math.floor(this.z);
    return [this.world.getSkyLight(x, y, z), this.world.getBlockLight(x, y, z)];
  }
}

// ---------------------------------------------------------------- living
export class Living extends Entity {
  constructor(world, x, y, z) {
    super(world, x, y, z);
    this.maxHealth = 20;
    this.health = 20;
    this.hurtTime = 0;
    this.hurtDir = 0;
    this.invuln = 0;
    this.lastDamage = 0;
    this.deathTime = 0;
    this.air = 300;
    this.stepHeight = 0.6;
    this.moveForward = 0;
    this.moveStrafe = 0;
    this.jumping = false;
    this.jumpTicks = 0;
    this.speed = 0.1;
    this.limbSwing = 0;
    this.limbAmount = 0;
    this.pLimbAmount = 0;
    this.headYaw = 0;
    this.pHeadYaw = 0;
    this.bodyYaw = 0;
    this.pBodyYaw = 0;
    this.lastAttacker = null;
    this.armorPoints = 0;
  }

  get alive() {
    return this.health > 0 && !this.dead;
  }

  onLadder() {
    const id = this.world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    return BLOCKS[id] && BLOCKS[id].climbable;
  }

  // Apply movement input as velocity and run physics (one tick).
  travel(strafe, forward, sprinting = false) {
    const yaw = this.yaw;
    const applyInput = (accel) => {
      let f = strafe * strafe + forward * forward;
      if (f >= 1e-4) {
        f = Math.sqrt(f);
        if (f < 1) f = 1;
        f = accel / f;
        const s = strafe * f, fw = forward * f;
        const sin = Math.sin(yaw), cos = Math.cos(yaw);
        this.vx += -fw * sin + s * cos;
        this.vz += -fw * cos - s * sin;
      }
    };
    if (this.inWater && !this.flying) {
      const y0 = this.y;
      applyInput(0.02);
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.8; this.vy *= 0.8; this.vz *= 0.8;
      this.vy -= 0.02;
      if (this.collidedH && !boxCollides(this.world, this.box.clone().offset(this.vx, this.vy + 0.6 - this.y + y0, this.vz))) this.vy = 0.3;
    } else if (this.inLava && !this.flying) {
      const y0 = this.y;
      applyInput(0.02);
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.5; this.vy *= 0.5; this.vz *= 0.5;
      this.vy -= 0.02;
      if (this.collidedH && !boxCollides(this.world, this.box.clone().offset(this.vx, this.vy + 0.6 - this.y + y0, this.vz))) this.vy = 0.3;
    } else {
      const fr = this.groundFriction();
      const accel = this.onGround ? this.moveSpeed(sprinting) * (0.16277136 / (fr * fr * fr)) : (this.flying ? this.flySpeed() : sprinting ? 0.026 : 0.02);
      applyInput(accel);
      const ladder = this.onLadder();
      if (ladder) {
        this.vx = Math.max(-0.15, Math.min(0.15, this.vx));
        this.vz = Math.max(-0.15, Math.min(0.15, this.vz));
        this.fallDistance = 0;
        if (this.vy < -0.15) this.vy = -0.15;
        if (this.sneaking && this.vy < 0) this.vy = 0;
      }
      this.move(this.vx, this.vy, this.vz);
      if (ladder && this.collidedH) this.vy = 0.2;
      if (this.flying) {
        this.vy *= 0.6;
      } else {
        if (!this.noGravity) this.vy -= 0.08;
        this.vy *= 0.98;
      }
      this.vx *= fr;
      this.vz *= fr;
    }
    // Limb animation
    this.pLimbAmount = this.limbAmount;
    const dx = this.x - this.px, dz = this.z - this.pz;
    let dist = Math.sqrt(dx * dx + dz * dz) * 4;
    if (dist > 1) dist = 1;
    this.limbAmount += (dist - this.limbAmount) * 0.4;
    this.limbSwing += this.limbAmount;
  }

  moveSpeed(sprinting) {
    return this.speed * (sprinting ? 1.3 : 1);
  }

  flySpeed() {
    return 0.05;
  }

  jump() {
    this.vy = 0.42;
    if (this.sprinting) {
      this.vx -= Math.sin(this.yaw) * 0.2;
      this.vz -= Math.cos(this.yaw) * 0.2;
    }
  }

  livingTick() {
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invuln > 0) this.invuln--;
    if (this.health <= 0) {
      this.deathTime++;
      if (this.deathTime >= 20) this.onDeathComplete();
      return false;
    }
    // Lava and fire
    if (this.inLava) {
      this.damage(4, { type: 'lava' });
      this.fireTicks = Math.max(this.fireTicks, 300);
    }
    if (this.fireTicks > 0) {
      if (this.fireImmune) this.fireTicks = 0;
      else {
        if (this.fireTicks % 20 === 0) this.damage(1, { type: 'fire' });
        this.fireTicks--;
      }
    }
    const feet = this.world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z));
    if (feet === B.fire) {
      this.damage(1, { type: 'fire' });
      this.fireTicks = Math.max(this.fireTicks, 160);
    }
    // Cactus contact
    const gb = this.box.grow(0.01, 0, 0.01);
    for (let x = Math.floor(gb.x0); x <= Math.floor(gb.x1); x++) for (let z = Math.floor(gb.z0); z <= Math.floor(gb.z1); z++) {
      for (let y = Math.floor(gb.y0); y <= Math.floor(gb.y1); y++) {
        if (this.world.getBlock(x, y, z) === B.cactus) {
          this.damage(1, { type: 'cactus' });
          break;
        }
      }
    }
    // Breathing
    if (this.breathes !== false) {
      if (this.isEyeInWater()) {
        this.air--;
        if (this.air <= -20) {
          this.air = 0;
          this.damage(2, { type: 'drown' });
        }
      } else this.air = Math.min(300, this.air + 4 > 300 ? 300 : this.air + 4);
    }
    // Suffocation in walls
    const eyeY = this.y + this.eyeHeight();
    const eb = this.world.getBlock(Math.floor(this.x), Math.floor(eyeY), Math.floor(this.z));
    if (isOpaque[eb] && eb !== 255 && this.suffocates !== false) this.damage(1, { type: 'suffocate' });
    return true;
  }

  armorReduce(amount) {
    const a = Math.min(20, this.armorPoints);
    return amount * (1 - a / 25);
  }

  // Returns true if damage was applied.
  damage(amount, source = {}) {
    if (this.health <= 0 || this.dead) return false;
    if (this.invulnerable && source.type !== 'void') return false;
    if (this.fireImmune && (source.type === 'fire' || source.type === 'lava')) return false;
    if (this.invuln > 10) {
      if (amount <= this.lastDamage) return false;
      const extra = amount - this.lastDamage;
      this.lastDamage = amount;
      amount = extra;
    } else {
      this.lastDamage = amount;
      this.invuln = 20;
      this.hurtTime = 10;
    }
    if (['mob', 'player', 'arrow', 'explosion', 'cactus', 'fire_attack'].includes(source.type)) amount = this.armorReduce(amount);
    if (source.entity) {
      this.lastAttacker = source.entity;
      const dx = source.entity.x - this.x, dz = source.entity.z - this.z;
      this.hurtDir = Math.atan2(dz, dx);
    }
    this.health = Math.max(0, this.health - amount);
    this.onHurt(amount, source);
    if (this.health <= 0) this.onDeath(source);
    return true;
  }

  knockback(fromX, fromZ, strength = 0.4) {
    let dx = this.x - fromX, dz = this.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    this.vx = this.vx / 2 + dx * strength;
    this.vz = this.vz / 2 + dz * strength;
    this.vy = Math.min(0.4, this.vy / 2 + strength);
  }

  heal(n) {
    if (this.health <= 0) return;
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  onLand(dist) {
    const d = Math.ceil(dist - 3);
    if (d > 0 && !this.inWater) {
      this.damage(d, { type: 'fall' });
      this.game.onFall?.(this, d);
    }
    // Trampling farmland
    if (dist > 0.75) {
      const bx = Math.floor(this.x), by = Math.floor(this.y - 0.2), bz = Math.floor(this.z);
      if (this.world.getBlock(bx, by, bz) === B.farmland && Math.random() < dist - 0.5) {
        this.world.setBlock(bx, by, bz, B.dirt, 0);
      }
    }
    this.fallDistance = 0;
  }

  onHurt() {}
  onDeath() {}
  onDeathComplete() {
    this.remove();
  }
}
