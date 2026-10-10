import { ITEMS, I, maxStack } from '../data/items.js';

export function cloneStack(s) {
  return s ? { id: s.id, count: s.count, dmg: s.dmg || 0 } : null;
}

export function sameItem(a, b) {
  return !!a && !!b && a.id === b.id && (a.dmg || 0) === (b.dmg || 0);
}

export function serializeStack(s) {
  if (!s || !ITEMS[s.id]) return null;
  return [ITEMS[s.id].name, s.count, s.dmg || 0];
}

export function deserializeStack(a) {
  if (!a) return null;
  const id = I[a[0]];
  if (id === undefined) return null;
  return { id, count: a[1], dmg: a[2] || 0 };
}

export class Inventory {
  constructor() {
    this.slots = new Array(36).fill(null); // 0-8 hotbar, 9-35 main
    this.armor = new Array(4).fill(null); // helmet, chestplate, leggings, boots
    this.selected = 0;
    this.version = 0;
  }

  changed() {
    this.version++;
  }

  selectedStack() {
    return this.slots[this.selected];
  }

  setSelected(stack) {
    this.slots[this.selected] = stack && stack.count > 0 ? stack : null;
    this.changed();
  }

  // Adds as much of the stack as fits. Returns the number left over.
  add(stack) {
    if (!stack || stack.count <= 0) return 0;
    let left = stack.count;
    const max = maxStack(stack.id);
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (s && sameItem(s, stack) && s.count < max) {
        const n = Math.min(max - s.count, left);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < 36 && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(max, left);
        this.slots[i] = { id: stack.id, count: n, dmg: stack.dmg || 0 };
        left -= n;
      }
    }
    if (left !== stack.count) this.changed();
    return left;
  }

  canFit(stack) {
    const max = maxStack(stack.id);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += max;
      else if (sameItem(s, stack)) room += max - s.count;
      if (room >= stack.count) return true;
    }
    return room >= stack.count;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  // Removes n of an item, searching the selected slot first. Returns removed count.
  consume(id, n) {
    let left = n;
    const order = [this.selected, ...Array.from({ length: 36 }, (_, i) => i).filter((i) => i !== this.selected)];
    for (const i of order) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const k = Math.min(s.count, left);
      s.count -= k;
      left -= k;
      if (s.count <= 0) this.slots[i] = null;
      if (left <= 0) break;
    }
    if (left !== n) this.changed();
    return n - left;
  }

  findSlot(id) {
    for (let i = 0; i < 36; i++) if (this.slots[i] && this.slots[i].id === id) return i;
    return -1;
  }

  armorPoints() {
    let p = 0;
    for (const s of this.armor) if (s && ITEMS[s.id].armor) p += ITEMS[s.id].armor.points;
    return p;
  }

  clear() {
    this.slots.fill(null);
    this.armor.fill(null);
    this.changed();
  }

  serialize() {
    return { slots: this.slots.map(serializeStack), armor: this.armor.map(serializeStack), selected: this.selected };
  }

  load(o) {
    if (!o) return;
    this.slots = (o.slots || []).map(deserializeStack);
    while (this.slots.length < 36) this.slots.push(null);
    this.armor = (o.armor || []).map(deserializeStack);
    while (this.armor.length < 4) this.armor.push(null);
    this.selected = o.selected || 0;
    this.changed();
  }
}
