// End-to-end checks of the built script. Run with: npm test
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { launch, fakeNetwork, ONBOARDED } from './harness.mjs';

mkdirSync('test/shots', { recursive: true });

const filler = Array.from({ length: 40 }, (_, i) => `<p class="f" id="f${i}">Filler paragraph number ${i} talks about nothing in particular here.</p>`).join('');
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font:17px/1.5 system-ui;margin:16px"><main>
<h1 id="title">The old lighthouse keeper</h1>
<p id="p1">Every evening the keeper climbed the long stairs and lit the lamp before dark.</p>
<p id="p2">Read <a id="link" href="/other">the whole story</a> and <b>tell your friends</b> about it.</p>
<p id="p3">Run <code id="code">npm install</code> before you start the program.</p>
<p id="blank">42</p><p translate="no" id="no">Leave this alone</p>
<textarea id="ta">Typed text stays</textarea>
${filler}<p id="last">The very last paragraph of the page.</p></main></body></html>`;

const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)).listen(0);
const URL_ = `http://localhost:${server.address().port}/`;

const text = (page, id) => page.evaluate((i) => document.getElementById(i).textContent, id);
const until = async (fn, what, ms = 4000) => {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn().catch(() => false)) return;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const center = (page, id) =>
  page.evaluate((i) => {
    const el = document.getElementById(i);
    const range = document.createRange();
    range.selectNodeContents(el);
    const b = range.getClientRects()[0];
    return [b.left + b.width / 2, b.top + b.height / 2];
  }, id);

const tests = [];
const test = (name, fn, opts = {}) => tests.push({ name, fn, opts });
const open = async (env, path = '') => {
  const page = await env.newPage();
  await page.goto(URL_ + path);
  await page.start();
  return page;
};
const translated = (page, id = 'p1') => until(async () => (await text(page, id)).includes('-es'), `${id} translated`);
const restored = (page, id = 'p1') => until(async () => !(await text(page, id)).includes('-es'), `${id} restored`);

test('first run asks for languages and sends nothing until Start', async (env) => {
  const page = await open(env);
  await until(() => page.ui((r) => r.querySelector('.menu.show .title')?.textContent === 'Welcome to Immersion'), 'welcome');
  await page.screenshot({ path: 'test/shots/welcome.png' });
  assert.equal(env.requests.length, 0);
  await page.tapUi('.btn.primary', 'Start');
  await translated(page);
  assert.equal(JSON.parse(env.storage.settings).onboarded, true);
}, { storage: {} });

test('translates visible text only, keeps markup, skips code and inputs', async (env) => {
  const page = await open(env);
  await translated(page);
  await until(async () => (await text(page, 'p2')) === 'Read-es the-es whole-es story-es and-es tell-es your-es friends-es about-es it-es.', 'sentence across link and bold');
  assert.equal(await page.evaluate(() => document.querySelector('#p2 a').textContent), 'the-es whole-es story-es');
  assert.equal(await text(page, 'no'), 'Leave this alone');
  assert.equal(await text(page, 'ta'), 'Typed text stays');
  assert.equal(await text(page, 'code'), 'npm install');
  await page.waitForTimeout(400);
  assert.ok(!(await text(page, 'last')).includes('-es'), 'off-screen text not sent yet');
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await translated(page, 'last');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'test/shots/target.png' });
});

test('tapping the button switches instantly, without requests, and the choice carries to the next page', async (env) => {
  const page = await open(env);
  await translated(page);
  await page.waitForTimeout(300);
  const before = env.requests.length;
  await page.tapPill();
  await restored(page);
  assert.equal(env.requests.length, before);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.tapPill();
  await translated(page);
  await page.tapPill();
  await restored(page);
  await until(async () => JSON.parse(env.storage.settings).mode === 'native', 'mode saved');
  const next = await open(env, 'next');
  await next.waitForTimeout(800);
  assert.ok(!(await text(next, 'p1')).includes('-es'), 'next page stays in native language');
  assert.equal(await next.ui((r) => r.querySelector('.pill').textContent), 'EN');
});

test('rapid taps end in the right state', async (env) => {
  const page = await open(env);
  await translated(page);
  for (let i = 0; i < 5; i++) await page.tapPill();
  await restored(page);
  await page.waitForTimeout(300);
  assert.ok(!(await text(page, 'p1')).includes('-es'));
  assert.equal(JSON.parse(env.storage.settings).mode, 'native');
});

test('dragging moves the button, snaps to the edge and does not toggle', async (env) => {
  const page = await open(env);
  await translated(page);
  const [x, y] = await page.pillCenter();
  await page.touch('touchStart', [[x, y]]);
  for (let i = 1; i <= 8; i++) await page.touch('touchMove', [[x - (x - 60) * (i / 8), y - 25 * i]]);
  await page.touch('touchEnd', []);
  await until(async () => (await page.pillCenter())[0] < 60, 'snapped left');
  assert.ok((await text(page, 'p1')).includes('-es'));
  await until(async () => JSON.parse(env.storage.settings).button.side === 'left', 'position saved');
});

test('holding the button opens the menu; pausing the site restores it', async (env) => {
  const page = await open(env);
  await translated(page);
  await page.holdPill();
  await page.waitForTimeout(300);
  assert.ok(await page.ui((r) => !!r.querySelector('.menu.show')), 'menu stays open after the finger lifts');
  assert.ok((await text(page, 'p1')).includes('-es'), 'hold did not toggle');
  await page.screenshot({ path: 'test/shots/menu.png' });
  await page.tapUi('.row', 'Pause on this site');
  await restored(page);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.tapUi('.row', 'Pause on this site');
  await translated(page);
  await page.waitForTimeout(400);
  await page.touchscreen.tap(100, 30);
  await until(() => page.ui((r) => !r.querySelector('.menu.show')), 'backdrop closes the menu');
});

test('changing the language re-translates', async (env) => {
  const page = await open(env);
  await translated(page);
  await page.holdPill();
  await page.ui((r) => {
    const s = r.querySelector('select[aria-label="I\'m learning"]');
    s.value = 'en';
    s.dispatchEvent(new Event('change'));
  });
  await until(async () => JSON.parse(env.storage.settings).target === 'en', 'saved');
  const s = JSON.parse(env.storage.settings);
  assert.deepEqual([s.target, s.native], ['en', 'es'], 'picking the same language swaps them');
  await restored(page);
});

test('two fingers peek, and lifting does not follow a link', async (env) => {
  const page = await open(env);
  await translated(page, 'p2');
  const [x, y] = await center(page, 'link');
  await page.touch('touchStart', [[x - 20, y], [x + 20, y]]);
  await until(() => page.ui((r) => r.querySelector('.peek.show .text')?.textContent === 'Read the whole story and tell your friends about it.'), 'peek text');
  await page.screenshot({ path: 'test/shots/peek.png' });
  await page.touch('touchEnd', []);
  await until(() => page.ui((r) => !r.querySelector('.peek.show')), 'peek closed');
  await page.waitForTimeout(400);
  assert.equal(page.url(), URL_);
});

test('two fingers that move (scroll, pinch) do not peek', async (env) => {
  const page = await open(env);
  await translated(page);
  const [x, y] = await center(page, 'p1');
  await page.touch('touchStart', [[x - 20, y], [x + 20, y]]);
  for (let i = 1; i < 6; i++) await page.touch('touchMove', [[x - 20 - i * 8, y], [x + 20 + i * 8, y]]);
  await page.waitForTimeout(350);
  assert.ok(await page.ui((r) => !r.querySelector('.peek.show')));
  await page.touch('touchEnd', []);
});

const select = (page, id) => page.evaluate((i) => getSelection().selectAllChildren(document.getElementById(i)), id);

test('selecting text opens the card; a tap outside closes it', async (env) => {
  const page = await open(env);
  await translated(page);
  await select(page, 'p1');
  await until(() => page.ui((r) => r.querySelector('.card.show .translation')?.textContent.startsWith('Every evening the keeper')), 'card translation');
  await page.screenshot({ path: 'test/shots/card.png' });
  await page.tapUi('.btn', 'Grammar tips');
  await until(() => page.ui((r) => r.querySelector('.card .grammar .error')?.textContent.includes('Add a Google Gemini API key')), 'asks for a key');
  await page.tapUi('.btn', 'Open settings');
  await until(() => page.ui((r) => r.querySelector('.menu.show .title')?.textContent === 'Settings'), 'settings');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test/shots/settings.png' });
  await page.tapUi('.menu [aria-label="Close"]');
  await page.evaluate(() => getSelection().removeAllRanges());
  await select(page, 'title');
  await until(() => page.ui((r) => !!r.querySelector('.card.show')), 'card again');
  const [x, y] = await center(page, 'p3');
  await page.touchscreen.tap(x, y);
  await until(() => page.ui((r) => !r.querySelector('.card.show')), 'tap outside closes');
});

test('the card moves to the top when the selection is low on the screen', async (env) => {
  const page = await open(env);
  await translated(page);
  await page.evaluate(() => {
    const el = document.getElementById('f10');
    scrollTo(0, el.offsetTop - innerHeight + 80);
  });
  await translated(page, 'f10');
  await select(page, 'f10');
  await until(() => page.ui((r) => !!r.querySelector('.card.show.top')), 'card on top');
});

test('grammar tips render and are cached', async (env) => {
  let calls = 0;
  env.network = async (req) => {
    if (!req.url.includes('generativelanguage')) return fakeNetwork(req);
    if (req.url.includes('/models')) return { status: 200, body: JSON.stringify({ models: [{ name: 'models/gemini-flash-latest' }] }) };
    calls++;
    assert.equal(req.headers['x-goog-api-key'], 'test-key');
    const tips = {
      points: [{ snippet: 'climbed-es', title: 'Past <b>tense</b>', explanation: 'A finished action.' }],
      vocabulary: [{ term: 'stairs', meaning: 'steps' }],
    };
    return { status: 200, body: JSON.stringify({ status: 'completed', output_text: JSON.stringify(tips) }) };
  };
  const page = await open(env);
  await translated(page);
  for (let i = 0; i < 2; i++) {
    await select(page, 'p1');
    await until(() => page.ui((r) => !!r.querySelector('.card.show .btn')), 'card');
    await page.tapUi('.card .btn', 'Grammar tips');
    await until(() => page.ui((r) => r.querySelector('.sentence mark')?.textContent === 'climbed-es'), 'tips');
    if (!i) await page.waitForTimeout(250), await page.screenshot({ path: 'test/shots/grammar.png' });
    assert.ok(await page.ui((r) => r.querySelector('.point-title').textContent.includes('<b>tense</b>')), 'AI output is never parsed as HTML');
    await page.tapUi('.card [aria-label="Close"]');
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.waitForTimeout(600);
  }
  assert.equal(calls, 1);
}, { storage: { settings: JSON.stringify({ onboarded: true, native: 'en', target: 'es', geminiKey: 'test-key' }) } });

test('keys are asked for in a native prompt and never appear on the page', async (env) => {
  const page = await open(env);
  await translated(page);
  await page.holdPill();
  await page.tapUi('.row', 'Settings');
  page.once('dialog', (d) => d.accept('secret-123'));
  await page.tapUi('.row', 'Google Gemini key');
  await until(async () => JSON.parse(env.storage.settings).geminiKey === 'secret-123', 'key saved');
  await until(() => page.ui((r) => r.querySelector('.menu').textContent.includes('Saved on this phone')), 'shown as saved');
  assert.ok(await page.ui((r) => !r.querySelector('.root').innerHTML.includes('secret-123')));
  assert.ok(await page.ui((r) => !r.querySelector('input')));
});

test('content added later is translated; page edits are respected', async (env) => {
  const page = await open(env);
  await translated(page);
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'new';
    p.textContent = 'Fresh words arrived from the server';
    document.querySelector('main').prepend(p);
    document.getElementById('title').firstChild.nodeValue = 'A different heading';
  });
  await translated(page, 'new');
  await until(async () => (await text(page, 'title')) === 'A-es different-es heading-es', 'edited text');
  await page.tapPill();
  await until(async () => (await text(page, 'new')) === 'Fresh words arrived from the server', 'restored');
});

test('a failed request shows an error and "Try again" recovers', async (env) => {
  env.network = async () => ({ status: 0, body: '' });
  const page = await open(env);
  await until(() => page.ui((r) => r.querySelector('.toast.show')?.textContent.includes("Couldn't connect")), 'toast');
  await until(() => page.ui((r) => r.querySelector('.pill').classList.contains('failed')), 'error mark');
  env.network = fakeNetwork;
  await page.holdPill();
  await page.waitForTimeout(200);
  await page.tapUi('.btn', 'Try again');
  await translated(page);
  await until(() => page.ui((r) => !r.querySelector('.pill').classList.contains('failed')), 'mark cleared');
});

test('translations are cached between visits, outside the site’s own storage', async (env) => {
  const page = await open(env);
  await translated(page);
  await page.waitForTimeout(300);
  assert.ok(!env.storage['cache:localhost'], 'writes are batched');
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  await until(async () => !!env.storage['cache:localhost'], 'cache saved when leaving', 400);
  const before = env.requests.length;
  const again = await open(env);
  await translated(again);
  await again.waitForTimeout(400);
  assert.equal(env.requests.length, before);
  assert.deepEqual(await again.evaluate(async () => [localStorage.length, (await indexedDB.databases()).length]), [0, 0]);
});

test('the button comes back if the page removes it', async (env) => {
  const page = await open(env);
  await translated(page);
  await page.evaluate(() => document.querySelector('immersion-ui').remove());
  await until(() => page.evaluate(() => !!document.querySelector('immersion-ui')), 'remounted');
});

test('dark mode', async (env) => {
  const page = await open(env);
  await translated(page);
  await page.holdPill();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/shots/dark.png' });
}, { colorScheme: 'dark' });

const only = process.argv[2];
let failed = 0;
for (const { name, fn, opts } of tests) {
  if (only && !name.includes(only)) continue;
  const env = await launch({ ...opts, storage: { ...(opts.storage || ONBOARDED) } });
  try {
    await fn(env);
    assert.deepEqual(env.errors, []);
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err.message.split('\n').slice(0, 6).join('\n     ')}${env.errors.length ? `\n     page errors: ${env.errors.join(' | ')}` : ''}`);
  }
  await env.browser.close();
}
server.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
