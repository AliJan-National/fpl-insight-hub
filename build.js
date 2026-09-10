#!/usr/bin/env node
// build.js — assembles app.js from the src/ manifest (v2.0 Phase 1).
//   node build.js          rebuild app.js from src/
//   node build.js --check  verify app.js matches src/ (used by CI)
// app.js is GENERATED. Never edit it directly — edit src/, then run this.
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const MANIFEST = [
  'src/legacy/part-a.js',
  'src/intelligence/market.js',
  'src/intelligence/visuals.js',
  'src/legacy/part-b.js',
  'src/models/fixture.js',
  'src/models/projection.js',
  'src/validation/backtest.js',
  'src/validation/scorecard.js',
  'src/intelligence/elite.js',
  'src/boot.js',
];
const built = MANIFEST.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('');
if (process.argv.includes('--check')) {
  const cur = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  if (built !== cur) { console.error('FAIL: app.js is out of sync with src/ — run: node build.js'); process.exit(1); }
  console.log('OK: app.js is the exact concatenation of the src/ manifest (' + cur.length + ' bytes)');
} else {
  fs.writeFileSync(path.join(ROOT, 'app.js'), built);
  console.log('app.js rebuilt from src/ (' + built.length + ' bytes)');
}
