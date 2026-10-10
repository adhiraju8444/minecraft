// Creatures: passive animals and night-time monsters.
import { Living } from './entity.js';
import { findPath, groundBelow } from './pathfind.js';
import { createModel } from '../gfx/models.js';
import { raycast } from '../world/physics.js';
import { I, ITEMS } from '../data/items.js';
import { B, WOOL_COLORS } from '../data/blocks.js';

export const MOB_TYPES = {
  pig: { name: 'Pig', w: 0.9, h: 0.9, health: 10, speed: 0.046, food: ['carrot', 'potato'], drops: [['porkchop', 1, 3]], xp: [1, 3], sound: 'pig' },
  cow: { name: 'Cow', w: 0.9, h: 1.4, health: 10, speed: 0.04, food: ['wheat'], drops: [['beef', 1, 3], ['leather', 0, 2]], xp: [1, 3], sound: 'cow' },
  sheep: { name: 'Sheep', w: 0.9, h: 1.3, health: 8, speed: 0.044, food: ['wheat'], drops: [['mutton', 1, 2]], xp: [1, 3], sound: 'sheep' },
  chicken: { name: 'Chicken', w: 0.4, h: 0.7, health: 4, speed: 0.044, food: ['wheat_seeds'], drops: [['chicken', 1, 1], ['feather', 0, 2]], xp: [1, 3], sound: 'chicken' },
  zombie: { name: 'Zombie', w: 0.6, h: 1.95, health: 20, speed: 0.05, hostile: true, burns: true, attack: [2, 3, 4.5], drops: [['rotten_flesh', 0, 2]], rare: ['iron_ingot', 'carrot', 'potato'], xp: [5, 5], sound: 'zombie', range: 35 },
  skeleton: { name: 'Skeleton', w: 0.6, h: 1.99, health: 20, speed: 0.054, hostile: true, burns: true, ranged: true, drops: [['bone', 0, 2], ['arrow', 0, 2]], xp: [5, 5], sound: 'skeleton', range: 16 },
  spider: { name: 'Spider', w: 1.4, h: 0.9, health: 16, speed: 0.062, hostile: true, climbs: true, attack: [2, 2, 3], drops: [['string', 0, 2]], xp: [5, 5], sound: 'spider', range: 16 },
};

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export class Mob extends Living {
  constructor(world, type, x, y, z, opts = {}) {
    super(world, x, y, z);
    this.type = type;
    this.def = MOB_TYPES[type];
    this.displayName = this.def.name;
    this.baby = !!opts.baby;
    this.growTimer = this.baby ? -24000 : 0;
    this.setSize(this.def.w * (this.baby ? 0.5 : 1), this.def.h * (this.baby ? 0.5 : 1));
    this.maxHealth = this.def.health;
    this.health = opts.health ?? this.def.health;
    this.speed = this.def.speed;
    this.hostile = !!this.def.hostile;
    this.targetable = true;
    this.blocksPlacement = true;
    this.yaw = opts.yaw ?? Math.random() * Math.PI * 2;
    this.bodyYaw = this.yaw;
    this.path = null;
    this.pathIdx = 0;
    this.pathTimer = 0;
    this.goal = null;
    this.target = null;
    this.panic = 0;
    this.attackCooldown = 0;
    this.shootCooldown = 40;
    this.loveTicks = 0;
    this.breedCooldown = 0;
    this.lookTarget = null;
    this.ambientTimer = rnd(0, 200);
    this.recentlyHit = 0;
    this.sheared = !!opts.sheared;
    this.wool = opts.wool ?? 0; // colour index for sheep
    this.eggTimer = rnd(6000, 12000);
    this.persistent = !this.hostile;
    this.stuckTicks = 0;
    this.provoked = 0;
    this.headPitch = 0;
    this.strafeDir = 1;
    this.eatingGrass = 0;
    if (type === 'chicken') this.fallSlow = true;
    this.breathes = true;
    this.fireImmune = false;
  }

  serialize() {
    return { type: this.type, x: this.x, y: this.y, z: this.z, yaw: this.yaw, health: this.health, baby: this.baby, sheared: this.sheared, wool: this.wool, grow: this.growTimer };
  }

  // ---------------------------------------------------------------- tick
  tick() {
    this.baseTick();
    if (!this.livingTick()) return;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.recentlyHit > 0) this.recentlyHit--;
    if (this.breedCooldown > 0) this.breedCooldown--;
    if (this.provoked > 0) this.provoked--;
    if (this.loveTicks > 0) {
      this.loveTicks--;
      if (this.loveTicks % 10 === 0) this.game.gfx.particles.emit('heart', this.x + (Math.random() - 0.5) * this.w, this.y + this.h + 0.2, this.z + (Math.random() - 0.5) * this.w);
    }
    if (this.baby) {
      this.growTimer++;
      if (this.growTimer >= 0) {
        this.baby = false;
        this.setSize(this.def.w, this.def.h);
        this.rebuildModel = true;
      }
    }
    this.burnInDaylight();
    this.ai();
    this.moveTick();
    this.ambient();
    if (this.type === 'chicken' && !this.baby) {
      if (--this.eggTimer <= 0) {
        this.game.dropItem(this.x, this.y + 0.2, this.z, { id: I.egg, count: 1, dmg: 0 });
        this.game.audio.play('chicken_plop', { x: this.x, y: this.y, z: this.z });
        this.eggTimer = rnd(6000, 12000);
      }
    }
  }

  burnInDaylight() {
    if (!this.def.burns || this.fireTicks > 0) return;
    const w = this.world;
    if (w.daylight() < 0.5 || w.weather.raining || this.inWater) return;
    const x = Math.floor(this.x), y = Math.floor(this.y + this.eyeHeight()), z = Math.floor(this.z);
    if (w.getSkyLight(x, y, z) < 15) return;
    if (Math.random() * 30 < (w.daylight() - 0.4) * 2) this.fireTicks = 160;
  }

  ambient() {
    if (--this.ambientTimer > 0) return;
    this.ambientTimer = rnd(120, 400);
    const p = this.game.player;
    if (p && this.distanceTo(p) < 24) this.game.audio.play(this.def.sound + '_say', { x: this.x, y: this.y + this.h * 0.8, z: this.z, pitch: this.baby ? 1.4 : 1 });
  }

  canSee(e) {
    const [ox, oy, oz] = [this.x, this.y + this.eyeHeight(), this.z];
    const tx = e.x, ty = e.y + e.eyeHeight(), tz = e.z;
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = raycast(this.world, ox, oy, oz, dx / d, dy / d, dz / d, d);
    return !hit;
  }

  // ---------------------------------------------------------------- AI
  ai() {
    const p = this.game.player;
    const valid = p && p.alive && p.mode === 'survival';
    this.moveForward = 0;
    this.jumping = false;
    this.lookTarget = null;

    if (this.hostile) {
      let aggressive = true;
      if (this.type === 'spider') {
        const light = this.world.lightAt(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
        aggressive = light < 8 || this.provoked > 0;
      }
      if (valid && aggressive && this.game.difficulty > 0) {
        const d = this.distanceTo(p);
        if (d < this.def.range && (d < 6 || (this.age % 10 === 0 ? (this.seen = this.canSee(p)) : this.seen))) this.target = p;
        else if (d > this.def.range * 1.2) this.target = null;
      } else this.target = null;
      if (this.target) {
        if (this.def.ranged) this.rangedAI(this.target);
        else this.meleeAI(this.target);
        return;
      }
      this.wanderAI(0.8);
      return;
    }

    // Passive
    if (this.panic > 0) {
      this.panic--;
      if (!this.goal || this.reachedGoal() || this.pathTimer <= 0) this.pickWander(10, true);
      this.followPath(1.7);
      return;
    }
    // Breeding partner
    if (this.loveTicks > 0) {
      const mate = this.world.entities.find((e) => e !== this && e instanceof Mob && e.type === this.type && e.loveTicks > 0 && !e.baby && e.distanceTo(this) < 8);
      if (mate) {
        this.lookTarget = mate;
        if (this.distanceTo(mate) < 1.4 + this.w) {
          this.breedWith(mate);
        } else this.navigateTo(mate.x, mate.y, mate.z, 1, 20);
        this.followPath(1);
        return;
      }
    }
    // Tempted by food
    if (valid || (p && p.alive && p.mode === 'creative')) {
      const held = p.inventory.selectedStack();
      if (held && this.def.food.includes(ITEMS[held.id].name) && this.distanceTo(p) < 10 && this.breedCooldown === 0) {
        this.lookTarget = p;
        if (this.distanceTo(p) > 2.2) {
          this.navigateTo(p.x, p.y, p.z, 1.6, 20);
          this.followPath(1);
        }
        return;
      }
    }
    // Sheep regrow wool by eating grass
    if (this.type === 'sheep' && this.sheared && Math.random() < 0.002) {
      const bx = Math.floor(this.x), by = Math.floor(this.y - 0.5), bz = Math.floor(this.z);
      const above = this.world.getBlock(bx, by + 1, bz);
      if (above === B.tall_grass) {
        this.world.setBlock(bx, by + 1, bz, 0, 0);
        this.sheared = false;
      } else if (this.world.getBlock(bx, by, bz) === B.grass_block) {
        this.world.setBlock(bx, by, bz, B.dirt, 0);
        this.sheared = false;
      }
      this.eatingGrass = 40;
    }
    if (this.eatingGrass > 0) {
      this.eatingGrass--;
      return;
    }
    if (p && this.distanceTo(p) < 6 && Math.random() < 0.6) this.lookTarget = p;
    this.wanderAI(1);
  }

  wanderAI(speedMul) {
    if (!this.goal) {
      if (Math.random() < 1 / 100) this.pickWander(8, false);
    } else if (this.reachedGoal() || this.pathTimer <= 0) {
      this.goal = null;
      this.path = null;
    }
    if (this.goal) this.followPath(speedMul * 0.85);
  }

  pickWander(radius, far) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = far ? radius * (0.6 + Math.random() * 0.4) : 2 + Math.random() * radius;
      const x = Math.floor(this.x + Math.cos(a) * r), z = Math.floor(this.z + Math.sin(a) * r);
      if (!this.world.isLoadedAt(x, z)) continue;
      const y = groundBelow(this.world, x, Math.floor(this.y), z);
      if (y === null) continue;
      if (this.world.getBlock(x, y, z) === B.water && !far) continue;
      this.navigateTo(x + 0.5, y, z + 0.5, 0, 0, true);
      return;
    }
  }

  reachedGoal() {
    if (!this.goal) return true;
    return Math.abs(this.goal[0] - this.x) < 0.7 && Math.abs(this.goal[2] - this.z) < 0.7;
  }

  navigateTo(x, y, z, reach = 1, repathEvery = 20, force = false) {
    const tx = Math.floor(x), ty = Math.floor(y + 0.01), tz = Math.floor(z);
    const moved = !this.goal || Math.abs(this.goal[0] - x) + Math.abs(this.goal[2] - z) > 1.5;
    if (!force && this.path && this.pathTimer > 0 && !moved && this.pathTimer < 200) return;
    if (!force && this.path && this.pathTimer > 200 - repathEvery && !moved) return;
    this.goal = [x, y, z];
    this.path = findPath(this.world, Math.floor(this.x), Math.floor(this.y + 0.01), Math.floor(this.z), tx, ty, tz, {
      height: Math.ceil(this.h), reach: Math.max(0, reach), maxNodes: this.hostile ? 400 : 200, maxDrop: this.hostile ? 3 : 2,
    });
    this.pathIdx = 0;
    this.pathTimer = 200;
  }

  followPath(speedMul) {
    this.pathTimer--;
    if (!this.path || this.pathIdx >= this.path.length) {
      if (this.goal && this.reachedGoal()) this.goal = null;
      return false;
    }
    const n = this.path[this.pathIdx];
    const tx = n[0] + 0.5, tz = n[2] + 0.5;
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35 + (this.w > 1 ? 0.4 : 0) && Math.abs(n[1] - this.y) < 1.1) {
      this.pathIdx++;
      return true;
    }
    this.steerTo(tx, n[1], tz, speedMul);
    return true;
  }

  steerTo(tx, ty, tz, speedMul) {
    const dx = tx - this.x, dz = tz - this.z;
    const want = Math.atan2(-dx, -dz);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = 0.5;
    this.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    this.moveForward = Math.abs(diff) < 1.2 ? 1 : 0.3;
    this.speedMul = speedMul;
    if ((this.collidedH && this.onGround) || (ty > this.y + 0.5 && this.onGround && Math.hypot(dx, dz) < 1.5)) this.jumping = true;
    const prog = Math.hypot(this.x - this.px, this.z - this.pz);
    if (prog < 0.005) this.stuckTicks++;
    else this.stuckTicks = 0;
    if (this.stuckTicks > 40) {
      this.stuckTicks = 0;
      this.path = null;
      this.goal = null;
    }
  }

  meleeAI(t) {
    this.lookTarget = t;
    const dx = t.x - this.x, dz = t.z - this.z;
    const hd = Math.hypot(dx, dz);
    const reach = this.w / 2 + t.w / 2 + 0.8;
    if (hd > 1.2 || Math.abs(t.y - this.y) > 1) {
      this.navigateTo(t.x, t.y, t.z, 1, 10);
      if (!this.followPath(1) || hd < 3) this.steerTo(t.x, t.y, t.z, 1);
    } else {
      this.steerTo(t.x, t.y, t.z, 1);
      this.moveForward = hd > 0.8 ? 0.6 : 0;
    }
    // Spiders pounce
    if (this.type === 'spider' && this.onGround && hd > 2 && hd < 6 && Math.random() < 0.08) {
      this.vx += (dx / hd) * 0.35;
      this.vz += (dz / hd) * 0.35;
      this.vy = 0.4;
    }
    if (hd < reach && Math.abs(t.y + t.h / 2 - (this.y + this.h / 2)) < 1.6 && this.attackCooldown === 0) {
      this.attackCooldown = 20;
      this.swingTicks = 8;
      const diff = this.game.difficulty;
      const dmg = this.def.attack[Math.max(0, Math.min(2, diff - 1))];
      if (t.damage(dmg, { type: 'mob', entity: this })) {
        t.knockback(this.x, this.z, 0.4);
      }
    }
  }

  rangedAI(t) {
    this.lookTarget = t;
    const d = this.distanceTo(t);
    const see = this.age % 5 === 0 ? (this.seen = this.canSee(t)) : this.seen;
    if (!see || d > 14) {
      this.navigateTo(t.x, t.y, t.z, 4, 20);
      this.followPath(1);
    } else {
      // Keep some distance and strafe
      if (Math.random() < 0.02) this.strafeDir = -this.strafeDir;
      const away = d < 6;
      const dx = t.x - this.x, dz = t.z - this.z;
      this.yaw = Math.atan2(-dx, -dz);
      this.moveForward = away ? -0.5 : 0;
      this.moveStrafe = 0.5 * this.strafeDir;
      if (this.collidedH && this.onGround) this.jumping = true;
    }
    if (this.shootCooldown > 0) this.shootCooldown--;
    if (see && d < 16 && this.shootCooldown === 0) {
      this.shootCooldown = 30 + Math.floor(Math.random() * 30) - this.game.difficulty * 5;
      this.aiming = 10;
      this.game.mobShoot(this, t);
    }
    if (this.aiming > 0) this.aiming--;
  }

  moveTick() {
    // Look/head turning
    if (this.lookTarget) {
      const t = this.lookTarget;
      const dx = t.x - this.x, dz = t.z - this.z, dy = (t.y + (t.eyeHeight ? t.eyeHeight() : 0.5)) - (this.y + this.eyeHeight());
      this.targetHeadYaw = Math.atan2(-dx, -dz);
      this.headPitch = Math.atan2(dy, Math.hypot(dx, dz));
    } else {
      this.targetHeadYaw = this.yaw;
      this.headPitch *= 0.8;
    }
    this.pHeadYaw = this.headYaw;
    let diff = this.targetHeadYaw - this.headYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.headYaw += diff * 0.4;

    if (this.inWater || this.inLava) {
      if (Math.random() < 0.8) this.vy += 0.04;
    } else if (this.jumping && this.onGround) {
      this.vy = 0.42;
    }
    if (this.def.climbs && this.collidedH) this.vy = 0.2;
    const speed = this.speedMul || 1;
    const s = this.speed;
    this.speed = s * speed;
    this.travel(this.moveStrafe || 0, this.moveForward, false);
    this.speed = s;
    this.moveStrafe = 0;
    if (this.fallSlow && !this.onGround && this.vy < 0) this.vy *= 0.6;
  }

  // ---------------------------------------------------------------- interaction
  onPlayerAttack(player, dmg, crit) {
    void crit;
    const ok = this.damage(dmg, { type: 'player', entity: player });
    return ok;
  }

  onArrowHit(arrow, dmg) {
    return this.damage(dmg, { type: 'arrow', entity: arrow.shooter });
  }

  onHurt(amount, source) {
    const game = this.game;
    game.audio.play(this.def.sound + '_hurt', { x: this.x, y: this.y + this.h * 0.7, z: this.z, pitch: this.baby ? 1.4 : 1 });
    if (source.entity && source.entity.isPlayer) this.recentlyHit = 100;
    if (!this.hostile) {
      this.panic = 60;
      this.path = null;
      this.goal = null;
      this.pathTimer = 0;
    } else if (source.entity && source.entity.isPlayer && source.entity.mode === 'survival') {
      this.target = source.entity;
      this.provoked = 200;
      // Nearby zombies join in
      if (this.type === 'zombie') for (const e of this.world.entities) if (e instanceof Mob && e.type === 'zombie' && e.distanceTo(this) < 16) e.target = source.entity;
    }
  }

  onDeath(source) {
    const game = this.game;
    game.audio.play(this.def.sound + '_death', { x: this.x, y: this.y + this.h * 0.7, z: this.z, pitch: this.baby ? 1.4 : 1 });
    if (this.baby) return;
    const burning = this.fireTicks > 0;
    const killedByPlayer = this.recentlyHit > 0 || (source.entity && source.entity.isPlayer);
    for (const [name, a, b] of this.def.drops) {
      let n = rnd(a, b);
      if (n <= 0) continue;
      let item = name;
      if (burning && ITEMS[I['cooked_' + name]]) item = 'cooked_' + name;
      if (burning && name === 'beef') item = 'cooked_beef';
      game.dropItem(this.x, this.y + 0.5, this.z, { id: I[item], count: n, dmg: 0 });
    }
    if (this.type === 'sheep' && !this.sheared) game.dropItem(this.x, this.y + 0.5, this.z, { id: 96 + this.wool, count: 1, dmg: 0 });
    if (this.def.rare && killedByPlayer && Math.random() < 0.025) game.dropItem(this.x, this.y + 0.5, this.z, { id: I[this.def.rare[rnd(0, this.def.rare.length - 1)]], count: 1, dmg: 0 });
    if (this.type === 'skeleton' && killedByPlayer && Math.random() < 0.085) game.dropItem(this.x, this.y + 0.5, this.z, { id: I.bow, count: 1, dmg: rnd(100, 350) });
    if (killedByPlayer) game.spawnXP(this.x, this.y + 0.5, this.z, rnd(this.def.xp[0], this.def.xp[1]));
  }

  onDeathComplete() {
    for (let i = 0; i < 12; i++) this.game.gfx.particles.emit('poof', this.x + (Math.random() - 0.5) * this.w, this.y + Math.random() * this.h, this.z + (Math.random() - 0.5) * this.w);
    this.remove();
  }

  onInteract(player, stack) {
    const game = this.game;
    if (!stack) return false;
    const def = ITEMS[stack.id];
    if (this.type === 'sheep' && def.name === 'shears' && !this.sheared && !this.baby) {
      this.sheared = true;
      const n = rnd(1, 3);
      for (let i = 0; i < n; i++) game.dropItem(this.x, this.y + 1, this.z, { id: 96 + this.wool, count: 1, dmg: 0 }, null, true);
      game.audio.play('shear', { x: this.x, y: this.y + 1, z: this.z });
      player.damageHeld(1);
      return true;
    }
    if (this.type === 'sheep' && def.name.endsWith('_dye') || (this.type === 'sheep' && (def.name === 'lapis_lazuli' || def.name === 'bone_meal'))) {
      const color = def.name === 'lapis_lazuli' ? 'blue' : def.name === 'bone_meal' ? 'white' : def.name.replace('_dye', '');
      const idx = WOOL_COLORS.findIndex(([c]) => c === color);
      if (idx >= 0 && idx !== this.wool) {
        this.wool = idx;
        this.rebuildModel = true;
        player.consumeSelected(1);
        return true;
      }
    }
    if (this.type === 'cow' && def.name === 'bucket') {
      player.exchangeHeld('milk_bucket');
      game.audio.play('milk', { x: this.x, y: this.y + 1, z: this.z });
      return true;
    }
    if (this.def.food && this.def.food.includes(def.name)) {
      if (this.baby) {
        this.growTimer += 2400;
        player.consumeSelected(1);
        return true;
      }
      if (this.breedCooldown === 0 && this.loveTicks === 0) {
        this.loveTicks = 600;
        player.consumeSelected(1);
        return true;
      }
    }
    return false;
  }

  breedWith(mate) {
    this.loveTicks = 0;
    mate.loveTicks = 0;
    this.breedCooldown = 6000;
    mate.breedCooldown = 6000;
    this.game.spawnMob(this.type, (this.x + mate.x) / 2, Math.max(this.y, mate.y), (this.z + mate.z) / 2, { baby: true, wool: Math.random() < 0.5 ? this.wool : mate.wool });
    this.game.spawnXP(this.x, this.y + 0.5, this.z, rnd(1, 7));
    for (let i = 0; i < 6; i++) this.game.gfx.particles.emit('heart', this.x + (Math.random() - 0.5), this.y + this.h, this.z + (Math.random() - 0.5));
  }

  // ---------------------------------------------------------------- model
  createMesh(gfx) {
    this.model = createModel(this.type);
    this.mesh = this.model.root;
    const s = this.baby ? 0.5 : 1;
    this.model.inner.scale.setScalar(s);
    if (this.baby && this.model.parts.head) this.model.parts.head.scale.setScalar(1.5);
    if (this.type === 'sheep') this.applyWool();
    gfx.entityGroup.add(this.mesh);
  }

  applyWool() {
    const P = this.model.parts;
    if (!P.wool) return;
    P.wool.visible = !this.sheared;
    const c = WOOL_COLORS[this.wool][2];
    const m = P.wool.userData.mesh;
    if (!this.woolMat) {
      this.woolMat = m.material.clone();
      m.material = this.woolMat;
    }
    this.woolMat.uniforms.uTint.value.setRGB(Math.min(1.1, c[0] / 234), Math.min(1.1, c[1] / 234), Math.min(1.1, c[2] / 234));
  }

  updateMesh(partial, visible) {
    if (this.rebuildModel) {
      this.rebuildModel = false;
      this.disposeMesh();
      this.createMesh(this.game.gfx);
    }
    if (!this.mesh) return;
    this.mesh.visible = visible;
    if (!visible) return;
    const [x, y, z] = this.lerpPos(partial);
    this.mesh.position.set(x, y, z);
    const yaw = this.lerpYaw(partial);
    this.mesh.rotation.set(0, yaw + Math.PI, 0);
    const P = this.model.parts;
    const limb = this.limbSwing - this.limbAmount * (1 - partial);
    const amt = Math.min(1, this.pLimbAmount + (this.limbAmount - this.pLimbAmount) * partial);
    const sw = Math.sin(limb * 0.6662) * 1.2 * amt;
    let headYaw = this.pHeadYaw + (this.headYaw - this.pHeadYaw) * partial - yaw;
    while (headYaw > Math.PI) headYaw -= Math.PI * 2;
    while (headYaw < -Math.PI) headYaw += Math.PI * 2;
    headYaw = Math.max(-1.2, Math.min(1.2, headYaw));
    if (P.head) P.head.rotation.set(-this.headPitch, headYaw, 0, 'YXZ');
    switch (this.type) {
      case 'pig': case 'cow': case 'sheep':
        P.legFR.rotation.x = sw;
        P.legBL.rotation.x = sw;
        P.legFL.rotation.x = -sw;
        P.legBR.rotation.x = -sw;
        if (this.type === 'sheep' && this.eatingGrass > 0) P.head.rotation.x = 0.9;
        break;
      case 'chicken': {
        P.legL.rotation.x = sw;
        P.legR.rotation.x = -sw;
        const flap = this.onGround ? 0 : Math.abs(Math.sin((this.age + partial) * 0.9)) * 1.2;
        P.wingL.rotation.z = -flap;
        P.wingR.rotation.z = flap;
        break;
      }
      case 'zombie': case 'skeleton': {
        P.rightLeg.rotation.x = sw;
        P.leftLeg.rotation.x = -sw;
        const aim = this.type === 'zombie' || (this.aiming > 0) || this.target;
        if (aim) {
          const swing = this.swingTicks > 0 ? Math.sin((this.swingTicks / 8) * Math.PI) * 0.4 : 0;
          P.rightArm.rotation.set(-Math.PI / 2 + headYaw * 0 - this.headPitch * 0.5 + swing, this.type === 'skeleton' ? -0.1 : 0, 0);
          P.leftArm.rotation.set(-Math.PI / 2 - this.headPitch * 0.5 + swing, this.type === 'skeleton' ? 0.4 : 0, 0);
        } else {
          P.rightArm.rotation.set(-sw * 0.8, 0, 0);
          P.leftArm.rotation.set(sw * 0.8, 0, 0);
        }
        if (this.swingTicks > 0) this.swingTicks--;
        break;
      }
      case 'spider':
        for (let i = 0; i < 4; i++) {
          const ph = Math.sin(limb * 0.6662 * 2 + (i % 2) * Math.PI) * 0.4 * amt;
          const lift = Math.abs(Math.cos(limb * 0.6662 + (i % 2) * Math.PI)) * 0.4 * amt;
          const spread = (i - 1.5) * 0.4;
          P['legL' + i].rotation.set(0, -spread + ph, -0.45 + lift, 'YXZ');
          P['legR' + i].rotation.set(0, spread - ph, 0.45 - lift, 'YXZ');
        }
        break;
      default:
        break;
    }
    // Death tilt
    if (this.health <= 0) {
      const t = Math.min(1, (this.deathTime + partial) / 20);
      this.model.inner.rotation.z = Math.sqrt(t) * Math.PI / 2;
    } else this.model.inner.rotation.z = 0;
    const [sky, blk] = this.lightAt();
    const u = this.model.material.uniforms;
    u.uLight.value.set(sky / 15, blk / 15);
    u.uHurt.value = this.hurtTime > 0 || this.health <= 0 ? 1 : 0;
    if (this.woolMat) {
      this.woolMat.uniforms.uLight.value.set(sky / 15, blk / 15);
      this.woolMat.uniforms.uHurt.value = u.uHurt.value;
    }
    if (this.fireTicks > 0 && this.age % 3 === 0) this.game.gfx.particles.emit('flame', this.x + (Math.random() - 0.5) * this.w, this.y + Math.random() * this.h, this.z + (Math.random() - 0.5) * this.w, { size: 0.12 });
  }
}

export function createMob(world, type, x, y, z, opts) {
  if (!MOB_TYPES[type]) return null;
  return new Mob(world, type, x, y, z, opts);
}
