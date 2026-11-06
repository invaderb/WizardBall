// Tests for the visual pass: bevelled health bars, particle death beam, tinted goals + sparks, fading
// bubbles with ghost trails, and grass. Runs the real level.js + main.js + online.js with a stubbed browser
// whose canvas RECORDS every call, so we can check what actually gets drawn.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const { gameSource } = require('./test_arena');
const src = gameSource(['level.js', 'sprites.js', 'net.js', 'main.js', 'online.js']); // the game, on the frozen test arena (tests/test_arena.js)

function makeWorld() {
  const log = [];
  const ctx = new Proxy({}, { get: (_, prop) => (...args) => { log.push([prop, ...args]); }, set: (_, prop, value) => { log.push(['set', prop, value]); return true; } });
  const els = {};
  const el = () => ({ getContext: () => ctx, hidden: false, value: '', textContent: '', onclick: null, select() {}, focus() {}, blur() {}, addEventListener() {} });
  const sandbox = {
    console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Promise, setTimeout, performance: { now: () => 0 },
    requestAnimationFrame: () => {}, addEventListener: () => {}, localStorage: { getItem: () => null },
    HTMLInputElement: class {}, encodeURIComponent, TypeError, fetch: () => Promise.resolve({}),
    document: { getElementById: (id) => (els[id] ??= el()), fonts: { load() {} } },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { sandbox, log, run: (c) => vm.runInContext(c, sandbox) };
}

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const w = makeWorld();
const run = w.run;
run('menu.open = false');

// ---------- health bar segment ----------
const seg = JSON.parse(run('JSON.stringify(hudSegment(40, 60))'));
check('hud segment: 6 points, 24 wide, 60 tall', seg.length === 6 && Math.max(...seg.map((p) => p.x)) - Math.min(...seg.map((p) => p.x)) === 24 && Math.max(...seg.map((p) => p.y)) - Math.min(...seg.map((p) => p.y)) === 60);
const slope = (a, b) => (b.y - a.y) / (b.x - a.x);
check('hud segment: top and bottom are 45 degrees (|slope| = 1)', Math.abs(slope(seg[0], seg[1])) === 1 && Math.abs(slope(seg[1], seg[2])) === 1 && Math.abs(slope(seg[3], seg[4])) === 1 && Math.abs(slope(seg[4], seg[5])) === 1);
check('hud segment: sides are straight', seg[2].x === seg[3].x && seg[5].x === seg[0].x);

// ---------- grass ----------
const g1 = JSON.parse(run('JSON.stringify(grassBlades(500, 3))'));
check('grass is deterministic for the same wall', JSON.stringify(g1) === run('JSON.stringify(grassBlades(500, 3))'));
check('grass differs between walls (seed)', JSON.stringify(g1) !== run('JSON.stringify(grassBlades(500, 4))'));
const g2 = JSON.parse(run('JSON.stringify(grassBlades(900, 3))'));
check('resizing a wall keeps the blades it already had', g2.length > g1.length && JSON.stringify(g2.slice(0, g1.length - 1)) === JSON.stringify(g1.slice(0, g1.length - 1)));
check('blades stay inside the wall, with sane size', g2.every((b) => b.x > 0 && b.x < 900 && b.h >= 5 && b.h <= 15 && Math.abs(b.lean) <= 5));
check('roughly one blade every ~8px', g1.length > 40 && g1.length < 120, String(g1.length));
check('default level: floor + platform have grass, ceiling and walls do not', run('JSON.stringify(DEFAULT_LEVEL.walls.map(w => !!w.grass))') === '[true,false,false,false,true]');
check('grass entities exist for exactly those walls', run('[...query("pos","grass")].length') === 2);
check('wall grass matches grassBlades(width, index)', run('JSON.stringify(components.grass.get([...query("grass")][1][0]))') === run('JSON.stringify(grassBlades(520, 4))'));

// ---------- level data validation ----------
check('sparks: valid values accepted', run('["left","right","top","bottom",undefined].every(s => isValidLevel({ ...DEFAULT_LEVEL, goals: [{ ...DEFAULT_LEVEL.goals[0], sparks: s }] }))'));
check('sparks: junk rejected', run('!isValidLevel({ ...DEFAULT_LEVEL, goals: [{ ...DEFAULT_LEVEL.goals[0], sparks: "up" }] })'));
check('older levels (no grass/sparks) still load', run('isValidLevel({ ...DEFAULT_LEVEL, walls: DEFAULT_LEVEL.walls.map(({ grass, ...r }) => r), goals: DEFAULT_LEVEL.goals.map(({ sparks, ...r }) => r) })'));

// ---------- bubbles: ghost trail + fade ----------
run('const body = [...query("body")][1][1]; globalThis.body = body;');
run('placeBubble(body, { x: 500, y: 500 }, { w: 32, h: 48 }, "#f44"); globalThis.first = body.bubble;');
run('placeBubble(body, { x: 560, y: 500 }, { w: 32, h: 48 }, "#f44"); globalThis.second = body.bubble;');
check('a second air jump makes a NEW bubble (a trail), not a moved one', run('first !== second && components.bubble.size === 2'));
check('the old bubble becomes a non-solid ghost; the new one is solid', run('components.bubble.get(first).solid === false && components.bubble.get(second).solid === true && body.bubble === second'));
check('both start fully visible', run('components.bubble.get(first).t === BUBBLE_LIFE && components.bubble.get(second).t === BUBBLE_LIFE'));

const ballAt = (x, y) => run(`(() => { const [, p, v] = [...query("pos","vel","circle")][0]; p.x = ${x}; p.y = ${y}; v.x = 0; v.y = 0; return [p, v]; })()`);
ballAt(500, 540); run('bubbleSystem()');
check('a ghost does NOT pop the ball', run('(() => { const [, p, v] = [...query("pos","vel","circle")][0]; return v.x === 0 && v.y === 0 && p.x === 500 && p.y === 540; })()'));
ballAt(560, 540); run('bubbleSystem()');
check('the solid bubble still pops it', run('(() => { const [, , v] = [...query("pos","vel","circle")][0]; return Math.hypot(v.x, v.y) >= 500; })()'));

run('for (let i = 0; i < Math.round(BUBBLE_LIFE / DT / 2); i++) bubbleFadeSystem()');
check('halfway through its life it is half faded', Math.abs(run('components.bubble.get(second).t / BUBBLE_LIFE') - 0.5) < 0.02, String(run('components.bubble.get(second).t / BUBBLE_LIFE')));
run('for (let i = 0; i < Math.round(BUBBLE_LIFE / DT / 2) + 5; i++) bubbleFadeSystem()');
check('after a couple of seconds both are gone', run('components.bubble.size') === 0);
check("...and the player forgets its bubble", run('body.bubble') === null);
run('placeBubble(body, { x: 500, y: 500 }, { w: 32, h: 48 }, "#f44"); placeBubble(body, { x: 520, y: 500 }, { w: 32, h: 48 }, "#f44"); resetSystem()');
check('a goal reset clears every bubble, ghosts too', run('components.bubble.size') === 0 && run('body.bubble') === null);
check('a fresh air jump after expiry works', (() => { run('placeBubble(body, { x: 1, y: 1 }, { w: 32, h: 48 }, "#f44")'); return run('components.bubble.size') === 1 && run('components.bubble.get(body.bubble).solid'); })());
run('resetSystem()');

// ---------- goal sparks ----------
run('resetSystem(); for (const [id] of query("particle")) despawn(id)');
run('tick = 4; goalSparkSystem()');
const sparks = JSON.parse(run('JSON.stringify([...query("pos","particle")].map(e => e[1].x))'));
check('each sparking goal emits a particle', sparks.length === 2, JSON.stringify(sparks));
check("...from the goal's chosen edge (blue's goal: left edge x=1896; red's goal: right edge x=24)", sparks.includes(1896) && sparks.includes(24));
check('sparks drift out into the field (away from their edge)', run('(() => { const ps = [...query("pos","vel","particle")]; const right = ps.find(p => p[1].x === 1896), left = ps.find(p => p[1].x === 24); return right[2].x < 0 && left[2].x > 0; })()'));
run('for (const [id] of query("particle")) despawn(id); [...query("goal")][0][1].sparks = undefined; tick = 4; goalSparkSystem()');
check('a goal with no sparks edge emits nothing', run('[...query("particle")].length') === 1);
run('tick = 5; for (const [id] of query("particle")) despawn(id); goalSparkSystem()');
check('sparks are throttled (not every step)', run('[...query("particle")].length') === 0);

// ---------- death beam: particles, via the real frame loop ----------
run('for (const [id] of query("particle")) despawn(id); for (const [, g] of query("goal")) g.sparks = undefined;'); // quiet background
run('const [, bp, bv] = [...query("pos","vel","circle")][0]; bp.x = -50; bp.y = 900; bv.x = 0; bv.y = 0; globalThis.ballPos = bp;');
run('goalSystem()');
check('scoring starts the death animation', run('round.hit') === 1.2 && run('round.beam.victims.length') === 1);
const beam = JSON.parse(run('JSON.stringify(round.beam)'));
run('globalThis.beamHits = []; const realBeam = beamSystem; beamSystem = () => { beamHits.push(round.hit); realBeam(); };');
run('for (const [id] of query("particle")) despawn(id)'); // drop the death burst so we count only the beam
run('beamSystem(); globalThis.fresh = [...query("pos","particle","look")].map(e => ({ x: e[1].x, y: e[1].y, color: e[3].color, g: e[2].g }));');
const fresh = JSON.parse(run('JSON.stringify(fresh)'));
const victim = JSON.parse(run('(() => { const p = components.pos.get(round.beam.victims[0]), b = components.box.get(round.beam.victims[0]); return JSON.stringify({ x: p.x + b.w / 2, y: p.y + b.h / 2 }); })()'));
const distToBeam = (p) => { const dx = victim.x - beam.x, dy = victim.y - beam.y; const t = Math.max(0, Math.min(1, ((p.x - beam.x) * dx + (p.y - beam.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - (beam.x + dx * t), p.y - (beam.y + dy * t)); };
check('the beam is made of particles (3 per victim per step)', fresh.length === 3, String(fresh.length));
check("...in the scorer's color, with no gravity (they stay on the line)", fresh.every((p) => p.color === beam.color && p.g === 0));
check('...lying along the line from the ball to the victim', fresh.every((p) => distToBeam(p) < 12), fresh.map((p) => distToBeam(p).toFixed(1)).join(','));
run('for (const [id] of query("particle")) despawn(id)');
for (let t = 100; t <= 2500 && run('round.hit') > 0; t += 100) run(`frame(${t})`);
const hits = JSON.parse(run('JSON.stringify(beamHits)'));
check('the beam runs through the animation', hits.length > 50, String(hits.length));
check('...and stops ~0.4s before it ends (no beam particles once round.hit <= 0.4)', hits.every((h) => h > 0.4), `min hit seen: ${Math.min(...hits).toFixed(2)}`);
check('after the animation: reset + countdown (3s, already ticking)', run('round.hit <= 0 && round.t > 2.5 && round.t <= 3'), String(run('round.t')));

// ---------- what actually gets drawn ----------
run('resetSystem(); for (const [id] of query("particle")) despawn(id); round.t = 0; round.beam = null');
w.log.length = 0;
run('renderSystem()');
const L = w.log;
const idx = (pred, from = 0) => L.findIndex((e, i) => i >= from && pred(e, i));
check('health bars are drawn as 6-point bevelled paths (first path: moveTo 40,72 then lineTo 52,60 ...)', (() => {
  const i = idx((e) => e[0] === 'moveTo' && e[1] === 40 && e[2] === 72);
  return i >= 0 && JSON.stringify(L.slice(i + 1, i + 6).map((e) => [e[0], e[1], e[2]])) === JSON.stringify([['lineTo', 52, 60], ['lineTo', 64, 72], ['lineTo', 64, 108], ['lineTo', 52, 120], ['lineTo', 40, 108]]);
})());
check('filled health segments are filled (life left)', L.some((e) => e[0] === 'fill'));
check('grass is drawn in the GRASS colour: lots of short blades', (() => {
  const grass = run('GRASS'); // whatever colour the game uses (it is a constant in main.js)
  const i = idx((e, k) => e[0] === 'set' && e[1] === 'strokeStyle' && e[2] === grass && L[k + 1]?.[1] === 'lineWidth' && L[k + 1]?.[2] === 2);
  if (i < 0) return false;
  const end = idx((e) => e[0] === 'stroke', i);
  return L.slice(i, end).filter((e) => e[0] === 'lineTo').length > 150;
})());
check('each goal gets a 20% tint fill (224 x 210)', L.filter((e, i) => e[0] === 'fillRect' && e[3] === 224 && e[4] === 210 && L[i - 2]?.[2] === 0.2).length === 2); // (alpha is set, then the fill color, then the rect)

run('placeBubble(body, { x: 700, y: 500 }, { w: 32, h: 48 }, "#f44"); for (let i = 0; i < Math.round(BUBBLE_LIFE / DT / 2); i++) bubbleFadeSystem();');
L.length = 0; run('renderSystem()');
check('a half-faded bubble is filled at ~15% and outlined at ~45%', (() => {
  const alphas = L.filter((e) => e[0] === 'set' && e[1] === 'globalAlpha').map((e) => e[2]);
  return alphas.some((a) => Math.abs(a - 0.15) < 0.02) && alphas.some((a) => Math.abs(a - 0.45) < 0.03);
})(), JSON.stringify(L.filter((e) => e[0] === 'set' && e[1] === 'globalAlpha').map((e) => +e[2].toFixed(2))));
run('placeBubble(body, { x: 760, y: 500 }, { w: 32, h: 48 }, "#f44")');
L.length = 0; run('renderSystem()');
check('a ghost is drawn fainter than the solid bubble', (() => { const a = L.filter((e) => e[0] === 'set' && e[1] === 'globalAlpha').map((e) => e[2]); return a.some((x) => Math.abs(x - 0.9) < 0.02) && a.some((x) => x < 0.45 && x > 0.3); })());

run('round.hit = 1; round.beam = { color: "#f44", x: 100, y: 900, victims: [[...query("body")][0][0]] }');
L.length = 0; run('renderSystem()');
check('no solid beam line is drawn during the death animation (no 8px strokes)', !L.some((e) => e[0] === 'set' && e[1] === 'lineWidth' && e[2] === 8));
run('round.hit = 0; round.beam = null');

// ---------- online: bubbles replicate with their fade, and the particle cap fits the beam ----------
run('resetSystem(); for (const [id] of query("particle")) despawn(id)');
run('placeBubble(body, { x: 300, y: 300 }, { w: 32, h: 48 }, "#48f"); for (let i = 0; i < 120; i++) bubbleFadeSystem(); placeBubble(body, { x: 340, y: 300 }, { w: 32, h: 48 }, "#48f")');
const snap = JSON.parse(run('JSON.stringify(snapshot())'));
check('snapshot carries each bubble with its fade (older one is part-faded)', snap.bubbles.length === 2 && snap.bubbles.some((b) => b[5] < 0.7 && b[5] > 0.4) && snap.bubbles.some((b) => b[5] === 1), JSON.stringify(snap.bubbles.map((b) => b[5])));
const g = makeWorld();
g.run('levelReady = true');
g.run(`applySnapshot(${JSON.stringify(snap)})`);
check('a watcher draws both bubbles with the same fade', g.run('components.bubble.size') === 2 && Math.abs(g.run('[...query("bubble")].map(e => e[1].t / e[1].max).sort()[0]') - Math.min(...snap.bubbles.map((b) => b[5]))) < 0.01);
let threw = null;
try { g.run('renderSystem()'); } catch (e) { threw = e.message; }
check('...and renders them', threw === null, threw ?? '');
// Goal particles are bubbles: rings with a size, swaying across their path as they float, and drawn that way by watchers too.
run('for (const [id] of query("particle")) despawn(id); for (const [, g] of query("goal")) g.sparks = "top"; for (let i = 0; i < 40; i++) { tick++; goalSparkSystem(); }'); // (sparks were switched off above for a quiet background)
const goalParts = JSON.parse(run('JSON.stringify([...query("particle")].map(e => e[1]))'));
check('goals shed bubbles (a ring size and a sway), not plain squares', goalParts.length > 0 && goalParts.every((p) => p.r >= 2 && p.r <= 5.5 && p.wave && Math.abs(Math.hypot(p.wave.x, p.wave.y) - 1) < 1e-9), JSON.stringify(goalParts[0]));
const sway = JSON.parse(run(`(() => {
  for (const [id] of query("particle")) despawn(id);
  emitBubble(500, 500, 40, 0, "#48f", 2, 0, 4);                      // drifting right...
  emit(500, 500, 40, 0, "#48f", 2, 0);                               // ...next to a plain particle on the same path
  const [b, p] = [...query("pos", "particle")].map((e) => e[1]);
  const off = [];
  for (let i = 0; i < 180; i++) { particleSystem(); off.push(b.y - p.y); }
  return JSON.stringify(off);
})()`));
const crossings = sway.filter((v, i) => i && Math.sign(v) !== Math.sign(sway[i - 1])).length;
check('a bubble sways from side to side across its path (~7px each side of its centre line), where a plain particle goes straight', crossings >= 2 && Math.max(...sway.map(Math.abs)) > 3 && Math.max(...sway.map(Math.abs)) < 15, `${crossings} crossings, max ${Math.max(...sway.map(Math.abs)).toFixed(1)}px`);
run('for (const [id] of query("particle")) despawn(id); for (let i = 0; i < 40; i++) { tick++; goalSparkSystem(); } emit(0, 0, 0, 0, "#fff", 1)');
const bsnap = JSON.parse(run('JSON.stringify(snapshot())'));
g.run(`applySnapshot(${JSON.stringify({ ...bsnap, seq: 1e6 })})`);
const guestParts = JSON.parse(g.run('JSON.stringify([...query("particle")].map(e => e[1].r))'));
check('watchers get each bubble\'s size (a plain particle is 0), so they draw rings too', guestParts.filter((r) => r > 0).length === goalParts.length && guestParts.includes(0), JSON.stringify(guestParts.slice(0, 5)));
threw = null;
try { g.run('renderSystem()'); } catch (e) { threw = e.message; }
check('...and render them', threw === null, threw ?? '');

run('for (let i = 0; i < 400; i++) emit(i, 0, 0, 0, "#fff", 1)');
check('particle cap is 400 per snapshot', JSON.parse(run('JSON.stringify(snapshot())')).particles.length === 400);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
