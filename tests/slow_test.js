const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const src = ['level.js', 'sprites.js', 'main.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');
const noop = new Proxy({}, { get: () => () => {}, set: () => true });
const sb = { console, Math, JSON, Set, Map, Object, Boolean, Number, Array, performance: { now: () => 0 }, requestAnimationFrame: () => {},
  addEventListener: () => {}, localStorage: { getItem: () => null }, HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } } };
vm.createContext(sb); vm.runInContext(src, sb);
const run = (c) => vm.runInContext(c, sb);
// zone at x 24..124, y 646..976
run('const [, bp] = [...query("pos","vel","circle")][0]; bp.x = 960; bp.y = 400; for (const [, p] of query("pos","body")) { p.x = 60; p.y = 900; } slowSystem()');
console.log(run('clock.scale') === 1 ? 'PASS' : 'FAIL', 'player standing in a zone: game stays at normal speed (scale', run('clock.scale') + ')');
run('const [, bp2] = [...query("pos","vel","circle")][0]; bp2.x = 60; bp2.y = 800; slowSystem()');
console.log(run('clock.scale') < 1 ? 'PASS' : 'FAIL', 'ball in the zone: slow-mo (scale', run('clock.scale') + ')');
run('const [, bp3] = [...query("pos","vel","circle")][0]; bp3.x = 960; bp3.y = 400; slowSystem()');
console.log(run('clock.scale') === 1 ? 'PASS' : 'FAIL', 'ball leaves: back to normal');
