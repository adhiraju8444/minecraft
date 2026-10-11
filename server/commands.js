// Slash commands on the multiplayer server. Anyone can use the social ones;
// the rest need operator (admin) rights. The server console uses the same
// commands without a leading slash.
import { ITEMS, maxStack } from '../js/data/items.js';
import { B } from '../js/data/blocks.js';
import { MOB_TYPES } from '../js/entity/mobs.js';
import { DIFFICULTY } from '../js/world/constants.js';
import { MODES } from '../js/net/protocol.js';

const PUBLIC = {
  help: ['/help', 'List commands'],
  list: ['/list', 'Show who is online'],
  msg: ['/msg <player> <message>', 'Send a private message'],
  me: ['/me <action>', 'Describe what you are doing'],
  seed: ['/seed', 'Show the world seed'],
  kill: ['/kill', 'Respawn (if you are stuck)'],
};

const ADMIN = {
  gamemode: ['/gamemode <survival|creative|spectator> [player]', 'Change game mode'],
  time: ['/time <set|add> <day|noon|night|midnight|ticks>', 'Change the time of day'],
  weather: ['/weather <clear|rain>', 'Change the weather'],
  give: ['/give <item> [count] [player]', 'Give items'],
  tp: ['/tp <x> <y> <z> | /tp <player> [target]', 'Teleport'],
  difficulty: ['/difficulty <peaceful|easy|normal|hard>', 'Change difficulty'],
  summon: ['/summon <creature> [x y z]', 'Spawn a creature'],
  clear: ['/clear [player]', 'Empty an inventory'],
  heal: ['/heal [player]', 'Restore health and hunger'],
  xp: ['/xp <amount>[L] [player]', 'Give experience (L for levels)'],
  spawnpoint: ['/spawnpoint [player]', 'Set a respawn point at the player'],
  setworldspawn: ['/setworldspawn', 'Set the world spawn here'],
  gamerule: ['/gamerule <rule> <value>', 'keepInventory, doDaylightCycle, doMobSpawning, doFireTick, randomTickSpeed'],
  setblock: ['/setblock <x> <y> <z> <block>', 'Place a block'],
  locate: ['/locate <biome>', 'Find the nearest biome'],
  say: ['/say <message>', 'Announce to everyone'],
  kick: ['/kick <player> [reason]', 'Disconnect a player'],
  ban: ['/ban <player> [reason]', 'Ban a player by name'],
  'ban-ip': ['/ban-ip <player>', 'Ban the address a player connects from'],
  pardon: ['/pardon <name>', 'Lift a ban'],
  op: ['/op <player>', 'Make someone an operator'],
  deop: ['/deop <player>', 'Remove operator rights'],
  save: ['/save', 'Save the world now'],
  status: ['/status', 'Server load, players, ping and bandwidth'],
};

const BIOMES = ['ocean', 'deep ocean', 'beach', 'plains', 'forest', 'birch forest', 'taiga', 'snowy plains', 'desert', 'mountains', 'swamp', 'river', 'frozen ocean', 'snowy taiga', 'snowy beach', 'frozen river'];

// The console acts as an all-powerful player with no body.
class ConsoleSender {
  constructor(game) {
    this.game = game;
    this.name = 'Server';
    this.op = true;
    this.isConsole = true;
  }
  chat(text) {
    console.log(text);
  }
}

export class ServerCommands {
  constructor(game) {
    this.game = game;
    this.console = new ConsoleSender(game);
  }

  runConsole(line) {
    const text = line.trim();
    if (!text) return;
    this.run(this.console, text.startsWith('/') ? text : '/' + text);
  }

  findItem(q) {
    if (!q) return undefined;
    const n = q.toLowerCase().replace(/^minecraft:/, '');
    const byName = ITEMS.findIndex((d) => d && d.name === n);
    if (byName >= 0) return byName;
    const byDisplay = ITEMS.find((d) => d && d.display.toLowerCase().replace(/\s+/g, '_') === n);
    return byDisplay ? byDisplay.id : undefined;
  }

  coord(v, base) {
    if (v === undefined) return NaN;
    if (v.startsWith('~')) return base + (v.length > 1 ? Number(v.slice(1)) : 0);
    return Number(v);
  }

  run(sender, text) {
    const g = this.game;
    const w = g.world;
    const [cmd, ...args] = text.slice(1).trim().split(/\s+/);
    const name = (cmd || '').toLowerCase();
    const ok = (m) => sender.chat(m, '#cfcfcf');
    const err = (m) => sender.chat(m, '#ff6b6b');
    const self = sender.isConsole ? null : sender;
    // Target player: named argument, or the sender.
    const target = (arg) => {
      if (arg) {
        const p = g.findPlayer(arg);
        if (!p) err(`No player called "${arg}" is online`);
        return p;
      }
      if (!self) err('Name a player when using this from the console');
      return self;
    };

    if (!PUBLIC[name] && ADMIN[name] && !sender.op) {
      err('You need to be an operator to use that command. The server owner can type "op <name>" in the server console.');
      return;
    }

    switch (name) {
      case 'help':
      case '?': {
        const list = { ...PUBLIC, ...(sender.op ? ADMIN : {}) };
        for (const [usage, desc] of Object.values(list)) ok(`${usage} — ${desc}`);
        return;
      }
      case 'list': {
        const names = g.players.map((p) => p.name + (p.op ? ' (op)' : ''));
        ok(`${names.length} of ${g.cfg.maxPlayers} players online: ${names.join(', ') || 'nobody'}`);
        return;
      }
      case 'msg':
      case 'tell':
      case 'w': {
        const to = g.findPlayer(args[0]);
        const msg = args.slice(1).join(' ');
        if (!to || !msg) return err(PUBLIC.msg[0]);
        to.chat(`${sender.name} whispers to you: ${msg}`, '#bdbdbd');
        sender.chat(`You whisper to ${to.name}: ${msg}`, '#bdbdbd');
        return;
      }
      case 'me': {
        const msg = args.join(' ');
        if (msg) g.broadcastChat(`* ${sender.name} ${msg}`);
        return;
      }
      case 'seed':
        ok(`Seed: ${w.seed}`);
        return;
      case 'kill': {
        const p = args[0] && sender.op ? target(args[0]) : self;
        if (!p) return;
        p.send({ t: 'kill' });
        return;
      }
      case 'gamemode':
      case 'gm': {
        const map = { survival: 'survival', s: 'survival', 0: 'survival', creative: 'creative', c: 'creative', 1: 'creative', spectator: 'spectator', sp: 'spectator', 3: 'spectator' };
        const m = map[(args[0] || '').toLowerCase()];
        if (!m || !MODES.includes(m)) return err(ADMIN.gamemode[0]);
        const p = target(args[1]);
        if (!p) return;
        p.setMode(m);
        g.sendPlayerList();
        const label = m[0].toUpperCase() + m.slice(1);
        if (p === self) ok(`Set own game mode to ${label} Mode`);
        else {
          ok(`Set ${p.name}'s game mode to ${label} Mode`);
          p.chat(`Your game mode has been updated to ${label} Mode`);
        }
        return;
      }
      case 'time': {
        const sub = (args[0] || '').toLowerCase();
        const words = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };
        const v = words[(args[1] || '').toLowerCase()] ?? Number(args[1]);
        if (!['set', 'add'].includes(sub) || !Number.isFinite(v)) return err(ADMIN.time[0]);
        if (sub === 'set') w.time = ((v % 24000) + 24000) % 24000;
        else {
          const t = w.time + v;
          w.day += Math.floor(t / 24000);
          w.time = ((t % 24000) + 24000) % 24000;
        }
        g.broadcast(g.timeMessage());
        ok(`Set the time to ${Math.floor(w.time)}`);
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
        } else return err(ADMIN.weather[0]);
        g.broadcast(g.timeMessage());
        ok(`Set the weather to ${v === 'clear' ? 'clear' : 'rain'}`);
        return;
      }
      case 'give': {
        const id = this.findItem(args[0]);
        if (id === undefined) return err(`Unknown item '${args[0] || ''}'`);
        let countArg = args[1], who = args[2];
        if (countArg !== undefined && !/^\d+$/.test(countArg)) {
          who = countArg;
          countArg = undefined;
        }
        const p = target(who);
        if (!p) return;
        const count = Math.max(1, Math.min(64 * 36, Number(countArg) || 1));
        let left = count;
        while (left > 0) {
          const n = Math.min(left, maxStack(id));
          const rest = p.inventory.add({ id, count: n, dmg: 0 });
          if (rest > 0) g.dropItem(p.x, p.y + 1, p.z, { id, count: rest, dmg: 0 }, null, true);
          left -= n;
        }
        ok(`Gave ${count} [${ITEMS[id].display}] to ${p.name}`);
        return;
      }
      case 'tp':
      case 'teleport': {
        // /tp <player> | /tp <player> <target> | /tp <x y z> | /tp <player> <x y z>
        let who = self, dest = null;
        const nums = (a) => a.length === 3 && a.every((v) => /^~?-?\d*\.?\d*$/.test(v));
        if (args.length === 1) {
          const t = target(args[0]);
          if (!t) return;
          dest = [t.x, t.y, t.z];
        } else if (args.length === 2) {
          who = target(args[0]);
          const t = target(args[1]);
          if (!who || !t) return;
          dest = [t.x, t.y, t.z];
        } else if (args.length === 3 && nums(args)) {
          if (!who) return err('Name a player when using this from the console');
          dest = args.map((v, i) => this.coord(v, [who.x, who.y, who.z][i]));
        } else if (args.length === 4 && nums(args.slice(1))) {
          who = target(args[0]);
          if (!who) return;
          dest = args.slice(1).map((v, i) => this.coord(v, [who.x, who.y, who.z][i]));
        }
        if (!who || !dest || !dest.every(Number.isFinite)) return err(ADMIN.tp[0]);
        who.teleport(dest[0], dest[1], dest[2]);
        ok(`Teleported ${who.name} to ${dest.map((v) => v.toFixed(1)).join(', ')}`);
        return;
      }
      case 'difficulty': {
        const i = DIFFICULTY.findIndex((d) => d.toLowerCase() === (args[0] || '').toLowerCase());
        const n = i >= 0 ? i : Number(args[0]);
        if (!(n >= 0 && n <= 3)) return err(ADMIN.difficulty[0]);
        g.difficulty = n;
        g.broadcast({ t: 'cfg', diff: n, rules: w.rules });
        g.broadcastChat(`The difficulty is now ${DIFFICULTY[n]}`, '#cfcfcf');
        return;
      }
      case 'summon': {
        const t = (args[0] || '').toLowerCase();
        if (!MOB_TYPES[t] && t !== 'tnt') return err(`Unknown creature. Try: ${Object.keys(MOB_TYPES).join(', ')}, tnt`);
        const base = self || { x: g.level.spawn.x, y: g.level.spawn.y, z: g.level.spawn.z, yaw: 0 };
        const x = args[1] ? this.coord(args[1], base.x) : base.x - Math.sin(base.yaw) * 2;
        const y = args[2] ? this.coord(args[2], base.y) : base.y;
        const z = args[3] ? this.coord(args[3], base.z) : base.z - Math.cos(base.yaw) * 2;
        if (![x, y, z].every(Number.isFinite)) return err(ADMIN.summon[0]);
        if (!w.isLoadedAt(Math.floor(x), Math.floor(z))) return err('That place is not loaded');
        if (t === 'tnt') g.primeTNT(Math.floor(x), Math.floor(y), Math.floor(z), 80);
        else g.spawnMob(t, x, y, z, {});
        ok(`Summoned new ${t}`);
        return;
      }
      case 'clear': {
        const p = target(args[0]);
        if (!p) return;
        p.inventory.clear();
        ok(`Cleared the inventory of ${p.name}`);
        return;
      }
      case 'heal': {
        const p = target(args[0]);
        if (!p) return;
        p.send({ t: 'heal' });
        ok(`Healed ${p.name}`);
        return;
      }
      case 'xp':
      case 'experience': {
        const a = args[0] || '';
        const levels = /l$/i.test(a);
        const n = parseInt(a, 10);
        if (!Number.isFinite(n)) return err(ADMIN.xp[0]);
        const p = target(args[1]);
        if (!p) return;
        if (levels) p.send({ t: 'xpl', n });
        else p.addXP(n);
        ok(`Gave ${n} experience ${levels ? 'levels' : 'points'} to ${p.name}`);
        return;
      }
      case 'spawnpoint': {
        const p = target(args[0]);
        if (!p) return;
        p.send({ t: 'setspawn', p: [p.x, p.y, p.z] });
        ok(`Set spawn point of ${p.name} to ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`);
        return;
      }
      case 'setworldspawn': {
        if (!self) return err('Use this in game, standing where the spawn should be');
        g.level.spawn = { x: self.x, y: self.y, z: self.z };
        g.broadcast({ t: 'wspawn', s: g.level.spawn });
        ok(`Set the world spawn point to ${Math.floor(self.x)}, ${Math.floor(self.y)}, ${Math.floor(self.z)}`);
        return;
      }
      case 'gamerule': {
        const rule = args[0];
        if (!rule || !(rule in w.rules)) return err(`Rules: ${Object.keys(w.rules).join(', ')}`);
        if (args[1] === undefined) return ok(`${rule} = ${w.rules[rule]}`);
        const v = args[1] === 'true' ? true : args[1] === 'false' ? false : Number(args[1]);
        if (typeof w.rules[rule] === 'boolean' && typeof v !== 'boolean') return err('Expected true or false');
        if (typeof w.rules[rule] === 'number' && !Number.isFinite(v)) return err('Expected a number');
        w.rules[rule] = rule === 'randomTickSpeed' ? Math.max(0, Math.min(100, v)) : v;
        g.broadcast({ t: 'cfg', diff: g.difficulty, rules: w.rules });
        ok(`Game rule ${rule} is now set to: ${w.rules[rule]}`);
        return;
      }
      case 'setblock': {
        const base = self || { x: 0, y: 0, z: 0 };
        const x = Math.floor(this.coord(args[0], base.x)), y = Math.floor(this.coord(args[1], base.y)), z = Math.floor(this.coord(args[2], base.z));
        const bname = (args[3] || '').toLowerCase().replace(/^minecraft:/, '');
        const id = bname === 'air' ? 0 : B[bname];
        if (![x, y, z].every(Number.isFinite) || id === undefined) return err(ADMIN.setblock[0]);
        if (!w.isLoadedAt(x, z)) return err('That place is not loaded');
        w.setBlock(x, y, z, id, 0);
        ok('Changed the block');
        return;
      }
      case 'locate': {
        if (!self) return err('Use this in game');
        const want = (args.join(' ') || '').toLowerCase().replace(/_/g, ' ');
        const b = BIOMES.indexOf(want);
        if (b < 0) return err(`Biomes: ${BIOMES.join(', ')}`);
        for (let r = 0; r < 3000; r += 32) {
          const steps = Math.max(1, Math.floor((r * 2 * Math.PI) / 32));
          for (let s = 0; s < steps; s++) {
            const a = (s / steps) * Math.PI * 2;
            const x = Math.round(self.x + Math.cos(a) * r), z = Math.round(self.z + Math.sin(a) * r);
            if (w.gen.column(x, z).biome === b) return ok(`The nearest ${want} is at ${x}, ~, ${z} (${r} blocks away)`);
          }
        }
        return err(`Could not find a ${want} nearby`);
      }
      case 'say': {
        const msg = args.join(' ');
        if (msg) g.broadcastChat(`[${sender.name}] ${msg}`, '#ff9cf7');
        if (sender.isConsole) console.log(`[${sender.name}] ${msg}`);
        return;
      }
      case 'kick': {
        const p = target(args[0]);
        if (!p || p === self) return;
        p.conn.kick(args.slice(1).join(' ') || 'Kicked by an operator');
        ok(`Kicked ${p.name}`);
        return;
      }
      case 'ban': {
        const n = (args[0] || '').toLowerCase();
        if (!n) return err(ADMIN.ban[0]);
        g.bans.add(n);
        g.storage.saveList('banned-players', [...g.bans]);
        const p = g.findPlayer(n);
        if (p && p !== self) p.conn.kick(args.slice(1).join(' ') || 'You are banned from this server');
        ok(`Banned ${args[0]}`);
        return;
      }
      case 'ban-ip': {
        const p = target(args[0]);
        if (!p || p === self) return;
        g.ipBans.add(p.conn.ip);
        g.storage.saveList('banned-ips', [...g.ipBans]);
        p.conn.kick('You are banned from this server');
        ok(`Banned the address of ${p.name}`);
        return;
      }
      case 'pardon':
      case 'unban': {
        const n = (args[0] || '').toLowerCase();
        if (!n) return err(ADMIN.pardon[0]);
        g.bans.delete(n);
        g.storage.saveList('banned-players', [...g.bans]);
        if (g.ipBans.delete(args[0])) g.storage.saveList('banned-ips', [...g.ipBans]);
        ok(`Unbanned ${args[0]}`);
        return;
      }
      case 'op':
      case 'deop': {
        const n = args[0];
        if (!n || !/^[A-Za-z0-9_ -]{1,16}$/.test(n)) return err(ADMIN[name][0]);
        const p = g.findPlayer(n);
        const real = p ? p.name : n;
        g.setOp(real, name === 'op');
        g.sendPlayerList();
        ok(name === 'op' ? `Made ${real} a server operator` : `Made ${real} no longer a server operator`);
        if (p && p !== self) p.chat(name === 'op' ? 'You are now a server operator' : 'You are no longer a server operator', '#ffe14d');
        return;
      }
      case 'status': {
        const mem = process.memoryUsage();
        ok(`Tick time ${(g.mspt || 0).toFixed(1)} ms of 50 ms · ${w.chunks.size} chunks loaded · ${w.entities.length} entities · ${g.changedChunks.size} changed chunks saved · memory ${Math.round(mem.rss / 1048576)} MB`);
        for (const p of g.online.values()) {
          const c = p.conn;
          const secs = Math.max(1, (Date.now() - c.since) / 1000);
          ok(`${p.name}: ${p.mode}, ping ${c.ping || 0} ms, about ${(c.bytesOut / 1024 / secs).toFixed(1)} KB/s sent (before compression), at ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`);
          if (c.byType) ok('  by message: ' + Object.entries(c.byType).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([t, n]) => `${t} ${(n / 1024 / secs).toFixed(1)}`).join(', ') + ' KB/s');
        }
        return;
      }
      case 'save':
      case 'save-all':
        g.save().then(() => ok('Saved the world'));
        return;
      case 'stop':
        if (!sender.isConsole) return err('Stop the server from its console');
        process.emit('SIGTERM');
        return;
      default:
        err('Unknown command. Type /help for a list.');
    }
  }
}

export const COMMAND_NAMES = [...Object.keys(PUBLIC), ...Object.keys(ADMIN)];
