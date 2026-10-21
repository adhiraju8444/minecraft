// Phone controls test: an emulated touch-screen phone plays single-player and
// joins a fresh server as its first player (who becomes the operator).
// Usage: node tools/test-touch.mjs   (needs Playwright; PLAYWRIGHT can point
// at its index.mjs). Starts its own server with an empty world.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const { B } = await import('../js/data/blocks.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8800 + Math.floor(Math.random() * 600);
const URL = `http://localhost:${PORT}/`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'blockforge-touch-'));

const server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA }, stdio: ['ignore', 'pipe', 'inherit'] });
// Never leave a server running, even if a check throws.
process.on('exit', () => server.kill('SIGKILL'));
process.on('uncaughtException', (e) => {
  console.error(e);
  process.exit(1);
});
await new Promise((resolve, reject) => {
  let out = '';
  server.stdout.on('data', (d) => {
    out += d;
    if (out.includes('Type "help"')) resolve();
  });
  server.on('exit', (code) => reject(new Error('server exited: ' + code + '\n' + out)));
});

let failures = 0;
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// A phone held sideways.
const ctx = await browser.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('blockforge.settings.v1', JSON.stringify({ renderDist: 3, music: 0, master: 0 }));
  } catch {
    /* ignore */
  }
});
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const cdp = await ctx.newCDPSession(page);
const g = (fn, arg) => page.evaluate(fn, arg);
const until = async (fn, arg, ms = 8000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
    return true;
  } catch {
    return false;
  }
};
const tap = (b) => page.tap(`.touch [data-b="${b}"]`);
const visible = (sel) => g((s) => {
  const e = document.querySelector(s);
  return !!e && e.offsetParent !== null;
}, sel);
async function hold(sel, ms) {
  const r = await g((s) => {
    const b = document.querySelector(s).getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, sel);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// Touch points are [x, y] (or [x, y, id] for a second finger).
async function drag(points, ms = 300) {
  const tp = (pts) => pts.map(([x, y, id = 0]) => ({ x, y, id }));
  const [from, to] = points;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([from]) });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2]]]) });
    await sleep(ms / steps);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const view = () => g(() => ({ yaw: window.blockforge.player.yaw, pitch: window.blockforge.player.pitch }));

// ---------------------------------------------------------------- single-player
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.blockforge && window.blockforge.state === 'title');
// Fullscreen from the title screen.
check(await visible('[data-act="fullscreen"]'), 'title screen has a Fullscreen button');
await page.tap('[data-act="fullscreen"]');
check(await until(() => !!document.fullscreenElement), 'Fullscreen button enters full screen');
check(await until(() => document.querySelector('[data-act="fullscreen"]').textContent === 'Exit Fullscreen'), 'the button then offers to exit');
await page.tap('[data-act="fullscreen"]');
check(await until(() => !document.fullscreenElement && document.querySelector('[data-act="fullscreen"]').textContent === 'Fullscreen'), 'Exit Fullscreen leaves full screen');
check((await page.request.get(URL + 'manifest.webmanifest')).ok(), 'the web app manifest is served (home screen = full screen)');
await g(() => window.blockforge.createWorld({ name: 'Phone', seed: 'phone', mode: 'survival', difficulty: 0 }));
await page.waitForFunction(() => window.blockforge.state === 'playing', null, { timeout: 120000 });
await g(() => window.blockforge.ui.closeScreen());
check(await until(() => window.blockforge.input.touchActive && document.querySelector('.touch')?.classList.contains('hidden') === false, null, 60000), 'touch controls appear on a phone');
for (const b of ['sprint', 'chat', 'fn', 'drop', 'inv', 'pause', 'jump', 'sneak', 'attack', 'use']) check(await visible(`.touch [data-b="${b}"]`), `button shown: ${b}`);
check(!(await visible('.touch .stick')), 'no on-screen joystick');
check(!(await visible('.touch .fn-keys')), 'function keys start hidden');

await tap('fn');
check(await visible('.touch .fn-keys'), 'Fn shows the function keys');
check(await visible('.touch [data-b="mode"]'), 'Mode key is offered in a single-player world');
check(!(await visible('.touch [data-b="players"]')), 'Players key is hidden in single-player');
await tap('mode');
check(await until(() => window.blockforge.player.mode === 'creative'), 'Mode switches survival → creative');
check(!(await visible('.touch .fn-keys')), 'function keys close after one is used');
for (const m of ['spectator', 'survival']) {
  await tap('fn');
  await tap('mode');
  check(await until((x) => window.blockforge.player.mode === x, m), `Mode switches to ${m}`);
}
await tap('fn');
await tap('camera');
check((await g(() => window.blockforge.perspective)) === 1, 'F5 key changes the camera');
await tap('fn');
await tap('camera');
await tap('fn');
await tap('camera');
await tap('fn');
await tap('debug');
check(await g(() => window.blockforge.ui.debug), 'F3 key shows the debug info');
await tap('fn');
await tap('hud');
check(!(await g(() => window.blockforge.ui.hudVisible)), 'F1 key hides the HUD');
await tap('fn');
await tap('hud');
check(await g(() => window.blockforge.ui.hudVisible), 'F1 key shows the HUD again');

// First-person camera: drag anywhere on the open screen to look around.
check(await g(() => document.elementFromPoint(560, 150)?.id === 'game'), 'touches on the open screen reach the game', await g(() => document.elementFromPoint(560, 150)?.className));
await g(() => (window.blockforge.player.pitch = 0));
let v0 = await view();
await drag([[450, 150], [650, 150]]);
let v1 = await view();
check(v1.yaw < v0.yaw - 0.3 && Math.abs(v1.pitch - v0.pitch) < 0.05, 'dragging sideways turns the camera left and right (x axis)', `${(v1.yaw - v0.yaw).toFixed(2)} / ${(v1.pitch - v0.pitch).toFixed(2)}`);
v0 = v1;
await drag([[500, 250], [500, 130]]);
v1 = await view();
check(v1.pitch > v0.pitch + 0.2 && Math.abs(v1.yaw - v0.yaw) < 0.05, 'dragging up tilts the camera up (y axis)', `${(v1.yaw - v0.yaw).toFixed(2)} / ${(v1.pitch - v0.pitch).toFixed(2)}`);
v0 = v1;
await drag([[500, 130], [400, 230]]);
v1 = await view();
check(v1.pitch < v0.pitch - 0.2 && v1.yaw > v0.yaw + 0.2, 'a diagonal drag moves both axes at once', `${(v1.yaw - v0.yaw).toFixed(2)} / ${(v1.pitch - v0.pitch).toFixed(2)}`);
// Hold still to mine, tap a hotbar slot to select it.
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 520, y: 170 }] });
await sleep(500);
check(await g(() => window.blockforge.input.state.attack), 'holding a finger still mines');
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
check(!(await g(() => window.blockforge.input.state.attack)), 'lifting the finger stops mining');
await page.tap('.hotbar .hslot:nth-child(5)');
check((await g(() => window.blockforge.player.inventory.selected)) === 4, 'tapping the hotbar selects a slot');

await tap('sprint');
check(await g(() => window.blockforge.input.state.sprint && document.querySelector('.touch [data-b="sprint"]').classList.contains('on')), 'Sprint stays on after a tap');
await tap('sprint');
check(!(await g(() => window.blockforge.input.state.sprint)), 'Sprint turns off with a second tap');

// Drop: tap for one item, hold for the stack.
await g((id) => {
  const p = window.blockforge.player;
  p.inventory.slots[p.inventory.selected] = { id, count: 10, dmg: 0 };
  p.inventory.changed();
}, B.dirt);
const count = () => g(() => {
  const inv = window.blockforge.player.inventory;
  return inv.slots[inv.selected]?.count || 0;
});
await tap('drop');
check(await until(() => window.blockforge.player.inventory.slots[window.blockforge.player.inventory.selected]?.count === 9), 'Drop tap drops one item', String(await count()));
await hold('.touch [data-b="drop"]', 700);
check((await count()) === 0, 'holding Drop drops the whole stack', String(await count()));

// Inventory: Close, Quick Move and Split buttons.
await g((id) => {
  const inv = window.blockforge.player.inventory;
  inv.slots[20] = { id, count: 8, dmg: 0 };
  inv.changed();
}, B.cobblestone);
await tap('inv');
check(await until(() => window.blockforge.ui.containers.open), 'Bag opens the inventory');
check(await visible('.touch-bar'), 'inventory shows the touch bar');
const slotBox = (i) => g((n) => {
  const c = window.blockforge.ui.containers;
  const st = window.blockforge.player.inventory.slots[n];
  const s = c.slots.find((x) => x.get && x.get() === st && !x.output);
  const r = s.el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, i);
await page.tap('.touch-bar [data-m="split"]');
let at = await slotBox(20);
await page.touchscreen.tap(at.x, at.y);
check(await until(() => window.blockforge.ui.containers.cursor?.count === 4 && window.blockforge.player.inventory.slots[20]?.count === 4), 'Split picks up half a stack');
await page.touchscreen.tap(at.x, at.y);
check(await until(() => window.blockforge.ui.containers.cursor?.count === 3 && window.blockforge.player.inventory.slots[20]?.count === 5), 'Split then places one item', JSON.stringify(await g(() => [window.blockforge.ui.containers.cursor, window.blockforge.player.inventory.slots[20], window.blockforge.ui.containers.touchMode])));
await page.tap('.touch-bar [data-m="split"]');
check(await g(() => window.blockforge.ui.containers.touchMode === ''), 'Split turns off with a second tap');
await page.touchscreen.tap(at.x, at.y);
check(await until(() => !window.blockforge.ui.containers.cursor && window.blockforge.player.inventory.slots[20]?.count === 8), 'a plain tap puts the rest back');
await page.tap('.touch-bar [data-m="shift"]');
check(await g(() => window.blockforge.ui.containers.touchMode === 'shift'), 'Quick Move replaces Split');
at = await slotBox(20);
await page.touchscreen.tap(at.x, at.y);
check(await until((id) => !window.blockforge.player.inventory.slots[20] && window.blockforge.player.inventory.slots.slice(0, 9).some((s) => s && s.id === id && s.count === 8), B.cobblestone), 'Quick Move moves the stack to the hotbar');
await page.tap('.touch-bar [data-m="close"]');
check(await until(() => !window.blockforge.ui.containers.open && document.querySelector('.touch')?.classList.contains('hidden') === false), '✕ closes the inventory and the controls come back');

// Chat: Send and ✕.
await tap('chat');
check(await until(() => window.blockforge.ui.chatOpen && document.activeElement?.id === 'chat-input'), 'Chat opens with the keyboard focused');
await page.keyboard.type('hello from a phone');
await page.tap('.chat-input-wrap button[type=submit]');
check(await until(() => !window.blockforge.ui.chatOpen && [...document.querySelectorAll('.chat-line')].some((l) => l.textContent.endsWith('hello from a phone'))), 'Send posts the message');
await tap('fn');
await tap('command');
check(await until(() => window.blockforge.ui.chatOpen && document.getElementById('chat-input').value === '/'), 'Command key opens the chat with /');
await page.tap('.chat-input-wrap [data-close]');
check(await until(() => !window.blockforge.ui.chatOpen), '✕ closes the chat');
await g(() => window.blockforge.quitToTitle());
await page.waitForFunction(() => window.blockforge.state === 'title');

// ---------------------------------------------------------------- multiplayer
await g(() => window.blockforge.joinServer({ address: '', name: 'Phoebe' }));
await page.waitForFunction(() => window.blockforge.state === 'playing' && window.blockforge.net, null, { timeout: 120000 });
await g(() => window.blockforge.ui.closeScreen());
check(await g(() => window.blockforge.net.welcome.op === true), 'the first player to join the server is an operator');
check(await until(() => [...document.querySelectorAll('.chat-line')].some((l) => /you are this server's operator/.test(l.textContent))), 'the operator is told so in the chat');
await tap('fn');
check(await visible('.touch [data-b="players"]'), 'Players key is offered in multiplayer');
check(await visible('.touch [data-b="mode"]'), 'Mode key is offered to the operator');
await tap('mode');
check(await until(() => window.blockforge.player.mode === 'creative'), 'operator switches to creative with the Mode key');
await tap('fn');
await tap('players');
check(await until(() => !!window.blockforge.ui.playerListEl && /Phoebe/.test(window.blockforge.ui.playerListEl.textContent)), 'Players key shows who is online');
await tap('fn');
await tap('players');
check(!(await g(() => !!window.blockforge.ui.playerListEl)), 'Players key hides the list again');
await g(() => window.blockforge.commands.run('/deop Phoebe'));
check(await until(() => window.blockforge.net.welcome.op === false), 'deop reaches the client');
await tap('fn');
check(!(await visible('.touch [data-b="mode"]')), 'Mode key is hidden from non-operators');
await tap('fn');

check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
await browser.close();
await new Promise((r) => {
  server.removeAllListeners('exit');
  server.on('exit', r);
  server.kill('SIGTERM');
});
fs.rmSync(DATA, { recursive: true, force: true });
console.log(failures ? `${failures} check(s) failed` : 'All touch checks passed');
process.exit(failures ? 1 : 0);
