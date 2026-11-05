// Slow-mo zone sparkles: how many are alive at once, that they stay inside the zone, and that the snapshot cap still holds.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const src = ['level.js', 'sprites.js', 'net.js', 'main.js', 'online.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');
const noop = new Proxy({}, { get: () => () => {}, set: () => true });
const sb = { console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Promise, setTimeout, performance: { now: () => 0 }, requestAnimationFrame: () => {},
  addEventListener: () => {}, localStorage: { getItem: () => null }, HTMLInputElement: class {}, encodeURIComponent, TypeError, fetch: () => Promise.resolve({}),
  document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } } };
vm.createContext(sb); vm.runInContext(src, sb);
const run = (c) => vm.runInContext(c, sb);
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
run('menu.open = false; for (const [, g] of query("goal")) g.sparks = undefined;'); // isolate the zones
// Park the ball and players far from the zones so slow-mo itself doesn't matter, then run 3 simulated seconds of the sparkle + particle systems.
run('tick = 0; for (let i = 0; i < 360; i++) { tick++; slowSystem(); particleSystem(); }');
const parts = JSON.parse(run('JSON.stringify([...query("pos","particle")].map(e => [e[1].x, e[1].y, e[2].life]))'));
console.log(`alive after 3s: ${parts.length} (2 zones)`);
check('about 3x as many sparkles as before (was ~20 alive per zone, now ~85)', parts.length > 120 && parts.length < 240, String(parts.length));
const zones = JSON.parse(run('JSON.stringify([...query("pos","box","slow")].map(e => [e[1].x, e[1].y, e[2].w, e[2].h]))'));
check('both zones produce them (split roughly evenly)', zones.every(([x, , w]) => parts.filter(([px]) => px >= x - 20 && px <= x + w + 20).length > 40));
check('they rise through the zone (drift up, stay near it)', zones.every(([x, y, w, h]) => parts.filter(([px]) => px >= x - 20 && px <= x + w + 20).every(([, py]) => py > y - 120 && py < y + h)));
check('lives are 1 to 1.6s and no particle outlives that', parts.every(([, , life]) => life > 0 && life <= 1.6));
// Online: the worst case is the death beam on top of zone sparkles. The snapshot must still stay under its cap.
run('emit(0, 0, 0, 0, "#f44", 1); for (let i = 0; i < 400; i++) emit(i, 0, 0, 0, "#fff", 1)');
check('snapshot still capped at 300 particles', JSON.parse(run('JSON.stringify(snapshot())')).particles.length === 300);
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
