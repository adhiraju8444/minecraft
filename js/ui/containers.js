// Inventory-style screens with full click semantics: pick up, place, split,
// shift-click, drag-to-spread, double-click gather, number-key swaps.
import { ITEMS, I, maxStack, itemMatches } from '../data/items.js';
import { RECIPES, matchRecipe, smeltResult, fuelValue } from '../data/recipes.js';
import { sameItem, cloneStack } from '../game/inventory.js';
import { COOK_TIME } from '../world/tileentities.js';
import { portraitCanvas } from '../gfx/models.js';

const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

const CREATIVE_TABS = [
  ['building', 'Building Blocks', 'bricks'],
  ['decoration', 'Decoration', 'poppy'],
  ['tools', 'Tools', 'iron_pickaxe'],
  ['combat', 'Combat', 'iron_sword'],
  ['food', 'Food', 'apple'],
  ['materials', 'Materials', 'iron_ingot'],
  ['misc', 'Miscellaneous', 'tnt'],
  ['search', 'Search', ''],
  ['inventory', 'Survival Inventory', 'chest'],
];

export class ContainerUI {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.open = false;
    this.kind = '';
    this.node = null;
    this.slots = [];
    this.cursor = null;
    this.hover = null;
    this.drag = null;
    this.grid = null;
    this.gridSize = 0;
    this.result = null;
    this.te = null;
    this.mouse = [0, 0];
    this.cursorEl = el('<div class="cursor-item item hidden"></div>');
    this.tooltip = el('<div class="tooltip hidden"></div>');
    ui.root.appendChild(this.cursorEl);
    ui.root.appendChild(this.tooltip);
    window.addEventListener('pointermove', (e) => {
      this.mouse = [e.clientX, e.clientY];
    });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
  }

  get player() {
    return this.game.player;
  }
  get inv() {
    return this.game.player.inventory;
  }

  // ---------------------------------------------------------------- building
  begin(kind, title) {
    this.close(true);
    this.open = true;
    this.kind = kind;
    this.slots = [];
    const node = el(`<div class="container-screen"><div class="crow" style="align-items:flex-start"><div class="cpanel panel"></div></div></div>`);
    this.node = node;
    this.panel = node.querySelector('.cpanel');
    if (title) this.panel.appendChild(el(`<h4>${title}</h4>`));
    node.addEventListener('pointerdown', (e) => {
      if (e.target === node) this.clickOutside(e.button);
    });
    node.addEventListener('contextmenu', (e) => e.preventDefault());
    this.ui.root.appendChild(node);
    this.ui.updateHudVisibility();
  }

  makeSlot(parent, opts) {
    const s = el(`<div class="slot ${opts.out ? 'out' : ''} ${opts.cls || ''}"><div class="item"></div></div>`);
    if (opts.ghost) {
      const gimg = el(`<img class="ghost" src="${opts.ghost}" alt="">`);
      s.insertBefore(gimg, s.firstChild);
      s._ghost = gimg;
    }
    const slot = { el: s, item: s.querySelector('.item'), ...opts };
    s.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onSlotDown(slot, e);
    });
    s.addEventListener('pointerenter', () => {
      this.hover = slot;
      if (this.drag && !this.drag.slots.includes(slot) && this.canDragInto(slot)) this.drag.slots.push(slot);
    });
    s.addEventListener('pointerleave', () => {
      if (this.hover === slot) this.hover = null;
    });
    s.addEventListener('dblclick', (e) => {
      if (e.button === 0 && !e.shiftKey) this.gather(slot);
    });
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.appendChild(s);
    this.slots.push(slot);
    return slot;
  }

  invSlot(parent, i) {
    return this.makeSlot(parent, {
      get: () => this.inv.slots[i],
      set: (v) => {
        this.inv.slots[i] = v;
        this.inv.changed();
      },
      group: i < 9 ? 'hotbar' : 'main',
      index: i,
    });
  }

  playerInventory(parent) {
    const main = el('<div class="grid c9"></div>');
    for (let i = 9; i < 36; i++) this.invSlot(main, i);
    parent.appendChild(main);
    parent.appendChild(el('<div class="spacer"></div>'));
    const hot = el('<div class="grid c9"></div>');
    for (let i = 0; i < 9; i++) this.invSlot(hot, i);
    parent.appendChild(hot);
  }

  armorSlots(parent) {
    const col = el('<div class="armor-col"></div>');
    const names = ['helmet', 'chestplate', 'leggings', 'boots'];
    for (let a = 0; a < 4; a++) {
      const ghost = this.game.gfx.items.icon(I['iron_' + names[a]]);
      this.makeSlot(col, {
        get: () => this.inv.armor[a],
        set: (v) => {
          this.inv.armor[a] = v;
          this.inv.changed();
        },
        accept: (st) => {
          const d = ITEMS[st.id];
          return !!(d.armor && d.armor.slot === a);
        },
        max: 1,
        group: 'armor',
        index: a,
        ghost,
      });
    }
    parent.appendChild(col);
  }

  craftingGrid(parent, size) {
    this.gridSize = size;
    this.grid = new Array(size * size).fill(null);
    this.result = null;
    const wrap = el('<div class="crow"></div>');
    const g = el(`<div class="grid c${size}"></div>`);
    for (let i = 0; i < size * size; i++) {
      this.makeSlot(g, {
        get: () => this.grid[i],
        set: (v) => {
          this.grid[i] = v;
          this.updateResult();
        },
        group: 'craft',
      });
    }
    wrap.appendChild(g);
    wrap.appendChild(el('<div class="arrow-right"></div>'));
    this.makeSlot(wrap, { get: () => this.result, set: () => {}, output: true, group: 'result', take: () => this.takeCraft() });
    parent.appendChild(wrap);
    this.updateResult();
  }

  updateResult() {
    const m = matchRecipe(this.grid, this.gridSize, this.gridSize);
    if (!m) {
      this.result = null;
      return;
    }
    const id = I[m.result[0]];
    this.result = { id, count: m.result[1], dmg: 0 };
  }

  takeCraft() {
    if (!this.result) return null;
    const out = cloneStack(this.result);
    for (let i = 0; i < this.grid.length; i++) {
      const s = this.grid[i];
      if (!s) continue;
      s.count--;
      const def = ITEMS[s.id];
      if (s.count <= 0) {
        // Buckets come back empty.
        this.grid[i] = def.name.endsWith('_bucket') ? { id: I.bucket, count: 1, dmg: 0 } : null;
      }
    }
    this.updateResult();
    this.game.onCraft?.(out);
    return out;
  }

  // ---------------------------------------------------------------- screens
  openInventory() {
    this.begin('inventory', '');
    const top = el('<div class="inv-top"></div>');
    this.armorSlots(top);
    const portrait = el('<div class="portrait"></div>');
    try {
      portrait.appendChild(portraitCanvas('player'));
    } catch {
      /* portrait is decorative */
    }
    top.appendChild(portrait);
    const craft = el('<div class="craft-area"><h4>Crafting</h4></div>');
    this.craftingGrid(craft, 2);
    top.appendChild(craft);
    this.panel.appendChild(top);
    this.playerInventory(this.panel);
    this.addRecipeBook(2);
  }

  openCrafting() {
    this.begin('crafting', 'Crafting');
    this.craftingGrid(this.panel, 3);
    this.panel.appendChild(el('<h4>Inventory</h4>'));
    this.playerInventory(this.panel);
    this.addRecipeBook(3);
  }

  openFurnace(te) {
    this.begin('furnace', 'Furnace');
    this.te = te;
    const row = el('<div class="crow" style="justify-content:center;gap:calc(var(--gs) * 10)"></div>');
    const left = el('<div style="display:flex;flex-direction:column;align-items:center;gap:calc(var(--gs) * 2)"></div>');
    this.makeSlot(left, { get: () => te.items[0], set: (v) => { te.items[0] = v; this.game.world.markTileDirty(te); }, group: 'furnace_in' });
    this.flameEl = el('<div class="flame"><div></div></div>');
    left.appendChild(this.flameEl);
    this.makeSlot(left, {
      get: () => te.items[1],
      set: (v) => { te.items[1] = v; this.game.world.markTileDirty(te); },
      accept: (st) => fuelValue(st.id) > 0 || ITEMS[st.id].name === 'bucket',
      group: 'furnace_fuel',
    });
    row.appendChild(left);
    this.arrowEl = el('<div class="arrow-right"><div class="fill"></div></div>');
    row.appendChild(this.arrowEl);
    this.makeSlot(row, {
      get: () => te.items[2],
      set: (v) => { te.items[2] = v; this.game.world.markTileDirty(te); },
      output: true,
      group: 'furnace_out',
      take: () => {
        const s = te.items[2];
        if (!s) return null;
        te.items[2] = null;
        this.game.world.markTileDirty(te);
        this.awardFurnaceXP(s.count);
        return s;
      },
    });
    this.panel.appendChild(row);
    this.panel.appendChild(el('<h4>Inventory</h4>'));
    this.playerInventory(this.panel);
  }

  awardFurnaceXP() {
    if (this.game.net) return; // the server hands out furnace experience
    const te = this.te;
    if (!te || te.xp <= 0) return;
    let xp = Math.floor(te.xp);
    if (Math.random() < te.xp - xp) xp++;
    te.xp = 0;
    if (xp > 0) this.game.spawnXP(this.player.x, this.player.y + 0.5, this.player.z, xp);
  }

  openChest(te) {
    this.begin('chest', 'Chest');
    this.te = te;
    const g = el('<div class="grid c9"></div>');
    for (let i = 0; i < 27; i++) {
      this.makeSlot(g, { get: () => te.items[i], set: (v) => { te.items[i] = v; this.game.world.markTileDirty(te); }, group: 'chest' });
    }
    this.panel.appendChild(g);
    this.panel.appendChild(el('<h4>Inventory</h4>'));
    this.playerInventory(this.panel);
  }

  openCreative(tab = this.creativeTab || 'building') {
    this.begin('creative', '');
    this.creativeTab = tab;
    const head = el('<div class="creative-head"></div>');
    const tabs = el('<div class="creative-tabs"></div>');
    const iconFor = (name) => (I[name] !== undefined ? this.game.gfx.items.icon(I[name]) : '');
    for (const [key, label, icon] of CREATIVE_TABS) {
      const t = el(`<div class="ctab ${key === tab ? 'sel' : ''}" title="${label}"></div>`);
      if (key === 'search') t.appendChild(el('<span style="font-size:calc(var(--gs) * 9)">⌕</span>'));
      else t.appendChild(el(`<img src="${iconFor(icon)}" alt="${label}">`));
      t.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.ui.click();
        this.openCreative(key);
      });
      tabs.appendChild(t);
    }
    head.appendChild(tabs);
    this.panel.appendChild(head);
    const title = CREATIVE_TABS.find((t) => t[0] === tab)[1];
    const row = el(`<div class="creative-head"><h4>${title}</h4></div>`);
    if (tab === 'search') {
      const input = el(`<input id="creative-search" type="text" placeholder="Search items" value="${this.searchText || ''}">`);
      input.addEventListener('input', () => {
        this.searchText = input.value;
        this.fillCreativeGrid();
      });
      row.appendChild(input);
      setTimeout(() => input.focus(), 0);
    }
    this.panel.appendChild(row);
    if (tab === 'inventory') {
      const top = el('<div class="inv-top"></div>');
      this.armorSlots(top);
      const portrait = el('<div class="portrait"></div>');
      try {
        portrait.appendChild(portraitCanvas('player'));
      } catch {
        /* decorative */
      }
      top.appendChild(portrait);
      this.panel.appendChild(top);
      const main = el('<div class="grid c9"></div>');
      for (let i = 9; i < 36; i++) this.invSlot(main, i);
      this.panel.appendChild(main);
    } else {
      this.creativeGridEl = el('<div class="grid c9 creative-grid"></div>');
      this.panel.appendChild(this.creativeGridEl);
      this.fillCreativeGrid();
    }
    this.panel.appendChild(el('<div class="spacer"></div>'));
    const bottom = el('<div class="crow" style="gap:calc(var(--gs) * 4)"></div>');
    const hot = el('<div class="grid c9"></div>');
    for (let i = 0; i < 9; i++) this.invSlot(hot, i);
    bottom.appendChild(hot);
    this.makeSlot(bottom, {
      cls: 'trash',
      get: () => null,
      set: () => {},
      trash: true,
    });
    this.panel.appendChild(bottom);
  }

  creativeItems(tab) {
    const out = [];
    const q = (this.searchText || '').toLowerCase().trim();
    for (const d of ITEMS) {
      if (!d) continue;
      if (tab === 'search') {
        if (!q || d.display.toLowerCase().includes(q) || d.name.includes(q)) out.push(d.id);
      } else if (d.tab === tab) out.push(d.id);
    }
    return out;
  }

  fillCreativeGrid() {
    const g = this.creativeGridEl;
    if (!g) return;
    this.slots = this.slots.filter((s) => !s.palette);
    g.innerHTML = '';
    const ids = this.creativeItems(this.creativeTab);
    for (const id of ids) {
      const st = { id, count: 1, dmg: 0 };
      this.makeSlot(g, { get: () => st, set: () => {}, palette: true, id });
    }
    const pad = (9 - (ids.length % 9)) % 9 + Math.max(0, 45 - Math.ceil(ids.length / 9) * 9);
    for (let i = 0; i < pad; i++) g.appendChild(el('<div class="slot"></div>'));
  }

  // ---------------------------------------------------------------- recipe book
  addRecipeBook(size) {
    const book = el(`<div class="recipe-book panel"><h4>Recipes</h4><button class="btn small-btn" data-filter>Showing: All</button><div class="recipe-list"></div></div>`);
    this.node.querySelector('.crow').insertBefore(book, this.node.querySelector('.crow').firstChild);
    this.bookSize = size;
    this.bookEl = book;
    this.onlyCraftable = this.onlyCraftable ?? false;
    const fb = book.querySelector('[data-filter]');
    const label = () => (fb.textContent = this.onlyCraftable ? 'Showing: Craftable' : 'Showing: All');
    label();
    fb.addEventListener('click', () => {
      this.ui.click();
      this.onlyCraftable = !this.onlyCraftable;
      label();
      this.renderRecipes();
    });
    this.renderRecipes();
  }

  recipeFits(r, size) {
    if (r.shapeless) return r.shapeless.length <= size * size;
    return r.pattern.length <= size && Math.max(...r.pattern.map((l) => l.length)) <= size;
  }

  // Ingredient list for a recipe as an array of {ing, pos}
  recipeCells(r) {
    if (r.shapeless) return r.shapeless.map((ing, k) => ({ ing, k }));
    const out = [];
    r.pattern.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ' ') out.push({ ing: r.key[ch], x, y });
    }));
    return out;
  }

  // Count available items (inventory + crafting grid).
  available() {
    const m = new Map();
    const add = (s) => s && m.set(s.id, (m.get(s.id) || 0) + s.count);
    this.inv.slots.forEach(add);
    if (this.grid) this.grid.forEach(add);
    return m;
  }

  canCraft(r, avail) {
    const counts = new Map(avail);
    for (const c of this.recipeCells(r)) {
      let found = false;
      for (const [id, n] of counts) {
        if (n > 0 && itemMatches(id, c.ing)) {
          counts.set(id, n - 1);
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }

  renderRecipes() {
    const list = this.bookEl.querySelector('.recipe-list');
    list.innerHTML = '';
    const avail = this.available();
    const entries = RECIPES.filter((r) => this.recipeFits(r, this.bookSize)).map((r) => ({ r, ok: this.canCraft(r, avail) }));
    entries.sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0));
    for (const { r, ok } of entries) {
      if (this.onlyCraftable && !ok) continue;
      const id = I[r.result[0]];
      const e = el(`<div class="recipe ${ok ? '' : 'no'}"><img src="${this.game.gfx.items.icon(id)}" alt=""></div>`);
      e.addEventListener('pointerenter', () => (this.hoverRecipe = r));
      e.addEventListener('pointerleave', () => {
        if (this.hoverRecipe === r) this.hoverRecipe = null;
      });
      e.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        this.ui.click();
        this.fillRecipe(r, ev.shiftKey);
      });
      list.appendChild(e);
    }
  }

  clearGridToInventory() {
    for (let i = 0; i < this.grid.length; i++) {
      const s = this.grid[i];
      if (!s) continue;
      const left = this.inv.add(s);
      if (left > 0) {
        s.count = left;
        this.game.dropItem(this.player.x, this.player.y + 1.3, this.player.z, s, this.player);
      }
      this.grid[i] = null;
    }
  }

  fillRecipe(r, many) {
    this.clearGridToInventory();
    const cells = this.recipeCells(r);
    const times = many ? 64 : 1;
    for (let t = 0; t < times; t++) {
      // Check we can place one more set
      const avail = new Map();
      this.inv.slots.forEach((s) => s && avail.set(s.id, (avail.get(s.id) || 0) + s.count));
      if (!this.canCraft(r, avail)) break;
      let stop = false;
      cells.forEach((c, k) => {
        if (stop) return;
        const pos = r.shapeless ? k : c.y * this.gridSize + c.x;
        const cur = this.grid[pos];
        let id = cur ? cur.id : -1;
        if (id < 0) {
          const s = this.inv.slots.find((x) => x && itemMatches(x.id, c.ing));
          if (!s) { stop = true; return; }
          id = s.id;
        }
        if (cur && cur.count >= maxStack(cur.id)) { stop = true; return; }
        if (this.inv.consume(id, 1) !== 1) { stop = true; return; }
        if (cur) cur.count++;
        else this.grid[pos] = { id, count: 1, dmg: 0 };
      });
      if (stop) break;
    }
    this.updateResult();
    this.inv.changed();
  }

  // ---------------------------------------------------------------- clicks
  canDragInto(slot) {
    if (!this.cursor || slot.output || slot.palette || slot.trash) return false;
    const s = slot.get();
    if (s && !sameItem(s, this.cursor)) return false;
    if (slot.accept && !slot.accept(this.cursor)) return false;
    return true;
  }

  onSlotDown(slot, e) {
    this.game.audio.init();
    const button = e.button;
    if (button !== 0 && button !== 2) return;
    if (e.shiftKey) {
      this.shiftClick(slot);
      return;
    }
    if (slot.trash) {
      this.cursor = null;
      return;
    }
    if (slot.palette) {
      this.paletteClick(slot, button, e.shiftKey);
      return;
    }
    if (slot.output) {
      this.takeOutput(slot);
      return;
    }
    if (this.cursor && this.canDragInto(slot)) {
      // Possible drag: decide on release
      this.drag = { button, slots: [slot], start: slot, cursor: cloneStack(this.cursor) };
      return;
    }
    this.click(slot, button);
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (!this.open) return;
    if (d.slots.length <= 1) {
      this.click(d.start, d.button);
      return;
    }
    // Spread the stack over the dragged slots
    const n = d.slots.length;
    const total = this.cursor.count;
    let left = total;
    if (d.button === 0) {
      const each = Math.floor(total / n);
      if (each <= 0) return;
      for (const s of d.slots) {
        const cur = s.get();
        const max = Math.min(maxStack(this.cursor.id), s.max || 64);
        const have = cur ? cur.count : 0;
        const put = Math.min(each, max - have);
        if (put <= 0) continue;
        s.set({ id: this.cursor.id, count: have + put, dmg: this.cursor.dmg || 0 });
        left -= put;
      }
    } else {
      for (const s of d.slots) {
        if (left <= 0) break;
        const cur = s.get();
        const max = Math.min(maxStack(this.cursor.id), s.max || 64);
        const have = cur ? cur.count : 0;
        if (have >= max) continue;
        s.set({ id: this.cursor.id, count: have + 1, dmg: this.cursor.dmg || 0 });
        left--;
      }
    }
    this.cursor = left > 0 ? { ...this.cursor, count: left } : null;
    void e;
  }

  click(slot, button) {
    const cur = slot.get();
    const c = this.cursor;
    const max = (st) => Math.min(maxStack(st.id), slot.max || 64);
    if (button === 0) {
      if (!c) {
        if (cur) {
          this.cursor = cur;
          slot.set(null);
        }
      } else if (!cur) {
        if (slot.accept && !slot.accept(c)) return;
        const n = Math.min(c.count, max(c));
        slot.set({ ...c, count: n });
        this.cursor = c.count - n > 0 ? { ...c, count: c.count - n } : null;
      } else if (sameItem(cur, c)) {
        const room = max(cur) - cur.count;
        const n = Math.min(room, c.count);
        if (n > 0) {
          slot.set({ ...cur, count: cur.count + n });
          this.cursor = c.count - n > 0 ? { ...c, count: c.count - n } : null;
        }
      } else {
        if (slot.accept && !slot.accept(c)) return;
        if (c.count > max(c)) return;
        slot.set(c);
        this.cursor = cur;
      }
    } else {
      if (!c) {
        if (cur) {
          const half = Math.ceil(cur.count / 2);
          this.cursor = { ...cur, count: half };
          slot.set(cur.count - half > 0 ? { ...cur, count: cur.count - half } : null);
        }
      } else if (!cur || sameItem(cur, c)) {
        if (slot.accept && !slot.accept(c)) return;
        if (cur && cur.count >= max(cur)) return;
        slot.set({ ...c, count: (cur ? cur.count : 0) + 1 });
        this.cursor = c.count > 1 ? { ...c, count: c.count - 1 } : null;
      } else {
        if (slot.accept && !slot.accept(c)) return;
        slot.set(c);
        this.cursor = cur;
      }
    }
  }

  takeOutput(slot) {
    const res = slot.get();
    if (!res) return;
    const c = this.cursor;
    if (c && (!sameItem(c, res) || c.count + res.count > maxStack(res.id))) return;
    const got = slot.take();
    if (!got) return;
    if (c) c.count += got.count;
    else this.cursor = got;
  }

  gather(slot) {
    const c = this.cursor;
    if (!c) return;
    const max = maxStack(c.id);
    for (const s of this.slots) {
      if (c.count >= max) break;
      if (s.output || s.palette || s.trash) continue;
      const st = s.get();
      if (!st || !sameItem(st, c)) continue;
      const n = Math.min(st.count, max - c.count);
      c.count += n;
      s.set(st.count - n > 0 ? { ...st, count: st.count - n } : null);
    }
    void slot;
  }

  paletteClick(slot, button, shift) {
    const id = slot.id;
    if (this.cursor) {
      if (this.cursor.id === id && button === 0 && this.cursor.count < maxStack(id)) this.cursor.count++;
      else this.cursor = null;
      return;
    }
    this.cursor = { id, count: button === 2 ? 1 : shift ? maxStack(id) : maxStack(id), dmg: 0 };
  }

  // Move a stack into a list of target slots (stacking first, then empty).
  moveInto(stack, targets) {
    const max = maxStack(stack.id);
    for (const t of targets) {
      if (stack.count <= 0) break;
      const cur = t.get();
      if (cur && sameItem(cur, stack) && cur.count < Math.min(max, t.max || 64)) {
        const n = Math.min(stack.count, Math.min(max, t.max || 64) - cur.count);
        t.set({ ...cur, count: cur.count + n });
        stack.count -= n;
      }
    }
    for (const t of targets) {
      if (stack.count <= 0) break;
      if (t.get()) continue;
      if (t.accept && !t.accept(stack)) continue;
      const n = Math.min(stack.count, Math.min(max, t.max || 64));
      t.set({ ...stack, count: n });
      stack.count -= n;
    }
    return stack.count;
  }

  shiftClick(slot) {
    if (slot.palette) {
      const id = slot.id;
      this.inv.add({ id, count: maxStack(id), dmg: 0 });
      return;
    }
    if (slot.trash) {
      if (this.kind === 'creative') this.inv.clear();
      return;
    }
    const by = (g) => this.slots.filter((s) => s.group === g);
    const hotbar = by('hotbar'), main = by('main');
    const invTargets = [...hotbar.slice().reverse(), ...main.slice().reverse()];
    if (slot.output) {
      // Craft / take as many as possible into the inventory.
      for (let i = 0; i < 64; i++) {
        const res = slot.get();
        if (!res) break;
        const probe = { ...res };
        if (!this.inv.canFit(probe)) break;
        const got = slot.take();
        if (!got) break;
        const left = this.moveInto(got, invTargets);
        if (left > 0) {
          this.game.dropItem(this.player.x, this.player.y + 1.3, this.player.z, { ...got, count: left }, this.player);
          break;
        }
        if (!slot.group || slot.group !== 'result') break;
      }
      return;
    }
    const st = slot.get();
    if (!st) return;
    const stack = { ...st };
    const def = ITEMS[stack.id];
    let targets;
    const g = slot.group;
    if (g === 'hotbar' || g === 'main') {
      if (this.kind === 'chest') targets = by('chest');
      else if (this.kind === 'furnace') {
        if (smeltResult(stack.id)) targets = by('furnace_in');
        else if (fuelValue(stack.id) > 0) targets = by('furnace_fuel');
        else targets = g === 'hotbar' ? main : hotbar;
      } else if ((this.kind === 'inventory' || this.kind === 'creative') && def.armor && !this.inv.armor[def.armor.slot]) {
        targets = by('armor').filter((s) => s.index === def.armor.slot);
      } else targets = g === 'hotbar' ? main : hotbar;
    } else {
      targets = [...main, ...hotbar];
    }
    const left = this.moveInto(stack, targets);
    slot.set(left > 0 ? { ...stack, count: left } : null);
  }

  clickOutside(button) {
    if (!this.cursor) return;
    const p = this.player;
    if (button === 2) {
      this.game.throwStack(p, { ...this.cursor, count: 1 });
      this.cursor.count--;
      if (this.cursor.count <= 0) this.cursor = null;
    } else {
      this.game.throwStack(p, this.cursor);
      this.cursor = null;
    }
  }

  onKey(e, code) {
    const K = this.game.settings.keys;
    if (code === K.inventory && !(e.target && e.target.tagName === 'INPUT')) {
      this.close();
      this.game.resume();
      return true;
    }
    if (code.startsWith('Digit') && this.hover && !this.hover.output && !this.hover.trash) {
      const n = Number(code.slice(5)) - 1;
      if (n >= 0 && n < 9) {
        const s = this.hover;
        if (s.palette) {
          this.inv.slots[n] = { id: s.id, count: maxStack(s.id), dmg: 0 };
          this.inv.changed();
          return true;
        }
        const a = s.get();
        const b = this.inv.slots[n];
        if (b && s.accept && !s.accept(b)) return true;
        this.inv.slots[n] = a;
        s.set(b);
        this.inv.changed();
        return true;
      }
    }
    if (code === K.drop && this.hover && !this.cursor) {
      const s = this.hover;
      const st = s.get();
      if (!st || s.palette || s.trash) return true;
      if (s.output) {
        const got = s.take();
        if (got) this.game.throwStack(this.player, got);
        return true;
      }
      const all = e.ctrlKey || e.metaKey;
      const n = all ? st.count : 1;
      this.game.throwStack(this.player, { ...st, count: n });
      s.set(st.count - n > 0 ? { ...st, count: st.count - n } : null);
      return true;
    }
    return code !== 'Escape' && code !== K.chat;
  }

  close(silent) {
    if (!this.open) return;
    const p = this.player;
    if (this.cursor && p) {
      const left = this.inv.add(this.cursor);
      if (left > 0) this.game.throwStack(p, { ...this.cursor, count: left });
      this.cursor = null;
    }
    if (this.grid && p) this.clearGridToInventory();
    if (this.kind === 'chest' && !silent) this.game.audio.play('chest_close', { x: this.te.x + 0.5, y: this.te.y + 0.5, z: this.te.z + 0.5 });
    if (this.kind === 'furnace') this.awardFurnaceXP();
    if (this.te && this.game.net) this.game.net.closeTile();
    this.grid = null;
    this.te = null;
    this.open = false;
    this.kind = '';
    this.slots = [];
    this.drag = null;
    this.creativeGridEl = null;
    this.bookEl = null;
    if (this.node) this.node.remove();
    this.node = null;
    this.cursorEl.classList.add('hidden');
    this.tooltip.classList.add('hidden');
    this.ui.updateHudVisibility();
  }

  contentSignature() {
    const part = (s) => (s ? `${s.id}x${s.count}` : '-');
    return this.inv.slots.map(part).join(',') + '|' + (this.grid ? this.grid.map(part).join(',') : '');
  }

  // ---------------------------------------------------------------- per frame
  update() {
    if (!this.open) return;
    // The chest or furnace was broken (by someone else, in multiplayer).
    if (this.te && this.game.world && this.game.world.getTileEntity(this.te.x, this.te.y, this.te.z) !== this.te) {
      this.close(true);
      this.game.resume();
      return;
    }
    for (const s of this.slots) {
      const st = s.get();
      this.ui.renderItem(s.item, st);
      if (s._ghost) s._ghost.style.display = st ? 'none' : '';
    }
    // Cursor
    if (this.cursor) {
      this.cursorEl.classList.remove('hidden');
      this.ui.renderItem(this.cursorEl, this.cursor);
      this.cursorEl.style.left = this.mouse[0] + 'px';
      this.cursorEl.style.top = this.mouse[1] + 'px';
    } else this.cursorEl.classList.add('hidden');
    // Tooltip
    let tipStack = this.hover && !this.cursor ? this.hover.get() : null;
    let tipText = null;
    if (!tipStack && this.hoverRecipe && !this.cursor) {
      const r = this.hoverRecipe;
      const names = this.recipeCells(r).map((c) => (c.ing.startsWith('#') ? 'any ' + c.ing.slice(1) : ITEMS[I[c.ing]].display));
      const counts = {};
      names.forEach((n) => (counts[n] = (counts[n] || 0) + 1));
      tipText = [`${ITEMS[I[r.result[0]]].display}${r.result[1] > 1 ? ' ×' + r.result[1] : ''}`, Object.entries(counts).map(([n, k]) => `${k}× ${n}`).join(', ')];
    }
    if (tipStack || tipText) {
      const tip = this.tooltip;
      let html;
      if (tipStack) {
        const d = ITEMS[tipStack.id];
        html = d.display;
        if (d.durability && tipStack.dmg) html += `<div class="sub">Durability: ${d.durability - tipStack.dmg} / ${d.durability}</div>`;
        if (d.food) html += `<div class="sub">Restores ${d.food.hunger / 2} hunger</div>`;
        if (d.armor) html += `<div class="sub">+${d.armor.points} armor</div>`;
        if (d.tool && d.damage > 1) html += `<div class="sub">${d.damage} attack damage</div>`;
      } else html = `${tipText[0]}<div class="sub">${tipText[1]}</div>`;
      if (tip._html !== html) {
        tip.innerHTML = html;
        tip._html = html;
      }
      tip.classList.remove('hidden');
      const x = Math.min(window.innerWidth - tip.offsetWidth - 4, this.mouse[0] + 14);
      tip.style.left = x + 'px';
      tip.style.top = Math.max(4, this.mouse[1] - 22) + 'px';
    } else this.tooltip.classList.add('hidden');
    // Furnace gauges
    if (this.kind === 'furnace' && this.te) {
      const te = this.te;
      const burn = te.burnMax ? te.burn / te.burnMax : 0;
      this.flameEl.firstElementChild.style.height = Math.round(burn * 100) + '%';
      this.arrowEl.firstElementChild.style.width = Math.round((te.cook / COOK_TIME) * 100) + '%';
    }
    // Recipe book availability follows what the player carries.
    if (this.bookEl) {
      const sig = this.contentSignature();
      if (sig !== this.bookSig) {
        this.bookSig = sig;
        this.renderRecipes();
      }
    }
  }
}
