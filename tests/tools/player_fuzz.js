// Fuzz test for PLAYERS: drive a player with random left/right/jump inputs through an arena and flag any step where it
// ends up inside a slope or wall, outside the arena, or teleports (the intended screen wrap through a goal gap is exempt).
//   node tests/tools/player_fuzz.js [players=200] [seed=1]
//   ARENA=simple  runs just the arenas whose name contains that;  TRACE=1  prints how the first failure happened.
// Each trial runs entirely inside the game's sandbox (one call), so it is fast enough for thousands of players.
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', '..') + '/';
const src = ['level.js', 'sprites.js', 'main.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');
const N = Number(process.argv[2] ?? 200), SEED = Number(process.argv[3] ?? 1);
let s = SEED >>> 0;
const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);

const noop = new Proxy({}, { get: () => () => {}, set: () => true });
const sb = { console, structuredClone, Math, JSON, Set, Map, Object, Boolean, Number, Array, performance: { now: () => 0 }, requestAnimationFrame: () => {}, addEventListener: () => {},
  localStorage: { getItem: () => null }, HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } } };
vm.createContext(sb); vm.runInContext(src, sb);
const run = (c) => vm.runInContext(c, sb);
const level = (i) => JSON.parse(run(`JSON.stringify(DEFAULT_LEVELS[${i}])`));
const classic = level(0);
const pipe = { x: 180, y: 180, w: 200, h: 192, high: 'left', curve: true, ceiling: true };
const ARENAS = [
  { label: 'Simple (the sample arena)', level: level(1), b: { x0: 88, x1: 1828, y0: 28, y1: 975 } },
  { label: 'Classic + ceiling pipe + flush hairlines', b: { x0: -40, x1: 1960, y0: -20, y1: 1002 },
    level: { ...classic, walls: [...classic.walls.filter((w) => w.y !== 700), { x: 380, y: 178, w: 1148, h: 2 }, { x: 178, y: 372, w: 2, h: 468 }], slopes: [pipe] } },
];
for (const o of [{ ceiling: false, high: 'left', curve: true }, { ceiling: false, high: 'right', curve: false }, { ceiling: true, high: 'right', curve: true }, { ceiling: true, high: 'left', curve: false }])
  ARENAS.push({ label: `Classic + ${o.ceiling ? 'ceiling' : 'floor'} ${o.curve ? 'pipe' : 'ramp'} tall ${o.high}`, b: { x0: -40, x1: 1960, y0: -20, y1: 1002 },
    level: { ...classic, walls: classic.walls.filter((w) => w.y !== 700), slopes: [{ x: 700, y: o.ceiling ? 600 : 700, w: 260, h: 250, ...o }] } });

// One trial, run inside the sandbox: returns null, or { why, hist }.
run(`globalThis.inAnySlope = (x, y) => { for (const [, s] of query('slope')) if (inPolygon(s.pts, x, y)) return true; return false; };
  globalThis.insideCount = (x, y) => [[2, 2], [30, 2], [2, 46], [30, 46], [16, 2], [16, 46], [2, 24], [30, 24], [16, 24]].filter(([dx, dy]) => inAnySlope(x + dx, y + dy)).length;
  // how far a solid wall overlaps the player's box (a few px is just resolution; a lot is being INSIDE it)
  globalThis.wallOverlap = (px, py) => { let worst = 0; for (const [, w, b] of query('pos', 'box', 'solid')) { const ox = Math.min(px + 32, w.x + b.w) - Math.max(px, w.x), oy = Math.min(py + 48, w.y + b.h) - Math.max(py, w.y); if (ox > 0 && oy > 0) worst = Math.max(worst, Math.min(ox, oy)); } return worst; };
  globalThis.trial = (x, y, dirs, jumps, b) => {
    const P = [...query('pos', 'controls', 'vel', 'body')].find((e) => e[2].slot === 0);
    P[1].x = x; P[1].y = y; P[3].x = 0; P[3].y = 0;
    let last = [x, y]; const hist = [];
    for (let i = 0; i < dirs.length; i++) {
      inputs[0] = { left: dirs[i] < 0, right: dirs[i] > 0, jump: !!jumps[i] };
      inputs[1] = { left: false, right: false, jump: false };
      controlSystem(); physicsSystem(); particleSystem(); bubbleFadeSystem(); // (jump bursts and bubbles must age away as in the game, or every query slows down)
      const px = P[1].x, py = P[1].y;
      hist.push('step ' + String(i).padStart(3) + ' pos (' + px.toFixed(1) + ', ' + py.toFixed(1) + ') v (' + P[3].x.toFixed(0) + ', ' + P[3].y.toFixed(0) + ') ' + (P[4].grounded ? 'grounded' : 'air') + ' input ' + (dirs[i] < 0 ? 'L' : dirs[i] > 0 ? 'R' : '-') + (jumps[i] ? 'J' : ''));
      if (hist.length > 8) hist.shift();
      let why = null;
      const n = insideCount(px, py), ov = wallOverlap(px, py), jump = Math.hypot(px - last[0], py - last[1]);
      if (n >= 2) why = 'box INSIDE a slope (' + n + ' of 9 sample points) at (' + px.toFixed(1) + ', ' + py.toFixed(1) + ')';
      else if (ov > 8) why = 'INSIDE a wall (overlap ' + ov.toFixed(1) + 'px) at (' + px.toFixed(1) + ', ' + py.toFixed(1) + ')';
      else if (Math.abs(px - last[0]) > 1900 && Math.abs(py - last[1]) < 40) { /* the screen wrap through a goal gap: intended */ }
      else if (jump > 40) why = 'TELEPORTED ' + jump.toFixed(0) + 'px in one step to (' + px.toFixed(1) + ', ' + py.toFixed(1) + ')';
      else if (px < b.x0 || px > b.x1 || py < b.y0 || py > b.y1) why = 'LEFT the arena to (' + px.toFixed(0) + ', ' + py.toFixed(0) + ')';
      if (why) return { why, hist };
      last = [px, py];
    }
    return null;
  };`);

let bad = 0, total = 0, traced = false; const failures = [];
for (const arena of ARENAS.filter((a) => !process.env.ARENA || a.label.toLowerCase().includes(process.env.ARENA.toLowerCase()))) {
  run(`for (const m of Object.values(components)) m.clear(); nextId = 0; loadLevel(${JSON.stringify(arena.level)});`);
  const { x0, x1, y0, y1 } = arena.b;
  let arenaBad = 0;
  for (let k = 0; k < N; k++) {
    let x, y, t = 0;
    do { x = x0 + 40 + rnd() * (x1 - x0 - 80); y = y0 + 60 + rnd() * (y1 - y0 - 120); }
    while (run(`insideCount(${x}, ${y}) > 0 || wallOverlap(${x}, ${y}) > 0`) && ++t < 60); // not overlapping anything to begin with
    const dirs = [], jumps = [];
    let dir = 0, hold = 0;
    for (let i = 0; i < 900; i++) {
      if (hold-- <= 0) { dir = [-1, 0, 1][Math.floor(rnd() * 3)]; hold = 10 + Math.floor(rnd() * 70); }
      dirs.push(dir); jumps.push(rnd() < 0.03 ? 1 : 0); // taps jump now and then (ground jump or air jump)
    }
    const r = run(`trial(${x}, ${y}, ${JSON.stringify(dirs)}, ${JSON.stringify(jumps)}, ${JSON.stringify(arena.b)})`);
    total++;
    if (r) {
      bad++; arenaBad++;
      if (!traced && process.env.TRACE) { traced = true; console.log(`first failure in ${arena.label}, last steps:\n  ${r.hist.join('\n  ')}\n  -> ${r.why}\n`); }
      if (failures.length < 12) failures.push(`[${arena.label}] start (${x.toFixed(0)},${y.toFixed(0)}): ${r.why}`);
    }
  }
  console.log(`${arena.label}: ${N} players, ${arenaBad} glitched`);
}
console.log(`\n${total} trials, ${bad} failures`);
for (const f of failures) console.log('  ' + f);
process.exit(bad ? 1 : 0);
