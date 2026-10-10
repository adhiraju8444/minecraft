const KEY = 'blockforge.settings.v1';

export const DEFAULT_SETTINGS = {
  renderDist: 8,
  fov: 70,
  sensitivity: 100,
  invertY: false,
  viewBob: true,
  clouds: true,
  gamma: 0.5,
  guiScale: 0,
  master: 80,
  music: 45,
  sound: 90,
  showFps: false,
  pixelRatio: 1,
  name: 'Player',
  touch: 'auto',
  keys: {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
    inventory: 'KeyE', drop: 'KeyQ', chat: 'KeyT', command: 'Slash', perspective: 'F5', debug: 'F3', hideHud: 'F1', screenshot: 'F2',
  },
};

export function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    s = {};
  }
  const out = { ...DEFAULT_SETTINGS, ...s, keys: { ...DEFAULT_SETTINGS.keys, ...(s.keys || {}) } };
  return out;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage blocked: settings last for this session only
  }
}

export const KEY_LABELS = {
  forward: 'Walk Forward', back: 'Walk Backward', left: 'Strafe Left', right: 'Strafe Right', jump: 'Jump / Swim Up / Fly Up', sneak: 'Sneak / Fly Down',
  sprint: 'Sprint', inventory: 'Inventory', drop: 'Drop Item', chat: 'Open Chat', command: 'Open Command', perspective: 'Change Camera View',
  debug: 'Debug Screen', hideHud: 'Hide HUD', screenshot: 'Screenshot',
};

export function keyName(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = { ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', Space: 'Space', Slash: '/', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter' };
  return map[code] || code;
}
