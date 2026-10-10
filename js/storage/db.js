// World saves in IndexedDB. Falls back to memory when storage is blocked
// (private windows, sandboxed previews) so the game still runs.

const DB_NAME = 'blockforge';
const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

class MemoryBackend {
  constructor() {
    this.stores = { worlds: new Map(), chunks: new Map(), entities: new Map() };
    this.persistent = false;
  }
  async get(store, key) { return this.stores[store].get(key); }
  async put(store, key, value) { this.stores[store].set(key, value); }
  async delete(store, key) { this.stores[store].delete(key); }
  async getAll(store) { return [...this.stores[store].values()]; }
  async keysWithPrefix(store, prefix) { return [...this.stores[store].keys()].filter((k) => k.startsWith(prefix)); }
  async deletePrefix(store, prefix) { for (const k of await this.keysWithPrefix(store, prefix)) this.stores[store].delete(k); }
  async putMany(store, entries) { for (const [k, v] of entries) this.stores[store].set(k, v); }
}

class IDBBackend {
  constructor(db) {
    this.db = db;
    this.persistent = true;
  }
  tx(store, mode = 'readonly') {
    return this.db.transaction(store, mode).objectStore(store);
  }
  async get(store, key) { return req(this.tx(store).get(key)); }
  async put(store, key, value) { return req(this.tx(store, 'readwrite').put(value, key)); }
  async delete(store, key) { return req(this.tx(store, 'readwrite').delete(key)); }
  async getAll(store) { return req(this.tx(store).getAll()); }
  async keysWithPrefix(store, prefix) {
    return req(this.tx(store).getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿')));
  }
  async deletePrefix(store, prefix) {
    return req(this.tx(store, 'readwrite').delete(IDBKeyRange.bound(prefix, prefix + '￿')));
  }
  async putMany(store, entries) {
    if (!entries.length) return;
    const t = this.db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    for (const [k, v] of entries) os.put(v, k);
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
}

let backendPromise = null;

export function openBackend() {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    try {
      if (!window.indexedDB) throw new Error('no indexedDB');
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const s of ['worlds', 'chunks', 'entities']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      const db = await Promise.race([req(open), new Promise((_, rej) => setTimeout(() => rej(new Error('indexedDB timeout')), 4000))]);
      return new IDBBackend(db);
    } catch (e) {
      console.warn('Saving is unavailable, worlds will not persist:', e && e.message);
      return new MemoryBackend();
    }
  })();
  return backendPromise;
}

export async function listWorlds() {
  const b = await openBackend();
  const all = (await b.getAll('worlds')) || [];
  return all.sort((a, c) => (c.lastPlayed || 0) - (a.lastPlayed || 0));
}

export async function saveWorldMeta(meta) {
  const b = await openBackend();
  await b.put('worlds', meta.id, meta);
}

export async function loadWorldMeta(id) {
  const b = await openBackend();
  return b.get('worlds', id);
}

export async function deleteWorld(id) {
  const b = await openBackend();
  await b.delete('worlds', id);
  await b.deletePrefix('chunks', id + ':');
  await b.deletePrefix('entities', id + ':');
}

export async function isPersistent() {
  const b = await openBackend();
  return b.persistent;
}

// Per-world chunk storage used by the chunk loader.
export class WorldStore {
  constructor(worldId) {
    this.id = worldId;
    this.chunkKeys = new Set();
    this.entityKeys = new Set();
    this.backend = null;
    this.pending = new Map();
  }

  async init() {
    this.backend = await openBackend();
    const prefix = this.id + ':';
    for (const k of await this.backend.keysWithPrefix('chunks', prefix)) this.chunkKeys.add(k.slice(prefix.length));
    for (const k of await this.backend.keysWithPrefix('entities', prefix)) this.entityKeys.add(k.slice(prefix.length));
  }

  key(cx, cz) {
    return `${cx},${cz}`;
  }

  hasChunk(cx, cz) {
    return this.chunkKeys.has(this.key(cx, cz));
  }

  async loadChunk(cx, cz) {
    const k = this.key(cx, cz);
    if (this.pending.has('c' + k)) return this.pending.get('c' + k);
    const rec = await this.backend.get('chunks', `${this.id}:${k}`);
    if (!rec) return null;
    return { ...rec, cx, cz };
  }

  queueChunk(c, record) {
    const k = this.key(c.cx, c.cz);
    this.chunkKeys.add(k);
    this.pending.set('c' + k, record);
  }

  hasEntities(cx, cz) {
    return this.entityKeys.has(this.key(cx, cz));
  }

  async loadEntities(cx, cz) {
    const k = this.key(cx, cz);
    if (this.pending.has('e' + k)) return this.pending.get('e' + k);
    return this.backend.get('entities', `${this.id}:${k}`);
  }

  queueEntities(cx, cz, record) {
    const k = this.key(cx, cz);
    this.entityKeys.add(k);
    this.pending.set('e' + k, record);
  }

  // Write everything queued so far.
  async flush() {
    if (!this.pending.size) return;
    const chunks = [], ents = [];
    for (const [k, v] of this.pending) {
      if (k[0] === 'c') chunks.push([`${this.id}:${k.slice(1)}`, v]);
      else ents.push([`${this.id}:${k.slice(1)}`, v]);
    }
    this.pending.clear();
    try {
      await this.backend.putMany('chunks', chunks);
      await this.backend.putMany('entities', ents);
    } catch (e) {
      console.warn('Save failed', e);
    }
  }
}
