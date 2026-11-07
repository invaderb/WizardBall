// The ball pinned where a wall meets a quarter-pipe (by players, or their bubbles) must not get out of the arena.
// Two ways it used to: a player shoved its centre clean through a 2px wall (and the wall, seeing it on its far side,
// pushed it on out), or a push carried it across a quarter-pipe's thin tip. Runs on the frozen original "Simple"
// (tests/test_arena.js): four quarter-pipes with hairline walls flush against them. Mutants show each check bites.
const fs = require('fs'), vm = require('vm');
const { gameSource, PIPES_ARENA } = require('./test_arena');
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

function makeWorld(patch = '') {
  const noop = new Proxy({}, { get: () => () => {}, set: () => true });
  const c = vm.createContext({ console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Uint8Array, Int32Array, performance: { now: () => 0 }, requestAnimationFrame: () => {},
    addEventListener: () => {}, localStorage: { getItem: () => null }, HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } } });
  vm.runInContext(gameSource(['level.js', 'sprites.js', 'main.js']), c);
  const run = (code) => vm.runInContext(code, c);
  run(`for (const m of Object.values(components)) m.clear(); nextId = 0; loadLevel(${JSON.stringify(PIPES_ARENA)});
    globalThis.B = [...query('pos', 'vel', 'circle')][0];
    globalThis.P = [0, 1].map((slot) => [...query('pos', 'controls', 'vel', 'body')].find((e) => e[2].slot === slot));
    ${patch}`);
  return run;
}

// ---- a player shoves the ball through the 2px wall beside a quarter-pipe (the exact step that let it out) ----
// The left wall is x 92..94; the ball sits just inside it, a player right up against it, running left.
const squeeze = (patch) => {
  const run = makeWorld(patch);
  return run(`(() => {
    Object.assign(B[1], { x: 116, y: 739 }); Object.assign(B[2], { x: -40, y: 0 });
    Object.assign(P[0][1], { x: 126 - 16, y: 742 - 24 }); Object.assign(P[0][3], { x: -962, y: -274 });
    Object.assign(P[1][1], { x: 900, y: 900 });
    ballSystem();
    return B[1].x;
  })()`);
};
check('a player shoving the ball into the 2px wall beside a quarter-pipe: it stays on the arena side', squeeze('') >= 94 + 22 - 1e-6, String(squeeze('')));
check('MUTANT (no wall-crossing guard): it ends up out past the wall, so the check above bites', squeeze('entryFace = () => null;') < 92, String(squeeze('entryFace = () => null;')));

// ---- a push carries the ball's centre right across a quarter-pipe's thin tip ----
// The bottom-left pipe tapers to a tip at its low end; there's no floor under x < 256 here, just the pipe.
const tip = (patch) => {
  const run = makeWorld(patch);
  return JSON.parse(run(`(() => {
    const s = [...query('slope')].map(([, s]) => s).find((s) => s.x === 94 && s.y === 776);
    const x = 250, surface = slopeY(s, x); // the pipe at x = 250 is only a few px thick: surface .. 968
    const prev = { x, y: surface - 10 }, pos = B[1];
    Object.assign(pos, { x, y: 968 + 15 }); Object.assign(B[2], { x: 0, y: 400 });
    resolveBall(pos, B[2], B[3], prev);
    return JSON.stringify({ y: pos.y, surface });
  })()`));
};
const t = tip('');
check('the ball shoved across a quarter-pipe\'s thin tip in one step goes back on the side it came from (above)', t.y < t.surface, JSON.stringify(t));
check('MUTANT (no ramp-crossing guard): it stays out under the pipe, so the check above bites', tip('throughPolygon = () => null;').y > 968);

// ---- a small fuzz: both players (and their bubbles) pinning the ball into the quarter-pipes ----
// Where can the ball's centre be? Every pixel not in a wall or ramp that's reachable from its spawn: anywhere else is out.
const run = makeWorld();
const escaped = JSON.parse(run(`(() => {
  let seed = 3; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const solid = new Uint8Array(W * H);
  for (const [, p, b] of query('pos', 'box', 'solid')) for (let y = Math.max(0, Math.floor(p.y)); y < Math.min(H, Math.ceil(p.y + b.h)); y++) for (let x = Math.max(0, Math.floor(p.x)); x < Math.min(W, Math.ceil(p.x + b.w)); x++) solid[y * W + x] = 1;
  const slopes = [...query('slope')].map(([, s]) => s);
  for (const s of slopes) for (let y = Math.max(0, Math.floor(s.y)); y < Math.min(H, Math.ceil(s.y + s.h)); y++) for (let x = Math.max(0, Math.floor(s.x)); x < Math.min(W, Math.ceil(s.x + s.w)); x++) if (inPolygon(s.pts, x + 0.5, y + 0.5)) solid[y * W + x] = 1;
  const reach = new Uint8Array(W * H), queue = new Int32Array(W * H);
  let qh = 0, qt = 0; const start = 304 * W + 1008; reach[start] = 1; queue[qt++] = start;
  while (qh < qt) { const k = queue[qh++], x = k % W, y = (k - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (!reach[n] && !solid[n]) { reach[n] = 1; queue[qt++] = n; } } }
  const out = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !reach[Math.floor(y) * W + Math.floor(x)];
  const bp = B[1], bv = B[2];
  let runs = 0, escapes = [];
  while (runs < 60) {
    const s = slopes[Math.floor(rnd() * slopes.length)];
    const x = s.x - 40 + rnd() * (s.w + 80), y = s.y - 40 + rnd() * (s.h + 80);
    if (out(x, y) || x < 30 || x > W - 30 || y < 30 || y > H - 30) continue;
    runs++;
    for (const [id] of query('bubble')) despawn(id);
    Object.assign(bp, { x, y }); Object.assign(bv, { x: 0, y: 0 });
    P.forEach((p, i) => { Object.assign(p[1], { x: x - 16 + (i ? 60 : -60) + (rnd() - 0.5) * 40, y: y - 24 + (rnd() - 0.5) * 60 }); Object.assign(p[3], { x: 0, y: 0 }); Object.assign(p[4], { ...NO_SLIDE, bubble: null }); });
    const jumps = [rnd() * 0.15, rnd() * 0.15];
    let prev = { x, y };
    for (let st = 0; st < 120 * 3; st++) {
      P.forEach((p, i) => { const d = Math.sign(bp.x - (p[1].x + 16)) || 1; inputs[i] = { left: d < 0, right: d > 0, jump: rnd() < jumps[i] }; });
      controlSystem(); physicsSystem(); ballSystem(); bubbleSystem(); bubbleFadeSystem();
      for (const [id] of query('particle')) despawn(id);
      const wrapped = Math.abs(bp.x - prev.x) > 400 || Math.abs(bp.y - prev.y) > 400;
      if (!wrapped && out(bp.x, bp.y)) { escapes.push([Math.round(prev.x), Math.round(prev.y), Math.round(bp.x), Math.round(bp.y)]); break; }
      prev = { x: bp.x, y: bp.y };
    }
  }
  return JSON.stringify(escapes);
})()`));
check('60 random pin-ups (both players pushing in, air-jumping bubbles at it) near the quarter-pipes: the ball never gets out', escaped.length === 0, JSON.stringify(escaped));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
