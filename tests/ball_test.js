// The ball must never end up inside a wall or a quarter-pipe, or on the far side of a thin wall ("glitching out of the game").
// Two causes were found and fixed; each has direct tests here, plus a fixed-seed fuzz of whole arenas, plus "mutants":
// the old behaviour put back in, to prove the tests would have caught it.
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..') + '/';
const { gameSource, TEST_ARENA, PIPES_ARENA } = require('./test_arena');
const src = gameSource(['level.js', 'sprites.js', 'main.js']); // the game, on the frozen test arena (tests/test_arena.js)

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

function makeWorld(levelJson) {
  const noop = new Proxy({}, { get: () => () => {}, set: () => true });
  const sb = { console, structuredClone, Math, JSON, Set, Map, Object, Boolean, Number, Array, performance: { now: () => 0 }, requestAnimationFrame: () => {}, addEventListener: () => {},
    localStorage: { getItem: () => null }, HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } } };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  const run = (c) => vm.runInContext(c, sb);
  if (levelJson) run(`for (const m of Object.values(components)) m.clear(); nextId = 0; loadLevel(${levelJson}); `);
  run(`globalThis.B = [...query('pos','vel','circle')][0]; globalThis.ball = (x, y, vx = 0, vy = 0) => { B[1].x = x; B[1].y = y; B[2].x = vx; B[2].y = vy; };
    globalThis.at = () => [B[1].x, B[1].y]; globalThis.polys = () => [...query('slope')].map((e) => e[1].pts);
    globalThis.inSlope = (x, y) => polys().some((p) => inPolygon(p, x, y)); globalThis.inWall = (x, y) => centreInSolid(x, y) && !inSlope(x, y);`);
  return run;
}
const classic = JSON.parse(JSON.stringify(TEST_ARENA)); // the frozen test arena, not whatever the first built-in level is today
const withSlope = (slope, walls = []) => JSON.stringify({ ...classic, walls: [...classic.walls.filter((w) => w.y !== 700), ...walls], slopes: [slope] });
const ORIENTATIONS = [];
for (const ceiling of [false, true]) for (const high of ['left', 'right']) for (const curve of [true, false])
  ORIENTATIONS.push({ x: 600, y: ceiling ? 120 : 640, w: 240, h: 200, high, curve, ...(ceiling ? { ceiling: true } : {}) });
const label = (o) => `${o.ceiling ? 'ceiling' : 'floor'} ${o.curve ? 'quarter-pipe' : 'ramp'} tall ${o.high}`;

// ===================== cause 1: the normal pointed INTO the solid =====================
{
  const run = makeWorld();
  let bad = 0, samples = 0;
  for (const o of ORIENTATIONS) {
    const pts = JSON.parse(run(`JSON.stringify(slopePoints(${JSON.stringify(o)}))`));
    for (let x = o.x - 40; x <= o.x + o.w + 40; x += 6) for (let y = o.y - 40; y <= o.y + o.h + 40; y += 6) {
      const c = JSON.parse(run(`JSON.stringify(polygonContact(${JSON.stringify(pts)}, ${x}, ${y}))`));
      samples++;
      const out = JSON.parse(run(`JSON.stringify(inPolygon(${JSON.stringify(pts)}, ${c.x + c.nx * 1.5}, ${c.y + c.ny * 1.5}))`));
      if (out) bad++; // a step along the "out" normal from the nearest point must LEAVE the solid
      if (c.inside !== JSON.parse(run(`JSON.stringify(inPolygon(${JSON.stringify(pts)}, ${x}, ${y}))`))) bad++;
      if (Math.abs(Math.hypot(c.nx, c.ny) - 1) > 1e-9) bad++;
    }
  }
  check(`polygonContact: for ${samples} points around all 8 ramp/pipe orientations (inside, outside, on the surface) the normal always points OUT of the solid`, bad === 0, `${bad} wrong`);
}
for (const o of ORIENTATIONS) {
  const run = makeWorld(withSlope(o));
  // the ball's centre exactly ON the surface, then 8px and 30px INSIDE the solid, along the surface normal
  const pts = JSON.parse(run(`JSON.stringify(slopePoints(${JSON.stringify(o)}))`));
  const mid = JSON.parse(run(`(() => { const p = ${JSON.stringify(pts)}; const i = Math.floor(p.length / 2) - 1; return JSON.stringify({ x: (p[i].x + p[i + 1].x) / 2, y: (p[i].y + p[i + 1].y) / 2 }); })()`));
  const c0 = JSON.parse(run(`JSON.stringify(polygonContact(${JSON.stringify(pts)}, ${mid.x}, ${mid.y}))`));
  let allOut = true, detail = '';
  for (const depth of [0, 8, 30]) {
    const x = mid.x - c0.nx * depth, y = mid.y - c0.ny * depth; // `depth` px into the solid
    run(`ball(${x}, ${y}, 0, 0); ballSystem();`);
    const [bx, by] = JSON.parse(run('JSON.stringify(at())'));
    const stillIn = run(`inSlope(${bx}, ${by})`);
    const dist = JSON.parse(run(`JSON.stringify(polygonContact(polys()[0], ${bx}, ${by}).dist)`));
    if (stillIn || dist < 21) { allOut = false; detail += ` [depth ${depth}: in=${stillIn} dist=${dist.toFixed(1)}]`; }
  }
  check(`${label(o)}: a ball with its centre on the surface / 8px / 30px inside is pushed OUT (not deeper in) and ends 22px clear`, allOut, detail);
}

// ===================== cause 2: a thin wall's "nearest face" can be the far side =====================
{
  const bar = { x: 400, y: 700, w: 400, h: 2 };
  const run = makeWorld(JSON.stringify({ ...classic, walls: [...classic.walls.filter((w) => w.y !== 700), bar], slopes: [] }));
  const ex = (px, py, qx, qy) => { run(`ball(${px}, ${py}); resolveBall(B[1], B[2], B[3], { x: ${qx}, y: ${qy} });`); return JSON.parse(run('JSON.stringify(at())')); };
  // centre inside the 2px bar (y 701 is 1px from the bottom face, 1px from the top: either way, "nearest" is a coin flip)
  let [, y] = ex(600, 700.4, 600, 650);
  check('a ball whose centre is inside a 2px bar, that came from ABOVE, leaves upward (y = 700 - 22), though the bottom face is not much farther', Math.abs(y - 678) < 1e-6, y.toFixed(2));
  [, y] = ex(600, 701.6, 600, 750);
  check('...and one that came from BELOW leaves downward (y = 702 + 22)', Math.abs(y - 724) < 1e-6, y.toFixed(2));
  const vwall = { x: 900, y: 300, w: 2, h: 300 };
  const run2 = makeWorld(JSON.stringify({ ...classic, walls: [...classic.walls.filter((w) => w.y !== 700), vwall], slopes: [] }));
  const ex2 = (px, py, qx, qy) => { run2(`ball(${px}, ${py}); resolveBall(B[1], B[2], B[3], { x: ${qx}, y: ${qy} });`); return JSON.parse(run2('JSON.stringify(at())')); };
  let [x] = ex2(900.4, 450, 850, 450);
  check('a vertical 2px wall: came from the LEFT -> leaves leftward even when the centre is nearer its right face', Math.abs(x - 878) < 1e-6, x.toFixed(2));
  [x] = ex2(901.6, 450, 950, 450);
  check('...came from the RIGHT -> leaves rightward', Math.abs(x - 924) < 1e-6, x.toFixed(2));
  [x] = ex2(900.4, 450, 900.5, 450); // no usable "came from" (it was inside before too)
  check('with no "came from" (already inside last step) it still leaves by the nearest face rather than staying stuck', x < 900 || x > 902);
  // the last line of defence: a step that would end with the centre in a wall is undone
  run('ball(600, 650, 0, 400);');
  let crossed = false;
  for (let i = 0; i < 200; i++) { run('ballSystem()'); if (JSON.parse(run('JSON.stringify(at())'))[1] > 702) crossed = true; }
  check('a ball dropped onto a 2px bar at 400 px/s and left to bounce for 1.7s never ends up below it', !crossed);
}

// ===================== bubble pops can't carry the ball through things =====================
function popScenario(label, levelJson, ballAt, bubbleAt, inSolid) {
  const run = makeWorld(levelJson);
  run(`ball(${ballAt[0]}, ${ballAt[1]}); for (let i = 0; i < 30; i++) ballSystem();`); // let it settle
  const [sx, sy] = JSON.parse(run('JSON.stringify(at())'));
  let bad = null;
  run(`spawn({ pos: { x: ${bubbleAt[0]}, y: ${bubbleAt[1]} }, circle: { r: 50 }, bubble: { solid: true, t: 2, max: 2 }, look: { color: '#fff' } });`);
  for (let i = 0; i < 60 && !bad; i++) {
    run('bubbleSystem(); ballSystem();');
    const [bx, by] = JSON.parse(run('JSON.stringify(at())'));
    if (run(`centreInSolid(${bx}, ${by})`) || inSolid(bx, by, sx, sy)) bad = `(${bx.toFixed(1)}, ${by.toFixed(1)}) after ${i + 1} steps`;
  }
  return { bad, run, label };
}
{
  const floor2 = JSON.stringify({ ...classic, walls: [{ x: 0, y: 968, w: 1920, h: 2 }, { x: 0, y: 0, w: 24, h: 1000 }, { x: 1896, y: 0, w: 24, h: 1000 }], slopes: [] });
  const below = (limit) => (bx, by) => by > limit;
  let r = popScenario('2px floor', floor2, [600, 946], [600, 900], below(970));
  check('a bubble popping a ball that rests on a 2px floor, from directly above: the ball stays above the floor (it used to be thrown 46px through it)', !r.bad, r.bad ?? '');
  r = popScenario('24px floor', JSON.stringify({ ...classic, slopes: [] }), [600, 954], [600, 905], below(1000));
  check('...the same on the normal 24px floor', !r.bad, r.bad ?? '');
  r = popScenario('2px side wall', JSON.stringify({ ...classic, walls: [{ x: 1000, y: 0, w: 2, h: 1000 }, ...classic.walls.filter((w) => w.y !== 700)], slopes: [] }), [978, 500], [930, 500], (bx) => bx > 1002);
  check('...a bubble to the left pressing the ball into a 2px wall on its right: the ball does not come out the far side', !r.bad, r.bad ?? '');
  const ramp = { x: 600, y: 700, w: 300, h: 200, high: 'right' };
  r = popScenario('ramp', withSlope(ramp), [760, 800], [760, 740], () => false);
  check('...a bubble pressing the ball down into a floor ramp: the centre never ends inside it', !r.bad, r.bad ?? '');
  const pipe = { x: 180, y: 180, w: 200, h: 192, high: 'left', curve: true, ceiling: true };
  r = popScenario('ceiling pipe', withSlope(pipe, [{ x: 380, y: 178, w: 1148, h: 2 }, { x: 178, y: 372, w: 2, h: 468 }]), [330, 225], [350, 190], () => false);
  check('...a bubble pushing the ball up into the ceiling quarter-pipe (with the flush hairlines): never inside it, never out', !r.bad, r.bad ?? '');
  // the pop still pops: velocity outward at 500+, and the ball is moved toward the bubble's surface when nothing is in the way
  const run = makeWorld(JSON.stringify({ ...classic, slopes: [] }));
  run('ball(900, 500); spawn({ pos: { x: 900, y: 460 }, circle: { r: 50 }, bubble: { solid: true, t: 2, max: 2 }, look: { color: "#fff" } }); bubbleSystem();');
  const [px, py, pvx, pvy] = JSON.parse(run('JSON.stringify([B[1].x, B[1].y, B[2].x, B[2].y])'));
  check('in open space a pop is unchanged: the ball ends at the bubble surface (72px from its centre) and is kicked away at 500+ px/s', Math.abs(Math.hypot(px - 900, py - 460) - 72) < 0.01 && Math.hypot(pvx, pvy) >= 500 && pvy > 0 && Math.abs(pvx) < 1e-9, `(${px},${py}) v(${pvx.toFixed(0)},${pvy.toFixed(0)})`);
}

// ===================== the wedge where a pipe meets a hairline =====================
{
  const pipe = { x: 180, y: 180, w: 200, h: 192, high: 'left', curve: true, ceiling: true };
  const run = makeWorld(withSlope(pipe, [{ x: 380, y: 178, w: 1148, h: 2 }, { x: 178, y: 372, w: 2, h: 468 }]));
  let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let stuck = 0, trials = 0;
  for (let k = 0; k < 120; k++) {
    // fired at the tangent corner (380, 180) from the open side, at all sorts of speeds and angles
    const x = 330 + rnd() * 200, y = 200 + rnd() * 120, a = Math.atan2(180 - y, 380 - x) + (rnd() - 0.5) * 1.2, v = 200 + rnd() * 800;
    run(`ball(${x}, ${y}, ${Math.cos(a) * v}, ${Math.sin(a) * v});`);
    let bad = false;
    for (let i = 0; i < 240 && !bad; i++) {
      run('ballSystem()');
      const [bx, by] = JSON.parse(run('JSON.stringify(at())'));
      if (run(`centreInSolid(${bx}, ${by})`) || by < 150 || bx < 150) bad = true;
    }
    trials++; if (bad) stuck++;
  }
  check('120 balls fired at the tangent wedge where the quarter-pipe meets the hairline bar: none ends inside either, none gets out', stuck === 0, `${stuck}/${trials}`);
}

// ===================== fixed-seed fuzz of whole arenas, with bubble pops =====================
{
  const simple = JSON.parse(JSON.stringify(PIPES_ARENA)); // the frozen original "Simple" (tests/test_arena.js)
  const ARENAS = [
    { name: 'Simple (four quarter-pipes + hairline walls)', level: simple, b: { x0: 90, x1: 1826, y0: 30, y1: 972 } },
    { name: 'Classic + ceiling pipe + flush hairlines', level: JSON.parse(withSlope({ x: 180, y: 180, w: 200, h: 192, high: 'left', curve: true, ceiling: true }, [{ x: 380, y: 178, w: 1148, h: 2 }, { x: 178, y: 372, w: 2, h: 468 }])), b: { x0: -2, x1: 1922, y0: -2, y1: 1002, gap: true } },
  ];
  let seed = 12345; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const A of ARENAS) {
    const run = makeWorld(JSON.stringify(A.level));
    let bad = 0, first = '';
    for (let k = 0; k < 50; k++) {
      let x, y, t = 0;
      do { x = A.b.x0 + 30 + rnd() * (A.b.x1 - A.b.x0 - 60); y = A.b.y0 + 30 + rnd() * (A.b.y1 - A.b.y0 - 60); } while (run(`centreInSolid(${x}, ${y})`) && ++t < 50);
      const a = rnd() * Math.PI * 2, v = 100 + rnd() * 900;
      run(`ball(${x}, ${y}, ${Math.cos(a) * v}, ${Math.sin(a) * v});`);
      let why = null;
      for (let i = 0; i < 400 && !why; i++) {
        run('ballSystem(); bubbleFadeSystem();');
        if (rnd() < 0.012) { const o = rnd() * 2 * Math.PI; run(`spawn({ pos: { x: B[1].x - Math.cos(${o}) * 45, y: B[1].y - Math.sin(${o}) * 45 }, circle: { r: 50 }, bubble: { solid: true, t: 2, max: 2 }, look: { color: '#fff' } }); bubbleSystem();`); }
        const [bx, by] = JSON.parse(run('JSON.stringify(at())'));
        if (run(`[...query('pos','box','goal')].some(([, p, b, g]) => inShape(${bx}, ${by}, { x: p.x, y: p.y, w: b.w, h: b.h, shape: g.shape }))`)) break; // scored
        if (run(`centreInSolid(${bx}, ${by})`)) why = `inside a solid at (${bx.toFixed(0)}, ${by.toFixed(0)})`;
        else if (!(A.b.gap && by > 740 && by < 1000 && (bx < 30 || bx > 1890)) && (bx < A.b.x0 || bx > A.b.x1 || by < A.b.y0 || by > A.b.y1)) why = `escaped to (${bx.toFixed(0)}, ${by.toFixed(0)})`;
      }
      if (why) { bad++; first ||= `start (${x.toFixed(0)},${y.toFixed(0)}) v=${v.toFixed(0)}: ${why}`; }
    }
    check(`fuzz, ${A.name}: 50 random balls x 400 steps with random bubble pops: none escapes or ends up inside a solid`, bad === 0, bad ? `${bad} failed; first: ${first}` : '');
  }
}

// ===================== mutants: the old behaviour must be CAUGHT =====================
{
  // 1. the old slope contact: the nearest-point direction used as "out" even from inside the solid
  const run = makeWorld(withSlope(ORIENTATIONS[4]));
  run(`const realContact = polygonContact; polygonContact = (pts, x, y) => { const c = realContact(pts, x, y); if (c.inside && c.dist > 1e-6) { c.nx = -c.nx; c.ny = -c.ny; } return c; };`);
  const o = ORIENTATIONS[4];
  const pts = JSON.parse(run(`JSON.stringify(slopePoints(${JSON.stringify(o)}))`));
  const i = Math.floor(pts.length / 2) - 1;
  const c0 = JSON.parse(run(`JSON.stringify(realContact(${JSON.stringify(pts)}, ${(pts[i].x + pts[i + 1].x) / 2}, ${(pts[i].y + pts[i + 1].y) / 2}))`));
  run(`ball(${(pts[i].x + pts[i + 1].x) / 2 - c0.nx * 8}, ${(pts[i].y + pts[i + 1].y) / 2 - c0.ny * 8}, 0, 0); ballSystem();`);
  const [bx, by] = JSON.parse(run('JSON.stringify(at())'));
  check('MUTANT (old slope normal): a ball 8px inside a slope ends up DEEPER inside it, so the "pushed out" test above would fail', run(`inSlope(${bx}, ${by})`) === true);
}
{
  // 2. the old moveBall: steps measured from the original start, forgetting any push-back
  const floor2 = JSON.stringify({ ...classic, walls: [{ x: 0, y: 968, w: 1920, h: 2 }], slopes: [] });
  const run = makeWorld(floor2);
  run(`moveBall = (pos, vel, ball, tx, ty) => { const sx = pos.x, sy = pos.y, steps = Math.max(1, Math.ceil(Math.hypot(tx - sx, ty - sy) / 4));
    for (let i = 1; i <= steps; i++) { const prev = { x: pos.x, y: pos.y }; pos.x = sx + ((tx - sx) * i) / steps; pos.y = sy + ((ty - sy) * i) / steps; resolveBall(pos, vel, ball, prev); } };`);
  run('ball(600, 946); spawn({ pos: { x: 600, y: 900 }, circle: { r: 50 }, bubble: { solid: true, t: 2, max: 2 }, look: { color: "#fff" } }); bubbleSystem();');
  check('MUTANT (old moveBall): the same pop throws the ball through the 2px floor, so the pop tests above would fail', JSON.parse(run('JSON.stringify(at())'))[1] > 970, JSON.stringify(run('at()')));
}
{
  // 3. no bubble glide at all (the original teleport)
  const floor2 = JSON.stringify({ ...classic, walls: [{ x: 0, y: 968, w: 1920, h: 2 }], slopes: [] });
  const run = makeWorld(floor2);
  run(`moveBall = (pos, vel, ball, tx, ty) => { pos.x = tx; pos.y = ty; };`);
  run('ball(600, 946); spawn({ pos: { x: 600, y: 900 }, circle: { r: 50 }, bubble: { solid: true, t: 2, max: 2 }, look: { color: "#fff" } }); bubbleSystem();');
  check('MUTANT (the original teleport): the ball lands 26px below the floor line', JSON.parse(run('JSON.stringify(at())'))[1] > 970);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
