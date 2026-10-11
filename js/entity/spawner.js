// Natural mob spawning and despawning around the player.
import { B, BLOCKS, isOpaque, isSolid, isLiquid } from '../data/blocks.js';
import { Mob } from './mobs.js';
import { BIOME } from '../world/worldgen.js';
import { AABB, boxCollides } from '../world/physics.js';

const HOSTILE_CAP = 26;
const PASSIVE_CAP = 12;
const HOSTILE_WEIGHTS = [['zombie', 45], ['skeleton', 35], ['spider', 30]];

function pickWeighted(list) {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [n, w] of list) {
    r -= w;
    if (r <= 0) return n;
  }
  return list[0][0];
}

function canSpawnAt(world, x, y, z, w, h) {
  const below = world.getBlock(x, y - 1, z);
  if (!isOpaque[below] || below === B.bedrock || below === 255) return false;
  if (isSolid[world.getBlock(x, y, z)] || isLiquid[world.getBlock(x, y, z)]) return false;
  if (isSolid[world.getBlock(x, y + 1, z)]) return false;
  const box = new AABB(0, 0, 0, 0, 0, 0).set(x + 0.5, y, z + 0.5, w, h);
  return !boxCollides(world, box);
}

export class Spawner {
  constructor(game) {
    this.game = game;
  }

  tick() {
    const game = this.game;
    const world = game.world;
    const players = game.players.filter((p) => p && !p.dead);
    if (!players.length) return;
    // Despawning, measured from the nearest player
    for (const e of world.entities) {
      if (!(e instanceof Mob) || e.dead || e.persistent) continue;
      const p = game.nearestPlayer(e.x, e.y, e.z);
      const d = p ? Math.hypot(e.x - p.x, e.z - p.z) : Infinity;
      if (d > 128) e.remove();
      else if (d > 32 && Math.random() < 1 / 800) e.remove();
    }
    if (!world.rules.doMobSpawning) return;
    for (const p of players) {
      if (p.mode === 'spectator') continue;
      if (world.tickCount % 20 === 0 && game.difficulty > 0) this.spawnHostile(world, p);
      if (world.tickCount % 400 === 0) this.spawnPassive(world, p);
    }
  }

  // Far enough from every player to spawn there?
  clearOfPlayers(x, y, z, min) {
    const p = this.game.nearestPlayer(x, y, z, min);
    return !p;
  }

  count(world, p, hostile) {
    let n = 0;
    for (const e of world.entities) if (e instanceof Mob && !e.dead && e.hostile === hostile && Math.abs(e.x - p.x) < 96 && Math.abs(e.z - p.z) < 96) n++;
    return n;
  }

  spawnHostile(world, p) {
    if (this.count(world, p, true) >= HOSTILE_CAP) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = 24 + Math.random() * 56;
      const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
      const c = world.getChunk(x >> 4, z >> 4);
      if (!c) continue;
      const y = 1 + Math.floor(Math.random() * Math.min(126, c.maxY + 1));
      const type = pickWeighted(HOSTILE_WEIGHTS);
      const size = type === 'spider' ? [1.4, 0.9] : [0.6, 1.95];
      const pack = 1 + Math.floor(Math.random() * 3);
      let spawned = 0;
      for (let i = 0; i < pack * 2 && spawned < pack; i++) {
        const sx = x + Math.floor(Math.random() * 5) - 2, sz = z + Math.floor(Math.random() * 5) - 2;
        if (!canSpawnAt(world, sx, y, sz, size[0], size[1])) continue;
        if (world.lightAt(sx, y, sz) > 7) continue;
        if (!this.clearOfPlayers(sx + 0.5, y, sz + 0.5, 24)) continue;
        this.game.addEntity(new Mob(world, type, sx + 0.5, y, sz + 0.5));
        spawned++;
      }
      if (spawned) return;
    }
  }

  spawnPassive(world, p) {
    if (this.count(world, p, false) >= PASSIVE_CAP) return;
    const a = Math.random() * Math.PI * 2;
    const r = 24 + Math.random() * 40;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (!world.isLoadedAt(x, z)) return;
    const biome = world.getBiome(x, z);
    if (![BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.TAIGA, BIOME.MOUNTAINS, BIOME.SWAMP].includes(biome)) return;
    const y = world.topY(x, z) + 1;
    if (world.getBlock(x, y - 1, z) !== B.grass_block) return;
    if (world.lightAt(x, y, z) < 9) return;
    const type = ['pig', 'cow', 'sheep', 'chicken'][Math.floor(Math.random() * 4)];
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const sx = x + Math.floor(Math.random() * 5) - 2, sz = z + Math.floor(Math.random() * 5) - 2;
      const sy = world.topY(sx, sz) + 1;
      if (world.getBlock(sx, sy - 1, sz) !== B.grass_block) continue;
      if (!canSpawnAt(world, sx, sy, sz, 0.9, 1.4)) continue;
      if (!this.clearOfPlayers(sx + 0.5, sy, sz + 0.5, 24)) continue;
      this.game.addEntity(new Mob(world, type, sx + 0.5, sy, sz + 0.5, { wool: randomWool() }));
    }
  }
}

export function randomWool() {
  const r = Math.random();
  if (r < 0.8164) return 0; // white
  if (r < 0.8664) return 7; // gray
  if (r < 0.9164) return 8; // light gray
  if (r < 0.9664) return 15; // black
  if (r < 0.9964) return 12; // brown
  return 6; // pink
}

export { BLOCKS };
