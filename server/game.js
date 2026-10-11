// The multiplayer world: one authoritative simulation shared by everyone.
//
// The server runs the world rules (block updates, fluids, crops, furnaces,
// mobs, items, TNT, arrows, time and weather) at 20 ticks per second and keeps
// chunks loaded around players. Browsers generate untouched terrain from the
// seed themselves and only download chunks that players have changed.
import { performance } from 'node:perf_hooks';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { GameCore } from '../js/game/core.js';
import { World, NOTIFY, SILENT } from '../js/world/world.js';
import { Chunk } from '../js/world/chunk.js';
import { Spawner, randomWool } from '../js/entity/spawner.js';
import { Mob, createMob, MOB_TYPES } from '../js/entity/mobs.js';
import { ItemEntity, XPOrb, FallingBlock, PrimedTNT, Projectile } from '../js/entity/objects.js';
import { serializeTile, deserializeTile } from '../js/world/tileentities.js';
import { serializeStack, deserializeStack } from '../js/game/inventory.js';
import { chunkKey, SEA_LEVEL, DAY_LENGTH } from '../js/world/constants.js';
import { BLOCKS, isSolid } from '../js/data/blocks.js';
import { ITEMS, maxStack } from '../js/data/items.js';
import { seedFromInput } from '../js/util/rng.js';
import { PROTOCOL, MF, MODES, round2, encodeChunkPayload, CHUNK_PAYLOAD_SIZE, isNum, clampInt, cleanName, cleanText } from '../js/net/protocol.js';
import { GenPool } from './genpool.js';
import { RemotePlayer } from './remote-player.js';
import { ServerCommands } from './commands.js';

const ENTITY_RANGE = 96; // blocks; entities further away are not sent
const EFFECT_RANGE = 32;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const near = (p, x, y, z, r) => (p.x - x) ** 2 + (p.y + 1 - y) ** 2 + (p.z - z) ** 2 <= r * r;

// Sounds the world makes go to the browsers that are close enough to hear them.
class NetAudio {
  constructor(game) {
    this.game = game;
  }

  play(name, opts = {}) {
    if (!isNum(opts.x) || !isNum(opts.z)) return; // non-positional sounds belong to one browser
    const range = opts.range || EFFECT_RANGE;
    const e = ['p', name, round2(opts.x), round2(opts.y || 0), round2(opts.z), opts.pitch ? round2(opts.pitch) : 1];
    if (opts.range) e.push(opts.range);
    this.game.effect(e, opts.x, opts.z, range, false);
  }

  blockSound(material, kind, x, y, z) {
    this.game.effect(['b', material, kind, round2(x), round2(y), round2(z)], x, z, 24, false);
  }

  setRain() {}
}

class NetParticles {
  constructor(game) {
    this.game = game;
  }

  emit(type, x, y, z, opts) {
    const e = ['e', type, round2(x), round2(y), round2(z)];
    if (opts && Object.keys(opts).length) e.push(opts);
    this.game.effect(e, x, z, EFFECT_RANGE, true);
  }

  blockBreak(x, y, z, id, meta) {
    this.game.effect(['bb', x, y, z, id, meta], x, z, EFFECT_RANGE, true);
  }

  blockHit() {}
  add() {}
}

function parseStack(a) {
  if (!Array.isArray(a)) return null;
  const [id, count, dmg] = a;
  if (!Number.isInteger(id) || !ITEMS[id]) return null;
  if (!Number.isInteger(count) || count < 1 || count > 64) return null;
  const d = Number.isInteger(dmg) && dmg >= 0 ? dmg : 0;
  return { id, count: Math.min(count, maxStack(id)), dmg: d };
}

const packStack = (s) => (s ? [s.id, s.count, s.dmg || 0] : null);

export class ServerGame extends GameCore {
  constructor(cfg, storage) {
    super();
    this.cfg = cfg;
    this.storage = storage;
    this.clients = new Set();
    this.online = new Map(); // lower-case name -> RemotePlayer
    this.readyPlayers = [];
    this.audio = new NetAudio(this);
    this.gfx = { particles: new NetParticles(this) };
    this.changes = [];
    this.fx = [];
    this.loading = new Set();
    this.arrived = [];
    this.simChunks = [];
    this.lastSleepCount = 0;
    this.tileEditor = null;
    this.stopped = false;
    this.tickNo = 0; // server ticks (the world clock pauses while nobody plays)
  }

  get players() {
    return this.readyPlayers;
  }

  // ------------------------------------------------------------ startup
  init() {
    const cfg = this.cfg;
    let level = this.storage.loadLevel();
    const fresh = !level;
    if (!level) {
      level = {
        name: cfg.worldName, seed: seedFromInput(cfg.seed), created: Date.now(), time: 1000, day: 0, tickCount: 0,
        difficulty: cfg.difficulty, gamemode: cfg.gamemode, rules: {}, weather: null, spawn: null, version: 1,
      };
    }
    this.level = level;
    this.difficulty = level.difficulty ?? cfg.difficulty;
    this.world = new World(this, { seed: level.seed, time: level.time, day: level.day, tickCount: level.tickCount, weather: level.weather, rules: level.rules });
    const scan = this.storage.scan();
    this.changedChunks = scan.chunks;
    this.entityRecords = scan.entities;
    this.gen = new GenPool(level.seed);
    if (!level.spawn) level.spawn = this.findSpawn();
    this.ops = new Set(this.storage.loadList('ops').map((n) => String(n).toLowerCase()));
    for (const n of cfg.ops) this.ops.add(n.toLowerCase());
    this.bans = new Set(this.storage.loadList('banned-players').map((n) => String(n).toLowerCase()));
    this.ipBans = new Set(this.storage.loadList('banned-ips').map(String));
    this.commands = new ServerCommands(this);
    this.spawner = new Spawner(this);
    this.world.onChange = (x, y, z, id, meta) => this.onBlockChange(x, y, z, id, meta);
    this.world.onTileChange = (te) => this.onTileChange(te);
    this.storage.saveLevel(this.levelRecord(), true);
    return { fresh, chunks: this.changedChunks.size };
  }

  // World spawn: a dry, grassy column near the origin, on top of any trees.
  findSpawn() {
    const s = this.world.gen.findSpawn();
    const x = Math.floor(s.x), z = Math.floor(s.z);
    const data = this.gen.generateSync(x >> 4, z >> 4);
    const col = (x & 15) | ((z & 15) << 4);
    let y = 127;
    while (y > 0 && data.blocks[col | (y << 8)] === 0) y--;
    return { x: x + 0.5, y: Math.max(y + 1, SEA_LEVEL + 1), z: z + 0.5 };
  }

  levelRecord() {
    const w = this.world;
    return {
      ...this.level, time: w.time, day: w.day, tickCount: w.tickCount, weather: { ...w.weather }, rules: { ...w.rules },
      difficulty: this.difficulty, lastSaved: Date.now(),
    };
  }

  isOp(name) {
    return this.ops.has(name.toLowerCase());
  }

  setOp(name, on) {
    const lower = name.toLowerCase();
    if (on) this.ops.add(lower);
    else this.ops.delete(lower);
    this.storage.saveList('ops', [...this.ops]);
    const p = this.online.get(lower);
    if (p) {
      p.op = on;
      p.send({ t: 'op', on });
    }
  }

  // ------------------------------------------------------------ connections
  addClient(conn) {
    this.clients.add(conn);
  }

  join(conn, m) {
    const cfg = this.cfg;
    if (m.v !== PROTOCOL) return conn.kick('This server runs a different version of the game. Refresh the page to update.');
    const name = cleanName(m.name);
    if (!name) return conn.kick('Pick a name with 1 to 16 letters, numbers, spaces, - or _');
    const lower = name.toLowerCase();
    if (cfg.password && m.pw !== cfg.password) return conn.kick('Wrong server password');
    if (this.bans.has(lower) || this.ipBans.has(conn.ip)) return conn.kick('You are banned from this server');
    if (typeof m.key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(m.key)) return conn.kick('Your browser did not send a player key. Refresh the page and try again.');
    const keyHash = sha256(m.key);
    const existing = this.online.get(lower);
    if (existing) {
      if (existing.keyHash !== keyHash) return conn.kick(`"${name}" is already playing on this server`);
      // Same player in a new tab: save the old session first so nothing is lost.
      this.savePlayer(existing, true);
      existing.conn.kick('You joined from another tab or device');
      this.online.delete(lower);
    }
    const record = this.storage.loadPlayer(name);
    if (record && record.keyHash && record.keyHash !== keyHash) {
      return conn.kick(`The name "${name}" already belongs to another player on this server. Pick a different name.`);
    }
    if (this.online.size >= cfg.maxPlayers) return conn.kick(`The server is full (${cfg.maxPlayers} players)`);

    const p = new RemotePlayer(this.world, conn, name);
    p.keyHash = keyHash;
    p.record = record || { name, keyHash, firstJoined: Date.now() };
    p.mode = record && MODES.includes(record.mode) ? record.mode : this.level.gamemode || 'survival';
    if (!this.isOp(name) && this.ops.size === 0 && cfg.autoOp) {
      this.setOp(name, true);
      console.log(`[ops] ${name} is the first player, so they are now an operator (admin). Use "deop ${name}" in this console to undo.`);
    }
    p.op = this.isOp(name);
    const d = record && record.data && typeof record.data === 'object' ? record.data : null;
    if (d) p.applyData(d);
    const sp = this.level.spawn;
    const pos = d && [d.x, d.y, d.z].every(isNum) ? [d.x, d.y, d.z] : [sp.x, sp.y, sp.z];
    p.setPos(pos[0], pos[1], pos[2]);
    p.health = d && isNum(d.health) && d.health > 0 ? d.health : 20;
    conn.player = p;
    conn.vd = Math.min(cfg.viewDistance, clampInt(m.vd, 2, 32) ?? 8);
    this.online.set(lower, p);
    const w = this.world;
    conn.send({
      t: 'welcome', v: PROTOCOL, id: p.id, name, op: p.op, mode: p.mode, data: d,
      server: { name: cfg.serverName, motd: cfg.motd, pvp: cfg.pvp, maxPlayers: cfg.maxPlayers },
      seed: w.seed, time: w.time, day: w.day, raining: w.weather.raining, strength: w.weather.strength,
      rules: w.rules, difficulty: this.difficulty, spawn: this.level.spawn, vd: conn.vd,
      changed: [...this.changedChunks],
    });
    conn.flush();
    this.updateChunks();
    console.log(`[join] ${name} connected from ${conn.ip}${record ? '' : ' (new player)'}`);
  }

  leave(conn) {
    this.clients.delete(conn);
    const p = conn.player;
    if (!p) return;
    conn.player = null;
    if (this.online.get(p.name.toLowerCase()) === p) this.online.delete(p.name.toLowerCase());
    p.dead = true;
    this.savePlayer(p);
    const wasReady = p.ready;
    p.ready = false;
    this.refreshPlayers();
    if (wasReady) {
      this.broadcastChat(`${p.name} left the game`, '#ffe14d');
      console.log(`[leave] ${p.name} disconnected${conn.reason ? ': ' + conn.reason : ''}`);
    }
  }

  refreshPlayers() {
    this.readyPlayers = [...this.online.values()].filter((p) => p.ready);
    this.sendPlayerList();
  }

  sendPlayerList() {
    const l = [...this.online.values()].filter((p) => p.ready).map((p) => [p.id, p.name, p.mode, p.conn.ping || 0, p.op ? 1 : 0]);
    this.broadcast({ t: 'pl', l });
  }

  savePlayer(p, sync = false) {
    const rec = p.record;
    const d = p.data ? { ...p.data } : {};
    if (p.ready) {
      d.x = p.x;
      d.y = p.y;
      d.z = p.z;
      d.yaw = p.yaw;
      d.pitch = p.pitch;
      d.health = p.health > 0 ? p.health : 20;
    }
    rec.data = Object.keys(d).length ? d : rec.data || null;
    rec.mode = p.mode;
    rec.keyHash = p.keyHash;
    rec.lastSeen = Date.now();
    return this.storage.savePlayer(p.name, rec, sync);
  }

  broadcast(m, except = null) {
    for (const c of this.clients) if (c !== except && c.player) c.send(m);
  }

  broadcastChat(text, color, except = null) {
    this.broadcast(color ? { t: 'chat', m: text, c: color } : { t: 'chat', m: text }, except);
  }

  findPlayer(name) {
    const n = String(name || '').toLowerCase();
    if (this.online.has(n)) return this.online.get(n);
    const matches = [...this.online.values()].filter((p) => p.name.toLowerCase().startsWith(n));
    return matches.length === 1 ? matches[0] : null;
  }

  // ------------------------------------------------------------ messages
  handle(conn, m) {
    const p = conn.player;
    if (!p) {
      if (m.t === 'hello' && !conn.helloSeen) {
        conn.helloSeen = true;
        this.join(conn, m);
      }
      return;
    }
    switch (m.t) {
      case 'ready':
        if (!p.ready) {
          p.ready = true;
          p.dead = false;
          this.refreshPlayers();
          this.broadcastChat(`${p.name} joined the game`, '#ffe14d');
        }
        return;
      case 'st':
        p.applyState(m.s);
        return;
      case 'pd':
        if (conn.allow('pd')) p.applyData(m.d);
        return;
      case 'set':
        return this.onSet(conn, p, m);
      case 'spawn':
        return this.onSpawn(conn, p, m.e);
      case 'atk':
        return this.onAttack(conn, p, m);
      case 'use':
        return this.onUse(conn, p, m);
      case 'req':
        return this.onRequest(conn, p, m.l);
      case 'open':
        return this.onOpen(conn, p, m);
      case 'close':
        conn.viewing = null;
        return;
      case 'tile':
        return this.onTile(conn, p, m);
      case 'chat':
        return this.onChat(conn, p, m);
      case 'snd':
        return this.onRelaySound(conn, p, m.l);
      case 'fx':
        return this.onRelayFx(conn, p, m.bb);
      case 'death':
        if (conn.allow('chat')) {
          const text = cleanText(m.m, 200) || `${p.name} died`;
          console.log(`[death] ${text}`);
          this.broadcastChat(text, null, conn);
        }
        return;
      case 'vd':
        conn.vd = Math.min(this.cfg.viewDistance, clampInt(m.vd, 2, 32) ?? conn.vd);
        return;
      default:
    }
  }

  onSet(conn, p, m) {
    const x = clampInt(m.x, -3e7, 3e7), y = clampInt(m.y, 0, 127), z = clampInt(m.z, -3e7, 3e7);
    const id = clampInt(m.b, 0, 254), meta = clampInt(m.m ?? 0, 0, 255);
    if (x === null || y === null || z === null || id === null || meta === null) return;
    const world = this.world;
    const cur = world.getBlock(x, y, z);
    if (cur === 255) return;
    const reach = p.mode === 'creative' ? 12 : 10;
    const ok = p.alive && p.mode !== 'spectator' && (id === 0 || BLOCKS[id]) && near(p, x + 0.5, y + 0.5, z + 0.5, reach) && conn.allow('set');
    if (!ok) {
      // Undo the browser's guess.
      conn.send({ t: 'b', l: [x, y, z, cur, world.getMeta(x, y, z)] });
      return;
    }
    world.setBlock(x, y, z, id, meta, m.f === 0 ? SILENT : NOTIFY);
  }

  onSpawn(conn, p, e) {
    if (!e || typeof e !== 'object' || !p.alive || p.mode === 'spectator') return;
    if (!conn.allow('spawn')) return;
    const pos = Array.isArray(e.p) ? e.p : null;
    if (!pos || pos.length !== 3 || !pos.every(isNum) || !near(p, pos[0], pos[1], pos[2], 10)) return;
    const vel = Array.isArray(e.v) && e.v.length === 3 && e.v.every(isNum) ? e.v.map((v) => Math.max(-4, Math.min(4, v))) : [0, 0, 0];
    const [x, y, z] = pos;
    const world = this.world;
    switch (e.k) {
      case 'i': {
        const s = parseStack(e.s);
        if (!s) return;
        this.dropItemWithVelocity(x, y, z, s, vel[0], vel[1], vel[2], clampInt(e.d, 0, 200) ?? 10);
        return;
      }
      case 'x': {
        const n = clampInt(e.n, 1, 2477);
        if (n === null) return;
        const orb = new XPOrb(world, x, y, z, n);
        [orb.vx, orb.vy, orb.vz] = vel;
        this.addEntity(orb);
        return;
      }
      case 'p': {
        if (!['arrow', 'snowball', 'egg'].includes(e.kind)) return;
        this.spawnProjectile(p, x, y, z, vel[0], vel[1], vel[2], e.kind, !!e.c);
        return;
      }
      case 't': {
        const fuse = clampInt(e.f, 1, 200) ?? 80;
        this.addEntity(new PrimedTNT(world, Math.floor(x), Math.floor(y), Math.floor(z), fuse));
        return;
      }
      case 'm': {
        if (p.mode !== 'creative' || !MOB_TYPES[e.ty]) return;
        this.spawnMob(e.ty, x, y, z, { baby: !!e.b, wool: randomWool() });
        return;
      }
      default:
    }
  }

  findEntity(id) {
    if (!Number.isInteger(id)) return null;
    for (const e of this.world.entities) if (e.id === id) return e;
    for (const q of this.readyPlayers) if (q.id === id) return q;
    return null;
  }

  onAttack(conn, p, m) {
    if (!p.alive || p.mode === 'spectator' || !conn.allow('atk')) return;
    const t = this.findEntity(m.i);
    if (!t || t === p || t.dead || p.distanceTo(t) > 8) return;
    const dmg = isNum(m.d) ? Math.max(0, Math.min(30, m.d)) : 1;
    const kb = isNum(m.kb) ? Math.max(0, Math.min(1.5, m.kb)) : 0.4;
    if (t.isPlayer) {
      if (!this.cfg.pvp || t.mode !== 'survival') return;
      if (t.damage(dmg, { type: 'player', entity: p })) t.knockback(p.x, p.z, kb);
      return;
    }
    if (!t.onPlayerAttack || !t.onPlayerAttack(p, dmg, !!m.c)) return;
    if (m.c) for (let i = 0; i < 12; i++) this.effect(['e', 'crit', round2(t.x), round2(t.y + t.h * 0.6), round2(t.z)], t.x, t.z, EFFECT_RANGE, true, conn);
    if (t.knockback) t.knockback(p.x, p.z, kb);
  }

  onUse(conn, p, m) {
    if (!p.alive || p.mode === 'spectator' || !conn.allow('atk')) return;
    const t = this.findEntity(m.i);
    const s = parseStack(m.s);
    if (!t || !s || t.dead || !t.onInteract || p.distanceTo(t) > 8) return;
    t.onInteract(p, s);
  }

  onChat(conn, p, m) {
    const text = cleanText(m.m, 256);
    if (!text) return;
    if (!conn.allow('chat')) {
      p.chat('You are sending messages too quickly', '#ff6b6b');
      return;
    }
    if (text.startsWith('/')) {
      console.log(`[cmd] ${p.name}: ${text}`);
      this.commands.run(p, text);
      return;
    }
    console.log(`<${p.name}> ${text}`);
    this.broadcastChat(`<${p.name}> ${text}`);
  }

  // Sounds a player's own actions make (footsteps, placing, doors...) for everyone nearby.
  onRelaySound(conn, p, list) {
    if (!Array.isArray(list) || !p.ready) return;
    for (const s of list.slice(0, 16)) {
      if (!Array.isArray(s) || !conn.allow('fx')) continue;
      if (s[0] === 'p' && typeof s[1] === 'string' && /^[a-z_]{1,32}$/.test(s[1]) && [s[2], s[3], s[4]].every(isNum) && near(p, s[2], s[3], s[4], 24)) {
        this.effect(['p', s[1], round2(s[2]), round2(s[3]), round2(s[4]), isNum(s[5]) ? Math.max(0.3, Math.min(3, s[5])) : 1], s[2], s[4], EFFECT_RANGE, false, conn);
      } else if (s[0] === 'b' && typeof s[1] === 'string' && /^[a-z_]{1,16}$/.test(s[1]) && ['step', 'hit', 'place', 'break'].includes(s[2]) && [s[3], s[4], s[5]].every(isNum) && near(p, s[3], s[4], s[5], 24)) {
        this.effect(['b', s[1], s[2], round2(s[3]), round2(s[4]), round2(s[5])], s[3], s[5], 24, false, conn);
      }
    }
  }

  onRelayFx(conn, p, bb) {
    if (!Array.isArray(bb) || bb.length !== 5 || !bb.every(Number.isInteger) || !p.ready || !conn.allow('fx')) return;
    const [x, y, z, id, meta] = bb;
    if (!BLOCKS[id] || !near(p, x, y, z, 16)) return;
    this.effect(['bb', x, y, z, id, meta & 15], x, z, EFFECT_RANGE, true, conn);
  }

  // ------------------------------------------------------------ containers
  tileState(te) {
    const m = { t: 'tile', x: te.x, y: te.y, z: te.z, it: te.items.map(packStack) };
    if (te.type === 'furnace') Object.assign(m, { b: te.burn, bm: te.burnMax, ck: te.cook });
    return m;
  }

  sendTile(conn, te) {
    const m = this.tileState(te);
    conn.tileSig = JSON.stringify(m);
    conn.send(m);
  }

  onOpen(conn, p, m) {
    const x = clampInt(m.x, -3e7, 3e7), y = clampInt(m.y, 0, 127), z = clampInt(m.z, -3e7, 3e7);
    if (x === null || y === null || z === null) return;
    const te = this.world.getTileEntity(x, y, z);
    if (!te || !near(p, x + 0.5, y + 0.5, z + 0.5, 10)) return;
    conn.viewing = te;
    this.sendTile(conn, te);
  }

  onTile(conn, p, m) {
    const x = clampInt(m.x, -3e7, 3e7), y = clampInt(m.y, 0, 127), z = clampInt(m.z, -3e7, 3e7);
    if (x === null || y === null || z === null) return;
    const te = this.world.getTileEntity(x, y, z);
    if (!te) return;
    if (conn.viewing !== te || !Array.isArray(m.it) || m.it.length !== te.items.length || !conn.allow('tile')) {
      this.sendTile(conn, te);
      return;
    }
    const items = m.it.map(parseStack);
    if (te.type === 'furnace') {
      // Experience stored in the furnace goes to whoever takes the output.
      const before = te.items[2] ? te.items[2].count : 0;
      const after = items[2] ? items[2].count : 0;
      if (after < before && te.xp > 0) {
        let xp = Math.floor(te.xp);
        if (Math.random() < te.xp - xp) xp++;
        te.xp = 0;
        if (xp > 0) this.spawnXP(p.x, p.y + 0.5, p.z, xp);
      }
    }
    for (let i = 0; i < items.length; i++) te.items[i] = items[i];
    this.tileEditor = conn;
    try {
      this.world.markTileDirty(te);
    } finally {
      this.tileEditor = null;
    }
  }

  onTileChange(te) {
    this.markChanged(te.x >> 4, te.z >> 4);
    for (const c of this.clients) if (c.viewing === te && c !== this.tileEditor) this.sendTile(c, te);
  }

  // Furnace gauges move every tick; viewers get a refresh a few times a second.
  syncViewedTiles() {
    for (const c of this.clients) {
      const te = c.viewing;
      if (!te) continue;
      if (this.world.getTileEntity(te.x, te.y, te.z) !== te) {
        c.viewing = null;
        continue;
      }
      if (te.type !== 'furnace') continue;
      const m = this.tileState(te);
      const sig = JSON.stringify(m);
      if (sig !== c.tileSig) {
        c.tileSig = sig;
        c.send(m);
      }
    }
  }

  // ------------------------------------------------------------ chunks
  markChanged(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this.changedChunks.has(key)) return;
    this.changedChunks.add(key);
    this.broadcast({ t: 'chg', k: key });
  }

  onBlockChange(x, y, z, id, meta) {
    this.markChanged(x >> 4, z >> 4);
    this.changes.push(x, y, z, id, meta);
  }

  onRequest(conn, p, list) {
    if (!Array.isArray(list)) return;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    for (let i = 0; i + 1 < list.length && i < 128; i += 2) {
      const cx = clampInt(list[i], -32768, 32767), cz = clampInt(list[i + 1], -32768, 32767);
      if (cx === null || cz === null || !conn.allow('req')) continue;
      if (Math.abs(cx - pcx) > 40 || Math.abs(cz - pcz) > 40) {
        conn.send({ t: 'gen', k: chunkKey(cx, cz) });
        continue;
      }
      this.sendChunk(conn, cx, cz).catch((e) => console.error('[chunk] send failed:', e.message));
    }
  }

  async sendChunk(conn, cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.world.getChunk(cx, cz);
    if (!c) {
      if (!this.changedChunks.has(key)) {
        conn.send({ t: 'gen', k: key });
        return;
      }
      const buf = await this.storage.chunkBytes(cx, cz);
      if (!this.clients.has(conn)) return;
      c = this.world.getChunk(cx, cz); // it may have loaded while we waited
      if (!c) {
        if (!buf) {
          conn.send({ t: 'gen', k: key });
          return;
        }
        const raw = zlib.inflateSync(buf);
        conn.sendChunk(cx, cz, raw.subarray(4, 4 + CHUNK_PAYLOAD_SIZE));
        return;
      }
    }
    conn.sendChunk(cx, cz, encodeChunkPayload(c));
  }

  loadChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    this.loading.add(key);
    (async () => {
      let data = null;
      let fromSave = false;
      if (this.changedChunks.has(key)) {
        try {
          const buf = await this.storage.chunkBytes(cx, cz);
          if (buf) {
            data = this.storage.unpackChunk(buf);
            fromSave = true;
          }
        } catch (e) {
          console.error(`[chunk] ${cx},${cz} could not be read (${e.message}); regenerating it`);
        }
      }
      if (!data) data = await this.gen.generate(cx, cz);
      this.arrived.push({ cx, cz, data, fromSave });
    })().catch((e) => {
      console.error(`[chunk] ${cx},${cz} failed to load:`, e);
      this.loading.delete(key);
    });
  }

  nearPlayer(cx, cz, r) {
    for (const p of this.online.values()) {
      if (Math.abs((Math.floor(p.x) >> 4) - cx) <= r && Math.abs((Math.floor(p.z) >> 4) - cz) <= r) return true;
    }
    return false;
  }

  integrateChunks(budgetMs) {
    const t0 = performance.now();
    const keepR = this.cfg.simDistance + 3;
    while (this.arrived.length && performance.now() - t0 < budgetMs) {
      const a = this.arrived.shift();
      this.loading.delete(chunkKey(a.cx, a.cz));
      if (this.world.getChunk(a.cx, a.cz) || !this.nearPlayer(a.cx, a.cz, keepR)) continue;
      const c = new Chunk(a.cx, a.cz, a.data);
      c.changed = a.fromSave;
      if (a.fromSave && Array.isArray(a.data.tiles)) {
        for (const t of a.data.tiles) {
          const i = (t.x & 15) | ((t.z & 15) << 4) | (t.y << 8);
          const te = deserializeTile(t, c.blocks[i]);
          if (te) c.tileEntities.set(i, te);
        }
      }
      this.world.addChunk(c);
      this.populate(c, a.data);
    }
  }

  populate(c, data) {
    const key = chunkKey(c.cx, c.cz);
    const world = this.world;
    if (this.entityRecords.has(key)) {
      c.hasEntityRecord = true;
      this.storage.loadEntities(c.cx, c.cz).then((rec) => {
        if (!rec || world.getChunk(c.cx, c.cz) !== c) return;
        for (const m of rec.mobs || []) {
          if (![m.x, m.y, m.z].every(isNum)) continue;
          const mob = createMob(world, m.type, m.x, m.y, m.z, { yaw: m.yaw, health: m.health, baby: m.baby, sheared: m.sheared, wool: m.wool });
          if (!mob) continue;
          if (m.grow !== undefined) mob.growTimer = m.grow;
          this.addEntity(mob);
        }
        for (const it of rec.items || []) {
          const st = deserializeStack(it.s);
          if (!st || ![it.x, it.y, it.z].every(isNum)) continue;
          const e = new ItemEntity(world, it.x, it.y, it.z, st);
          e.vx = e.vy = e.vz = 0;
          e.age = it.age || 0;
          this.addEntity(e);
        }
        c.entitySig = JSON.stringify(rec);
      });
    } else if (data.spawns && data.spawns.length) {
      c.hasEntityRecord = true;
      this.entityRecords.add(key);
      for (const s of data.spawns) this.addEntity(new Mob(world, s.type, s.x, s.y, s.z, { wool: randomWool() }));
    }
  }

  entitiesIn(c) {
    const out = [];
    for (const e of this.world.entities) {
      if (e.dead) continue;
      if ((Math.floor(e.x) >> 4) === c.cx && (Math.floor(e.z) >> 4) === c.cz) out.push(e);
    }
    return out;
  }

  entityRecord(list) {
    const mobs = [], items = [];
    for (const e of list) {
      if (e instanceof Mob && e.persistent && e.alive) mobs.push(e.serialize());
      else if (e instanceof ItemEntity) items.push({ x: e.x, y: e.y, z: e.z, s: serializeStack(e.stack), age: e.age });
    }
    return { mobs, items };
  }

  tilesOf(c) {
    return [...c.tileEntities.values()].map(serializeTile);
  }

  saveChunkEntities(c, ents) {
    if (!ents.length && !c.hasEntityRecord) return;
    const rec = this.entityRecord(ents);
    const sig = JSON.stringify(rec);
    if (sig === c.entitySig) return;
    c.entitySig = sig;
    c.hasEntityRecord = true;
    this.entityRecords.add(chunkKey(c.cx, c.cz));
    this.storage.saveEntities(c.cx, c.cz, rec);
  }

  unloadChunk(c) {
    if (c.modified) {
      this.storage.saveChunk(c, this.tilesOf(c));
      c.modified = false;
    }
    const ents = this.entitiesIn(c);
    this.saveChunkEntities(c, ents);
    for (const e of ents) e.remove();
    this.world.removeChunk(c);
  }

  updateChunks() {
    const R = this.cfg.simDistance;
    const loadR = R + 1, keepR = R + 3;
    const centers = [];
    for (const p of this.online.values()) centers.push([Math.floor(p.x) >> 4, Math.floor(p.z) >> 4, p.ready]);
    const want = [];
    const sim = new Map();
    for (const [pcx, pcz, ready] of centers) {
      for (let dz = -loadR; dz <= loadR; dz++) {
        for (let dx = -loadR; dx <= loadR; dx++) {
          const cx = pcx + dx, cz = pcz + dz;
          const key = chunkKey(cx, cz);
          if (!this.world.chunks.has(key) && !this.loading.has(key)) want.push([dx * dx + dz * dz, cx, cz, key]);
          if (ready && Math.abs(dx) <= R && Math.abs(dz) <= R) sim.set(key, [cx, cz]);
        }
      }
    }
    this.simChunks = [...sim.values()];
    want.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz, key] of want) {
      if (this.loading.size >= 32) break;
      if (!this.loading.has(key)) this.loadChunk(cx, cz);
    }
    for (const c of this.world.chunks.values()) {
      let keep = false;
      for (const [pcx, pcz] of centers) {
        if (Math.abs(c.cx - pcx) <= keepR && Math.abs(c.cz - pcz) <= keepR) {
          keep = true;
          break;
        }
      }
      if (!keep) this.unloadChunk(c);
    }
  }

  // ------------------------------------------------------------ simulation
  inSimRange(e) {
    const r = this.cfg.simDistance * 16;
    for (const p of this.readyPlayers) if (Math.abs(e.x - p.x) <= r && Math.abs(e.z - p.z) <= r) return true;
    return false;
  }

  tick() {
    const t0 = performance.now();
    this.tickInner();
    const ms = performance.now() - t0;
    this.mspt = this.mspt === undefined ? ms : this.mspt * 0.95 + ms * 0.05;
  }

  tickInner() {
    const world = this.world;
    const n = ++this.tickNo;
    this.integrateChunks(10);
    if (n % 10 === 0) this.updateChunks();
    if (this.readyPlayers.length || this.cfg.tickWhenEmpty) {
      world.tickTime();
      world.runScheduled();
      for (const [cx, cz] of this.simChunks) world.randomTicks(cx, cz, 0);
      world.tickTiles();
      for (const p of this.readyPlayers) p.tick();
      const list = world.entities;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.dead || !this.inSimRange(e)) continue;
        if (!world.isLoadedAt(Math.floor(e.x + 1), Math.floor(e.z + 1)) || !world.isLoadedAt(Math.floor(e.x - 1), Math.floor(e.z - 1))) continue;
        e.tick();
      }
      if (world.entities.some((e) => e.dead)) world.entities = world.entities.filter((e) => !e.dead);
      this.spawner.tick();
      this.pickups();
      this.sleepTick();
    }
    // Network
    this.flushBlocks();
    if (n % 2 === 0) this.sendEntities();
    if (n % 4 === 0) this.syncViewedTiles();
    if (n % 20 === 0) this.broadcast(this.timeMessage());
    if (n % 100 === 0) this.sendPlayerList();
    this.flushEffects();
    for (const c of this.clients) c.flush();
    if (n % this.cfg.autosaveTicks === 0) this.save();
  }

  timeMessage() {
    const w = this.world;
    return { t: 'time', tm: w.time, d: w.day, r: w.weather.raining ? 1 : 0 };
  }

  pickups() {
    const list = this.world.entities;
    for (const p of this.readyPlayers) {
      if (!p.alive || p.mode === 'spectator') continue;
      const box = p.box.grow(1, 0.5, 1);
      for (const e of list) {
        if (e.dead || !e.pickup) continue;
        if (box.intersects(e.box)) e.pickup(p);
      }
    }
  }

  // Night passes once every player (except spectators) has been in bed for 5 seconds.
  sleepTick() {
    const world = this.world;
    const ps = this.readyPlayers.filter((p) => p.mode !== 'spectator');
    const asleep = ps.filter((p) => p.sleeping && p.alive);
    if (asleep.length !== this.lastSleepCount) {
      this.lastSleepCount = asleep.length;
      if (asleep.length && ps.length > 1) this.broadcast({ t: 'msg', m: `${asleep.length}/${ps.length} players sleeping` });
    }
    if (!ps.length || asleep.length < ps.length) return;
    if (!asleep.every((p) => world.tickCount - p.sleeping.since >= 100)) return;
    world.time = 0;
    world.day++;
    world.weather.raining = false;
    world.weather.strength = 0;
    world.weather.timer = 12000 + Math.floor(Math.random() * 156000);
    this.broadcast(this.timeMessage());
    for (const p of asleep) {
      p.sleeping = null;
      p.send({ t: 'wake' });
    }
  }

  // ------------------------------------------------------------ outgoing state
  effect(entry, x, z, range, isFx, except = null) {
    this.fx.push({ d: entry, x, z, r: range, fx: isFx, except });
  }

  flushEffects() {
    if (!this.fx.length) return;
    const list = this.fx;
    this.fx = [];
    for (const conn of this.clients) {
      const p = conn.player;
      if (!p || !p.ready) continue;
      let snd = null, fx = null;
      for (const f of list) {
        if (f.except === conn) continue;
        if (Math.abs(f.x - p.x) > f.r || Math.abs(f.z - p.z) > f.r) continue;
        if (f.fx) (fx || (fx = [])).push(f.d);
        else (snd || (snd = [])).push(f.d);
      }
      if (snd) conn.send({ t: 'snd', l: snd });
      if (fx) conn.send({ t: 'fx', l: fx.slice(0, 300) });
    }
  }

  flushBlocks() {
    if (!this.changes.length) return;
    const list = this.changes;
    this.changes = [];
    for (const conn of this.clients) {
      const p = conn.player;
      if (!p) continue;
      const r = (conn.vd + 3) * 16;
      let out = null;
      for (let i = 0; i < list.length; i += 5) {
        if (Math.abs(list[i] - p.x) > r || Math.abs(list[i + 2] - p.z) > r) continue;
        if (!out) out = [];
        out.push(list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4]);
      }
      if (out) conn.send({ t: 'b', l: out });
    }
  }

  // How an entity looks to the browsers: a spawn record and a compact state.
  describe(e) {
    let st, spawn;
    const x = round2(e.x), y = round2(e.y), z = round2(e.z);
    if (e instanceof Mob) {
      let f = 0;
      if (e.hurtTime > 0) f |= MF.HURT;
      if (e.health <= 0) f |= MF.DEAD;
      if (e.fireTicks > 0) f |= MF.FIRE;
      if (e.baby) f |= MF.BABY;
      if (e.sheared) f |= MF.SHEARED;
      if (e.aiming > 0 || e.target) f |= MF.AIM;
      if (e.eatingGrass > 0) f |= MF.EATING;
      if (e.attackCooldown >= 14) f |= MF.SWING;
      if (e.loveTicks > 0) f |= MF.LOVE;
      st = [x, y, z, round2(e.yaw), round2(e.headYaw), round2(e.headPitch), Math.ceil(e.health * 2) / 2, f, e.wool | 0];
      spawn = { i: e.id, k: 'm', ty: e.type, st };
    } else if (e instanceof ItemEntity) {
      st = [x, y, z, e.stack.count];
      spawn = { i: e.id, k: 'i', it: e.stack.id, dm: e.stack.dmg || 0, st };
    } else if (e instanceof XPOrb) {
      st = [x, y, z];
      spawn = { i: e.id, k: 'x', n: e.value, st };
    } else if (e instanceof FallingBlock) {
      st = [x, y, z];
      spawn = { i: e.id, k: 'f', b: e.blockId, m: e.blockMeta, st };
    } else if (e instanceof PrimedTNT) {
      st = [x, y, z];
      spawn = { i: e.id, k: 't', f: e.fuse, st };
    } else if (e instanceof Projectile) {
      st = [x, y, z, round2(e.yaw), round2(e.pitch)];
      spawn = { i: e.id, k: 'p', kind: e.kind, c: e.crit ? 1 : 0, st };
    } else if (e instanceof RemotePlayer) {
      st = e.viewState();
      spawn = { i: e.id, k: 'P', n: e.name, st };
    } else return null;
    return { key: st.join(','), spawn, upd: [e.id, ...st] };
  }

  sendEntities() {
    const cache = new Map();
    const describe = (e) => {
      let d = cache.get(e);
      if (d === undefined) {
        d = this.describe(e);
        cache.set(e, d);
      }
      return d;
    };
    for (const conn of this.clients) {
      const p = conn.player;
      if (!p || !p.ready) continue;
      if (conn.ws.bufferedAmount > 1 << 20) continue; // let a slow connection catch up
      const range = Math.min(conn.vd * 16, ENTITY_RANGE);
      const prange = conn.vd * 16 + 16;
      const seen = new Set();
      const s = [], u = [], r = [];
      const consider = (e, rng) => {
        if (Math.abs(e.x - p.x) > rng || Math.abs(e.z - p.z) > rng) return;
        const d = describe(e);
        if (!d) return;
        seen.add(e.id);
        const prev = conn.known.get(e.id);
        if (prev === undefined) s.push(d.spawn);
        else if (prev !== d.key) u.push(d.upd);
        else return;
        conn.known.set(e.id, d.key);
      };
      for (const e of this.world.entities) if (!e.dead) consider(e, range);
      for (const q of this.readyPlayers) if (q !== p && q.mode !== 'spectator') consider(q, prange);
      for (const id of conn.known.keys()) {
        if (!seen.has(id)) {
          r.push(id);
          conn.known.delete(id);
        }
      }
      if (s.length || u.length || r.length) conn.send({ t: 'e', s, u, r });
    }
  }

  // ------------------------------------------------------------ saving
  save() {
    const t0 = performance.now();
    let chunks = 0;
    for (const c of this.world.chunks.values()) {
      if (c.modified) {
        this.storage.saveChunk(c, this.tilesOf(c));
        c.modified = false;
        chunks++;
      }
      this.saveChunkEntities(c, this.entitiesIn(c));
    }
    this.storage.saveLevel(this.levelRecord());
    for (const p of this.online.values()) this.savePlayer(p);
    const ms = performance.now() - t0;
    if (this.cfg.verbose || ms > 100) console.log(`[save] saved ${chunks} chunks in ${ms.toFixed(0)} ms`);
    return this.storage.flush();
  }

  async shutdown(reason = 'The server is shutting down') {
    if (this.stopped) return;
    this.stopped = true;
    for (const c of [...this.clients]) c.kick(reason);
    for (const c of this.world.chunks.values()) {
      if (c.modified) {
        this.storage.saveChunk(c, this.tilesOf(c));
        c.modified = false;
      }
      this.saveChunkEntities(c, this.entitiesIn(c));
    }
    this.storage.saveLevel(this.levelRecord());
    for (const p of this.online.values()) this.savePlayer(p);
    await this.storage.flush();
    this.gen.close();
  }
}

export { DAY_LENGTH, isSolid, ENTITY_RANGE };
