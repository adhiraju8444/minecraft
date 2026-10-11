// Multiplayer end-to-end test: starts a server with an empty world, then two
// browsers join and play together; finally the server restarts to check
// that the world and players were saved.
// Usage: node tools/test-multiplayer.mjs   (needs Playwright; PLAYWRIGHT can
// point at its index.mjs). SHOTS=<folder> saves a screenshot.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const { B } = await import('../js/data/blocks.js');
const { I } = await import('../js/data/items.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8180 + Math.floor(Math.random() * 600);
const URL = `http://localhost:${PORT}/`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'blockforge-mp-'));
const SHOTS = process.env.SHOTS || '';

let server = null;
function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    server.stdout.on('data', (d) => {
      out += d;
      if (process.env.SERVER_LOG) fs.appendFileSync(process.env.SERVER_LOG, d);
      if (out.includes('Type "help"')) resolve();
    });
    server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
    server.on('exit', (code) => reject(new Error('server exited early: ' + code + '\n' + out)));
  });
}
function stopServer() {
  return new Promise((resolve) => {
    server.removeAllListeners('exit');
    server.on('exit', resolve);
    server.kill('SIGTERM');
  });
}

// Never leave a server running, even if a check throws.
process.on('exit', () => server && server.kill('SIGKILL'));
process.on('uncaughtException', (e) => {
  console.error(e);
  process.exit(1);
});

await startServer();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  // A short view distance keeps two software-rendered pages fast enough.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('blockforge.settings.v1', JSON.stringify({ renderDist: 3, music: 0, master: 0 }));
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push(m.text());
  });
  return page;
}

async function join(page, name) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.blockforge && window.blockforge.state === 'title');
  await page.evaluate((n) => window.blockforge.joinServer({ address: '', name: n }), name);
  await page.waitForFunction(() => window.blockforge.state === 'playing' && window.blockforge.net, null, { timeout: 120000 });
  await page.evaluate(() => window.blockforge.ui.closeScreen());
  return page;
}

async function openPlayer(name) {
  return join(await newPage(), name);
}

const until = async (page, fn, arg, ms = 8000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
    return true;
  } catch {
    return false;
  }
};

const a = await openPlayer('Alice');
check(true, 'Alice joined the server');
const b = await openPlayer('Bob');
check(true, 'Bob joined the server');

// Put both players on a small platform in the sky so the test does not depend on terrain.
const spot = await a.evaluate(() => {
  const p = window.blockforge.player;
  return { x: Math.floor(p.x), y: 110, z: Math.floor(p.z) };
});
// Alice is the first player on a fresh server, so she is an operator.
await a.evaluate(() => window.blockforge.net.send({ t: 'chat', m: '/gamemode creative' }));
check(await until(a, () => window.blockforge.player.mode === 'creative'), 'operator command /gamemode works');
await a.evaluate((s) => {
  const g = window.blockforge;
  g.player.teleport(s.x + 0.5, s.y + 1, s.z + 0.5);
  g.player.onGround = false;
  g.player.flying = true;
}, spot);
await sleep(500);
await a.evaluate(([s, id]) => {
  const g = window.blockforge;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) g.world.setBlock(s.x + x, s.y, s.z + z, id, 0);
}, [spot, B.stone]);

// The platform Alice built shows up for Bob, then both stand on it.
const platform = ([s, id]) => {
  const w = window.blockforge.world;
  let n = 0;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) if (w.getBlock(s.x + x, s.y, s.z + z) === id) n++;
  return n === 81;
};
check(await until(b, platform, [spot, B.stone]), "Bob's world has all of Alice's platform");
await a.evaluate(() => (window.blockforge.player.flying = false));
await b.evaluate((s) => window.blockforge.player.teleport(s.x + 3.5, s.y + 1, s.z + 0.5), spot);

// They see each other.
check(await until(a, () => window.blockforge.world.entities.some((e) => e.remote && e.name === 'Bob')), 'Alice sees Bob');
check(await until(b, () => window.blockforge.world.entities.some((e) => e.remote && e.name === 'Alice')), 'Bob sees Alice');
const bobAt = (s) => {
  const e = window.blockforge.world.entities.find((x) => x.remote && x.name === 'Bob');
  return !!e && Math.abs(e.x - (s.x + 3.5)) < 0.3 && Math.abs(e.y - (s.y + 1)) < 0.3 && Math.abs(e.z - (s.z + 0.5)) < 0.3;
};
check(await until(a, bobAt, spot), "Bob stands where Alice sees him");

// Bob walks; Alice sees him move smoothly.
await b.evaluate(() => {
  const g = window.blockforge;
  g.player.yaw = Math.PI / 2; // face -x
  g.input.state.forward = true;
});
await sleep(1200);
await b.evaluate(() => (window.blockforge.input.state.forward = false));
await sleep(500);
const moved = await a.evaluate(() => window.blockforge.world.entities.find((x) => x.remote && x.name === 'Bob')?.x);
const bobNow = await b.evaluate(() => window.blockforge.player.x);
check(moved !== undefined && Math.abs(moved - bobNow) < 0.5 && Math.abs(moved - (spot.x + 3.5)) > 1, 'Alice sees Bob walk', `${moved?.toFixed(2)} vs ${bobNow.toFixed(2)}`);

// Chat
await a.evaluate(() => window.blockforge.net.send({ t: 'chat', m: 'hi bob' }));
check(await until(b, () => window.blockforge.ui.chatLines.some((l) => l.el.textContent === '<Alice> hi bob')), 'chat message reaches Bob');

// Blocks: Alice places and breaks; Bob sees both.
const bx = spot.x - 2, by = spot.y + 1, bz = spot.z - 2;
await a.evaluate(async ([x, y, z]) => {
  const { B } = await import('./js/data/blocks.js');
  window.blockforge.world.setBlock(x, y, z, B.oak_planks, 0);
}, [bx, by, bz]);
check(await until(b, ([x, y, z]) => window.blockforge.world.getBlock(x, y, z) !== 0, [bx, by, bz]), 'Bob sees the block Alice placed');

// Survival drops: Alice switches to survival and breaks the planks; the item drops for both.
await a.evaluate(() => window.blockforge.net.send({ t: 'chat', m: '/gamemode survival' }));
await until(a, () => window.blockforge.player.mode === 'survival');
await a.evaluate(([x, y, z]) => window.blockforge.player.breakBlock(x, y, z), [bx, by, bz]);
check(await until(b, ([x, y, z]) => window.blockforge.world.getBlock(x, y, z) === 0, [bx, by, bz]), 'Bob sees the block broken');
check(await until(b, () => window.blockforge.world.entities.some((e) => e.stack && e.stack.count > 0)), 'the dropped item appears for Bob');

// Bob walks over the item and picks it up (the server decides).
const before = await b.evaluate((id) => window.blockforge.player.inventory.count(id), B.oak_planks);
await b.evaluate(() => {
  const g = window.blockforge;
  const it = g.world.entities.find((e) => e.stack);
  if (it) g.player.teleport(it.x, it.y + 0.1, it.z);
});
check(await until(b, ([n, id]) => window.blockforge.player.inventory.count(id) > n, [before, B.oak_planks]), 'Bob picks up the planks');
check(await until(a, () => !window.blockforge.world.entities.some((e) => e.stack)), 'the item disappears for Alice too');

// Chests: Alice fills one, Bob opens it and sees the contents.
const cx = spot.x + 2, cz = spot.z - 3;
await a.evaluate(async ([x, y, z]) => {
  const g = window.blockforge;
  const { B } = await import('./js/data/blocks.js');
  const { I } = await import('./js/data/items.js');
  g.world.setBlock(x, y, z, B.chest, 0);
  await new Promise((r) => setTimeout(r, 400));
  const te = g.world.getTileEntity(x, y, z);
  g.ui.openChest(te);
  await new Promise((r) => setTimeout(r, 300));
  te.items[4] = { id: I.diamond, count: 3, dmg: 0 };
  g.world.markTileDirty(te);
  await new Promise((r) => setTimeout(r, 300));
  g.ui.containers.close();
}, [cx, by, cz]);
await sleep(500);
await b.evaluate(([x, y, z]) => {
  const g = window.blockforge;
  g.ui.openChest(g.world.getTileEntity(x, y, z));
}, [cx, by, cz]);
check(await until(b, ([x, y, z]) => {
  const te = window.blockforge.world.getTileEntity(x, y, z);
  return te && te.items[4] && te.items[4].count === 3;
}, [cx, by, cz]), 'Bob sees the diamonds Alice put in the chest');
await b.evaluate(() => window.blockforge.ui.containers.close());

// Mobs: summon a pig; both see it; Alice hits it.
await a.evaluate((s) => window.blockforge.net.send({ t: 'chat', m: `/summon pig ${s.x + 0.5} ${s.y + 1} ${s.z + 3.5}` }), spot);
check(await until(b, () => window.blockforge.world.entities.some((e) => e.type === 'pig')), 'Bob sees the summoned pig');
const hp = await a.evaluate(async (s) => {
  const g = window.blockforge;
  await new Promise((r) => setTimeout(r, 500));
  // The summoned pig is the one nearest to where it was summoned (wild pigs may live nearby).
  const pigs = g.world.entities.filter((e) => e.type === 'pig');
  const d = (e) => Math.hypot(e.x - (s.x + 0.5), e.z - (s.z + 3.5));
  const pig = pigs.sort((x, y) => d(x) - d(y))[0];
  if (!pig) return null;
  const h0 = pig.health;
  g.player.attack(pig);
  await new Promise((r) => setTimeout(r, 800));
  return [h0, pig.health];
}, spot);
check(!!hp && hp[1] < hp[0], 'hitting the pig hurts it on the server', JSON.stringify(hp));

// PvP: Alice hits Bob (both survival).
const bobHealth = await b.evaluate(() => window.blockforge.player.health);
await a.evaluate(() => {
  const g = window.blockforge;
  const bob = g.world.entities.find((e) => e.remote && e.name === 'Bob');
  if (bob) {
    g.player.teleport(bob.x + 1.5, bob.y, bob.z);
    g.player.attack(bob);
  }
});
check(await until(b, (h) => window.blockforge.player.health < h, bobHealth), 'Bob takes damage when Alice hits him');

// Time and weather follow the server.
await a.evaluate(() => window.blockforge.net.send({ t: 'chat', m: '/time set midnight' }));
check(await until(b, () => Math.abs(window.blockforge.world.time - 18000) < 100), "Bob's clock follows the server");

// Player list
const list = await b.evaluate(() => window.blockforge.net.players.map((p) => p[1]).sort().join(','));
check(list === 'Alice,Bob', 'player list has both players', list);

if (SHOTS) {
  await a.evaluate(() => window.blockforge.net.send({ t: 'chat', m: '/time set noon' }));
  await b.evaluate((s) => {
    const g = window.blockforge;
    g.player.teleport(s.x + 0.5, s.y + 1, s.z + 0.5);
    g.player.yaw = 0;
  }, spot);
  await a.evaluate((s) => {
    const g = window.blockforge;
    g.player.teleport(s.x + 0.5, s.y + 1, s.z + 4.5);
    g.player.yaw = 0;
    g.player.pitch = -0.1;
    g.perspective = 0;
  }, spot);
  await sleep(1500);
  await a.screenshot({ path: `${SHOTS}/mp-alice.png` });
}

// Bob leaves; Alice is told.
await b.evaluate(() => window.blockforge.quitToTitle());
check(await until(a, () => window.blockforge.ui.chatLines.some((l) => l.el.textContent === 'Bob left the game')), 'Alice is told Bob left');
check(await until(a, () => !window.blockforge.world.entities.some((e) => e.remote && e.name === 'Bob')), "Bob's body disappears");
const bErrors = b.errors;
await b.context().close(); // the rest only needs Alice

// ---------------------------------------------------------------- part 2: one player, deeper checks
const cmd = (c) => a.evaluate((c) => window.blockforge.net.send({ t: 'chat', m: c }), c);
await cmd('/gamemode creative');
await until(a, () => window.blockforge.player.mode === 'creative');
await a.evaluate((s) => {
  const p = window.blockforge.player;
  p.teleport(s.x + 0.5, s.y + 1, s.z + 0.5);
  p.flying = false;
}, spot);
await cmd('/give diamond 7');
check(await until(a, (id) => window.blockforge.player.inventory.count(id) === 7, I.diamond), '/give puts items in the inventory');

// Furnace: the server smelts while the player watches.
const fpos = [spot.x - 3, spot.y + 1, spot.z + 3];
await a.evaluate(async ([x, y, z, F, ore, coal]) => {
  const g = window.blockforge;
  g.world.setBlock(x, y, z, F, 0);
  await new Promise((r) => setTimeout(r, 400));
  const te = g.world.getTileEntity(x, y, z);
  g.ui.openFurnace(te);
  await new Promise((r) => setTimeout(r, 300));
  te.items[0] = { id: ore, count: 1, dmg: 0 };
  te.items[1] = { id: coal, count: 1, dmg: 0 };
  g.world.markTileDirty(te);
}, [...fpos, B.furnace, B.iron_ore, I.coal]);
check(await until(a, ([x, y, z, id]) => {
  const te = window.blockforge.world.getTileEntity(x, y, z);
  return te && te.items[2] && te.items[2].id === id;
}, [...fpos, I.iron_ingot], 20000), 'the furnace smelts iron on the server');
await a.evaluate(() => window.blockforge.ui.containers.close());

// Bow: the server creates the arrow.
await cmd('/gamemode survival');
await until(a, () => window.blockforge.player.mode === 'survival');
await a.evaluate(() => window.blockforge.shootArrow(window.blockforge.player, 2.5, true));
check(await until(a, () => window.blockforge.world.entities.some((e) => e.kind === 'arrow')), 'an arrow shot by the player flies');

// A zombie hurts the player.
await cmd('/time set midnight');
const hp0 = await a.evaluate(() => window.blockforge.player.health);
await cmd(`/summon zombie ${spot.x + 2.5} ${spot.y + 1} ${spot.z + 0.5}`);
check(await until(a, (h) => window.blockforge.player.health < h, hp0, 15000), 'a zombie attacks the player');

// Death drops the inventory for everyone to see; respawning works.
await cmd('/kill');
check(await until(a, () => window.blockforge.state === 'dead'), 'the player dies');
check(await until(a, (id) => window.blockforge.world.entities.some((e) => e.stack && e.stack.id === id), I.diamond), 'dropped diamonds lie on the ground');
await a.evaluate(() => {
  window.blockforge.ui.closeScreen();
  window.blockforge.respawn();
});
check(await until(a, () => window.blockforge.state === 'playing' && window.blockforge.player.health === 20), 'respawn with full health');

// Dying from something the browser works out itself (here: burning) also drops everything.
await cmd('/give stick 4');
await until(a, (id) => window.blockforge.player.inventory.count(id) === 4, I.stick);
await a.evaluate(() => {
  const p = window.blockforge.player;
  p.health = 1;
  p.fireTicks = 40;
});
check(await until(a, () => window.blockforge.state === 'dead', null, 15000), 'the player burns to death', await a.evaluate(() => JSON.stringify({ s: window.blockforge.state, h: window.blockforge.player.health, f: window.blockforge.player.fireTicks, m: window.blockforge.player.mode, inv: window.blockforge.player.invuln })));
check(await until(a, (id) => window.blockforge.world.entities.some((e) => e.stack && e.stack.id === id), I.stick), 'items dropped on a death worked out by the browser reach the world');
await a.evaluate(() => {
  window.blockforge.ui.closeScreen();
  window.blockforge.respawn();
});
await until(a, () => window.blockforge.state === 'playing');

// Saving: restart the server; blocks, containers and the player come back.
await cmd('/give gold_ingot 3');
await until(a, (id) => window.blockforge.player.inventory.count(id) === 3, I.gold_ingot);
await sleep(800);
const posBefore = await a.evaluate(() => [window.blockforge.player.x, window.blockforge.player.z]);
await stopServer();
check(await until(a, () => window.blockforge.ui.screenName === 'neterror', null, 10000), 'a disconnected screen appears when the server stops');
await startServer();
await join(a, 'Alice');
const after = await a.evaluate(([s, stone, fx, fy, fz, gold]) => {
  const g = window.blockforge;
  return {
    platform: g.world.getBlock(s.x - 4, s.y, s.z + 4) === stone,
    furnace: !!g.world.getTileEntity(fx, fy, fz),
    gold: g.player.inventory.count(gold),
    pos: [g.player.x, g.player.z],
  };
}, [spot, B.stone, ...fpos, I.gold_ingot]);
check(after.platform, 'built blocks survive a restart');
check(after.furnace, 'the furnace survives a restart');
check(after.gold === 3, 'the inventory survives a restart', after.gold === 3 ? '3' : String(after.gold) + ' — ' + JSON.stringify(await a.evaluate(() => ({ state: window.blockforge.state, hp: window.blockforge.player.health, y: window.blockforge.player.y, chat: window.blockforge.ui.chatLines.map((l) => l.el.textContent) }))) + ' — file: ' + fs.readFileSync(path.join(DATA, 'players', 'alice.json'), 'utf8').slice(0, 400));
check(Math.hypot(after.pos[0] - posBefore[0], after.pos[1] - posBefore[1]) < 1.5, 'the position survives a restart');

// Someone else cannot use a name that is taken.
const aErrors = a.errors;
await a.evaluate(() => window.blockforge.quitToTitle());
await sleep(500);
await a.context().close(); // free the CPU for the next browser
const c = await newPage();
await c.goto(URL, { waitUntil: 'domcontentloaded' });
await c.waitForFunction(() => window.blockforge && window.blockforge.state === 'title');
await c.evaluate(() => window.blockforge.joinServer({ address: '', name: 'alice' }));
await c.waitForFunction(() => window.blockforge.ui.screenName === 'neterror', null, { timeout: 30000 });
const refusal = await c.evaluate(() => document.querySelector('.menu-sub')?.textContent || '');
check(/belongs to another player/.test(refusal), 'a different browser cannot take a used name', refusal);

for (const [n, errors] of [['Alice', aErrors], ['Bob', bErrors]]) {
  const errs = errors.filter((e) => !/favicon|WebGL|GPU stall|Automatic fallback/.test(e));
  check(errs.length === 0, `${n}'s page has no errors`, errs.slice(0, 3).join(' | '));
}
await browser.close();
await stopServer();
fs.rmSync(DATA, { recursive: true, force: true });
console.log(failures ? `${failures} check(s) failed` : 'All multiplayer checks passed');
process.exit(failures ? 1 : 0);
