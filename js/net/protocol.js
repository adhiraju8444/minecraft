// Wire format shared by the browser client and the multiplayer server.
//
// JSON messages carry a `t` field naming the message. Chunk data travels as
// binary frames: [type u8][cx i32][cz i32][flags u8][payload], where flags
// bit 1 means the payload is zlib-compressed.

export const PROTOCOL = 1;
export const FRAME_CHUNK = 1;
export const FLAG_DEFLATE = 1;

const CHUNK_BYTES = 32768;
const COLUMN_BYTES = 256;
export const CHUNK_PAYLOAD_SIZE = CHUNK_BYTES * 2 + COLUMN_BYTES * 3;

// Entity kinds in snapshots
export const ENT = { MOB: 'm', ITEM: 'i', XP: 'x', FALLING: 'f', TNT: 't', PROJECTILE: 'p' };

// Mob state flag bits
export const MF = { HURT: 1, DEAD: 2, FIRE: 4, BABY: 8, SHEARED: 16, AIM: 32, EATING: 64, SWING: 128, LOVE: 256 };

// Player state flag bits
export const PF = { SNEAK: 1, SLEEP: 2, FLY: 4, SWING: 8, DEAD: 16, HURT: 32 };

export const MODES = ['survival', 'creative', 'spectator'];

export function round2(v) {
  return Math.round(v * 100) / 100;
}

export function encodeChunkPayload(c) {
  const out = new Uint8Array(CHUNK_PAYLOAD_SIZE);
  out.set(c.blocks, 0);
  out.set(c.meta, CHUNK_BYTES);
  out.set(c.biomes, CHUNK_BYTES * 2);
  out.set(c.temps, CHUNK_BYTES * 2 + COLUMN_BYTES);
  out.set(c.humids, CHUNK_BYTES * 2 + COLUMN_BYTES * 2);
  return out;
}

export function decodeChunkPayload(u8) {
  if (u8.length < CHUNK_PAYLOAD_SIZE) throw new Error('short chunk payload');
  const slice = (a, n) => u8.slice(a, a + n);
  return {
    blocks: slice(0, CHUNK_BYTES),
    meta: slice(CHUNK_BYTES, CHUNK_BYTES),
    biomes: slice(CHUNK_BYTES * 2, COLUMN_BYTES),
    temps: slice(CHUNK_BYTES * 2 + COLUMN_BYTES, COLUMN_BYTES),
    humids: slice(CHUNK_BYTES * 2 + COLUMN_BYTES * 2, COLUMN_BYTES),
  };
}

export function chunkFrame(cx, cz, flags, payload) {
  const out = new Uint8Array(10 + payload.length);
  const dv = new DataView(out.buffer);
  out[0] = FRAME_CHUNK;
  dv.setInt32(1, cx, true);
  dv.setInt32(5, cz, true);
  out[9] = flags;
  out.set(payload, 10);
  return out;
}

export function parseFrame(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { type: u8[0], cx: dv.getInt32(1, true), cz: dv.getInt32(5, true), flags: u8[9], payload: u8.subarray(10) };
}

// Disk format for a changed chunk: "BFC1" + payload + u32 tile JSON length + tile JSON.
export function encodeDiskChunk(c, tiles) {
  const payload = encodeChunkPayload(c);
  const json = new TextEncoder().encode(JSON.stringify(tiles || []));
  const out = new Uint8Array(4 + payload.length + 4 + json.length);
  out.set([66, 70, 67, 49], 0);
  out.set(payload, 4);
  new DataView(out.buffer).setUint32(4 + payload.length, json.length, true);
  out.set(json, 8 + payload.length);
  return out;
}

export function decodeDiskChunk(u8) {
  if (u8[0] !== 66 || u8[1] !== 70 || u8[2] !== 67 || u8[3] !== 49) throw new Error('bad chunk file');
  const rec = decodeChunkPayload(u8.subarray(4, 4 + CHUNK_PAYLOAD_SIZE));
  const len = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(4 + CHUNK_PAYLOAD_SIZE, true);
  const json = new TextDecoder().decode(u8.subarray(8 + CHUNK_PAYLOAD_SIZE, 8 + CHUNK_PAYLOAD_SIZE + len));
  rec.tiles = JSON.parse(json || '[]');
  return rec;
}

// Basic validation helpers for anything that arrives over the network.
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isInt = (v) => Number.isInteger(v);
export function clampInt(v, lo, hi) {
  if (!isInt(v)) return null;
  return v < lo || v > hi ? null : v;
}

export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9_ -]{1,16}$/.test(n)) return null;
  return n;
}

export function cleanText(text, max = 200) {
  if (typeof text !== 'string') return '';
  // Strip control characters and trim.
  return text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
