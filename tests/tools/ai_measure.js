// Runs the real game (level.js + main.js + ai.js) headless with the AI as red (slot 1) vs an idle blue.
// Seeded randomness so results are repeatable. Reports goals for/against and time to the first goal.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..', '..') + '/';
const src = ['level.js', 'sprites.js', 'main.js', 'ai.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');

function rngFrom(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

function simulate(skill, seed, seconds, humanInput = null) {
  const noop = new Proxy({}, { get: () => () => {}, set: () => true });
  const M = Object.create(Math); M.random = rngFrom(seed);
  const sandbox = {
    console, Math: M, JSON, Set, Map, Object, Boolean, Number, Array, performance: { now: () => 0 },
    requestAnimationFrame: () => {}, addEventListener: () => {}, localStorage: { getItem: () => null },
    HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  vm.runInContext(`menu.open = false; ai.slot = 1; ai.skill = '${skill}'; aiReset(); round.t = 3;`, sandbox);
  const run = (c) => vm.runInContext(c, sandbox);
  const livesOf = () => JSON.parse(run('JSON.stringify([...query("lives","controls")].sort((a,b)=>a[2].slot-b[2].slot).map(e=>e[1].n))'));

  let scored = 0, conceded = 0, first = null, prev = livesOf(), games = 0;
  const steps = Math.round(seconds * 120);
  for (let i = 0; i < steps; i++) {
    run(`(function () {
      if (round.hit > 0) { round.hit -= DT; particleSystem(); if (round.hit <= 0) { resetSystem(); if (!round.winner) round.t = 3; } }
      else if (round.winner) { for (const [, l] of query('lives')) l.n = 3; round.winner = null; round.t = 3; }
      else if (round.t > 0) round.t -= DT;
      else { fillInputs(); ${humanInput ?? ''} controlSystem(); physicsSystem(); ballSystem(); bubbleSystem(); goalSystem(); slowSystem(); effectsSystem(); particleSystem(); }
      pressed.clear();
    })()`);
    const now = livesOf();
    if (now[0] < prev[0]) { scored++; first ??= i / 120; }            // blue (the human) lost a life: the AI scored
    if (now[1] < prev[1]) conceded++;                                  // red (the AI) lost a life
    if (now[0] === 3 && now[1] === 3 && (prev[0] < 3 || prev[1] < 3) && !(now[0] < prev[0] || now[1] < prev[1])) games++; // lives refilled = a game ended
    prev = now;
  }
  return { scored, conceded, first, games };
}

const SECONDS = 120, SEEDS = [1, 2, 3, 4, 5, 6];
console.log(`AI (red) vs an idle blue, ${SECONDS} simulated seconds, ${SEEDS.length} seeds each\n`);
const summary = {};
for (const skill of ['easy', 'normal', 'hard']) {
  const results = SEEDS.map((s) => simulate(skill, s, SECONDS));
  const sc = results.reduce((a, r) => a + r.scored, 0), co = results.reduce((a, r) => a + r.conceded, 0);
  const firsts = results.map((r) => (r.first === null ? 'never' : r.first.toFixed(0) + 's'));
  const zero = results.filter((r) => r.scored === 0).length;
  summary[skill] = { sc, co, zero };
  console.log(`${skill.padEnd(7)} goals scored ${String(sc).padStart(3)}  own goals ${String(co).padStart(3)}  seeds with no goal: ${zero}/${SEEDS.length}  first goal at: ${firsts.join(' ')}`);
}
