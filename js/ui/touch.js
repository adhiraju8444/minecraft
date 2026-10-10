// On-screen controls for phones and tablets: a movement stick, look by
// dragging, tap to use/place and hold to mine/attack.
export class TouchControls {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.node = null;
    this.stickId = null;
    this.lookId = null;
    this.lookStart = null;
    this.sneakOn = false;
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
      <div class="stick"><div class="nub"></div></div>
      <div class="tbtn" data-b="jump" style="right:24px;bottom:110px">Jump</div>
      <div class="tbtn" data-b="sneak" style="right:100px;bottom:40px">Sneak</div>
      <div class="tbtn" data-b="attack" style="right:24px;bottom:186px">Mine</div>
      <div class="tbtn" data-b="use" style="right:100px;bottom:120px">Use</div>
      <div class="tbtn small" data-b="inv" style="right:20px;top:calc(env(safe-area-inset-top,0px) + 12px)">Bag</div>
      <div class="tbtn small" data-b="pause" style="right:76px;top:calc(env(safe-area-inset-top,0px) + 12px)">II</div>
      <div class="tbtn small" data-b="drop" style="right:132px;top:calc(env(safe-area-inset-top,0px) + 12px)">Drop</div>`;
    this.ui.root.appendChild(node);
    this.node = node;
    const stick = node.querySelector('.stick');
    const nub = node.querySelector('.nub');
    const input = this.game.input;
    const setStick = (dx, dy) => {
      const r = 50;
      const l = Math.hypot(dx, dy);
      if (l > r) { dx = (dx / l) * r; dy = (dy / l) * r; }
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / r, ny = dy / r;
      input.state.forward = ny < -0.3;
      input.state.back = ny > 0.3;
      input.state.left = nx < -0.3;
      input.state.right = nx > 0.3;
      input.state.sprint = ny < -0.95;
    };
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.stickId = t.identifier;
      const r = stick.getBoundingClientRect();
      this.stickCenter = [r.left + r.width / 2, r.top + r.height / 2];
      setStick(t.clientX - this.stickCenter[0], t.clientY - this.stickCenter[1]);
    }, { passive: false });
    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === this.stickId) setStick(t.clientX - this.stickCenter[0], t.clientY - this.stickCenter[1]);
    }, { passive: false });
    const endStick = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.stickId) {
        this.stickId = null;
        setStick(0, 0);
      }
    };
    stick.addEventListener('touchend', endStick);
    stick.addEventListener('touchcancel', endStick);

    node.querySelectorAll('.tbtn').forEach((b) => {
      const name = b.dataset.b;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.game.audio.init();
        if (name === 'jump') input.state.jump = true;
        else if (name === 'attack') { input.state.attack = true; input.push('attack'); }
        else if (name === 'use') { input.state.use = true; input.push('use'); }
        else if (name === 'sneak') {
          this.sneakOn = !this.sneakOn;
          input.state.sneak = this.sneakOn;
          b.classList.toggle('on', this.sneakOn);
        } else if (name === 'inv') this.ui.toggleInventory();
        else if (name === 'pause') this.ui.showPause();
        else if (name === 'drop') this.game.dropSelected(false);
      }, { passive: false });
      const up = (e) => {
        e.preventDefault();
        if (name === 'jump') input.state.jump = false;
        else if (name === 'attack') input.state.attack = false;
        else if (name === 'use') input.state.use = false;
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

  update() {
    const want = this.wanted() && this.game.state === 'playing' && !this.ui.screenOpen();
    if (want && !this.node) this.build();
    this.enabled = this.wanted();
    this.game.input.touchActive = this.enabled;
    if (this.node) this.node.classList.toggle('hidden', !want);
  }
}
