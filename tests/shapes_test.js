// Circular slow-mo zones and goals, rounded wall corners, ceiling-type (rotated) slopes, and level selection by URL.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const src = ['level.js', 'sprites.js', 'net.js', 'main.js', 'online.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');

function makeWorld({ search = '', saved = null } = {}) {
  const log = [];
  const ctx = new Proxy({}, { get: (_, prop) => (...args) => { log.push([prop, ...args]); }, set: (_, prop, value) => { log.push(['set', prop, value]); return true; } });
  const els = {};
  const el = () => ({ getContext: () => ctx, hidden: false, value: '', textContent: '', onclick: null, select() {}, focus() {}, blur() {}, addEventListener() {} });
  const sandbox = { console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Promise, setTimeout, URLSearchParams, performance: { now: () => 0 },
    requestAnimationFrame: () => {}, addEventListener: () => {}, localStorage: { getItem: () => (saved ? JSON.stringify(saved) : null) }, HTMLInputElement: class {},
    encodeURIComponent, TypeError, fetch: () => Promise.resolve({}), document: { getElementById: (id) => (els[id] ??= el()), fonts: { load() {} } },
    ...(search !== null ? { location: { search } } : {}) };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { sandbox, log, run: (c) => vm.runInContext(c, sandbox) };
}
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

// ===================== level selection from the URL =====================
{
  const custom = { ...JSON.parse(JSON.stringify(fs.readFileSync(dir + 'level.js', 'utf8').length ? {} : {})) };
  const base = makeWorld();
  const lv = JSON.parse(base.run('JSON.stringify({ ...DEFAULT_LEVELS[0], name: "Mine" })'));
  check('no URL flag: starts on the first default level', base.run('LEVEL === DEFAULT_LEVELS[0]'));
  check('?level=custom with a saved level uses it', makeWorld({ search: '?level=custom', saved: lv }).run('LEVEL.name') === 'Mine');
  check('?level=custom but nothing saved: falls back to the default', makeWorld({ search: '?level=custom' }).run('LEVEL === DEFAULT_LEVELS[0]'));
  check('a saved level is ignored without the flag (you pick it from the level select instead)', makeWorld({ saved: lv }).run('LEVEL === DEFAULT_LEVELS[0]'));
  check('a broken saved level never loads', makeWorld({ search: '?level=custom', saved: { walls: 'nope' } }).run('LEVEL === DEFAULT_LEVELS[0]'));
  check('no `location` at all (older harness / odd environment) does not crash', makeWorld({ search: null, saved: lv }).run('LEVEL === DEFAULT_LEVELS[0]'));
  check('the default level is named', base.run('levelName(DEFAULT_LEVELS[0], 0)') === 'Classic');
}

// ===================== circular slow-mo zones =====================
{
  const w = makeWorld(), run = w.run;
  run('menu.open = false; for (const [id] of query("slow")) despawn(id);'); // drop the default zones
  run('spawn({ pos: { x: 400, y: 400 }, box: { w: 200, h: 200 }, slow: { color: "#888", shape: "circle" } })');
  const ball = (x, y) => run(`(() => { const [, p, v] = [...query("pos","vel","circle")][0]; p.x = ${x}; p.y = ${y}; v.x = 0; v.y = 0; })()`);
  ball(500, 500); run('slowSystem()');
  check('circular zone: the ball at the centre slows the game', run('clock.scale') < 1);
  ball(405, 405); run('slowSystem()');
  check("circular zone: the ball in the bounding box's CORNER (outside the circle) does not", run('clock.scale') === 1);
  ball(599, 500); run('slowSystem()');
  check('circular zone: near the rim but inside still counts', run('clock.scale') < 1);
  run('for (const [id] of query("slow")) despawn(id); spawn({ pos: { x: 400, y: 400 }, box: { w: 200, h: 200 }, slow: { color: "#888" } })');
  ball(405, 405); run('slowSystem()');
  check('a box zone (no shape) still covers that corner', run('clock.scale') < 1);

  // sparkles only appear inside the circle
  run('for (const [id] of query("slow")) despawn(id); spawn({ pos: { x: 400, y: 400 }, box: { w: 200, h: 200 }, slow: { color: "#888", shape: "circle" } }); for (const [id] of query("particle")) despawn(id)');
  ball(0, 0);
  let outside = 0, total = 0;
  for (let i = 0; i < 400; i++) {
    run('tick = 2; for (const [id] of query("particle")) despawn(id); slowSystem()');
    for (const p of JSON.parse(run('JSON.stringify([...query("pos","particle")].map(e => e[1]))'))) { total++; if (Math.hypot(p.x - 500, p.y - 500) > 100.0001) outside++; }
  }
  check('sparkles are emitted only inside a circular zone (400 samples)', total === 400 && outside === 0, `${total} emitted, ${outside} outside`);
  run('for (const [id] of query("slow")) despawn(id); spawn({ pos: { x: 400, y: 400 }, box: { w: 200, h: 100 }, slow: { color: "#888", shape: "circle" } })'); // an ellipse
  ball(500, 450); run('slowSystem()');
  check('a non-square box makes an ellipse: centre in', run('clock.scale') < 1);
  ball(590, 405); run('slowSystem()');
  check('...and the box corner is outside it', run('clock.scale') === 1);
}

// ===================== circular goals =====================
{
  const w = makeWorld(), run = w.run;
  run('menu.open = false');
  run('const owner0 = [...query("controls")].find(e => e[1].slot === 0)[0]; spawn({ pos: { x: 400, y: 300 }, box: { w: 200, h: 200 }, goal: { owner: owner0, sparks: "right", shape: "circle" }, look: { color: "#48f" } })');
  const ball = (x, y) => run(`(() => { const [, p, v] = [...query("pos","vel","circle")][0]; p.x = ${x}; p.y = ${y}; v.x = 0; v.y = 0; })()`);
  ball(405, 305); run('goalSystem()');
  check("circular goal: the ball in the box's corner does NOT score", run('round.hit') === 0);
  ball(500, 400); run('goalSystem()');
  check('circular goal: the ball in the middle scores', run('round.hit') > 0 && run('round.beam.victims.length') === 1);
  run('round.hit = 0; round.beam = null');

  // sparks come off the rim, on the chosen side
  run('for (const [id] of query("goal")) if (components.pos.get(id).x !== 400) components.goal.get(id).sparks = undefined; for (const [id] of query("particle")) despawn(id)');
  let offRim = 0, wrongSide = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    run('tick = 4; for (const [id] of query("particle")) despawn(id); goalSparkSystem()');
    for (const p of JSON.parse(run('JSON.stringify([...query("pos","particle")].map(e => e[1]))'))) {
      n++;
      if (Math.abs(Math.hypot(p.x - 500, p.y - 400) - 100) > 0.001) offRim++;
      if (Math.abs(Math.atan2(p.y - 400, p.x - 500)) > 0.7 + 1e-9) wrongSide++;
    }
  }
  check('circular goal sparks start exactly on the rim', n === 300 && offRim === 0, `${n} sparks, ${offRim} off the rim`);
  check("...on the arc facing the chosen side ('right': within ~40 degrees of due east)", wrongSide === 0, String(wrongSide));
  check('...and drift outward (away from the centre)', JSON.parse(run('(() => { tick = 4; for (const [id] of query("particle")) despawn(id); goalSparkSystem(); const e = [...query("pos","vel","particle")][0]; return JSON.stringify({ out: (e[1].x - 500) * e[2].x + (e[1].y - 400) * e[2].y }); })()')).out > 0);
}

// ===================== rendering =====================
{
  const w = makeWorld(), run = w.run;
  run('menu.open = false; round.t = 0');
  w.log.length = 0; run('renderSystem()');
  const walls = run('[...query("solid")].length');
  const rr = w.log.filter((c) => c[0] === 'roundRect');
  check(`every wall (${walls}) is drawn as a rounded rectangle`, rr.length === walls, String(rr.length));
  check('the corner radius is small (6px; less on thin walls)', rr.every((c) => c[5] > 0 && c[5] <= 6) && rr.some((c) => c[5] === 6), JSON.stringify([...new Set(rr.map((c) => c[5]))]));
  check('...no wall is outlined as a square-cornered strokeRect any more (only the 2 rectangular goals, 224 x 210, still are)', w.log.filter((c) => c[0] === 'strokeRect').every((c) => c[3] === 224 && c[4] === 210) && w.log.filter((c) => c[0] === 'strokeRect').length === 2);
  check('the hitboxes are still square (physics unchanged): walls keep their box components', run('[...query("solid","box")].every(e => e[2].w > 0 && e[2].h > 0)'));
  check('WALL_RADIUS is shared (level.js) so the builder matches', run('WALL_RADIUS') === 6);

  run('const owner0 = [...query("controls")][0][0]; spawn({ pos: { x: 400, y: 300 }, box: { w: 200, h: 200 }, goal: { owner: owner0, shape: "circle" }, look: { color: "#48f" } })');
  w.log.length = 0; run('renderSystem()');
  const el = w.log.filter((c) => c[0] === 'ellipse');
  check('a circular goal is drawn with an ellipse (tint fill + outline = 2 paths)', el.length === 2 && el.every((c) => c[3] === 100 && c[4] === 100), String(el.length));
  check('...its tint is 20% in its owner color', (() => { const i = w.log.findIndex((c) => c[0] === 'ellipse'); return w.log.slice(Math.max(0, i - 4), i).some((c) => c[0] === 'set' && c[1] === 'globalAlpha' && c[2] === 0.2); })());
}

// ===================== ceiling slopes (rotated quarter-pipes): players =====================
{
  const mk = (slope) => {
    const w = makeWorld(), run = w.run;
    run(`const S = ${JSON.stringify(slope)}; spawn({ slope: { ...S, pts: slopePoints(S) }, look: { color: '#fff' } });
      for (const [id, p] of query("pos","box","solid")) if (p.y === 700) despawn(id);
      const [, pos, , vel, body] = [...query("pos","controls","vel","body")].find(e => e[2].slot === 0);
      globalThis.P = { pos, vel, body }; const step = (vx) => { if (vx !== undefined) P.vel.x = vx; physicsSystem(); }; globalThis.step = step;`);
    return { w, run };
  };
  // thin end on the left (surface y=780), thick end on the right reaching the floor (y=976)
  const C = { x: 800, y: 780, w: 200, h: 196, high: 'right', ceiling: true };
  let { run } = mk(C);
  run('P.pos.x = 700; P.pos.y = 928; P.vel.x = 0; P.vel.y = 0; let minY = 1e9; for (let i = 0; i < 160; i++) { step(450); minY = Math.min(minY, P.pos.y); } globalThis.minY = minY');
  check("running into a ceiling slope's thick end at floor level: blocked like a wall (stops short of x=1000)", run('P.pos.x + 32') < 960 && run('P.pos.x + 32') > 930, run('(P.pos.x + 32).toFixed(1)'));
  check('...without being lifted or dropped (still standing on the floor, y = 928)', run('P.pos.y') === 928 && run('minY') === 928);
  ({ run } = mk(C));
  run('P.pos.x = 800; P.pos.y = 928; P.vel.x = 0; P.vel.y = 0; for (let i = 0; i < 20; i++) step(0)');
  const surfaceAt = (xp) => 780 + 196 * (xp - 800) / 200;
  run('P.vel.y = -620; let top = 1e9; for (let i = 0; i < 200; i++) { step(0); top = Math.min(top, P.pos.y); } globalThis.top = top');
  check('jumping up under it: head bump at the surface (not through it, not teleported)', Math.abs(run('top') - surfaceAt(832)) < 1.5, `${run('top').toFixed(1)} vs surface ${surfaceAt(832).toFixed(1)}`);
  ({ run } = mk(C));
  run('P.pos.x = 600; P.pos.y = 928; P.vel.x = 0; P.vel.y = 0; for (let i = 0; i < 20; i++) step(0); P.vel.y = -620; let top = 1e9; for (let i = 0; i < 200; i++) { step(0); top = Math.min(top, P.pos.y); } globalThis.top = top');
  check('away from it, the same jump goes the full height (no invisible ceiling)', run('top') < 928 - 200, run('top').toFixed(1));
  ({ run } = mk(C));
  run('P.pos.x = 900; P.pos.y = 500; P.vel.x = 0; P.vel.y = 0; for (let i = 0; i < 200; i++) step(0)');
  check("falling onto its flat top: lands and stands on it (y = 780 - 48)", run('P.pos.y') === 732 && run('P.body.grounded') === true, run('P.pos.y.toFixed(1)'));
  run('for (let i = 0; i < 60; i++) step(0)');
  check('...and stays grounded there (no jitter)', run('P.pos.y') === 732 && run('P.body.grounded'));
  run('let air = 0, onTop = 0; for (let i = 0; i < 60; i++) { step(450); if (P.pos.x + 32 > 800 && P.pos.x < 1000) { onTop++; if (!P.body.grounded) air++; } } globalThis.air = air; globalThis.onTop = onTop');
  check('walking across the top: grounded every step while over it (then it simply walks off the edge)', run('onTop') > 20 && run('air') === 0, `${run('onTop')} steps over it, ${run('air')} airborne`);
  // thick end on the LEFT mirrors it
  ({ run } = mk({ ...C, high: 'left' }));
  run('P.pos.x = 1100; P.pos.y = 928; P.vel.x = 0; P.vel.y = 0; for (let i = 0; i < 160; i++) step(-450)');
  check('high:left mirrors the first case: running left under the thin end, then blocked by the thick LEFT end at x ~ 849 (= 1800 - 951)', run('P.pos.x') > 845 && run('P.pos.x') < 860 && run('P.pos.y') === 928, run('P.pos.x.toFixed(1)'));
  // floor slopes are untouched
  ({ run } = mk({ x: 800, y: 776, w: 200, h: 200, high: 'right' }));
  run('P.pos.x = 700; P.pos.y = 928; P.vel.x = 0; P.vel.y = 0; for (let i = 0; i < 70; i++) step(450)');
  check('a normal floor ramp still climbs as before', run('P.pos.y') < 760 && run('P.body.grounded'), run('P.pos.y.toFixed(1)'));
}

// ===================== ceiling slopes: the ball =====================
{
  const w = makeWorld(), run = w.run;
  run(`const S = { x: 800, y: 780, w: 200, h: 196, high: 'right', ceiling: true }; globalThis.S = S; spawn({ slope: { ...S, pts: slopePoints(S) }, look: { color: '#fff' } });
    for (const [id, p] of query("pos","box","solid")) if (p.y === 700) despawn(id);
    const [, bp, bv] = [...query("pos","vel","circle")][0]; globalThis.bp = bp; globalThis.bv = bv;`);
  run('bp.x = 860; bp.y = 940; bv.x = 0; bv.y = -700; let worst = 1e9; for (let i = 0; i < 600; i++) { ballSystem(); worst = Math.min(worst, bp.y - slopeY(S, bp.x)); } globalThis.worst = worst');
  check("the ball bounces off a ceiling slope's underside and never gets inside the solid (centre stays below the surface)", run('worst') > -1, run('worst').toFixed(2));
  run('bp.x = 900; bp.y = 700; bv.x = 0; bv.y = 0; let top = 1e9; for (let i = 0; i < 300; i++) { ballSystem(); top = Math.min(top, bp.y); } globalThis.top = top; globalThis.restY = bp.y');
  check('dropped on its flat top, the ball rests on it (y = 780 - 22 = 758)', Math.abs(run('restY') - 758) < 1.5, run('restY').toFixed(1));
}


// ===================== hairline (2px) walls in the game =====================
{
  const mk = (extra = '') => {
    const w = makeWorld(), run = w.run;
    run(`for (const [id, p] of query("pos","box","solid")) if (p.y === 700) despawn(id); // drop the default platform
      spawn({ pos: { x: 800, y: 700 }, box: { w: 300, h: 2 }, solid: true, look: { color: '#fff' } });
      const [, pos, , vel, body] = [...query("pos","controls","vel","body")].find(e => e[2].slot === 0);
      globalThis.P = { pos, vel, body }; globalThis.step = (vx) => { if (vx !== undefined) P.vel.x = vx; physicsSystem(); }; ${extra}`);
    return { w, run };
  };
  let { run } = mk();
  run('P.pos.x = 900; P.pos.y = 500; P.vel.x = 0; P.vel.y = 0; for (let i = 0; i < 200; i++) step(0)');
  check('a player lands on a 2px platform and stands on it (y = 700 - 48, grounded)', run('P.pos.y') === 652 && run('P.body.grounded') === true, run('P.pos.y.toFixed(1)'));
  ({ run } = mk());
  run('P.pos.x = 900; P.pos.y = 300; P.vel.x = 0; P.vel.y = 2000; let below = false; for (let i = 0; i < 60; i++) { step(0); if (P.pos.y > 652.5) below = true; } globalThis.below = below');
  check('...even falling at 2000 px/s it does not tunnel through (16px per step vs a 2px wall)', run('below') === false && run('P.pos.y') === 652);
  ({ run } = mk());
  run('P.pos.x = 900; P.pos.y = 928; P.vel.x = 0; P.vel.y = 0; for (let i = 0; i < 10; i++) step(0)');
  run('for (const [id, p] of query("pos","box","solid")) if (p.y === 700) despawn(id); spawn({ pos: { x: 800, y: 800 }, box: { w: 300, h: 2 }, solid: true, look: { color: "#fff" } }); P.vel.y = -620; let top = 1e9; for (let i = 0; i < 150; i++) { step(0); top = Math.min(top, P.pos.y); } globalThis.top = top');
  check('jumping into the underside of a 2px ceiling: head bump at its bottom edge (y = 802)', Math.abs(run('top') - 802) < 0.5, run('top').toFixed(1));
  ({ run } = mk());
  run('const [, bp, bv] = [...query("pos","vel","circle")][0]; bp.x = 900; bp.y = 300; bv.x = 0; bv.y = 1000; let maxY = 0; for (let i = 0; i < 600; i++) { ballSystem(); maxY = Math.max(maxY, bp.y); } globalThis.maxY = maxY; globalThis.restY = bp.y');
  check('the ball at top speed bounces off a 2px wall and never gets through it (its centre never goes below the top: max y 678 = 700 - 22), and ends up sitting on it', run('maxY') <= 678.5 && run('restY') > 600 && run('restY') <= 678.5, `max y ${run('maxY').toFixed(1)}, ends at ${run('restY').toFixed(1)}`);
  ({ run } = mk());
  run(`const [, bp2, bv2] = [...query("pos","vel","circle")][0]; bp2.x = 640; bp2.y = 690; bv2.x = 900; bv2.y = 0;
    let through = false, entered = false;
    for (let i = 0; i < 300; i++) {
      ballSystem();
      if (bp2.x > 800 && bp2.x < 1100) entered = true;
      if (bp2.x > 800 && bp2.x < 1100 && bp2.y > 702) through = true;     // the centre got BELOW a bar it started above
      if (bp2.x > 800 && bp2.x < 1100 && bp2.y >= 700 && bp2.y <= 702) through = true; // or inside it
    }
    globalThis.through = through; globalThis.entered = entered;`);
  check('the ball driven sideways into the end of a 2px bar rides over or bounces off it (never inside it, never below it), at 900 px/s', run('through') === false, `entered the bar's span: ${run('entered')}`);
  const { w: rw, run: rrun } = mk();
  rrun('menu.open = false; round.t = 0');
  rw.log.length = 0; rrun('renderSystem()');
  check('the game draws it as a rounded rect with a 1px radius (min(6, 2/2))', rw.log.some((c) => c[0] === 'roundRect' && c[3] === 300 && c[4] === 2 && c[5] === 1));
  check('and the level validator accepts such a wall', rrun('isValidLevel({ ...DEFAULT_LEVEL, walls: [...DEFAULT_LEVEL.walls, { x: 0, y: 0, w: 300, h: 2 }] })'));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
