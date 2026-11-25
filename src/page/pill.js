// The floating button. Tap: switch language. Hold: menu. Drag: move it out of the way.

const SIZE = 48;
const EDGE = 12;
const LONG_PRESS_MS = 450;
const DRAG_PX = 10;

export function createPill(el, { position, onTap, onLongPress, onMove }) {
  let pos = { ...position };
  let press = null; // { id, x, y, dx, dy, timer, dragging, long }
  let sleepTimer = 0;

  const maxTop = () => Math.max(EDGE, innerHeight - SIZE - EDGE);
  const clampTop = (top) => Math.max(EDGE, Math.min(top, maxTop()));

  function layout() {
    if (press?.dragging) return;
    el.style.top = `${clampTop(pos.y * innerHeight - SIZE / 2)}px`;
    el.style.left = `${pos.side === 'left' ? EDGE : document.documentElement.clientWidth - SIZE - EDGE}px`;
  }

  /** Fully visible for a moment, then it fades so it doesn't get in the way of reading. */
  function wake(ms = 2200) {
    el.classList.add('awake');
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => el.classList.remove('awake'), ms);
  }

  function update({ mode, lang, label, busy, error }) {
    el.classList.toggle('target', mode === 'target');
    el.classList.toggle('off', mode === 'off');
    el.classList.toggle('busy', busy && mode !== 'off');
    el.classList.toggle('failed', !!error && mode !== 'off');
    el.textContent = mode === 'off' ? '⏸︎' : lang.slice(0, 2).toUpperCase();
    el.setAttribute('aria-label', label);
  }

  function release() {
    clearTimeout(press?.timer);
    press = null;
    el.classList.remove('pressed');
  }

  el.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    const box = el.getBoundingClientRect();
    wake();
    el.classList.add('pressed');
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: e.clientX - box.left, dy: e.clientY - box.top, dragging: false, long: false };
    press.timer = setTimeout(() => {
      if (!press || press.dragging) return;
      press.long = true;
      el.classList.remove('pressed');
      onLongPress();
    }, LONG_PRESS_MS);
  });

  el.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id || press.long) return;
    if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) return;
    press.dragging = true;
    clearTimeout(press.timer);
    wake();
    el.style.left = `${e.clientX - press.dx}px`;
    el.style.top = `${clampTop(e.clientY - press.dy)}px`;
  });

  el.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const { dragging, long } = press;
    release();
    if (dragging) {
      const box = el.getBoundingClientRect();
      pos = { side: box.left + SIZE / 2 < innerWidth / 2 ? 'left' : 'right', y: (box.top + SIZE / 2) / innerHeight };
      layout();
      onMove(pos);
    } else if (!long) {
      onTap();
    }
  });

  el.addEventListener('pointercancel', () => {
    release();
    layout();
  });
  // Pointer events do the work; stop iOS from also selecting text or showing a callout.
  for (const type of ['touchstart', 'touchend', 'contextmenu']) {
    el.addEventListener(type, (e) => e.cancelable && e.preventDefault(), { passive: false });
  }
  // Keyboard and VoiceOver activation arrive as a click without a pointer press (detail 0).
  el.addEventListener('click', (e) => e.detail === 0 && onTap());

  addEventListener('resize', layout);
  layout();
  wake(4000);

  return {
    update,
    wake,
    setPosition(next) {
      pos = { ...next };
      layout();
    },
  };
}
