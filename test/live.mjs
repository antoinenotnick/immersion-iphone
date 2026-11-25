// Manual check against real sites and the real Google Translate: node test/live.mjs [url...]
import { mkdirSync } from 'node:fs';
import { launch, realNetwork, ONBOARDED } from './harness.mjs';

mkdirSync('test/shots', { recursive: true });
const urls = process.argv.slice(2);
if (!urls.length) urls.push('https://en.m.wikipedia.org/wiki/Lighthouse', 'https://news.ycombinator.com/', 'https://www.bbc.com/news', 'https://developer.mozilla.org/en-US/docs/Web/CSS');

for (const url of urls) {
  const env = await launch({ network: realNetwork, storage: { ...ONBOARDED } });
  const page = await env.newPage();
  const name = new URL(url).hostname;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.start();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `test/shots/live-${name}.png` });
    const read = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 1500));
    const es = await read();
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(900);
    }
    await page.screenshot({ path: `test/shots/live-${name}-scrolled.png` });
    const requests = env.requests.length;
    await page.tapPill();
    await page.waitForTimeout(400);
    const en = await read();
    console.log(`\n== ${name}: ${requests} requests, +${env.requests.length - requests} on toggle, lang=${await page.evaluate(() => document.documentElement.lang)}`);
    console.log(`ES: ${es.slice(0, 260)}\nEN: ${en.slice(0, 260)}`);
    console.log('pill:', await page.ui((r) => r.querySelector('.pill').className), 'errors:', env.errors.slice(0, 3));
  } catch (err) {
    console.log(`\n== ${name}: ${err.message.split('\n')[0]}`);
  }
  await env.browser.close();
}
