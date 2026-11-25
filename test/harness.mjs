// Runs the built user script in Chrome with iPhone emulation and a stand-in for the Userscripts GM API.
import { chromium, devices } from 'playwright-core';
import { readFileSync } from 'node:fs';

const CODE = readFileSync(new URL('../dist/immersion.user.js', import.meta.url), 'utf8');

/** Fake translation: "hello" -> "hello-es" and back. Markers, spacing and punctuation are kept. */
export function fakeTranslate(text, to) {
  const isEs = /-es\b/.test(text);
  if (to === (isEs ? 'es' : 'en')) return { text, from: isEs ? 'es' : 'en' };
  const out = text.replace(/<\/?x\d+>|[\p{L}']+(?:-es)?/gu, (m) => {
    if (m[0] === '<') return m;
    const base = m.replace(/-es$/, '');
    return to === 'es' ? `${base}-es` : base;
  });
  return { text: out, from: isEs ? 'es' : 'en' };
}

/** Default network stub: Google Translate is faked, everything else fails. */
export async function fakeNetwork(req) {
  const url = new URL(req.url);
  if (url.hostname === 'translate.googleapis.com') {
    const texts = new URLSearchParams(req.data).getAll('q');
    const to = url.searchParams.get('tl');
    const auto = url.searchParams.get('sl') === 'auto';
    const results = texts.map((t) => fakeTranslate(t, to));
    return { status: 200, body: JSON.stringify(results.map((r) => (auto ? [r.text, r.from] : r.text))) };
  }
  return { status: 404, body: '{}' };
}

/** The real network, through Node. */
export async function realNetwork(req) {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.data });
  return { status: res.status, body: await res.text() };
}

export async function launch({ network = fakeNetwork, storage = {}, colorScheme = 'light', device = 'iPhone 15' } = {}) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { defaultBrowserType, ...profile } = devices[device];
  const context = await browser.newContext({ ...profile, colorScheme, locale: 'en-US', bypassCSP: true });
  const env = { browser, context, storage, requests: [], errors: [], network };

  await context.exposeFunction('__gmGet', (key) => storage[key]);
  await context.exposeFunction('__gmSet', (key, value) => void (storage[key] = value));
  await context.exposeFunction('__gmDelete', (key) => void delete storage[key]);
  await context.exposeFunction('__gmXhr', async (req) => {
    env.requests.push(req);
    try {
      return await env.network(req);
    } catch (err) {
      return { status: 0, body: String(err) };
    }
  });
  // Closed shadow roots are opened for the test only.
  await context.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      const root = attach.call(this, init);
      if (this.localName === 'immersion-ui') window.__ui = root;
      return root;
    };
  });

  env.newPage = async () => {
    const page = await context.newPage();
    page.on('pageerror', (err) => env.errors.push(err.message));
    page.on('console', (m) => m.type() === 'error' && /Immersion/.test(m.text()) && env.errors.push(m.text()));
    page.start = () =>
      page.evaluate(
        (code) => {
          const GM = {
            getValue: async (k, d) => (await window.__gmGet(k)) ?? d,
            setValue: (k, v) => window.__gmSet(k, v),
            deleteValue: (k) => window.__gmDelete(k),
            xmlHttpRequest: async ({ onload, onerror, ontimeout, ...req }) => {
              const res = await window.__gmXhr(req);
              const out = { status: res.status, responseText: res.body, response: res.body, responseHeaders: '' };
              if (res.status) onload(out);
              else onerror(out);
              return out;
            },
          };
          new Function('{GM}', `(async () => {${code}\n})()`)({ GM });
        },
        CODE,
      );
    page.ui = (fn, arg) => page.evaluate(`(${fn})(window.__ui, ${JSON.stringify(arg) ?? 'undefined'})`);
    page.cdp = await context.newCDPSession(page);
    page.touch = (type, points) =>
      page.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    page.pillCenter = () =>
      page.ui((r) => {
        const b = r.querySelector('.pill').getBoundingClientRect();
        return [b.left + b.width / 2, b.top + b.height / 2];
      });
    page.tapPill = async () => {
      const at = await page.pillCenter();
      await page.touch('touchStart', [at]);
      await page.touch('touchEnd', []);
    };
    page.holdPill = async () => {
      const at = await page.pillCenter();
      await page.touch('touchStart', [at]);
      await page.waitForTimeout(650);
      await page.touch('touchEnd', []);
    };
    /** Tap an element inside our UI, found by its text. */
    page.tapUi = async (selector, text) => {
      const at = await page.ui(
        (r, [sel, t]) => {
          const el = [...r.querySelectorAll(sel)].find((e) => !t || e.textContent.includes(t));
          if (!el) return null;
          el.scrollIntoView({ block: 'center' });
          const b = el.getBoundingClientRect();
          return [b.left + b.width / 2, b.top + b.height / 2];
        },
        [selector, text],
      );
      if (!at) throw new Error(`not found in UI: ${selector} ${text}`);
      await page.touchscreen.tap(...at);
    };
    return page;
  };
  return env;
}

export const ONBOARDED = { settings: JSON.stringify({ onboarded: true, native: 'en', target: 'es' }) };
