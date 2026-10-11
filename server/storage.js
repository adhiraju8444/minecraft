// World files on disk. Only chunks that differ from freshly generated terrain
// are stored; everything else is regenerated from the seed.
//
//   <dir>/level.json                   world settings, time, weather, spawn
//   <dir>/players/<name>.json          one file per player name
//   <dir>/chunks/r.X.Z/c.X.Z.bin       changed chunks (zlib, see protocol.js)
//   <dir>/entities/r.X.Z/e.X.Z.json    animals and dropped items in a chunk
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { chunkKey } from '../js/world/constants.js';
import { encodeDiskChunk, decodeDiskChunk } from '../js/net/protocol.js';

const region = (c) => c >> 5;
const deflate = promisify(zlib.deflate);

export class Storage {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.chunkDir = path.join(this.dir, 'chunks');
    this.entityDir = path.join(this.dir, 'entities');
    this.playerDir = path.join(this.dir, 'players');
    for (const d of [this.dir, this.chunkDir, this.entityDir, this.playerDir]) fs.mkdirSync(d, { recursive: true });
    // Files queued or being written, so reads always see the newest data.
    this.pending = new Map();
    this.chain = Promise.resolve();
  }

  chunkPath(cx, cz) {
    return path.join(this.chunkDir, `r.${region(cx)}.${region(cz)}`, `c.${cx}.${cz}.bin`);
  }

  entityPath(cx, cz) {
    return path.join(this.entityDir, `r.${region(cx)}.${region(cz)}`, `e.${cx}.${cz}.json`);
  }

  playerPath(name) {
    // Names are limited to [A-Za-z0-9_ -]; spaces become underscores on disk.
    return path.join(this.playerDir, name.toLowerCase().replace(/ /g, '_') + '.json');
  }

  // Keys of every stored chunk and entity record.
  scan() {
    const out = { chunks: new Set(), entities: new Set() };
    const walk = (dir, re, set) => {
      for (const r of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!r.isDirectory()) continue;
        for (const f of fs.readdirSync(path.join(dir, r.name))) {
          const m = re.exec(f);
          if (m) set.add(chunkKey(Number(m[1]), Number(m[2])));
        }
      }
    };
    walk(this.chunkDir, /^c\.(-?\d+)\.(-?\d+)\.bin$/, out.chunks);
    walk(this.entityDir, /^e\.(-?\d+)\.(-?\d+)\.json$/, out.entities);
    return out;
  }

  // ------------------------------------------------------------ writing
  // Writes go through one queue: temp file then rename, so a crash never
  // leaves a half-written file behind. `data` may be a promise (compression
  // runs on the thread pool).
  write(file, data) {
    this.pending.set(file, data);
    this.chain = this.chain.then(async () => {
      const latest = this.pending.get(file);
      if (latest === undefined) return;
      try {
        const bytes = await latest;
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        await fsp.writeFile(tmp, bytes);
        await fsp.rename(tmp, file);
      } catch (e) {
        console.error(`[save] could not write ${file}: ${e.message}`);
      }
      if (this.pending.get(file) === latest) this.pending.delete(file);
    });
    return this.chain;
  }

  writeSync(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
    this.pending.delete(file);
  }

  flush() {
    return this.chain;
  }

  async read(file) {
    if (this.pending.has(file)) return await this.pending.get(file);
    try {
      return await fsp.readFile(file);
    } catch {
      return null;
    }
  }

  readSync(file) {
    const p = this.pending.get(file);
    if (typeof p === 'string' || Buffer.isBuffer(p)) return p;
    try {
      return fs.readFileSync(file);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ chunks
  saveChunk(c, tiles) {
    // Copy the chunk now; compress in the background.
    return this.write(this.chunkPath(c.cx, c.cz), deflate(encodeDiskChunk(c, tiles)));
  }

  // Raw compressed bytes of a stored chunk (or null).
  async chunkBytes(cx, cz) {
    return this.read(this.chunkPath(cx, cz));
  }

  unpackChunk(buf) {
    return decodeDiskChunk(new Uint8Array(zlib.inflateSync(buf)));
  }

  // ------------------------------------------------------------ entities
  saveEntities(cx, cz, record) {
    return this.write(this.entityPath(cx, cz), JSON.stringify(record));
  }

  async loadEntities(cx, cz) {
    const buf = await this.read(this.entityPath(cx, cz));
    if (!buf) return null;
    try {
      return JSON.parse(typeof buf === 'string' ? buf : buf.toString('utf8'));
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ json files
  readJSON(file) {
    const buf = this.readSync(file);
    if (!buf) return null;
    try {
      return JSON.parse(typeof buf === 'string' ? buf : buf.toString('utf8'));
    } catch (e) {
      console.error(`[save] ${file} is damaged: ${e.message}`);
      return null;
    }
  }

  loadLevel() {
    return this.readJSON(path.join(this.dir, 'level.json'));
  }

  saveLevel(level, sync = false) {
    const data = JSON.stringify(level, null, 2);
    const file = path.join(this.dir, 'level.json');
    return sync ? this.writeSync(file, data) : this.write(file, data);
  }

  loadPlayer(name) {
    return this.readJSON(this.playerPath(name));
  }

  savePlayer(name, record, sync = false) {
    const data = JSON.stringify(record);
    const file = this.playerPath(name);
    return sync ? this.writeSync(file, data) : this.write(file, data);
  }

  loadList(name) {
    const v = this.readJSON(path.join(this.dir, name + '.json'));
    return Array.isArray(v) ? v : [];
  }

  saveList(name, list) {
    return this.write(path.join(this.dir, name + '.json'), JSON.stringify(list, null, 2));
  }
}
