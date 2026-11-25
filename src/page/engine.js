/*
 * Translates the page in place and switches it between two languages.
 *
 * Only text nodes are touched, never the page's markup, and text is translated lazily as it
 * scrolls into view. Sentences split across links or formatting are translated as a whole.
 * Each translated node remembers its original text, so switching back to your own language
 * is instant and needs no request. Ported from the Immersion browser extension.
 */
import { sameLang, normLang } from '../core/shared.js';

// Text inside these is never translated.
const SKIP = [
  'script', 'style', 'noscript', 'template', 'textarea', 'input', 'select', 'option', 'code', 'pre',
  'kbd', 'samp', 'var', 'svg', 'math', 'canvas', 'iframe', 'object', 'immersion-ui',
  '[contenteditable]:not([contenteditable="false"])', '[translate="no"]', '.notranslate',
  '[class*="material-icons"]', '[class*="material-symbols"]',
].join(',');
const LETTER = /\p{L}/u;
const URL_OR_EMAIL = /^\s*(?:(?:https?:\/\/|www\.)\S+|\S+@\S+\.\w+)\s*$/;
const MAX_NODE_CHARS = 5000;
const BATCH_TEXTS = 40;
const BATCH_CHARS = 4000;
const PARALLEL_REQUESTS = 3;

export const tidy = (s) => s.replace(/\s+/g, ' ').trim();
export const hasLetters = (s) => LETTER.test(s);

/** Nearest ancestor that isn't laid out inline: a paragraph, list item, heading, button... */
export function blockOf(node) {
  for (let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement; el; el = el.parentElement) {
    if (el === document.body) return el;
    const display = getComputedStyle(el).display;
    if (display !== 'inline' && display !== 'contents') return el;
  }
  return null;
}

/**
 * `translate(texts, to, from)` resolves to [{ text, from }].
 * `getSettings()` returns the current settings. `onState` hears about mode, progress and errors.
 */
export function createEngine({ translate, getSettings, onState, onError }) {
  let mode = 'off'; // 'off' | 'target' (immersed) | 'native'
  let pageLang = ''; // detected language of the page's own text ('' if unsure)
  let generation = 0; // bumped whenever what we display changes, so stale results are dropped
  let inFlight = 0;
  let lastError = '';
  let errorShownFor = -1;

  const records = new WeakMap(); // Text -> { orig, from, tr: { [lang]: text } }
  const produced = new Map(); // translation we wrote (trimmed) -> { orig, from, lang }, to recognize copies
  const waiting = new Map(); // Element -> Set<Text> waiting to scroll into view
  const queue = new Set(); // Text nodes ready to translate
  const dirty = new Set(); // nodes the page added or changed
  const timers = {};
  const originalHtmlLang = document.documentElement.getAttribute('lang');

  const io = new IntersectionObserver(onVisible, { rootMargin: '50% 0px' });
  const mo = new MutationObserver(onMutations);
  let watchedRoots = new WeakSet();
  let observing = false;
  let sawRemovals = false;

  const displayLang = () => (mode === 'target' ? getSettings().target : mode === 'native' ? getSettings().native : '');
  const otherLang = () => (mode === 'target' ? getSettings().native : getSettings().target);
  const state = () => ({ mode, pageLang, lang: displayLang(), busy: inFlight > 0, error: lastError });

  function schedule(name, fn, delay) {
    if (!timers[name]) timers[name] = setTimeout(() => ((timers[name] = 0), fn()), delay);
  }

  /** `from` is a source-language hint (the page's language); without it the service auto-detects. */
  async function translateTexts(texts, to, from = '') {
    if (!inFlight++) onState(state());
    try {
      return await translate(texts, to, from);
    } finally {
      if (!--inFlight) onState(state());
    }
  }

  // ---------------------------------------------------------------------------
  // Finding text
  // ---------------------------------------------------------------------------

  const worthTranslating = (text) =>
    !!text && text.length <= MAX_NODE_CHARS && LETTER.test(text) && text.trim().length > 1 && !URL_OR_EMAIL.test(text);

  /** Visit every text node under `root` that isn't inside a SKIP element, including open shadow roots. */
  function walk(root, visit) {
    const shadows = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node.matches(SKIP)) return NodeFilter.FILTER_REJECT;
        if (node.shadowRoot) shadows.push(node.shadowRoot);
        return NodeFilter.FILTER_SKIP;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) visit(node);
    for (const shadow of shadows) {
      watch(shadow);
      walk(shadow, visit);
    }
  }

  function scan(root) {
    if (!root?.isConnected) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement && !root.parentElement.closest(SKIP)) consider(root);
    } else if (root.nodeType === Node.ELEMENT_NODE && !root.closest(SKIP)) {
      walk(root, consider);
    }
  }

  const isOurs = (node, rec) => {
    const value = node.nodeValue;
    return value === rec.orig || Object.values(rec.tr).includes(value);
  };

  /** Show `rec` in `lang` if we already know that text. Returns false if it still needs translating. */
  function render(node, rec, lang) {
    const value = sameLang(rec.from, lang) ? rec.orig : rec.tr[lang];
    if (value == null) return false;
    if (node.nodeValue !== value) node.nodeValue = value;
    return true;
  }

  /** Decide what a text node needs: nothing, an instant swap, or a translation once it's visible. */
  function consider(node) {
    const lang = displayLang();
    if (!lang) return;
    let rec = records.get(node);
    if (rec && !isOurs(node, rec)) {
      records.delete(node); // the page replaced the text while we weren't looking
      rec = undefined;
    }
    if (!rec) {
      // The page copied text we translated into a new node (clones, sticky headers...): adopt its original.
      const copy = produced.get(node.nodeValue.trim());
      if (copy) {
        const [, lead, trail] = node.nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/);
        rec = { orig: lead + copy.orig + trail, from: copy.from, tr: { [copy.lang]: node.nodeValue } };
        records.set(node, rec);
      }
    }
    if (rec) {
      if (render(node, rec, lang)) return;
    } else if (!worthTranslating(node.nodeValue) || sameLang(pageLang, lang)) {
      return;
    }
    const el = node.parentElement;
    if (!el) return;
    let nodes = waiting.get(el);
    if (!nodes) {
      waiting.set(el, (nodes = new Set()));
      io.observe(el);
    }
    nodes.add(node);
  }

  function onVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.unobserve(entry.target);
      const nodes = waiting.get(entry.target);
      waiting.delete(entry.target);
      nodes?.forEach((node) => queue.add(node));
    }
    if (queue.size) schedule('flush', flush, 30);
  }

  // ---------------------------------------------------------------------------
  // Translating
  //
  // A sentence split across inline elements ("Read <a>the guide</a> first.") is sent as one
  // string with markers ("<x0>Read </x0><x1>the guide</x1><x2> first.</x2>") so it's translated
  // as a whole, then each marked piece goes back into its own text node. If the translator
  // doesn't keep the markers in order, that sentence is translated piece by piece instead.
  // ---------------------------------------------------------------------------

  const FROZEN_INLINE = 'code, kbd, samp, var, .notranslate, [translate="no"]';
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function decodeEntities(s) {
    return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, e) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? match;
      const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
  }

  /** A block's text nodes, grouped into runs of inline text (split at nested blocks and <br>). */
  function inlineRuns(block) {
    const runs = [[]];
    const breakRun = () => runs.at(-1).length && runs.push([]);
    const visit = (el) => {
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          runs.at(-1).push(child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === 'BR') {
            breakRun();
            continue;
          }
          const display = getComputedStyle(child).display;
          if (display !== 'inline' && display !== 'contents') {
            if (display !== 'none') breakRun();
          } else if (!child.matches(SKIP) || child.matches(FROZEN_INLINE)) {
            visit(child); // inline code stays in the sentence for context but is never rewritten
          }
        }
      }
    };
    visit(block);
    return runs.filter((run) => run.length);
  }

  function simpleJob(node) {
    const rec = records.get(node);
    const orig = rec && isOurs(node, rec) ? rec.orig : node.nodeValue;
    return { nodes: [node], pieces: [{ node, orig }], source: orig.trim(), marked: false };
  }

  /** What to send for a text node: the node alone, or its whole sentence when it's split across inline elements. */
  function jobsFor(node, runsCache) {
    const block = blockOf(node);
    if (!block) return [simpleJob(node)];
    if (!runsCache.has(block)) runsCache.set(block, inlineRuns(block));
    const run = runsCache.get(block).find((r) => r.includes(node));
    if (!run || run.length === 1) return [simpleJob(node)];

    const pieces = run.map((n) => {
      const rec = records.get(n);
      return {
        node: n,
        orig: rec && isOurs(n, rec) ? rec.orig : n.nodeValue,
        frozen: !!n.parentElement?.closest(SKIP),
        inline: n.parentElement !== block, // inside a link, bold text, etc.
      };
    });
    const wordy = pieces.filter((p) => !p.frozen && worthTranslating(p.orig));
    if (wordy.length < 2) return [simpleJob(node)];

    const last = pieces.length - 1;
    const source = pieces
      .map((p, i) => {
        let text = p.orig.replace(/\s+/g, ' ');
        if (i === 0) text = text.trimStart();
        if (i === last) text = text.trimEnd();
        return `<x${i}>${escapeXml(text)}</x${i}>`;
      })
      .join('');
    if (source.length > MAX_NODE_CHARS) return wordy.map((p) => simpleJob(p.node));
    return [{ nodes: run, pieces, source, marked: true }];
  }

  /** Split "<x0>…</x0><x1>…</x1>" back into pieces, or null if the markers didn't survive intact. */
  function splitMarked(text, count) {
    const marker = /<x(\d+)>([\s\S]*?)<\/x\1>/g;
    const parts = [...text.matchAll(marker)];
    if (parts.length !== count || parts.some((m, i) => Number(m[1]) !== i)) return null;
    if (text.replace(marker, '').trim()) return null; // words ended up outside the markers
    return parts.map((m) => decodeEntities(m[2]));
  }

  function chunk(texts) {
    const out = [];
    let batch = [];
    let chars = 0;
    for (const text of texts) {
      if (batch.length && (batch.length >= BATCH_TEXTS || chars + text.length > BATCH_CHARS)) {
        out.push(batch);
        batch = [];
        chars = 0;
      }
      batch.push(text);
      chars += text.length;
    }
    if (batch.length) out.push(batch);
    return out;
  }

  async function flush() {
    const lang = displayLang();
    const gen = generation;
    const jobs = [];
    const taken = new Set();
    const runsCache = new Map();
    for (const node of queue) {
      if (!lang || taken.has(node) || !node.isConnected) continue;
      const rec = records.get(node);
      if (rec && isOurs(node, rec) && render(node, rec, lang)) continue;
      for (const job of jobsFor(node, runsCache)) {
        job.nodes.forEach((n) => taken.add(n));
        if (job.source) jobs.push(job);
      }
    }
    queue.clear();

    const failed = await runJobs(jobs, lang, gen);
    if (failed.length) {
      const pieces = failed.flatMap((job) => job.pieces.filter((p) => !p.frozen && worthTranslating(p.orig)));
      await runJobs(pieces.map((p) => simpleJob(p.node)), lang, gen);
    }
  }

  /** Translate jobs in batches, a few requests at a time. Returns marked jobs that must be retried piece by piece. */
  async function runJobs(jobs, lang, gen) {
    const failed = [];
    const bySource = new Map(); // identical strings are requested once
    for (const job of jobs) {
      if (!bySource.has(job.source)) bySource.set(job.source, []);
      bySource.get(job.source).push(job);
    }
    const batches = chunk([...bySource.keys()]);
    let next = 0;
    const worker = async () => {
      while (next < batches.length && gen === generation) {
        const batch = batches[next++];
        let results;
        try {
          // Short UI strings ("Main menu") are easily misdetected, so tell the service the page's language.
          results = await translateTexts(batch, lang, pageLang);
        } catch (err) {
          showError(err);
          return;
        }
        if (gen !== generation) return;
        setError('');
        batch.forEach((source, i) => {
          for (const job of bySource.get(source)) if (!applyJob(job, results[i], lang)) failed.push(job);
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, batches.length) }, worker));
    return failed;
  }

  /** Store a translation result on its node(s). Returns false if a marked sentence needs a retry. */
  function applyJob(job, result, lang) {
    if (!result) return true;
    const { from } = result;
    if (!job.marked) {
      const { node, orig } = job.pieces[0];
      const [, lead, trail] = orig.match(/^(\s*)[\s\S]*?(\s*)$/);
      remember(node, orig, from, lang, lead + result.text.trim() + trail); // keep the page's spacing
      return true;
    }
    const { pieces } = job;
    if (sameLang(from, lang)) {
      pieces.forEach((p) => !p.frozen && remember(p.node, p.orig, from, lang, null)); // already in this language
      return true;
    }
    const out = splitMarked(result.text, pieces.length);
    if (!out) return false;
    // Inline code must come back untouched, and links/bold text must keep some words (no empty links).
    const intact = pieces.every((p, i) =>
      p.frozen ? tidy(out[i]) === tidy(p.orig) : !(p.inline && LETTER.test(p.orig)) || LETTER.test(out[i]),
    );
    if (!intact) return false;
    const last = pieces.length - 1;
    pieces.forEach((p, i) => {
      if (p.frozen || (!p.orig.trim() && !out[i].trim())) return;
      let text = out[i];
      if (i === 0) text = p.orig.match(/^\s*/)[0] + text.trimStart();
      if (i === last) text = text.trimEnd() + p.orig.match(/\s*$/)[0];
      remember(p.node, p.orig, from, lang, text);
    });
    return true;
  }

  function remember(node, orig, from, lang, text) {
    if (!node.isConnected) return;
    let rec = records.get(node);
    if (rec && !isOurs(node, rec)) {
      records.delete(node);
      rec = undefined;
    }
    if (!rec) {
      if (node.nodeValue !== orig) return; // the page changed it while we were waiting
      rec = { orig, from: '', tr: {} };
      records.set(node, rec);
    } else if (rec.orig !== orig) {
      return;
    }
    if (from) rec.from = from;
    if (text != null) {
      rec.tr[lang] = text;
      if (LETTER.test(text)) produced.set(text.trim(), { orig: orig.trim(), from: rec.from, lang });
    }
    render(node, rec, lang);
  }

  function setError(message) {
    if (message === lastError) return;
    lastError = message;
    onState(state());
  }

  function showError(err) {
    setError(err.message);
    if (errorShownFor === generation) return;
    errorShownFor = generation;
    onError(err);
  }

  // ---------------------------------------------------------------------------
  // Keeping up with the page
  // ---------------------------------------------------------------------------

  function watch(root) {
    if (!observing || watchedRoots.has(root)) return;
    watchedRoots.add(root);
    mo.observe(root, { childList: true, subtree: true, characterData: true });
  }

  function observeDom(on) {
    if (on) {
      observing = true;
      watch(document.documentElement);
    } else {
      mo.disconnect();
      observing = false;
      watchedRoots = new WeakSet();
    }
  }

  function onMutations(mutations) {
    const lang = displayLang();
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((node) => dirty.add(node));
        if (m.removedNodes.length) sawRemovals = true;
        continue;
      }
      const node = m.target;
      const rec = records.get(node);
      if (rec && isOurs(node, rec)) {
        // A framework re-rendered the original text: put the translation back (a few times at most).
        if (lang && node.nodeValue === rec.orig && !sameLang(rec.from, lang) && rec.tr[lang]) {
          rec.reverts = (rec.reverts || 0) + 1;
          if (rec.reverts <= 3) node.nodeValue = rec.tr[lang];
        }
        continue;
      }
      if (rec) records.delete(node);
      dirty.add(node);
    }
    if (dirty.size || sawRemovals) schedule('rescan', rescan, 80);
  }

  function rescan() {
    if (sawRemovals) {
      // Let go of elements the page removed before they ever scrolled into view.
      sawRemovals = false;
      for (const el of waiting.keys()) {
        if (!el.isConnected) {
          io.unobserve(el);
          waiting.delete(el);
        }
      }
    }
    const nodes = [...dirty];
    dirty.clear();
    nodes.forEach(scan);
  }

  // ---------------------------------------------------------------------------
  // Switching languages
  // ---------------------------------------------------------------------------

  function restoreOriginals() {
    if (!document.body) return;
    walk(document.body, (node) => {
      const rec = records.get(node);
      if (rec && isOurs(node, rec) && node.nodeValue !== rec.orig) node.nodeValue = rec.orig;
    });
  }

  function setHtmlLang(lang) {
    const html = document.documentElement;
    if (lang && !sameLang(lang, pageLang)) html.setAttribute('lang', lang);
    else if (originalHtmlLang == null) html.removeAttribute('lang');
    else html.setAttribute('lang', originalHtmlLang);
  }

  /** Re-render the whole page for the current mode. */
  function refresh() {
    generation++;
    lastError = '';
    queue.clear();
    waiting.forEach((_, el) => io.unobserve(el));
    waiting.clear();
    const lang = displayLang();
    if (lang) {
      observeDom(true);
      setHtmlLang(lang);
      if (document.body) scan(document.body);
    } else {
      observeDom(false);
      restoreOriginals();
      setHtmlLang('');
    }
    onState(state());
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    refresh();
  }

  /** Call after the language pair changed. */
  function languagesChanged() {
    if (mode === 'off') return;
    restoreOriginals(); // don't leave the old language on screen
    refresh();
  }

  /**
   * The language the page is written in, or '' if unsure. Asks the translation service about a short
   * sample, and only trusts the answer if the page's own lang attribute doesn't contradict it:
   * treating a page as the wrong language is worse than detecting each text separately.
   */
  async function detectPageLang() {
    const main = document.querySelector('article, main, [role="main"]');
    let sample = tidy(main?.innerText || '').slice(0, 300);
    if (sample.length < 80) sample = tidy(document.body?.innerText || '').slice(0, 300);
    if (sample.length < 80) return;
    const declared = normLang(originalHtmlLang);
    try {
      const { native, target } = getSettings();
      const [result] = await translateTexts([sample], mode === 'native' ? native : target);
      const detected = normLang(result.from);
      if (detected && (!declared || declared === detected)) pageLang = detected;
    } catch {
      /* stay unsure */
    }
  }

  /** The block's text in `lang`: from memory when possible, otherwise from the translation API. */
  async function textOf(block, lang) {
    const pieces = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        const display = getComputedStyle(node).display;
        return display === 'inline' || display === 'contents' ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const rec = records.get(node);
      if (rec && isOurs(node, rec)) {
        pieces.push(rec);
      } else {
        const neutral = !worthTranslating(node.nodeValue) || node.parentElement?.closest(SKIP);
        pieces.push({ orig: node.nodeValue, from: neutral ? '*' : pageLang, tr: {} });
      }
    }
    const inLang = (p) => p.from === '*' || sameLang(p.from, lang);
    if (!pieces.some((p) => p.from !== '*')) return '';
    if (pieces.every(inLang)) return tidy(pieces.map((p) => p.orig).join(''));
    if (pieces.every((p) => inLang(p) || p.tr[lang])) {
      return tidy(pieces.map((p) => (inLang(p) ? p.orig : p.tr[lang])).join(''));
    }
    const source = tidy(pieces.map((p) => p.orig).join('')).slice(0, 3000);
    const [result] = await translateTexts([source], lang, pageLang);
    return sameLang(result.from, lang) ? source : result.text;
  }

  return {
    setMode,
    languagesChanged,
    detectPageLang,
    translateTexts,
    textOf,
    displayLang,
    otherLang,
    state,
    mode: () => mode,
    retry: refresh,
  };
}
