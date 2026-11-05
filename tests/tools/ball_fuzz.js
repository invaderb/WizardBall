// Fuzz test: throw lots of random balls (random start, direction and speed, plus random bubble pops) at an arena and
// report any ball that ends up INSIDE a slope's solid or OUTSIDE the arena's walls.
//   node tests/tools/ball_fuzz.js [balls-per-arena=300] [seed=1] [nobubbles]
// Arenas: the built-in "Simple" level (four quarter-pipes + hairline walls) and "Classic" with pipes added.
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', '..') + '/';
const src = ['level.js', 'sprites.js', 'main.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');
const N = Number(process.argv[2] ?? 300), SEED = Number(process.argv[3] ?? 1), BUBBLES = process.argv[4] !== 'nobubbles';
let s = SEED >>> 0;
const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);

const noop = new Proxy({}, { get: () => () => {}, set: () => true });
const sb = { console, structuredClone, Math, JSON, Set, Map, Object, Boolean, Number, Array, performance: { now: () => 0 }, requestAnimationFrame: () => {}, addEventListener: () => {},
  localStorage: { getItem: () => null }, HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } } };
vm.createContext(sb); vm.runInContext(src, sb);
const run = (c) => vm.runInContext(c, sb);

const level = (i) => JSON.parse(run(`JSON.stringify(DEFAULT_LEVELS[${i}])`));
const classic = level(0);
const ARENAS = [
  { label: 'Simple (the sample arena)', level: level(1), bounds: { x0: 90, x1: 1826, y0: 30, y1: 972 } },
  { label: 'Classic + a ceiling quarter-pipe and flush hairlines', bounds: { x0: -2, x1: 1922, y0: -2, y1: 1002, goalGap: true },
    level: { ...classic, walls: [...classic.walls.filter((w) => w.y !== 700), { x: 380, y: 178, w: 1148, h: 2 }, { x: 178, y: 372, w: 2, h: 468 }],
      slopes: [{ x: 180, y: 180, w: 200, h: 192, high: 'left', curve: true, ceiling: true }] } },
];

run(`globalThis.inAnySlope = (x, y) => { for (const [, s] of query('slope')) { const pts = s.pts; let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i].y > y) !== (pts[j].y > y) && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) c = !c;
  if (c) return true; } return false; };
  globalThis.inAnyWall = (x, y) => { for (const [, p, b] of query('pos', 'box', 'solid')) if (x >= p.x && x <= p.x + b.w && y >= p.y && y <= p.y + b.h) return true; return false; };`);

let bad = 0, total = 0;
const failures = [];
for (const arena of ARENAS) {
  run(`for (const m of Object.values(components)) m.clear(); nextId = 0; loadLevel(${JSON.stringify(arena.level)}); globalThis.B = [...query('pos','vel','circle')][0];`);
  const { x0, x1, y0, y1, goalGap } = arena.bounds;
  let arenaBad = 0;
  for (let k = 0; k < N; k++) {
    let x, y, tries = 0;
    do { x = x0 + 30 + rnd() * (x1 - x0 - 60); y = y0 + 30 + rnd() * (y1 - y0 - 60); } // somewhere playable, not inside a solid
    while ((run(`inAnySlope(${x}, ${y}) || inAnyWall(${x}, ${y})`)) && ++tries < 50);
    const a = rnd() * Math.PI * 2, v = 100 + rnd() * 900;
    run(`B[1].x = ${x}; B[1].y = ${y}; B[2].x = ${Math.cos(a) * v}; B[2].y = ${Math.sin(a) * v};`);
    let why = null;
    const hist = []; // the last few steps, to show how a failing ball got there
    for (let i = 0; i < 600 && !why; i++) {
      let popped = false;
      run('ballSystem(); bubbleFadeSystem();'); // (bubbles fade and disappear, as they do in the game)
      if (BUBBLES && rnd() < 0.012) { // a player's bubble pops the ball (this sets its velocity outright, up to ~625 px/s)
        const o = rnd() * 2 * Math.PI;
        popped = true;
        run(`spawn({ pos: { x: B[1].x - Math.cos(${o}) * 45, y: B[1].y - Math.sin(${o}) * 45 }, circle: { r: 50 }, bubble: { solid: true, t: 2, max: 2 }, look: { color: '#fff' } }); bubbleSystem();`);
      }
      const [bx, by, bvx, bvy] = JSON.parse(run('JSON.stringify([B[1].x, B[1].y, B[2].x, B[2].y])'));
      hist.push(`step ${String(i).padStart(3)}  pos (${bx.toFixed(1)}, ${by.toFixed(1)})  v (${bvx.toFixed(0)}, ${bvy.toFixed(0)})${popped ? '  <- BUBBLE POP this step' : ''}`);
      if (hist.length > 10) hist.shift();
      if (run(`[...query('pos', 'box', 'goal')].some(([, p, b, g]) => inShape(${bx}, ${by}, { x: p.x, y: p.y, w: b.w, h: b.h, shape: g.shape }))`)) break; // it scored: the round is over, not an escape
      const inGoalGap = goalGap && by > 740 && by < 1000 && (bx < 30 || bx > 1890);
      if (run(`inAnySlope(${bx}, ${by})`)) why = `centre INSIDE a slope at (${bx.toFixed(1)}, ${by.toFixed(1)}) on step ${i}`;
      else if (run(`inAnyWall(${bx}, ${by})`)) why = `centre INSIDE a wall at (${bx.toFixed(1)}, ${by.toFixed(1)}) on step ${i}`;
      else if (!inGoalGap && (bx < x0 || bx > x1 || by < y0 || by > y1)) why = `ESCAPED the arena to (${bx.toFixed(0)}, ${by.toFixed(0)}) on step ${i}`;
    }
    total++;
    if (why && !failures.length && process.env.TRACE) console.log(`first failure, last steps:\n  ${hist.join('\n  ')}\n  -> ${why}\n`);
    if (why) { bad++; arenaBad++; if (failures.length < 14) failures.push(`[${arena.label}] start (${x.toFixed(0)},${y.toFixed(0)}) v=${v.toFixed(0)} dir=${(a * 180 / Math.PI).toFixed(0)}deg: ${why}`); }
  }
  console.log(`${arena.label}: ${N} balls, ${arenaBad} escaped or went inside something`);
}
console.log(`\n${total} trials, ${bad} failures`);
for (const f of failures) console.log('  ' + f);
process.exit(bad ? 1 : 0);
