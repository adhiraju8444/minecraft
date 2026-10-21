// On-screen controls for phones and tablets: drag anywhere on the screen
// that has no button to look around, tap to use/place and hold to mine/attack,
// plus buttons for the
// keys a phone does not have (Fn opens the function keys).
const TOP = 'calc(env(safe-area-inset-top,0px) + 12px)';

// [name, key label, action label]
const FN_KEYS = [
  ['mode', 'F3+F4', 'Mode'],
  ['command', '/', 'Command'],
  ['players', 'Tab', 'Players'],
  ['pick', 'Pick', 'Block'],
  ['camera', 'F5', 'Camera'],
  ['debug', 'F3', 'Info'],
  ['hud', 'F1', 'HUD'],
  ['shot', 'F2', 'Photo'],
];

export class TouchControls {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.node = null;
    this.lookId = null;
    this.lookStart = null;
    this.sneakOn = false;
    this.sprintOn = false;
    this.fnOpen = false;
    this.enabled = false;
  }

  wanted() {
    const t = this.game.settings.touch;
    if (t === 'on') return true;
    if (t === 'off') return false;
    return 'ontouchstart' in window || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  build() {
    const node = document.createElement('div');
    node.className = 'touch';
    node.innerHTML = `
      <div class="tbtn" data-b="sprint" style="left:calc(env(safe-area-inset-left,0px) + 172px);bottom:calc(env(safe-area-inset-bottom,0px) + 28px)">Sprint</div>
      <div class="tbtn" data-b="jump" style="right:24px;bottom:110px">Jump</div>
      <div class="tbtn" data-b="sneak" style="right:100px;bottom:40px">Sneak</div>
      <div class="tbtn" data-b="attack" style="right:24px;bottom:186px">Mine</div>
      <div class="tbtn" data-b="use" style="right:100px;bottom:120px">Use</div>
      <div class="tbtn small" data-b="inv" style="right:20px;top:${TOP}">Bag</div>
      <div class="tbtn small" data-b="pause" style="right:76px;top:${TOP}">II</div>
      <div class="tbtn small" data-b="drop" style="right:132px;top:${TOP}">Drop</div>
      <div class="tbtn small" data-b="chat" style="right:188px;top:${TOP}">Chat</div>
      <div class="tbtn small" data-b="fn" style="right:244px;top:${TOP}">Fn</div>
      <div class="fn-keys hidden">
        ${FN_KEYS.map(([b, key, label]) => `<div class="tbtn fn" data-b="${b}"><b>${key}</b><span>${label}</span></div>`).join('')}
      </div>`;
    this.ui.root.appendChild(node);
    this.node = node;
    this.fnPanel = node.querySelector('.fn-keys');
    this.modeBtn = node.querySelector('[data-b="mode"]');
    this.playersBtn = node.querySelector('[data-b="players"]');
    const input = this.game.input;

    node.querySelectorAll('.tbtn').forEach((b) => {
      const name = b.dataset.b;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.game.audio.init();
        this.press(name, b);
      }, { passive: false });
      const up = (e) => {
        e.preventDefault();
        this.release(name);
      };
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
    });

    // Look + tap/hold on the game canvas
    const canvas = this.game.canvas;
    canvas.addEventListener('touchstart', (e) => {
      if (!this.enabled || this.game.state !== 'playing' || this.ui.screenOpen()) return;
      e.preventDefault();
      const t = e.changedTouches[0];
      if (this.lookId !== null) return;
      this.lookId = t.identifier;
      this.lookLast = [t.clientX, t.clientY];
      this.lookStart = { x: t.clientX, y: t.clientY, time: performance.now(), moved: 0 };
      this.holdTimer = setTimeout(() => {
        if (this.lookStart && this.lookStart.moved < 12) {
          input.state.attack = true;
          input.push('attack');
          this.holding = true;
        }
      }, 280);
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (this.lookId === null) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== this.lookId) continue;
        const dx = t.clientX - this.lookLast[0], dy = t.clientY - this.lookLast[1];
        this.lookLast = [t.clientX, t.clientY];
        this.lookStart.moved += Math.abs(dx) + Math.abs(dy);
        input.lookDX += dx * 2.2;
        input.lookDY += dy * 2.2;
      }
    }, { passive: false });
    const endLook = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.lookId) continue;
        clearTimeout(this.holdTimer);
        const s = this.lookStart;
        if (this.holding) {
          input.state.attack = false;
          this.holding = false;
        } else if (s && s.moved < 12 && performance.now() - s.time < 280) {
          input.push('use');
        }
        this.lookId = null;
        this.lookStart = null;
      }
    };
    canvas.addEventListener('touchend', endLook);
    canvas.addEventListener('touchcancel', endLook);

    // Tap the hotbar to select
    this.ui.hotbarSlots.forEach((s, i) => {
      s.style.pointerEvents = 'auto';
      s.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.game.selectHotbar(i);
      }, { passive: false });
    });
    this.ui.hud.querySelector('.hotbar').style.pointerEvents = 'auto';
  }

  press(name, b) {
    const g = this.game, ui = this.ui, input = g.input;
    switch (name) {
      case 'jump': input.state.jump = true; break;
      case 'attack': input.state.attack = true; input.push('attack'); break;
      case 'use': input.state.use = true; input.push('use'); break;
      case 'sneak':
        this.sneakOn = !this.sneakOn;
        input.state.sneak = this.sneakOn;
        b.classList.toggle('on', this.sneakOn);
        break;
      case 'sprint':
        this.sprintOn = !this.sprintOn;
        input.state.sprint = this.sprintOn;
        b.classList.toggle('on', this.sprintOn);
        break;
      case 'drop':
        // Tap drops one item; hold drops the whole stack.
        this.dropLong = false;
        clearTimeout(this.dropTimer);
        this.dropTimer = setTimeout(() => {
          this.dropLong = true;
          g.dropSelected(true);
        }, 450);
        break;
      case 'inv': ui.toggleInventory(); break;
      case 'pause': ui.showPause(); break;
      case 'chat': ui.openChat(''); break;
      case 'fn': this.showFn(!this.fnOpen); break;
      case 'mode': g.cycleGameMode(); break;
      case 'command': ui.openChat('/'); break;
      case 'players': ui.showPlayerList(!ui.playerListEl); break;
      case 'pick': input.push('pick'); break;
      case 'camera': g.cyclePerspective(); break;
      case 'debug': ui.toggleDebug(); break;
      case 'hud': ui.toggleHud(); break;
      case 'shot': g.screenshot(); break;
    }
    // A function key closes the Fn row again, like letting go of Fn.
    if (b.classList.contains('fn')) this.showFn(false);
  }

  showFn(on) {
    this.fnOpen = on;
    this.node.querySelector('[data-b="fn"]').classList.toggle('on', on);
    this.fnPanel.classList.toggle('hidden', !on);
    if (!on) return;
    this.modeBtn.classList.toggle('hidden', !this.game.canSwitchMode());
    this.playersBtn.classList.toggle('hidden', !this.game.net);
  }

  release(name) {
    const input = this.game.input;
    if (name === 'jump') input.state.jump = false;
    else if (name === 'attack') input.state.attack = false;
    else if (name === 'use') input.state.use = false;
    else if (name === 'drop') {
      clearTimeout(this.dropTimer);
      if (!this.dropLong && this.game.state === 'playing') this.game.dropSelected(false);
      this.dropLong = true;
    }
  }

  update() {
    const want = this.wanted() && this.game.state === 'playing' && !this.ui.screenOpen();
    if (want && !this.node) this.build();
    this.enabled = this.wanted();
    this.game.input.touchActive = this.enabled;
    if (!this.node) return;
    this.node.classList.toggle('hidden', !want);
    if (!want) return;
    // Menus release every key; keep the toggles that are still shown as on.
    const st = this.game.input.state;
    if (this.sneakOn) st.sneak = true;
    if (this.sprintOn) st.sprint = true;
  }
}
