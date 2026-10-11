#!/usr/bin/env node
// Blockforge multiplayer server: serves the game itself and runs one shared
// world that everyone who opens the page can join.
//
//   npm install
//   npm start                 -> http://localhost:8080
//
// Settings come from environment variables (see README.md, "Multiplayer").
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';
import { Storage } from './storage.js';
import { ServerGame } from './game.js';
import { PROTOCOL, chunkFrame } from '../js/net/protocol.js';
import { DIFFICULTY } from '../js/world/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------ settings
const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v, d, lo, hi) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const difficultyOf = (v) => {
  if (v === undefined || v === '') return 2;
  const i = DIFFICULTY.findIndex((d) => d.toLowerCase() === String(v).toLowerCase());
  return i >= 0 ? i : int(v, 2, 0, 3);
};

const cfg = {
  port: int(env.PORT, 8080, 1, 65535),
  host: env.HOST || '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
  serverName: (env.SERVER_NAME || 'Blockforge Server').slice(0, 40),
  motd: (env.MOTD || 'A world for friends').slice(0, 80),
  worldName: (env.WORLD_NAME || 'Shared World').slice(0, 32),
  seed: env.SEED || '',
  gamemode: ['survival', 'creative'].includes(env.GAMEMODE) ? env.GAMEMODE : 'survival',
  difficulty: difficultyOf(env.DIFFICULTY),
  maxPlayers: int(env.MAX_PLAYERS, 10, 1, 100),
  viewDistance: int(env.VIEW_DISTANCE, 10, 2, 16),
  simDistance: int(env.SIM_DISTANCE, 5, 2, 10),
  pvp: bool(env.PVP, true),
  password: env.PASSWORD || '',
  ops: (env.OPS || '').split(',').map((s) => s.trim()).filter(Boolean),
  autoOp: bool(env.AUTO_OP, true),
  autosaveTicks: int(env.AUTOSAVE_SECONDS, 60, 10, 3600) * 20,
  tickWhenEmpty: bool(env.TICK_WHEN_EMPTY, false),
  trustProxy: bool(env.TRUST_PROXY, true),
  maxPerIp: int(env.MAX_CONNECTIONS_PER_IP, 4, 1, 100),
  verbose: bool(env.VERBOSE, false),
};

// ------------------------------------------------------------ world
const storage = new Storage(cfg.dataDir);
const game = new ServerGame(cfg, storage);
const info = game.init();

// ------------------------------------------------------------ connections
const RATES = {
  // [per second, burst]
  msg: [300, 600],
  set: [40, 120],
  spawn: [40, 200],
  atk: [20, 40],
  req: [120, 600],
  tile: [40, 80],
  chat: [1, 6],
  fx: [80, 160],
  pd: [5, 20],
};

class Conn {
  constructor(ws, ip) {
    this.ws = ws;
    this.ip = ip;
    this.queue = [];
    this.player = null;
    this.known = new Map();
    this.vd = 8;
    this.viewing = null;
    this.tileSig = '';
    this.closed = false;
    this.ping = 0;
    this.lastPong = Date.now();
    this.buckets = {};
    this.bad = 0;
    this.bytesOut = 0; // before WebSocket compression
    this.since = Date.now();
  }

  allow(kind) {
    const [rate, burst] = RATES[kind];
    const now = performance.now();
    let b = this.buckets[kind];
    if (!b) b = this.buckets[kind] = { tokens: burst, t: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.t) / 1000) * rate);
    b.t = now;
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  }

  send(m) {
    if (!this.closed) this.queue.push(m);
  }

  flush() {
    if (!this.queue.length || this.closed) return;
    if (cfg.verbose) {
      this.byType = this.byType || {};
      for (const m of this.queue) this.byType[m.t] = (this.byType[m.t] || 0) + JSON.stringify(m).length;
    }
    const data = JSON.stringify(this.queue.length === 1 ? this.queue[0] : this.queue);
    this.queue = [];
    this.bytesOut += data.length;
    if (this.ws.readyState === 1) this.ws.send(data);
    if (this.ws.bufferedAmount > 32 << 20) this.kick('Your connection is too slow for this server');
  }

  sendChunk(cx, cz, payload) {
    if (this.closed || this.ws.readyState !== 1) return;
    this.flush();
    const frame = chunkFrame(cx, cz, 0, payload);
    this.bytesOut += frame.length;
    this.ws.send(frame, { binary: true });
  }

  kick(reason) {
    if (this.closed) return;
    this.queue.push({ t: 'kick', reason });
    this.flush();
    this.closed = true;
    this.reason = reason;
    try {
      this.ws.close(4000, String(reason).slice(0, 100));
    } catch {
      this.ws.terminate();
    }
    setTimeout(() => this.ws.terminate(), 3000).unref();
  }
}

// ------------------------------------------------------------ static files
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const PUBLIC_DIRS = ['css', 'js', 'vendor'];
const cache = new Map();

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath).replace(/\\/g, '/');
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + path.posix.normalize(rel));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  const allowed = file.startsWith(ROOT + path.sep) && (rel === '/index.html' || PUBLIC_DIRS.includes(top));
  if (!allowed) return notFound(res);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return notFound(res);
  }
  if (!st.isFile()) return notFound(res);
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  let entry = cache.get(file);
  if (!entry || entry.etag !== etag) {
    const body = fs.readFileSync(file);
    const text = /^(text|application\/json|image\/svg)/.test(type);
    entry = { etag, body, gz: text && body.length > 1024 ? zlib.gzipSync(body, { level: 9 }) : null };
    cache.set(file, entry);
  }
  if (entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
    res.writeHead(200, headers);
    return res.end(req.method === 'HEAD' ? undefined : entry.gz);
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : entry.body);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function serverInfo() {
  return {
    game: 'blockforge', protocol: PROTOCOL, name: cfg.serverName, motd: cfg.motd, world: game.level.name,
    players: game.players.map((p) => p.name), online: game.players.length, max: cfg.maxPlayers,
    password: !!cfg.password, mode: cfg.gamemode, difficulty: DIFFICULTY[game.difficulty],
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(serverInfo()));
  }
  try {
    serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error('[http]', e.message);
    res.writeHead(500);
    res.end();
  }
});

const perIp = new Map();
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 256 * 1024,
  perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 4, zlibDeflateOptions: { level: 4 } },
});

wss.on('connection', (ws, req) => {
  const fwd = cfg.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  const ip = fwd || req.socket.remoteAddress || '?';
  const n = (perIp.get(ip) || 0) + 1;
  perIp.set(ip, n);
  const conn = new Conn(ws, ip);
  game.addClient(conn);
  if (n > cfg.maxPerIp) conn.kick('Too many connections from your network');
  const helloTimer = setTimeout(() => {
    if (!conn.player) conn.kick('Timed out while joining');
  }, 15000);
  helloTimer.unref();
  ws.on('message', (data, isBinary) => {
    if (conn.closed || isBinary) return;
    if (!conn.allow('msg')) return conn.kick('You sent too many messages');
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      m = null;
    }
    const list = Array.isArray(m) ? m : [m];
    if (list.length > 2000) return conn.kick('You sent too many messages');
    for (const msg of list) {
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
        if (++conn.bad > 20) return conn.kick('The server could not understand your game');
        continue;
      }
      try {
        game.handle(conn, msg);
      } catch (e) {
        console.error(`[net] error handling "${msg.t}" from ${conn.player ? conn.player.name : conn.ip}:`, e);
      }
      if (conn.closed) return;
    }
  });
  ws.on('pong', () => {
    conn.lastPong = Date.now();
    if (conn.pingSent) conn.ping = Date.now() - conn.pingSent;
  });
  ws.on('close', () => {
    clearTimeout(helloTimer);
    conn.closed = true;
    const left = (perIp.get(ip) || 1) - 1;
    if (left <= 0) perIp.delete(ip);
    else perIp.set(ip, left);
    game.leave(conn);
  });
  ws.on('error', () => {});
});

// Keep-alive: drop connections that stop answering.
setInterval(() => {
  const now = Date.now();
  for (const c of game.clients) {
    if (now - c.lastPong > 30000) {
      c.reason = 'timed out';
      c.ws.terminate();
      continue;
    }
    c.pingSent = now;
    try {
      c.ws.ping();
    } catch {
      /* closing */
    }
  }
}, 5000).unref();

// ------------------------------------------------------------ game loop
const TICK = 50;
let next = performance.now();
let lagWarned = 0;
function loop() {
  if (game.stopped) return;
  const now = performance.now();
  let n = 0;
  while (now >= next && n < 5) {
    try {
      game.tick();
    } catch (e) {
      console.error('[tick] error:', e);
    }
    next += TICK;
    n++;
  }
  if (now - next > 2000) {
    if (now - lagWarned > 15000) {
      console.warn(`[tick] Can't keep up! Running ${Math.round((now - next) / TICK)} ticks behind; skipping them.`);
      lagWarned = now;
    }
    next = now;
  }
  setTimeout(loop, Math.max(1, next - performance.now()));
}

// ------------------------------------------------------------ console
if (process.stdin.isTTY || !process.stdin.destroyed) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    try {
      game.commands.runConsole(line);
    } catch (e) {
      console.error(e);
    }
  });
  rl.on('error', () => {});
}

// ------------------------------------------------------------ shutdown
let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n[server] ${signal}: saving the world and stopping...`);
  try {
    await game.shutdown();
  } catch (e) {
    console.error('[server] error while saving:', e);
  }
  wss.close();
  server.close();
  console.log('[server] saved. Bye!');
  process.exit(0);
}
// If whatever reads our output goes away, keep running (and keep saving).
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('uncaughtException', (e) => console.error('[server] unexpected error:', e));
process.on('unhandledRejection', (e) => console.error('[server] unexpected error:', e));

function listenError(e) {
  if (e.code === 'EADDRINUSE') console.error(`[server] Port ${cfg.port} is already in use (is another server running?). Set PORT to another number.`);
  else console.error('[server]', e.message);
  process.exit(1);
}
server.on('error', listenError);
wss.on('error', listenError);

server.listen(cfg.port, cfg.host, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  console.log('');
  console.log(`  Blockforge server "${cfg.serverName}" is running`);
  console.log(`  World: ${game.level.name} (seed ${game.level.seed})${info.fresh ? ' - new world' : `, ${info.chunks} changed chunks on disk`}`);
  console.log(`  Saves: ${cfg.dataDir}`);
  console.log(`  Play:  http://localhost:${cfg.port}${lan.length ? '   or on your network: ' + lan.map((a) => `http://${a}:${cfg.port}`).join('  ') : ''}`);
  console.log(`  Mode ${game.level.gamemode}, difficulty ${DIFFICULTY[game.difficulty]}, up to ${cfg.maxPlayers} players${cfg.password ? ', password protected' : ''}`);
  console.log('  Type "help" here for admin commands, Ctrl+C to save and stop.');
  console.log('');
  loop();
});
