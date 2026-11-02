// Builds the claude.ai phone version into dist-artifact/: the same UI and engine, with the
// cloud data layer (public/js/cloud.js) instead of the Node server. No bundler; files are copied.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-artifact');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'js'), { recursive: true });

// UI scripts: absolute paths → relative (artifact files are served next to the page).
for (const f of readdirSync(join(ROOT, 'public/js'))) {
  if (f === 'mock.js') continue;
  const src = readFileSync(join(ROOT, 'public/js', f), 'utf8').replaceAll("'/icon.svg'", "'icon.svg'");
  writeFileSync(join(OUT, 'js', f), src);
}
cpSync(join(ROOT, 'public/styles.css'), join(OUT, 'styles.css'));
cpSync(join(ROOT, 'public/icon.svg'), join(OUT, 'icon.svg'));
cpSync(join(ROOT, 'engine'), join(OUT, 'engine'), { recursive: true });
cpSync(join(ROOT, 'vendor'), join(OUT, 'vendor'), { recursive: true });

// Browser-safe copies of the pure server helpers (node:crypto → small shim).
mkdirSync(join(OUT, 'srv'), { recursive: true });
writeFileSync(join(OUT, 'srv/shim-crypto.js'), `// Browser stand-ins for the two node:crypto calls the shared helpers use.
export const randomUUID = () => crypto.randomUUID();
// Stable short ids only (not security): two 53-bit cyrb hashes → hex.
function cyrb53(str, seed) { let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0'); }
export function createHash() { let s = ''; return { update(x) { s += String(x); return this; }, digest() { return cyrb53(s, 1) + cyrb53(s, 2); } }; }
`);
const helpers = { 'server/merge.js': 'merge.js', 'server/catalog.js': 'catalog.js', 'server/extract/normalize.js': 'normalize.js',
                  'server/extract/textlayer.js': 'textlayer.js', 'server/extract/anthropic.js': 'anthropic.js' };
for (const [from, to] of Object.entries(helpers)) {
  let src = readFileSync(join(ROOT, from), 'utf8').replace(/from 'node:crypto'/g, "from './shim-crypto.js'");
  if (to === 'anthropic.js') src = src.replace(/process\.env\./g, '(globalThis.process?.env ?? {}).');
  if (/from 'node:/.test(src)) throw new Error(`${from} still imports a Node module`);
  writeFileSync(join(OUT, 'srv', to), src);
}

// The page itself (the Artifact publish wraps it in the document skeleton).
writeFileSync(join(OUT, 'index.html'), `<title>The Corbett Method</title>
<meta name="description" content="Garden build estimating, shopping lists, cutting guides and daily build plans.">
<link rel="stylesheet" href="styles.css">
<div id="app"><div class="boot" role="status">Loading…</div></div>
<div id="toasts" aria-live="polite"></div>
<script type="module" src="js/app.js"></script>
`);

// File map for the Artifact publish call.
const files = {};
const walk = (dir, rel = '') => { for (const e of readdirSync(dir, { withFileTypes: true })) {
  const r = rel ? `${rel}/${e.name}` : e.name;
  if (e.isDirectory()) walk(join(dir, e.name), r); else if (r !== 'index.html') files[r] = `corbett-method/dist-artifact/${r}`;
} };
walk(OUT);
writeFileSync(join(OUT, '..', 'dist-artifact.files.json'), JSON.stringify(files, null, 1));
console.log(`built ${Object.keys(files).length + 1} files into dist-artifact/`);
