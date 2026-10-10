// Blockforge: entry point and game controller.
import * as THREE from '../vendor/three.module.min.js';
import { Gfx, mediumAt } from './gfx/renderer.js';
import { World } from './world/world.js';
import { Chunk } from './world/chunk.js';
import { ChunkLoader } from './world/loader.js';
import { Player } from './game/player.js';
import { Input } from './input.js';
import { UI } from './ui/ui.js';
import { AudioEngine } from './audio/audio.js';
import { Commands } from './game/commands.js';
import { loadSettings } from './settings.js';
import { WorldStore, saveWorldMeta, loadWorldMeta } from './storage/db.js';
import { seedFromInput } from './util/rng.js';
import { ItemEntity, XPOrb, FallingBlock, PrimedTNT, Projectile } from './entity/objects.js';
import { Mob, createMob } from './entity/mobs.js';
import { Spawner, randomWool } from './entity/spawner.js';
import { naturalDrops } from './game/interact.js';
import { serializeTile, deserializeTile } from './world/tileentities.js';
import { B, BLOCKS, isSolid } from './data/blocks.js';
import { I, ITEMS } from './data/items.js';
import { raycast, boxCollides, AABB } from './world/physics.js';
import { TICK_MS, SEA_LEVEL } from './world/constants.js';
import { serializeStack, deserializeStack } from './game/inventory.js';

const XP_SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.settings = loadSettings();
    this.state = 'boot';
    this.world = null;
    this.player = null;
    this.loader = null;
    this.store = null;
    this.meta = null;
    this.perspective = 0;
    this.difficulty = 2;
    this.acc = 0;
    this.last = performance.now();
    this.fps = 0;
    this.frames = 0;
    this.fpsTime = 0;
    this.cameraMedium = 'air';
    this.lightAtPlayer = [15, 0];
    this.stepDist = 0;
    this.eyeSmooth = 1.62;
    this.saving = false;
  }

  async boot() {
    try {
      this.gfx = new Gfx(this.canvas);
    } catch (e) {
      console.error(e);
      document.getElementById('ui').innerHTML = `<div class="screen dark"><div class="menu-title">Blockforge needs WebGL 2</div><div class="menu-sub">Your browser or device could not start 3D graphics. Try a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</div></div>`;
      return;
    }
    this.audio = new AudioEngine();
    this.input = new Input(this, this.canvas);
    this.commands = new Commands(this);
    this.ui = new UI(this);
    this.spawner = new Spawner(this);
    this.applySettings();
    window.addEventListener('resize', () => this.gfx.resize());
    window.addEventListener('beforeunload', () => {
      if (this.state === 'playing' || this.state === 'dead') this.saveAll();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'playing' || this.state === 'dead')) this.saveAll();
    });
    const unlockAudio = () => this.audio.init();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    this.startMenuWorld();
    this.ui.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  applySettings() {
    const s = this.settings;
    this.audio.setVolumes({ master: s.master / 100, music: s.music / 100, sound: s.sound / 100 });
    this.gfx.setPixelRatio(s.pixelRatio);
    this.ui.applyScale();
  }

  // ---------------------------------------------------------------- menu world
  startMenuWorld() {
    this.disposeWorld();
    this.state = 'title';
    const seed = 20251010;
    this.world = new World(this, { seed, time: 2500 });
    this.world.rules.doMobSpawning = false;
    this.loader = new ChunkLoader(this.world, null, this.chunkHooks());
    const spawn = this.world.gen.findSpawn();
    this.player = new Player(this.world, spawn.x, spawn.y + 20, spawn.z);
    this.player.setMode('spectator');
    this.menuCam = { x: spawn.x, y: Math.max(spawn.y + 14, SEA_LEVEL + 22), z: spawn.z, yaw: 0 };
    this.difficulty = 0;
  }

  disposeWorld() {
    if (this.loader) this.loader.destroy();
    if (this.world) {
      for (const e of this.world.entities) e.disposeMesh();
      this.world.entities = [];
    }
    if (this.player) this.player.disposeMesh();
    this.gfx.clearAllChunks();
    this.gfx.particles.clear();
    this.gfx.setSelection(null, null);
    this.world = null;
    this.loader = null;
    this.player = null;
    this.store = null;
    this.meta = null;
  }

  // ---------------------------------------------------------------- worlds
  async createWorld({ name, seed, mode, hardcore, difficulty }) {
    const id = 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const meta = {
      id, name, seed: seedFromInput(seed), mode, hardcore: !!hardcore, difficulty,
      created: Date.now(), lastPlayed: Date.now(), time: 0, day: 0, tickCount: 0, version: 1,
    };
    await saveWorldMeta(meta);
    await this.playWorld(id, meta);
  }

  async playWorld(id, metaIn) {
    const meta = metaIn || (await loadWorldMeta(id));
    if (!meta) return;
    this.ui.closeScreen();
    this.ui.showLoading(meta.player ? 'Loading world' : 'Generating world');
    this.disposeWorld();
    this.state = 'loading';
    this.meta = meta;
    this.difficulty = meta.hardcore ? 3 : meta.difficulty ?? 2;
    const world = new World(this, { seed: meta.seed, time: meta.time ?? 0, day: meta.day ?? 0, tickCount: meta.tickCount ?? 0, weather: meta.weather, rules: meta.rules });
    this.world = world;
    const store = new WorldStore(meta.id);
    await store.init();
    this.store = store;
    this.loader = new ChunkLoader(world, store, this.chunkHooks());
    let spawn = meta.spawn;
    if (!spawn) {
      spawn = world.gen.findSpawn();
      meta.spawn = spawn;
    }
    const pd = meta.player;
    const player = new Player(world, pd ? pd.x : spawn.x, pd ? pd.y : spawn.y, pd ? pd.z : spawn.z);
    player.name = this.settings.name || 'Player';
    player.setMode(meta.mode || 'survival');
    if (pd) this.loadPlayer(player, pd);
    this.player = player;
    player.createMesh(this.gfx);
    this.ui.containers.close(true);

    // Load the area around the player before starting.
    const need = Math.min(3, this.settings.renderDist);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const step = () => {
        if (this.world !== world) return resolve();
        this.loader.update(player.x, player.z, this.settings.renderDist, 30);
        const pending = this.gfx.updateMeshes(world, player.x, player.y, player.z, need, 30);
        let have = 0, total = 0;
        const pcx = Math.floor(player.x) >> 4, pcz = Math.floor(player.z) >> 4;
        for (let dz = -need - 1; dz <= need + 1; dz++) for (let dx = -need - 1; dx <= need + 1; dx++) {
          total++;
          if (world.getChunk(pcx + dx, pcz + dz)) have++;
        }
        this.ui.setLoading(have / total * 0.9 + (pending === 0 && have === total ? 0.1 : 0), have < total ? 'Building terrain' : 'Preparing spawn area');
        if ((have === total && pending === 0) || performance.now() - t0 > 30000) resolve();
        else requestAnimationFrame(step);
      };
      step();
    });
    if (this.world !== world) return;
    if (!pd) {
      // Place a new player on solid ground.
      const x = Math.floor(spawn.x), z = Math.floor(spawn.z);
      const y = this.safeY(x, z);
      player.teleport(x + 0.5, y, z + 0.5);
      meta.spawn = { x: x + 0.5, y, z: z + 0.5 };
    } else if (boxCollides(world, player.box)) {
      player.teleport(player.x, this.safeY(Math.floor(player.x), Math.floor(player.z)), player.z);
    }
    meta.lastPlayed = Date.now();
    await saveWorldMeta(meta);
    this.state = 'playing';
    this.ui.closeScreen();
    this.ui.updateHudVisibility();
    this.acc = 0;
    this.showClickToPlay();
    if (!pd) this.ui.chat(`Welcome to ${meta.name}! Press ${'T'} to chat, /help for commands.`, '#ffe14d');
  }

  safeY(x, z) {
    const w = this.world;
    let y = w.topY(x, z) + 1;
    if (y <= 0) y = SEA_LEVEL + 1;
    while (y < 127 && (isSolid[w.getBlock(x, y, z)] || isSolid[w.getBlock(x, y + 1, z)])) y++;
    return y;
  }

  showClickToPlay() {
    if (this.input.touchActive) return;
    const node = document.createElement('div');
    node.className = 'screen dim';
    node.innerHTML = '<div class="menu-title txt-shadow">Click to play</div><div class="menu-sub">Esc pauses the game</div>';
    node.addEventListener('click', () => {
      this.ui.closeScreen();
      this.resume();
    });
    this.ui.setScreen('click', node);
  }

  resume() {
    if (this.state !== 'playing') return;
    this.input.clearQueue();
    if (!this.input.touchActive) this.input.requestLock();
  }

  onPointerUnlock() {
    this.ui.onPointerUnlock();
  }

  loadPlayer(p, d) {
    p.teleport(d.x, d.y, d.z);
    p.yaw = d.yaw || 0;
    p.pitch = d.pitch || 0;
    p.health = d.health ?? 20;
    p.food = d.food ?? 20;
    p.saturation = d.saturation ?? 5;
    p.exhaustion = d.exhaustion ?? 0;
    p.xpLevel = d.xpLevel || 0;
    p.xpProgress = d.xpProgress || 0;
    p.xpTotal = d.xpTotal || 0;
    p.score = d.score || 0;
    p.air = d.air ?? 300;
    p.fireTicks = d.fireTicks || 0;
    p.flying = !!d.flying && p.mode !== 'survival';
    p.spawn = d.spawn || null;
    p.effects = d.effects || {};
    p.inventory.load(d.inventory);
    if (p.health <= 0) p.health = 20;
  }

  savePlayer(p) {
    return {
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food, saturation: p.saturation, exhaustion: p.exhaustion,
      xpLevel: p.xpLevel, xpProgress: p.xpProgress, xpTotal: p.xpTotal, score: p.score, air: p.air, fireTicks: p.fireTicks,
      flying: p.flying, spawn: p.spawn, effects: p.effects, inventory: p.inventory.serialize(),
    };
  }

  // ---------------------------------------------------------------- chunk persistence
  chunkHooks() {
    return {
      onBeforeAdd: (c, data, fromSave) => {
        if (fromSave && data.tiles) {
          for (const t of data.tiles) {
            const lx = t.x & 15, lz = t.z & 15;
            const i = lx | (lz << 4) | (t.y << 8);
            const te = deserializeTile(t, c.blocks[i]);
            if (te) c.tileEntities.set(i, te);
          }
        }
      },
      onLoaded: (c, data, fromSave) => this.onChunkLoaded(c, data, fromSave),
      onUnload: (c) => this.onChunkUnload(c),
    };
  }

  onChunkLoaded(c, data) {
    const store = this.store;
    if (!store) return;
    if (store.hasEntities(c.cx, c.cz)) {
      c.hasEntityRecord = true;
      store.loadEntities(c.cx, c.cz).then((rec) => {
        if (!rec || !this.world || this.world.getChunk(c.cx, c.cz) !== c) return;
        for (const m of rec.mobs || []) {
          const mob = createMob(this.world, m.type, m.x, m.y, m.z, { yaw: m.yaw, health: m.health, baby: m.baby, sheared: m.sheared, wool: m.wool });
          if (mob) {
            if (m.grow !== undefined) mob.growTimer = m.grow;
            this.addEntity(mob);
          }
        }
        for (const it of rec.items || []) {
          const st = deserializeStack(it.s);
          if (st) {
            const e = new ItemEntity(this.world, it.x, it.y, it.z, st);
            e.vx = e.vy = e.vz = 0;
            e.age = it.age || 0;
            this.addEntity(e);
          }
        }
      });
    } else if (data.spawns && data.spawns.length) {
      c.hasEntityRecord = true;
      for (const s of data.spawns) this.addEntity(new Mob(this.world, s.type, s.x, s.y, s.z, { wool: randomWool() }));
      store.queueEntities(c.cx, c.cz, { mobs: [], items: [] }); // marks the chunk as populated
    }
  }

  chunkRecord(c) {
    const tiles = [...c.tileEntities.values()].map(serializeTile);
    return { blocks: c.blocks, meta: c.meta, biomes: c.biomes, temps: c.temps, humids: c.humids, tiles };
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

  onChunkUnload(c) {
    this.gfx.disposeChunk(c);
    if (!this.store) return;
    if (c.modified) {
      this.store.queueChunk(c, this.chunkRecord(c));
      c.modified = false;
    }
    const ents = this.entitiesIn(c);
    if (ents.length || c.hasEntityRecord) {
      this.store.queueEntities(c.cx, c.cz, this.entityRecord(ents));
    }
    for (const e of ents) {
      e.disposeMesh();
      e.dead = true;
    }
    this.world.entities = this.world.entities.filter((e) => !e.dead);
  }

  // Saves are queued so a save requested during another one still runs
  // (e.g. quitting right after an autosave started).
  saveAll() {
    const run = () => this.saveNow();
    this.savePromise = (this.savePromise || Promise.resolve()).then(run, run);
    return this.savePromise;
  }

  async saveNow() {
    if (!this.store || !this.world || !this.meta || !this.player) return;
    this.saving = true;
    try {
      const world = this.world;
      for (const c of world.chunks.values()) {
        if (c.modified) {
          this.store.queueChunk(c, this.chunkRecord(c));
          c.modified = false;
        }
        const ents = this.entitiesIn(c);
        if (ents.length || c.hasEntityRecord) {
          this.store.queueEntities(c.cx, c.cz, this.entityRecord(ents));
          c.hasEntityRecord = true;
        }
      }
      const m = this.meta;
      m.time = world.time;
      m.day = world.day;
      m.tickCount = world.tickCount;
      m.weather = { ...world.weather };
      m.rules = { ...world.rules };
      m.difficulty = this.difficulty;
      m.mode = this.player.mode;
      m.lastPlayed = Date.now();
      if (this.player.health > 0) m.player = this.savePlayer(this.player);
      else m.player = { ...this.savePlayer(this.player), health: 20 };
      await this.store.flush();
      await saveWorldMeta(m);
    } finally {
      this.saving = false;
    }
  }

  async quitToTitle() {
    this.ui.hideAll();
    this.ui.showLoading('Saving world');
    await this.saveAll();
    this.input.exitLock();
    this.startMenuWorld();
    this.ui.showTitle();
  }

  // ---------------------------------------------------------------- entities & hooks
  addEntity(e) {
    this.world.entities.push(e);
    return e;
  }

  spawnMob(type, x, y, z, opts = {}) {
    const m = createMob(this.world, type, x, y, z, opts);
    if (m) this.addEntity(m);
    return m;
  }

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

  throwStack(p, stack) {
    this.dropItem(p.x, p.y + p.eyeHeight() - 0.3, p.z, stack, p);
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

  onFall(e, dmg) {
    if (e === this.player) this.audio.blockSound('stone', dmg > 4 ? 'break' : 'place', e.x, e.y, e.z);
  }

  throwItem(p, kind) {
    const [dx, dy, dz] = p.lookDir();
    const pr = new Projectile(this.world, p, p.x + dx * 0.4, p.y + p.eyeHeight() - 0.1, p.z + dz * 0.4, dx * 1.5 + p.vx, dy * 1.5, dz * 1.5 + p.vz, kind);
    this.addEntity(pr);
  }

  shootArrow(p, speed, crit) {
    const [dx, dy, dz] = p.lookDir();
    const a = new Projectile(this.world, p, p.x + dx * 0.4, p.y + p.eyeHeight() - 0.1, p.z + dz * 0.4, dx * speed, dy * speed, dz * speed, 'arrow');
    a.crit = crit;
    a.vx += p.vx;
    a.vz += p.vz;
    if (!p.onGround) a.vy += p.vy;
    this.addEntity(a);
  }

  mobShoot(mob, target) {
    const sx = mob.x, sy = mob.y + mob.eyeHeight() - 0.1, sz = mob.z;
    const dx = target.x - sx, dz = target.z - sz;
    const dy = target.y + target.h / 3 - sy;
    const h = Math.hypot(dx, dz);
    const vy = dy + h * 0.2;
    const len = Math.hypot(dx, vy, dz) || 1;
    const speed = 1.6;
    const spread = (14 - this.difficulty * 4) * 0.0075;
    const a = new Projectile(this.world, mob, sx + (dx / h) * 0.5, sy, sz + (dz / h) * 0.5,
      (dx / len + (Math.random() - 0.5) * spread) * speed, (vy / len + (Math.random() - 0.5) * spread) * speed, (dz / len + (Math.random() - 0.5) * spread) * speed, 'arrow');
    a.damageBase = 2 + this.difficulty * 0.11 + Math.random() * 0.5;
    this.addEntity(a);
    this.audio.play('bow', { x: sx, y: sy, z: sz });
  }

  eatParticles(p, id) {
    const [dx, dy, dz] = p.lookDir();
    for (let i = 0; i < 4; i++) this.itemCrumb(p.x + dx * 0.4, p.y + p.eyeHeight() - 0.15 + dy * 0.3, p.z + dz * 0.4, id, (Math.random() - 0.5) * 0.1, Math.random() * 0.1, (Math.random() - 0.5) * 0.1);
  }

  // A small piece of an item's sprite as a particle (uses a block tile when possible).
  itemCrumb(x, y, z, id, vx, vy, vz) {
    const d = ITEMS[id];
    if (!d) return;
    const items = this.gfx.items;
    const pixels = items.spritePixels(id);
    let r = 1, g = 1, b = 1;
    if (pixels) {
      // Average a random opaque pixel colour.
      for (let k = 0; k < 20; k++) {
        const i = Math.floor(Math.random() * 256) * 4;
        if (pixels.data[i + 3] > 128) {
          r = pixels.data[i] / 255;
          g = pixels.data[i + 1] / 255;
          b = pixels.data[i + 2] / 255;
          break;
        }
      }
    }
    this.gfx.particles.add({ x, y, z, vx, vy, vz, life: 12 + Math.random() * 10, layer: this.gfx.tiles.index.get('particle_spark'), size: 0.05, r, g, b, gravity: 0.04 });
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
    const ents = [this.player, ...world.entities];
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
      if (e instanceof PrimedTNT === false) {
        e.vx += (ex / el) * impact;
        e.vy += (ey / el) * impact;
        e.vz += (ez / el) * impact;
      }
    }
    // Destroy blocks
    for (const [bx, by, bz] of affected.values()) {
      const id = world.getBlock(bx, by, bz);
      if (id === 0 || BLOCKS[id].hardness < 0) continue;
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
    if (this.player && Math.hypot(this.player.x - x, this.player.z - z) < 24) this.shake = 1;
  }

  onPlayerDeath(source) {
    const p = this.player;
    void source;
    this.ui.chat(p.lastDeathMessage, '#ffffff');
    if (!this.world.rules.keepInventory) {
      for (const list of [p.inventory.slots, p.inventory.armor]) {
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (!s) continue;
          const e = this.dropItem(p.x, p.y + 1, p.z, s);
          if (e) {
            e.vx = (Math.random() - 0.5) * 0.5;
            e.vz = (Math.random() - 0.5) * 0.5;
            e.vy = 0.2 + Math.random() * 0.2;
          }
          list[i] = null;
        }
      }
      p.inventory.changed();
      const xp = Math.min(100, p.xpLevel * 7);
      if (xp > 0) this.spawnXP(p.x, p.y + 0.5, p.z, xp);
      p.xpLevel = 0;
      p.xpProgress = 0;
    }
    this.ui.containers.close(true);
    this.state = 'dead';
    setTimeout(() => {
      if (this.state === 'dead') this.ui.showDeath(p.lastDeathMessage, p.score, this.meta?.hardcore);
    }, 900);
  }

  respawn() {
    const p = this.player;
    const w = this.world;
    if (this.meta?.hardcore) {
      p.health = 20;
      p.setMode('spectator');
      this.meta.mode = 'spectator';
      this.state = 'playing';
      this.resume();
      return;
    }
    p.health = p.maxHealth;
    p.food = 20;
    p.saturation = 5;
    p.exhaustion = 0;
    p.air = 300;
    p.fireTicks = 0;
    p.deathTime = 0;
    p.hurtTime = 0;
    p.effects = {};
    p.score = 0;
    p.fallDistance = 0;
    let target = null;
    if (p.spawn) {
      const bx = Math.floor(p.spawn.x), by = Math.floor(p.spawn.y), bz = Math.floor(p.spawn.z);
      if (w.getBlock(bx, by, bz) === B.red_bed || w.getBlock(bx, by - 1, bz) === B.red_bed || !w.isLoadedAt(bx, bz)) target = p.spawn;
      else {
        this.ui.chat('Your home bed was missing or obstructed', '#ffb0b0');
        p.spawn = null;
      }
    }
    if (!target) target = this.meta.spawn;
    p.teleport(target.x, target.y + 0.1, target.z);
    this.state = 'playing';
    this.respawnCheck = 40;
    this.resume();
  }

  // ---------------------------------------------------------------- input helpers
  selectHotbar(i) {
    if (!this.player) return;
    this.player.inventory.selected = i;
    this.player.inventory.changed();
    this.player.using = null;
  }

  scrollHotbar(d) {
    const inv = this.player.inventory;
    inv.selected = (inv.selected + d + 9) % 9;
    inv.changed();
    this.player.using = null;
  }

  dropSelected(all) {
    const p = this.player;
    if (!p || p.health <= 0 || this.state !== 'playing' || this.ui.screenOpen()) return;
    const s = p.inventory.selectedStack();
    if (!s) return;
    const n = all ? s.count : 1;
    this.throwStack(p, { ...s, count: n });
    s.count -= n;
    if (s.count <= 0) p.inventory.setSelected(null);
    p.inventory.changed();
    p.swing();
  }

  cyclePerspective() {
    this.perspective = (this.perspective + 1) % 3;
  }

  screenshot() {
    try {
      const p = this.gfx.renderer.domElement;
      this.renderFrame(this.lastPartial || 0);
      const url = p.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `blockforge-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      this.ui.chat('Saved screenshot', '#bbbbbb');
    } catch {
      this.ui.chat('Screenshots are not available here', '#ff9a9a');
    }
  }

  // ---------------------------------------------------------------- camera
  cameraView(partial) {
    const p = this.player;
    const pos = new THREE.Vector3();
    let yaw, pitch, roll = 0, fovMul = 1;
    if (this.state === 'title' || !p) {
      const c = this.menuCam;
      const t = performance.now() / 1000;
      yaw = t * 0.03;
      pitch = -0.18;
      pos.set(c.x, c.y, c.z);
      return { pos, yaw, pitch, roll, fovMul, firstPerson: false, medium: 'air' };
    }
    const [x, y, z] = p.lerpPos(partial);
    this.eyeSmooth += (p.eyeHeight() - this.eyeSmooth) * 0.35;
    let eye = y + this.eyeSmooth;
    yaw = p.yaw;
    pitch = p.pitch;
    const first = this.perspective === 0;
    let bx = 0, by = 0;
    if (first && this.settings.viewBob && p.mode !== 'spectator' && !p.flying) {
      const walk = p.walkPhase(partial);
      const bob = p.bobAmount(partial);
      bx = Math.sin(walk * Math.PI) * bob * 0.5;
      by = -Math.abs(Math.cos(walk * Math.PI) * bob);
      roll += Math.sin(walk * Math.PI) * bob * 0.05;
      pitch -= Math.abs(Math.cos(walk * Math.PI - 0.2) * bob) * 0.09;
    }
    if (p.hurtTilt > 0 && p.health > 0) {
      const t = (p.hurtTilt - partial) / 10;
      roll += Math.sin(t * t * t * t * Math.PI) * 0.25;
    }
    if (p.health <= 0) {
      roll = Math.min(1, (p.deathTime + partial) / 20) * 0.7;
      eye = y + 0.3;
    }
    if (this.shake > 0) {
      roll += (Math.random() - 0.5) * this.shake * 0.04;
      pitch += (Math.random() - 0.5) * this.shake * 0.04;
    }
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    pos.set(x + rx * bx, eye + by, z + rz * bx);
    if (p.sprinting && p.moveForward > 0) fovMul *= 1.12;
    if (p.flying && p.sprinting) fovMul *= 1.05;
    const ua = p.useAnim(partial);
    if (ua && ua.kind === 'bow') fovMul *= 1 - ua.pull * 0.15;
    if (!first) {
      const cp = Math.cos(pitch);
      let dx = -Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
      const sign = this.perspective === 1 ? -1 : 1;
      dx *= sign; dy *= sign; dz *= sign;
      const hit = raycast(this.world, pos.x, pos.y, pos.z, dx, dy, dz, 4);
      const dist = hit ? Math.max(0.3, hit.t - 0.25) : 4;
      pos.set(pos.x + dx * dist, pos.y + dy * dist, pos.z + dz * dist);
      if (this.perspective === 2) {
        yaw += Math.PI;
        pitch = -pitch;
      }
    }
    const medium = mediumAt(this.world, pos.x, pos.y, pos.z);
    if (medium === 'water') fovMul *= 0.92;
    return { pos, yaw, pitch, roll, fovMul, firstPerson: first, medium };
  }

  // ---------------------------------------------------------------- loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }
    if (!this.world) return;
    const paused = this.isPaused();
    if (this.state === 'title') {
      this.acc += dt * 1000;
      while (this.acc >= TICK_MS) {
        this.acc -= TICK_MS;
        this.world.tickTime();
        this.world.runScheduled();
      }
    } else if ((this.state === 'playing' || this.state === 'dead') && !paused) {
      this.acc += dt * 1000;
      let n = 0;
      while (this.acc >= TICK_MS && n < 5) {
        this.acc -= TICK_MS;
        this.tick();
        n++;
      }
      if (n === 5) this.acc = 0;
    }
    const partial = paused || this.state === 'loading' ? 1 : Math.min(1, this.acc / TICK_MS);
    this.lastPartial = partial;

    // Mouse look (per frame for responsiveness)
    if (this.player && (this.state === 'playing') && !this.ui.screenOpen() && !paused) {
      const [dx, dy] = this.input.takeLook();
      const sens = (this.settings.sensitivity / 100) * 0.0026;
      const p = this.player;
      if (!p.sleeping) {
        p.yaw -= dx * sens;
        p.pitch -= dy * sens * (this.settings.invertY ? -1 : 1);
        p.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p.pitch));
      }
      p.sway = [p.sway[0] * 0.8 + dy * 0.2, p.sway[1] * 0.8 + dx * 0.2];
      p.pSway = p.sway;
      p.renderYaw += angleDiff(p.yaw, p.renderYaw) * (p.limbAmount > 0.1 ? 0.3 : 0.05);
      if (Math.abs(angleDiff(p.yaw, p.renderYaw)) > 0.9) p.renderYaw = p.yaw - Math.sign(angleDiff(p.yaw, p.renderYaw)) * 0.9;
    } else this.input.takeLook();

    // Streaming and meshing
    const camRef = this.state === 'title' ? this.menuCam : this.player;
    if (!camRef) return;
    const rd = this.state === 'title' ? Math.min(6, this.settings.renderDist) : this.settings.renderDist;
    if (this.loader) this.loader.update(camRef.x, camRef.z, rd, this.state === 'loading' ? 30 : 6);
    this.gfx.updateMeshes(this.world, camRef.x, camRef.y, camRef.z, rd, this.state === 'loading' ? 30 : 7);

    this.renderFrame(partial);
    this.ui.update(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2);

    // Audio
    const cam = this.gfx.camera;
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.player ? this.player.yaw : 0);
    this.audio.musicTick(this.state === 'title' ? 'title' : 'game');
  }

  isPaused() {
    const n = this.ui.screenName;
    return this.state === 'playing' && (n === 'pause' || n === 'options' || n === 'help' || n === 'controls' || n === 'click');
  }

  renderFrame(partial) {
    const g = this.gfx;
    const world = this.world;
    const p = this.player;
    // Entities
    const rd = this.settings.renderDist * 16;
    if (this.state !== 'title') {
      for (const e of world.entities) {
        if (e.dead) continue;
        const near = Math.abs(e.x - p.x) < rd && Math.abs(e.z - p.z) < rd;
        if (!e.mesh && near) e.createMesh(g);
        if (e.mesh) e.updateMesh(partial, near);
      }
      if (p && p.mesh) p.updateMesh(partial, this.perspective !== 0 && p.mode !== 'spectator');
      // Target outline
      if (p && p.hit && this.state === 'playing' && this.ui.hudVisible && p.mode !== 'spectator') g.setSelection(world, p.hit);
      else g.setSelection(world, null);
      if (p && !p.mining) g.setCrack(-1);
      const lx = Math.floor(p.x), ly = Math.floor(p.y + p.eyeHeight()), lz = Math.floor(p.z);
      this.lightAtPlayer = [world.getSkyLight(lx, ly, lz), world.getBlockLight(lx, ly, lz)];
    }
    const view = this.cameraView(partial);
    this.cameraMedium = view.medium;
    g.render(this, partial, {
      fov: this.settings.fov,
      renderDist: this.state === 'title' ? Math.min(6, this.settings.renderDist) : this.settings.renderDist,
      gamma: this.settings.gamma,
      clouds: this.settings.clouds,
      showHand: this.state === 'playing' && this.ui.hudVisible && p && p.mode !== 'spectator' && !p.sleeping,
    });
  }

  tick() {
    const world = this.world;
    const p = this.player;
    world.tickTime();
    world.runScheduled();
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    const sim = Math.min(this.settings.renderDist, 6);
    world.randomTicks(pcx, pcz, sim);
    world.tickTiles();
    p.tick(this.input);
    this.gfx.hand.tick(p);
    if (this.respawnCheck > 0) {
      this.respawnCheck--;
      if (boxCollides(world, p.box) && world.isLoadedAt(Math.floor(p.x), Math.floor(p.z))) p.teleport(p.x, this.safeY(Math.floor(p.x), Math.floor(p.z)), p.z);
    }
    // Entities in simulation range
    const simR = sim * 16;
    const list = world.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      if (Math.abs(e.x - p.x) > simR || Math.abs(e.z - p.z) > simR) continue;
      if (!world.isLoadedAt(Math.floor(e.x + 1), Math.floor(e.z + 1)) || !world.isLoadedAt(Math.floor(e.x - 1), Math.floor(e.z - 1))) continue;
      e.tick();
    }
    let removed = false;
    for (const e of list) {
      if (e.dead) {
        e.disposeMesh();
        removed = true;
      }
    }
    if (removed) world.entities = list.filter((e) => !e.dead);
    this.spawner.tick();
    this.gfx.particles.tick(world);
    this.ambientTick();
    if (world.tickCount % 600 === 0) this.saveAll();
  }

  ambientTick() {
    const p = this.player;
    const world = this.world;
    // Footsteps
    if (p.onGround && !p.sneaking && p.mode !== 'spectator' && p.health > 0) {
      const d = Math.hypot(p.x - p.px, p.z - p.pz);
      this.stepDist += d;
      if (this.stepDist > 1.7) {
        this.stepDist = 0;
        const id = world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
        const above = world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
        const b = BLOCKS[above === B.snow ? above : id];
        if (b && b.solid) this.audio.blockSound(b.sound, 'step', p.x, p.y, p.z);
      }
    }
    if (p.inWater && Math.hypot(p.x - p.px, p.z - p.pz) > 0.05 && world.tickCount % 12 === 0) this.audio.play('swim', { x: p.x, y: p.y, z: p.z });
    if (p.isEyeInWater() && world.tickCount % 6 === 0) this.gfx.particles.emit('bubble', p.x + (Math.random() - 0.5) * 0.4, p.y + p.eyeHeight() - 0.1, p.z + (Math.random() - 0.5) * 0.4);
    // Rain sound strength depends on how exposed the player is.
    const exposed = world.weather.strength > 0 ? (world.isRainingAt(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z)) ? 1 : 0.35) : 0;
    this.audio.setRain(world.weather.strength * exposed);
    // Cave ambience
    if (world.tickCount % 200 === 0 && Math.random() < 0.15) {
      const lx = Math.floor(p.x), ly = Math.floor(p.y + 1), lz = Math.floor(p.z);
      if (world.getSkyLight(lx, ly, lz) === 0 && world.getBlockLight(lx, ly, lz) < 8 && ly < SEA_LEVEL) {
        this.audio.play('cave', { x: p.x + (Math.random() - 0.5) * 16, y: p.y, z: p.z + (Math.random() - 0.5) * 16 });
      }
    }
    // Ambient particles: torches smoke, lava drips
    if (world.tickCount % 4 === 0) {
      for (let n = 0; n < 6; n++) {
        const x = Math.floor(p.x + (Math.random() - 0.5) * 24), y = Math.floor(p.y + (Math.random() - 0.5) * 16), z = Math.floor(p.z + (Math.random() - 0.5) * 24);
        const id = world.getBlock(x, y, z);
        if (id === B.torch) {
          const m = world.getMeta(x, y, z);
          let ox = 0.5, oy = 0.75, oz = 0.5;
          if (m >= 1 && m <= 4) {
            const f = m - 1;
            ox += [0, -1, 0, 1][f] * -0.27;
            oz += [1, 0, -1, 0][f] * -0.27;
            oy = 0.95;
          }
          this.gfx.particles.emit('smoke', x + ox, y + oy, z + oz, { size: 0.06, life: 15 });
          this.gfx.particles.emit('flame', x + ox, y + oy - 0.05, z + oz, { size: 0.05, life: 6 });
        } else if (id === B.lit_furnace && Math.random() < 0.5) {
          this.gfx.particles.emit('flame', x + 0.5, y + 0.2, z + 0.5, { size: 0.06 });
        } else if (id === B.fire) {
          this.gfx.particles.emit('smoke', x + Math.random(), y + 0.8, z + Math.random(), { size: 0.15 });
        } else if (id === B.lava && world.getBlock(x, y + 1, z) === 0 && Math.random() < 0.15) {
          this.gfx.particles.emit('flame', x + Math.random(), y + 1, z + Math.random(), { vy: 0.1, gravity: 0.01, size: 0.05 });
        }
      }
    }
  }
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Expose for debugging in the console.
const game = new Game();
window.blockforge = game;
game.boot();

export { Chunk, AABB, I };
