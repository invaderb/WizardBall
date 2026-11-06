// The slide: double-tap left or right on the ground for a burst of speed. Real level.js + sprites.js + main.js +
// online.js, on a flat test arena of its own (so redesigning the built-in levels can't break it).
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const src = ['level.js', 'sprites.js', 'net.js', 'main.js', 'online.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

function makeWorld() {
  const log = [];
  const ctx = new Proxy({}, { get: (_, p) => (...a) => { log.push([p, ...a]); }, set: () => true });
  const el = () => ({ getContext: () => ctx, hidden: false, value: '', textContent: '', onclick: null, select() {}, focus() {}, blur() {}, addEventListener() {} });
  const els = {};
  const sandbox = { console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Promise, setTimeout, performance: { now: () => 0 },
    requestAnimationFrame: () => {}, addEventListener: () => {}, localStorage: { getItem: () => null }, HTMLInputElement: class {},
    encodeURIComponent, TypeError, fetch: () => Promise.resolve({}), document: { getElementById: (id) => (els[id] ??= el()), fonts: { load() {} } } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  sandbox.ctx0 = ctx;
  const run = (c) => vm.runInContext(c, sandbox);
  // A flat floor, a wall at each end, the ball parked out of the way up in the air on a ledge.
  run(`for (const m of Object.values(components)) m.clear(); nextId = 0;
    loadLevel({ walls: [{ x: -100, y: 976, w: 2120, h: 24 }, { x: 0, y: 0, w: 24, h: 976 }, { x: 1896, y: 0, w: 24, h: 976 }, { x: 1700, y: 200, w: 150, h: 24 }],
      ball: { x: 1775, y: 170 }, goals: [], zones: [], slopes: [],
      players: [{ color: '#48f', x: 300, y: 928, hud: { x: 40, y: 60 }, keys: {} }, { color: '#f44', x: 1500, y: 928, hud: { x: 1856, y: 60 }, keys: {} }] });
    menu.open = false; round.t = 0;`);
  return { run, log };
}

// Drive blue (slot 0) with a list of per-step inputs; the sim runs the same systems as the game's loop.
const w = makeWorld(), run = w.run;
const blue = '[...query("pos", "vel", "body", "controls", "anim")].find((e) => e[4].slot === 0)';
const state = () => JSON.parse(run(`(() => { const [, p, v, b, , a] = ${blue}; return JSON.stringify({ x: p.x, vx: v.x, slide: b.slide, grounded: b.grounded, pose: a.slide, facing: a.facing }); })()`));
const step = (inp) => {
  run(`inputs[0] = ${JSON.stringify({ left: false, right: false, jump: false, ...inp })}; inputs[1] = { left: false, right: false, jump: false };
    controlSystem(); physicsSystem(); effectsSystem(); particleSystem();`);
  return state();
};
const steps = (n, inp) => Array.from({ length: n }, () => step(inp));
const reset = () => { run(`resetSystem(); for (const [id] of query("particle")) despawn(id);`); steps(10, {}); }; // settle onto the floor
const R = { right: true }, L = { left: true };

reset();
const held = steps(60, R);
check('holding right is a plain run at 450, no slide', held.every((s) => s.vx === 450 && s.slide <= 0 && !s.pose));

reset();
steps(4, R); steps(4, {}); // tap...
const slide = steps(60, R); // ...tap and hold
check('a double tap on the ground starts a slide at 900', slide[0].vx === 900 && slide[0].slide > 0, JSON.stringify(slide[0]));
const during = slide.filter((s) => s.slide > 0);
check('...that eases down to a run over 0.4s', Math.abs(during.length - 0.4 * 120) <= 1 && during.every((s, i) => i === 0 || s.vx < during[i - 1].vx) && slide.at(-1).vx === 450, `${during.length} steps, ${during.at(-1).vx.toFixed(0)} at the end`);
check('the sprite shows the slide pose while it lasts, facing the slide', slide.slice(0, during.length).every((s) => s.pose && s.facing === 1) && !slide.at(-1).pose);
reset();
const x0 = state().x; steps(8, R); const plainX = steps(52, R).at(-1).x - x0;
reset();
const x1 = state().x; steps(4, R); steps(4, {}); const slideX = steps(52, R).at(-1).x - x1;
check('it gets you further than running (the point: getting ahead of the ball)', slideX > plainX + 60, `${slideX.toFixed(0)}px vs ${plainX.toFixed(0)}px in 0.5s`);

reset();
steps(4, L); steps(4, {});
const left = steps(30, L);
check('works to the left too (and faces left)', left[0].vx === -900 && left[0].pose && left[0].facing === -1);

reset();
steps(4, R); steps(30, {});
check('two presses too far apart (0.28s) are just two runs', steps(10, R).every((s) => s.vx === 450 && s.slide <= 0));
reset();
steps(4, L); steps(4, {});
check('left then right is not a double tap', steps(10, R).every((s) => s.vx === 450));

reset();
step({ jump: true }); steps(10, {});
check('(in the air now)', !state().grounded);
steps(3, R); steps(3, {});
check('no slide in the air', steps(5, R).every((s) => s.slide <= 0 && s.vx === 450));

reset();
steps(4, R); steps(4, {}); steps(10, R);
const jumped = step({ ...R, jump: true });
check('jumping ends the slide (and the jump still happens)', jumped.slide <= 0 && !jumped.pose && run(`${blue}[2].y`) < 0 && jumped.vx === 450, JSON.stringify(jumped));

reset();
steps(4, R); steps(4, {}); steps(60, R); // one whole slide
steps(4, {}); steps(4, R); steps(4, {}); // double tap again, straight after it ended
check('no chaining: a second slide straight after one ends is too soon (cooldown)', steps(5, R).every((s) => s.slide <= 0 && s.vx === 450));
steps(40, {}); steps(4, R); steps(4, {});
check('...but works again a moment later', step(R).slide > 0);

reset();
steps(4, R); steps(4, {}); steps(3, R);
check('a slide keeps its direction (you can\'t steer it back)', steps(10, L).every((s) => s.vx > 450));

reset();
steps(4, R); steps(4, {}); steps(20, R);
check('it kicks up dust', run('[...query("particle")].length') >= 8);
steps(4, R); steps(4, {}); steps(5, R);
run('resetSystem()');
check('a goal reset ends any slide and its pose', run(`${blue}[3].slide`) === 0 && run(`${blue}[5].slide`) === false && run(`${blue}[3].tapAge`) > 1);

// The sliding sprite
const draw = (facing) => { w.log.length = 0; run(`drawWizard(ctx0, '#48f', { facing: ${facing}, moving: true, air: false, phase: 0, vy: 0, slide: true }, 0)`); return w.log.slice(); };
let threw = null;
try { draw(1); draw(-1); } catch (e) { threw = e.message; }
check('the slide pose draws, both facings', threw === null, threw ?? '');
const xs = (cs) => cs.slice(0, cs.map((c) => c[0]).lastIndexOf('save')).filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo').map((c) => c[1]);
check('...mirrored for the other facing (body, feet, arm, head; the hat flips by its rotation)', JSON.stringify(xs(draw(1)).sort()) === JSON.stringify(xs(draw(-1)).map((x) => -x).sort()));
check('...with the feet out in front (beyond the body) and down at the ground', (() => { const cs = draw(1); const feet = cs.filter((c) => c[0] === 'moveTo' && c[2] >= 22); return feet.length >= 2 && Math.max(...feet.map((c) => c[1])) > 10; })());
check('save/restore balanced', (() => { const cs = draw(1); return cs.filter((c) => c[0] === 'save').length === cs.filter((c) => c[0] === 'restore').length; })());

// Online: a watcher sees the slide too
reset();
steps(4, R); steps(4, {}); steps(3, R);
const snap = JSON.parse(run('JSON.stringify(snapshot())'));
const guest = makeWorld();
guest.run(`levelReady = true; applySnapshot(${JSON.stringify(snap)})`);
check('the snapshot carries the slide, and a guest draws that pose', guest.run(`${blue}[5].slide`) === true && guest.run('[...query("anim", "controls")].find((e) => e[2].slot === 1)[1].slide') === false);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
