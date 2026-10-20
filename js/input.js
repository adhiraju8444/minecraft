// Keyboard / mouse state. Movement keys are sampled every tick; presses that
// must not be missed (attack, use, hotbar...) are queued as events.
export class Input {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.state = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false, attack: false, use: false };
    this.queue = new Map();
    this.down = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.locked = false;
    this.touchActive = false;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    canvas.addEventListener('mousedown', (e) => this.onMouse(e, true));
    window.addEventListener('mouseup', (e) => this.onMouse(e, false));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
    });
  }

  get keys() {
    return this.game.settings.keys;
  }

  push(name) {
    this.queue.set(name, (this.queue.get(name) || 0) + 1);
  }

  consume(name) {
    const n = this.queue.get(name) || 0;
    if (n > 0) {
      this.queue.set(name, n - 1);
      return true;
    }
    return false;
  }

  clearQueue() {
    this.queue.clear();
  }

  releaseAll() {
    for (const k of Object.keys(this.state)) this.state[k] = false;
    if (this.game.ui) this.game.ui.showPlayerList?.(false);
    this.down.clear();
    this.debugHeld = false;
  }

  requestLock() {
    if (this.touchActive) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try {
          this.canvas.requestPointerLock();
        } catch {
          /* pointer lock unavailable */
        }
      });
    } catch {
      try {
        this.canvas.requestPointerLock();
      } catch {
        /* pointer lock unavailable */
      }
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onLockChange() {
    const wasLocked = this.locked;
    this.locked = document.pointerLockElement === this.canvas;
    if (wasLocked && !this.locked) {
      this.releaseAll();
      this.game.onPointerUnlock();
    }
  }

  onKey(e, isDown) {
    const game = this.game;
    const code = e.code;
    const K = this.keys;
    const ui = game.ui;
    // Text fields get their keys.
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (isDown && code === 'Escape') ui.onEscape(e);
      if (isDown && (code === 'Enter' || code === 'Tab' || code === 'ArrowUp' || code === 'ArrowDown')) ui.onTextKey?.(e);
      return;
    }
    if (ui.capturingKey) {
      if (isDown) {
        e.preventDefault();
        ui.onCaptureKey(code);
      }
      return;
    }
    if (isDown && ['Space', 'F1', 'F2', 'F3', 'F4', 'F5', 'Tab', 'Slash', 'ArrowUp', 'ArrowDown'].includes(code)) e.preventDefault();
    if (isDown && (e.ctrlKey || e.metaKey) && ['KeyW', 'KeyS', 'KeyD', 'KeyA'].includes(code) && game.state === 'playing') e.preventDefault();

    if (code === K.playerList && game.net) {
      e.preventDefault();
      ui.showPlayerList(isDown && game.state === 'playing');
      if (isDown) return;
    }
    if (!isDown) {
      this.down.delete(code);
      // The debug key toggles on release, unless it was held for F3+F4.
      if (code === K.debug && this.debugHeld) {
        this.debugHeld = false;
        if (!this.debugCombo && game.state === 'playing') ui.toggleDebug();
      }
      for (const [a, c] of Object.entries(K)) if (c === code && a in this.state) this.state[a] = false;
      if (code === 'ShiftRight' && K.sneak === 'ShiftLeft') this.state.sneak = false;
      if (code === 'ControlRight' && K.sprint === 'ControlLeft') this.state.sprint = false;
      return;
    }
    const repeat = this.down.has(code);
    this.down.add(code);
    if (code === 'Escape') {
      ui.onEscape(e);
      return;
    }
    if (ui.onKey && ui.onKey(e, code)) return;
    if (game.state !== 'playing') return;

    for (const [a, c] of Object.entries(K)) if (c === code && a in this.state) this.state[a] = true;
    if (code === 'ShiftRight' && K.sneak === 'ShiftLeft') this.state.sneak = true;
    if (code === 'ControlRight' && K.sprint === 'ControlLeft') this.state.sprint = true;
    if (repeat && code !== K.drop) return;
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= 9) game.selectHotbar(n - 1);
    }
    if (code === K.inventory) ui.toggleInventory();
    else if (code === K.drop) game.dropSelected(e.ctrlKey || e.metaKey);
    else if (code === K.chat) {
      e.preventDefault();
      ui.openChat('');
    } else if (code === K.command) {
      e.preventDefault();
      ui.openChat('/');
    } else if (code === K.perspective) game.cyclePerspective();
    else if (code === K.debug) {
      this.debugHeld = true;
      this.debugCombo = false;
    } else if (code === 'F4' && this.debugHeld) {
      this.debugCombo = true;
      game.cycleGameMode();
    }
    else if (code === K.hideHud) ui.toggleHud();
    else if (code === K.screenshot) game.screenshot();
  }

  onMouse(e, isDown) {
    const game = this.game;
    if (isDown) {
      if (game.state === 'playing' && !this.locked && !game.ui.screenOpen() && !this.touchActive) {
        this.requestLock();
        e.preventDefault();
        return;
      }
      if (!this.locked && !this.touchActive) return;
      if (e.button === 0) {
        this.state.attack = true;
        this.push('attack');
      } else if (e.button === 2) {
        this.state.use = true;
        this.push('use');
      } else if (e.button === 1) {
        this.push('pick');
        e.preventDefault();
      }
    } else {
      if (e.button === 0) this.state.attack = false;
      else if (e.button === 2) this.state.use = false;
    }
  }

  onMove(e) {
    if (!this.locked) return;
    let dx = e.movementX || 0, dy = e.movementY || 0;
    // Some browsers report huge spikes when the lock engages.
    if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
    this.lookDX += dx;
    this.lookDY += dy;
  }

  onWheel(e) {
    if (this.game.state !== 'playing' || this.game.ui.screenOpen()) return;
    e.preventDefault();
    const d = Math.sign(e.deltaY);
    if (d) this.game.scrollHotbar(d);
  }

  // Pull look deltas accumulated since the last frame.
  takeLook() {
    const r = [this.lookDX, this.lookDY];
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }
}
