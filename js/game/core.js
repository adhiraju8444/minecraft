// World-event logic shared by the browser game and the multiplayer server:
// spawning drops and experience, falling blocks, TNT, projectiles and
// explosions. Subclasses provide `world`, `audio`, `gfx`, `difficulty` and
// the list of players.
import { ItemEntity, XPOrb, FallingBlock, PrimedTNT, Projectile } from '../entity/objects.js';
import { createMob } from '../entity/mobs.js';
import { naturalDrops } from './interact.js';
import { B, BLOCKS } from '../data/blocks.js';
import { raycast } from '../world/physics.js';

export const XP_SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];

export class GameCore {
  // Everyone who can be targeted, hurt or pick things up.
  get players() {
    return this.player ? [this.player] : [];
  }

  // Closest player matching `filter` within maxDist (blocks), or null.
  nearestPlayer(x, y, z, maxDist = Infinity, filter = null) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const p of this.players) {
      if (!p || (filter && !filter(p))) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  addEntity(e) {
    this.world.entities.push(e);
    return e;
  }

  spawnMob(type, x, y, z, opts = {}) {
    const m = createMob(this.world, type, x, y, z, opts);
    if (m) this.addEntity(m);
    return m;
  }

  // Drop a stack. A thrower (anything with lookDir()) tosses it forward.
  dropItem(x, y, z, stack, thrower = null, toss = false) {
    if (!stack || stack.count <= 0) return null;
    const e = new ItemEntity(this.world, x, y, z, { ...stack });
    if (thrower) {
      const [dx, dy, dz] = thrower.lookDir();
      e.vx = dx * 0.3 + (Math.random() - 0.5) * 0.04;
      e.vy = dy * 0.3 + 0.1;
      e.vz = dz * 0.3 + (Math.random() - 0.5) * 0.04;
      e.pickupDelay = 40;
    } else if (toss) {
      e.vy = 0.3;
    }
    return this.addEntity(e);
  }

  // Drop with an explicit velocity (used for items players throw over the network).
  dropItemWithVelocity(x, y, z, stack, vx, vy, vz, pickupDelay = 40) {
    if (!stack || stack.count <= 0) return null;
    const e = new ItemEntity(this.world, x, y, z, { ...stack });
    e.vx = vx;
    e.vy = vy;
    e.vz = vz;
    e.pickupDelay = pickupDelay;
    return this.addEntity(e);
  }

  dropBlockItems(x, y, z, id, meta) {
    for (const s of naturalDrops(id, meta)) this.dropItem(x + 0.5, y + 0.3, z + 0.5, s);
  }

  spawnXP(x, y, z, amount) {
    while (amount > 0) {
      const v = XP_SIZES.find((s) => s <= amount) || 1;
      amount -= v;
      this.addEntity(new XPOrb(this.world, x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5, v));
    }
  }

  spawnFallingBlock(x, y, z, id, meta) {
    this.addEntity(new FallingBlock(this.world, x, y, z, id, meta));
  }

  primeTNT(x, y, z, fuse) {
    this.addEntity(new PrimedTNT(this.world, x, y, z, fuse));
    this.audio.play('fuse', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  }

  fizz(x, y, z) {
    this.audio.play('fizz', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    for (let i = 0; i < 8; i++) this.gfx.particles.emit('smoke', x + Math.random(), y + 1, z + Math.random(), { r: 0.6, g: 0.6, b: 0.6 });
  }

  onSplash(e) {
    this.audio.play('splash', { x: e.x, y: e.y, z: e.z });
    for (let i = 0; i < 12; i++) this.gfx.particles.emit('splash', e.x + (Math.random() - 0.5) * e.w, e.y + 0.2, e.z + (Math.random() - 0.5) * e.w);
  }

  // A crumb of an item's sprite as a particle. Visual only; the browser overrides it.
  itemCrumb() {}

  spawnProjectile(shooter, x, y, z, vx, vy, vz, kind, crit = false) {
    const p = new Projectile(this.world, shooter, x, y, z, vx, vy, vz, kind);
    p.crit = !!crit;
    return this.addEntity(p);
  }

  throwItem(p, kind) {
    const [dx, dy, dz] = p.lookDir();
    this.spawnProjectile(p, p.x + dx * 0.4, p.y + p.eyeHeight() - 0.1, p.z + dz * 0.4, dx * 1.5 + p.vx, dy * 1.5, dz * 1.5 + p.vz, kind);
  }

  shootArrow(p, speed, crit) {
    const [dx, dy, dz] = p.lookDir();
    this.spawnProjectile(p, p.x + dx * 0.4, p.y + p.eyeHeight() - 0.1, p.z + dz * 0.4,
      dx * speed + p.vx, dy * speed + (p.onGround ? 0 : p.vy), dz * speed + p.vz, 'arrow', crit);
  }

  mobShoot(mob, target) {
    const sx = mob.x, sy = mob.y + mob.eyeHeight() - 0.1, sz = mob.z;
    const dx = target.x - sx, dz = target.z - sz;
    const dy = target.y + target.h / 3 - sy;
    const h = Math.hypot(dx, dz) || 1;
    const vy = dy + h * 0.2;
    const len = Math.hypot(dx, vy, dz) || 1;
    const speed = 1.6;
    const spread = (14 - this.difficulty * 4) * 0.0075;
    const a = this.spawnProjectile(mob, sx + (dx / h) * 0.5, sy, sz + (dz / h) * 0.5,
      (dx / len + (Math.random() - 0.5) * spread) * speed, (vy / len + (Math.random() - 0.5) * spread) * speed, (dz / len + (Math.random() - 0.5) * spread) * speed, 'arrow');
    a.damageBase = 2 + this.difficulty * 0.11 + Math.random() * 0.5;
    this.audio.play('bow', { x: sx, y: sy, z: sz });
  }

  explode(x, y, z, power, source) {
    const world = this.world;
    const affected = new Map();
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
      if (!(i === 0 || i === 15 || j === 0 || j === 15 || k === 0 || k === 15)) continue;
      let dx = (i / 15) * 2 - 1, dy = (j / 15) * 2 - 1, dz = (k / 15) * 2 - 1;
      const l = Math.hypot(dx, dy, dz);
      dx /= l; dy /= l; dz /= l;
      let f = power * (0.7 + Math.random() * 0.6);
      let px = x, py = y, pz = z;
      while (f > 0) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
        const id = world.getBlock(bx, by, bz);
        if (id !== 0 && id !== 255) {
          f -= (BLOCKS[id].blast / 5 + 0.3) * 0.3;
          if (f > 0) affected.set(`${bx},${by},${bz}`, [bx, by, bz]);
        }
        px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
        f -= 0.225;
      }
    }
    // Hurt and push entities
    const radius = power * 2;
    const ents = [...this.players, ...world.entities];
    for (const e of ents) {
      if (!e || e.dead || e === source) continue;
      if (e.isPlayer && e.mode === 'spectator') continue;
      const d = Math.hypot(e.x - x, e.y + e.h / 2 - y, e.z - z) / radius;
      if (d > 1) continue;
      const ex = e.x - x, ey = e.y + (e.eyeHeight ? e.eyeHeight() : e.h / 2) - y, ez = e.z - z;
      const el = Math.hypot(ex, ey, ez) || 1;
      // Exposure: fraction of rays from the explosion that reach the entity.
      let seen = 0, total = 0;
      for (const oy of [0.1, 0.5, 0.9]) for (const ox of [-0.3, 0.3]) {
        total++;
        const tx = e.x + ox * e.w, ty = e.y + oy * e.h, tz = e.z;
        const vx = tx - x, vy = ty - y, vz = tz - z;
        const vl = Math.hypot(vx, vy, vz) || 1;
        if (!raycast(world, x, y, z, vx / vl, vy / vl, vz / vl, vl)) seen++;
      }
      const impact = (1 - d) * (seen / total);
      const dmg = Math.floor(((impact * impact + impact) / 2) * 7 * radius + 1);
      if (e.damage) e.damage(dmg, { type: 'explosion', entity: source });
      if (!(e instanceof PrimedTNT)) {
        const px = (ex / el) * impact, py = (ey / el) * impact, pz = (ez / el) * impact;
        if (e.push) e.push(px, py, pz);
        else {
          e.vx += px;
          e.vy += py;
          e.vz += pz;
        }
      }
    }
    // Destroy blocks
    for (const [bx, by, bz] of affected.values()) {
      const id = world.getBlock(bx, by, bz);
      if (id === 0 || id === 255 || BLOCKS[id].hardness < 0) continue;
      if (id === B.tnt) {
        world.setBlock(bx, by, bz, 0, 0);
        this.addEntity(new PrimedTNT(world, bx, by, bz, 10 + Math.floor(Math.random() * 20)));
        continue;
      }
      const meta = world.getMeta(bx, by, bz);
      world.setBlock(bx, by, bz, 0, 0);
      if (Math.random() < 1 / power) for (const s of naturalDrops(id, meta)) this.dropItem(bx + 0.5, by + 0.5, bz + 0.5, s);
    }
    this.audio.play('explode', { x, y, z, range: 48 });
    for (let i = 0; i < 40; i++) this.gfx.particles.emit('poof', x + (Math.random() - 0.5) * power * 1.5, y + (Math.random() - 0.5) * power * 1.5, z + (Math.random() - 0.5) * power * 1.5, { size: 0.4 + Math.random() * 0.4, r: 0.85, g: 0.85, b: 0.85 });
    for (let i = 0; i < 12; i++) this.gfx.particles.emit('flame', x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, z + (Math.random() - 0.5) * 2, { size: 0.3, vy: 0.05 });
    this.afterExplosion?.(x, y, z);
  }
}
