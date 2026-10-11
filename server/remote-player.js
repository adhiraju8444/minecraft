// The server's stand-in for a connected player. The browser simulates its own
// player (movement, health, hunger, inventory); this object mirrors what the
// browser reports so mobs, arrows and explosions can target it, and forwards
// whatever the world does to the player back to the browser.
import { Entity } from '../js/entity/entity.js';
import { Inventory, serializeStack, deserializeStack } from '../js/game/inventory.js';
import { ITEMS } from '../js/data/items.js';
import { PF, isNum, round2 } from '../js/net/protocol.js';

// Copy of the player's inventory, kept up to date by the browser. Items the
// server hands over (pickups, arrows, /give) are sent to the browser.
class MirrorInventory extends Inventory {
  constructor(owner) {
    super();
    this.owner = owner;
  }

  add(stack) {
    if (!stack || stack.count <= 0) return 0;
    const left = super.add(stack);
    const n = stack.count - left;
    if (n > 0) this.owner.send({ t: 'give', s: serializeStack({ id: stack.id, count: n, dmg: stack.dmg || 0 }) });
    return left;
  }

  clear() {
    super.clear();
    this.owner.send({ t: 'clear' });
  }
}

export class RemotePlayer extends Entity {
  constructor(world, conn, name) {
    super(world, 0, 0, 0);
    this.setSize(0.6, 1.8);
    this.conn = conn;
    this.name = name;
    this.displayName = name;
    this.isPlayer = true;
    this.targetable = true;
    this.inventory = new MirrorInventory(this);
    this.mode = 'survival';
    this.health = 20;
    this.maxHealth = 20;
    this.flags = 0;
    this.sneaking = false;
    this.sleeping = null;
    this.flying = false;
    this.swingCount = 0;
    this.held = 0;
    this.armorIds = [0, 0, 0, 0];
    this.ready = false;
    this.invuln = 0;
    this.lastDamage = 0;
    this.data = null; // last full player record from the browser (saved to disk)
    this.op = false;
    this.lastState = 0;
  }

  get alive() {
    return this.ready && this.health > 0 && !this.dead;
  }

  send(m) {
    this.conn.send(m);
  }

  chat(text, color) {
    this.send(color ? { t: 'chat', m: text, c: color } : { t: 'chat', m: text });
  }

  eyeHeight() {
    if (this.sleeping) return 0.3;
    return this.sneaking ? 1.54 : 1.62;
  }

  lookDir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  tick() {
    if (this.invuln > 0) this.invuln--;
  }

  // ------------------------------------------------------------ state from the browser
  // s = [x, y, z, yaw, pitch, flags, health, heldId, armor0..3, swingCount, sleepFacing+1]
  applyState(s) {
    if (!Array.isArray(s) || s.length < 14) return false;
    for (let i = 0; i < 14; i++) if (!isNum(s[i])) return false;
    const [x, y, z, yaw, pitch, flags, health] = s;
    if (Math.abs(x) > 3e7 || Math.abs(z) > 3e7 || y < -256 || y > 512) return false;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.setPos(x, y, z);
    this.yaw = yaw;
    this.pitch = Math.max(-1.6, Math.min(1.6, pitch));
    this.flags = flags | 0;
    this.sneaking = !!(flags & PF.SNEAK);
    this.flying = !!(flags & PF.FLY);
    this.health = Math.max(0, Math.min(this.maxHealth, health));
    this.held = ITEMS[s[7]] ? s[7] | 0 : 0;
    this.armorIds = [s[8], s[9], s[10], s[11]].map((v) => (ITEMS[v] ? v | 0 : 0));
    this.swingCount = s[12] | 0;
    const f = s[13] | 0;
    this.sleeping = f > 0 ? { f: (f - 1) & 3, since: this.sleeping ? this.sleeping.since : this.world.tickCount } : null;
    return true;
  }

  // Full player record (inventory, hunger, xp...) the browser sends now and then.
  applyData(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    this.data = d;
    const inv = d.inventory;
    if (inv && Array.isArray(inv.slots)) {
      // Stacks arrive as [name, count, damage]; anything malformed counts as empty.
      const clean = (a) => (Array.isArray(a) && typeof a[0] === 'string' && Number.isInteger(a[1]) && a[1] > 0 ? [a[0], Math.min(a[1], 64), Number.isInteger(a[2]) && a[2] > 0 ? a[2] : 0] : null);
      Inventory.prototype.load.call(this.inventory, {
        slots: inv.slots.slice(0, 36).map(clean),
        armor: (Array.isArray(inv.armor) ? inv.armor : []).slice(0, 4).map(clean),
        selected: Number.isInteger(inv.selected) && inv.selected >= 0 && inv.selected < 9 ? inv.selected : 0,
      });
    }
  }

  // ------------------------------------------------------------ the world acting on the player
  // Returns true when the hit lands (the browser applies armour and difficulty).
  damage(amount, source = {}) {
    if (!this.alive || this.mode !== 'survival') return false;
    if (!(amount > 0) && source.type !== 'mob') return false;
    if (this.invuln > 10) {
      if (amount <= this.lastDamage) return false;
    } else this.invuln = 20;
    this.lastDamage = amount;
    const e = source.entity;
    const m = { t: 'hurt', a: round2(amount), ty: String(source.type || 'generic') };
    if (e) {
      m.sx = round2(e.x);
      m.sz = round2(e.z);
      if (e.displayName) m.by = e.displayName;
      if (e.isPlayer) m.bp = 1;
    }
    this.send(m);
    return true;
  }

  knockback(fromX, fromZ, strength = 0.4) {
    if (!this.alive || this.mode === 'spectator') return;
    this.send({ t: 'kb', x: round2(fromX), z: round2(fromZ), s: round2(strength) });
  }

  push(x, y, z) {
    if (!this.alive || this.mode === 'spectator') return;
    this.send({ t: 'push', v: [round2(x), round2(y), round2(z)] });
  }

  addXP(n) {
    if (n > 0) this.send({ t: 'xp', n: Math.floor(n) });
  }

  heal() {}

  // Held-item effects of using things on animals.
  consumeSelected(n) {
    if (this.mode !== 'creative') this.send({ t: 'held', op: 'consume', n });
  }

  damageHeld(n) {
    if (this.mode === 'survival') this.send({ t: 'held', op: 'damage', n });
  }

  exchangeHeld(name) {
    this.send({ t: 'held', op: 'exchange', item: name });
  }

  swing() {}

  setMode(mode) {
    this.mode = mode;
    this.send({ t: 'mode', m: mode });
  }

  teleport(x, y, z) {
    this.setPos(x, y, z);
    this.send({ t: 'tp', p: [round2(x), round2(y), round2(z)] });
  }

  // Snapshot of how other players should see this one.
  viewState() {
    return [round2(this.x), round2(this.y), round2(this.z), round2(this.yaw), round2(this.pitch), this.flags, this.held, ...this.armorIds, this.swingCount, this.sleeping ? this.sleeping.f + 1 : 0];
  }
}

export { serializeStack, deserializeStack };
