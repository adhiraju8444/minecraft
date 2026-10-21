// Fullscreen through the Fullscreen API (prefixed on older Safari). iPhones
// have no such API for web pages; there, Add to Home Screen opens the game
// as a full-screen app instead.
const root = () => document.documentElement;

export function canFullscreen() {
  return !!(root().requestFullscreen || root().webkitRequestFullscreen);
}

// Started from the home screen: already full screen, nothing to toggle.
export function isApp() {
  return !!(window.navigator.standalone || window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches);
}

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

export async function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    const el = root();
    await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
    // Phones play sideways. Only works in full screen, and not everywhere.
    if (window.matchMedia?.('(pointer: coarse)').matches) await screen.orientation?.lock?.('landscape').catch(() => {});
  } catch {
    /* refused (no user gesture, or blocked by the browser) */
  }
}

export function onFullscreenChange(fn) {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}
