/*
 * On-page UI: the floating button, the peek bubble, the selection card, the menu sheet and a toast.
 * Everything lives in a closed shadow root so page styles can't leak in (or out).
 * This file only draws; other files decide what to show.
 */
import { CSS, COLORS } from './styles.js';

/** Tiny DOM builder. Children are text or nodes; text is never parsed as HTML. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'color') el.style.setProperty('--c', value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

export const skeleton = (lines) => h('div', { class: 'skeleton' }, Array.from({ length: lines }, () => h('i')));
const colorOf = (i) => COLORS[i % COLORS.length];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// Keeps the page from reacting to taps inside our UI ("tap outside to close" handlers, focus traps...).
const SHIELDED = [
  'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup',
  'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress', 'input', 'change', 'focusin', 'focusout', 'wheel',
];

export function createUI() {
  const host = document.createElement('immersion-ui');
  host.setAttribute('translate', 'no');
  host.style.cssText =
    'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; ' +
    'width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;';
  for (const type of SHIELDED) host.addEventListener(type, (e) => e.stopPropagation());
  const shadow = host.attachShadow({ mode: 'closed' });
  try {
    const sheet = new CSSStyleSheet(); // allowed even where the page's CSP forbids <style>
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    shadow.append(h('style', {}, CSS));
  }

  const hlEl = h('div', { class: 'layer hl' });
  const peekEl = h('div', { class: 'layer peek', role: 'tooltip' });
  const pillEl = h('button', { class: 'layer pill', type: 'button' });
  const cardEl = h('div', { class: 'layer sheet card bottom', role: 'dialog', 'aria-label': 'Translation' });
  const backdropEl = h('div', { class: 'layer backdrop' });
  const menuEl = h('div', { class: 'layer sheet menu bottom', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Immersion' });
  const toastEl = h('div', { class: 'layer toast', role: 'status' });
  shadow.append(h('div', { class: 'root' }, hlEl, peekEl, pillEl, cardEl, backdropEl, menuEl, toastEl));

  // Some sites rebuild <html> while loading: put our UI back, but don't fight a page that keeps removing it.
  let remounts = 0;
  const mount = () => document.documentElement.append(host);
  new MutationObserver(() => {
    if (!host.isConnected && remounts++ < 20) mount();
  }).observe(document.documentElement, { childList: true });
  mount();

  // ---------- Peek ----------

  function showPeek(rect, { label, text, loading, error, lang }) {
    peekEl.replaceChildren(
      h('div', { class: 'label' }, label),
      loading ? skeleton(2) : h('div', { class: error ? 'text error' : 'text', lang: error ? null : lang, dir: 'auto' }, error || text),
    );
    peekEl.classList.add('show');
    hlEl.classList.add('show');
    movePeek(rect);
  }

  function movePeek(rect) {
    const pad = 3;
    Object.assign(hlEl.style, {
      left: `${rect.left - pad}px`,
      top: `${rect.top - pad}px`,
      width: `${rect.width + pad * 2}px`,
      height: `${rect.height + pad * 2}px`,
    });
    // Above the paragraph so fingers don't cover it; pinned to the top if there's no room.
    const margin = 8;
    peekEl.style.left = `${clamp(rect.left, margin, Math.max(margin, innerWidth - peekEl.offsetWidth - margin))}px`;
    peekEl.style.top = `${Math.max(margin, rect.top - 10 - peekEl.offsetHeight)}px`;
  }

  function hidePeek() {
    peekEl.classList.remove('show');
    hlEl.classList.remove('show');
  }

  // ---------- Sheets ----------

  const closeButton = (onclick) => h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick }, '×');

  /** Let a sheet be flicked away by its header. */
  function swipeToClose(head, el, close) {
    let startY = null;
    head.addEventListener('touchstart', (e) => (startY = e.touches[0].clientY), { passive: true });
    head.addEventListener(
      'touchmove',
      (e) => {
        if (startY == null) return;
        const away = el.classList.contains('top') ? -1 : 1;
        const distance = (e.touches[0].clientY - startY) * away;
        el.style.transform = distance > 0 ? `translateY(${distance * away}px)` : '';
      },
      { passive: true },
    );
    const end = (e) => {
      if (startY == null) return;
      const distance = (e.changedTouches[0].clientY - startY) * (el.classList.contains('top') ? -1 : 1);
      startY = null;
      el.style.transform = '';
      if (e.type === 'touchend' && distance > 50) close();
    };
    head.addEventListener('touchend', end);
    head.addEventListener('touchcancel', end);
  }

  // ---------- Selection card ----------

  let card = null; // { translation, grammar, onSettings }

  function openCard({ rect, label, lang, onGrammar, onSettings }) {
    const translation = h('div', { class: 'translation', lang, dir: 'auto' }, skeleton(2));
    const grammar = h('button', { class: 'btn', type: 'button', onclick: onGrammar }, '✦ Grammar tips');
    const head = h('div', { class: 'head' }, h('div', { class: 'label' }, label), closeButton(closeCard));
    const reopening = !!card;
    // Stay clear of the selected text: go to the top when it's in the lower part of the screen.
    if (!reopening) {
      const top = rect.top + rect.height / 2 > innerHeight * 0.55;
      cardEl.classList.toggle('top', top);
      cardEl.classList.toggle('bottom', !top);
    }
    swipeToClose(head, cardEl, closeCard);
    cardEl.replaceChildren(head, h('div', { class: 'scroll' }, translation, grammar));
    card = { translation, grammar, onSettings };
    cardEl.classList.add('show');
  }

  function setCardTranslation({ text, error }) {
    card?.translation.replaceChildren(error ? h('p', { class: 'error' }, error) : text);
  }

  function setCardGrammar({ loading, error, needsKey, sentence, lang, points = [], vocabulary = [] }) {
    if (!card) return;
    const { onSettings } = card;
    let content;
    if (loading) {
      content = [h('div', { class: 'label' }, 'Grammar'), skeleton(4)];
    } else if (error) {
      content = [h('p', { class: 'error' }, error), needsKey && h('button', { class: 'btn', type: 'button', onclick: onSettings }, 'Open settings')];
    } else {
      content = renderGrammar(sentence, lang, points, vocabulary);
    }
    const section = h('div', { class: 'grammar' }, content);
    card.grammar.replaceWith(section);
    card.grammar = section;
  }

  function closeCard() {
    card = null;
    cardEl.classList.remove('show');
  }

  // ---------- Menu ----------

  let menuOpenedAt = 0;
  let onMenuClose = null;

  /** Show `content` in the menu sheet. `onBack` adds a back button; `onClose` runs when it's dismissed. */
  function openMenu({ title, content, onBack, onClose }) {
    const wasOpen = isMenuOpen();
    const scrollTop = wasOpen ? menuEl.querySelector('.scroll')?.scrollTop : 0;
    const sameView = menuEl.dataset.title === title;
    const head = h(
      'div',
      { class: 'head' },
      onBack && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: onBack }, '‹'),
      h('div', { class: 'title' }, title),
      closeButton(closeMenu),
    );
    swipeToClose(head, menuEl, closeMenu);
    menuEl.replaceChildren(head, h('div', { class: 'scroll' }, content));
    menuEl.dataset.title = title;
    onMenuClose = onClose || null;
    if (wasOpen && sameView) menuEl.querySelector('.scroll').scrollTop = scrollTop;
    if (!wasOpen) {
      menuOpenedAt = performance.now();
      menuEl.classList.add('show');
      backdropEl.classList.add('show');
    }
  }

  const isMenuOpen = () => menuEl.classList.contains('show');

  function closeMenu() {
    if (!isMenuOpen()) return;
    menuEl.classList.remove('show');
    backdropEl.classList.remove('show');
    const callback = onMenuClose;
    onMenuClose = null;
    callback?.();
  }

  backdropEl.addEventListener('click', () => {
    if (performance.now() - menuOpenedAt > 400) closeMenu(); // not the tail of the long press that opened it
  });
  backdropEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // ---------- Toast ----------

  let toastTimer = 0;
  function toast(text, ms = 1600) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  return {
    pillEl,
    showPeek,
    movePeek,
    hidePeek,
    openCard,
    setCardTranslation,
    setCardGrammar,
    closeCard,
    isCardOpen: () => !!card,
    openMenu,
    closeMenu,
    isMenuOpen,
    toast,
    owns: (event) => event.composedPath().includes(host),
  };
}

function renderGrammar(sentence, lang, points, vocabulary) {
  const out = [
    h('div', {}, h('div', { class: 'label' }, 'Grammar'), h('p', { class: 'sentence', lang, dir: 'auto' }, highlight(sentence, points))),
  ];
  if (points.length) {
    out.push(
      h(
        'ol',
        { class: 'points' },
        points.map((p, i) =>
          h(
            'li',
            { class: 'point', color: colorOf(i) },
            h('span', { class: 'num' }, String(i + 1)),
            h(
              'div',
              {},
              h('div', { class: 'point-title' }, String(p.title), p.snippet && h('span', { class: 'snippet', lang }, String(p.snippet))),
              h('p', {}, String(p.explanation ?? '')),
            ),
          ),
        ),
      ),
    );
  } else {
    out.push(h('p', { class: 'muted' }, 'Nothing special to note here.'));
  }
  if (vocabulary.length) {
    out.push(
      h(
        'div',
        {},
        h('div', { class: 'label' }, 'Vocabulary'),
        h('dl', { class: 'vocab' }, vocabulary.map((v) => [h('dt', { lang }, String(v.term)), h('dd', {}, String(v.meaning ?? ''))])),
      ),
    );
  }
  return out;
}

/** Wrap each point's snippet in a numbered, colored <mark>. */
function highlight(sentence, points) {
  const lower = sentence.toLowerCase();
  const marks = [];
  points.forEach((p, i) => {
    const snippet = String(p.snippet || '').trim().toLowerCase();
    if (!snippet) return;
    let at = lower.indexOf(snippet);
    while (at >= 0 && marks.some((m) => at < m.end && at + snippet.length > m.start)) at = lower.indexOf(snippet, at + 1);
    if (at >= 0) marks.push({ start: at, end: at + snippet.length, i });
  });
  marks.sort((a, b) => a.start - b.start);
  const parts = [];
  let pos = 0;
  for (const m of marks) {
    parts.push(sentence.slice(pos, m.start));
    parts.push(h('mark', { color: colorOf(m.i) }, sentence.slice(m.start, m.end)));
    parts.push(h('sup', { color: colorOf(m.i) }, String(m.i + 1)));
    pos = m.end;
  }
  parts.push(sentence.slice(pos));
  return parts;
}
