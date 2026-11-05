// Ramps and quarter-pipes (floor type): how a player rides them and how the ball rolls off them.
// Runs the real level.js + sprites.js + main.js headless. (Ceiling-type slopes are in shapes_test.js.)
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..') + '/';
const src = ['level.js', 'sprites.js', 'main.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

function run(testCode) {
  const noop = new Proxy({}, { get: () => () => {}, set: () => true });
  const sandbox = {
    console, Math, JSON, Set, Map, Object, Boolean, Number, Array, performance: { now: () => 0 }, requestAnimationFrame: () => {}, addEventListener: () => {},
    localStorage: { getItem: () => null }, HTMLInputElement: class {}, check,
    document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } },
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\n' + testCode, sandbox);
}

// A slope's world and a blue player we can drive step by step. The default level's platform is removed so it can't interfere.
const setup = (slope) => `
  const S = ${JSON.stringify(slope)};
  spawn({ slope: { ...S, pts: slopePoints(S) }, look: { color: '#fff' } });
  const [, pos, vel, box, body] = [...query('pos', 'vel', 'box', 'body')][0];
  for (const [id, p] of query('pos', 'box', 'solid')) if (p.y === 700) despawn(id);
  const step = (vx) => { if (vx !== undefined) vel.x = vx; physicsSystem(); };
`;
const RAMP = { x: 800, y: 776, w: 200, h: 200, high: 'right' }; // its base sits on the floor (y = 976)

run(setup(RAMP) + `
  pos.x = 700; pos.y = 928; vel.x = 0; vel.y = 0;
  for (let i = 0; i < 70; i++) step(450);
  check('run up a straight ramp: still on it, riding the surface (y between 725 and 745), grounded', body.grounded && pos.y > 725 && pos.y < 745 && pos.x > 940 && pos.x < 990, pos.x.toFixed(1) + ',' + pos.y.toFixed(1));
`);

run(setup(RAMP) + `
  pos.x = 900; pos.y = 796; vel.x = 0; vel.y = 0;
  for (let i = 0; i < 5; i++) step(0);
  let air = 0;
  for (let i = 0; i < 40; i++) { step(-450); if (!body.grounded) air++; }
  check('run DOWN the ramp: grounded on every step (so a jump still works), and ends on the floor', air === 0 && pos.y === 928, air + ' airborne steps, y=' + pos.y);
`);

run(setup(RAMP) + `
  pos.x = 1100; pos.y = 928; vel.x = 0; vel.y = 0;
  let minY = 1e9;
  for (let i = 0; i < 80; i++) { step(-450); minY = Math.min(minY, pos.y); }
  check("walking into the ramp's TALL face is a wall (stops at x ~ 1000), never a teleport onto the top", pos.x >= 1000 && pos.x < 1006 && minY === 928, 'x=' + pos.x.toFixed(1) + ' minY=' + minY);
`);

run(setup({ ...RAMP, high: 'left' }) + `
  pos.x = 1100; pos.y = 928; vel.x = 0; vel.y = 0;
  for (let i = 0; i < 70; i++) step(-450);
  check('a ramp tall on the LEFT mirrors it: run up it leftwards', body.grounded && pos.y > 750 && pos.y < 780 && pos.x < 900, pos.x.toFixed(1) + ',' + pos.y.toFixed(1));
`);

run(setup({ ...RAMP, curve: true }) + `
  pos.x = 700; pos.y = 928; vel.x = 0; vel.y = 0;
  let minY = 1e9;
  for (let i = 0; i < 140; i++) { step(450); minY = Math.min(minY, pos.y); }
  check('quarter-pipe: climbs well up it, but the near-vertical top blocks (never jumps onto the 728 top)', minY < 800 && minY > 735, 'min y=' + minY.toFixed(1));
`);

run(setup({ x: 700, y: 600, w: 200, h: 150, high: 'right' }) + `
  pos.x = 760; pos.y = 928; vel.x = 0; vel.y = -620;
  let minY = 1e9;
  for (let i = 0; i < 120; i++) { step(0); minY = Math.min(minY, pos.y); }
  check("jumping into the underside of a floating ramp: head bump at its base (y ~ 750), never through or onto it", minY >= 749 && minY < 752, 'min y=' + minY.toFixed(1));
`);

run(setup(RAMP) + `
  const [, bp, bv] = [...query('pos', 'vel', 'circle')][0];
  bp.x = 900; bp.y = 500; bv.x = 0; bv.y = 0;
  let worst = 1e9;
  for (let i = 0; i < 600; i++) {
    ballSystem();
    if (bp.x > S.x && bp.x < S.x + S.w) worst = Math.min(worst, slopeY(S, bp.x) - bp.y); // > 0 = the ball's centre is above the surface
  }
  check('the ball rolls down a ramp (ends left of it, on the floor) and its centre never sinks below the surface', bp.x < 800 && worst > -1 && bp.y > 940, 'x=' + bp.x.toFixed(0) + ' worst=' + worst.toFixed(2));
`);

run(setup({ ...RAMP, curve: true }) + `
  const [, bp, bv] = [...query('pos', 'vel', 'circle')][0];
  bp.x = 950; bp.y = 400; bv.x = -300; bv.y = 0;
  let worst = 1e9;
  for (let i = 0; i < 600; i++) {
    ballSystem();
    if (bp.x > S.x && bp.x < S.x + S.w) worst = Math.min(worst, slopeY(S, bp.x) - bp.y);
  }
  check('the ball against a quarter-pipe stays outside the curve', worst > -1, 'worst=' + worst.toFixed(2));
`);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
