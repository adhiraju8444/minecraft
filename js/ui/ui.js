// DOM user interface: menus, HUD, chat and messages. Container screens
// (inventory, crafting, furnace, chest) live in containers.js.
import { hudIcons, drawLogo, SPLASHES } from './icons.js';
import { ContainerUI } from './containers.js';
import { ITEMS } from '../data/items.js';
import { listWorlds, deleteWorld, isPersistent } from '../storage/db.js';
import { KEY_LABELS, keyName, DEFAULT_SETTINGS, saveSettings } from '../settings.js';
import { DIFFICULTY } from '../world/constants.js';
import { BIOME_NAMES } from '../world/worldgen.js';
import { FACING_NAMES } from '../world/constants.js';
import { BLOCKS } from '../data/blocks.js';
import { TouchControls } from './touch.js';
import { fetchServerInfo } from '../net/client.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class UI {
  constructor(game) {
    this.game = game;
    this.root = $('#ui');
    this.icons = hudIcons();
    this.screen = null; // current menu screen element
    this.screenName = '';
    this.hudVisible = true;
    this.debug = false;
    this.chatOpen = false;
    this.chatLines = [];
    this.chatHistory = [];
    this.historyIdx = -1;
    this.capturingKey = null;
    this.hudCache = {};
    this.lastSelected = -1;
    this.itemNameTimer = 0;
    this.actionTimer = 0;
    this.containers = new ContainerUI(this);
    this.buildHud();
    this.applyScale();
    window.addEventListener('resize', () => this.applyScale());
    this.touch = new TouchControls(game, this);
  }

  // ---------------------------------------------------------------- general
  applyScale() {
    const s = this.game.settings.guiScale;
    const w = window.innerWidth, h = window.innerHeight;
    let gs = s || Math.max(1, Math.min(4, Math.floor(Math.min(w / 320, h / 240) * 2) / 2));
    if (!s && Math.min(w, h) < 500) gs = Math.max(1, Math.min(gs, Math.floor(Math.min(w / 200, h / 160) * 2) / 2));
    document.documentElement.style.setProperty('--gs', gs + 'px');
    this.gs = gs;
  }

  click() {
    this.game.audio.init();
    this.game.audio.play('click');
  }

  bindButtons(root, handlers) {
    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.disabled) return;
        this.click();
        handlers[b.dataset.act]?.(b);
      });
    });
  }

  setScreen(name, node) {
    if (this.screen) this.screen.remove();
    this.screen = node;
    this.screenName = name;
    if (node) {
      this.root.appendChild(node);
      const first = node.querySelector('input[type=text]');
      if (first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 30);
    }
    this.updateHudVisibility();
  }

  closeScreen() {
    this.setScreen('', null);
  }

  // Any UI that should free the mouse and stop the player.
  screenOpen() {
    return !!this.screen || this.containers.open || this.chatOpen;
  }

  captureMovement() {
    return this.game.state === 'playing' && !this.screenOpen();
  }

  onPointerUnlock() {
    if (this.game.state === 'playing' && !this.screenOpen() && !this.game.input.touchActive) this.showPause();
  }

  onEscape(e) {
    e && e.preventDefault();
    if (this.capturingKey) {
      this.capturingKey = null;
      this.showControls();
      return;
    }
    if (this.chatOpen) {
      this.closeChat();
      return;
    }
    if (this.containers.open) {
      this.containers.close();
      this.game.resume();
      return;
    }
    const g = this.game;
    if (this.screenName === 'pause') {
      this.resumeGame();
      return;
    }
    if (this.screenName === 'options' || this.screenName === 'help' || this.screenName === 'controls') {
      this.back();
      return;
    }
    if (this.screenName === 'worlds' || this.screenName === 'create' || this.screenName === 'multiplayer') {
      this.showTitle();
      return;
    }
    if (this.screenName === 'neterror') {
      this.netErrorBack?.();
      return;
    }
    if (g.state === 'playing' && !this.screen) this.showPause();
  }

  onKey(e, code) {
    if (this.containers.open) return this.containers.onKey(e, code);
    return false;
  }

  back() {
    if (this.backTo) this.backTo();
    else this.showTitle();
  }

  resumeGame() {
    this.closeScreen();
    this.game.resume();
  }

  // ---------------------------------------------------------------- title
  showTitle() {
    const g = this.game;
    const splash = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
    const node = el(`
      <div class="screen">
        <div class="logo-wrap"><canvas id="title-logo" width="900" height="180" aria-label="Blockforge"></canvas><div class="splash">${esc(splash)}</div></div>
        <div class="menu-col">
          <button class="btn" data-act="single">Singleplayer</button>
          <button class="btn" data-act="multi">Multiplayer</button>
          <button class="btn" data-act="options">Options…</button>
          <button class="btn" data-act="help">How to Play</button>
        </div>
        <div class="corner left">Blockforge 1.0</div>
        <div class="corner right">Fan-made voxel sandbox · not affiliated with Mojang or Microsoft</div>
      </div>`);
    this.bindButtons(node, {
      single: () => this.showWorlds(),
      multi: () => this.showMultiplayer(),
      options: () => this.showOptions(() => this.showTitle()),
      help: () => this.showHelp(() => this.showTitle()),
    });
    this.setScreen('title', node);
    const draw = () => drawLogo($('#title-logo', node));
    draw();
    if (document.fonts && document.fonts.load) document.fonts.load('700 40px "Pixelify Sans"').then(draw).catch(() => {});
  }

  // ---------------------------------------------------------------- worlds
  async showWorlds() {
    const worlds = await listWorlds();
    const persistent = await isPersistent();
    let selected = worlds[0] ? worlds[0].id : null;
    const node = el(`
      <div class="screen dim">
        <div class="menu-title txt-shadow">Select World</div>
        ${persistent ? '' : '<div class="menu-sub">Saving is unavailable in this browser window, so worlds last until you close the page.</div>'}
        <div class="world-list"></div>
        <div class="menu-col" style="width:min(calc(var(--gs) * 240), 94vw)">
          <div class="btn-row"><button class="btn" data-act="play">Play Selected World</button><button class="btn" data-act="create">Create New World</button></div>
          <div class="btn-row"><button class="btn danger" data-act="delete">Delete</button><button class="btn" data-act="cancel">Cancel</button></div>
        </div>
      </div>`);
    const list = $('.world-list', node);
    const render = () => {
      list.innerHTML = '';
      if (!worlds.length) {
        list.appendChild(el('<div class="empty-note">No worlds yet.<br>Create one to start playing.</div>'));
      }
      for (const w of worlds) {
        const date = new Date(w.lastPlayed || w.created || Date.now());
        const mode = w.hardcore ? 'Hardcore' : w.mode === 'creative' ? 'Creative' : 'Survival';
        const item = el(`<div class="world-item ${w.id === selected ? 'sel' : ''}" tabindex="0">
          <div class="wn txt-shadow">${esc(w.name)}</div>
          <div class="wd">${esc(mode)} · ${DIFFICULTY[w.difficulty ?? 2]} · Day ${(w.day || 0) + 1}</div>
          <div class="wd">Last played ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>`);
        item.addEventListener('click', () => {
          selected = w.id;
          render();
        });
        item.addEventListener('dblclick', () => this.game.playWorld(w.id));
        list.appendChild(item);
      }
      $('[data-act=play]', node).disabled = !selected;
      $('[data-act=delete]', node).disabled = !selected;
    };
    this.bindButtons(node, {
      play: () => selected && this.game.playWorld(selected),
      create: () => this.showCreate(),
      delete: () => {
        const w = worlds.find((x) => x.id === selected);
        if (w) this.confirm(`Delete “${w.name}”?`, 'This world will be gone forever (a long time!)', 'Delete', async () => {
          await deleteWorld(w.id);
          this.showWorlds();
        }, () => this.showWorlds());
      },
      cancel: () => this.showTitle(),
    });
    render();
    this.setScreen('worlds', node);
  }

  confirm(title, sub, okLabel, onOk, onCancel) {
    const node = el(`
      <div class="screen dim">
        <div class="menu-title txt-shadow">${esc(title)}</div>
        <div class="menu-sub">${esc(sub)}</div>
        <div class="menu-col"><div class="btn-row"><button class="btn danger" data-act="ok">${esc(okLabel)}</button><button class="btn" data-act="cancel">Cancel</button></div></div>
      </div>`);
    this.bindButtons(node, { ok: onOk, cancel: onCancel });
    this.setScreen('confirm', node);
  }

  showCreate() {
    let mode = 'survival';
    let difficulty = 2;
    const node = el(`
      <div class="screen dim">
        <div class="menu-title txt-shadow">Create New World</div>
        <div class="menu-col" style="width:min(calc(var(--gs) * 220), 94vw)">
          <div class="field"><label for="cw-name">World Name</label><input id="cw-name" type="text" maxlength="32" value="New World"></div>
          <div class="field"><label for="cw-seed">Seed for the world generator</label><input id="cw-seed" type="text" maxlength="40" placeholder="Leave blank for a random seed"></div>
          <button class="btn" data-act="mode"></button>
          <div class="field"><div class="hint" id="cw-hint"></div></div>
          <button class="btn" data-act="diff"></button>
          <div class="btn-row"><button class="btn" data-act="create">Create New World</button><button class="btn" data-act="cancel">Cancel</button></div>
        </div>
      </div>`);
    const hints = {
      survival: 'Search for resources, craft, gain levels, health and hunger.',
      creative: 'Unlimited resources, free flying and instant block breaking.',
      hardcore: 'Survival locked to Hard difficulty. One life only.',
    };
    const refresh = () => {
      $('[data-act=mode]', node).textContent = 'Game Mode: ' + mode[0].toUpperCase() + mode.slice(1);
      $('#cw-hint', node).textContent = hints[mode];
      const d = $('[data-act=diff]', node);
      d.textContent = 'Difficulty: ' + DIFFICULTY[mode === 'hardcore' ? 3 : difficulty];
      d.disabled = mode === 'hardcore';
    };
    this.bindButtons(node, {
      mode: () => {
        mode = mode === 'survival' ? 'creative' : mode === 'creative' ? 'hardcore' : 'survival';
        refresh();
      },
      diff: () => {
        difficulty = (difficulty + 1) % 4;
        refresh();
      },
      create: () => {
        const name = $('#cw-name', node).value.trim() || 'New World';
        const seed = $('#cw-seed', node).value;
        this.game.createWorld({ name, seed, mode: mode === 'hardcore' ? 'survival' : mode, hardcore: mode === 'hardcore', difficulty: mode === 'hardcore' ? 3 : difficulty });
      },
      cancel: () => this.showWorlds(),
    });
    node.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') $('[data-act=create]', node).click();
    });
    refresh();
    this.setScreen('create', node);
  }

  // ---------------------------------------------------------------- options
  showOptions(backTo) {
    this.backTo = backTo;
    const g = this.game;
    const s = g.settings;
    const node = el(`
      <div class="screen ${g.state === 'title' ? 'dim' : 'dark'}">
        <div class="menu-title txt-shadow">Options</div>
        <div class="options-grid"></div>
        <div class="menu-col"><button class="btn" data-act="done">Done</button></div>
      </div>`);
    const grid = $('.options-grid', node);
    const save = () => {
      saveSettings(s);
      g.applySettings();
    };
    const slider = (label, key, min, max, step, fmt) => {
      const sl = el(`<div class="slider" role="slider" tabindex="0" aria-label="${esc(label)}"><div class="knob"></div><span class="lbl"></span></div>`);
      const knob = $('.knob', sl), lbl = $('.lbl', sl);
      const upd = () => {
        const t = (s[key] - min) / (max - min);
        knob.style.left = `calc(${t * 100}% - ${t} * var(--gs) * 8)`;
        lbl.textContent = `${label}: ${fmt(s[key])}`;
        sl.setAttribute('aria-valuenow', s[key]);
      };
      const setFrom = (clientX) => {
        const r = sl.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        const v = Math.round((min + t * (max - min)) / step) * step;
        if (v !== s[key]) {
          s[key] = +v.toFixed(3);
          upd();
          save();
        }
      };
      sl.addEventListener('pointerdown', (e) => {
        sl.setPointerCapture(e.pointerId);
        setFrom(e.clientX);
        const mv = (ev) => setFrom(ev.clientX);
        const up = () => {
          sl.removeEventListener('pointermove', mv);
          sl.removeEventListener('pointerup', up);
          this.click();
        };
        sl.addEventListener('pointermove', mv);
        sl.addEventListener('pointerup', up);
      });
      sl.addEventListener('keydown', (e) => {
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
          s[key] = Math.max(min, Math.min(max, +(s[key] + (e.code === 'ArrowLeft' ? -step : step)).toFixed(3)));
          upd();
          save();
        }
      });
      upd();
      grid.appendChild(sl);
    };
    const toggle = (labelFn, onClick) => {
      const b = el('<button class="btn"></button>');
      const upd = () => (b.textContent = labelFn());
      b.addEventListener('click', () => {
        this.click();
        onClick();
        upd();
        save();
      });
      upd();
      grid.appendChild(b);
      return b;
    };
    slider('FOV', 'fov', 30, 110, 1, (v) => (v === 70 ? 'Normal' : v >= 110 ? 'Quake Pro' : v));
    slider('Render Distance', 'renderDist', 2, 16, 1, (v) => `${v} chunks`);
    slider('Sensitivity', 'sensitivity', 10, 200, 1, (v) => `${v}%`);
    slider('Brightness', 'gamma', 0, 1, 0.01, (v) => (v <= 0.01 ? 'Moody' : v >= 0.99 ? 'Bright' : `+${Math.round(v * 100)}%`));
    slider('Master Volume', 'master', 0, 100, 1, (v) => (v ? `${v}%` : 'Off'));
    slider('Music', 'music', 0, 100, 1, (v) => (v ? `${v}%` : 'Off'));
    slider('Sounds', 'sound', 0, 100, 1, (v) => (v ? `${v}%` : 'Off'));
    slider('GUI Scale', 'guiScale', 0, 4, 1, (v) => (v === 0 ? 'Auto' : v));
    toggle(() => `View Bobbing: ${s.viewBob ? 'ON' : 'OFF'}`, () => (s.viewBob = !s.viewBob));
    toggle(() => `Clouds: ${s.clouds ? 'ON' : 'OFF'}`, () => (s.clouds = !s.clouds));
    toggle(() => `Invert Mouse: ${s.invertY ? 'ON' : 'OFF'}`, () => (s.invertY = !s.invertY));
    toggle(() => `Show FPS: ${s.showFps ? 'ON' : 'OFF'}`, () => (s.showFps = !s.showFps));
    toggle(() => `Resolution: ${s.pixelRatio > 1 ? 'Sharp (HiDPI)' : 'Fast'}`, () => (s.pixelRatio = s.pixelRatio > 1 ? 1 : 2));
    toggle(() => `Touch Controls: ${s.touch === 'auto' ? 'Auto' : s.touch === 'on' ? 'ON' : 'OFF'}`, () => (s.touch = s.touch === 'auto' ? 'on' : s.touch === 'on' ? 'off' : 'auto'));
    if (g.world && g.state !== 'title' && !g.meta?.hardcore) {
      toggle(() => `Difficulty: ${DIFFICULTY[g.difficulty]}`, () => {
        g.difficulty = (g.difficulty + 1) % 4;
        if (g.meta) g.meta.difficulty = g.difficulty;
      });
    }
    const ctl = el('<button class="btn">Controls…</button>');
    ctl.addEventListener('click', () => {
      this.click();
      this.showControls();
    });
    grid.appendChild(ctl);
    this.bindButtons(node, { done: () => this.back() });
    this.setScreen('options', node);
  }

  showControls() {
    const g = this.game;
    const s = g.settings;
    const node = el(`
      <div class="screen dark">
        <div class="menu-title txt-shadow">Controls</div>
        <div class="keys-list"></div>
        <div class="menu-col"><div class="btn-row"><button class="btn" data-act="reset">Reset Keys</button><button class="btn" data-act="done">Done</button></div></div>
      </div>`);
    const list = $('.keys-list', node);
    for (const [action, label] of Object.entries(KEY_LABELS)) {
      list.appendChild(el(`<div>${esc(label)}</div>`));
      const b = el(`<button class="btn ${this.capturingKey === action ? 'capture' : ''}">${this.capturingKey === action ? '> press a key <' : esc(keyName(s.keys[action]))}</button>`);
      b.addEventListener('click', () => {
        this.click();
        this.capturingKey = action;
        this.showControls();
      });
      list.appendChild(b);
    }
    for (const [k, v] of [['Attack / Destroy', 'Left Button'], ['Use Item / Place Block', 'Right Button'], ['Pick Block', 'Middle Button'], ['Hotbar Slots', '1 – 9 / Wheel']]) {
      list.appendChild(el(`<div>${esc(k)}</div>`));
      list.appendChild(el(`<button class="btn" disabled>${esc(v)}</button>`));
    }
    const optsBack = this.backTo;
    this.bindButtons(node, {
      reset: () => {
        s.keys = { ...DEFAULT_SETTINGS.keys };
        saveSettings(s);
        this.showControls();
      },
      done: () => this.showOptions(optsBack),
    });
    this.setScreen('controls', node);
    this.backTo = optsBack;
  }

  onCaptureKey(code) {
    const s = this.game.settings;
    if (code !== 'Escape') s.keys[this.capturingKey] = code;
    this.capturingKey = null;
    saveSettings(s);
    this.showControls();
  }

  showHelp(backTo) {
    this.backTo = backTo;
    const k = this.game.settings.keys;
    const kn = (a) => `<kbd>${esc(keyName(k[a]))}</kbd>`;
    const node = el(`
      <div class="screen dark">
        <div class="menu-title txt-shadow">How to Play</div>
        <div class="help-text">
          <h3>Moving around</h3>
          <p>${kn('forward')}${kn('left')}${kn('back')}${kn('right')} walk · ${kn('jump')} jump and swim up · ${kn('sneak')} sneak (you won't fall off edges) · ${kn('sprint')} or double-tap ${kn('forward')} to sprint. Click the game to capture the mouse, ${'<kbd>Esc</kbd>'} to release it.</p>
          <p>In Creative mode, double-tap ${kn('jump')} to fly. Hold ${kn('jump')} to rise and ${kn('sneak')} to descend.</p>
          <h3>Your first day</h3>
          <p>Hold the left mouse button on a tree to collect logs. Open your inventory with ${kn('inventory')} and turn logs into planks in the 2×2 crafting grid, then planks into a Crafting Table. Place it with the right mouse button and right-click it to get a 3×3 grid.</p>
          <p>Make sticks, then a wooden pickaxe. Mine stone for cobblestone and craft better tools and a furnace. Coal ore gives coal for torches. Monsters come out in the dark, so build a shelter and light it before night falls, or sleep in a bed to skip the night.</p>
          <h3>Staying alive</h3>
          <p>Hunger drains as you run, jump and fight. Eat food by holding the right mouse button. With a full hunger bar you slowly heal. Falling far, drowning, lava, fire and cacti all hurt. Wear armor to take less damage.</p>
          <h3>Crafting</h3>
          <p>Every crafting grid has a recipe list on its left: green recipes can be made with what you carry, and clicking one fills the grid for you. Shift-click the result to craft as many as possible. Smelt ores, sand and raw food in a furnace with any fuel (coal, wood, planks…).</p>
          <h3>Handy keys</h3>
          <p>${kn('drop')} drop item · ${kn('chat')} chat · ${kn('command')} commands (try <kbd>/help</kbd>) · ${kn('perspective')} camera view · ${kn('debug')} coordinates and info · ${kn('hideHud')} hide the HUD · ${kn('screenshot')} screenshot · middle-click picks a block.</p>
          <p>In inventories: shift-click moves a stack, right-click splits a stack or places one item, drag with the left button to spread items, number keys swap with the hotbar, double-click gathers a full stack.</p>
        </div>
        <div class="menu-col"><button class="btn" data-act="done">Done</button></div>
      </div>`);
    this.bindButtons(node, { done: () => this.back() });
    this.setScreen('help', node);
  }

  // ---------------------------------------------------------------- multiplayer
  showMultiplayer() {
    const g = this.game;
    let saved = '';
    try {
      saved = localStorage.getItem('blockforge.server') || '';
    } catch {
      saved = '';
    }
    const name = g.settings.name && g.settings.name !== 'Player' ? g.settings.name : '';
    const node = el(`
      <div class="screen dim">
        <div class="menu-title txt-shadow">Play Multiplayer</div>
        <div class="menu-col" style="width:min(calc(var(--gs) * 230), 94vw)">
          <div class="field"><label for="mp-name">Your name</label><input id="mp-name" type="text" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="1-16 letters or numbers" value="${esc(name)}"></div>
          <div class="field"><label for="mp-addr">Server address</label><input id="mp-addr" type="text" maxlength="200" autocomplete="url" spellcheck="false" placeholder="example.com or 192.168.1.20:8080" value="${esc(saved)}">
            <div class="hint" id="mp-status">&nbsp;</div></div>
          <div class="field" id="mp-pw-field" style="display:none"><label for="mp-pw">Server password</label><input id="mp-pw" type="password" maxlength="64" autocomplete="off" spellcheck="false"></div>
          <div class="btn-row"><button class="btn" data-act="join">Join Server</button><button class="btn" data-act="cancel">Cancel</button></div>
          <div class="hint mp-help">Everyone who joins the same server plays in one shared world. To run your own server, see “Multiplayer” in the README.</div>
        </div>
      </div>`);
    const nameIn = $('#mp-name', node), addrIn = $('#mp-addr', node), pwIn = $('#mp-pw', node), status = $('#mp-status', node);
    let probe = 0;
    const check = async () => {
      const id = ++probe;
      const addr = addrIn.value.trim();
      status.textContent = addr || this.servedByServer ? 'Checking server…' : 'Type the address of a Blockforge server';
      if (!addr && !this.servedByServer) return;
      const info = await fetchServerInfo(addr);
      if (id !== probe || !node.isConnected) return;
      if (!info) {
        status.textContent = 'No Blockforge server answered at that address (yet)';
        status.style.color = '#ff9a9a';
        return;
      }
      status.style.color = '#9be89b';
      status.textContent = `${info.name} — ${info.online}/${info.max} online — ${info.motd}`;
      $('#mp-pw-field', node).style.display = info.password ? '' : 'none';
    };
    let timer = 0;
    addrIn.addEventListener('input', () => {
      clearTimeout(timer);
      status.style.color = '';
      timer = setTimeout(check, 450);
    });
    const join = () => {
      const n = nameIn.value.trim().replace(/\s+/g, ' ');
      if (!/^[A-Za-z0-9_ -]{1,16}$/.test(n)) {
        status.textContent = 'Pick a name with 1 to 16 letters, numbers, spaces, - or _';
        status.style.color = '#ff9a9a';
        nameIn.focus();
        return;
      }
      const address = addrIn.value.trim();
      if (!address && !this.servedByServer) {
        status.textContent = 'Type the address of a Blockforge server';
        status.style.color = '#ff9a9a';
        addrIn.focus();
        return;
      }
      try {
        localStorage.setItem('blockforge.server', address);
      } catch {
        /* not remembered */
      }
      g.joinServer({ address, name: n, password: pwIn.value });
    };
    this.bindButtons(node, { join, cancel: () => this.showTitle() });
    node.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') join();
    });
    this.setScreen('multiplayer', node);
    if (!name) setTimeout(() => nameIn.focus(), 40);
    // Pages served by a Blockforge server join that server by default.
    if (this.servedByServer === undefined) {
      fetchServerInfo('', 2500).then((info) => {
        this.servedByServer = !!info;
        if (info && node.isConnected && !addrIn.value) {
          addrIn.placeholder = `${location.host} (this server)`;
          check();
        }
      });
    } else if (this.servedByServer && !addrIn.value) {
      addrIn.placeholder = `${location.host} (this server)`;
      check();
    } else if (addrIn.value) check();
  }

  showNetError(title, message, back) {
    this.netErrorBack = back;
    const node = el(`
      <div class="screen dark">
        <div class="menu-title txt-shadow">${esc(title)}</div>
        <div class="menu-sub" style="max-width:min(calc(var(--gs) * 280), 92vw);line-height:1.5">${esc(message || '')}</div>
        <div class="menu-col" style="margin-top:calc(var(--gs) * 10)"><button class="btn" data-act="back">Back</button></div>
      </div>`);
    this.bindButtons(node, { back: () => back() });
    this.setScreen('neterror', node);
  }

  // Hold Tab in multiplayer to see who is online.
  showPlayerList(show) {
    const net = this.game.net;
    if (!show || !net) {
      if (this.playerListEl) this.playerListEl.remove();
      this.playerListEl = null;
      return;
    }
    if (!this.playerListEl) {
      this.playerListEl = el('<div class="player-list panel"></div>');
      this.hud.appendChild(this.playerListEl);
    }
    const rows = net.players.map(([, name, mode, ping, op]) => {
      const bars = ping < 150 ? 5 : ping < 300 ? 4 : ping < 600 ? 3 : ping < 1000 ? 2 : 1;
      return `<div class="pl-row"><span class="pl-name${mode === 'spectator' ? ' spec' : ''}">${esc(name)}${op ? ' <span class="pl-op">★</span>' : ''}</span><span class="pl-ping" title="${ping} ms">${'▮'.repeat(bars)}${'▯'.repeat(5 - bars)}</span></div>`;
    });
    this.playerListEl.innerHTML = `<div class="pl-title">${esc(this.game.meta?.name || 'Server')} — ${net.players.length} online</div>${rows.join('')}`;
  }

  // ---------------------------------------------------------------- in-game screens
  showPause() {
    const g = this.game;
    if (g.state !== 'playing') return;
    g.input.exitLock();
    g.input.releaseAll();
    const mp = !!g.net;
    const node = el(`
      <div class="screen dark">
        <div class="menu-title txt-shadow">Game Menu</div>
        <div class="menu-col">
          <button class="btn" data-act="back">Back to Game</button>
          <div class="btn-row"><button class="btn" data-act="options">Options…</button><button class="btn" data-act="help">How to Play</button></div>
          <button class="btn" data-act="quit">${mp ? 'Disconnect' : 'Save and Quit to Title'}</button>
        </div>
        <div class="menu-sub" id="pause-saved">${mp ? 'Playing on ' + esc(g.meta?.name || 'a server') + ' — the world keeps going while this menu is open' : ''}</div>
      </div>`);
    this.bindButtons(node, {
      back: () => this.resumeGame(),
      options: () => this.showOptions(() => this.showPause()),
      help: () => this.showHelp(() => this.showPause()),
      quit: () => g.quitToTitle(),
    });
    this.setScreen('pause', node);
    if (!mp) g.saveAll().then(() => {
      const t = $('#pause-saved', node);
      if (t) t.textContent = 'Game saved';
    });
  }

  showDeath(message, score, hardcore) {
    this.game.input.exitLock();
    this.containers.close(true);
    this.closeChat();
    const node = el(`
      <div class="screen death">
        <div class="death-title">${hardcore ? 'Game over!' : 'You died!'}</div>
        <div class="txt-shadow">${esc(message)}</div>
        <div class="txt-shadow">Score: <span style="color:#ffe14d">${score}</span></div>
        <div class="menu-col" style="margin-top:calc(var(--gs) * 10)">
          <button class="btn" data-act="respawn" disabled>${hardcore ? 'Spectate World' : 'Respawn'}</button>
          <button class="btn" data-act="title" disabled>Title Screen</button>
        </div>
      </div>`);
    this.bindButtons(node, {
      respawn: () => {
        this.closeScreen();
        this.game.respawn();
      },
      title: () => this.game.quitToTitle(),
    });
    setTimeout(() => node.querySelectorAll('.btn').forEach((b) => (b.disabled = false)), 1000);
    this.setScreen('death', node);
  }

  showLoading(text) {
    const node = el(`
      <div class="screen dark">
        <div class="menu-title txt-shadow">${esc(text)}</div>
        <div class="progress"><div></div></div>
        <div class="menu-sub" id="load-sub">Building terrain</div>
      </div>`);
    this.setScreen('loading', node);
  }

  setLoading(frac, sub) {
    if (this.screenName !== 'loading') return;
    $('.progress > div', this.screen).style.width = Math.round(frac * 100) + '%';
    if (sub) $('#load-sub', this.screen).textContent = sub;
  }

  // ---------------------------------------------------------------- containers
  toggleInventory() {
    if (this.containers.open) {
      this.containers.close();
      this.game.resume();
      return;
    }
    if (this.screen || this.chatOpen) return;
    this.game.input.exitLock();
    this.game.input.releaseAll();
    if (this.game.player.mode === 'creative') this.containers.openCreative();
    else this.containers.openInventory();
  }
  openCrafting() {
    this.game.input.exitLock();
    this.game.input.releaseAll();
    this.containers.openCrafting();
  }
  openFurnace(te) {
    if (!te) return;
    this.game.input.exitLock();
    this.game.input.releaseAll();
    this.containers.openFurnace(te);
    if (this.game.net) this.game.net.openTile(te);
  }
  openChest(te) {
    if (!te) return;
    this.game.input.exitLock();
    this.game.input.releaseAll();
    this.containers.openChest(te);
    if (this.game.net) this.game.net.openTile(te);
  }

  // ---------------------------------------------------------------- HUD
  buildHud() {
    const hud = el(`
      <div id="hud" class="hidden">
        <div class="overlay water hidden"></div>
        <div class="overlay fire hidden"></div>
        <div class="overlay lowhp hidden"></div>
        <div class="overlay hurt"></div>
        <div class="overlay sleep"></div>
        <div class="crosshair"></div>
        <div class="debug hidden"></div>
        <div class="debug right hidden"></div>
        <div class="fps hidden txt-shadow"></div>
        <div class="chat passive"></div>
        <div class="item-name txt-shadow" style="opacity:0"></div>
        <div class="action-msg txt-shadow" style="opacity:0"></div>
        <div class="hotbar-wrap">
          <div class="stats">
            <div class="stat-col"><div class="stat-row armor"></div><div class="stat-row hearts"></div></div>
            <div class="stat-col right"><div class="stat-row rtl air"></div><div class="stat-row rtl food"></div></div>
          </div>
          <div class="xp"><div></div><span class="xp-level"></span></div>
          <div class="hotbar"></div>
        </div>
      </div>`);
    this.root.appendChild(hud);
    this.hud = hud;
    const hb = $('.hotbar', hud);
    this.hotbarSlots = [];
    for (let i = 0; i < 9; i++) {
      const s = el('<div class="hslot"><div class="item"></div></div>');
      hb.appendChild(s);
      this.hotbarSlots.push(s);
    }
    const mk = (row) => {
      const imgs = [];
      for (let i = 0; i < 10; i++) {
        const im = document.createElement('img');
        im.alt = '';
        row.appendChild(im);
        imgs.push(im);
      }
      return imgs;
    };
    this.heartImgs = mk($('.hearts', hud));
    this.foodImgs = mk($('.food', hud));
    this.armorImgs = mk($('.armor', hud));
    this.airImgs = mk($('.air', hud));
    this.chatEl = $('.chat', hud);
  }

  updateHudVisibility() {
    const g = this.game;
    const show = (g.state === 'playing' || g.state === 'dead') && this.hudVisible;
    this.hud.classList.toggle('hidden', !show);
  }

  toggleHud() {
    this.hudVisible = !this.hudVisible;
    this.updateHudVisibility();
  }

  toggleDebug() {
    this.debug = !this.debug;
    this.hud.querySelectorAll('.debug').forEach((d) => d.classList.toggle('hidden', !this.debug));
  }

  renderItem(container, stack) {
    const key = stack ? `${stack.id}:${stack.count}:${stack.dmg || 0}` : '';
    if (container._key === key) return;
    container._key = key;
    container.innerHTML = '';
    if (!stack) return;
    const def = ITEMS[stack.id];
    if (!def) return;
    const img = document.createElement('img');
    img.src = this.game.gfx.items.icon(stack.id);
    img.alt = def.display;
    img.draggable = false;
    container.appendChild(img);
    if (stack.count > 1) {
      const c = document.createElement('div');
      c.className = 'count';
      c.textContent = stack.count;
      container.appendChild(c);
    }
    if (def.durability && stack.dmg > 0) {
      const f = 1 - stack.dmg / def.durability;
      const d = document.createElement('div');
      d.className = 'dur';
      const bar = document.createElement('div');
      bar.style.width = Math.round(f * 100) + '%';
      bar.style.background = `hsl(${Math.round(f * 120)}, 90%, 50%)`;
      d.appendChild(bar);
      container.appendChild(d);
    }
  }

  setImgs(imgs, values) {
    for (let i = 0; i < imgs.length; i++) {
      const v = values[i];
      if (imgs[i]._v !== v) {
        imgs[i]._v = v;
        if (v) {
          imgs[i].src = v;
          imgs[i].style.visibility = 'visible';
        } else imgs[i].style.visibility = 'hidden';
      }
    }
  }

  updateHud(dt) {
    const g = this.game;
    const p = g.player;
    if (!p || this.hud.classList.contains('hidden')) return;
    const inv = p.inventory;
    const I = this.icons;
    for (let i = 0; i < 9; i++) {
      this.renderItem(this.hotbarSlots[i].firstElementChild, inv.slots[i]);
      this.hotbarSlots[i].classList.toggle('sel', i === inv.selected);
    }
    const survival = p.mode === 'survival';
    $('.stats', this.hud).style.visibility = survival ? 'visible' : 'hidden';
    $('.xp', this.hud).style.visibility = survival ? 'visible' : 'hidden';
    if (survival) {
      const hp = Math.ceil(p.health);
      const flash = p.hurtTime > 0 && p.hurtTime % 4 < 2;
      const low = hp <= 4;
      const t = performance.now();
      const hv = [];
      for (let i = 0; i < 10; i++) {
        const v = hp - i * 2;
        hv.push(v >= 2 ? I.heart : v === 1 ? I.heartHalf : flash ? I.heartFlash : I.heartEmpty);
      }
      this.setImgs(this.heartImgs, hv);
      this.heartImgs.forEach((im, i) => im.classList.toggle('bob', low && Math.floor(t / 80 + i * 3) % 4 === 0));
      const sick = !!p.effects.hunger;
      const fv = [];
      for (let i = 0; i < 10; i++) {
        const v = p.food - i * 2;
        fv.push(v >= 2 ? (sick ? I.hungerSick : I.hunger) : v === 1 ? I.hungerHalf : I.hungerEmpty);
      }
      this.setImgs(this.foodImgs, fv);
      this.foodImgs.forEach((im, i) => im.classList.toggle('bob', p.saturation <= 0 && Math.floor(t / 60 + i * 5) % 9 === 0));
      const ar = p.inventory.armorPoints();
      const av = [];
      for (let i = 0; i < 10; i++) {
        const v = ar - i * 2;
        av.push(ar === 0 ? null : v >= 2 ? I.armor : v === 1 ? I.armorHalf : I.armorEmpty);
      }
      this.setImgs(this.armorImgs, av);
      const underwater = p.isEyeInWater() || p.air < 300;
      const bubbles = Math.ceil((Math.max(0, p.air) * 10) / 300);
      const bv = [];
      for (let i = 0; i < 10; i++) bv.push(underwater ? (i < bubbles ? I.bubble : null) : null);
      this.setImgs(this.airImgs, bv);
      $('.xp > div', this.hud).style.width = Math.round(p.xpProgress * 100) + '%';
      const lvl = $('.xp-level', this.hud);
      lvl.textContent = p.xpLevel > 0 ? p.xpLevel : '';
      $('.overlay.lowhp', this.hud).classList.toggle('hidden', hp > 4 || hp <= 0);
    }
    // Selected item name
    if (inv.selected !== this.lastSelected || inv.version !== this.lastInvVersion) {
      const s = inv.selectedStack();
      const key = s ? s.id : -1;
      if (inv.selected !== this.lastSelected || key !== this.lastNameKey) {
        if (s) {
          $('.item-name', this.hud).textContent = ITEMS[s.id].display;
          this.itemNameTimer = 2;
        } else this.itemNameTimer = 0;
        this.lastNameKey = key;
      }
      this.lastSelected = inv.selected;
      this.lastInvVersion = inv.version;
    }
    this.itemNameTimer -= dt;
    $('.item-name', this.hud).style.opacity = this.itemNameTimer > 0 ? Math.min(1, this.itemNameTimer * 2) : 0;
    this.actionTimer -= dt;
    $('.action-msg', this.hud).style.opacity = this.actionTimer > 0 ? Math.min(1, this.actionTimer) : 0;
    // Overlays
    const medium = g.cameraMedium;
    $('.overlay.water', this.hud).classList.toggle('hidden', medium !== 'water' || g.perspective !== 0);
    $('.overlay.fire', this.hud).classList.toggle('hidden', !(p.fireTicks > 0 && p.mode === 'survival' && g.perspective === 0));
    $('.overlay.hurt', this.hud).style.opacity = p.hurtTime > 0 && p.health > 0 ? (p.hurtTime / 10) * 0.9 : 0;
    const sleep = p.sleeping ? Math.min(1, p.sleepTimer / 90) : 0;
    $('.overlay.sleep', this.hud).style.opacity = sleep;
    // Chat fade
    const now = performance.now();
    for (const line of this.chatLines) {
      const age = (now - line.t) / 1000;
      line.el.style.opacity = this.chatOpen ? 1 : age < 9 ? 1 : Math.max(0, 1 - (age - 9));
    }
    $('.fps', this.hud).classList.toggle('hidden', !g.settings.showFps || this.debug);
    if (g.settings.showFps) $('.fps', this.hud).textContent = `${g.fps} fps`;
    if (this.debug) this.updateDebug();
  }

  updateDebug() {
    const g = this.game;
    const p = g.player;
    const w = g.world;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const f = ((Math.round(-p.yaw / (Math.PI / 2)) % 4) + 4) % 4;
    const facing = ['north', 'west', 'south', 'east'][f];
    const towards = ['Towards negative Z', 'Towards negative X', 'Towards positive Z', 'Towards positive X'][f];
    const hit = p.hit;
    const yawDeg = ((-p.yaw * 180) / Math.PI + 180) % 360 - 180;
    const left = [
      `Blockforge 1.0 (${g.fps} fps, ${g.gfx.stats.pending || 0} chunk updates)`,
      `C: ${w.chunks.size} chunks, E: ${w.entities.length} entities`,
      '',
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(5)} / ${p.z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}`,
      `Chunk: ${bx & 15} ${by & 15} ${bz & 15} in ${bx >> 4} ${by >> 4} ${bz >> 4}`,
      `Facing: ${facing} (${towards}) (${yawDeg.toFixed(1)} / ${((-p.pitch * 180) / Math.PI).toFixed(1)})`,
      `Light: ${w.lightAt(bx, by, bz)} (${w.getSkyLight(bx, by, bz)} sky, ${w.getBlockLight(bx, by, bz)} block)`,
      `Biome: ${BIOME_NAMES[w.getBiome(bx, bz)] || '?'}`,
      `Day ${w.day + 1}, time ${Math.floor(w.time)}${w.weather.raining ? ', raining' : ''}`,
      `Mode: ${p.mode}, difficulty ${DIFFICULTY[g.difficulty]}`,
    ];
    if (g.net) left.push(`Server: ${g.meta?.name || '?'}, ${g.net.players.length} online, ${g.net.proxies.size} remote entities`);
    const right = [
      `Seed: ${w.seed}`,
      `Render distance: ${g.settings.renderDist}`,
      '',
    ];
    if (hit) {
      const b = BLOCKS[hit.id];
      right.push('Targeted Block', `${hit.x}, ${hit.y}, ${hit.z}`, `${b ? b.name : hit.id}`, `meta: ${hit.meta}`);
      if (b && b.facing) right.push(`facing: ${FACING_NAMES[hit.meta & 3]}`);
    }
    const [l, r] = this.hud.querySelectorAll('.debug');
    l.innerHTML = left.map((s) => (s ? `<span>${esc(s)}</span>` : '')).join('\n');
    r.innerHTML = right.map((s) => (s ? `<span>${esc(s)}</span>` : '')).join('\n');
  }

  message(text) {
    const m = $('.action-msg', this.hud);
    m.textContent = text;
    this.actionTimer = 3;
  }

  // ---------------------------------------------------------------- chat
  chat(text, color) {
    const line = el(`<div class="chat-line txt-shadow"></div>`);
    line.textContent = text;
    if (color) line.style.color = color;
    this.chatEl.appendChild(line);
    this.chatLines.push({ el: line, t: performance.now() });
    while (this.chatLines.length > 12) this.chatLines.shift().el.remove();
  }

  openChat(prefix) {
    const g = this.game;
    if (g.state !== 'playing' || this.screenOpen()) return;
    g.input.exitLock();
    g.input.releaseAll();
    this.chatOpen = true;
    this.chatEl.classList.add('open');
    const wrap = el(`<div class="chat-input-wrap"><div class="chat-suggest hidden"></div><input id="chat-input" type="text" maxlength="256" autocomplete="off" spellcheck="false"></div>`);
    this.hud.appendChild(wrap);
    wrap.style.pointerEvents = 'auto';
    wrap.querySelector('input').style.pointerEvents = 'auto';
    this.chatWrap = wrap;
    const input = $('input', wrap);
    input.value = prefix;
    this.historyIdx = this.chatHistory.length;
    input.addEventListener('input', () => this.updateSuggest());
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(prefix.length, prefix.length);
    }, 0);
    this.updateSuggest();
  }

  updateSuggest() {
    if (!this.chatWrap) return;
    const input = $('input', this.chatWrap);
    const sug = $('.chat-suggest', this.chatWrap);
    const list = input.value.startsWith('/') ? this.game.commands.suggest(input.value) : [];
    this.suggestions = list;
    if (!list.length) {
      sug.classList.add('hidden');
      return;
    }
    sug.classList.remove('hidden');
    sug.textContent = list.slice(0, 8).join('\n');
  }

  onTextKey(e) {
    if (!this.chatOpen) return;
    const input = $('input', this.chatWrap);
    if (e.code === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      if (text) {
        this.chatHistory.push(text);
        if (text.startsWith('/')) this.game.commands.run(text);
        else if (this.game.net) this.game.net.send({ t: 'chat', m: text });
        else this.chat(`<${this.game.player.name}> ${text}`);
      }
      this.closeChat();
      this.game.resume();
    } else if (e.code === 'Tab') {
      e.preventDefault();
      if (this.suggestions && this.suggestions.length) {
        const parts = input.value.split(' ');
        parts[parts.length - 1] = this.suggestions[0].split(' ').pop();
        input.value = parts.join(' ') + (this.suggestions.length === 1 ? ' ' : '');
        this.updateSuggest();
      }
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      if (!this.chatHistory.length) return;
      this.historyIdx = Math.max(0, Math.min(this.chatHistory.length, this.historyIdx + (e.code === 'ArrowUp' ? -1 : 1)));
      input.value = this.chatHistory[this.historyIdx] || '';
    }
  }

  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.chatEl.classList.remove('open');
    if (this.chatWrap) this.chatWrap.remove();
    this.chatWrap = null;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    this.updateHud(dt);
    this.containers.update();
    this.touch.update();
  }

  hideAll() {
    this.closeScreen();
    this.containers.close(true);
    this.closeChat();
  }
}
