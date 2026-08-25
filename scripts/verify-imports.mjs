
import fs from 'node:fs';
import path from 'node:path';

const start = path.resolve(process.argv[2] || '.');
const sourceExts = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const candidates = ['', '.js', '.jsx', '.ts', '.tsx', '.json', '.mjs', '.cjs', '.css', '.wasm'];
const importRe = /(?:import\s+(?:[^'\"]+?\s+from\s+)?|export\s+[^'\"]*?\s+from\s+|import\s*\()\s*['\"]([^'\"]+)['\"]/g;
const missing = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'test-results', 'playwright-report'].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (sourceExts.has(path.extname(entry.name))) checkFile(p);
  }
}

function existsImport(fromFile, spec) {
  const clean = spec.split('?')[0].split('#')[0];
  const base = path.resolve(path.dirname(fromFile), clean);
  for (const ext of candidates) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return true;
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of candidates.slice(1)) {
      const idx = path.join(base, 'index' + ext);
      if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return true;
    }
  }
  return false;
}

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  importRe.lastIndex = 0;
  let m;
  while ((m = importRe.exec(text))) {
    const spec = m[1];
    if (spec.startsWith('.') && !existsImport(file, spec)) {
      missing.push(`${path.relative(start, file)} -> ${spec}`);
    }
  }
}

walk(start);
if (missing.length) {
  console.error(`Unresolved relative imports (${missing.length}):`);
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}
console.log('Relative import verification: PASS');
