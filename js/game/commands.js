import { ITEMS, I, maxStack } from '../data/items.js';
import { B, BLOCKS } from '../data/blocks.js';
import { MOB_TYPES } from '../entity/mobs.js';
import { DIFFICULTY } from '../world/constants.js';

const COMMANDS = {
  help: { usage: '/help', desc: 'List commands' },
  gamemode: { usage: '/gamemode <survival|creative|spectator>', desc: 'Change your game mode' },
  time: { usage: '/time <set|add> <day|noon|night|midnight|ticks>', desc: 'Change the time of day' },
  weather: { usage: '/weather <clear|rain>', desc: 'Change the weather' },
  give: { usage: '/give <item> [count]', desc: 'Give yourself items' },
  tp: { usage: '/tp <x> <y> <z>', desc: 'Teleport (~ for relative)' },
  kill: { usage: '/kill', desc: 'Kill yourself' },
  seed: { usage: '/seed', desc: 'Show the world seed' },
  difficulty: { usage: '/difficulty <peaceful|easy|normal|hard>', desc: 'Change difficulty' },
  summon: { usage: '/summon <creature> [x y z]', desc: 'Spawn a creature' },
  clear: { usage: '/clear', desc: 'Empty your inventory' },
  spawnpoint: { usage: '/spawnpoint', desc: 'Set your respawn point here' },
  setworldspawn: { usage: '/setworldspawn', desc: 'Set the world spawn here' },
  gamerule: { usage: '/gamerule <rule> <true|false|number>', desc: 'keepInventory, doDaylightCycle, doMobSpawning, doFireTick, randomTickSpeed' },
  xp: { usage: '/xp <amount>[L]', desc: 'Give experience points (L for levels)' },
  heal: { usage: '/heal', desc: 'Restore health and hunger' },
  setblock: { usage: '/setblock <x> <y> <z> <block>', desc: 'Place a block' },
  locate: { usage: '/locate <biome>', desc: 'Find the nearest biome' },
};

// Extra commands a multiplayer server understands.
const MP_COMMANDS = {
  list: '/list', msg: '/msg <player> <message>', me: '/me <action>', say: '/say <message>', kick: '/kick <player> [reason]',
  ban: '/ban <player> [reason]', 'ban-ip': '/ban-ip <player>', pardon: '/pardon <name>', op: '/op <player>', deop: '/deop <player>', save: '/save',
};

export class Commands {
  constructor(game) {
    this.game = game;
  }

  out(text, color) {
    this.game.ui.chat(text, color);
  }

  err(text) {
    this.out(text, '#ff6b6b');
  }

  coord(v, base) {
    if (v === undefined) return NaN;
    if (v.startsWith('~')) return base + (v.length > 1 ? Number(v.slice(1)) : 0);
    return Number(v);
  }

  run(text) {
    const g = this.game;
    if (g.net) {
      // Multiplayer: the server runs commands.
      g.net.send({ t: 'chat', m: text });
      return;
    }
    const p = g.player;
    const w = g.world;
    const [cmd, ...args] = text.slice(1).trim().split(/\s+/);
    const name = (cmd || '').toLowerCase();
    switch (name) {
      case 'help':
      case '?':
        for (const c of Object.values(COMMANDS)) this.out(`${c.usage} — ${c.desc}`, '#cfcfcf');
        return;
      case 'gamemode':
      case 'gm': {
        const map = { survival: 'survival', s: 'survival', 0: 'survival', creative: 'creative', c: 'creative', 1: 'creative', spectator: 'spectator', sp: 'spectator', 3: 'spectator' };
        const m = map[(args[0] || '').toLowerCase()];
        if (!m) return this.err(COMMANDS.gamemode.usage);
        if (g.meta?.hardcore && m !== 'spectator' && p.health <= 0) return this.err('Not allowed in hardcore');
        p.setMode(m);
        if (g.meta) g.meta.mode = m;
        this.out(`Set own game mode to ${m[0].toUpperCase() + m.slice(1)} Mode`);
        return;
      }
      case 'time': {
        const sub = (args[0] || '').toLowerCase();
        const words = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };
        const v = words[(args[1] || '').toLowerCase()] ?? Number(args[1]);
        if (!['set', 'add'].includes(sub) || !Number.isFinite(v)) return this.err(COMMANDS.time.usage);
        if (sub === 'set') w.time = ((v % 24000) + 24000) % 24000;
        else {
          const t = w.time + v;
          w.day += Math.floor(t / 24000);
          w.time = ((t % 24000) + 24000) % 24000;
        }
        this.out(`Set the time to ${Math.floor(w.time)}`);
        return;
      }
      case 'weather': {
        const v = (args[0] || '').toLowerCase();
        if (v === 'clear') {
          w.weather.raining = false;
          w.weather.timer = 12000 + Math.floor(Math.random() * 60000);
        } else if (v === 'rain' || v === 'thunder') {
          w.weather.raining = true;
          w.weather.timer = 6000 + Math.floor(Math.random() * 12000);
        } else return this.err(COMMANDS.weather.usage);
        this.out(`Set the weather to ${v === 'clear' ? 'clear' : 'rain'}`);
        return;
      }
      case 'give': {
        const id = this.findItem(args[0]);
        if (id === undefined) return this.err(`Unknown item '${args[0] || ''}'`);
        const count = Math.max(1, Math.min(64 * 36, Number(args[1]) || 1));
        let left = count;
        while (left > 0) {
          const n = Math.min(left, maxStack(id));
          const rest = p.inventory.add({ id, count: n, dmg: 0 });
          if (rest > 0) g.dropItem(p.x, p.y + 1, p.z, { id, count: rest, dmg: 0 }, p);
          left -= n;
        }
        this.out(`Gave ${count} [${ITEMS[id].display}] to ${p.name}`);
        return;
      }
      case 'tp':
      case 'teleport': {
        const x = this.coord(args[0], p.x), y = this.coord(args[1], p.y), z = this.coord(args[2], p.z);
        if (![x, y, z].every(Number.isFinite)) return this.err(COMMANDS.tp.usage);
        p.teleport(x, y, z);
        this.out(`Teleported ${p.name} to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
        return;
      }
      case 'kill':
        p.health = Math.min(p.health, 1);
        p.invuln = 0;
        p.damage(1000, { type: 'void' });
        return;
      case 'seed':
        this.out(`Seed: ${w.seed}`);
        return;
      case 'difficulty': {
        const i = DIFFICULTY.findIndex((d) => d.toLowerCase() === (args[0] || '').toLowerCase());
        const n = i >= 0 ? i : Number(args[0]);
        if (!(n >= 0 && n <= 3)) return this.err(COMMANDS.difficulty.usage);
        if (g.meta?.hardcore) return this.err('Difficulty is locked in hardcore');
        g.difficulty = n;
        if (g.meta) g.meta.difficulty = n;
        this.out(`Set the difficulty to ${DIFFICULTY[n]}`);
        return;
      }
      case 'summon': {
        const t = (args[0] || '').toLowerCase();
        if (!MOB_TYPES[t] && t !== 'tnt') return this.err(`Unknown creature. Try: ${Object.keys(MOB_TYPES).join(', ')}, tnt`);
        const x = args[1] ? this.coord(args[1], p.x) : p.x - Math.sin(p.yaw) * 2;
        const y = args[2] ? this.coord(args[2], p.y) : p.y;
        const z = args[3] ? this.coord(args[3], p.z) : p.z - Math.cos(p.yaw) * 2;
        if (t === 'tnt') g.primeTNT(Math.floor(x), Math.floor(y), Math.floor(z), 80);
        else g.spawnMob(t, x, y, z, {});
        this.out(`Summoned new ${t}`);
        return;
      }
      case 'clear':
        p.inventory.clear();
        this.out('Cleared your inventory');
        return;
      case 'spawnpoint':
        p.spawn = { x: p.x, y: p.y, z: p.z };
        this.out(`Set spawn point to ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`);
        return;
      case 'setworldspawn':
        if (g.meta) g.meta.spawn = { x: p.x, y: p.y, z: p.z };
        this.out(`Set the world spawn point to ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`);
        return;
      case 'gamerule': {
        const rule = args[0];
        if (!rule || !(rule in w.rules)) return this.err(`Rules: ${Object.keys(w.rules).join(', ')}`);
        if (args[1] === undefined) return this.out(`${rule} = ${w.rules[rule]}`);
        const v = args[1] === 'true' ? true : args[1] === 'false' ? false : Number(args[1]);
        if (typeof w.rules[rule] === 'boolean' && typeof v !== 'boolean') return this.err('Expected true or false');
        if (typeof w.rules[rule] === 'number' && !Number.isFinite(v)) return this.err('Expected a number');
        w.rules[rule] = v;
        this.out(`Game rule ${rule} is now set to: ${v}`);
        return;
      }
      case 'xp':
      case 'experience': {
        const a = args[0] || '';
        const levels = /l$/i.test(a);
        const n = parseInt(a, 10);
        if (!Number.isFinite(n)) return this.err(COMMANDS.xp.usage);
        if (levels) {
          p.xpLevel = Math.max(0, p.xpLevel + n);
          this.out(`Gave ${n} experience levels`);
        } else {
          p.addXP(n);
          this.out(`Gave ${n} experience points`);
        }
        return;
      }
      case 'heal':
        p.health = p.maxHealth;
        p.food = 20;
        p.saturation = 5;
        p.fireTicks = 0;
        p.air = 300;
        this.out('Healed');
        return;
      case 'setblock': {
        const x = Math.floor(this.coord(args[0], p.x)), y = Math.floor(this.coord(args[1], p.y)), z = Math.floor(this.coord(args[2], p.z));
        const bname = (args[3] || '').toLowerCase().replace(/^minecraft:/, '');
        const id = bname === 'air' ? 0 : B[bname];
        if (![x, y, z].every(Number.isFinite) || id === undefined) return this.err(COMMANDS.setblock.usage);
        w.setBlock(x, y, z, id, 0);
        this.out('Changed the block');
        return;
      }
      case 'locate': {
        const want = (args.join(' ') || '').toLowerCase().replace(/_/g, ' ');
        const names = ['ocean', 'deep ocean', 'beach', 'plains', 'forest', 'birch forest', 'taiga', 'snowy plains', 'desert', 'mountains', 'swamp', 'river', 'frozen ocean', 'snowy taiga', 'snowy beach', 'frozen river'];
        const b = names.indexOf(want);
        if (b < 0) return this.err(`Biomes: ${names.join(', ')}`);
        for (let r = 0; r < 3000; r += 32) {
          const steps = Math.max(1, Math.floor((r * 2 * Math.PI) / 32));
          for (let s = 0; s < steps; s++) {
            const a = (s / steps) * Math.PI * 2;
            const x = Math.round(p.x + Math.cos(a) * r), z = Math.round(p.z + Math.sin(a) * r);
            if (w.gen.column(x, z).biome === b) {
              this.out(`The nearest ${want} is at ${x}, ~, ${z} (${r} blocks away)`);
              return;
            }
          }
        }
        this.err(`Could not find a ${want} nearby`);
        return;
      }
      default:
        this.err(`Unknown command. Type /help for a list.`);
    }
  }

  findItem(q) {
    if (!q) return undefined;
    const n = q.toLowerCase().replace(/^minecraft:/, '');
    if (I[n] !== undefined) return I[n];
    const byDisplay = ITEMS.find((d) => d && d.display.toLowerCase().replace(/\s+/g, '_') === n);
    return byDisplay ? byDisplay.id : undefined;
  }

  suggest(text) {
    const parts = text.slice(1).split(' ');
    const net = this.game.net;
    if (parts.length <= 1) {
      const names = net ? [...Object.keys(COMMANDS), ...Object.keys(MP_COMMANDS)] : Object.keys(COMMANDS);
      return names.filter((c) => c.startsWith(parts[0].toLowerCase())).map((c) => '/' + c);
    }
    if (net && MP_COMMANDS[parts[0].toLowerCase()]) {
      const cmd = parts[0].toLowerCase();
      if (parts.length === 2 && ['msg', 'tell', 'kick', 'ban', 'ban-ip', 'op', 'deop', 'tp'].includes(cmd)) {
        const last = parts[1].toLowerCase();
        return net.players.map((p) => p[1]).filter((n) => n.toLowerCase().startsWith(last));
      }
      return [MP_COMMANDS[cmd]];
    }
    const cmd = parts[0].toLowerCase();
    const last = (parts[parts.length - 1] || '').toLowerCase();
    let pool = [];
    if (cmd === 'give' && parts.length === 2) pool = ITEMS.filter(Boolean).map((d) => d.name);
    else if (cmd === 'gamemode' && parts.length === 2) pool = ['survival', 'creative', 'spectator'];
    else if (cmd === 'time' && parts.length === 2) pool = ['set', 'add'];
    else if (cmd === 'time' && parts.length === 3) pool = ['day', 'noon', 'night', 'midnight'];
    else if (cmd === 'weather' && parts.length === 2) pool = ['clear', 'rain'];
    else if (cmd === 'difficulty' && parts.length === 2) pool = ['peaceful', 'easy', 'normal', 'hard'];
    else if (cmd === 'summon' && parts.length === 2) pool = [...Object.keys(MOB_TYPES), 'tnt'];
    else if (cmd === 'gamerule' && parts.length === 2) pool = Object.keys(this.game.world.rules);
    else if (cmd === 'setblock' && parts.length === 5) pool = ['air', ...BLOCKS.filter(Boolean).map((b) => b.name)];
    else if (cmd === 'locate' && parts.length === 2) pool = ['plains', 'forest', 'birch_forest', 'taiga', 'snowy_plains', 'desert', 'mountains', 'swamp', 'ocean', 'beach', 'river'];
    else if (COMMANDS[cmd]) return [COMMANDS[cmd].usage];
    return pool.filter((s) => s.startsWith(last)).slice(0, 30);
  }
}
