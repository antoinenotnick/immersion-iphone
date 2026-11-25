// Offers dist/immersion.user.js (and nothing else) to a phone on the same Wi-Fi. Stop with Ctrl+C.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const PORT = 8787;
const FILE = new URL('../dist/immersion.user.js', import.meta.url);
const PATH = '/immersion.user.js';

createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== PATH) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(readFileSync(FILE));
}).listen(PORT, () => {
  const addresses = Object.entries(networkInterfaces())
    .filter(([name]) => !/vEthernet|WSL|VirtualBox|VMware|Loopback/i.test(name))
    .flatMap(([, list]) => list)
    .filter((a) => a.family === 'IPv4' && !a.internal);
  console.log('On your iPhone (same Wi-Fi), open this in Safari:\n');
  for (const a of addresses) console.log(`  http://${a.address}:${PORT}${PATH}`);
  console.log('\nPress Ctrl+C when the script is installed.');
});
