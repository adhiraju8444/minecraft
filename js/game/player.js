import { Living } from '../entity/entity.js';
import { Inventory } from './inventory.js';
import { B, BLOCKS, isLiquid, isSolid } from '../data/blocks.js';
import { ITEMS, I } from '../data/items.js';
import { raycast, rayAABB, boxCollides, moveBox } from '../world/physics.js';
import { breakSpeed, blockDrops, xpForBlock, placeBlockFromItem, placeDoor, placeBed, toggleDoor, toggleGate, canHarvest } from './interact.js';
import { applyBoneMeal, canStay } from '../world/behaviors.js';
import { FACE_DIRS, FACING_DX, FACING_DZ } from '../world/constants.js';
import { createModel } from '../gfx/models.js';

export function xpToNext(level) {
  if (level >= 31) return 9 * level - 158;
  if (level >= 16) return 5 * level - 38;
  return 2 * level + 7;
}

export class Player extends Living {
  constructor(world, x, y, z) {
    super(world, x, y, z);
    this.setSize(0.6, 1.8);
    this.name = 'Player';
    this.isPlayer = true;
    this.inventory = new Inventory();
    this.mode = 'survival';
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.foodTimer = 0;
    this.xpLevel = 0;
    this.xpProgress = 0;
    this.xpTotal = 0;
    this.score = 0;
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;
    this.speed = 0.1;
    this.spawn = null; // bed spawn
    this.effects = {};
    this.swingTime = 0;
    this.swinging = false;
    this.pSwing = 0;
    this.mining = null;
    this.breakDelay = 0;
    this.useDelay = 0;
    this.using = null;
    this.lastForwardTap = -100;
    this.lastJumpTap = -100;
    this.prevForward = false;
    this.prevJump = false;
    this.hit = null;
    this.target = null; // entity in crosshair
    this.bob = 0;
    this.pBob = 0;
    this.walkDist = 0;
    this.pWalkDist = 0;
    this.sway = [0, 0];
    this.pSway = [0, 0];
    this.sleeping = null;
    this.sleepTimer = 0;
    this.hurtTilt = 0;
    this.deathTime = 0;
    this.lastDeathMessage = '';
    this.renderYaw = 0;
  }

  get creative() {
    return this.mode === 'creative';
  }

  get invulnerable() {
    return this.mode === 'creative' || this.mode === 'spectator';
  }

  eyeHeight() {
    if (this.sleeping) return 0.3;
    return this.sneaking ? 1.54 : 1.62;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'survival') this.flying = false;
    if (mode === 'spectator') this.flying = true;
    if (mode !== 'survival') {
      this.fireTicks = 0;
    }
  }

  // ---------------------------------------------------------------- movement
  move(dx, dy, dz) {
    if (this.mode === 'spectator') {
      this.box.offset(dx, dy, dz);
      this.syncFromBox();
      this.onGround = false;
      this.collidedH = false;
      return [dx, dy, dz];
    }
    if (this.sneaking && this.onGround && !this.flying) {
      // Do not walk off edges while sneaking.
      const step = 0.05;
      const test = (ox, oz) => boxCollides(this.world, this.box.clone().offset(ox, -1, oz));
      while (dx !== 0 && !test(dx, 0)) dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
      while (dz !== 0 && !test(0, dz)) dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
      while (dx !== 0 && dz !== 0 && !test(dx, dz)) {
        dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
        dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
      }
    }
    return super.move(dx, dy, dz);
  }

  moveSpeed(sprinting) {
    let s = this.speed * (sprinting ? 1.3 : 1);
    return s;
  }

  flySpeed() {
    return this.sprinting ? 0.1 : 0.05;
  }

  addExhaustion(n) {
    if (this.mode !== 'survival') return;
    this.exhaustion = Math.min(40, this.exhaustion + n);
  }

  tickInput(input) {
    const ctl = input.state;
    const tick = this.world.tickCount;
    let forward = 0, strafe = 0;
    if (!this.sleeping && this.game.ui.captureMovement()) {
      if (ctl.forward) forward += 1;
      if (ctl.back) forward -= 1;
      if (ctl.right) strafe += 1;
      if (ctl.left) strafe -= 1;
    }
    const jump = ctl.jump && this.game.ui.captureMovement() && !this.sleeping;
    const sneak = ctl.sneak && this.game.ui.captureMovement() && !this.sleeping;
    // Double-tap forward to sprint
    if (ctl.forward && !this.prevForward) {
      if (tick - this.lastForwardTap < 7) this.wantSprint = true;
      this.lastForwardTap = tick;
    }
    this.prevForward = ctl.forward;
    // Double-tap jump to fly (creative)
    if (jump && !this.prevJump) {
      if (this.mode === 'creative' && tick - this.lastJumpTap < 7) {
        this.flying = !this.flying;
        this.lastJumpTap = -100;
      } else this.lastJumpTap = tick;
    }
    this.prevJump = jump;

    this.sneaking = sneak && !this.flying;
    if (this.sneaking) {
      forward *= 0.3;
      strafe *= 0.3;
    }
    if (this.using) {
      forward *= 0.2;
      strafe *= 0.2;
    }
    const canSprint = (this.food > 6 || this.mode !== 'survival') && !this.sneaking && !this.using && forward >= 0.8;
    if (canSprint && (ctl.sprint || this.wantSprint)) this.sprinting = true;
    if (!canSprint || this.collidedH) {
      this.sprinting = false;
      this.wantSprint = false;
    }
    if (!ctl.forward) this.wantSprint = false;

    if (this.flying) {
      if (jump) this.vy += 0.15;
      if (ctl.sneak && this.game.ui.captureMovement()) this.vy -= 0.15;
    } else if (jump) {
      if (this.inWater || this.inLava) this.vy += 0.04;
      else if (this.onGround && this.jumpTicks === 0) {
        this.jump();
        this.jumpTicks = 10;
        this.addExhaustion(this.sprinting ? 0.2 : 0.05);
      }
    } else this.jumpTicks = 0;
    if (this.jumpTicks > 0) this.jumpTicks--;
    this.moveForward = forward;
    this.moveStrafe = strafe;
  }

  tick(input) {
    this.baseTick();
    this.pSwing = this.swingProgress(1);
    this.pBob = this.bob;
    this.pWalkDist = this.walkDist;
    this.pSway = this.sway.slice();
    if (this.hurtTilt > 0) this.hurtTilt--;
    if (this.mode === 'spectator') {
      this.inWater = false;
      this.inLava = false;
    }
    if (this.health <= 0) {
      this.deathTime++;
      return;
    }
    // In multiplayer the night only passes when everyone sleeps; sneak to get up.
    if (this.sleeping && this.game.net && input.state.sneak && this.sleepTimer > 10) this.wakeUp(false);
    if (this.sleeping) {
      this.tickSleep();
    }
    if (this.mode === 'survival') {
      if (!this.livingTick()) return;
    } else {
      if (this.hurtTime > 0) this.hurtTime--;
      if (this.invuln > 0) this.invuln--;
    }
    if (this.mode !== 'survival') this.air = 300;

    this.tickInput(input);
    const x0 = this.x, z0 = this.z, y0 = this.y;
    if (!this.sleeping) {
      if (this.flying && this.onGround && this.mode === 'creative') this.flying = false;
      this.travel(this.moveStrafe, this.moveForward, this.sprinting);
    }
    // Exhaustion from moving
    const dist = Math.hypot(this.x - x0, this.z - z0);
    if (this.sprinting) this.addExhaustion(0.1 * dist);
    if (this.inWater) this.addExhaustion(0.01 * Math.hypot(dist, this.y - y0));
    // View bob
    const horiz = this.onGround || this.inWater ? Math.min(0.1, dist) : 0;
    this.bob += (horiz - this.bob) * 0.4;
    this.walkDist += dist * 0.6;

    this.tickFood();
    this.tickEffects();
    this.tickInteraction(input);
    this.pickupNearby();
    if (this.swinging) {
      this.swingTime++;
      if (this.swingTime >= 6) {
        this.swingTime = 0;
        this.swinging = false;
      }
    }
    this.armorPoints = this.inventory.armorPoints();
  }

  // ---------------------------------------------------------------- survival
  tickFood() {
    if (this.mode !== 'survival') return;
    const diff = this.game.difficulty;
    if (diff === 0) {
      if (this.world.tickCount % 20 === 0 && this.health < this.maxHealth) this.heal(1);
      if (this.world.tickCount % 10 === 0 && this.food < 20) this.food++;
    }
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (diff > 0) this.food = Math.max(0, this.food - 1);
    }
    if (this.world.rules.naturalRegeneration !== false && this.food >= 18 && this.health < this.maxHealth) {
      this.foodTimer++;
      if (this.foodTimer >= 80) {
        this.heal(1);
        this.addExhaustion(3);
        this.foodTimer = 0;
      }
    } else if (this.food <= 0) {
      this.foodTimer++;
      if (this.foodTimer >= 80) {
        if (this.health > 10 || diff >= 3 || (this.health > 1 && diff === 2)) this.damage(1, { type: 'starve' });
        this.foodTimer = 0;
      }
    } else this.foodTimer = 0;
  }

  tickEffects() {
    for (const [k, v] of Object.entries(this.effects)) {
      if (k === 'hunger') this.addExhaustion(0.005);
      if (k === 'regeneration' && this.world.tickCount % 25 === 0) this.heal(1);
      if (v <= 1) delete this.effects[k];
      else this.effects[k] = v - 1;
    }
  }

  eat(def) {
    const f = def.food;
    this.food = Math.min(20, this.food + f.hunger);
    this.saturation = Math.min(this.food, this.saturation + f.hunger * f.sat * 2 / 2);
    if (f.hungerEffect && Math.random() < f.hungerEffect) this.effects.hunger = 600;
    if (f.regen) this.effects.regeneration = f.regen;
    if (f.milk) this.effects = {};
  }

  addXP(n) {
    if (n <= 0) return;
    this.score += n;
    this.xpTotal += n;
    let need = xpToNext(this.xpLevel);
    this.xpProgress += n / need;
    while (this.xpProgress >= 1) {
      this.xpProgress = (this.xpProgress - 1) * need;
      this.xpLevel++;
      need = xpToNext(this.xpLevel);
      this.xpProgress /= need;
      if (this.xpLevel % 5 === 0) this.game.audio.play('levelup');
    }
  }

  damage(amount, source = {}) {
    if (this.mode !== 'survival' && source.type !== 'void') return false;
    if (this.sleeping) this.wakeUp(false);
    const diff = this.game.difficulty;
    if (source.type === 'mob' || source.type === 'arrow') {
      if (diff === 0) return false;
      if (diff === 1) amount = Math.min(amount / 2 + 1, amount);
      if (diff === 3) amount *= 1.5;
    }
    const before = this.health;
    const r = super.damage(amount, source);
    if (r) {
      this.addExhaustion(0.1);
      this.damageArmor(amount, source);
      if (this.health < before) {
        this.hurtTilt = 10;
        this.game.audio.play('hurt');
      }
    }
    return r;
  }

  damageArmor(amount, source) {
    if (!['mob', 'player', 'arrow', 'explosion'].includes(source.type)) return;
    const loss = Math.max(1, Math.floor(amount / 4));
    this.inventory.armor.forEach((s, i) => {
      if (!s) return;
      s.dmg = (s.dmg || 0) + loss;
      if (s.dmg >= ITEMS[s.id].durability) {
        this.inventory.armor[i] = null;
        this.game.audio.play('break_tool');
      }
    });
    this.inventory.changed();
  }

  onDeath(source) {
    this.lastDeathMessage = deathMessage(this.name, source);
    this.game.onPlayerDeath(source);
  }

  outOfWorld() {
    if (this.mode === 'spectator' || this.mode === 'creative') {
      if (this.y < -80) this.teleport(this.x, 130, this.z);
      return;
    }
    this.damage(4, { type: 'void' });
  }

  // ---------------------------------------------------------------- interaction
  reach() {
    return this.mode === 'creative' ? 5 : 4.5;
  }

  lookDir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  eyePos() {
    return [this.x, this.y + this.eyeHeight(), this.z];
  }

  updateTarget() {
    const [ox, oy, oz] = this.eyePos();
    const [dx, dy, dz] = this.lookDir();
    const reach = this.reach();
    this.hit = this.mode === 'spectator' ? null : raycast(this.world, ox, oy, oz, dx, dy, dz, reach);
    // Entities in the crosshair (closer than the block hit)
    let best = null, bestT = this.hit ? this.hit.t : reach;
    if (this.mode !== 'spectator') {
      const er = this.mode === 'creative' ? 5 : 3;
      bestT = Math.min(bestT, er);
      for (const e of this.world.entities) {
        if (!e.targetable || e.dead || (e.health !== undefined && e.health <= 0)) continue;
        if (e.distanceSq(ox, oy, oz) > 64) continue;
        const r = rayAABB(ox, oy, oz, dx, dy, dz, e.box.grow(0.1, 0.1, 0.1), bestT);
        if (r && r.t < bestT) {
          bestT = r.t;
          best = e;
        }
      }
    }
    this.target = best;
    if (best && this.hit && this.hit.t > bestT) this.hit = null;
  }

  swing() {
    if (!this.swinging || this.swingTime >= 3) {
      this.swingTime = 0;
      this.swinging = true;
    }
  }

  swingProgress(partial) {
    if (!this.swinging) return 0;
    return Math.min(1, (this.swingTime + partial) / 6);
  }

  tickInteraction(input) {
    const game = this.game;
    if (this.breakDelay > 0) this.breakDelay--;
    if (this.useDelay > 0) this.useDelay--;
    this.updateTarget();
    const canAct = game.ui.captureMovement() && !this.sleeping && this.mode !== 'spectator';
    const st = input.state;

    // ---- Attack / mine
    if (canAct && input.consume('attack')) {
      this.swing();
      if (this.target) this.attack(this.target);
      else if (this.hit) this.startMining(this.hit);
    }
    if (canAct && st.attack && this.hit && !this.target) this.continueMining(this.hit);
    else if (this.mining) {
      this.mining = null;
      game.gfx.setCrack(-1);
    }

    // ---- Use
    const usePressed = canAct && input.consume('use');
    if (this.using) {
      this.tickUsing(canAct && st.use);
    } else if (canAct && (usePressed || (st.use && this.useDelay === 0))) {
      if (this.useDelay === 0 || usePressed) {
        this.useDelay = 4;
        this.useAction(usePressed);
      }
    }

    // ---- Pick block
    if (canAct && input.consume('pick') && this.hit) this.pickBlock(this.hit);
  }

  startMining(hit) {
    const world = this.world;
    // Punching fire out
    const n = FACE_DIRS[hit.face];
    if (world.getBlock(hit.x + n[0], hit.y + n[1], hit.z + n[2]) === B.fire) {
      world.setBlock(hit.x + n[0], hit.y + n[1], hit.z + n[2], 0, 0);
      this.game.audio.play('fizz', { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 });
      return;
    }
    if (this.mode === 'creative') {
      const held = this.inventory.selectedStack();
      if (held && ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword') return;
      this.breakBlock(hit.x, hit.y, hit.z);
      this.breakDelay = 5;
      return;
    }
    this.mining = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, progress: 0, ticks: 0 };
    const sp = breakSpeed(this, hit.id);
    if (sp >= 1) {
      this.breakBlock(hit.x, hit.y, hit.z);
      this.mining = null;
      this.breakDelay = 0;
    }
  }

  continueMining(hit) {
    const game = this.game;
    if (this.breakDelay > 0) return;
    if (this.mode === 'creative') {
      const held = this.inventory.selectedStack();
      if (held && ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword') return;
      this.breakBlock(hit.x, hit.y, hit.z);
      this.breakDelay = 5;
      this.swing();
      return;
    }
    const m = this.mining;
    if (!m || m.x !== hit.x || m.y !== hit.y || m.z !== hit.z || m.id !== hit.id) {
      this.mining = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, progress: 0, ticks: 0 };
      return;
    }
    const sp = breakSpeed(this, hit.id);
    m.progress += sp;
    m.ticks++;
    this.swing();
    if (m.ticks % 4 === 0) {
      game.audio.blockSound(BLOCKS[hit.id].sound, 'hit', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      game.gfx.particles.blockHit(hit);
    }
    game.gfx.setCrack(Math.floor(m.progress * 10));
    if (m.progress >= 1) {
      this.breakBlock(hit.x, hit.y, hit.z);
      this.mining = null;
      this.breakDelay = 5;
      game.gfx.setCrack(-1);
    }
  }

  breakBlock(x, y, z) {
    const world = this.world;
    const game = this.game;
    const id = world.getBlock(x, y, z);
    const meta = world.getMeta(x, y, z);
    const b = BLOCKS[id];
    if (!b || id === 0 || (b.hardness < 0 && this.mode !== 'creative')) return;
    const held = this.inventory.selectedStack();
    // Chests and furnaces spill their contents (handled in onRemove).
    world.setBlock(x, y, z, 0, 0);
    game.gfx.particles.blockBreak(x, y, z, id, meta);
    game.audio.blockSound(b.sound, 'break', x + 0.5, y + 0.5, z + 0.5);
    if (this.mode === 'survival') {
      for (const s of blockDrops(id, meta, held)) game.dropItem(x + 0.5, y + 0.3, z + 0.5, s);
      const xp = xpForBlock(id);
      if (xp > 0 && canHarvest(id, held)) game.spawnXP(x + 0.5, y + 0.5, z + 0.5, xp);
      this.addExhaustion(0.005);
      if (held && b.hardness > 0) this.damageHeld(ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword' ? 2 : 1);
      // Ice leaves water behind
      if (id === B.ice) {
        const below = world.getBlock(x, y - 1, z);
        if (isSolid[below] || isLiquid[below]) world.setBlock(x, y, z, B.water, 0);
      }
    }
  }

  damageHeld(n) {
    const s = this.inventory.selectedStack();
    if (!s || this.mode !== 'survival') return;
    const d = ITEMS[s.id];
    if (!d.durability) return;
    s.dmg = (s.dmg || 0) + n;
    if (s.dmg >= d.durability) {
      this.inventory.setSelected(null);
      this.game.audio.play('break_tool');
      this.game.gfx.particles.emit('poof', this.x, this.y + 1.2, this.z);
    }
    this.inventory.changed();
  }

  attack(e) {
    const game = this.game;
    const held = this.inventory.selectedStack();
    const def = held ? ITEMS[held.id] : null;
    let dmg = def ? def.damage : 1;
    const crit = this.fallDistance > 0 && !this.onGround && !this.onLadder() && !this.inWater;
    if (crit) dmg *= 1.5;
    this.addExhaustion(0.1);
    if (e.onPlayerAttack) {
      const ok = e.onPlayerAttack(this, dmg, crit);
      if (ok) {
        if (crit) for (let i = 0; i < 12; i++) game.gfx.particles.emit('crit', e.x, e.y + e.h * 0.6, e.z);
        const kb = 0.4 + (this.sprinting ? 0.5 : 0);
        if (e.knockback) e.knockback(this.x, this.z, kb);
        if (this.sprinting) {
          this.vx *= 0.6;
          this.vz *= 0.6;
          this.sprinting = false;
        }
        if (def && def.tool) this.damageHeld(def.tool.type === 'sword' ? 1 : 2);
      }
    }
  }

  pickBlock(hit) {
    const id = hit.id;
    let itemId = id;
    const b = BLOCKS[id];
    if (b.noItem) {
      const map = { [B.wheat]: I.wheat_seeds, [B.carrots]: I.carrot, [B.potatoes]: I.potato, [B.oak_door]: I.oak_door, [B.red_bed]: I.red_bed, [B.lit_furnace]: B.furnace, [B.farmland]: B.dirt };
      itemId = map[id];
      if (itemId === undefined) return;
    }
    const inv = this.inventory;
    for (let i = 0; i < 9; i++) {
      if (inv.slots[i] && inv.slots[i].id === itemId) {
        inv.selected = i;
        inv.changed();
        return;
      }
    }
    if (this.mode === 'creative') {
      let slot = inv.selected;
      for (let i = 0; i < 9; i++) if (!inv.slots[i]) { slot = i; break; }
      inv.slots[slot] = { id: itemId, count: ITEMS[itemId].maxStack, dmg: 0 };
      inv.selected = slot;
      inv.changed();
      return;
    }
    const at = inv.findSlot(itemId);
    if (at >= 9) {
      const tmp = inv.slots[inv.selected];
      inv.slots[inv.selected] = inv.slots[at];
      inv.slots[at] = tmp;
      inv.changed();
    }
  }

  useAction(pressed) {
    const game = this.game;
    const world = this.world;
    const stack = this.inventory.selectedStack();
    const def = stack ? ITEMS[stack.id] : null;

    // 1. Entity interaction
    if (this.target) {
      if (this.target.onInteract && this.target.onInteract(this, stack)) {
        this.swing();
        return;
      }
    }
    const hit = this.hit;
    // 2. Block interaction
    if (hit && (!this.sneaking || !stack)) {
      if (this.interactBlock(hit, pressed)) return;
    }
    // 3. Item on block
    if (stack && hit) {
      if (def.use === 'door') { if (placeDoor(game, this, hit, stack)) return; }
      else if (def.use === 'bed') { if (placeBed(game, this, hit, stack)) return; }
      else if (def.use === 'hoe') {
        if (hit.face !== 3) {
          const id = hit.id;
          if ((id === B.grass_block || id === B.dirt) && world.getBlock(hit.x, hit.y + 1, hit.z) === 0) {
            world.setBlock(hit.x, hit.y, hit.z, B.farmland, 0);
            game.audio.blockSound('gravel', 'place', hit.x + 0.5, hit.y + 1, hit.z + 0.5);
            this.damageHeld(1);
            this.swing();
            return;
          }
        }
      } else if (def.use === 'bone_meal') {
        if (applyBoneMeal(world, hit.x, hit.y, hit.z)) {
          for (let i = 0; i < 8; i++) game.gfx.particles.emit('heart', hit.x + Math.random(), hit.y + 0.6 + Math.random() * 0.5, hit.z + Math.random(), { r: 0.4, g: 1, b: 0.4, size: 0.06 });
          this.consumeSelected(1);
          this.swing();
          return;
        }
      } else if (def.use === 'ignite') {
        if (world.getBlock(hit.x, hit.y, hit.z) === B.tnt) {
          world.setBlock(hit.x, hit.y, hit.z, 0, 0);
          game.primeTNT(hit.x, hit.y, hit.z, 80);
          this.damageHeld(1);
          this.swing();
          return;
        }
        const n = FACE_DIRS[hit.face];
        const fx = hit.x + n[0], fy = hit.y + n[1], fz = hit.z + n[2];
        if (world.getBlock(fx, fy, fz) === 0 && canStay(world, fx, fy, fz, B.fire, 0)) {
          world.setBlock(fx, fy, fz, B.fire, 0);
          game.audio.play('ignite', { x: fx + 0.5, y: fy + 0.5, z: fz + 0.5 });
          this.damageHeld(1);
          this.swing();
          return;
        }
      } else if (def.use === 'plant') {
        if (hit.face === 2 && world.getBlock(hit.x, hit.y, hit.z) === B.farmland && world.getBlock(hit.x, hit.y + 1, hit.z) === 0) {
          if (placeBlockFromItem(game, this, hit, stack)) return;
        }
      } else if (def.block) {
        if (placeBlockFromItem(game, this, hit, stack)) return;
      }
    }
    // 4. Item in the air (or on a block that didn't take it)
    if (!stack || !pressed) return;
    if (def.use === 'bucket') {
      this.useBucket(stack, def);
      return;
    }
    if (def.armor) {
      const slot = def.armor.slot;
      if (!this.inventory.armor[slot]) {
        this.inventory.armor[slot] = stack;
        this.inventory.setSelected(null);
        game.audio.play('equip');
        return;
      }
    }
    if (def.food) {
      if (this.food < 20 || def.food.always || this.mode === 'creative') {
        this.using = { kind: 'eat', id: stack.id, ticks: 0, duration: 32, slot: this.inventory.selected };
      }
      return;
    }
    if (def.use === 'bow') {
      if (this.mode === 'creative' || this.inventory.count(I.arrow) > 0) this.using = { kind: 'bow', id: stack.id, ticks: 0, slot: this.inventory.selected };
      return;
    }
    if (def.use === 'throw') {
      game.throwItem(this, def.name);
      this.consumeSelected(1);
      this.swing();
      game.audio.play('throw', { x: this.x, y: this.y + 1.5, z: this.z });
    }
  }

  consumeSelected(n) {
    if (this.mode === 'creative') return;
    const s = this.inventory.selectedStack();
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.inventory.setSelected(null);
    this.inventory.changed();
  }

  // Replace the held item (e.g. bucket -> water bucket), keeping stacks sane.
  exchangeHeld(newName) {
    const s = this.inventory.selectedStack();
    const nid = I[newName];
    if (this.mode === 'creative') {
      if (this.inventory.count(nid) === 0) this.inventory.add({ id: nid, count: 1, dmg: 0 });
      return;
    }
    if (s.count === 1) {
      this.inventory.setSelected({ id: nid, count: 1, dmg: 0 });
    } else {
      s.count--;
      const left = this.inventory.add({ id: nid, count: 1, dmg: 0 });
      if (left) this.game.dropItem(this.x, this.y + 1.2, this.z, { id: nid, count: 1, dmg: 0 }, this);
      this.inventory.changed();
    }
  }

  useBucket(stack, def) {
    const world = this.world;
    const game = this.game;
    const [ox, oy, oz] = this.eyePos();
    const [dx, dy, dz] = this.lookDir();
    if (!def.fluid && def.name === 'bucket') {
      const h = raycast(world, ox, oy, oz, dx, dy, dz, this.reach(), { liquids: true });
      if (!h || !isLiquid[h.id] || h.meta !== 0) return;
      world.setBlock(h.x, h.y, h.z, 0, 0);
      this.exchangeHeld(h.id === B.water ? 'water_bucket' : 'lava_bucket');
      game.audio.play(h.id === B.water ? 'bucket_fill' : 'bucket_fill_lava', { x: h.x + 0.5, y: h.y + 0.5, z: h.z + 0.5 });
      this.swing();
      return;
    }
    if (def.name === 'milk_bucket') return;
    const h = raycast(world, ox, oy, oz, dx, dy, dz, this.reach(), { liquids: true, anyLiquid: true });
    if (!h) return;
    let x = h.x, y = h.y, z = h.z;
    const target = world.getBlock(x, y, z);
    if (!(BLOCKS[target].replaceable)) {
      const n = FACE_DIRS[h.face];
      x += n[0]; y += n[1]; z += n[2];
    }
    const cur = world.getBlock(x, y, z);
    if (cur !== 0 && !BLOCKS[cur].replaceable) return;
    const fluid = def.fluid === 'water' ? B.water : B.lava;
    if (cur !== 0 && !isLiquid[cur]) game.dropBlockItems(x, y, z, cur, world.getMeta(x, y, z));
    world.setBlock(x, y, z, fluid, 0);
    game.audio.play(fluid === B.water ? 'bucket_empty' : 'bucket_empty_lava', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    if (this.mode !== 'creative') this.inventory.setSelected({ id: I.bucket, count: 1, dmg: 0 });
    this.swing();
  }

  tickUsing(held) {
    const u = this.using;
    const stack = this.inventory.selectedStack();
    const game = this.game;
    if (!stack || stack.id !== u.id || this.inventory.selected !== u.slot) {
      this.using = null;
      return;
    }
    u.ticks++;
    if (u.kind === 'eat') {
      if (!held) {
        this.using = null;
        return;
      }
      if (u.ticks > 7 && u.ticks % 4 === 0) {
        game.audio.play(ITEMS[u.id].use === 'drink' ? 'drink' : 'eat');
        game.eatParticles(this, u.id);
      }
      if (u.ticks >= u.duration) {
        const def = ITEMS[u.id];
        this.eat(def);
        if (this.mode !== 'creative') {
          if (def.food.returns) this.inventory.setSelected({ id: I[def.food.returns], count: 1, dmg: 0 });
          else this.consumeSelected(1);
        }
        game.audio.play('burp');
        this.using = null;
      }
    } else if (u.kind === 'bow') {
      if (!held) {
        const t = u.ticks;
        let f = t / 20;
        f = (f * f + f * 2) / 3;
        if (f > 1) f = 1;
        this.using = null;
        if (f < 0.1) return;
        game.shootArrow(this, f * 3, f >= 1);
        if (this.mode !== 'creative') this.inventory.consume(I.arrow, 1);
        this.damageHeld(1);
        game.audio.play('bow', { x: this.x, y: this.y + 1.5, z: this.z });
      }
    }
  }

  useAnim(partial) {
    const u = this.using;
    if (!u) return null;
    const t = u.ticks + partial;
    if (u.kind === 'eat') return { kind: 'eat', t: t / 20 };
    if (u.kind === 'bow') {
      let f = t / 20;
      f = Math.min(1, (f * f + f * 2) / 3);
      return { kind: 'bow', pull: f };
    }
    return null;
  }

  interactBlock(hit, pressed) {
    const game = this.game;
    const world = this.world;
    const b = BLOCKS[hit.id];
    if (!b || !b.use || !pressed) return false;
    switch (b.use) {
      case 'crafting':
        game.ui.openCrafting();
        return true;
      case 'furnace':
        game.ui.openFurnace(world.getTileEntity(hit.x, hit.y, hit.z));
        return true;
      case 'chest': {
        const above = world.getBlock(hit.x, hit.y + 1, hit.z);
        if (BLOCKS[above] && BLOCKS[above].opaque && BLOCKS[above].shape === 'cube') return true;
        game.ui.openChest(world.getTileEntity(hit.x, hit.y, hit.z));
        game.audio.play('chest_open', { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 });
        return true;
      }
      case 'door':
        this.swing();
        return toggleDoor(game, hit.x, hit.y, hit.z);
      case 'gate':
        this.swing();
        return toggleGate(game, this, hit.x, hit.y, hit.z);
      case 'bed':
        this.trySleep(hit);
        return true;
      case 'tnt':
        return false;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- sleeping
  trySleep(hit) {
    const game = this.game;
    const world = this.world;
    let { x, y, z } = hit;
    const meta = world.getMeta(x, y, z);
    if (!(meta & 4)) {
      x += FACING_DX[meta & 3];
      z += FACING_DZ[meta & 3];
    }
    if (Math.hypot(this.x - x - 0.5, this.z - z - 0.5) > 3 || Math.abs(this.y - y) > 2) {
      game.ui.message('You are too far away to use that bed');
      return;
    }
    if (!world.isNight() && !world.weather.raining) {
      this.spawn = { x: x + 0.5, y: y + 0.6, z: z + 0.5 };
      game.ui.message('Respawn point set');
      return;
    }
    const near = world.entities.some((e) => e.hostile && e.alive && Math.abs(e.x - this.x) < 8 && Math.abs(e.z - this.z) < 8 && Math.abs(e.y - this.y) < 5);
    if (near) {
      game.ui.message('You may not rest now; there are monsters nearby');
      return;
    }
    this.spawn = { x: x + 0.5, y: y + 0.6, z: z + 0.5 };
    this.sleeping = { x, y, z, f: world.getMeta(x, y, z) & 3 };
    this.sleepTimer = 0;
    if (game.net) game.ui.message('Sneak to get out of bed');
    this.teleport(x + 0.5, y + 0.5625, z + 0.5);
    this.vx = this.vy = this.vz = 0;
  }

  tickSleep() {
    this.sleepTimer++;
    this.vx = this.vy = this.vz = 0;
    // In multiplayer the server skips the night once everyone is asleep.
    if (this.sleepTimer >= 100 && !this.game.net) {
      const world = this.world;
      world.time = 0;
      world.day++;
      world.weather.raining = false;
      world.weather.strength = 0;
      this.wakeUp(true);
    }
  }

  wakeUp(skipped) {
    const s = this.sleeping;
    if (!s) return;
    this.sleeping = null;
    this.sleepTimer = 0;
    // Stand up next to the bed.
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const x = s.x + dx, z = s.z + dz;
      for (const dy of [0, 1, -1]) {
        const y = s.y + dy;
        const box = this.box.clone();
        box.set(x + 0.5, y + 0.6, z + 0.5, this.w, this.h);
        if (!boxCollides(this.world, box)) {
          this.teleport(x + 0.5, y + 0.6, z + 0.5);
          if (skipped) this.game.ui.message('Good morning!');
          return;
        }
      }
    }
    this.teleport(s.x + 0.5, s.y + 1.2, s.z + 0.5);
  }

  // ---------------------------------------------------------------- pickup
  pickupNearby() {
    // In multiplayer the server decides who picks what up.
    if (this.health <= 0 || this.mode === 'spectator' || this.game.net) return;
    const box = this.box.grow(1, 0.5, 1);
    for (const e of this.world.entities) {
      if (e.dead || !e.pickup) continue;
      if (!box.intersects(e.box)) continue;
      e.pickup(this);
    }
  }

  // ---------------------------------------------------------------- camera
  bobAmount(partial) {
    return this.pBob + (this.bob - this.pBob) * partial;
  }

  walkPhase(partial) {
    return this.pWalkDist + (this.walkDist - this.pWalkDist) * partial;
  }

  handSway(partial) {
    return [this.pSway[0] + (this.sway[0] - this.pSway[0]) * partial, this.pSway[1] + (this.sway[1] - this.pSway[1]) * partial];
  }

  // ---------------------------------------------------------------- model
  createMesh(gfx) {
    this.model = createModel('player');
    this.mesh = this.model.root;
    gfx.entityGroup.add(this.mesh);
  }

  updateMesh(partial, visible) {
    if (!this.mesh) return;
    this.mesh.visible = !!visible;
    if (!visible) return;
    const [x, y, z] = this.lerpPos(partial);
    this.mesh.position.set(x, y, z);
    const yaw = this.renderYaw;
    const P = this.model.parts;
    if (this.sleeping) {
      this.mesh.rotation.set(0, 0, 0);
      this.model.inner.rotation.set(-Math.PI / 2, [Math.PI, Math.PI / 2, 0, -Math.PI / 2][this.sleeping.f], 0, 'YXZ');
      this.model.inner.position.set(0, 0.3, 0);
    } else {
      this.model.inner.rotation.set(0, 0, 0);
      this.model.inner.position.set(0, 0, 0);
      this.mesh.rotation.set(0, yaw + Math.PI, 0);
    }
    const limb = this.limbSwing - this.limbAmount * (1 - partial);
    const amt = this.pLimbAmount + (this.limbAmount - this.pLimbAmount) * partial;
    const sw = Math.sin(limb * 0.6662) * 1.2 * amt;
    P.rightLeg.rotation.x = sw;
    P.leftLeg.rotation.x = -sw;
    P.rightArm.rotation.x = -sw * 0.8;
    P.leftArm.rotation.x = sw * 0.8;
    const swing = this.swingProgress(partial);
    if (swing > 0) P.rightArm.rotation.x = -Math.sin(swing * Math.PI) * 1.6;
    let headYaw = this.yaw - yaw;
    while (headYaw > Math.PI) headYaw -= Math.PI * 2;
    while (headYaw < -Math.PI) headYaw += Math.PI * 2;
    P.head.rotation.set(-this.pitch, headYaw, 0, 'YXZ');
    if (this.sneaking) {
      P.body.rotation.x = 0.5;
      P.head.position.y = 22 / 16;
    } else {
      P.body.rotation.x = 0;
      P.head.position.y = 24 / 16;
    }
    const [sky, blk] = this.lightAt();
    this.model.material.uniforms.uLight.value.set(sky / 15, blk / 15);
    this.model.material.uniforms.uHurt.value = this.hurtTime > 0 || this.health <= 0 ? 1 : 0;
  }
}

export function deathMessage(name, source = {}) {
  const e = source.entity;
  const by = e && e.displayName ? e.displayName : null;
  if (by && e.isPlayer) {
    if (source.type === 'arrow') return `${name} was shot by ${by}`;
    if (source.type === 'player' || source.type === 'mob') return `${name} was slain by ${by}`;
  }
  switch (source.type) {
    case 'fall': return `${name} hit the ground too hard`;
    case 'lava': return `${name} tried to swim in lava`;
    case 'fire': return `${name} went up in flames`;
    case 'drown': return `${name} ran out of air`;
    case 'starve': return `${name} starved`;
    case 'void': return `${name} fell out of the world`;
    case 'cactus': return `${name} hugged a cactus`;
    case 'suffocate': return `${name} got stuck inside a wall`;
    case 'explosion': return `${name} was caught in an explosion`;
    case 'arrow': return by ? `${name} was shot by a ${by}` : `${name} was shot`;
    case 'mob': return by ? `${name} was defeated by a ${by}` : `${name} was defeated`;
    case 'player': return by ? `${name} was slain by ${by}` : `${name} was slain`;
    case 'kill': return `${name} left this world`;
    default: return `${name} died`;
  }
}
