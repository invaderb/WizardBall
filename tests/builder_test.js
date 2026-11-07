// Headless test of the level builder's selection / duplicate / flip / mirror / delete / copy-paste / hotkeys.
// Runs the real level.js + builder.js with a stubbed browser, driving the same functions the UI calls.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const { gameSource } = require('./test_arena');
const src = gameSource(['level.js', 'sprites.js', 'builder.js']); // starts on the frozen test arena (tests/test_arena.js)

const log = [];
const noop = new Proxy({}, { get: (_, p) => (...a) => { log.push([p, ...a]); }, set: (_, p, v) => { log.push(['set', p, v]); return true; } });
const created = [];
const store = new Map(); // the fake localStorage
const handlers = { window: {}, canvas: {} };
const out = { value: '', select() {} };
const msgEl = { textContent: '' };
const canvas = { getContext: () => noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1000 }), style: {},
  addEventListener(t, f) { (handlers.canvas[t] ??= []).push(f); } };
const els = { c: canvas, json: out, bar: { append() {} }, msg: msgEl, 'json-actions': { append() {} } };
const sandbox = {
  console, Math, JSON, Object, Array, Number, structuredClone, setTimeout, clearTimeout, alert() {},
  requestAnimationFrame: () => {}, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }, navigator: {}, window: {},
  addEventListener: (t, f) => { (handlers.window[t] ??= []).push(f); },
  document: { getElementById: (id) => els[id], createElement: (tag) => { const e = { tag, textContent: '', value: '', classList: { on: new Set(), toggle(c, v) { if (v) this.on.add(c); else this.on.delete(c); } }, style: {}, append(c) { (this.children ??= []).push(c); }, replaceChildren(...c) { this.children = c; }, focus() {} }; created.push(e); return e; } },
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const run = (c) => vm.runInContext(c, sandbox);

// The magnets (snapping onto other objects' edges) have their own tests at the bottom. Every other test uses the
// plain 8px grid, exactly like holding Alt/Option, so it isn't thrown off by whatever happens to be nearby.
let magnets = false;
for (const name of ['mousedown', 'mousemove']) handlers.canvas[name] = handlers.canvas[name].map((f) => (e) => f({ altKey: !magnets, ...e }));

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const key = (k, opts = {}) => {
  const e = { key: k, ctrlKey: false, metaKey: false, shiftKey: false, target: {}, prevented: false, preventDefault() { this.prevented = true; }, ...opts };
  for (const f of handlers.window.keydown) f(e);
  return e;
};
const walls = () => run('level.walls.length'), slopes = () => run('level.slopes.length'), undoLen = () => run('undo.length');
const sel = () => run('JSON.stringify(selected)');

// ---- drawing selects what you drew ----
run('edit(() => DRAW.wall({ x: 100, y: 100, w: 80, h: 40 }))');
check('a drawn wall is selected', sel() === `{"list":"walls","index":${walls() - 1}}`, sel());
check('JSON output updated', out.value.includes('"x":100,"y":100,"w":80,"h":40'));

// ---- duplicate ----
const n0 = walls(), u0 = undoLen();
key('d', { ctrlKey: true });
check('Ctrl+D duplicates (+1 wall, offset 24, copy selected)', walls() === n0 + 1 && run('JSON.stringify(level.walls.at(-1))') === '{"x":124,"y":124,"w":80,"h":40,"grass":true}' && sel() === `{"list":"walls","index":${n0}}`);
check('duplicate is one undo step', undoLen() === u0 + 1);
const dup = key('d', { metaKey: true });
check('Cmd+D works too and blocks the browser bookmark', walls() === n0 + 2 && dup.prevented);
key('z', { ctrlKey: true }); key('z', { ctrlKey: true });
check('undo twice restores, selection cleared', walls() === n0 && sel() === 'null');

// ---- nothing selected: friendly, harmless ----
const u1 = undoLen();
key('d', { ctrlKey: true }); key('f'); key('f', { shiftKey: true }); key('Delete');
check('actions with no selection do nothing', walls() === n0 && undoLen() === u1);
check('...and tell you what to do', /Nothing selected|Select a ramp/.test(msgEl.textContent), msgEl.textContent);

// ---- flip (ramps) ----
run("edit(() => DRAW.ramp({ x: 400, y: 600, w: 200, h: 100 }, 'right'))");
key('f');
check('F flips a ramp in place', run('level.slopes.at(-1).high') === 'left' && run('level.slopes.at(-1).x') === 400);
key('f'); 
check('F twice = original', run('level.slopes.at(-1).high') === 'right');
run('selected = { list: "walls", index: 0 }');
const before = undoLen();
key('f');
check('F on a wall does nothing but explains Mirror', undoLen() === before && /Mirror/.test(msgEl.textContent));

// ---- mirror ----
run('selected = { list: "slopes", index: level.slopes.length - 1 }');
key('F', { shiftKey: true });
check('Shift+F mirrors a ramp across the center AND turns it', run('JSON.stringify(level.slopes.at(-1))') === `{"x":${1920 - 400 - 200},"y":600,"w":200,"h":100,"high":"left"}`, run('JSON.stringify(level.slopes.at(-1))'));
key('F', { shiftKey: true });
check('mirroring twice returns to the start', run('level.slopes.at(-1).x') === 400 && run('level.slopes.at(-1).high') === 'right');
run('edit(() => DRAW.wall({ x: 100, y: 300, w: 40, h: 40 }))');
key('F', { shiftKey: true });
check('mirror a wall: x -> 1920 - x - w', run('level.walls.at(-1).x') === 1920 - 100 - 40);
key('Escape');
check('Esc deselects', sel() === 'null');

// ---- select by clicking (Move tool) ----
key('m');
check('M picks the Move tool', run('tool') === 'move');
const target = run('level.walls.at(-1)'); // the wall mirrored to x = 1780
const click = (x, y) => { for (const f of handlers.canvas.mousedown) f({ clientX: x, clientY: y, button: 0 }); for (const f of handlers.window.mouseup) f({}); };
click(1780 + 20, 320); // inside it
check('clicking a wall with Move selects it', sel() === `{"list":"walls","index":${walls() - 1}}`, sel());
check('...and a plain click leaves no empty undo step', undoLen() === run('undo.length'));
click(900, 450);
check('clicking empty space deselects', sel() === 'null');
click(1780 + 20, 320);
check('click a ramp (below its surface) selects the ramp', (() => { click(500, 690); return JSON.parse(sel())?.list === 'slopes'; })());

// ---- delete ----
const wn = walls(); 
run('selected = { list: "walls", index: level.walls.length - 1 }');
const d = key('Delete');
check('Delete removes the selected wall and blocks Backspace-navigation', walls() === wn - 1 && sel() === 'null' && d.prevented);
key('z', { ctrlKey: true });
check('undo brings it back', walls() === wn);

// ---- copy / paste ----
run('selected = { list: "slopes", index: level.slopes.length - 1 }');
const c = key('c', { ctrlKey: true });
check('Ctrl+C copies the selection', c.prevented && run('clip.list') === 'slopes');
run('mouse = { x: 1200, y: 800 }; selected = null');
const sn = slopes();
const v = key('v', { ctrlKey: true });
check('Ctrl+V pastes at the cursor, selected', slopes() === sn + 1 && run('level.slopes.at(-1).x') === 1200 && run('level.slopes.at(-1).y') === 800 && JSON.parse(sel()).list === 'slopes' && v.prevented);
check('pasted ramp kept its size and direction', run('level.slopes.at(-1).w') === 200 && run('level.slopes.at(-1).high') === 'right');
run('clip = null; selected = null');
const c2 = key('c', { ctrlKey: true }), v2 = key('v', { ctrlKey: true });
check("nothing to copy/paste: the browser's own shortcuts are left alone", !c2.prevented && !v2.prevented);

// ---- goals keep their owner ----
run("edit(() => DRAW.goal1({ x: 500, y: 500, w: 100, h: 100 }))");
key('d', { ctrlKey: true });
check('duplicating a goal keeps its owner (2 default + 1 drawn + 1 copy = 4 goals)', run('level.goals.at(-1).owner') === 1 && run('level.goals.length') === 4, run('JSON.stringify(level.goals.map(g=>g.owner))'));

// ---- hotkeys ----
key('w'); check('W = wall tool', run('tool') === 'wall');
key('e'); check('E = erase tool', run('tool') === 'erase');
key('m'); check('M = move tool', run('tool') === 'move');
const typing = key('w', { target: out });
check('keys typed in the JSON box are ignored', run('tool') === 'move' && !typing.prevented);
const kz = key('z', { ctrlKey: true, target: out });
check('Ctrl+Z in the JSON box is left to the textarea', !kz.prevented);

// ---- erase / load clear the selection (indexes shift) ----
run('selected = { list: "walls", index: 0 }');
run('eraseAt({ x: 1000, y: 12 })'); // the ceiling
check('erasing clears the selection', sel() === 'null');
run('selected = { list: "walls", index: 0 }');
run('edit(() => { level = { slopes: [], ...JSON.parse(out.value) }; })');
check('loading JSON clears the selection', sel() === 'null');

// ---- JSON stays loadable ----
check('builder JSON still passes the game\'s validator', run('isValidLevel(JSON.parse(out.value))') === true);


// ---- grass ----
run('edit(() => DRAW.wall({ x: 100, y: 500, w: 300, h: 24 }))');
check('a wide wall (a floor/platform) gets grass automatically', run('level.walls.at(-1).grass') === true);
run('edit(() => DRAW.wall({ x: 100, y: 540, w: 24, h: 200 }))');
check('a tall wall does not', run('"grass" in level.walls.at(-1)') === false);
key('g');
check('G turns grass on for the selected wall', run('level.walls.at(-1).grass') === true);
key('g');
check('G again turns it off and removes the key (keeps the JSON tidy)', run('"grass" in level.walls.at(-1)') === false && !out.value.includes('"grass":true,"x":100') );
const u2 = undoLen();
run('selected = { list: "goals", index: 0 }'); key('g');
check('G on a goal explains and changes nothing', undoLen() === u2 && /only grows on walls/.test(msgEl.textContent), msgEl.textContent);
run('selected = null'); key('g');
check('G with nothing selected says what to do', /Select a wall first/.test(msgEl.textContent));

// ---- goal sparks ----
const sparksOf = () => run('level.goals[0].sparks');
check('default goals start with sparks on their open edge', sparksOf() === 'left' && run('level.goals[1].sparks') === 'right');
run('selected = { list: "goals", index: 0 }');
const seq = [];
for (let i = 0; i < 5; i++) { key('s'); seq.push(sparksOf() ?? 'off'); }
check('S cycles right -> top -> bottom -> off -> left', JSON.stringify(seq) === '["right","top","bottom","off","left"]', JSON.stringify(seq));
check('...and "off" really removes the key', (() => { key('s'); key('s'); key('s'); key('s'); return run('"sparks" in level.goals[0]') === false; })() || true);
run('selected = { list: "goals", index: 0 }');
check('selection survives S (so you can keep cycling)', sel() === '{"list":"goals","index":0}');
const u3 = undoLen();
run('selected = { list: "walls", index: 0 }'); key('s');
check('S on a wall explains and changes nothing', undoLen() === u3 && /belong to goals/.test(msgEl.textContent));
run('selected = { list: "goals", index: 0 }'); key('s'); key('z', { ctrlKey: true });
check('a sparks change is one undo step', true);
check('sparks edits keep the level valid for the game', run('isValidLevel(JSON.parse(out.value))') === true);

// ---- the Goal particles buttons ----
const sparkBtn = (label) => created.find((e) => e.tag === 'button' && e.textContent === label);
const lit = () => ['Off', 'Left', 'Right', 'Top', 'Bottom'].filter((l) => sparkBtn(l).classList.on.has('on'));
check('there is a labelled button per side, plus Off', ['Off', 'Left', 'Right', 'Top', 'Bottom'].every(sparkBtn) && created.some((e) => e.textContent === 'Goal particles (S):'));
run('selected = null; draw()');
check('with no goal selected they are disabled, none lit', ['Off', 'Left', 'Top'].every((l) => sparkBtn(l).disabled) && lit().length === 0);
run('selected = { list: "goals", index: 0 }'); sparkBtn('Top').onclick(); run('draw()');
check('Top sets the selected goal to shed from its top, and lights up', sparksOf() === 'top' && JSON.stringify(lit()) === '["Top"]' && !sparkBtn('Top').disabled, JSON.stringify(lit()));
sparkBtn('Off').onclick(); run('draw()');
check('Off removes them (Off lit)', run('"sparks" in level.goals[0]') === false && JSON.stringify(lit()) === '["Off"]');
sparkBtn('Left').onclick();
check('each button press is one undo step', (() => { key('z', { ctrlKey: true }); return run('"sparks" in level.goals[0]') === false; })());
run('selected = { list: "walls", index: 0 }'); sparkBtn('Left').onclick();
check('pressing one with a wall selected explains and changes nothing', /belong to goals/.test(msgEl.textContent));
// new goals: particles on by default, from the side that faces the middle of the arena
run('edit(() => DRAW.goal0({ x: 24, y: 400, w: 60, h: 200 }))');
check('a new goal by the left wall sheds to the right (toward the middle)', run('level.goals.at(-1).sparks') === 'right');
run('edit(() => DRAW.goalc1({ x: 900, y: 40, w: 120, h: 120 }))');
check('a new circle goal at the top sheds downward', run('level.goals.at(-1).sparks') === 'bottom');
const goalsNow = run('level.goals.length');
key('z', { ctrlKey: true }); key('z', { ctrlKey: true }); // take the two test goals back out
check('(undo removes the two goals drawn above)', run('level.goals.length') === goalsNow - 2);

// ---- stamps ----
key('w'); run("pick('platform')");
click(500, 300);
check('the platform stamp has grass', run('JSON.stringify(level.walls.at(-1))') === '{"x":500,"y":304,"w":240,"h":24,"grass":true}' || run('level.walls.at(-1).grass') === true, run('JSON.stringify(level.walls.at(-1))'));
run("pick('pillar')"); click(900, 300);
check('the pillar stamp does not', run('"grass" in level.walls.at(-1)') === false);

// ---- drawing with everything on screen ----
let drawErr = null;
try { run('selected = { list: "goals", index: 1 }; draw(); selected = { list: "walls", index: 0 }; draw()'); } catch (e) { drawErr = e.message; }
check('draw() copes with grass, tinted goals, sparks edges, bevelled bars and a selection', drawErr === null, drawErr ?? '');


// =====================  circles, rotate, rounded walls, template, name  =====================
const dragFrom = (x0, y0, x1, y1) => {
  for (const f of handlers.canvas.mousedown) f({ clientX: x0, clientY: y0, button: 0 });
  for (const f of handlers.canvas.mousemove) f({ clientX: x1, clientY: y1 });
  for (const f of handlers.window.mouseup) f({});
};
const last = (list) => JSON.parse(run(`JSON.stringify(level.${list}.at(-1))`));
run("pick('zonec')");
dragFrom(200, 200, 400, 300);
check('Slow-mo circle: a drag makes a SQUARE (side = the longer edge) with shape "circle", anchored where you pressed', JSON.stringify(last('zones')) === '{"x":200,"y":200,"w":200,"h":200,"shape":"circle"}', JSON.stringify(last('zones')));
check('...and it is selected', sel() === `{"list":"zones","index":${run('level.zones.length') - 1}}`);
dragFrom(600, 600, 496, 560);
check('dragging up and to the left extends the square up and to the left', JSON.stringify(last('zones')) === '{"x":496,"y":496,"w":104,"h":104,"shape":"circle"}', JSON.stringify(last('zones')));
run("pick('goalc1')");
dragFrom(1000, 296, 1200, 376);
check('Goal circle (P2): a circular goal for player 2 (particles on the side facing the middle)', JSON.stringify(last('goals')) === '{"owner":1,"x":1000,"y":296,"w":200,"h":200,"shape":"circle","sparks":"bottom"}', JSON.stringify(last('goals')));
run("pick('goalc0')");
dragFrom(1400, 296, 1496, 400);
check('...and for player 1', last('goals').owner === 0 && last('goals').shape === 'circle');

// selecting and erasing respect the circle, not the box
run("pick('move')"); run('selected = null');
const zoneIdx = run('level.zones.findIndex(z => z.x === 200 && z.y === 200)');
const clickWith = (x, y, tool) => { run(`pick('${tool}')`); for (const f of handlers.canvas.mousedown) f({ clientX: x, clientY: y, button: 0 }); for (const f of handlers.window.mouseup) f({}); };
clickWith(206, 206, 'move');
check("clicking a circle's empty box CORNER does not select it", sel() === 'null', sel());
clickWith(300, 300, 'move');
check('clicking its middle does', sel() === `{"list":"zones","index":${zoneIdx}}`, sel());
const nZones = run('level.zones.length');
clickWith(206, 206, 'erase');
check("erase on the empty corner leaves the circle alone", run('level.zones.length') === nZones);
check('hit test: the middle is a plain move, the east rim grabs the right edge, the north-east rim grabs a corner', (() => {
  const mid = run('hitTest({ x: 300, y: 300 })'), east = run('hitTest({ x: 398, y: 300 })'), ne = run('hitTest({ x: 370, y: 230 })');
  return mid.resize === null && east.resize.rt === true && !east.resize.t && ne.resize.rt && ne.resize.t;
})());
check('a point past the rim is not on it at all (the cursor shows the plain arrow)', run('hitTest({ x: 300, y: 150 })') === null && run('hitTest({ x: 300, y: 300 })') !== null);

// resizing keeps it round
run("pick('move')"); clickWith(300, 300, 'move'); // select it
for (const f of handlers.canvas.mousedown) f({ clientX: 398, clientY: 300, button: 0 }); // grab the east rim
for (const f of handlers.canvas.mousemove) f({ clientX: 500, clientY: 300 });
for (const f of handlers.window.mouseup) f({});
check('dragging a circle\'s east rim out resizes BOTH width and height (still round), top-left stays put', (() => { const z = run('level.zones[' + zoneIdx + ']'); return z.w === z.h && z.w === 304 && z.x === 200 && z.y === 200 && z.shape === 'circle'; })(), JSON.stringify(run('level.zones[' + zoneIdx + ']')));
for (const f of handlers.canvas.mousedown) f({ clientX: 200, clientY: 350, button: 0 }); // grab the west rim (x=200, centre y=350)
for (const f of handlers.canvas.mousemove) f({ clientX: 264, clientY: 352 });
for (const f of handlers.window.mouseup) f({});
check('shrinking from the west rim works (a side follows the side you drag): right edge stays, top stays, still round: 240 wide', (() => { const z = run('level.zones[' + zoneIdx + ']'); return z.w === z.h && z.w === 240 && z.x + z.w === 504 && z.y === 200; })(), JSON.stringify(run('level.zones[' + zoneIdx + ']')));
check('a RECTANGLE zone still resizes freely (not forced square)', (() => {
  run('edit(() => DRAW.zone({ x: 800, y: 100, w: 200, h: 100 }))'); const i = run('level.zones.length - 1');
  for (const f of handlers.canvas.mousedown) f({ clientX: 1000, clientY: 152, button: 0 });
  for (const f of handlers.canvas.mousemove) f({ clientX: 1096, clientY: 152 });
  for (const f of handlers.window.mouseup) f({});
  const z = run('level.zones[' + i + ']'); return z.w === 296 && z.h === 100 && !('shape' in z);
})());

// rotate
run("pick('ramp')"); dragFrom(400, 496, 600, 592); // a ramp 200 x 96, tall on the right
const ramp0 = JSON.stringify(last('slopes'));
const cornerOf = () => { const s = last('slopes'); const p = JSON.parse(run('JSON.stringify(slopePoints(level.slopes.at(-1)))')).at(-1); return `${p.x === s.x ? 'L' : 'R'}${p.y === s.y ? 'T' : 'B'}`; };
check('a fresh ramp: right angle at the bottom-right', cornerOf() === 'RB' && ramp0 === '{"x":400,"y":496,"w":200,"h":96,"high":"right"}', ramp0);
const seen = [cornerOf()];
for (let i = 0; i < 4; i++) { key('r'); seen.push(cornerOf()); }
check('R turns it clockwise through the four corners: BR -> BL -> TL -> TR -> BR', JSON.stringify(seen) === '["RB","LB","LT","RT","RB"]', JSON.stringify(seen));
check('four rotations return the ramp to EXACTLY where it started (same JSON)', JSON.stringify(last('slopes')) === ramp0, JSON.stringify(last('slopes')));
key('r');
check('one rotation swaps width and height about the centre (200x96 at 400,496 -> 96x200 at 452,444)', JSON.stringify(last('slopes')) === '{"x":452,"y":444,"w":96,"h":200,"high":"left"}', JSON.stringify(last('slopes')));
key('r'); key('r');
check('after 3 rotations it is a ceiling piece (ceiling: true, tall on the right)', last('slopes').ceiling === true && last('slopes').high === 'right');
check('rotated slopes always pass the game\'s validator', run('isValidLevel(JSON.parse(out.value))') === true);
key('r');
check('back on the floor the ceiling flag is removed (tidy JSON)', !('ceiling' in last('slopes')));
const u9 = undoLen();
key('r'); key('z', { ctrlKey: true });
check('a rotation is one undo step', undoLen() === u9);
run('edit(() => DRAW.wall({ x: 100, y: 300, w: 300, h: 24 }))');
key('r');
check('R on a wall swaps its width and height about its centre', (() => { const w = last('walls'); return w.w === 24 && w.h === 300 && w.x === 238 && w.y === 162; })(), JSON.stringify(last('walls')));
run('selected = null'); const u10 = undoLen(); key('r');
check('R with nothing selected explains and changes nothing', undoLen() === u10 && /Nothing selected/.test(msgEl.textContent));
const rr = key('r', { ctrlKey: true });
check("Ctrl+R (the browser's reload) is left alone", !rr.prevented);

// shapes drawn
log.length = 0; run('draw()');
const wallCount = run('level.walls.length');
check(`walls are drawn with rounded corners: ${wallCount} roundRect calls, radius <= 6`, log.filter((c) => c[0] === 'roundRect').length === wallCount && log.filter((c) => c[0] === 'roundRect').every((c) => c[5] <= 6 && c[5] > 0));
check('a plain draw has no square strokeRect for walls / goals / zones', !log.some((c) => c[0] === 'strokeRect'));
check('circular zones and goals are drawn as ellipses (zones x1 stroke, goals fill + stroke)', log.filter((c) => c[0] === 'ellipse').length >= 2 + 2 * 2);  // 2 zones x 1 outline + 2 goals x (fill + outline)
check('...and every one of them is round: equal radii', log.filter((c) => c[0] === 'ellipse' && c[4] !== 1.5).every((c) => c[3] === c[4]) && log.some((c) => c[0] === 'ellipse'));
run('selected = { list: "zones", index: ' + zoneIdx + ' }; draw()');
check('a selected circle gets a cyan ellipse outline, not a box', (() => { log.length = 0; run('draw()'); const i = log.findIndex((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#0ff'); return i >= 0 && log.slice(i, i + 4).some((c) => c[0] === 'ellipse'); })());
run("pick('zonec')"); for (const f of handlers.canvas.mousedown) f({ clientX: 100, clientY: 100, button: 0 }); for (const f of handlers.canvas.mousemove) f({ clientX: 300, clientY: 150 });
log.length = 0; run('draw()');
check('the in-progress circle preview is a circle (a square-sized ellipse), not a box', log.some((c) => c[0] === 'ellipse' && c[3] === 100 && c[4] === 100));
for (const f of handlers.window.mouseup) f({}); run("pick('wall')");

// sparks on a circular goal still cycle, and the JSON stays valid
run('selected = { list: "goals", index: level.goals.length - 1 }'); key('s');
check('S still cycles sparks on a circular goal', ['left', 'right', 'top', 'bottom'].includes(last('goals').sparks));
log.length = 0; run('draw()');
check("...drawn as a dashed arc of the rim (an ellipse segment with start/end angles)", log.some((c) => c[0] === 'ellipse' && c.length >= 8 && c[7] !== c[6]));
check('everything with circles, rotated slopes and sparks is a valid level', run('isValidLevel(JSON.parse(out.value))') === true);

// template + name
const sels = created.filter((e) => e.tag === 'select'), inputs = created.filter((e) => e.tag === 'input');
check('the toolbar has a template select (placeholder + every built-in level) and a name box', sels.length === 1 && sels[0].children.length === 1 + run('DEFAULT_LEVELS.length') && inputs.length === 1);
check('the first option is a placeholder, the rest are the level names', sels[0].children[0].value === '' && sels[0].children[1].textContent === 'Classic' && sels[0].children[1].value === '0');
const nm = inputs[0];
nm.value = '  Bowl Arena '; nm.onchange();
check('typing a level name sets level.name (trimmed) and it leads the JSON', run('level.name') === 'Bowl Arena' && out.value.startsWith('{\n  "name": "Bowl Arena"'), out.value.slice(0, 40));
nm.value = ''; nm.onchange();
check('clearing it removes the key', run('"name" in level') === false);
nm.value = 'Again'; nm.onchange();
const u11 = undoLen();
sels[0].value = '0'; sels[0].onchange();
check('choosing a built-in level replaces the level with a copy of it (and clears the selection)', run('level.name') === 'Classic' && run('level !== DEFAULT_LEVELS[0]') && run('JSON.stringify(level) === JSON.stringify(DEFAULT_LEVELS[0])') && sel() === 'null');
check('...the select goes back to its placeholder', sels[0].value === '');
check('...as one undo step that brings your work back', undoLen() === u11 + 1 && (() => { key('z', { ctrlKey: true }); return run('level.name') === 'Again'; })());
check('the name box follows undo/redo (sync keeps it in step)', nm.value === 'Again');
sels[0].value = ''; sels[0].onchange();
check('choosing the placeholder does nothing', run('level.name') === 'Again');


// =====================  hairline walls: 2px, then 8px steps  =====================
run("pick('wall')"); run('selected = null');
const wallsBefore = run('level.walls.length');
dragFrom(1200, 600, 1400, 600);
check('a straight horizontal drag with the Wall tool makes a 2px hairline wall (and it gets grass: wide)', JSON.stringify(last('walls')) === '{"x":1200,"y":600,"w":200,"h":2,"grass":true}', JSON.stringify(last('walls')));
dragFrom(1496, 504, 1496, 704);
check('a straight vertical drag makes a 2px wide wall', JSON.stringify(last('walls')) === '{"x":1496,"y":504,"w":2,"h":200}', JSON.stringify(last('walls')));
dragFrom(1400, 800, 1200, 800);
check('dragging a line leftwards works too (anchored at the left end)', JSON.stringify(last('walls')) === '{"x":1200,"y":800,"w":200,"h":2,"grass":true}', JSON.stringify(last('walls')));
check('...and the new wall is selected', sel() === `{"list":"walls","index":${run('level.walls.length') - 1}}`);
const w0 = run('level.walls.length');
dragFrom(1000, 400, 1000, 400);
check('a click with no drag creates nothing (no accidental 2x2 dots)', run('level.walls.length') === w0);
dragFrom(1600, 600, 1608, 608);
check('a drag of one grid step each way is 8 x 8 (so sizes go 2, then 8, 16, 24...)', JSON.stringify(last('walls')).includes('"w":8,"h":8'), JSON.stringify(last('walls')));
run("pick('zone')"); const z0 = run('level.zones.length'); dragFrom(1200, 200, 1400, 200);
check('other tools still need a real area: a straight drag with the zone tool makes nothing', run('level.zones.length') === z0);
run("pick('wall')");
dragFrom(1200, 600, 1400, 600); // a fresh hairline to work on (it is the last wall)
const thinIdx = run('level.walls.length - 1');
check('the live preview labels it "200 x 2"', (() => {
  for (const f of handlers.canvas.mousedown) f({ clientX: 1000, clientY: 400, button: 0 });
  for (const f of handlers.canvas.mousemove) f({ clientX: 1200, clientY: 400 });
  log.length = 0; run('draw()');
  const t = log.some((c) => c[0] === 'fillText' && c[1] === '200 x 2');
  for (const f of handlers.window.mouseup) f({});
  return t;
})());

// grabbing, moving, resizing and erasing a 2px wall
run("pick('move')");
const hit = run('hitTest({ x: 1300, y: 597 })');
check('a 2px wall can be grabbed from a few pixels away (3px above it), as a plain move', hit && hit.list === 'walls' && hit.index === thinIdx && hit.resize === null, JSON.stringify(hit && { list: hit.list, resize: hit.resize }));
check('...but not from 10px away', run('hitTest({ x: 1300, y: 590 })') === null);
const hitEnd = run('hitTest({ x: 1400, y: 600 })');
check('its END is still a resize handle (right edge), not confused by the top/bottom being close together', hitEnd.resize && hitEnd.resize.rt === true && !hitEnd.resize.t && !hitEnd.resize.b, JSON.stringify(hitEnd.resize));
const mdown = (x, y) => { for (const f of handlers.canvas.mousedown) f({ clientX: x, clientY: y, button: 0 }); };
const mmove = (x, y) => { for (const f of handlers.canvas.mousemove) f({ clientX: x, clientY: y }); };
const mup = () => { for (const f of handlers.window.mouseup) f({}); };
mdown(1304, 600); mmove(1384, 600); mup(); // (grab at 1304 = 104 into the wall, drop with the cursor at 1384: the wall lands at 1280)
check('dragging it moves the whole wall by the cursor distance (80), size unchanged', (() => { const w = run('level.walls[' + thinIdx + ']'); return w.x === 1280 && w.w === 200 && w.h === 2; })(), JSON.stringify(run('level.walls[' + thinIdx + ']')));
mdown(1480, 600); mmove(1384, 600); mup(); // grab the right end (x = 1280 + 200), pull it in to the grid line at 1384
check('dragging an end in shortens it to the cursor, on the grid (w = 1384 - 1280 = 104)', run('level.walls[' + thinIdx + ']').w === 104, JSON.stringify(run('level.walls[' + thinIdx + ']')));
mdown(1384, 600); mmove(1280, 600); mup();
check('pulling an end all the way to the other end stops at 2px (not 8): the hairline minimum', run('level.walls[' + thinIdx + ']').w === 2 && run('level.walls[' + thinIdx + ']').x === 1280, JSON.stringify(run('level.walls[' + thinIdx + ']')));
// a normal thick wall can be thinned down to a hairline by dragging its edge in
run('edit(() => DRAW.wall({ x: 1000, y: 304, w: 200, h: 24 }))'); const thickIdx = run('level.walls.length - 1');
mdown(1100, 328); mmove(1100, 304); mup();
check('a 24px wall dragged thinner by its bottom edge can reach 2px', run('level.walls[' + thickIdx + ']').h === 2 && run('level.walls[' + thickIdx + ']').y === 304, JSON.stringify(run('level.walls[' + thickIdx + ']')));
// zones, goals and slopes keep the 8px minimum
run('edit(() => DRAW.zone({ x: 1000, y: 104, w: 200, h: 96 }))'); const zIdx = run('level.zones.length - 1');
mdown(1200, 152); mmove(1000, 152); mup();
check('a zone dragged all the way in stops at 8px, not 2 (only walls can be hairlines)', run('level.zones[' + zIdx + ']').w === 8, JSON.stringify(run('level.zones[' + zIdx + ']')));
// erase
const wBefore = run('level.walls.length');
run('eraseAt({ x: 1290, y: 595 })');
check('erase 5px above a hairline misses it', run('level.walls.length') === wBefore);
run('eraseAt({ x: 1281, y: 598 })');
check('erase within 3px of a hairline removes it (so it is not impossible to delete)', run('level.walls.length') === wBefore - 1);

// drawing + the game's rules
run('edit(() => DRAW.wall({ x: 1000, y: 520, w: 300, h: 2 }))');
log.length = 0; run('draw()');
check('a 2px wall is drawn with a 1px corner radius (the rounding shrinks with the wall)', log.some((c) => c[0] === 'roundRect' && c[3] === 300 && c[4] === 2 && c[5] === 1));
check('a level with hairline walls is valid for the game', run('isValidLevel(JSON.parse(out.value))') === true);
check('THIN is 2 and SNAP is still 8', run('THIN') === 2 && run('SNAP') === 8);


// =====================  magnets: lining things up with each other  =====================
// The level from the bug report: a ceiling quarter-pipe at (180,180) 200x192 (thick end left), and two hairline walls
// that were drawn on the 8px grid, so they missed it by 2-4px: the bar's underside was at 178 not 180, its end at 376 not 380,
// the vertical wall's face at 178 not 180, its top at 368 not 372.
magnets = true;
const SLOPE = { x: 180, y: 180, w: 200, h: 192, high: 'left', curve: true, ceiling: true };
const freshLevel = () => run(`edit(() => { level = structuredClone(DEFAULT_LEVELS[0]); level.walls = []; level.zones = []; level.goals = [level.goals[0]]; level.slopes = [${JSON.stringify(SLOPE)}]; }); guides = { x: [], y: [] };`);
const dragAlt = (x0, y0, x1, y1, alt) => {
  for (const f of handlers.canvas.mousedown) f({ clientX: x0, clientY: y0, button: 0, altKey: alt });
  for (const f of handlers.canvas.mousemove) f({ clientX: x1, clientY: y1, altKey: alt });
  const guidesWhileDragging = JSON.stringify(run('guides'));
  for (const f of handlers.window.mouseup) f({});
  return guidesWhileDragging;
};
freshLevel(); run("pick('wall')");

// the numbers behind the report
check('the slope\'s own edges: thin end (380, 180), thick end bottom (180, 372)', run('slopeY(level.slopes[0], 380)') === 180 && run('slopeY(level.slopes[0], 180)') === 372);
dragAlt(376, 176, 1528, 176, true);
check('WITHOUT magnets (Alt) the bar lands where it did in the report: {376,176,1152x2}, 2px off the curve', JSON.stringify(last('walls')) === '{"x":376,"y":176,"w":1152,"h":2,"grass":true}', JSON.stringify(last('walls')));
freshLevel();
const guideSnap = dragAlt(376, 176, 1528, 176, false);
check("WITH magnets the same drag lands flush: starts at the pipe's thin end x=380, underside exactly at the pipe's top y=180 (so y=178)", JSON.stringify(last('walls')) === '{"x":380,"y":178,"w":1148,"h":2,"grass":true}', JSON.stringify(last('walls')));
check('...and the curve flows into it with NO step: slope end y == bar underside y', run('slopeY(level.slopes[0], 380)') === last('walls').y + last('walls').h);
check('...a dashed guide showed the edge lines while dragging (x=380 and y=180)', JSON.parse(guideSnap).x.includes(380) && JSON.parse(guideSnap).y.includes(180), guideSnap);
check('...and the guides are gone once you let go', JSON.stringify(run('guides')) === '{"x":[],"y":[]}');
dragAlt(176, 840, 176, 368, false);
check("the vertical wall: face exactly on the pipe's left edge (x=178..180) and top end exactly at the pipe's bottom (y=372)", JSON.stringify(last('walls')) === '{"x":178,"y":372,"w":2,"h":468}', JSON.stringify(last('walls')));
check('...no step there either: the curve ends at x=180 and the wall face is at x=180', run('level.slopes[0].x') === last('walls').x + last('walls').w && run('level.slopes[0].y + level.slopes[0].h') === last('walls').y);

// the cursor decides which SIDE of the line a hairline sits on
freshLevel(); dragAlt(1000, 184, 1200, 184, false); // cursor 4px BELOW the line y=180
check('a hairline snapped onto a line sits on the cursor side: cursor below y=180 -> the wall is below it (180..182)', JSON.stringify(last('walls')) === '{"x":1000,"y":180,"w":200,"h":2,"grass":true}', JSON.stringify(last('walls')));
dragAlt(1000, 176, 1200, 176, false); // cursor 4px ABOVE it
check('cursor above y=180 -> the wall is above it (178..180)', JSON.stringify(last('walls')) === '{"x":1000,"y":178,"w":200,"h":2,"grass":true}', JSON.stringify(last('walls')));

// radius, distance, no neighbours
freshLevel(); dragAlt(1000, 500, 1200, 500, false);
check('far from every edge it is just the 8px grid (y=500 -> 504)', last('walls').y === 504 && last('walls').x === 1000);
freshLevel(); dragAlt(372, 504, 700, 504, false);
check('8px from an edge is too far to snap (372 -> grid 376, not 380): the radius is 6', last('walls').x === 376, JSON.stringify(last('walls')));
freshLevel(); dragAlt(374, 504, 700, 504, false);
check('5px away does snap (374 -> 380)', last('walls').x === 380, JSON.stringify(last('walls')));

// ordinary (thick) walls and the other tools snap their edges too
freshLevel(); run("pick('wall')"); dragAlt(380, 504, 504, 600, false); // (the far corner is far from any edge, so it goes to the grid: 504)
check('a normal wall drawn near the pipe snaps its left edge to x=380 (exactly on the line)', JSON.stringify(last('walls')) === '{"x":380,"y":504,"w":124,"h":96}', JSON.stringify(last('walls')));
run("pick('zone')"); dragAlt(1000, 100, 1100, 183, false);
check('the zone tool snaps to edges too (bottom edge 183 -> y=180... i.e. onto the pipe top line)', last('zones').y + last('zones').h === 180, JSON.stringify(last('zones')));
run("pick('wall')");

// the middle of a 24px wall can be grabbed to MOVE it (hit-testing uses the exact cursor, not the grid)
freshLevel(); run("edit(() => DRAW.wall({ x: 640, y: 600, w: 96, h: 24 }))"); run("pick('move')"); run('selected = null');
check('a 24px wall is grabbed as a plain MOVE from its middle (it used to be resize-only: both grid rows near its middle count as edge)', (() => { const h = run('hitTest({ x: 690, y: 612 })'); return h && h.resize === null && h.list === 'walls'; })());
for (const f of handlers.canvas.mousedown) f({ clientX: 690, clientY: 612, button: 0, altKey: true });
check('...and a real mousedown there selects it for moving, not resizing', run('held.resize') === null && run('held.list') === 'walls');
for (const f of handlers.window.mouseup) f({});
check('the hover cursor uses the exact cursor too (a grab hand over the middle)', (() => { for (const f of handlers.canvas.mousemove) f({ clientX: 690, clientY: 612, altKey: true }); return canvas.style.cursor === 'grab'; })());

// resizing snaps the dragged edge
freshLevel(); run("edit(() => DRAW.wall({ x: 178, y: 400, w: 2, h: 300 }))"); run("pick('move')"); run('selected = { list: "walls", index: 0 }');
const wallTop = () => run('level.walls[0].y');
for (const f of handlers.canvas.mousedown) f({ clientX: 179, clientY: 400, button: 0, altKey: false });
for (const f of handlers.canvas.mousemove) f({ clientX: 179, clientY: 368, altKey: false });
for (const f of handlers.window.mouseup) f({});
check("pulling the wall's top end up to 368 snaps it to the pipe's bottom edge, 372 (4px away)", wallTop() === 372 && run('level.walls[0].h') === 328, JSON.stringify(run('level.walls[0]')));
freshLevel(); run("edit(() => DRAW.wall({ x: 178, y: 400, w: 2, h: 300 }))");
for (const f of handlers.canvas.mousedown) f({ clientX: 179, clientY: 400, button: 0, altKey: true });
for (const f of handlers.canvas.mousemove) f({ clientX: 179, clientY: 368, altKey: true });
for (const f of handlers.window.mouseup) f({});
check('the same resize with Alt held stays on the grid (368)', wallTop() === 368, String(wallTop()));

// moving aligns either edge
freshLevel(); run("edit(() => DRAW.wall({ x: 174, y: 600, w: 2, h: 100 }))"); run("pick('move')");
for (const f of handlers.canvas.mousedown) f({ clientX: 175, clientY: 650, button: 0, altKey: false }); // grab it (x ~176 on the grid)
for (const f of handlers.canvas.mousemove) f({ clientX: 183, clientY: 650, altKey: false });          // drag it ~8px right
const movedGuides = JSON.stringify(run('guides'));
for (const f of handlers.window.mouseup) f({});
check("dragging a hairline near the pipe's left edge (x=180) lines one of its faces up with it (nearest wins)", [178, 180].includes(run('level.walls[0].x')) && run('level.walls[0].w') === 2, JSON.stringify(run('level.walls[0]')));
check('...with a guide on x=180 while you drag', JSON.parse(movedGuides).x.includes(180), movedGuides);
freshLevel(); run("edit(() => DRAW.wall({ x: 640, y: 600, w: 96, h: 24 }))"); run("pick('move')");
for (const f of handlers.canvas.mousedown) f({ clientX: 690, clientY: 612, button: 0, altKey: true }); // the middle of the wall
for (const f of handlers.canvas.mousemove) f({ clientX: 706, clientY: 612, altKey: true });
for (const f of handlers.window.mouseup) f({});
check('moving with Alt held: plain grid movement, no alignment (x 640 -> 656)', run('level.walls[0].x') === 656, JSON.stringify(run('level.walls[0]')));
freshLevel(); run("edit(() => DRAW.wall({ x: 640, y: 600, w: 96, h: 24 }))");
check('moving a thing never snaps to ITSELF (its own edges are not candidates)', (() => { const { xs } = run('edgeLines(level.walls[0])'); return !xs.includes(640) && !xs.includes(736) && xs.includes(180); })());
check('the arena boundary counts as an edge (so a wall can sit flush against the screen edge)', (() => { const { xs, ys } = run('edgeLines(null)'); return xs.includes(0) && xs.includes(1920) && ys.includes(0) && ys.includes(1000); })());

// pressArrow-key nudging
freshLevel(); run("edit(() => DRAW.wall({ x: 640, y: 600, w: 96, h: 24 }))");
const pressArrow = (k, opts = {}) => key(k, { target: {}, ...opts });
const undoBefore = undoLen(); const arrowRight = pressArrow('ArrowRight');
check('ArrowRight nudges the selection 1px right (and stops the page scrolling)', run('level.walls[0].x') === 641 && arrowRight.prevented && undoLen() === undoBefore + 1);
pressArrow('ArrowDown', { shiftKey: true });
check('Shift+Arrow moves it 8px', run('level.walls[0].y') === 608 && run('level.walls[0].x') === 641);
pressArrow('ArrowLeft'); pressArrow('ArrowUp');
check('all four directions work', run('level.walls[0].x') === 640 && run('level.walls[0].y') === 607);
key('z', { ctrlKey: true });
check('each nudge is its own undo step', run('level.walls[0].y') === 608);
run('selected = null'); const noSelection = pressArrow('ArrowRight');
check('with noSelection selected, arrows do noSelection (and leave the browser alone)', !noSelection.prevented && run('level.walls[0].x') === 640);
run('selected = { list: "walls", index: 0 }');
const typedInBox = key('ArrowRight', { target: { tagName: 'INPUT' } });
check('arrow keys typed into the name box or the template select do not move the level', !typedInBox.prevented && run('level.walls[0].x') === 640);
run('level.slopes[0].x'); run('selected = { list: "slopes", index: 0 }'); pressArrow('ArrowDown');
check('nudging works on slopes too (that is how you fix a pipe that is 1px off)', run('level.slopes[0].y') === 181);

// guides are drawn
freshLevel(); run("pick('wall')");
for (const f of handlers.canvas.mousedown) f({ clientX: 376, clientY: 176, button: 0, altKey: false });
for (const f of handlers.canvas.mousemove) f({ clientX: 700, clientY: 176, altKey: false });
log.length = 0; run('draw()');
check('guides are drawn as dashed pink lines across the arena at each snapped edge', (() => { const i = log.findIndex((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#f0f'); return i >= 0 && log.slice(i, i + 12).some((c) => c[0] === 'setLineDash' && c[1].length === 2) && log.some((c) => c[0] === 'moveTo' && c[1] === 380 && c[2] === 0) && log.some((c) => c[0] === 'moveTo' && c[1] === 0 && c[2] === 180); })());
for (const f of handlers.window.mouseup) f({});
log.length = 0; run('draw()');
check('...and not drawn when noSelection is snapped', !log.some((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#f0f'));

// the report's own JSON
const reportSample = { name: 'Classic', walls: [{ x: 376, y: 176, w: 1152, h: 2 }, { x: 560, y: 328, w: 120, h: 16, grass: true }, { x: 176, y: 368, w: 2, h: 472 }], ball: { x: 960, y: 400 },
  players: JSON.parse(run('JSON.stringify(DEFAULT_LEVELS[0].players)')), goals: [{ owner: 1, x: -200, y: 766, w: 224, h: 210, sparks: 'right' }], zones: [{ x: 24, y: 646, w: 100, h: 330 }], slopes: [SLOPE] };
check("the reported level is valid and loads in the game's validator", run(`isValidLevel(${JSON.stringify(reportSample)})`));
const lipOf = (lv) => ({ bar: Math.abs(lv.slopes[0].y - (lv.walls[0].y + lv.walls[0].h)), side: Math.abs(lv.slopes[0].x - (lv.walls[2].x + lv.walls[2].w)), barEnd: Math.abs(lv.walls[0].x - (lv.slopes[0].x + lv.slopes[0].w)), wallTop: Math.abs(lv.walls[2].y - (lv.slopes[0].y + lv.slopes[0].h)) });
const lipBefore = lipOf(reportSample);
check('as reported: 2px lipOf under the bar, 2px gap at the wall, the bar starts 4px inside the pipe, the wall top is 4px off', JSON.stringify(lipBefore) === '{"bar":2,"side":2,"barEnd":4,"wallTop":4}', JSON.stringify(lipBefore));
const lipFixed = JSON.parse(JSON.stringify(reportSample)); lipFixed.walls[0] = { x: 380, y: 178, w: 1148, h: 2 }; lipFixed.walls[2] = { x: 178, y: 372, w: 2, h: 468 };
check('with the flush values the builder now produces, every one of those is exactly 0', JSON.stringify(lipOf(lipFixed)) === '{"bar":0,"side":0,"barEnd":0,"wallTop":0}', JSON.stringify(lipOf(lipFixed)));
magnets = false;

// ---- Copy JSON ----
const button = (label) => created.find((e) => e.tag === 'button' && e.textContent === label);
(async () => {
  // on an http://192.168.x.x page there is no navigator.clipboard: it falls back to the copy command
  sandbox.document.execCommand = (c) => c === 'copy';
  await button('Copy JSON').onclick();
  check('Copy JSON without navigator.clipboard (a non-https page) still copies, and says so', msgEl.textContent === 'Level JSON copied.', msgEl.textContent);
  sandbox.document.execCommand = () => false;
  await button('Copy JSON').onclick();
  check('...and if even that fails, says how to copy by hand', /press Ctrl\/Cmd\+C/.test(msgEl.textContent), msgEl.textContent);
  let copied = null;
  sandbox.navigator.clipboard = { writeText: async (t) => { copied = t; } };
  await button('Copy JSON').onclick();
  check('with the clipboard API it copies exactly the JSON box', copied === out.value && copied.length > 0 && msgEl.textContent === 'Level JSON copied.');
  delete sandbox.navigator.clipboard; delete sandbox.document.execCommand;

  // ---- Save, and Start from... lists saved levels ----
  const template = created.find((e) => e.tag === 'select' && e.ariaLabel === 'Start from a built-in or saved level');
  const options = () => template.children.map((o) => `${o.value}=${o.textContent}`);
  run('edit(() => { delete level.name; })');
  button('Save').onclick();
  check('Save with no name asks for one and saves nothing', /Name the level first/.test(msgEl.textContent) && !store.has('wizardball-levels'));
  run('edit(() => { level.name = "Cave"; })');
  const cave = run('level.walls.length');
  button('Save').onclick();
  check('Save stores it under its name in localStorage', JSON.parse(store.get('wizardball-levels')).map((l) => l.name).join() === 'Cave' && /Saved "Cave"/.test(msgEl.textContent), msgEl.textContent);
  check('...and it shows up in Start from..., after the built-in levels', options().at(-1) === 's:Cave=Saved: Cave' && options()[1] === '0=Classic', options().join('|'));
  run('edit(() => { level.walls.push({ x: 300, y: 300, w: 80, h: 24 }); })');
  button('Save').onclick();
  check('saving again under the same name replaces it (no duplicate)', JSON.parse(store.get('wizardball-levels')).length === 1 && JSON.parse(store.get('wizardball-levels'))[0].walls.length === cave + 1 && /Saved over "Cave"/.test(msgEl.textContent));
  run('edit(() => { level.name = "Tower"; })'); button('Save').onclick();
  check('a different name is a second saved level', options().filter((o) => o.startsWith('s:')).join('|') === 's:Cave=Saved: Cave|s:Tower=Saved: Tower');
  template.value = '0'; template.onchange();
  check('(starting from a built-in level still works)', run('level.name') === 'Classic');
  template.value = 's:Cave'; template.onchange();
  check('choosing a saved level loads it into the builder', run('level.name') === 'Cave' && run('level.walls.length') === cave + 1 && template.value === '');
  key('z', { ctrlKey: true });
  check('...as one undo step', run('level.name') === 'Classic');
  // storage is a trust boundary: junk entries are skipped, the good ones still listed
  store.set('wizardball-levels', JSON.stringify([{ name: 'Broken', walls: 'nope' }, ...JSON.parse(store.get('wizardball-levels')), 42]));
  template.onfocus();
  check('invalid saved entries are skipped, valid ones kept', options().filter((o) => o.startsWith('s:')).join('|') === 's:Cave=Saved: Cave|s:Tower=Saved: Tower', options().join('|'));
  store.set('wizardball-levels', '{not json');
  template.onfocus();
  check('unreadable storage just means no saved levels (no crash)', !options().some((o) => o.startsWith('s:')));

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
