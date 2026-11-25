// Bundles src/ into dist/immersion.user.js (the file you install on the phone).
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
// Where the Userscripts app looks for updates. They're picked up when @version goes up.
const RAW = 'https://raw.githubusercontent.com/antoinenotnick/immersion-iphone/main/dist';
const GRANTS = ['GM.getValue', 'GM.setValue', 'GM.deleteValue', 'GM.xmlHttpRequest'];

const header = `// ==UserScript==
// @name         Immersion
// @description  Read the web in the language you're learning. Tap the floating button to switch, two fingers to peek, select text for grammar tips.
// @version      ${version}
// @homepageURL  https://github.com/antoinenotnick/immersion-iphone
// @updateURL    ${RAW}/immersion.meta.js
// @downloadURL  ${RAW}/immersion.user.js
// @match        *://*/*
// @run-at       document-end
// @inject-into  content
// @noframes
${GRANTS.map((g) => `// @grant        ${g}`).join('\n')}
// ==/UserScript==
`;

await build({
  entryPoints: ['src/main.js'],
  outfile: 'dist/immersion.user.js',
  bundle: true,
  format: 'iife',
  target: 'safari16.4',
  charset: 'utf8',
  banner: { js: header },
  logLevel: 'info',
});

// Just the header, so update checks don't download the whole script.
writeFileSync('dist/immersion.meta.js', header);
