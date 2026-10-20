// Browser side of multiplayer: talks to the server over a WebSocket.
//
// The browser still simulates its own player (movement, hunger, inventory)
// and generates untouched terrain from the seed. The server owns everything
// else: block rules, mobs, items, containers, time and weather. Edits the
// player makes are applied locally at once and sent to the server, which
// sends back the real result.
import { PROTOCOL, FRAME_CHUNK, PF, round2, parseFrame, decodeChunkPayload } from './protocol.js';
import { createProxy, applyState, wouldInteract } from './entities.js';
import { ItemEntity, XPOrb, PrimedTNT, Projectile } from '../entity/objects.js';
import { Mob } from '../entity/mobs.js';
import { ITEMS, I } from '../data/items.js';
import { chunkKey } from '../world/constants.js';
import { deserializeStack } from '../game/inventory.js';

const KEY_STORE = 'blockforge.playerKeys'; // { "host:port": key }
const OLD_KEY_STORE = 'blockforge.playerKey'; // single key used by the first version

function randomKey() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A random secret that proves this browser owns its player name on one
// server. Every server gets its own key, so no server can learn the key
// this browser uses somewhere else.
export function playerKey(host) {
  const h = String(host || location.host).toLowerCase();
  try {
    let keys = {};
    try {
      keys = JSON.parse(localStorage.getItem(KEY_STORE) || '{}') || {};
    } catch {
      keys = {};
    }
    let k = keys[h];
    if (!(k && /^[A-Za-z0-9_-]{16,128}$/.test(k))) {
      // The first version kept one key for the page's own server: keep using it there.
      const old = localStorage.getItem(OLD_KEY_STORE);
      k = old && h === location.host.toLowerCase() && /^[A-Za-z0-9_-]{16,128}$/.test(old) ? old : randomKey();
      keys[h] = k;
      localStorage.setItem(KEY_STORE, JSON.stringify(keys));
    }
    return k;
  } catch {
    // Storage blocked: keys for this visit only.
    playerKey.temp = playerKey.temp || {};
    return (playerKey.temp[h] = playerKey.temp[h] || randomKey());
  }
}

// Turn what the player typed into the server's web and socket addresses.
export function serverAddress(input) {
  let a = (input || '').trim();
  if (!a) a = location.host;
  const local = (h) => /^(localhost|127\.|\[::1\])/.test(h);
  let secure;
  const m = /^([a-z]+):\/\//i.exec(a);
  if (m) {
    secure = /^(https|wss)$/i.test(m[1]);
    a = a.slice(m[0].length);
  } else {
    const host = a.split('/')[0];
    secure = location.protocol === 'https:' && !local(host);
  }
  a = a.replace(/\/+$/, '');
  const slash = a.indexOf('/');
  const host = slash < 0 ? a : a.slice(0, slash);
  let path = slash < 0 ? '' : a.slice(slash);
  if (path.endsWith('/ws')) path = path.slice(0, -3);
  return {
    host,
    http: `${secure ? 'https' : 'http'}://${host}${path}`,
    ws: `${secure ? 'wss' : 'ws'}://${host}${path}/ws`,
  };
}

export async function fetchServerInfo(input, timeoutMs = 4000) {
  const addr = serverAddress(input);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(addr.http + '/api/info', { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.game === 'blockforge' ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const packStack = (s) => (s ? [s.id, s.count, s.dmg || 0] : null);
const unpackStack = (a) => (Array.isArray(a) && ITEMS[a[0]] && a[1] > 0 ? { id: a[0], count: a[1], dmg: a[2] || 0 } : null);
const NO_RELAY = new Set(['cave', 'levelup', 'orb', 'pop', 'click', 'hurt', 'burp']);

export class NetClient {
  constructor(game, url) {
    this.game = game;
    this.url = url;
    this.ws = null;
    this.open = false;
    this.closed = false;
    this.reason = '';
    this.changed = new Set();
    this.proxies = new Map(); // server entity id -> proxy
    this.outbox = [];
    this.spawnQueue = [];
    this.soundOut = [];
    this.applying = false;
    this.lastState = '';
    this.stateAge = 0;
    this.invVersion = -1;
    this.dataTimer = 0;
    this.swingCount = 0;
    this.players = [];
    this.loader = null;
    this.onClose = null;
  }

  // ------------------------------------------------------------ connection
  connect(hello) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        reject(new Error(msg));
      };
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch {
        fail('That server address is not valid');
        return;
      }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        fail('The server did not answer');
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }, 12000);
      ws.onopen = () => {
        this.open = true;
        ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, ...hello }));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') {
          this.onBinary(ev.data);
          return;
        }
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        for (const msg of Array.isArray(m) ? m : [m]) {
          if (!settled) {
            if (msg.t === 'welcome') {
              settled = true;
              clearTimeout(timer);
              this.welcome = msg;
              for (const k of msg.changed || []) this.changed.add(k);
              resolve(msg);
              continue;
            }
            if (msg.t === 'kick') {
              clearTimeout(timer);
              fail(msg.reason || 'The server refused the connection');
              continue;
            }
          }
          try {
            this.handle(msg);
          } catch (e) {
            console.error('[net] could not apply', msg.t, e);
          }
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        fail('Could not connect to the server. Check the address and that the server is running.');
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        this.open = false;
        const why = this.reason || ev.reason || 'Connection lost';
        if (!settled) fail(why === 'Connection lost' ? 'Could not connect to the server. Check the address and that the server is running.' : why);
        if (!this.closed) {
          this.closed = true;
          this.reason = why;
          this.onClose?.(why);
        }
      };
    });
  }

  close(reason = 'Disconnected') {
    if (this.closed) return;
    this.flushOut();
    this.closed = true;
    this.reason = reason;
    try {
      this.ws.close(1000, reason);
    } catch {
      /* already closed */
    }
  }

  // Messages sent during one task go out together in a single frame.
  send(m) {
    if (this.closed) return;
    this.outbox.push(m);
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => {
        this.flushQueued = false;
        this.flushOut();
      });
    }
  }

  flushOut() {
    if (!this.outbox.length || !this.ws || this.ws.readyState !== 1) return;
    const data = JSON.stringify(this.outbox.length === 1 ? this.outbox[0] : this.outbox);
    this.outbox = [];
    this.ws.send(data);
  }

  sendNow(m) {
    this.send(m);
    this.flushOut();
  }

  // ------------------------------------------------------------ world hooks
  attach(world, loader) {
    this.world = world;
    this.loader = loader;
  }

  isChanged(cx, cz) {
    return this.changed.has(chunkKey(cx, cz));
  }

  requestChunk(cx, cz) {
    this.send({ t: 'req', l: [cx, cz] });
  }

  // A block the local player changed (world.setBlock on this client).
  sendSet(x, y, z, id, meta, flags) {
    const m = { t: 'set', x, y, z, b: id, m: meta };
    if (flags === 0) m.f = 0;
    this.send(m);
  }

  // Container contents the local player edited.
  // Container edits go to the server as per-slot changes from the last
  // contents it confirmed: [slot, before, after].
  sendTile(te) {
    if (!te) return;
    const now = te.items.map(packStack);
    const before = te.netItems || now.map(() => null);
    const ch = [];
    for (let i = 0; i < now.length; i++) {
      if (JSON.stringify(now[i]) !== JSON.stringify(before[i] ?? null)) ch.push([i, before[i] ?? null, now[i]]);
    }
    te.netItems = now;
    if (ch.length) this.send({ t: 'tile', x: te.x, y: te.y, z: te.z, ch, it: now });
  }

  openTile(te) {
    if (te) this.send({ t: 'open', x: te.x, y: te.y, z: te.z });
  }

  closeTile() {
    this.send({ t: 'close' });
  }

  // Entities the local player creates (drops, arrows, xp, lit TNT) are made
  // by the server. Collected and sent after the current action so any
  // changes made right after creation (like a velocity) are included.
  spawnEntity(e) {
    this.spawnQueue.push(e);
    if (this.spawnQueue.length === 1) queueMicrotask(() => this.flushSpawns());
  }

  flushSpawns() {
    const list = this.spawnQueue;
    this.spawnQueue = [];
    for (const e of list) {
      const p = [round2(e.x), round2(e.y), round2(e.z)];
      const v = [round2(e.vx), round2(e.vy), round2(e.vz)];
      if (e instanceof ItemEntity) this.send({ t: 'spawn', e: { k: 'i', p, v, s: packStack(e.stack), d: e.pickupDelay } });
      else if (e instanceof XPOrb) this.send({ t: 'spawn', e: { k: 'x', p, v, n: e.value } });
      else if (e instanceof Projectile) this.send({ t: 'spawn', e: { k: 'p', p, v: [e.vx, e.vy, e.vz], kind: e.kind, c: e.crit ? 1 : 0 } });
      else if (e instanceof PrimedTNT) this.send({ t: 'spawn', e: { k: 't', p: [Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)], f: e.fuse } });
      else if (e instanceof Mob) this.send({ t: 'spawn', e: { k: 'm', p, ty: e.type, b: e.baby ? 1 : 0 } });
    }
  }

  // Returns whether the hit counts (for tool wear and effects), guessing the
  // target's invulnerability time the way the server will see it.
  attack(e, player, dmg, crit) {
    if (e.remote) {
      if (this.welcome && this.welcome.server && this.welcome.server.pvp === false) return false;
      const info = this.players.find((q) => q[0] === e.netId);
      if (info && info[2] !== 'survival') return false;
    }
    this.send({ t: 'atk', i: e.netId, d: dmg, c: crit ? 1 : 0, kb: 0.4 + (player.sprinting ? 0.5 : 0) });
    if (e.localInvuln > 10 && dmg <= (e.localLastDmg || 0)) return false;
    if (!(e.localInvuln > 10)) e.localInvuln = 20;
    e.localLastDmg = dmg;
    return true;
  }

  useEntity(e, player, stack) {
    if (!wouldInteract(e, stack)) return false;
    this.send({ t: 'use', i: e.netId, s: packStack(stack) });
    return true;
  }

  // Sounds and block-break particles from the local player's actions are
  // shared with everyone nearby.
  tapSound(name, opts) {
    if (this.applying || !opts || opts.x === undefined || this.soundOut.length >= 16) return;
    if (name.startsWith('@')) {
      const [mat, kind] = name.slice(1).split(':');
      this.soundOut.push(['b', mat, kind, round2(opts.x), round2(opts.y), round2(opts.z)]);
    } else if (!NO_RELAY.has(name)) {
      this.soundOut.push(['p', name, round2(opts.x), round2(opts.y || 0), round2(opts.z), opts.pitch ? round2(opts.pitch) : 1]);
    }
  }

  tapBreak(x, y, z, id, meta) {
    if (!this.applying) this.send({ t: 'fx', bb: [x, y, z, id, meta & 15] });
  }

  // ------------------------------------------------------------ per game tick
  tick() {
    const g = this.game;
    const p = g.player;
    const world = this.world;
    if (!p || !world) return;
    // Entities made this tick (e.g. drops when dying) must reach the server
    // before the state that says the player is dead.
    if (this.spawnQueue.length) this.flushSpawns();
    this.sendState();
    // Full player record: on inventory change (quickly) and every few seconds.
    this.dataTimer++;
    if (p.inventory.version !== this.invVersion && this.dataTimer >= 5) this.sendData();
    else if (this.dataTimer >= 100) this.sendData();
    if (this.soundOut.length) {
      this.send({ t: 'snd', l: this.soundOut });
      this.soundOut = [];
    }
    this.flushOut();
  }

  sendState(force = false) {
    const p = this.game.player;
    let f = 0;
    if (p.sneaking) f |= PF.SNEAK;
    if (p.flying) f |= PF.FLY;
    if (p.sleeping) f |= PF.SLEEP;
    if (p.health <= 0) f |= PF.DEAD;
    if (p.hurtTime > 0) f |= PF.HURT;
    const inv = p.inventory;
    const held = inv.selectedStack();
    let yaw = p.yaw % (Math.PI * 2);
    if (yaw > Math.PI) yaw -= Math.PI * 2;
    if (yaw < -Math.PI) yaw += Math.PI * 2;
    const s = [round2(p.x), round2(p.y), round2(p.z), round2(yaw), round2(p.pitch), f, Math.round(p.health * 2) / 2, held ? held.id : 0,
      ...inv.armor.map((a) => (a ? a.id : 0)), this.swingCount, p.sleeping ? p.sleeping.f + 1 : 0];
    const key = s.join(',');
    this.stateAge++;
    if (!force && key === this.lastState && this.stateAge < 20) return;
    this.lastState = key;
    this.stateAge = 0;
    this.send({ t: 'st', s });
  }

  sendData() {
    const g = this.game;
    if (!g.player) return;
    this.dataTimer = 0;
    this.invVersion = g.player.inventory.version;
    this.send({ t: 'pd', d: g.savePlayer(g.player) });
  }

  // ------------------------------------------------------------ incoming
  onBinary(buf) {
    const f = parseFrame(buf);
    if (f.type !== FRAME_CHUNK) return;
    const data = decodeChunkPayload(f.payload);
    if (this.loader) this.loader.receiveNet(f.cx, f.cz, data);
  }

  handle(m) {
    const g = this.game;
    const p = g.player;
    const world = this.world;
    switch (m.t) {
      case 'b': {
        if (!world) return;
        const l = m.l;
        for (let i = 0; i + 4 < l.length; i += 5) {
          if (!world.applyRemote(l[i], l[i + 1], l[i + 2], l[i + 3], l[i + 4]) && this.loader) {
            // Not in the world yet: it may be waiting to be added; update that copy.
            this.loader.patchArrived(l[i], l[i + 1], l[i + 2], l[i + 3], l[i + 4]);
          }
        }
        return;
      }
      case 'chg':
        this.changed.add(m.k);
        return;
      case 'gen':
        this.changed.delete(m.k);
        if (this.loader) this.loader.receiveGenerate(m.k);
        return;
      case 'e':
        return this.onEntities(m);
      case 'snd':
        return this.onSounds(m.l);
      case 'fx':
        return this.onEffects(m.l);
      case 'time':
        if (!world) return;
        world.time = m.tm;
        world.day = m.d;
        world.weather.raining = !!m.r;
        return;
      case 'chat':
        g.ui.chat(String(m.m), m.c);
        return;
      case 'msg':
        g.ui.message(String(m.m));
        return;
      case 'pl':
        this.players = m.l;
        if (g.ui.playerListEl) g.ui.showPlayerList(true);
        return;
      case 'kick':
        this.reason = m.reason || 'Kicked from the server';
        return;
      case 'cfg':
        if (Number.isInteger(m.diff)) g.difficulty = m.diff;
        if (m.rules && world) Object.assign(world.rules, m.rules);
        return;
      case 'op':
        if (this.welcome) this.welcome.op = !!m.on;
        return;
      case 'tile': {
        const te = world && world.getTileEntity(m.x, m.y, m.z);
        if (!te || !Array.isArray(m.it)) return;
        for (let i = 0; i < te.items.length; i++) te.items[i] = unpackStack(m.it[i]);
        te.netItems = te.items.map(packStack);
        if (te.type === 'furnace') {
          te.burn = m.b | 0;
          te.burnMax = m.bm | 0;
          te.cook = m.ck | 0;
        }
        return;
      }
      default:
    }
    if (!p) return;
    switch (m.t) {
      case 'hurt': {
        const src = { type: m.ty };
        if (m.sx !== undefined) src.entity = { x: m.sx, z: m.sz, displayName: m.by, isPlayer: !!m.bp };
        p.damage(m.a, src);
        return;
      }
      case 'kb':
        p.knockback(m.x, m.z, m.s);
        return;
      case 'push':
        p.vx += m.v[0];
        p.vy += m.v[1];
        p.vz += m.v[2];
        return;
      case 'xp':
        p.addXP(m.n);
        g.audio.play('orb', { pitch: 0.8 + Math.random() * 0.5 });
        return;
      case 'xpl':
        p.xpLevel = Math.max(0, p.xpLevel + (m.n | 0));
        return;
      case 'give': {
        const s = deserializeStack(m.s);
        if (!s) return;
        const left = p.inventory.add(s);
        if (left > 0) {
          // No room after all: put it back on the ground and correct the server's copy.
          g.dropItem(p.x, p.y + 0.5, p.z, { ...s, count: left }, null, true);
          this.sendData();
        }
        return;
      }
      case 'clear':
        p.inventory.clear();
        return;
      case 'held': {
        // Apply to the item that was used, even if the hotbar has moved since.
        const inv = p.inventory;
        const sel = inv.selected;
        const slot = m.id === undefined || (inv.slots[sel] && inv.slots[sel].id === m.id) ? sel : inv.slots.findIndex((s, i) => i < 9 && s && s.id === m.id);
        if (slot < 0 || !inv.slots[slot]) {
          if (m.op === 'exchange' && I[m.item] !== undefined && p.mode !== 'creative') {
            const left = inv.add({ id: I[m.item], count: 1, dmg: 0 });
            if (left) g.dropItem(p.x, p.y + 0.5, p.z, { id: I[m.item], count: 1, dmg: 0 }, null, true);
          }
          return;
        }
        inv.selected = slot;
        try {
          if (m.op === 'consume') p.consumeSelected(m.n | 0);
          else if (m.op === 'damage') p.damageHeld(m.n | 0);
          else if (m.op === 'exchange' && I[m.item] !== undefined) p.exchangeHeld(m.item);
        } finally {
          inv.selected = sel;
        }
        return;
      }
      case 'untake': {
        // The container had less than we took (someone else got there first): hand the rest back.
        const s = deserializeStack(m.s);
        if (!s) return;
        let n = s.count;
        const cur = g.ui.containers.cursor;
        if (cur && cur.id === s.id && (cur.dmg || 0) === (s.dmg || 0)) {
          const k = Math.min(cur.count, n);
          cur.count -= k;
          n -= k;
          if (cur.count <= 0) g.ui.containers.cursor = null;
        }
        for (let i = 0; i < p.inventory.slots.length && n > 0; i++) {
          const st = p.inventory.slots[i];
          if (!st || st.id !== s.id || (st.dmg || 0) !== (s.dmg || 0)) continue;
          const k = Math.min(st.count, n);
          st.count -= k;
          n -= k;
          if (st.count <= 0) p.inventory.slots[i] = null;
        }
        p.inventory.changed();
        return;
      }
      case 'mode':
        p.setMode(m.m);
        if (g.meta) g.meta.mode = m.m;
        if (g.ui.containers.open) g.ui.containers.close(true);
        return;
      case 'tp':
        if (p.sleeping) p.wakeUp(false);
        p.teleport(m.p[0], m.p[1], m.p[2]);
        this.sendState(true);
        return;
      case 'kill':
        p.health = Math.min(p.health, 1);
        p.invuln = 0;
        p.damage(1000, { type: 'void' });
        return;
      case 'heal':
        p.health = p.maxHealth;
        p.food = 20;
        p.saturation = 5;
        p.fireTicks = 0;
        p.air = 300;
        return;
      case 'setspawn':
        p.spawn = { x: m.p[0], y: m.p[1], z: m.p[2] };
        return;
      case 'wspawn':
        if (g.meta) g.meta.spawn = m.s;
        return;
      case 'wake':
        p.wakeUp(true);
        return;
      default:
    }
  }

  onEntities(m) {
    const world = this.world;
    if (!world) return;
    for (const id of m.r || []) {
      const e = this.proxies.get(id);
      if (e) {
        e.dead = true;
        this.proxies.delete(id);
      }
    }
    for (const s of m.s || []) {
      const old = this.proxies.get(s.i);
      if (old) old.dead = true;
      const e = createProxy(world, s, this);
      if (!e) continue;
      this.proxies.set(s.i, e);
      world.entities.push(e);
    }
    for (const u of m.u || []) {
      const e = this.proxies.get(u[0]);
      if (e) applyState(e, u.slice(1));
    }
  }

  onSounds(list) {
    const a = this.game.audio;
    this.applying = true;
    try {
      for (const s of list || []) {
        if (s[0] === 'p') a.play(s[1], { x: s[2], y: s[3], z: s[4], pitch: s[5] || 1, range: s[6] });
        else if (s[0] === 'b') a.blockSound(s[1], s[2], s[3], s[4], s[5]);
      }
    } finally {
      this.applying = false;
    }
  }

  onEffects(list) {
    const parts = this.game.gfx.particles;
    this.applying = true;
    try {
      for (const f of list || []) {
        if (f[0] === 'e') parts.emit(f[1], f[2], f[3], f[4], f[5] && typeof f[5] === 'object' ? { ...f[5] } : {});
        else if (f[0] === 'bb') parts.blockBreak(f[1], f[2], f[3], f[4], f[5]);
      }
    } finally {
      this.applying = false;
    }
  }
}
