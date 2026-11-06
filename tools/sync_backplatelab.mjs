// Brings the app of BackplateLab into this repo as the 3D Camera Pin edition: its web files (the same list that
// BackplateLab publishes, tools/build_web.mjs there) replace js/, css/, fonts/, vendor/, tours/, assets/, phone/ and
// index.html here, and then index.html and js/module-tabs.js get the hooks of edition/ (only the tabs Import and
// Measure, 2D Camera Match, 3D Camera Pin | Environment, 3D Assets and 3D Render). edition/ is never touched.
// Usage: node tools/sync_backplatelab.mjs <folder of the BackplateLab clone>
import fs from 'fs'; import path from 'path'; import { execSync } from 'child_process'; import { fileURLToPath } from 'url';
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(process.argv[2] || '../backplatelab');
if (!fs.existsSync(path.join(src, 'js', 'module-tabs.js'))) { console.error('Not a BackplateLab folder: ' + src); process.exit(1); }
const dirs = ['js', 'css', 'fonts', 'vendor', 'tours', 'assets', 'phone'];
for (const d of dirs) { fs.rmSync(path.join(here, d), { recursive: true, force: true }); fs.cpSync(path.join(src, d), path.join(here, d), { recursive: true }); }
fs.copyFileSync(path.join(src, 'THIRD_PARTY_LICENSES.md'), path.join(here, 'THIRD_PARTY_LICENSES.md'));
fs.copyFileSync(path.join(src, 'tools', 'serve.ps1'), path.join(here, 'tools', 'serve.ps1'));
// a change that does not apply stops the sync: BackplateLab changed there and the hook has to be looked at
const patch = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf8');
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) { console.error(`${path.relative(here, file)}: expected 1 "${a.slice(0, 60)}", found ${n}`); process.exit(1); }
    s = s.replace(a, b);
  }
  fs.writeFileSync(file, s);
};
let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
fs.writeFileSync(path.join(here, 'index.html'), html);
patch(path.join(here, 'index.html'), [
  ['<title>BackplateLab</title>', '<title>3D Camera Pin</title>'],
  ['</head>', '<link rel="stylesheet" href="edition/cp-edition.css">\n</head>'],
  ['<script defer src="js/module-tabs.js"></script>', '<script defer src="edition/cp-edition.js"></script>\n<script defer src="js/module-tabs.js"></script>'],
  ['<script defer src="js/boot.js"></script>', '<script defer src="edition/cp-edition-late.js"></script>\n<script defer src="js/boot.js"></script>'],
]);
// the list of tabs, trimmed right after it is written (before the tab bar is built from it)
{
  const f = path.join(here, 'js', 'module-tabs.js'), s = fs.readFileSync(f, 'utf8');
  const i = s.indexOf('const MTABS = ['), j = s.indexOf('\n];\n', i);
  if (i < 0 || j < 0) { console.error('js/module-tabs.js: MTABS not found'); process.exit(1); }
  fs.writeFileSync(f, s.slice(0, j + 4) + "if (typeof cpEditionTabs === 'function') cpEditionTabs(MTABS); // 3D Camera Pin edition (edition/cp-edition.js)\n" + s.slice(j + 4));
}
// where it came from
let rev = '', ver = '';
try { rev = execSync('git rev-parse --short HEAD', { cwd: src }).toString().trim(); } catch (e) { rev = '?'; }
ver = (fs.readFileSync(path.join(src, 'js', 'version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/) || [])[1] || '?';
fs.writeFileSync(path.join(here, 'edition', 'BACKPLATELAB.txt'), `BackplateLab v${ver} (commit ${rev}), synced ${new Date().toISOString().slice(0, 10)} with tools/sync_backplatelab.mjs\n`);
console.log(`Synced BackplateLab v${ver} (${rev}) into ${here}`);
