// End-to-end checks of core mechanics in headless Chromium.
// Usage: start a static server on :8080 (npm start), then `node tools/test-browser.mjs`.
// Needs Playwright (npx playwright or a global install).
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const URL = process.env.GAME_URL || 'http://localhost:8080/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL);
await page.waitForFunction(() => window.blockforge && window.blockforge.state === 'title');
await page.evaluate(() => window.blockforge.createWorld({ name: 'Test World', seed: 'mechanics', mode: 'survival', difficulty: 0 }));
await page.waitForFunction(() => window.blockforge.state === 'playing', null, { timeout: 120000 });

const results = await page.evaluate(async () => {
  const g = window.blockforge;
  g.ui.closeScreen();
  const w = g.world, p = g.player;
  const out = {};
  const B = await import('./js/data/blocks.js').then((m) => m.B);
  const { I } = await import('./js/data/items.js');
  const { matchRecipe } = await import('./js/data/recipes.js');
  const ticks = (n) => { for (let i = 0; i < n; i++) g.tick(); };
  // Build a flat test platform high in the sky.
  const bx = Math.floor(p.x), bz = Math.floor(p.z), Y = 100;
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) {
    w.setBlock(bx + x, Y, bz + z, B.stone, 0, 0);
    for (let y = Y + 1; y < Y + 6; y++) w.setBlock(bx + x, y, bz + z, 0, 0, 0);
  }
  g.difficulty = 0;
  // ---- walking speed
  p.teleport(bx + 0.5, Y + 1, bz + 0.5);
  p.yaw = 0; p.pitch = 0;
  ticks(5);
  const z0 = p.z;
  g.input.state.forward = true;
  ticks(40);
  g.input.state.forward = false;
  out.walkSpeed = +((z0 - p.z) / 2).toFixed(2); // blocks per second
  // ---- jump height
  p.teleport(bx + 0.5, Y + 1, bz + 0.5);
  ticks(3);
  g.input.state.jump = true;
  let maxY = p.y;
  for (let i = 0; i < 14; i++) { g.tick(); maxY = Math.max(maxY, p.y); if (i === 1) g.input.state.jump = false; }
  g.input.state.jump = false;
  out.jumpHeight = +(maxY - (Y + 1)).toFixed(3);
  ticks(20);
  // ---- crafting
  const grid = [{ id: B.oak_log, count: 1 }, null, null, null];
  const r1 = matchRecipe(grid, 2, 2);
  const pick = [{ id: B.cobblestone }, { id: B.cobblestone }, { id: B.cobblestone }, null, { id: I.stick }, null, null, { id: I.stick }, null];
  const r2 = matchRecipe(pick, 3, 3);
  const tableMirror = [null, null, null, { id: B.oak_planks }, { id: B.oak_planks }, null, { id: B.oak_planks }, { id: B.oak_planks }, null];
  out.crafting = [r1 && r1.result.join('x'), r2 && r2.result.join('x'), matchRecipe(tableMirror, 3, 3)?.result.join('x')];
  // ---- water spreading
  const wx = bx + 6, wz = bz + 6;
  w.setBlock(wx, Y + 1, wz, B.water, 0);
  ticks(120);
  let water = 0;
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) if (w.getBlock(wx + x, Y + 1, wz + z) === B.water) water++;
  out.waterCells = water; // a diamond of radius 7 has 113 cells
  // infinite source: dig a 2x1 pool and fill corners
  // ---- lava meets water
  const lx = bx - 6, lz = bz - 6;
  w.setBlock(lx, Y + 1, lz, B.lava, 0);
  w.setBlock(lx + 1, Y + 1, lz, B.water, 0);
  ticks(40);
  out.lavaWater = Object.keys(B).find((k) => B[k] === w.getBlock(lx, Y + 1, lz));
  // ---- falling sand
  w.setBlock(bx - 3, Y + 5, bz + 3, B.sand, 0);
  ticks(60);
  out.sandLanded = w.getBlock(bx - 3, Y + 1, bz + 3) === B.sand && w.getBlock(bx - 3, Y + 5, bz + 3) === 0;
  // ---- furnace
  w.setBlock(bx + 3, Y + 1, bz - 3, B.furnace, 0);
  const te = w.getTileEntity(bx + 3, Y + 1, bz - 3);
  te.items[0] = { id: B.iron_ore, count: 2, dmg: 0 };
  te.items[1] = { id: I.coal, count: 1, dmg: 0 };
  ticks(5);
  out.furnaceLit = w.getBlock(bx + 3, Y + 1, bz - 3) === B.lit_furnace;
  ticks(420);
  out.furnaceOut = te.items[2] ? `${te.items[2].count}x${te.items[2].id === I.iron_ingot ? 'iron_ingot' : te.items[2].id}` : null;
  // ---- mining with drops
  p.teleport(bx + 0.5, Y + 1, bz + 0.5);
  p.inventory.clear();
  p.inventory.slots[0] = { id: I.stone_pickaxe, count: 1, dmg: 0 };
  p.inventory.selected = 0;
  w.setBlock(bx, Y + 1, bz - 2, B.stone, 0);
  p.yaw = 0; p.pitch = -0.35;
  ticks(2);
  p.updateTarget();
  out.target = p.hit ? `${p.hit.x - bx},${p.hit.y - Y},${p.hit.z - bz}` : null;
  g.input.state.attack = true; g.input.push('attack');
  let t = 0;
  while (w.getBlock(bx, Y + 1, bz - 2) === B.stone && t < 200) { g.tick(); t++; }
  g.input.state.attack = false;
  out.mineTicks = t; // stone pickaxe on stone: 0.6s (~12 ticks + delay)
  ticks(30);
  out.gotCobble = p.inventory.count(B.cobblestone);
  out.pickDamage = p.inventory.slots[0]?.dmg;
  // ---- explosion
  for (let x = 0; x < 3; x++) for (let y = 1; y < 4; y++) w.setBlock(bx - 8 + x, Y + y, bz + 8, B.dirt, 0);
  p.teleport(bx + 10.5, Y + 1, bz - 10.5);
  g.primeTNT(bx - 7, Y + 1, bz + 7, 1);
  ticks(5);
  let dirt = 0;
  for (let x = 0; x < 3; x++) for (let y = 1; y < 4; y++) if (w.getBlock(bx - 8 + x, Y + y, bz + 8) === B.dirt) dirt++;
  out.dirtLeftAfterTNT = dirt;
  // ---- hunger and fall damage
  p.teleport(bx + 0.5, Y + 12, bz + 0.5);
  const hp0 = p.health;
  ticks(40);
  out.fallDamage = hp0 - p.health; // 11 block fall -> 8 damage
  // ---- sleeping skips the night
  w.time = 14000;
  w.setBlock(bx + 2, Y + 1, bz + 2, B.red_bed, 0 | 4, 0);
  w.setBlock(bx + 2, Y + 1, bz + 1, B.red_bed, 0);
  p.teleport(bx + 2.5, Y + 1, bz + 0.5);
  p.trySleep({ x: bx + 2, y: Y + 1, z: bz + 1 });
  ticks(110);
  out.morning = w.time < 200 && !p.sleeping;
  // ---- entities summary
  out.entities = w.entities.length;
  return out;
});
console.log(JSON.stringify(results, null, 1));

// ---- save, reload, and check persistence
const before = await page.evaluate(async () => {
  const g = window.blockforge;
  const { B } = await import('./js/data/blocks.js');
  const p = g.player;
  const x = Math.floor(p.x) + 1, z = Math.floor(p.z) + 1;
  g.world.setBlock(x, 110, z, B.gold_block, 0);
  p.inventory.slots[5] = { id: B.diamond_block, count: 7, dmg: 0 };
  p.inventory.changed();
  const id = g.meta.id;
  await g.quitToTitle();
  return { id, x, z, pos: [p.x, p.y, p.z] };
});
await page.waitForFunction(() => window.blockforge.state === 'title');
await page.evaluate((id) => window.blockforge.playWorld(id), before.id);
await page.waitForFunction(() => window.blockforge.state === 'playing', null, { timeout: 120000 });
const after = await page.evaluate(async (b) => {
  const g = window.blockforge;
  const { B } = await import('./js/data/blocks.js');
  const p = g.player;
  return { block: g.world.getBlock(b.x, 110, b.z) === B.gold_block, slot: p.inventory.slots[5] && p.inventory.slots[5].count, pos: [p.x, p.y, p.z] };
}, before);
console.log('persistence', JSON.stringify(after), 'expected pos', JSON.stringify(before.pos));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
