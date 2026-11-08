// Players must never end up inside a quarter-pipe or a wall. The bug fixed here: a player jumping up into a ceiling
// quarter-pipe whose top edge has a flush hairline bar bumped the bar first, which zeroed the upward velocity, so the
// pipe code (which only pushed the head out if "moving up") left the player stuck inside the curve.
// Direct scenario, a fast fuzz of that corner, a fixed-seed fuzz of a whole arena, and a mutant that puts the old code back.
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..') + '/';
const { gameSource, PIPES_ARENA } = require('./test_arena');
const files = ['level.js', 'sprites.js', 'main.js'];
const realSrc = gameSource(files); // the game, on the frozen test arena (tests/test_arena.js)

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

function makeWorld(level, source = realSrc) {
  const noop = new Proxy({}, { get: () => () => {}, set: () => true });
  const sb = { console, structuredClone, Math, JSON, Set, Map, Object, Boolean, Number, Array, performance: { now: () => 0 }, requestAnimationFrame: () => {}, addEventListener: () => {},
    localStorage: { getItem: () => null }, HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } } };
  vm.createContext(sb);
  vm.runInContext(source, sb);
  const run = (c) => vm.runInContext(c, sb);
  run(`const lv = ${JSON.stringify(level)}; for (const m of Object.values(components)) m.clear(); nextId = 0; loadLevel(lv);
    globalThis.P = [...query('pos','controls','vel','body')].find((e) => e[2].slot === 0);
    globalThis.put = (x, y, vx = 0, vy = 0) => { P[1].x = x; P[1].y = y; P[3].x = vx; P[3].y = vy; };
    globalThis.step = (dir, jump) => { inputs[0] = { left: dir < 0, right: dir > 0, jump: !!jump }; inputs[1] = { left: false, right: false, jump: false }; controlSystem(); physicsSystem(); particleSystem(); bubbleFadeSystem(); /* jump bursts and bubbles must age away as in the game, or every query walks thousands of them */ };
    globalThis.inAnySlope = (x, y) => { for (const [, s] of query('slope')) if (inPolygon(s.pts, x, y)) return true; return false; };
    globalThis.insideCount = (x, y) => [[2, 2], [30, 2], [2, 46], [30, 46], [16, 2], [16, 46], [2, 24], [30, 24], [16, 24]].filter(([dx, dy]) => inAnySlope(x + dx, y + dy)).length;`);
  return run;
}

// ===================== the exact scenario from the trace =====================
{
  const run = makeWorld(PIPES_ARENA);
  // top-right corner of the Simple arena: the ceiling quarter-pipe (1616,34, 206x192, thick end right) with the hairline bar y 32..34 above it.
  // The player is up against the curve, one step after being blocked from moving right (its head 0.1px under the surface), and taps jump.
  // (Its jump's upward speed is given directly: holding right while jumping in the air is now a sideways dash, not up-and-right.)
  run('put(1630.4, 39.0, 0, -620); step(1, false);');
  const [x, y, vy] = JSON.parse(run('JSON.stringify([P[1].x, P[1].y, P[3].y])'));
  const surface = JSON.parse(run('JSON.stringify(slopeY([...query("slope")].find((e) => e[1].ceiling && e[1].x === 1616)[1], P[1].x + 32))'));
  check('jumping up into the curve under the flush hairline bar: the head stops AT the curve (not 6px inside it)', run(`insideCount(${x}, ${y})`) < 2 && y >= surface - 0.5, `y=${y.toFixed(2)} surface=${surface.toFixed(2)} inside points=${run(`insideCount(${x}, ${y})`)}`);
  check('...and it is no longer rising (the head bump took the upward speed)', vy >= 0, `vy=${vy}`);
  // and it can get out again afterwards: walk left, away from the corner
  run('for (let i = 0; i < 120; i++) step(-1, false);');
  check('...and the player can then walk away from the corner freely', run('P[1].x') < 1560 && run('insideCount(P[1].x, P[1].y)') === 0, `x=${run('P[1].x').toFixed(0)}`);
}

// ===================== the same situation in the other corners and orientations =====================
{
  // every corner of the Simple arena: the player jams itself into the corner with a held direction and repeated jumps
  // (from a start clear of the pipes: 880 overlapped the bottom ones, which only passed because a jump always went up)
  const run = makeWorld(PIPES_ARENA);
  const corners = [['top-left', 130, 60, -1], ['top-right', 1760, 60, 1], ['bottom-left', 140, 850, -1], ['bottom-right', 1740, 860, 1]];
  let bad = [];
  for (const [name, x, y, dir] of corners) {
    run(`put(${x}, ${y}, 0, 0);`);
    for (let i = 0; i < 600; i++) {
      run(`step(${dir}, ${i % 17 === 0});`);
      const n = run('insideCount(P[1].x, P[1].y)');
      if (n >= 2) { bad.push(`${name}: inside at step ${i}`); break; }
    }
  }
  check('jamming the player into each of the four corners with a held direction and repeated jumps: never inside a pipe', bad.length === 0, bad.join('; '));
}

// ===================== fast fuzz of the corner where it happened (and a mutant that must fail it) =====================
function cornerFuzz(run, seed, trials) {
  let s = seed >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  run(`globalThis.cornerTrial = (x, y, dirs, jumps) => { put(x, y, 0, 0); for (let i = 0; i < dirs.length; i++) { step(dirs[i], jumps[i]); if (insideCount(P[1].x, P[1].y) >= 2) return i; } return -1; };`);
  let bad = 0;
  for (let k = 0; k < trials; k++) {
    let x, y, t = 0;
    do { x = 1560 + rnd() * 240; y = 36 + rnd() * 260; } while (run(`insideCount(${x}, ${y}) > 0`) && ++t < 40);
    const dirs = [], jumps = []; let dir = 1, hold = 0;
    for (let i = 0; i < 260; i++) { if (hold-- <= 0) { dir = [-1, 0, 1, 1][Math.floor(rnd() * 4)]; hold = 5 + Math.floor(rnd() * 30); } dirs.push(dir); jumps.push(rnd() < 0.12); }
    if (run(`cornerTrial(${x}, ${y}, ${JSON.stringify(dirs)}, ${JSON.stringify(jumps)})`) >= 0) bad++;
  }
  return bad;
}
{
  const run = makeWorld(PIPES_ARENA);
  const bad = cornerFuzz(run, 99, 300);
  check('fuzz: 300 players thrown around the top-right pipe/hairline corner (random moves, 12% jump taps): none ends inside the curve', bad === 0, `${bad}/300`);

  // The mutant: the old rule, "push the head out only if it was moving up", measured AFTER the wall bump zeroed the speed.
  const oldRule = realSrc.replace('if (pen !== null && pen > 0) {\n\t\t\t\t\t\tpos.y += pen;\n\t\t\t\t\t\tif (vel.y < 0) vel.y = 0;\n\t\t\t\t\t}', 'if (pen !== null && pen > 0 && vel.y < 0) {\n\t\t\t\t\t\tpos.y += pen;\n\t\t\t\t\t\tvel.y = 0;\n\t\t\t\t\t}');
  if (oldRule === realSrc) check('MUTANT could not be built (the ceiling code changed shape): update this test', false);
  else {
    const mutantRun = makeWorld(PIPES_ARENA, oldRule);
    const mutantBad = cornerFuzz(mutantRun, 99, 300);
    check('MUTANT (the old "only if moving up" rule): the very same fuzz DOES catch players stuck inside the curve, so the check above has teeth', mutantBad > 0, `${mutantBad}/300 stuck with the old rule`);
    mutantRun('put(1630.4, 39.0, 0, -620); step(1, false);');
    check('MUTANT: and the exact scenario shows the head 5+px inside the curve', mutantRun('insideCount(P[1].x, P[1].y)') >= 2, `inside points=${mutantRun('insideCount(P[1].x, P[1].y)')}`);
  }
}

// ===================== fixed-seed fuzz of the whole arena =====================
{
  const run = makeWorld(PIPES_ARENA);
  run(`globalThis.arenaTrial = (x, y, dirs, jumps) => { put(x, y, 0, 0); let last = [x, y]; for (let i = 0; i < dirs.length; i++) { step(dirs[i], jumps[i]);
    const px = P[1].x, py = P[1].y;
    if (insideCount(px, py) >= 2) return 'inside a slope at (' + px.toFixed(0) + ', ' + py.toFixed(0) + ')';
    if (Math.abs(px - last[0]) < 1900 && Math.hypot(px - last[0], py - last[1]) > 40) return 'teleported to (' + px.toFixed(0) + ', ' + py.toFixed(0) + ')';
    if (px < 88 || px > 1828 || py < 28 || py > 975) return 'left the arena to (' + px.toFixed(0) + ', ' + py.toFixed(0) + ')';
    last = [px, py]; } return null; };`);
  let s = 424242; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let bad = 0, first = '';
  for (let k = 0; k < 24; k++) {
    let x, y, t = 0;
    do { x = 130 + rnd() * 1600; y = 60 + rnd() * 860; } while (run(`insideCount(${x}, ${y}) > 0`) && ++t < 60);
    const dirs = [], jumps = []; let dir = 0, hold = 0;
    for (let i = 0; i < 700; i++) { if (hold-- <= 0) { dir = [-1, 0, 1][Math.floor(rnd() * 3)]; hold = 10 + Math.floor(rnd() * 70); } dirs.push(dir); jumps.push(rnd() < 0.03); }
    const r = run(`arenaTrial(${x}, ${y}, ${JSON.stringify(dirs)}, ${JSON.stringify(jumps)})`);
    if (r) { bad++; first ||= r; }
  }
  check('fuzz: 24 players x 700 steps of random running and jumping around the whole Simple arena: none glitches', bad === 0, bad ? `${bad} failed; first: ${first}` : '');
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
