// All sound is synthesised at runtime with Web Audio: no audio files.
// Music is generated procedurally (random walks over scales and chord
// progressions), so each piece is different.

const MAT = {
  stone: { type: 'bandpass', f: 1500, q: 0.9, len: 0.14, gain: 0.5, body: 120 },
  wood: { type: 'bandpass', f: 520, q: 2.5, len: 0.14, gain: 0.6, body: 170 },
  gravel: { type: 'lowpass', f: 1100, q: 0.7, len: 0.16, gain: 0.55, grain: true },
  grass: { type: 'highpass', f: 1400, q: 0.5, len: 0.13, gain: 0.35, soft: true },
  sand: { type: 'highpass', f: 2600, q: 0.5, len: 0.18, gain: 0.3, soft: true },
  snow: { type: 'lowpass', f: 1500, q: 0.6, len: 0.16, gain: 0.35, soft: true },
  wool: { type: 'lowpass', f: 520, q: 0.6, len: 0.14, gain: 0.45, soft: true },
  glass: { type: 'bandpass', f: 2600, q: 1.2, len: 0.12, gain: 0.45 },
  metal: { type: 'bandpass', f: 1900, q: 3, len: 0.16, gain: 0.45, ring: true },
  water: { type: 'lowpass', f: 700, q: 0.5, len: 0.25, gain: 0.4, soft: true },
  lava: { type: 'lowpass', f: 400, q: 0.5, len: 0.25, gain: 0.4, soft: true },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, music: 0.5, sound: 0.9 };
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.music = { nextAt: 0, playing: false, mode: 'title' };
    this.lastPlay = new Map();
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet);
    wet.connect(this.musicBus);
    this.musicDry = ctx.createGain();
    this.musicDry.gain.value = 0.7;
    this.musicDry.connect(this.musicBus);
    this.noise = this.makeNoise(2);
    // Rain loop
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noise;
    rainSrc.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 1800;
    rf.Q.value = 0.4;
    rainSrc.connect(rf);
    rf.connect(this.rainGain);
    this.rainGain.connect(this.sfx);
    rainSrc.start();
    this.applyVolumes();
    if (ctx.state === 'suspended') ctx.resume();
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sound, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.6, t, 0.05);
  }

  setListener(x, y, z, yaw) {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  // Output node with distance attenuation and stereo pan.
  spatial(opts, volume = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let vol = volume * (opts.volume ?? 1);
    let pan = 0;
    if (opts.x !== undefined) {
      const L = this.listener;
      const dx = opts.x - L.x, dy = opts.y - L.y, dz = opts.z - L.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const range = opts.range || 16;
      if (d > range) return null;
      vol *= Math.max(0, 1 - d / range);
      const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
      if (d > 0.5) pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.8;
    }
    if (vol <= 0.001) return null;
    g.gain.value = vol;
    if (ctx.createStereoPanner && pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }

  noiseHit(out, { type, f, q, len, gain, attack = 0.002, t = 0 }) {
    const ctx = this.ctx;
    const now = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = f;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + len);
    src.connect(filt);
    filt.connect(g);
    g.connect(out);
    src.start(now, Math.random() * 1.5);
    src.stop(now + len + 0.05);
  }

  tone(out, { freq, type = 'sine', len = 0.2, gain = 0.3, to = null, attack = 0.005, t = 0, vibrato = 0 }) {
    const ctx = this.ctx;
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, now);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + len);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = vibrato;
      lg.gain.value = freq * 0.04;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(now);
      lfo.stop(now + len + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + len);
    o.connect(g);
    g.connect(out);
    o.start(now);
    o.stop(now + len + 0.05);
  }

  // Throttle identical sounds so mass events (explosions) stay pleasant.
  throttle(key, ms) {
    const now = performance.now();
    const last = this.lastPlay.get(key) || 0;
    if (now - last < ms) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  blockSound(material, kind, x, y, z) {
    if (!this.ctx) return;
    const m = MAT[material] || MAT.stone;
    const vol = kind === 'step' ? 0.22 : kind === 'hit' ? 0.3 : kind === 'place' ? 0.75 : 0.9;
    if (!this.throttle(material + kind + Math.round(x) + Math.round(z), kind === 'break' ? 30 : 20)) return;
    const out = this.spatial({ x, y, z }, vol);
    if (!out) return;
    const p = 0.85 + Math.random() * 0.3;
    const len = m.len * (kind === 'break' ? 1.4 : kind === 'step' ? 0.7 : 1);
    if (m.grain) {
      for (let i = 0; i < 4; i++) this.noiseHit(out, { type: m.type, f: m.f * p * (0.8 + Math.random() * 0.4), q: m.q, len: len * 0.5, gain: m.gain, t: i * 0.025 });
    } else this.noiseHit(out, { type: m.type, f: m.f * p, q: m.q, len, gain: m.gain, attack: m.soft ? 0.02 : 0.002 });
    if (m.body && kind !== 'step') this.tone(out, { freq: m.body * p, len: len * 0.8, gain: 0.35, to: m.body * p * 0.7 });
    if (m.ring) this.tone(out, { freq: 1300 * p, len: 0.3, gain: 0.08 });
    if (material === 'glass' && kind === 'break') {
      for (let i = 0; i < 6; i++) this.tone(out, { freq: 2200 + Math.random() * 3200, len: 0.15 + Math.random() * 0.2, gain: 0.08, t: Math.random() * 0.12 });
      this.noiseHit(out, { type: 'highpass', f: 4000, q: 0.5, len: 0.3, gain: 0.4 });
    }
  }

  play(name, opts = {}) {
    if (!this.ctx) return;
    const p = opts.pitch || 1;
    const S = (vol) => this.spatial(opts, vol);
    let o;
    switch (name) {
      case 'click':
        o = S(0.5); if (!o) return;
        this.tone(o, { freq: 900, type: 'square', len: 0.05, gain: 0.12, to: 600 });
        this.noiseHit(o, { type: 'bandpass', f: 3000, q: 2, len: 0.03, gain: 0.2 });
        break;
      case 'pop':
        o = S(0.5); if (!o) return;
        if (!this.throttle('pop', 40)) return;
        this.tone(o, { freq: 520 * p, len: 0.09, gain: 0.25, to: 1250 * p });
        break;
      case 'hurt':
        o = S(0.8); if (!o) return;
        this.tone(o, { freq: 230, type: 'sawtooth', len: 0.18, gain: 0.18, to: 120 });
        this.noiseHit(o, { type: 'lowpass', f: 900, q: 1, len: 0.12, gain: 0.25 });
        break;
      case 'eat':
        o = S(0.6); if (!o) return;
        for (let i = 0; i < 3; i++) this.noiseHit(o, { type: 'bandpass', f: 1400 + Math.random() * 1200, q: 1.5, len: 0.05, gain: 0.35, t: i * 0.035 });
        break;
      case 'drink':
        o = S(0.6); if (!o) return;
        this.tone(o, { freq: 300, len: 0.12, gain: 0.2, to: 500 });
        break;
      case 'burp':
        o = S(0.6); if (!o) return;
        this.tone(o, { freq: 110, type: 'sawtooth', len: 0.3, gain: 0.12, to: 80, vibrato: 25 });
        break;
      case 'levelup':
        o = S(0.6); if (!o) return;
        [523, 659, 784, 1047].forEach((f, i) => this.tone(o, { freq: f, len: 0.35, gain: 0.15, t: i * 0.08 }));
        break;
      case 'orb':
        o = S(0.35); if (!o) return;
        if (!this.throttle('orb', 30)) return;
        this.tone(o, { freq: 1046 * p, len: 0.18, gain: 0.15 });
        this.tone(o, { freq: 1568 * p, len: 0.14, gain: 0.06 });
        break;
      case 'ding':
        o = S(0.4); if (!o) return;
        this.tone(o, { freq: 1760, len: 0.2, gain: 0.1 });
        break;
      case 'break_tool':
        o = S(0.8); if (!o) return;
        this.noiseHit(o, { type: 'highpass', f: 2000, q: 0.7, len: 0.25, gain: 0.5 });
        this.tone(o, { freq: 800, type: 'square', len: 0.2, gain: 0.06, to: 300 });
        break;
      case 'equip':
        o = S(0.6); if (!o) return;
        this.noiseHit(o, { type: 'bandpass', f: 2200, q: 2, len: 0.12, gain: 0.3 });
        this.tone(o, { freq: 700, len: 0.12, gain: 0.08, to: 900 });
        break;
      case 'door_open':
      case 'door_close':
        o = S(0.7); if (!o) return;
        this.noiseHit(o, { type: 'bandpass', f: name === 'door_open' ? 700 : 450, q: 3, len: 0.18, gain: 0.5 });
        this.tone(o, { freq: name === 'door_open' ? 220 : 150, type: 'triangle', len: 0.14, gain: 0.3, to: 110 });
        break;
      case 'chest_open':
      case 'chest_close':
        o = S(0.6); if (!o) return;
        this.tone(o, { freq: 160, type: 'sawtooth', len: 0.35, gain: 0.06, to: name === 'chest_open' ? 260 : 120, vibrato: 18 });
        this.noiseHit(o, { type: 'bandpass', f: 600, q: 2, len: 0.2, gain: 0.3 });
        break;
      case 'splash':
        o = S(0.8); if (!o) return;
        this.noiseHit(o, { type: 'lowpass', f: 1600, q: 0.6, len: 0.5, gain: 0.6, attack: 0.01 });
        this.noiseHit(o, { type: 'bandpass', f: 400, q: 1, len: 0.3, gain: 0.3 });
        break;
      case 'swim':
        o = S(0.25); if (!o) return;
        this.noiseHit(o, { type: 'lowpass', f: 900, q: 0.5, len: 0.3, gain: 0.4, attack: 0.05 });
        break;
      case 'fizz':
        o = S(0.6); if (!o) return;
        this.noiseHit(o, { type: 'highpass', f: 3500, q: 0.5, len: 0.6, gain: 0.35, attack: 0.01 });
        break;
      case 'ignite':
        o = S(0.6); if (!o) return;
        this.noiseHit(o, { type: 'bandpass', f: 2500, q: 1, len: 0.15, gain: 0.5 });
        this.tone(o, { freq: 1800, type: 'square', len: 0.04, gain: 0.05 });
        break;
      case 'fuse':
        o = S(0.8); if (!o) return;
        this.noiseHit(o, { type: 'highpass', f: 3000, q: 0.5, len: 1.2, gain: 0.3, attack: 0.05 });
        break;
      case 'explode':
        o = S(1.4);
        if (!o) return;
        this.noiseHit(o, { type: 'lowpass', f: 600, q: 0.7, len: 1.6, gain: 1, attack: 0.005 });
        this.noiseHit(o, { type: 'lowpass', f: 2400, q: 0.5, len: 0.5, gain: 0.5 });
        this.tone(o, { freq: 70, len: 0.9, gain: 0.6, to: 30 });
        break;
      case 'bow':
        o = S(0.7); if (!o) return;
        this.tone(o, { freq: 420, type: 'triangle', len: 0.18, gain: 0.25, to: 180 });
        this.noiseHit(o, { type: 'highpass', f: 2500, q: 0.5, len: 0.12, gain: 0.25 });
        break;
      case 'arrow_hit':
        o = S(0.6); if (!o) return;
        this.noiseHit(o, { type: 'bandpass', f: 900, q: 2, len: 0.08, gain: 0.5 });
        this.tone(o, { freq: 200, len: 0.08, gain: 0.25, to: 120 });
        break;
      case 'throw':
        o = S(0.5); if (!o) return;
        this.noiseHit(o, { type: 'bandpass', f: 1200, q: 1, len: 0.15, gain: 0.3, attack: 0.05 });
        break;
      case 'shear':
        o = S(0.6); if (!o) return;
        this.noiseHit(o, { type: 'highpass', f: 3500, q: 1, len: 0.08, gain: 0.4 });
        this.noiseHit(o, { type: 'highpass', f: 3800, q: 1, len: 0.08, gain: 0.4, t: 0.1 });
        break;
      case 'milk':
      case 'bucket_fill':
      case 'bucket_empty':
        o = S(0.6); if (!o) return;
        this.noiseHit(o, { type: 'lowpass', f: 1200, q: 1, len: 0.35, gain: 0.45, attack: 0.02 });
        this.tone(o, { freq: name === 'bucket_empty' ? 500 : 300, len: 0.25, gain: 0.1, to: name === 'bucket_empty' ? 250 : 600 });
        break;
      case 'bucket_fill_lava':
      case 'bucket_empty_lava':
        o = S(0.6); if (!o) return;
        this.noiseHit(o, { type: 'lowpass', f: 500, q: 1, len: 0.45, gain: 0.5, attack: 0.03 });
        break;
      case 'chicken_plop':
        o = S(0.5); if (!o) return;
        this.tone(o, { freq: 300, len: 0.08, gain: 0.25, to: 180 });
        break;
      // ---- creatures (original synthesized voices)
      case 'pig_say': case 'pig_hurt': case 'pig_death': {
        o = S(0.6); if (!o) return;
        const hurt = name !== 'pig_say';
        const base = (hurt ? 340 : 240) * p;
        for (let i = 0; i < (hurt ? 1 : 2); i++) this.creatureVoice(o, { freq: base * (1 + i * 0.08), formant: 900, len: 0.14, t: i * 0.18, gain: 0.35 });
        break;
      }
      case 'cow_say': case 'cow_hurt': case 'cow_death': {
        o = S(0.7); if (!o) return;
        const hurt = name !== 'cow_say';
        this.creatureVoice(o, { freq: (hurt ? 150 : 105) * p, to: (hurt ? 120 : 90) * p, formant: 520, len: hurt ? 0.35 : 0.9, gain: 0.4, vibrato: 5 });
        break;
      }
      case 'sheep_say': case 'sheep_hurt': case 'sheep_death': {
        o = S(0.6); if (!o) return;
        const hurt = name !== 'sheep_say';
        this.creatureVoice(o, { freq: (hurt ? 420 : 330) * p, formant: 1300, len: hurt ? 0.25 : 0.55, gain: 0.3, tremolo: 22 });
        break;
      }
      case 'chicken_say': case 'chicken_hurt': case 'chicken_death': {
        o = S(0.5); if (!o) return;
        const hurt = name !== 'chicken_say';
        const n = hurt ? 2 : 3;
        for (let i = 0; i < n; i++) this.tone(o, { freq: (hurt ? 1500 : 1000 + Math.random() * 300) * p, type: 'square', len: 0.06, gain: 0.08, to: 800 * p, t: i * 0.09 });
        break;
      }
      case 'zombie_say': case 'zombie_hurt': case 'zombie_death': {
        o = S(0.8); if (!o) return;
        const hurt = name !== 'zombie_say';
        this.creatureVoice(o, { freq: (hurt ? 130 : 85) * p, to: (hurt ? 90 : 70) * p, formant: 380, len: hurt ? 0.4 : 1.1, gain: 0.45, vibrato: 3 });
        this.noiseHit(o, { type: 'lowpass', f: 500, q: 1, len: hurt ? 0.3 : 0.9, gain: 0.25, attack: 0.1 });
        break;
      }
      case 'skeleton_say': case 'skeleton_hurt': case 'skeleton_death': {
        o = S(0.7); if (!o) return;
        const n = name === 'skeleton_death' ? 10 : 5;
        for (let i = 0; i < n; i++) this.noiseHit(o, { type: 'bandpass', f: 2500 + Math.random() * 1500, q: 4, len: 0.04, gain: 0.5, t: i * 0.05 + Math.random() * 0.02 });
        break;
      }
      case 'spider_say': case 'spider_hurt': case 'spider_death': {
        o = S(0.7); if (!o) return;
        const hurt = name !== 'spider_say';
        this.noiseHit(o, { type: 'highpass', f: hurt ? 2500 : 3500, q: 0.8, len: hurt ? 0.25 : 0.45, gain: 0.35, attack: 0.03 });
        this.tone(o, { freq: 90, type: 'sawtooth', len: 0.3, gain: 0.08, vibrato: 30 });
        break;
      }
      case 'cave': {
        o = S(0.5); if (!o) return;
        const f = 55 + Math.random() * 40;
        this.tone(o, { freq: f, type: 'triangle', len: 4, gain: 0.25, attack: 1.2, to: f * (Math.random() < 0.5 ? 0.8 : 1.25), vibrato: 0.6 });
        this.noiseHit(o, { type: 'bandpass', f: 300 + Math.random() * 300, q: 6, len: 3, gain: 0.25, attack: 1 });
        break;
      }
      default:
        break;
    }
  }

  creatureVoice(out, { freq, to = null, formant, len, gain, t = 0, vibrato = 0, tremolo = 0 }) {
    const ctx = this.ctx;
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq, now);
    if (to) o.frequency.exponentialRampToValueAtTime(to, now + len);
    if (vibrato) {
      const l = ctx.createOscillator();
      const lg = ctx.createGain();
      l.frequency.value = vibrato;
      lg.gain.value = freq * 0.03;
      l.connect(lg);
      lg.connect(o.frequency);
      l.start(now);
      l.stop(now + len + 0.1);
    }
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = formant;
    f1.Q.value = 2.5;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.value = formant * 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gain, now + Math.min(0.05, len / 4));
    g.gain.setValueAtTime(gain, now + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, now + len);
    if (tremolo) {
      const l = ctx.createOscillator();
      const lg = ctx.createGain();
      l.frequency.value = tremolo;
      lg.gain.value = gain * 0.6;
      l.connect(lg);
      lg.connect(g.gain);
      l.start(now);
      l.stop(now + len + 0.1);
    }
    o.connect(f1);
    f1.connect(f2);
    f2.connect(g);
    g.connect(out);
    o.start(now);
    o.stop(now + len + 0.1);
  }

  setRain(level) {
    if (!this.ctx) return;
    this.rainGain.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 0.5);
  }

  // ---------------------------------------------------------------- music
  musicTick(mode) {
    if (!this.ctx || this.volumes.music <= 0) return;
    const now = this.ctx.currentTime;
    if (mode !== this.music.mode) {
      this.music.mode = mode;
      if (!this.music.playing) this.music.nextAt = now + (mode === 'title' ? 1 : 30 + Math.random() * 60);
    }
    if (this.music.playing) {
      if (now > this.music.endAt) {
        this.music.playing = false;
        this.music.nextAt = now + (mode === 'title' ? 8 : 180 + Math.random() * 240);
      }
      return;
    }
    if (!this.music.nextAt) this.music.nextAt = now + (mode === 'title' ? 1 : 40);
    if (now >= this.music.nextAt) this.playPiece(mode);
  }

  playPiece(mode) {
    const ctx = this.ctx;
    const r = Math.random;
    const scales = {
      major: [0, 2, 4, 5, 7, 9, 11],
      minor: [0, 2, 3, 5, 7, 8, 10],
      lydian: [0, 2, 4, 6, 7, 9, 11],
      dorian: [0, 2, 3, 5, 7, 9, 10],
    };
    const names = mode === 'title' ? ['major', 'lydian'] : ['major', 'minor', 'lydian', 'dorian'];
    const scale = scales[names[Math.floor(r() * names.length)]];
    const root = 50 + Math.floor(r() * 8);
    const bpm = 58 + Math.floor(r() * 22);
    const beat = 60 / bpm;
    const bars = 14 + Math.floor(r() * 10);
    const start = ctx.currentTime + 0.3;
    const deg = (d) => root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    // Chord progression as scale degrees
    const prog = [0];
    const moves = [3, 4, 5, 1, 2];
    for (let i = 1; i < bars; i++) prog.push(i === bars - 1 ? 0 : moves[Math.floor(r() * moves.length)]);
    let melody = 7 + Math.floor(r() * 3);
    let t = start;
    for (let b = 0; b < bars; b++) {
      const c = prog[b];
      // left hand: gentle broken chord
      const chord = [deg(c - 7), deg(c - 3), deg(c), deg(c + 2)];
      const pattern = r() < 0.5 ? [0, 1, 2, 1] : [0, 2, 1, 3];
      pattern.forEach((pi, k) => this.pianoNote(chord[pi], t + k * beat, beat * 3, 0.1));
      // right hand: random walk near chord tones, with rests
      let pos = 0;
      while (pos < 4) {
        const durs = [1, 1, 2, 0.5, 1.5];
        let d = durs[Math.floor(r() * durs.length)];
        if (pos + d > 4) d = 4 - pos;
        if (r() < 0.78) {
          const step = [-2, -1, -1, 0, 1, 1, 2, 3][Math.floor(r() * 8)];
          melody = Math.max(5, Math.min(14, melody + step));
          if (pos === 0 && r() < 0.6) melody = c + 7 + [0, 2, 4][Math.floor(r() * 3)];
          this.pianoNote(deg(melody), t + pos * beat, d * beat * 2.2, 0.14);
        }
        pos += d;
      }
      t += 4 * beat;
    }
    this.pianoNote(deg(0), t, beat * 8, 0.12);
    this.pianoNote(deg(-7), t, beat * 8, 0.09);
    this.music.playing = true;
    this.music.endAt = t + beat * 8;
  }

  pianoNote(midi, when, len, gain) {
    const ctx = this.ctx;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.008);
    g.gain.exponentialRampToValueAtTime(gain * 0.35, when + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, when + len);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    g.connect(lp);
    lp.connect(this.musicDry);
    lp.connect(this.reverb);
    for (const [h, a] of [[1, 1], [2, 0.35], [3, 0.12], [4, 0.05]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * h * (1 + (Math.random() - 0.5) * 0.002);
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og);
      og.connect(g);
      o.start(when);
      o.stop(when + len + 0.1);
    }
  }

  stopMusic() {
    this.music.playing = false;
    this.music.nextAt = 0;
  }
}
