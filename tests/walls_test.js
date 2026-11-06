// Players must not get out of the arena where thin walls are stacked together, or by warping through a screen edge
// into a wall on the far side. Each case has its own small arena (so redesigning the built-in levels can't break
// it), built from the corners that let players out of the redesigned Classic. A mutant with the old collision rule
// put back shows the corner test really catches the bug.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const files = ['level.js', 'sprites.js', 'main.js'];
const realSrc = files.map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

function makeWorld(walls, source = realSrc) {
  const noop = new Proxy({}, { get: () => () => {}, set: () => true });
  const c = vm.createContext({ console, Math, JSON, Set, Map, Object, Boolean, Number, Array, performance: { now: () => 0 }, requestAnimationFrame: () => {}, addEventListener: () => {},
    localStorage: { getItem: () => null }, HTMLInputElement: class {}, document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } } });
  vm.runInContext(source, c);
  const run = (code) => vm.runInContext(code, c);
  run(`for (const m of Object.values(components)) m.clear(); nextId = 0;
    loadLevel({ walls: ${JSON.stringify(walls)}, ball: { x: 960, y: 100 }, goals: [], zones: [], slopes: [],
      players: [{ color: '#48f', x: 900, y: 900, hud: { x: 40, y: 60 }, keys: {} }, { color: '#f44', x: 960, y: 900, hud: { x: 1856, y: 60 }, keys: {} }] });
    globalThis.P = [...query('pos', 'controls', 'vel', 'body')].find((e) => e[2].slot === 0);
    globalThis.walls = [...query('pos', 'box', 'solid')].map(([, p, b]) => ({ x: p.x, y: p.y, w: b.w, h: b.h }));
    globalThis.put = (x, y, vx = 0, vy = 0) => { Object.assign(P[1], { x, y }); Object.assign(P[3], { x: vx, y: vy }); Object.assign(P[4], { ...NO_SLIDE, bubble: null }); };
    globalThis.step = (dir, jump) => { inputs[0] = { left: dir < 0, right: dir > 0, jump: !!jump }; inputs[1] = { left: false, right: false, jump: false }; controlSystem(); physicsSystem(); };
    globalThis.inWall = () => walls.some((w) => P[1].x < w.x + w.w && P[1].x + 32 > w.x && P[1].y < w.y + w.h && P[1].y + 48 > w.y);`);
  return run;
}

// ---- a hairline against the end of a shelf (Classic's right-hand goal frame) ----
// The shelf comes first in the level's wall list: bumping it zeroed vel.x, and the hairline then read that 0 as
// "moving left" and pushed the player out of its FAR side: through it, out of the arena.
const CORNER = [
  { x: 1824, y: 430, w: 96, h: 2 }, // shelf, running right from the hairline's foot
  { x: 1822, y: 184, w: 2, h: 248 }, // hairline wall, the arena's right side above the goal
  { x: 0, y: 960, w: 1920, h: 2 }, // floor
];
function cornerRuns(run) {
  let out = 0;
  for (let y = 384; y <= 430; y += 2) { // every height where the player's box overlaps the shelf's end (432 and below: under it, the open goal mouth)
    run(`put(1760, ${y}, 0, 0)`);
    for (let s = 0; s < 40; s++) {
      run('step(1, false); P[3].y = 0; P[1].y = ' + y); // hold right, at that height (no falling away from it)
      if (run('P[1].x + 32 > 1822')) { out++; break; }
    }
  }
  return out;
}
const real = makeWorld(CORNER);
check('running into a hairline stacked against the end of a shelf, at every height: never through it', cornerRuns(real) === 0);
real('put(1760, 404, 0, 0)');
for (let s = 0; s < 40; s++) real('step(1, false); P[3].y = 0; P[1].y = 404');
check('...it stops flush against the hairline', real('P[1].x') === 1822 - 32, String(real('P[1].x')));

// The mutant: the old rule (push out by vel.x, which the first wall zeroed) must fail this test.
const oldSrc = realSrc.replace('pos.x = pushOut(dx, pos.x, box.w, sp.x, sb.w);', 'pos.x = vel.x > 0 ? sp.x - box.w : sp.x + sb.w;');
check('(mutant: the old collision rule put back)', oldSrc !== realSrc);
check('...gets through that corner: the test above really catches the bug', cornerRuns(makeWorld(CORNER, oldSrc)) > 0);

// ---- the same, vertically: a shelf against the end of another shelf ----
const STACK = [
  { x: 500, y: 600, w: 200, h: 2 }, // a shelf...
  { x: 698, y: 602, w: 200, h: 2 }, // ...and another butted against its end, a pixel lower
  { x: 0, y: 960, w: 1920, h: 2 },
];
const v = makeWorld(STACK);
let through = 0;
for (let x = 660; x <= 700; x += 2) {
  v(`put(${x}, 520, 0, 0)`); // falling onto where the two meet
  for (let s = 0; s < 60; s++) { v('step(0, false); P[3].x = 0; P[1].x = ' + x); if (v('P[1].y + 48 > 604')) { through++; break; } }
}
check('falling onto the joint between two stacked shelves: never through them', through === 0, `${through} fell through`);

// ---- warping through a screen edge into a wall on the far side ----
const WRAP = [
  { x: -8, y: 430, w: 104, h: 2 }, // a shelf on the LEFT that runs past the edge of the screen
  { x: 0, y: 960, w: 1920, h: 2 },
];
const w = makeWorld(WRAP);
let inside = 0, warped = 0;
for (let y = 408; y <= 430; y += 2) { // heights where that shelf would be at head height on the far side: more than a step up (24px)
  w(`put(1860, ${y}, 0, 0)`);
  for (let s = 0; s < 60; s++) {
    w('step(1, false); P[3].y = 0; P[1].y = ' + y);
    if (w('inWall()')) { inside++; break; }
    if (w('P[1].x < 960')) { warped++; break; }
  }
}
check('walking out of the right edge with a wall at head height on the far side: you never warp into it', inside === 0 && warped === 0, `${inside} inside, ${warped} warped`);
check('...the edge acts as a wall: you stop at it, fully on screen', w('P[1].x') === 1920 - 32, String(w('P[1].x')));

// Ledges a few pixels apart across the edge (the two sides of a level are rarely lined up to the pixel: Pongz's top
// corners are 8px apart, Floor is Lava's 2px). Walking off one must still land you on the other, the same as walking
// up a bump of up to a step (24px), not be blocked while a jump at the same spot warps.
for (const [what, rightTop, leftTop] of [['8px higher (Pongz)', 200, 192], ['2px higher (Floor is Lava)', 190, 188], ['level with it', 300, 300], ['8px lower', 192, 200], ['a whole step (24px) higher', 300, 276]]) {
  const r = makeWorld([{ x: 1824, y: rightTop, w: 104, h: 40 }, { x: -8, y: leftTop, w: 104, h: 40 }, { x: 0, y: 960, w: 1920, h: 2 }]);
  r(`put(1850, ${rightTop - 48}, 0, 0)`);
  for (let s = 0; s < 10; s++) r('step(0, false)'); // standing on the right-hand ledge
  let came = false;
  for (let s = 0; s < 120 && !came; s++) { r('step(1, false)'); came = r('P[1].x < 960'); }
  for (let s = 0; s < 20; s++) r('step(0, false)');
  check(`walking off a ledge through the side edge, the far side's ledge ${what}: you come out standing on it`,
    came && r('P[4].grounded') && r('P[1].y') === leftTop - 48 && !r('inWall()'), `came out: ${came}, y ${r('P[1].y')} (ledge top ${leftTop})`);
}
w('put(1860, 700, 0, 0)'); // lower down, the far side is open
let out = false;
for (let s = 0; s < 60 && !out; s++) { w('step(1, false); P[3].y = 0; P[1].y = 700'); out = w('P[1].x < 960'); }
check('where the far side is open, warping through the edge still works (warp gaps)', out && !w('inWall()'));
w('put(400, 880, 0, 0)'); // and through the top/bottom: an open floor gap...
check('(the floor here is solid, so no warp down)', (() => { for (let s = 0; s < 120; s++) w('step(0, false)'); return w('P[1].y') === 960 - 48; })());

// ---- falling forever: through an open bottom, warping back to the top, again and again ----
// Gravity used to have no limit, so a long fall sped a player up until they moved further in one step than they are
// tall, and dropped straight through floors. Fall for 10s in a bottomless arena, then put a 2px floor under them.
function longFall(source) {
  const r = makeWorld([], source); // no walls at all: open top and bottom
  return JSON.parse(r(`(() => {
    put(944, 100, 0, 0);
    let fastest = 0, warps = 0, lastY = P[1].y;
    for (let s = 0; s < 120 * 10; s++) { step(0, false); fastest = Math.max(fastest, P[3].y); if (P[1].y < lastY - 300) warps++; lastY = P[1].y; }
    // a hairline floor just below wherever they are now, then a second to land on it
    const y = Math.min(P[1].y + 200, 900);
    spawn({ pos: { x: 0, y }, box: { w: 1920, h: 2 }, solid: true });
    walls.push({ x: 0, y, w: 1920, h: 2 });
    let through = 0; // steps that jumped from above the floor to below it without touching it
    for (let s = 0; s < 120; s++) { const top = P[1].y; step(0, false); if (top + 48 <= y && P[1].y >= y + 2 && P[1].y - top < 300) through++; }
    return JSON.stringify({ fastest, warps, through, landed: through === 0 && P[4].grounded && P[1].y === y - 48, y: P[1].y, floor: y });
  })()`));
}
const fall = longFall(realSrc);
check('falling for 10s through an open bottom (warping back to the top over and over): never faster than the terminal velocity', fall.warps >= 5 && fall.fastest <= 1000 && fall.fastest > 900, `${fall.warps} warps, fastest ${fall.fastest.toFixed(0)}px/s`);
check('...so after all that, they still land on a 2px floor instead of dropping through it', fall.landed, JSON.stringify(fall));
const uncapped = realSrc.replace('vel.y = Math.min(vel.y + 900 * DT, MAX_FALL);', 'vel.y += 900 * DT;');
check('(mutant: no terminal velocity)', uncapped !== realSrc);
const mutantFall = longFall(uncapped);
check('...falls straight through that floor: the test above really catches the bug', mutantFall.through > 0, JSON.stringify(mutantFall));

// the ball already has a speed cap (MAX_BALL_SPEED): the same fall can't speed it past that either
const b = makeWorld([]);
const ballFall = JSON.parse(b(`(() => {
  for (const [id] of query('controls')) despawn(id); // just the ball
  const [, bp, bv] = [...query('pos', 'vel', 'circle')][0]; Object.assign(bp, { x: 960, y: 100 }); Object.assign(bv, { x: 0, y: 0 });
  let fastest = 0, warps = 0, lastY = bp.y;
  for (let s = 0; s < 120 * 10; s++) { ballSystem(); fastest = Math.max(fastest, Math.hypot(bv.x, bv.y)); if (bp.y < lastY - 300) warps++; lastY = bp.y; }
  return JSON.stringify({ fastest, warps });
})()`));
check('the ball falling the same way stays under its own speed cap (1000px/s)', ballFall.warps >= 5 && ballFall.fastest <= 1000.001, `${ballFall.warps} warps, fastest ${ballFall.fastest.toFixed(0)}px/s`);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
