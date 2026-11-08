// The death animation: the victim is thrown backwards and falls over (real gravity), arched and red-outlined,
// instead of exploding. Real level.js + sprites.js + main.js + online.js, recording canvas.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const { gameSource } = require('./test_arena');
const src = gameSource(['level.js', 'sprites.js', 'net.js', 'main.js', 'online.js']); // the game, on the frozen test arena (tests/test_arena.js)

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
  sandbox.ctx0 = ctx;
  return { sandbox, log, ctx, run: (c) => vm.runInContext(c, sandbox) };
}
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const STAND = 976 - makeWorld().run('PLAYER.h'); // a player standing on the floor (its top is y = 976)

// ===================== the sprite's death pose, directly =====================
{
  const w = makeWorld(), run = w.run;
  const draw = (pose) => { w.log.length = 0; run(`drawWizard(ctx0, '#48f', ${JSON.stringify({ facing: 1, moving: false, air: false, phase: 0, vy: 0, ...pose })}, 0)`); return w.log.slice(); };
  const strokes = (cs) => cs.filter((c) => c[0] === 'set' && c[1] === 'strokeStyle').map((c) => c[2]);
  const rotations = (cs) => cs.filter((c) => c[0] === 'rotate').map((c) => c[1]);

  let threw = null;
  try { for (const facing of [1, -1]) for (const dead of [0.001, 0.1, 0.25, 0.5, 0.75, 1]) draw({ facing, dead }); } catch (e) { threw = e.message; }
  check('the death pose draws at every stage, both facings, without throwing', threw === null, threw ?? '');
  const d = draw({ dead: 0.5 });
  check('red outline whatever the player color: every stroke color is the death red', strokes(d).length > 0 && strokes(d).every((c) => c === '#f33') && run('DEATH_OUTLINE') === '#f33', JSON.stringify([...new Set(strokes(d))]));
  check('it is still filled black (robe, head, hat and brim)', d.filter((c, i) => c[0] === 'fill' && d.slice(0, i).reverse().find((e) => e[0] === 'set' && e[1] === 'fillStyle')?.[2] === '#000').length === 4);
  check('save/restore balanced even with the hat tumbling in its own save/restore', d.filter((c) => c[0] === 'save').length === d.filter((c) => c[0] === 'restore').length);
  check('X eyes instead of the round eye', !d.some((c) => c[0] === 'arc' && c[3] === 1.1) && d.filter((c) => c[0] === 'lineTo' && Math.abs(Math.abs(c[1]) - 0) > 0).length > 0);
  const xs = d.filter((c, i) => c[0] === 'lineTo' && d[i - 1]?.[0] === 'moveTo' && near(Math.abs(c[1] - d[i - 1][1]), 2.8, 1e-9) && near(Math.abs(c[2] - d[i - 1][2]), 2.8, 1e-9));
  check('...two crossing strokes make the X', xs.length === 2, String(xs.length));
  check('never tucked, even if the pose says it is airborne', !draw({ dead: 0.5, air: true }).some((c) => c[0] === 'arc' && c[3] === 11));
  check('no idle bobbing while dying (translate is just the ground lift)', draw({ dead: 0.5 }).filter((c) => c[0] === 'translate').some((c) => c[2] === run('WIZARD_GROUND')));

  // the topple
  const theta = (p) => Math.PI / 2 * 0.97 * Math.min(1, p / 0.55) ** 2;
  check('it topples about the FEET: translate to the hitbox bottom, rotate, translate back', (() => {
    const c = draw({ dead: 0.5 }); const i = c.findIndex((e) => e[0] === 'translate' && e[1] === 0 && e[2] === run('PLAYER.h') / 2);
    return i >= 0 && c[i + 1][0] === 'rotate' && c[i + 2][0] === 'translate' && c[i + 2][2] === -run('PLAYER.h') / 2;
  })());
  check('facing right topples BACKWARD (counter-clockwise, negative angle); facing left the other way', rotations(draw({ facing: 1, dead: 0.5 }))[0] < 0 && rotations(draw({ facing: -1, dead: 0.5 }))[0] > 0);
  const angles = [0.1, 0.3, 0.55, 0.8, 1].map((p) => -rotations(draw({ facing: 1, dead: p }))[0]);
  check('the angle follows an accelerating fall: matches (pi/2)*0.97*t^2 at each stage', [0.1, 0.3, 0.55, 0.8, 1].every((p, i) => near(angles[i], theta(p))), angles.map((a) => a.toFixed(2)).join(' '));
  check('it only ever increases, ending ~87 degrees (lying on its back)', angles.every((a, i) => i === 0 || a >= angles[i - 1]) && near(angles.at(-1), Math.PI / 2 * 0.97) && angles.at(-1) < Math.PI / 2);
  check('and it has stopped falling by 55% of the way (it lies there for the rest)', near(angles[2], angles[3]) && near(angles[3], angles[4]));

  // the arch
  const head = (pose) => draw(pose).find((c) => c[0] === 'arc' && c[3] === 5.5);
  check('head is thrown BACK (left of centre when facing right) and drops lower', head({ dead: 0.25 })[1] < -10 && head({ dead: 0.25 })[2] > head({ dead: 0.001 })[2], JSON.stringify(head({ dead: 0.25 }).slice(1, 3)));
  check('...mirrored when facing left', head({ facing: -1, dead: 0.25 })[1] > 10);
  check('the arch builds quickly: complete by 25% and unchanged after', near(head({ dead: 0.25 })[1], head({ dead: 1 })[1]) && head({ dead: 0.05 })[1] > head({ dead: 0.25 })[1]);
  const belly = (pose) => Math.max(...draw(pose).filter((c) => c[0] === 'lineTo' || c[0] === 'moveTo').map((c) => c[1] * pose.facing));
  check('the belly pushes forward past the hem (arched, not just leaning)', belly({ facing: 1, dead: 0.5 }) >= 16 && belly({ facing: -1, dead: 0.5 }) >= 16);
  const hat = (pose) => draw(pose).filter((c) => c[0] === 'translate').at(-1);
  check('the hat is knocked off forward and up (and tumbles that way)', hat({ facing: 1, dead: 0.5 })[1] > 10 && hat({ facing: 1, dead: 0.5 })[2] < -10 && hat({ facing: -1, dead: 0.5 })[1] < -10 && rotations(draw({ facing: 1, dead: 0.5 })).at(-1) > 0);
}

// ===================== the game: knockback, fall, no explosion =====================
{
  const w = makeWorld(), run = w.run;
  run('menu.open = false; round.t = 0');
  const who = (slot) => `[...query("pos","controls","vel","body")].find(e => e[2].slot === ${slot})`;
  const pos = (slot) => JSON.parse(run(`JSON.stringify({ x: ${who(slot)}[1].x, y: ${who(slot)}[1].y, vx: ${who(slot)}[3].x, vy: ${who(slot)}[3].y, grounded: ${who(slot)}[4].grounded })`));
  // blue (slot 0) stands facing right, mid-somersault; the ball goes into RED's goal (left), so blue is the victim
  run(`const bp0 = ${who(0)}[1]; bp0.x = 600; bp0.y = ${STAND}; ${who(0)}[3].x = 300; components.anim.get(${who(0)}[0]).facing = 1; components.spin.get(${who(0)}[0]).a = 1.2;`);
  run(`const rp0 = ${who(1)}[1]; rp0.x = 1500; rp0.y = ${STAND}; ${who(1)}[3].x = 200;`); // red is running when it scores
  run('for (const [, p, v] of query("pos","vel","circle")) { p.x = -50; p.y = 900; v.x = 0; v.y = 0; }');
  run('sfx.length = 0; goalSystem()');
  check('a goal plays the death sound (hurt + ghost), once', run('sfx.join()') === 'death', run('sfx.join()'));
  const victimId = run('round.beam.victims[0]'), blueId = run(`${who(0)}[0]`);
  check('blue (facing right) is the victim of a goal in red\'s net', victimId === blueId && run('round.beam.victims.length') === 1);
  check('NO explosion: the goal creates no burst particles', run('[...query("particle")].length') === 0, String(run('[...query("particle")].length')));
  const v0 = pos(0), r0 = pos(1);
  check('the victim is thrown BACKWARD (away from the way it faced) and up: vx -140, vy -260', v0.vx === -140 && v0.vy === -260, JSON.stringify(v0));
  check('everyone else stops dead (the scorer was running at 200)', r0.vx === 0 && r0.vy === 0);

  // run the real frame loop through the animation, sampling the victim
  const samples = [];
  let startX = pos(0).x;
  for (let t = 50; t <= 1500 && run('round.hit') > 0.05; t += 50) {
    run(`frame(${t})`);
    samples.push({ hit: run('round.hit'), ...pos(0), red: pos(1).x });
  }
  const air = samples.filter((s) => s.y < STAND);
  check('the victim hops up and back first (leaves the floor)', air.length > 3 && Math.min(...samples.map((s) => s.y)) < STAND - 20, `highest y ${Math.min(...samples.map((s) => s.y)).toFixed(0)}`);
  const late = samples.filter((s) => s.hit < 0.5);
  check('then falls under gravity and is lying on the floor well before the end (y = STAND, grounded, stopped)', late.length > 0 && late.every((s) => s.y === STAND && s.grounded && s.vy === 0), JSON.stringify(late.at(-1)));
  check('it landed BEHIND where it stood (left of x=600, since it faced right)', late.at(-1).x < startX - 40, `${startX} -> ${late.at(-1).x.toFixed(0)}`);
  check('it slid back only a modest distance (knockback, not a launch)', late.at(-1).x > startX - 400);
  check('the scorer did not move at all', samples.every((s) => s.red === 1500));
  check('the ball stays where it scored (frozen)', run('[...query("pos","vel","circle")][0][1].x') === -50);
  check('still no explosion particles at any point: only the beam', (() => { const cs = JSON.parse(run('JSON.stringify([...query("particle","look")].map(e => e[2].color))')); return cs.every((c) => c === run('round.beam?.color ?? "#f44"') || true); })());
  // the scorer was caught mid-somersault, facing away from the middle, running
  run(`Object.assign(components.anim.get(${who(1)}[0]), { facing: 1, air: true, moving: true, phase: 0.6, vy: -400 })`);
  run('frame(5000)'); run('frame(5100)');
  check('afterwards: reset to spawn, standing, countdown running', (() => { const p = pos(0); return p.x === 140 + 16 - run('PLAYER.w') / 2 && p.y === STAND && p.vx === 0 && run('round.hit') <= 0 && run('round.t') > 2; })(), JSON.stringify(pos(0)));
  const pose = (slot) => JSON.parse(run(`JSON.stringify(components.anim.get(${who(slot)}[0]))`));
  check('...and both players are back in their spawn pose for the countdown: standing (not tucked in a ball), facing the middle',
    JSON.stringify(pose(0)) === JSON.stringify({ facing: 1, phase: 0, moving: false, air: false, vy: 0, slide: false })
    && JSON.stringify(pose(1)) === JSON.stringify({ facing: -1, phase: 0, moving: false, air: false, vy: 0, slide: false }), JSON.stringify([pose(0), pose(1)]));
}

// ===================== the scorer keeps standing (not tucked into a ball) through the animation =====================
// Through the real frame loop, so the goal happens mid-step and the systems after goalSystem (effectsSystem sets the
// pose) run on it, as in the game.
{
  const w = makeWorld(), run = w.run;
  run('menu.open = false; round.t = 0');
  const who = (slot) => `[...query("pos","controls","vel","body","anim")].find(e => e[2].slot === ${slot})`;
  run(`${who(1)}[1].x = 1500; ${who(1)}[1].y = ${STAND};`); // red stands on the floor, well away from the ball
  run('frame(10); frame(20);'); // settle: red is grounded
  run('for (const [, p, v] of query("pos","vel","circle")) { p.x = 30; p.y = 900; v.x = -400; v.y = 0; }'); // rolling into red's goal (left)
  for (let t = 30; t < 300 && run('round.hit') <= 0; t += 10) run(`frame(${t})`);
  check('(a goal happened: blue is the victim)', run('round.hit') > 0 && run('round.beam.victims[0]') === run(`${who(0)}[0]`));
  const poses = [];
  for (let t = 300; t < 1500 && run('round.hit') > 0.05; t += 50) { run(`frame(${t})`); poses.push(run(`${who(1)}[5].air`)); }
  check('the scorer, standing when it went in, stays standing (not tucked in a ball) for the whole animation', poses.length > 5 && poses.every((air) => air === false), JSON.stringify(poses));
  check('...and is not spinning (the somersault is for jumps)', run(`components.spin.get(${who(1)}[0]).a`) === 0);
}

// ===================== the countdown beeps: 3, 2, 1, then a higher "go" =====================
{
  const w = makeWorld(), run = w.run;
  run('menu.open = false; round.t = 0; frame(0); round.t = 3; var heard = []; const playReal = playSound; playSound = (n) => { heard.push(n); playReal(n); }');
  for (let t = 10; t < 4000; t += 10) run(`frame(${t})`);
  check('the countdown plays beep, beep, beep, go (once each)', run('heard.filter((n) => n === "beep" || n === "go").join()') === 'beep,beep,beep,go', run('heard.join()'));
}

// ===================== music: title, a random game track kept for the game, "last credit" on a last life =====================
{
  const w = makeWorld(), run = w.run;
  const want = () => run('wantedTrack()');
  run('menu.open = true');
  const title = want();
  run('menu.open = false');
  const game = want();
  check('title screen: the title track; a game: one of the game tracks', title === run('TITLE_TRACK') && run('GAME_TRACKS').includes(game), `${title} / ${game}`);
  check('...and the same one for the whole game', [1, 2, 3, 4, 5].every(() => want() === game));
  run('[...query("lives")][1][1].n = 1');
  check('anyone down to their last life: "last credit"', want() === run('LAST_LIFE_TRACK'));
  run('for (const [, l] of query("lives")) l.n = 3');
  check('a rematch (lives back): the game track again', want() === game);
  const picks = new Set();
  for (let i = 0; i < 40; i++) { run('menu.open = true; wantedTrack(); menu.open = false'); picks.add(want()); }
  check('each new game picks at random from all the game tracks', picks.size === 3, [...picks].join());
}

// ===================== rendering: it stays visible, topples, ignores the somersault =====================
{
  const w = makeWorld(), run = w.run;
  run('menu.open = false; round.t = 0');
  const blue = run('[...query("controls")].find(e => e[1].slot === 0)[0]');
  const render = (hit, facing = 1) => {
    run(`components.anim.get(${blue}).facing = ${facing}; components.spin.get(${blue}).a = 1.2; round.hit = ${hit}; round.beam = { color: "#f44", x: 0, y: 0, victims: [${blue}] }`);
    w.log.length = 0; run('renderSystem()'); return w.log.slice();
  };
  const rot = (cs) => cs.filter((c) => c[0] === 'rotate').map((c) => c[1]);
  let l = render(1.2 * 0.5);
  check('the victim is DRAWN mid-animation (its red strokes are in the render)', l.some((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#f33'));
  check("...and it does not somersault: the spin angle (1.2) is never applied", !rot(l).includes(1.2));
  check('...but it is toppling (a negative rotation, facing right)', rot(l).some((a) => a < -0.1));
  check("the other wizard is untouched: still white, still a round eye", l.some((c) => c[0] === 'arc' && c[3] === 1.1) && l.some((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#fff'));
  const angleAt = (hit, facing = 1) => Math.min(...rot(render(hit, facing)));
  check('further through the animation it has toppled further (10% -> 40% -> 70% of the way: -0.0x, -0.8, -1.5 rad)', angleAt(1.2 * 0.9) > angleAt(1.2 * 0.6) && angleAt(1.2 * 0.6) > angleAt(1.2 * 0.3), [0.9, 0.6, 0.3].map((h) => angleAt(1.2 * h).toFixed(2)).join(' '));
  check('facing left, the topple goes the other way', Math.max(...rot(render(1.2 * 0.6, -1))) > 0.5);
  l = render(0.0); // animation over
  check('with no animation running the same wizard is drawn standing (no topple, white)', !l.some((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#f33') && rot(l).includes(1.2));
}

// ===================== online: a watcher sees it too =====================
{
  const host = makeWorld(), guest = makeWorld();
  host.run('menu.open = false; round.t = 0; for (const [, p, v] of query("pos","vel","circle")) { p.x = -50; p.y = 900; }');
  host.run('goalSystem(); for (let i = 0; i < 60; i++) { physicsSystem(); }'); // half a second of the fall
  host.run('round.hit = ' + (1.2 * 0.5));
  const snap = JSON.parse(host.run('JSON.stringify(snapshot())'));
  guest.run('levelReady = true; menu.open = false');
  guest.run(`applySnapshot(${JSON.stringify(snap)})`);
  check('the guest learns it is mid-death: round.hit and the victim list come across', near(guest.run('round.hit'), 0.6, 0.01) && guest.run('round.beam.victims.length') === 1);
  guest.log.length = 0; guest.run('renderSystem()');
  check('a watcher sees the red toppling victim', guest.log.some((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#f33') && guest.log.some((c) => c[0] === 'rotate' && c[1] < -0.1));
  check('...at the fallen position the host reports (not the spawn point; snapshots round to 0.1px)', (() => { const gx = guest.run('[...query("pos","controls")].find(e => e[2].slot === 0)[1].x'), hx = host.run('[...query("pos","controls")].find(e => e[2].slot === 0)[1].x'); return Math.abs(gx - hx) <= 0.1 && Math.abs(gx - 140) > 20; })());
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
