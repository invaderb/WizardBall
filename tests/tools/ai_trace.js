// Print the lead-up to the first own goal (the AI's ball going into the goal the human scores in).
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..', '..') + '/';
const src = ['level.js', 'sprites.js', 'main.js', 'ai.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');
function rngFrom(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const [skill, seed, which] = [process.argv[2] ?? 'hard', Number(process.argv[3] ?? 1), process.argv[4] ?? 'own'];
const noop = new Proxy({}, { get: () => () => {}, set: () => true });
const M = Object.create(Math); M.random = rngFrom(seed);
const sandbox = { console, Math: M, JSON, Set, Map, Object, Boolean, Number, Array, performance: { now: () => 0 },
  requestAnimationFrame: () => {}, addEventListener: () => {}, localStorage: { getItem: () => null },
  HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } } };
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const run = (c) => vm.runInContext(c, sandbox);
run(`menu.open = false; ai.slot = 1; ai.skill = '${skill}'; aiReset(); round.t = 3;`);
const lives = () => JSON.parse(run('JSON.stringify([...query("lives","controls")].sort((a,b)=>a[2].slot-b[2].slot).map(e=>e[1].n))'));
const snap = () => run(`(() => {
  const me = [...query('pos','controls')].find(e => e[2].slot === 1)[1];
  const b = [...query('pos','vel','circle')][0];
  return { t: 0, me: [Math.round(me.x), Math.round(me.y)], ball: [Math.round(b[1].x), Math.round(b[1].y)], v: [Math.round(b[2].x), Math.round(b[2].y)], inp: ((inputs[1] ?? {}).left ? 'L' : '') + ((inputs[1] ?? {}).right ? 'R' : '') + ((inputs[1] ?? {}).jump ? 'J' : '') };
})()`);
let prev = lives(); const ring = [];
for (let i = 0; i < 120 * (Number(process.argv[5] ?? 120)); i++) {
  run(`(function () {
    if (round.hit > 0) { round.hit -= DT; particleSystem(); if (round.hit <= 0) { resetSystem(); if (!round.winner) round.t = 3; } }
    else if (round.winner) { for (const [, l] of query('lives')) l.n = 3; round.winner = null; round.t = 3; }
    else if (round.t > 0) round.t -= DT;
    else { fillInputs(); controlSystem(); physicsSystem(); ballSystem(); bubbleSystem(); goalSystem(); slowSystem(); effectsSystem(); particleSystem(); }
    pressed.clear();
  })()`);
  if (i % 30 === 0) { const s = snap(); s.climb = run('aiMem.climbing'); s.t = (i / 120).toFixed(1); ring.push(s); if (ring.length > Number(process.argv[6] ?? 16)) ring.shift(); }
  const now = lives();
  const own = now[1] < prev[1], scored = now[0] < prev[0];
  if ((which === 'own' && own) || (which === 'score' && scored) || (which === 'end' && i === 120 * Number(process.argv[5]) - 1)) {
    console.log(`${skill} seed ${seed}: ${which} goal at ${(i / 120).toFixed(1)}s. Last 4s (every 0.25s):`);
    for (const s of ring) console.log(`  t=${s.t.padStart(5)}  me=${String(s.me).padEnd(9)} ball=${String(s.ball).padEnd(9)} v=${String(s.v).padEnd(10)} input=${s.inp} climbing=${s.climb}`);
    break;
  }
  prev = now;
}
