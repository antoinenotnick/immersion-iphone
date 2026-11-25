// Bundles src/ into dist/immersion.user.js (the file you install on the phone).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const GRANTS = ['GM.getValue', 'GM.setValue', 'GM.deleteValue', 'GM.xmlHttpRequest'];

const header = `// ==UserScript==
// @name         Immersion
// @description  Read the web in the language you're learning. Tap the floating button to switch, two fingers to peek, select text for grammar tips.
// @version      ${version}
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
