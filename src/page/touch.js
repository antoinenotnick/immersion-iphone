/*
 * Touch gestures on the page's text:
 *  - rest two fingers on a paragraph to peek at it in your other language
 *  - select text to open the card with its translation and grammar tips
 */
import { blockOf, tidy, hasLetters } from './engine.js';
import { langName, sameLang } from '../core/shared.js';

const PEEK_DELAY_MS = 180;
const PEEK_SLOP_PX = 14; // more movement than this is a scroll or a pinch
const SELECTION_SETTLE_MS = 450;
const MAX_SELECTION = 1200;

export function setupTouch({ engine, ui, getSettings, explain, openSettings }) {
  const otherLabel = () => langName(engine.otherLang());

  // ---------------------------------------------------------------------------
  // Peek
  // ---------------------------------------------------------------------------

  let peek = null; // { start: [points], points, timer, shown, block, seq }
  let peekSeq = 0;

  const pointsOf = (touches) => [...touches].slice(0, 2).map((t) => ({ x: t.clientX, y: t.clientY }));
  const middle = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const moved = (a, b) => a.some((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) > PEEK_SLOP_PX);

  function caretNode(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y)?.startContainer;
    return document.caretPositionFromPoint?.(x, y)?.offsetNode;
  }

  /** The text node at a point, if the point is really on (or very near) its text. */
  function textAt({ x, y }) {
    const node = caretNode(x, y);
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const slop = 8;
    for (const r of range.getClientRects()) {
      if (x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop) return node;
    }
    return null;
  }

  /** The paragraph under two fingers: between them if there is one there, otherwise under either finger. */
  function blockAt(points) {
    for (const point of [middle(points), ...points]) {
      const node = textAt(point);
      const block = node && blockOf(node);
      if (block && block !== document.body) return block;
    }
    return null;
  }

  async function showPeek() {
    const block = blockAt(peek.points);
    if (!block || block === peek.block) return;
    peek.block = block;
    const seq = ++peekSeq;
    const lang = engine.otherLang();
    const label = otherLabel();
    ui.showPeek(block.getBoundingClientRect(), { label, loading: true });
    try {
      const text = await engine.textOf(block, lang);
      if (seq !== peekSeq) return;
      if (text) ui.showPeek(block.getBoundingClientRect(), { label, text, lang });
      else ui.hidePeek();
    } catch (err) {
      if (seq === peekSeq) ui.showPeek(block.getBoundingClientRect(), { label, error: err.message });
    }
  }

  function endPeek() {
    clearTimeout(peek?.timer);
    peek = null;
    peekSeq++;
    ui.hidePeek();
  }

  function onTouchStart(e) {
    touching = e.touches.length;
    if (touching === 1) tap = { ...pointsOf(e.touches)[0], at: e.timeStamp, owned: ui.owns(e) };
    else tap = null;
    if (peek) endPeek();
    if (touching !== 2 || engine.mode() === 'off' || ui.owns(e) || ui.isMenuOpen()) return;
    block(true);
    const points = pointsOf(e.touches);
    peek = { start: points, points, shown: false, block: null };
    peek.timer = setTimeout(() => {
      if (!peek) return;
      peek.shown = true;
      showPeek();
    }, PEEK_DELAY_MS);
  }

  function onTouchMove(e) {
    if (!peek || e.touches.length !== 2) return;
    const points = pointsOf(e.touches);
    if (!peek.shown) {
      if (moved(points, peek.start)) endPeek(); // scrolling or pinching
      return;
    }
    peek.points = points;
    showPeek(); // slide the fingers to another paragraph
  }

  function onTouchEnd(e) {
    touching = e.touches.length;
    if (peek) {
      // Lifting after a peek must not count as a tap (Safari opens links tapped with two fingers).
      if (peek.shown) swallowUntil = e.timeStamp + 400;
      endPeek();
    } else if (e.type === 'touchend' && tap && !touching) {
      const end = e.changedTouches[0];
      const still = Math.hypot(end.clientX - tap.x, end.clientY - tap.y) < 10;
      if (still && !tap.owned && e.timeStamp - tap.at < 350) ui.closeCard(); // a tap outside closes the card
    }
    if (!touching) {
      tap = null;
      setTimeout(() => !touching && block(false), 0);
    }
  }

  /**
   * Cancelable listeners make Safari wait for this script before it scrolls, so they're only
   * attached while two fingers are down.
   */
  function block(on) {
    const change = on ? addEventListener : removeEventListener;
    for (const type of ['touchmove', 'touchend', 'touchcancel', 'gesturestart', 'gesturechange']) {
      change.call(window, type, cancelDuringPeek, { capture: true, passive: false });
    }
  }

  function cancelDuringPeek(e) {
    if ((peek?.shown || e.timeStamp < swallowUntil) && e.cancelable) e.preventDefault();
  }

  function onScroll() {
    if (peek?.shown && peek.block) ui.movePeek(peek.block.getBoundingClientRect());
  }

  // ---------------------------------------------------------------------------
  // Selection card
  // ---------------------------------------------------------------------------

  let touching = 0;
  let tap = null;
  let swallowUntil = 0;
  let selectionTimer = 0;
  let cardText = '';
  let cardSeq = 0;

  const isEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ''));

  function contextFor(range, text) {
    const block = blockOf(range.commonAncestorContainer);
    if (!block) return '';
    const full = tidy(block.innerText || block.textContent || '');
    if (full.length <= 1200) return full;
    const at = Math.max(0, full.indexOf(text));
    return full.slice(Math.max(0, at - 500), at + text.length + 500);
  }

  function selectionInfo() {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const text = tidy(selection.toString());
    if (!text || text.length > MAX_SELECTION || !hasLetters(text)) return null;
    if (isEditable(document.activeElement)) return null;
    const range = selection.getRangeAt(0).cloneRange();
    const base = range.commonAncestorContainer;
    const el = base.nodeType === Node.ELEMENT_NODE ? base : base.parentElement;
    if (!el || el.closest('immersion-ui, input, textarea, [contenteditable]:not([contenteditable="false"])')) return null;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { text, rect, context: contextFor(range, text) };
  }

  function openCard({ text, rect, context }) {
    const seq = ++cardSeq;
    cardText = text;
    const toLang = engine.otherLang();
    const { target } = getSettings();
    const learning = engine.mode() === 'target'; // is the selected text in the language being learned?
    const translation = engine.translateTexts([text], toLang).then(([r]) => (sameLang(r.from, toLang) ? text : r.text));

    ui.openCard({
      rect,
      label: langName(toLang),
      lang: toLang,
      onSettings: () => {
        ui.closeCard();
        openSettings();
      },
      onGrammar: async () => {
        ui.setCardGrammar({ loading: true });
        try {
          // Grammar tips are always about the language you're learning.
          const sentence = learning ? text : await translation;
          const result = await explain({ text: sentence, context: learning ? context : '' });
          if (seq === cardSeq) ui.setCardGrammar({ sentence, lang: target, ...result });
        } catch (err) {
          if (seq === cardSeq) ui.setCardGrammar({ error: err.message, needsKey: err.code === 'NO_KEY' });
        }
      },
    });
    translation.then(
      (result) => seq === cardSeq && ui.setCardTranslation({ text: result }),
      (err) => seq === cardSeq && ui.setCardTranslation({ error: err.message }),
    );
  }

  /** Wait until the selection has stopped changing and the finger is up. */
  function onSelectionChange() {
    clearTimeout(selectionTimer);
    if (engine.mode() === 'off' || !getSettings().selectPopup) return;
    selectionTimer = setTimeout(() => {
      if (touching) return onSelectionChange();
      if (ui.isMenuOpen()) return;
      const info = selectionInfo();
      if (info && !(ui.isCardOpen() && info.text === cardText)) openCard(info);
    }, SELECTION_SETTLE_MS);
  }

  const passive = { capture: true, passive: true };
  addEventListener('touchstart', onTouchStart, passive);
  for (const type of ['touchend', 'touchcancel']) addEventListener(type, onTouchEnd, passive);
  addEventListener('touchmove', onTouchMove, passive);
  addEventListener('scroll', onScroll, passive);
  addEventListener('blur', (e) => e.target === window && endPeek(), true);
  document.addEventListener('selectionchange', onSelectionChange);

  return {
    /** Close anything that shows text in the previous language. */
    reset() {
      endPeek();
      ui.closeCard();
      cardSeq++;
    },
  };
}
