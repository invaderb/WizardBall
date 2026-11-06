// Tests for the wizard sprites: the drawing itself (recorded canvas), the animation state the game keeps,
// and that watchers receive the pose. Runs the real level.js + sprites.js + main.js + online.js.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const src = ['level.js', 'sprites.js', 'net.js', 'main.js', 'online.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');

function makeWorld() {
  const log = [];
  const ctx = new Proxy({}, { get: (_, prop) => (...args) => { log.push([prop, ...args]); }, set: (_, prop, value) => { log.push(['set', prop, value]); return true; } });
  const els = {};
  const el = () => ({ getContext: () => ctx, hidden: false, value: '', textContent: '', onclick: null, select() {}, focus() {}, blur() {}, addEventListener() {} });
  const sandbox = { console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Promise, setTimeout, performance: { now: () => 0 },
    requestAnimationFrame: () => {}, addEventListener: () => {}, localStorage: { getItem: () => null }, HTMLInputElement: class {},
    encodeURIComponent, TypeError, fetch: () => Promise.resolve({}), document: { getElementById: (id) => (els[id] ??= el()), fonts: { load() {} } } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { sandbox, log, ctx, run: (c) => vm.runInContext(c, sandbox) };
}
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const w = makeWorld(), run = w.run;

// ---------- the drawing ----------
const draw = (pose, time = 0) => { w.log.length = 0; run(`drawWizard(ctx0, '#48f', ${JSON.stringify(pose)}, ${time})`); return w.log.slice(); };
w.sandbox.ctx0 = w.ctx;
const idle = { facing: 1, moving: false, air: false, phase: 0, vy: 0 };
const air = { facing: 1, moving: false, air: true, phase: 0, vy: 0 };
const SCALE = run('WIZARD_SCALE'), GROUND = run('WIZARD_GROUND');
const OUTLINE = run('WIZARD_OUTLINE') ?? '#48f'; // the color the outline should be (white for everyone, or the player's color if that is null)

let threw = null;
try {
  for (const facing of [1, -1]) for (const phase of [0, 0.25, 0.5, 0.75, 0.99])
    for (const st of [{ moving: false, air: false }, { moving: true, air: false }, { moving: false, air: true }])
      for (const vy of [-620, 0, 700]) draw({ facing, phase, vy, ...st });
} catch (e) { threw = e.message; }
check('draws every pose (both facings, run phases, rising/falling) without throwing', threw === null, threw ?? '');
const calls = draw(idle);
const count = (name, cs = calls) => cs.filter((c) => c[0] === name).length;
check('save/restore are balanced (the sprite never leaks canvas state into the rest of the scene)', count('save') === 1 && count('restore') === 1);
check('every wizard is outlined in white, whatever its player color', OUTLINE === '#fff' && calls.some((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#fff') && !calls.some((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#48f') && count('stroke') >= 7);

// bigger, black-filled, no staff
check(`it is drawn ${SCALE}x the hitbox size (slightly bigger)`, calls.some((c) => c[0] === 'scale' && c[1] === SCALE && c[2] === SCALE) && SCALE > 1 && SCALE <= 1.3, String(SCALE));
const fills = (cs) => cs.reduce((n, c, i) => n + (c[0] === 'fill' && cs.slice(0, i).reverse().find((e) => e[0] === 'set' && e[1] === 'fillStyle')?.[2] === '#000' ? 1 : 0), 0);
check('robe, head and hat are filled BLACK (3 filled shapes standing)', fills(calls) === 3, String(fills(calls)));
check('...then the fill color goes back to the outline color (so the eye is white on the black head)', (() => { const i = calls.findIndex((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === '#000'); return calls.slice(i).some((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === OUTLINE); })());
check('the faint translucent fills are gone (it is solid black now)', !calls.some((c) => c[0] === 'set' && c[1] === 'globalAlpha'));
check('no staff: no orb (radius 3) and nothing drawn out to the side but one short arm', !calls.some((c) => c[0] === 'arc' && c[3] === 3) && calls.filter((c) => c[0] === 'lineTo').every((c) => Math.abs(c[1]) <= 12));

const eye = (pose) => draw(pose).find((c) => c[0] === 'arc' && c[3] === 1.1); // [arc, x, y, r, ...]
check('facing flips the eye to the other side (standing and tucked)', eye({ ...idle, facing: 1 })[1] > 0 && eye({ ...idle, facing: -1 })[1] < 0 && eye({ ...air, facing: 1 })[1] > 0 && eye({ ...air, facing: -1 })[1] < 0);
const feet = (pose) => draw(pose).filter((c, i, a) => c[0] === 'moveTo' && a[i + 1]?.[0] === 'lineTo' && Math.abs(a[i + 1][1] - c[1] - 5) < 0.001 && a[i + 1][2] === c[2]).map((c) => [c[1], c[2]]);
check('feet: two of them, at the bottom of the (unscaled) sprite', feet(idle).length === 2 && feet(idle).every(([, y]) => y > 19 && y <= 24), JSON.stringify(feet(idle)));
check('standing, the scaled feet land exactly on the hitbox bottom (y = 24) so it is not floating or sunk into the floor', Math.abs(23 * SCALE + GROUND - 24) < 1e-9);
check('running moves the feet from frame to frame', JSON.stringify(feet({ ...idle, moving: true, phase: 0.1 })) !== JSON.stringify(feet({ ...idle, moving: true, phase: 0.35 })));
check('a full run cycle comes back to the same pose', JSON.stringify(feet({ ...idle, moving: true, phase: 0.2 })) === JSON.stringify(feet({ ...idle, moving: true, phase: 1.2 })));

// the tuck
const tuck = draw(air);
const arcR = (cs, r) => cs.filter((c) => c[0] === 'arc' && c[3] === r).length;
check('in the air it curls into a ball (a radius-11 body) ...', arcR(tuck, 11) === 1 && arcR(calls, 11) === 0);
check('... instead of the standing robe (no trapezoid hem)', !tuck.some((c) => c[0] === 'lineTo' && Math.abs(c[1]) >= 10 && c[2] > 10) && calls.some((c) => c[0] === 'lineTo' && c[1] === 11 && c[2] === 18));
check('the tucked ball keeps a head, eye, hat and two feet', arcR(tuck, 5) === 1 && arcR(tuck, 1.1) === 1 && count('quadraticCurveTo', tuck) === 2 && feet(air).length === 2);
check('tucked feet are drawn up against the ball (not down at standing height)', feet(air).every(([, y]) => y < 16), JSON.stringify(feet(air)));
check('the tucked ball is centered on the hitbox so the somersault pivots on it (no ground lift)', tuck.find((c) => c[0] === 'translate')[2] === 0 && draw(idle).find((c) => c[0] === 'translate')[2] === GROUND);
check('the tuck is compact: nothing beyond ~21px from the center (unscaled)', tuck.filter((c) => c[0] === 'lineTo' || c[0] === 'moveTo').every((c) => Math.abs(c[1]) <= 12 && c[2] >= -20 && c[2] <= 14));
check('it is filled black too (ball, head, hat)', fills(tuck) === 3, String(fills(tuck)));
const tipY = (pose) => draw(pose).find((c) => c[0] === 'quadraticCurveTo')[4];
check('the hat is pushed down when rising and flutters up when falling (tucked)', tipY({ ...air, vy: -620 }) > tipY({ ...air, vy: 620 }));
check('the hat trails behind the facing direction in the air', draw({ ...air, facing: 1 }).find((c) => c[0] === 'quadraticCurveTo')[3] < 0 && draw({ ...air, facing: -1 }).find((c) => c[0] === 'quadraticCurveTo')[3] > 0);
check('the hat tip trails behind when running', Math.abs(draw({ ...idle, moving: true }).find((c) => c[0] === 'quadraticCurveTo')[3]) > Math.abs(draw(idle).find((c) => c[0] === 'quadraticCurveTo')[3]));
const bobAt = (t) => draw(idle, t).find((c) => c[0] === 'translate')[2] - GROUND;
check('idle breathing bobs gently with time (and only when standing still)', bobAt(0) !== bobAt(550) && Math.abs(bobAt(550)) <= 1.21);
check('no bobbing while running', draw({ ...idle, moving: true, phase: 0.3 }, 550).find((c) => c[0] === 'translate')[2] === GROUND);

// ---------- animation state in the game ----------
run('menu.open = false');
const A = (slot) => run(`JSON.stringify(components.anim.get([...query("controls")].find(e => e[1].slot === ${slot})[0]))`);
check('each player has an anim component', run('[...query("anim")].length') === 2);
check('blue starts facing right (toward the middle), red facing left', JSON.parse(A(0)).facing === 1 && JSON.parse(A(1)).facing === -1, A(0) + ' ' + A(1));

const set = (slot, vx, grounded, vy = 0) => run(`(() => { const [, , , vel, body] = [...query("pos","controls","vel","body")].find(e => e[2].slot === ${slot}); vel.x = ${vx}; vel.y = ${vy}; body.grounded = ${grounded}; })()`);
set(0, -300, true); run('effectsSystem()');
check('running left: faces left, moving, not airborne', (() => { const a = JSON.parse(A(0)); return a.facing === -1 && a.moving && !a.air; })());
const p0 = JSON.parse(A(0)).phase;
for (let i = 0; i < 20; i++) run('effectsSystem()');
check('the run cycle advances while moving', JSON.parse(A(0)).phase !== p0);
check('...by distance: 300 px/s covers one stride (80px) in ~0.27s', (() => { set(0, -300, true); run('components.anim.get([...query("controls")][0][0]).phase = 0'); for (let i = 0; i < 32; i++) run('effectsSystem()'); return Math.abs(JSON.parse(A(0)).phase - ((300 * 32 / 120 / 80) % 1)) < 0.01; })(), A(0));
set(0, 0, true); run('effectsSystem()');
check('standing still: stops moving, KEEPS facing left', (() => { const a = JSON.parse(A(0)); return a.facing === -1 && !a.moving; })());
set(0, 200, false, -500); run('effectsSystem()');
check('in the air: air true, not "moving" (no leg cycle), facing follows velocity, vy recorded', (() => { const a = JSON.parse(A(0)); return a.air && !a.moving && a.facing === 1 && a.vy === -500; })());
set(0, 10, true); run('effectsSystem()');
check('a tiny drift (< 20 px/s) does not flip facing or start running', (() => { const a = JSON.parse(A(0)); return a.facing === 1 && !a.moving; })());

// ---------- rendering ----------
w.log.length = 0; run('round.t = 0; round.hit = 0; renderSystem()');
const eyes = w.log.filter((c) => c[0] === 'arc' && c[3] === 1.1);
check('both players are drawn as wizards (2 eyes), not pills', eyes.length === 2 && !w.log.some((c) => c[0] === 'roundRect' && c[3] === 32 && c[4] === 48)); // (walls use roundRect now, but none is player-pill sized: 32 x 48)
w.log.length = 0; run('round.hit = 1; round.beam = { color: "#f44", x: 0, y: 0, victims: [[...query("controls")][0][0]] }; renderSystem()');
const strokesIn = (log) => log.filter((c) => c[0] === 'set' && c[1] === 'strokeStyle').map((c) => c[2]);
check('in a real render, no wizard is drawn in its player color (blue #48f / red #f44 appear only on goals and health bars)', (() => {
  w.log.length = 0; run('round.t = 0; round.hit = 0; renderSystem()');
  const i = w.log.findIndex((c) => c[0] === 'arc' && c[3] === 1.1); // first eye = inside the first wizard
  const start = w.log.slice(0, i).map((c, k) => k).filter((k) => w.log[k][0] === 'save').pop();
  const wizard = w.log.slice(start, w.log.findIndex((c, k) => k > i && c[0] === 'restore') + 1);
  return !strokesIn(wizard).some((c) => c === '#48f' || c === '#f44') && strokesIn(wizard).includes('#fff');
})());
check('the ball is solid black with a white outline', (() => {
  w.log.length = 0; run('renderSystem()');
  const i = w.log.findIndex((c) => c[0] === 'arc' && c[3] === 22); // the ball (radius 22)
  const after = w.log.slice(i);
  const fillAt = after.findIndex((c) => c[0] === 'fill'), strokeAt = after.findIndex((c) => c[0] === 'stroke');
  const color = (name) => { const sets = after.slice(0, name).filter((c) => c[0] === 'set' && c[1] === (name === fillAt ? 'fillStyle' : 'strokeStyle')); return sets.at(-1)?.[2]; };
  return i >= 0 && fillAt >= 0 && fillAt < strokeAt && after.slice(0, fillAt).filter((c) => c[0] === 'set' && c[1] === 'fillStyle').at(-1)?.[2] === '#000' && after.slice(0, strokeAt).filter((c) => c[0] === 'set' && c[1] === 'strokeStyle').at(-1)?.[2] === '#fff';
})());
w.log.length = 0; run('round.hit = 1; round.beam = { color: "#f44", x: 0, y: 0, victims: [[...query("controls")][0][0]] }; renderSystem()'); // (re-render: the checks above reset the log)
check('a victim of the death animation is still drawn, but in the death pose: no round eye (X eyes), only the scorer has one', w.log.filter((c) => c[0] === 'arc' && c[3] === 1.1).length === 1);
run('round.hit = 0; round.beam = null');
w.log.length = 0; run('spin = components.spin.get([...query("controls")][0][0]); spin.a = 1.2; renderSystem()');
check('the somersault rotates the whole sprite', w.log.some((c) => c[0] === 'rotate' && Math.abs(c[1] - 1.2) < 1e-9));

// ---------- online: watchers get the pose ----------
set(1, 300, true); for (let i = 0; i < 10; i++) run('effectsSystem()');
const snap = JSON.parse(run('JSON.stringify(snapshot())'));
const row = snap.players.find((r) => r[5] === 1 && r[6] === 1);
check('snapshot rows carry facing, moving, air, phase, vy, slide', row && row.length === 11 && row[10] === 0 && row[5] === 1 && row[6] === 1 && row[7] === 0 && row[8] > 0, JSON.stringify(row));
const g = makeWorld();
g.run('levelReady = true');
g.run(`applySnapshot(${JSON.stringify(snap)})`);
const gp = JSON.parse(g.run('JSON.stringify([...query("anim")].map(e => e[1]))'));
check('a watcher ends up with the same poses (booleans restored)', gp.some((a) => a.facing === 1 && a.moving === true && a.air === false && a.phase > 0) && gp.every((a) => typeof a.moving === 'boolean' && typeof a.air === 'boolean'), JSON.stringify(gp));
let rerr = null;
try { g.run('round.t = 0; renderSystem()'); } catch (e) { rerr = e.message; }
check('...and can draw them', rerr === null, rerr ?? '');
check('a watcher draws two wizards', g.log.filter((c) => c[0] === 'arc' && c[3] === 1.1).length === 2);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
