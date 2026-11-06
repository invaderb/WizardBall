// Runs the real game (level.js + main.js + ai.js) headless with the AI as red (slot 1) vs an idle blue.
// Seeded randomness so results are repeatable. Reports goals for/against and time to the first goal.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..', '..') + '/';
const src = ['level.js', 'sprites.js', 'main.js', 'ai.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');

function rngFrom(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

// The pre-rewrite AI, wrapped in its own scope so its names don't clash with ai.js. It plays blue (slot 0).
const oldSrc = fs.readFileSync(__dirname + '/ai_old.js', 'utf8');
const OLD_AI = `const oldAI = (function () {\n${oldSrc}\nreturn { aiInput, aiReset };\n})();`;

// opponent: 'idle' (blue never moves) or 'old' (blue is the old AI at the same skill). level: index into DEFAULT_LEVELS.
function simulate(skill, seed, seconds, opponent = 'idle', level = 0) {
  const humanInput = opponent === 'old' ? 'inputs[0] = oldAI.aiInput(0);' : null;
  const noop = new Proxy({}, { get: () => () => {}, set: () => true });
  const M = Object.create(Math); M.random = rngFrom(seed);
  const sandbox = {
    console, Math: M, JSON, Set, Map, Object, Boolean, Number, Array, performance: { now: () => 0 },
    requestAnimationFrame: () => {}, addEventListener: () => {}, localStorage: { getItem: () => null },
    HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  vm.runInContext(`for (const m of Object.values(components)) m.clear(); nextId = 0; LEVEL = DEFAULT_LEVELS[${level}]; loadLevel(LEVEL);`, sandbox);
  vm.runInContext(`menu.open = false; ai.slot = 1; ai.skill = '${skill}'; aiReset(); round.t = 3;`, sandbox);
  if (opponent === 'old') vm.runInContext(OLD_AI, sandbox);
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

//   node tests/tools/ai_measure.js [level index] [skill]     all built-in levels / skills if not given
const SECONDS = 120, SEEDS = [1, 2, 3, 4, 5, 6];
const levelNames = vm.runInNewContext(`${fs.readFileSync(dir + 'level.js', 'utf8')}; DEFAULT_LEVELS.map((l) => l.name)`, { localStorage: { getItem: () => null }, location: { search: '' } });
const levels = process.argv[2] !== undefined ? [Number(process.argv[2])] : levelNames.map((_, i) => i);
console.log(`AI (red) vs blue, ${SECONDS} simulated seconds x ${SEEDS.length} seeds. "for" = red scored, "against" = blue scored.`);
console.log('  vs idle: blue never moves, so every goal against is an own goal.  vs old: blue is the pre-rewrite AI at the same skill.\n');
for (const level of levels) {
  console.log(levelNames[level]);
  for (const skill of process.argv[3] ? [process.argv[3]] : ['easy', 'normal', 'hard']) {
    const line = ['idle', 'old'].map((opp) => {
      const results = SEEDS.map((s) => simulate(skill, s, SECONDS, opp, level));
      const sc = results.reduce((a, r) => a + r.scored, 0), co = results.reduce((a, r) => a + r.conceded, 0);
      return `vs ${opp.padEnd(4)} for ${String(sc).padStart(3)} against ${String(co).padStart(3)}`;
    });
    console.log(`  ${skill.padEnd(7)} ${line.join('    ')}`);
  }
}
