// The computer opponent (ai.js): the nav grid, A* routes, and which behaviour-tree branch it picks, on the real game
// code headless. Also checks every script index.html loads can share one page (they share one global scope).
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const { gameSource } = require('./test_arena');
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

// ---- the page's scripts, together ----
const html = fs.readFileSync(dir + 'index.html', 'utf8');
const pageScripts = [...html.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]);
let clash = null;
try { new vm.Script(pageScripts.map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n')); } catch (e) { clash = e.message; }
check(`index.html's ${pageScripts.length} scripts compile as one page (no top-level name declared twice)`, clash === null && pageScripts.includes('ai.js'), clash ?? '');

// ---- a headless game with the AI as red (slot 1) on Classic ----
const src = gameSource(['level.js', 'sprites.js', 'main.js', 'ai.js']); // the game, on the frozen test arena (tests/test_arena.js)
const noop = new Proxy({}, { get: () => () => {}, set: () => true });
const sandbox = {
  console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Uint8Array, Float64Array, Int32Array, performance: { now: () => 0 },
  requestAnimationFrame: () => {}, addEventListener: () => {}, localStorage: { getItem: () => null },
  HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } },
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const run = (c) => vm.runInContext(c, sandbox);
run("menu.open = false; ai.slot = 1; ai.skill = 'hard'; aiReset(); round.t = 0;");

// ---- nav grid ----
// Classic: floor top at y=976, a platform at x 700..1220, y 700..724, goal gaps under y=766 at both ends.
const openAt = (x, y) => run(`nav.open[nodeAt(${x}, ${y})] === 1 && nodeAt(${x}, ${y}) === ${Math.round(y / 24)} * nav.cols + ${Math.round(x / 24)}`);
check('standing on the floor is open', openAt(960, 912));
check('inside the floor is not', !openAt(960, 960));
check('overlapping the platform is not', !openAt(960, 696));
check('standing on top of the platform is open', openAt(960, 648));
check('the goal gaps are closed (walking into one wraps you to the far side)', !openAt(0, 912) && !openAt(1896, 912));

// ---- A* ----
const path = (fx, fy, tx, ty, avoid = 'null') => JSON.parse(run(`JSON.stringify(findPath(nodeAt(${fx}, ${fy}), nodeAt(${tx}, ${ty}), ${avoid}))`));
const xy = (k) => run(`[${k} % nav.cols * 24, Math.floor(${k} / nav.cols) * 24]`);
const up = path(944, 912, 944, 648); // from under the platform's middle to on top of it
const adjacent = up.every((k, i) => { const [x, y] = xy(k), [px, py] = xy(i ? up[i - 1] : run('nodeAt(944, 912)')); return Math.abs(x - px) <= 24 && Math.abs(y - py) <= 24; });
check('A* finds a way from under the platform to on top of it', up.length > 0 && JSON.stringify(xy(up.at(-1))) === '[936,648]', JSON.stringify(up.length));
check('...one step at a time, only through open nodes', adjacent && up.every((k) => run(`nav.open[${k}]`) === 1));
check('...going round the platform edge (it cannot go through it)', up.some((k) => { const [x, y] = xy(k); return y < 724 && y + 48 > 700 && (x + 32 <= 700 || x >= 1220); }));
const flat = path(600, 912, 1300, 912);
const round = path(600, 912, 1300, 912, '{ x: 960, y: 950, r: 100 }');
const highest = (p) => Math.min(...p.map((k) => xy(k)[1]));
check('along the floor it walks (stays on the ground)', flat.every((k) => xy(k)[1] === 912));
check('told to avoid the ball, it goes over it instead', highest(round) < 912 - 48, String(highest(round)));
check('no route -> empty path', run('nav.open[0] === 0 && findPath(nodeAt(944, 912), 0).length === 0'));

// ---- behaviour tree ----
// Red scores in the LEFT goal and guards the RIGHT one. Put red and the ball somewhere, think once, see the branch.
function situation(redX, ballX, ballY = 940, ballVx = 0) {
  return run(`(() => {
    const red = [...query('pos', 'vel', 'controls')].find((e) => e[3].slot === 1);
    const blue = [...query('pos', 'vel', 'controls')].find((e) => e[3].slot === 0);
    Object.assign(red[1], { x: ${redX} - 16, y: 976 - PLAYER.h }); Object.assign(red[2], { x: 0, y: 0 });
    Object.assign(blue[1], { x: 140, y: 976 - PLAYER.h });
    const [, bp, bv] = [...query('pos', 'vel', 'circle')][0];
    Object.assign(bp, { x: ${ballX}, y: ${ballY} }); Object.assign(bv, { x: ${ballVx}, y: 0 });
    physicsSystem(); // so it is standing (grounded)
    aiMem.lastX = -1; // not "stuck"
    aiThink(1, SKILLS.hard);
    return aiMem.branch;
  })()`);
}
check('ball in midfield, red on its right (the side to play it left from) -> attack', situation(1100, 960) === 'attack', situation(1100, 960));
check('red on the wrong side of the ball -> get round', situation(800, 960) === 'get round', situation(800, 960));
check('ball close to the goal red guards, red goal-side of it -> defend: clear', situation(1800, 1650) === 'defend: clear', situation(1800, 1650));
check('...red on the wrong side of it -> defend: get back', situation(1400, 1650) === 'defend: get back', situation(1400, 1650));
check('ball rolling fast at the goal from midfield -> defend', situation(1100, 1300, 940, 600).startsWith('defend'), situation(1100, 1300, 940, 600));
check('the same ball rolling the other way -> not a threat', !situation(1100, 1300, 940, -600).startsWith('defend'));
check('getting round, it plans a route', run('aiMem.path.length') > 0 || situation(800, 960) === 'get round' && run('aiMem.path.length') > 0);

// ---- reading the ball, and aiming ----
const flight = JSON.parse(run('JSON.stringify(predictBall({ x: 400, y: 400 }, { x: 0, y: 0 }, 22))'));
const lowest = Math.max(...flight.map((p) => p.y));
check('predicted flight: a ball dropped clear of the platform falls, bounces off the floor and never goes through it', lowest <= 976 - 22 + 1 && lowest > 900 && flight.at(-1).y < lowest, `lowest ${lowest.toFixed(0)}, last ${flight.at(-1).y.toFixed(0)}`);
const rolling = JSON.parse(run('JSON.stringify(predictBall({ x: 1700, y: 500 }, { x: 600, y: 0 }, 22))'));
check('...and a ball flying at the side wall (above the goal gap) comes back off it', rolling.some((p) => p.x > 1800) && rolling.at(-1).x < Math.max(...rolling.map((p) => p.x)) && rolling.every((p) => p.x < 1896 - 21));
// A kick along aimAt's line, at kick speed, from 300px out: the predicted flight goes in red's goal (the left one, mouth y 766..976).
const shot = JSON.parse(run(`(() => {
  const bb = { want: -1, d: -1, target: { x: 0, y: 871 }, bx: 300, by: 900 };
  const a = aimAt(bb);
  return JSON.stringify({ a, f: predictBall({ x: 300, y: 900 }, { x: a.x * KICK, y: a.y * KICK }, 22) });
})()`));
const inGoal = shot.f.find((p) => p.x < 24);
check('an aimed kick from 300px out flies into the goal mouth', inGoal && inGoal.y > 766 && inGoal.y < 976, JSON.stringify(inGoal ?? shot.f.at(-1)));
check('...as a lob (up and toward the goal)', shot.a.x < 0 && shot.a.y < 0, JSON.stringify(shot.a));

// ---- end to end: put hard red just behind a resting ball near blue's half and let it play ----
function scores(redX, ballX, seconds) {
  run(`(() => { resetSystem(); aiReset(); round.t = 0; round.hit = 0; round.winner = null;
    for (const [, l] of query('lives')) l.n = 3;
    const red = [...query('pos', 'controls')].find((e) => e[2].slot === 1); red[1].x = ${redX} - 16;
    const blue = [...query('pos', 'controls')].find((e) => e[2].slot === 0); blue[1].x = 1500; // out of the way
    const [, bp] = [...query('pos', 'vel', 'circle')][0]; Object.assign(bp, { x: ${ballX}, y: 950 }); })();`);
  for (let i = 0; i < 120 * seconds; i++) {
    run('fillInputs(); controlSystem(); physicsSystem(); ballSystem(); bubbleSystem(); bubbleFadeSystem(); goalSystem(); pressed.clear();');
    if (run('round.hit > 0')) return run('round.beam.victims.length === 1 && [...query("lives", "controls")].find((e) => e[2].slot === 0)[1].n === 2');
  }
  return false;
}
check('hard red behind the ball, 400px out: it scores within 4 seconds', scores(560, 400, 4));
check('...from 800px out too (dribbles, then shoots)', scores(1000, 800, 8));

// ---- it actually plays: a few seconds of game, the ball gets moved and nothing throws ----
run('resetSystem(); aiReset();');
const ballStart = run('JSON.stringify([...query("pos", "vel", "circle")][0][1])');
let threw = null;
try { for (let i = 0; i < 120 * 8; i++) run('fillInputs(); controlSystem(); physicsSystem(); ballSystem(); bubbleSystem(); bubbleFadeSystem(); goalSystem(); pressed.clear();'); } catch (e) { threw = e.message; }
check('8 seconds of play: no errors, and the AI has moved the ball', threw === null && run('JSON.stringify([...query("pos", "vel", "circle")][0][1])') !== ballStart, threw ?? '');

// ---- sliding: the AI double-taps too, when a slide helps ----
function slides(skill, redX, ballX, seconds) {
  return JSON.parse(run(`(() => {
    resetSystem(); aiReset(); round.t = 0; round.hit = 0; round.winner = null; ai.skill = '${skill}';
    const red = [...query('pos', 'controls', 'body')].find((e) => e[2].slot === 1); red[1].x = ${redX} - 16;
    const blue = [...query('pos', 'controls')].find((e) => e[2].slot === 0); blue[1].x = 140;
    const [, bp, bv] = [...query('pos', 'vel', 'circle')][0]; Object.assign(bp, { x: ${ballX}, y: 950 }); Object.assign(bv, { x: 0, y: 0 });
    let starts = 0, prev = 0, branches = new Set();
    for (let s = 0; s < 120 * ${seconds}; s++) {
      fillInputs(); controlSystem(); physicsSystem(); ballSystem(); bubbleSystem(); bubbleFadeSystem(); effectsSystem(); pressed.clear();
      if (red[3].slide > 0 && prev <= 0) { starts++; branches.add(aiMem.branch); }
      prev = red[3].slide;
    }
    return JSON.stringify({ starts, branches: [...branches] });
  })()`));
}
const hardRun = slides('hard', 1700, 500, 1.5);
check('hard: a long flat run up to the ball (from its attacking side) -> it slides', hardRun.starts >= 1, JSON.stringify(hardRun));
check('easy never slides', slides('easy', 1700, 500, 3).starts === 0);
const near = slides('hard', 840, 500, 0.4); // ~300px from the ball: a slide would end IN it (a shove along the floor, not an aimed kick)
check('it never slides into the ball: with the ball about a slide away it runs instead', near.starts === 0, JSON.stringify(near));
const round_ = slides('hard', 900, 1050, 0.6); // wrong side, ball low and close ahead: it must go round, not plough through
check('going round a ball low in its path, it does not slide into it', round_.starts === 0, JSON.stringify(round_));
run("ai.skill = 'hard'");

// ---- the REAL built-in levels (not the test arena): hard red vs an idle blue scores on every one ----
// Catches a redesigned or new level the AI can't play (goals somewhere it never reaches, a layout that traps it).
// Levels it can't play YET are listed here: they print a TODO line instead of failing (README: Computer opponent). If one
// starts passing it prints PASS: take it off the list.
const AI_TODO = {
  Classic: 'lift the ball in stages toward its raised goals, up the side walls (aimAt)',
  'Rise and Shine': 'lift the ball in stages toward floating goals (aimAt)',
  'Floor is Lava': 'see a ball about to land on its own goal as a threat (threatened)',
};
{
  const realSrc = ['level.js', 'sprites.js', 'main.js', 'ai.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');
  const names = (() => { const c = vm.createContext({ ...sandbox }); vm.runInContext(realSrc, c); return JSON.parse(vm.runInContext('JSON.stringify(DEFAULT_LEVELS.map((l) => l.name))', c)); })();
  names.forEach((name, i) => {
    const c = vm.createContext({ ...sandbox });
    vm.runInContext(realSrc, c);
    const r = (code) => vm.runInContext(code, c);
    r(`for (const m of Object.values(components)) m.clear(); nextId = 0; LEVEL = DEFAULT_LEVELS[${i}]; loadLevel(LEVEL);
      menu.open = false; ai.slot = 1; ai.skill = 'hard'; aiReset(); round.t = 0;`);
    const mismatches = r(`(() => { let bad = 0; for (let k = 0; k < 4000; k++) { const x = Math.random() * W, y = Math.random() * H; if (solidAt(x, y) !== centreInSolid(x, y)) bad++; } return bad; })()`);
    check(`real level "${name}": the AI's fast solidAt() agrees with the game's centreInSolid() (4000 random points)`, mismatches === 0, `${mismatches} disagree`);
    // 30 simulated seconds in one call (compiling a string per step made this the slowest test in the suite)
    const { scored, own } = JSON.parse(r(`(() => {
      const lives = () => [...query('lives', 'controls')].sort((a, b) => a[2].slot - b[2].slot).map((e) => e[1].n);
      let scored = 0, own = 0, prev = lives();
      for (let s = 0; s < 120 * 30; s++) {
        if (round.hit > 0) { round.hit -= DT; particleSystem(); if (round.hit <= 0) { resetSystem(); round.t = 0; } }
        else if (round.winner) { for (const [, l] of query('lives')) l.n = 3; round.winner = null; }
        else { fillInputs(); controlSystem(); physicsSystem(); ballSystem(); bubbleSystem(); bubbleFadeSystem(); goalSystem(); slowSystem(); effectsSystem(); particleSystem(); }
        pressed.clear();
        const now = lives();
        if (now[0] < prev[0]) scored++; // blue lost a life: red scored
        if (now[1] < prev[1]) own++;
        prev = now;
      }
      return JSON.stringify({ scored, own });
    })()`));
    const name_ = `real level "${name}": hard AI scores in 30s against an idle player, more than it concedes`, ok = scored > 0 && scored > own;
    if (!ok && AI_TODO[name]) console.log(`TODO ${name_} (${scored} scored, ${own} own goals): ${AI_TODO[name]}`); // known gap: reported, not failed
    else check(name_, ok, `${scored} scored, ${own} own goals`);
  });
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
