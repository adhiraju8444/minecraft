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
import { PROTOCOL, MF, MODES, round2, encodeChunkPayload, CHUNK_PAYLOAD_SIZE, isNum, clampInt, cleanName, cleanText, nameKey } from '../js/net/protocol.js';
import { GenPool } from './genpool.js';
import { RemotePlayer, sanitizePlayerData } from './remote-player.js';
import { ServerCommands } from './commands.js';

const ENTITY_RANGE = 96; // blocks; entities further away are not sent
const MAX_ENTITIES = 4000; // no more player-made entities beyond this many in the world
const MAX_OWN_ENTITIES = 400; // items, xp, arrows and TNT one player has made that still exist
const MAX_OWN_MOBS = 40; // creatures one creative player has spawned that are still alive
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

const sameKind = (a, b) => a.id === b.id && (a.dmg || 0) === (b.dmg || 0);

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
    this.pendingEdits = new Map(); // chunk key -> block edits waiting for that chunk to load
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
    this.ops = new Set(this.storage.loadList('ops').map(nameKey));
    for (const n of cfg.ops) this.ops.add(nameKey(n));
    this.bans = new Set(this.storage.loadList('banned-players').map(nameKey));
    // The first player becomes an operator only once per world.
    if (level.autoOpDone === undefined) level.autoOpDone = this.ops.size > 0 || this.storage.hasPlayers();
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
    return this.ops.has(nameKey(name));
  }

  setOp(name, on) {
    const key = nameKey(name);
    if (on) this.ops.add(key);
    else this.ops.delete(key);
    this.storage.saveList('ops', [...this.ops]);
    const p = this.online.get(key);
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
    const lower = nameKey(name);
    if (cfg.password && m.pw !== cfg.password) return conn.kick('Wrong server password');
    if (this.bans.has(lower) || this.ipBans.has(conn.ip)) return conn.kick('You are banned from this server');
    if (typeof m.key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(m.key)) return conn.kick('Your browser did not send a player key. Refresh the page and try again.');
    const keyHash = sha256(m.key);
    const existing = this.online.get(lower);
    if (existing) {
      if (existing.keyHash !== keyHash) return conn.kick(`"${name}" is already playing on this server`);
      // Same player in a new tab: save the old session first so nothing is lost.
      this.trySavePlayer(existing, true);
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
    if (!this.level.autoOpDone) {
      this.level.autoOpDone = true;
      if (cfg.autoOp && this.ops.size === 0) {
        this.setOp(name, true);
        console.log(`[ops] ${name} is the first player, so they are now an operator (admin). Use "deop ${name}" in this console to undo; nobody else becomes one automatically.`);
      }
      this.storage.saveLevel(this.levelRecord());
    }
    p.op = this.isOp(name);
    const d = record ? sanitizePlayerData(record.data) : null;
    if (d) p.applyData(d);
    const sp = this.level.spawn;
    const pos = d && [d.x, d.y, d.z].every(isNum) ? [d.x, d.y, d.z] : [sp.x, sp.y, sp.z];
    p.setPos(pos[0], pos[1], pos[2]);
    p.health = d && isNum(d.health) && d.health > 0 ? d.health : 20;
    conn.player = p;
    this.setViewDistance(conn, m.vd);
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

  // The browser's render distance decides which block changes it needs (it
  // loads those chunks itself); entities are only sent within VIEW_DISTANCE.
  setViewDistance(conn, vd) {
    const v = clampInt(vd, 2, 32) ?? conn.loadVd ?? 8;
    conn.loadVd = v;
    conn.vd = Math.min(this.cfg.viewDistance, v);
  }

  get pvp() {
    return this.cfg.pvp;
  }

  leave(conn) {
    this.clients.delete(conn);
    const p = conn.player;
    if (!p) return;
    conn.player = null;
    if (this.online.get(nameKey(p.name)) === p) this.online.delete(nameKey(p.name));
    p.dead = true;
    this.trySavePlayer(p);
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

  // Saving one player must never stop the others (or the world) from saving.
  trySavePlayer(p, sync = false) {
    try {
      return this.savePlayer(p, sync);
    } catch (e) {
      console.error(`[save] could not save player ${p.name}: ${e.message}`);
      return null;
    }
  }

  broadcast(m, except = null) {
    for (const c of this.clients) if (c !== except && c.player) c.send(m);
  }

  broadcastChat(text, color, except = null) {
    this.broadcast(color ? { t: 'chat', m: text, c: color } : { t: 'chat', m: text }, except);
  }

  findPlayer(name) {
    const n = nameKey(name || '');
    if (!n) return null;
    if (this.online.has(n)) return this.online.get(n);
    const matches = [...this.online.values()].filter((p) => nameKey(p.name).startsWith(n));
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
          // Death messages always start with the player's own name.
          const t = cleanText(m.m, 200);
          const text = t.startsWith(p.name + ' ') ? t : `${p.name} died`;
          console.log(`[death] ${text}`);
          this.broadcastChat(text, null, conn);
        }
        return;
      case 'vd':
        this.setViewDistance(conn, m.vd);
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
    if (cur === 255) {
      // That chunk is still loading here (e.g. right after a teleport): apply the edit once it arrives.
      const key = chunkKey(x >> 4, z >> 4);
      const list = this.pendingEdits.get(key) || [];
      if (list.length < 64 && this.pendingEdits.size < 256) {
        list.push([conn, m]);
        this.pendingEdits.set(key, list);
      }
      return;
    }
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
    // Limits on how much one player (and everyone) can keep in the world.
    if (this.world.entities.length >= MAX_ENTITIES) return;
    const mine = this.ownedCount(p, e.k === 'm');
    if (mine >= (e.k === 'm' ? MAX_OWN_MOBS : MAX_OWN_ENTITIES)) return;
    const pos = Array.isArray(e.p) ? e.p : null;
    if (!pos || pos.length !== 3 || !pos.every(isNum) || !near(p, pos[0], pos[1], pos[2], 10)) return;
    const vel = Array.isArray(e.v) && e.v.length === 3 && e.v.every(isNum) ? e.v.map((v) => Math.max(-4, Math.min(4, v))) : [0, 0, 0];
    const [x, y, z] = pos;
    const world = this.world;
    switch (e.k) {
      case 'i': {
        const s = parseStack(e.s);
        if (!s) return;
        const it = this.dropItemWithVelocity(x, y, z, s, vel[0], vel[1], vel[2], clampInt(e.d, 0, 200) ?? 10);
        if (it) it.owner = p;
        return;
      }
      case 'x': {
        const n = clampInt(e.n, 1, 2477);
        if (n === null) return;
        const orb = new XPOrb(world, x, y, z, n);
        [orb.vx, orb.vy, orb.vz] = vel;
        orb.owner = p;
        this.addEntity(orb);
        return;
      }
      case 'p': {
        if (!['arrow', 'snowball', 'egg'].includes(e.kind)) return;
        this.spawnProjectile(p, x, y, z, vel[0], vel[1], vel[2], e.kind, !!e.c).owner = p;
        return;
      }
      case 't': {
        const fuse = clampInt(e.f, 1, 200) ?? 80;
        this.addEntity(new PrimedTNT(world, Math.floor(x), Math.floor(y), Math.floor(z), fuse)).owner = p;
        return;
      }
      case 'm': {
        if (p.mode !== 'creative' || typeof e.ty !== 'string' || !Object.prototype.hasOwnProperty.call(MOB_TYPES, e.ty)) return;
        const mob = this.spawnMob(e.ty, x, y, z, { baby: !!e.b, wool: randomWool() });
        if (mob) mob.owner = p;
        return;
      }
      default:
    }
  }

  ownedCount(p, mobs) {
    let n = 0;
    for (const e of this.world.entities) if (e.owner === p && !e.dead && (e instanceof Mob) === mobs) n++;
    return n;
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
    p.useStack = s;
    try {
      t.onInteract(p, s);
    } finally {
      p.useStack = null;
    }
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
    if (!te || !near(p, x + 0.5, y + 0.5, z + 0.5, 10) || !conn.allow('tile')) return;
    conn.viewing = te;
    this.sendTile(conn, te);
  }

  // Container edits arrive as per-slot changes [slot, before, after] and are
  // applied as "took N" / "put N" against what the container holds now, so
  // two players using one chest (or a furnace finishing an item) never
  // overwrite each other. Whatever cannot be taken or put is settled with the
  // player ('untake' / 'give'), so items are neither lost nor duplicated.
  onTile(conn, p, m) {
    const x = clampInt(m.x, -3e7, 3e7), y = clampInt(m.y, 0, 127), z = clampInt(m.z, -3e7, 3e7);
    if (x === null || y === null || z === null) return;
    const te = this.world.getTileEntity(x, y, z);
    if (!te) return;
    if (conn.viewing !== te || !Array.isArray(m.ch) || m.ch.length > te.items.length * 2 || !p.alive) {
      this.sendTile(conn, te);
      return;
    }
    if (!conn.allow('tile')) {
      conn.tileResync = te;
      return;
    }
    let outputTaken = false;
    for (const c of m.ch) {
      if (!Array.isArray(c) || c.length !== 3 || !Number.isInteger(c[0]) || c[0] < 0 || c[0] >= te.items.length) continue;
      const i = c[0];
      const from = c[1] === null ? null : parseStack(c[1]);
      const to = c[2] === null ? null : parseStack(c[2]);
      if ((c[1] !== null && !from) || (c[2] !== null && !to)) continue;
      let take = null, put = null;
      if (from && to && sameKind(from, to)) {
        const d = to.count - from.count;
        if (d < 0) take = { ...from, count: -d };
        else if (d > 0) put = { ...to, count: d };
      } else {
        if (from) take = from;
        if (to) put = to;
      }
      if (take) {
        const cur = te.items[i];
        const have = cur && sameKind(cur, take) ? cur.count : 0;
        const got = Math.min(have, take.count);
        if (got > 0) te.items[i] = cur.count - got > 0 ? { ...cur, count: cur.count - got } : null;
        if (got < take.count) p.send({ t: 'untake', s: packStack({ ...take, count: take.count - got }) });
        if (te.type === 'furnace' && i === 2 && got > 0) outputTaken = true;
      }
      if (put) {
        const cur = te.items[i];
        let placed = 0;
        if (!cur) {
          placed = Math.min(put.count, maxStack(put.id));
          te.items[i] = { ...put, count: placed };
        } else if (sameKind(cur, put)) {
          placed = Math.max(0, Math.min(put.count, maxStack(cur.id) - cur.count));
          if (placed) te.items[i] = { ...cur, count: cur.count + placed };
        }
        if (placed < put.count) p.send({ t: 'give', s: serializeStack({ ...put, count: put.count - placed }) });
      }
    }
    if (outputTaken && te.xp > 0) {
      // Experience stored in the furnace goes to whoever takes the output.
      let xp = Math.floor(te.xp);
      if (Math.random() < te.xp - xp) xp++;
      te.xp = 0;
      if (xp > 0) this.spawnXP(p.x, p.y + 0.5, p.z, xp);
    }
    this.tileEditor = conn;
    try {
      this.world.markTileDirty(te);
    } finally {
      this.tileEditor = null;
    }
    // If the editor's view (m.it) differs from what the container really holds now, resend it.
    if (!Array.isArray(m.it) || JSON.stringify(te.items.map(packStack)) !== JSON.stringify(m.it)) this.sendTile(conn, te);
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
      if (c.tileResync === te) {
        c.tileResync = null;
        this.sendTile(c, te);
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
      const key = chunkKey(cx, cz);
      // Changed chunks are always served (the browser cannot make them itself).
      if (!this.changedChunks.has(key)) {
        conn.send({ t: 'gen', k: key });
        continue;
      }
      if (Math.abs(cx - pcx) > 64 || Math.abs(cz - pcz) > 64) continue; // far away: the browser asks again later
      if (conn.chunkReqs.has(key)) continue; // already on its way
      conn.chunkReqs.add(key);
      this.sendChunk(conn, cx, cz)
        .catch((e) => console.error('[chunk] send failed:', e.message))
        .finally(() => conn.chunkReqs.delete(key));
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
      const edits = this.pendingEdits.get(chunkKey(a.cx, a.cz));
      if (edits) {
        this.pendingEdits.delete(chunkKey(a.cx, a.cz));
        for (const [conn, m] of edits) if (conn.player && this.clients.has(conn)) this.onSet(conn, conn.player, m);
      }
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
    for (const c of this.clients) {
      try {
        c.flush();
      } catch (e) {
        console.error('[net] could not send to a player:', e.message);
      }
    }
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
      const r = (Math.min(conn.loadVd || conn.vd, 32) + 4) * 16;
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
    for (const p of this.online.values()) this.trySavePlayer(p);
    const ms = performance.now() - t0;
    if (this.cfg.verbose || ms > 100) console.log(`[save] saved ${chunks} chunks in ${ms.toFixed(0)} ms`);
    return this.storage.flush();
  }

  async shutdown(reason = 'The server is shutting down') {
    if (this.stopped) return;
    this.stopped = true;
    for (const c of [...this.clients]) c.kick(reason);
    try {
      for (const c of this.world.chunks.values()) {
        if (c.modified) {
          this.storage.saveChunk(c, this.tilesOf(c));
          c.modified = false;
        }
        this.saveChunkEntities(c, this.entitiesIn(c));
      }
      this.storage.saveLevel(this.levelRecord());
      for (const p of this.online.values()) this.trySavePlayer(p);
    } finally {
      await this.storage.flush();
      this.gen.close();
    }
  }
}

export { DAY_LENGTH, isSolid, ENTITY_RANGE };
