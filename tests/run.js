// Runs every *_test.js in this folder, one after another (a few start the real server on their own port), and
// prints a one-line summary for each plus the details of anything that failed.
//
//   node tests/run.js              all of them
//   node tests/run.js builder      only the ones whose name contains "builder"
//
// tests/tools/ has scripts that are not pass/fail tests (AI measurements and traces); run those by hand.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const filter = process.argv[2];
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('_test.js') && (!filter || f.includes(filter))).sort();
if (!files.length) { console.log(`No tests match "${filter}".`); process.exit(1); }

let totalPass = 0, totalFail = 0, crashed = 0;
const started = Date.now();
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 120000 });
  const lines = (r.stdout ?? '').split('\n');
  const pass = lines.filter((l) => l.startsWith('PASS')).length;
  const fail = lines.filter((l) => l.startsWith('FAIL'));
  const bad = r.status !== 0 && !fail.length; // crashed or timed out without reporting a failed check
  totalPass += pass; totalFail += fail.length; if (bad) crashed++;
  const mark = fail.length || bad ? 'FAIL' : ' ok ';
  console.log(`${mark}  ${f.padEnd(26)} ${String(pass).padStart(3)} passed${fail.length ? `, ${fail.length} failed` : ''}   (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  for (const l of fail) console.log(`        ${l}`);
  if (bad) console.log(`        did not finish cleanly (exit ${r.status}${r.signal ? `, ${r.signal}` : ''}):\n${(r.stderr || r.stdout).split('\n').slice(-8).map((x) => `        ${x}`).join('\n')}`);
}
console.log(`\n${totalPass} checks passed, ${totalFail} failed${crashed ? `, ${crashed} test file(s) crashed` : ''} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(totalFail || crashed ? 1 : 0);
