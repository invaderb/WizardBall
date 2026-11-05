// Level builder: draw walls over the arena, export the same JSON shape the game loads.
// Reads DEFAULT_LEVEL from level.js. "Play" hands the level to index.html via localStorage.

const W = 1920,
	H = 1000,
	SNAP = 8, // positions, and sizes past the first step, snap to this grid
	MAGNET = 6, // px: within this distance of another object's edge, you snap onto it (hold Alt/Option to turn that off)
	THIN = 2; // the thinnest a wall can be: so it can line up with a ramp's edge. Then 8, 16, 24...
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const out = document.getElementById("json");

// Pre-made obstacles: lists of [x, y, w, h, grass?] relative to the click point.
const STAMPS = {
	platform: [[0, 0, 240, 24, true]], // 5th value: grass
	pillar: [[0, 0, 24, 160]],
	block: [[0, 0, 96, 96]],
	stairs: [0, 1, 2, 3].map((i) => [
		i * 48,
		144 - (i + 1) * 36,
		48,
		(i + 1) * 36,
	]),
	cup: [
		[0, 0, 24, 96],
		[168, 0, 24, 96],
		[24, 72, 144, 24],
	], // U-shaped ball trap
};

let level = structuredClone(DEFAULT_LEVEL);
const undo = [];
let tool = "wall"; // 'wall' | 'zone' | 'zonec' | 'goal0' | 'goal1' | 'goalc0' | 'goalc1' | 'erase' | 'move' | a STAMPS key
let nameInput = null; // the level-name box in the toolbar (kept in step with level.name by sync)
let drag = null; // {x0, y0, x1, y1} while drawing
let mouse = { x: 0, y: 0 };
let guides = { x: [], y: [] }; // the edge lines the current drag has snapped to (drawn as dashed guides)
let held = null; // Move tool: {obj, dx, dy, moved} while dragging a spawn/goal/zone
let selected = null; // { list: 'walls'|'slopes'|'goals'|'zones', index }: what Duplicate / Flip / Mirror / Delete / Copy act on
let clip = null; // Copy/Paste: { list, obj }

// Drag-to-draw tools: what to add to the level when a dragged rect is released.
// Goals are one tool per player, because the goal's owner is the player who scores there.
// `high` = which end of a ramp is tall; it comes from the drag direction (drag toward the tall end).
// Whatever you draw ends up selected, so you can move, resize, duplicate or flip it right away.
function add(list, obj) {
	level[list].push(obj);
	selected = { list, index: level[list].length - 1 };
}
const DRAW = {
	wall: (r) =>
		add("walls", { ...r, ...(r.w >= 2 * r.h ? { grass: true } : {}) }), // wide walls are floors/platforms: they get grass (G toggles it)
	zone: (r) => add("zones", r),
	ramp: (r, high) => add("slopes", { ...r, high }),
	pipe: (r, high) => add("slopes", { ...r, high, curve: true }), // quarter-pipe: curved surface
};
level.players.forEach((_, i) => {
	DRAW[`goal${i}`] = (r) => add("goals", { owner: i, ...r });
});
// Circular versions: the drag makes a SQUARE (the circle is inscribed in it). Resizing keeps it square.
const CIRCLE_TOOLS = new Set(["zonec"]);
DRAW.zonec = (r) => add("zones", { ...r, shape: "circle" });
level.players.forEach((_, i) => {
	DRAW[`goalc${i}`] = (r) => add("goals", { owner: i, ...r, shape: "circle" });
	CIRCLE_TOOLS.add(`goalc${i}`);
});

const snap = (v) => Math.round(v / SNAP) * SNAP;
// Canvas is CSS-scaled, so convert mouse pixels to 1920x1000 world coords.
function world(e) {
	const r = canvas.getBoundingClientRect();
	const rx = ((e.clientX - r.left) * W) / r.width,
		ry = ((e.clientY - r.top) * H) / r.height;
	return { x: snap(rx), y: snap(ry), rx, ry }; // x, y: on the grid. rx, ry: exactly where the cursor is
}

// ---------- Snapping to other objects' edges ----------
// A 2px wall can't be flush against a quarter-pipe if everything only snaps to an 8px grid: the pipe's edge
// is wherever it was put (or rotated to). So positions also snap to the edges of walls, slopes, goals and zones
// (and the arena's own edges), whichever is within MAGNET px.
function edgeLines(skip) {
	const xs = new Set([0, W]),
		ys = new Set([0, H]);
	for (const list of ["walls", "slopes", "goals", "zones"])
		for (const r of level[list]) {
			if (r === skip) continue; // not the thing being moved/resized itself
			xs.add(r.x);
			xs.add(r.x + r.w);
			ys.add(r.y);
			ys.add(r.y + r.h);
		}
	return { xs: [...xs], ys: [...ys] };
}

// For drawing and resizing: put the cursor on the nearest edge line if one is close, else on the grid.
// `snappedX/Y` say whether it landed on an edge (a hairline wall uses that to sit flush against it).
function magnetize(p, skip) {
	const { xs, ys } = edgeLines(skip);
	const nearest = (v, lines) => lines.reduce((best, c) => (Math.abs(c - v) < Math.abs(best - v) ? c : best), Infinity);
	const cx = nearest(p.rx, xs),
		cy = nearest(p.ry, ys);
	const out = { ...p, snappedX: Math.abs(cx - p.rx) <= MAGNET, snappedY: Math.abs(cy - p.ry) <= MAGNET };
	guides = { x: [], y: [] };
	if (out.snappedX) { out.x = cx; guides.x.push(cx); }
	if (out.snappedY) { out.y = cy; guides.y.push(cy); }
	return out;
}

// For moving a wall/slope/goal/zone: shift it by the smallest amount that lines either of its edges up with another
// object's edge, if that is within MAGNET. (Either edge: a 2px wall can sit on either side of the line.)
function alignMoved(obj) {
	const { xs, ys } = edgeLines(obj);
	const best = (lo, hi, lines) => {
		let found = null;
		for (const line of lines)
			for (const edge of [lo, hi]) {
				const delta = line - edge;
				if (Math.abs(delta) <= MAGNET && (!found || Math.abs(delta) < Math.abs(found.delta))) found = { delta, line };
			}
		return found;
	};
	guides = { x: [], y: [] };
	const fx = best(obj.x, obj.x + obj.w, xs),
		fy = best(obj.y, obj.y + obj.h, ys);
	if (fx) { obj.x += fx.delta; guides.x.push(fx.line); }
	if (fy) { obj.y += fy.delta; guides.y.push(fy.line); }
}

// One-line-per-rect JSON so a level stays readable (plain stringify would be 6 lines per rect).
const oneLine = (arr) =>
	arr.length
		? `[\n${arr.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]`
		: "[]";
const fmt = (l) =>
	JSON.stringify(
		{
			name: l.name,
			...l,
			walls: "@walls",
			goals: "@goals",
			zones: "@zones",
			slopes: "@slopes",
		},
		null,
		2,
	)
		.replace('"@slopes"', () => oneLine(l.slopes))
		.replace('"@walls"', () => oneLine(l.walls))
		.replace('"@goals"', () => oneLine(l.goals))
		.replace('"@zones"', () => oneLine(l.zones));
const sync = () => {
	out.value = fmt(level);
	if (nameInput) nameInput.value = level.name ?? "";
};

// Every edit goes through here so undo always has a snapshot.
function edit(fn) {
	undo.push(JSON.stringify(level));
	selected = null; // list indexes can shift, so an edit that wants a selection sets it again
	fn();
	sync();
}

function undoLast() {
	if (!undo.length) return;
	level = JSON.parse(undo.pop());
	selected = null;
	sync();
}

// ---------- Selection actions ----------
const msgEl = document.getElementById("msg");
let msgTimer = null;
function msg(text) {
	msgEl.textContent = text;
	clearTimeout(msgTimer);
	msgTimer = setTimeout(() => {
		msgEl.textContent = "";
	}, 3500);
}

const current = () => selected && level[selected.list]?.[selected.index];

// Run fn on the selected object as ONE undoable edit; the selection survives unless fn changes it.
function editSelected(fn) {
	const sel = selected;
	if (!current())
		return msg(
			"Nothing selected. Use the Move tool (M) and click a wall, ramp, goal or zone.",
		);
	edit(() => {
		selected = sel;
		fn(level[sel.list][sel.index], sel);
	});
}

function duplicate() {
	editSelected((o, sel) => {
		level[sel.list].push({ ...o, x: o.x + 24, y: o.y + 24 }); // offset so you can see it; drag it where you want it
		selected = { list: sel.list, index: level[sel.list].length - 1 };
	});
}

const turn = (o) => {
	o.high = o.high === "right" ? "left" : "right";
};

// Flip: turn a ramp around in place.
function flip() {
	if (selected?.list !== "slopes")
		return msg(
			current()
				? "Flip turns ramps around. Use Mirror (Shift+F) to send something to the other side."
				: "Select a ramp first (Move tool, click it).",
		);
	editSelected(turn);
}

// Mirror: move across the arena's center line (ramps also turn to face the other way). With Duplicate,
// that gives you a symmetric level quickly. A goal keeps its owner: change it in the JSON if you want.
function mirror() {
	editSelected((o, sel) => {
		o.x = W - o.x - o.w;
		if (sel.list === "slopes") turn(o);
	});
}

// The four corners a ramp's right angle can sit in, in clockwise order. Rotating a ramp or quarter-pipe moves
// it one step along this list (bottom-right -> bottom-left -> top-left -> top-right) and swaps width and height.
const CORNERS = [
	{ ceiling: false, high: "right" },
	{ ceiling: false, high: "left" },
	{ ceiling: true, high: "left" },
	{ ceiling: true, high: "right" },
];

// R: rotate the selection 90 degrees clockwise about its center. For ramps / quarter-pipes that turns a floor piece into
// a wall-hugging one and then a ceiling piece. Anything else just swaps its width and height.
function rotate() {
	editSelected((o, sel) => {
		const cx = o.x + o.w / 2,
			cy = o.y + o.h / 2;
		[o.w, o.h] = [o.h, o.w];
		o.x = Math.round(cx - o.w / 2);
		o.y = Math.round(cy - o.h / 2);
		if (sel.list !== "slopes") return;
		const k = CORNERS.findIndex(
			(c) => c.ceiling === Boolean(o.ceiling) && c.high === o.high,
		);
		const next = CORNERS[(k + 1) % 4];
		o.high = next.high;
		if (next.ceiling) o.ceiling = true;
		else delete o.ceiling;
	});
}

// G: grass on/off for the selected wall.
function toggleGrass() {
	if (selected?.list !== "walls")
		return msg(
			current()
				? "Grass only grows on walls."
				: "Select a wall first (Move tool, click it).",
		);
	editSelected((o) => {
		if (o.grass) delete o.grass;
		else o.grass = true;
	});
}

// S: cycle which edge of the selected goal sheds sparks: off -> left -> right -> top -> bottom -> off.
const SPARK_ORDER = [undefined, "left", "right", "top", "bottom"];
function cycleSparks() {
	if (selected?.list !== "goals")
		return msg(
			current()
				? "Sparks belong to goals."
				: "Select a goal first (Move tool, click it).",
		);
	editSelected((o) => {
		const next =
			SPARK_ORDER[(SPARK_ORDER.indexOf(o.sparks) + 1) % SPARK_ORDER.length];
		if (next) o.sparks = next;
		else delete o.sparks;
	});
	msg(`Goal sparks: ${current()?.sparks ?? "off"}`);
}

function deleteSelected() {
	editSelected((o, sel) => {
		level[sel.list].splice(sel.index, 1);
		selected = null;
	});
}

function copy() {
	const o = current();
	if (!o) return false; // nothing of ours selected: let the browser's own copy happen
	clip = { list: selected.list, obj: { ...o } };
	msg("Copied. Ctrl+V pastes at the cursor.");
}

function paste() {
	if (!clip) return false;
	edit(() => {
		level[clip.list].push({ ...clip.obj, x: mouse.x, y: mouse.y }); // top-left lands on the cursor
		selected = { list: clip.list, index: level[clip.list].length - 1 };
	});
}

const inRect = (p, r) =>
	p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// A slope only counts as hit below its surface, not in the empty corner of its bounding box.
const inSlope = (p, s) => inRect(p, s) && p.y >= slopeY(s, p.x);
// A box, or for circle goals/zones the circle inside it (so the empty corners don't count).
const inObj = (p, r) => inShape(p.x, p.y, r);
// Walls can be hairlines (2px), so give them a few pixels of slack: otherwise they could not be erased.
const inWall = (p, r) => inRect(p, { x: r.x - 3, y: r.y - 3, w: r.w + 6, h: r.h + 6 });

// Walls first, then slopes, goals, zones (same priority as the Move tool); newest on top within each.
function eraseAt(p) {
	for (const [list, hit] of [
		[level.walls, inWall],
		[level.slopes, inSlope],
		[level.goals, inObj],
		[level.zones, inObj],
	]) {
		const i = list.findLastIndex((r) => hit(p, r));
		if (i >= 0) return edit(() => list.splice(i, 1));
	}
}

// ---------- Move / resize ----------
// Everything movable is an object with x/y, so one grab handles all of them.
// (Ball x/y is its center; spawns, goals, zones and walls are top-left. The offset keeps it from jumping.)
// Rects (walls, goals, zones) also resize: near an edge or corner you grab that side instead of the whole thing.
const GRAB_MIN = 5; // px: even the thinnest wall can be grabbed within this distance
const EDGE = 14; // px of grab zone around each edge (shrinks on thin rects so they stay movable)

// Circles: the middle moves it; a band around the rim resizes it, from the side (or corner) the cursor is nearest.
function hitCircle(p, r) {
	const a = r.w / 2,
		b = r.h / 2;
	const nx = (p.x - r.x - a) / a,
		ny = (p.y - r.y - b) / b; // 1 = exactly on the rim
	const d = Math.hypot(nx, ny);
	const band = Math.min(0.4, EDGE / Math.min(a, b)); // grab band around the rim, as a fraction of the radius
	if (d > 1 + band) return null;
	if (d < 1 - band) return { l: false, rt: false, t: false, b: false }; // inside: a plain move
	const k = 0.38; // ~22 degrees: which of the 8 compass directions the cursor is in
	return { l: nx < -k, rt: nx > k, t: ny < -k, b: ny > k };
}

// Which sides of rect r is point p on? null = nowhere near it.
function hitRect(p, r) {
	if (r.shape === "circle") return hitCircle(p, r);
	// A grab zone of at least GRAB_MIN around everything, so a 2px wall can still be clicked.
	const ex = Math.max(Math.min(EDGE, r.w / 3), GRAB_MIN),
		ey = Math.max(Math.min(EDGE, r.h / 3), GRAB_MIN);
	if (
		!inRect(p, { x: r.x - ex, y: r.y - ey, w: r.w + 2 * ex, h: r.h + 2 * ey })
	)
		return null;
	const sides = {
		l: Math.abs(p.x - r.x) <= ex,
		rt: Math.abs(p.x - r.x - r.w) <= ex,
		t: Math.abs(p.y - r.y) <= ey,
		b: Math.abs(p.y - r.y - r.h) <= ey,
	};
	// So thin that both opposite edges are within reach: there is no one edge to grab, so it is a plain move.
	if (sides.l && sides.rt) sides.l = sides.rt = false;
	if (sides.t && sides.b) sides.t = sides.b = false;
	return sides;
}

// Topmost thing under p: small stuff first (ball, spawns), then walls, goals, zones.
// Returns { obj, resize } where resize is the sides being grabbed, or null for a plain move.
function hitTest(p) {
	if (Math.hypot(p.x - level.ball.x, p.y - level.ball.y) <= 22)
		return { obj: level.ball, resize: null };
	for (const pl of level.players)
		if (inRect(p, { x: pl.x, y: pl.y, w: 32, h: 48 }))
			return { obj: pl, resize: null };
	for (const pl of level.players) // health bars: 24 wide, 3 segments = 200 tall (matches the game's HUD)
		if (inRect(p, { x: pl.hud.x, y: pl.hud.y, w: 24, h: 200 }))
			return { obj: pl.hud, resize: null };
	// Slopes move/resize by their bounding box (their x/y/w/h), like any other rect. Newest on top.
	for (const list of ["walls", "slopes", "goals", "zones"])
		for (let index = level[list].length - 1; index >= 0; index--) {
			const r = level[list][index];
			const s = hitRect(p, r);
			if (s)
				return {
					obj: r,
					resize: s.l || s.rt || s.t || s.b ? s : null,
					list,
					index,
				};
		}
	return null;
}

function cursorFor(t, grabbing) {
	if (!t) return "default";
	const s = t.resize;
	if (!s) return grabbing ? "grabbing" : "grab";
	if ((s.l && s.t) || (s.rt && s.b)) return "nwse-resize";
	if ((s.rt && s.t) || (s.l && s.b)) return "nesw-resize";
	return s.l || s.rt ? "ew-resize" : "ns-resize";
}

function grab(p) {
	// Hit-test at the cursor's exact position: on the grid, a 24px wall's middle can never be hit (both nearby
	// grid rows are within its edge zone), so it could be resized but never moved.
	const t = hitTest({ x: p.rx ?? p.x, y: p.ry ?? p.y });
	selected = t?.list ? { list: t.list, index: t.index } : null; // click empty space = deselect
	if (!t) return;
	undo.push(JSON.stringify(level)); // snapshot now; dropped on mouseup if nothing actually changed
	held = {
		obj: t.obj,
		resize: t.resize,
		list: t.list, // which list it came from (walls can get thinner than anything else)
		orig: { ...t.obj },
		dx: p.x - t.obj.x,
		dy: p.y - t.obj.y,
		moved: false,
	};
}

// Apply the current drag to the held object: resize from its original rect, or move it.
function dragHeld() {
	const o = held.orig,
		r = held.resize,
		before = JSON.stringify(held.obj);
	if (r) {
		let x0 = o.x,
			x1 = o.x + o.w,
			y0 = o.y,
			y1 = o.y + o.h;
		const min = held.list === "walls" ? THIN : SNAP; // the smallest it can get, so it can't flip or vanish
		if (r.l) x0 = Math.min(mouse.x, x1 - min);
		if (r.rt) x1 = Math.max(mouse.x, x0 + min);
		if (r.t) y0 = Math.min(mouse.y, y1 - min);
		if (r.b) y1 = Math.max(mouse.y, y0 + min);
		if (held.obj.shape === "circle") {
			// a circle stays a circle: it grows/shrinks from the opposite side or corner
			const sideways = (r.l || r.rt) && !(r.t || r.b),
				vertical = (r.t || r.b) && !(r.l || r.rt);
			const size = sideways
				? x1 - x0
				: vertical
					? y1 - y0
					: Math.max(x1 - x0, y1 - y0); // a side follows the side you drag (a corner, the larger)
			if (r.l) x0 = x1 - size;
			else x1 = x0 + size;
			if (r.t) y0 = y1 - size;
			else y1 = y0 + size;
		}
		Object.assign(held.obj, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
	} else {
		Object.assign(held.obj, { x: (mouse.gx ?? mouse.x) - held.dx, y: (mouse.gy ?? mouse.y) - held.dy });
		if (held.list && !mouse.alt) alignMoved(held.obj);
	}
	if (JSON.stringify(held.obj) !== before) {
		held.moved = true;
		sync();
	}
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => {
	const raw = world(e);
	const p = DRAW[tool] && !e.altKey ? magnetize(raw) : raw; // drawing starts on a nearby edge if there is one
	if (e.button === 2 || tool === "erase") eraseAt(p);
	else if (tool === "move") grab(p);
	else if (DRAW[tool])
		drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, rx0: raw.rx, ry0: raw.ry, snapX: Boolean(p.snappedX), snapY: Boolean(p.snappedY), gx0: p.snappedX ? p.x : null, gy0: p.snappedY ? p.y : null };
	else
		edit(() => {
			for (const [x, y, w, h, grass] of STAMPS[tool])
				level.walls.push({
					x: p.x + x,
					y: p.y + y,
					w,
					h,
					...(grass ? { grass: true } : {}),
				});
		});
});
canvas.addEventListener("mousemove", (e) => {
	const raw = world(e);
	// Drawing and resizing snap the cursor onto nearby edges (Alt turns that off); moving aligns the object's own edges instead.
	mouse = !e.altKey && (drag || held?.resize) ? magnetize(raw, held?.obj) : { ...raw };
	mouse.gx = raw.x; // the plain grid position, used for moving
	mouse.gy = raw.y;
	mouse.alt = Boolean(e.altKey);
	if (!drag && !held) guides = { x: [], y: [] };
	if (drag) { // keep showing where the START of the drag snapped, along with the end
		if (drag.gx0 !== null && !guides.x.includes(drag.gx0)) guides.x.push(drag.gx0);
		if (drag.gy0 !== null && !guides.y.includes(drag.gy0)) guides.y.push(drag.gy0);
	}
	if (drag) {
		drag.x1 = mouse.x;
		drag.y1 = mouse.y;
	}
	if (held) dragHeld();
	if (tool === "move")
		canvas.style.cursor = cursorFor(held ?? hitTest({ x: mouse.rx ?? mouse.x, y: mouse.ry ?? mouse.y }), !!held);
});
addEventListener("mouseup", () => {
	guides = { x: [], y: [] };
	if (held) {
		if (!held.moved) undo.pop(); // a click without a drag shouldn't leave an empty undo step
		held = null;
		return;
	}
	if (!drag) return;
	const r = drawnRect();
	const high = drag.x1 >= drag.x0 ? "right" : "left";
	drag = null;
	if (r.w > 0 && r.h > 0) edit(() => DRAW[tool](r, high));
});
addEventListener("keydown", (e) => {
	if (e.target === out || ["INPUT", "SELECT", "TEXTAREA"].includes(e.target?.tagName)) return; // typing in a box
	const key = e.key.toLowerCase();
	if (e.ctrlKey || e.metaKey) {
		const action = { z: undoLast, d: duplicate, c: copy, v: paste }[key];
		if (action && action() !== false) e.preventDefault(); // `false` = nothing to do, so leave the browser's own shortcut alone
		return;
	}
	const nudges = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
	if (nudges[key]) {
		// Arrow keys nudge the selection 1px (8px with Shift): for lining things up exactly.
		if (!current()) return;
		e.preventDefault();
		const step = e.shiftKey ? SNAP : 1;
		editSelected((o) => {
			o.x += nudges[key][0] * step;
			o.y += nudges[key][1] * step;
		});
		return;
	}
	if (key === "m") pick("move");
	else if (key === "w") pick("wall");
	else if (key === "e") pick("erase");
	else if (key === "r") rotate();
	else if (key === "g") toggleGrass();
	else if (key === "s") cycleSparks();
	else if (key === "f") (e.shiftKey ? mirror : flip)();
	else if (key === "delete" || key === "backspace") {
		e.preventDefault();
		deleteSelected();
	} else if (key === "escape") selected = null;
});

// Dragging in any direction gives a normalized rect (positive w/h).
// For circle tools: a square that starts where you pressed and extends the way you dragged.
function squareFromDrag(d) {
	const size = Math.max(Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
	return {
		x: d.x1 >= d.x0 ? d.x0 : d.x0 - size,
		y: d.y1 >= d.y0 ? d.y0 : d.y0 - size,
		w: size,
		h: size,
	};
}

// The rect the current drag will create. With the Wall tool, a straight drag (no width or no height) makes a
// hairline wall THIN thick, so you can line a wall up with a ramp; any other size grows in SNAP steps.
function drawnRect() {
	if (CIRCLE_TOOLS.has(tool)) return squareFromDrag(drag);
	const r = dragRect();
	if (tool === "wall") {
		// A straight drag is a hairline. If it snapped onto another object's edge, it sits flush against that
		// edge on the side the cursor was: above/left of the line, or below/right of it.
		if (r.w === 0 && r.h > 0) {
			r.w = THIN;
			if (drag.snapX && drag.rx0 < drag.x0) r.x -= THIN;
		}
		if (r.h === 0 && r.w > 0) {
			r.h = THIN;
			if (drag.snapY && drag.ry0 < drag.y0) r.y -= THIN;
		}
	}
	return r;
}

const dragRect = () => ({
	x: Math.min(drag.x0, drag.x1),
	y: Math.min(drag.y0, drag.y1),
	w: Math.abs(drag.x1 - drag.x0),
	h: Math.abs(drag.y1 - drag.y0),
});

// ---------- Toolbar ----------
const bar = document.getElementById("bar");
const toolButtons = {};
function addButton(label, onClick, toolName, location) {
	const b = document.createElement("button");
	b.textContent = label;
	b.onclick = onClick;
	location.append(b);
	if (toolName) toolButtons[toolName] = b;
	return b;
}
const gap = () => {
	const g = document.createElement("span");
	g.className = "gap";
	bar.append(g);
};
function pick(name) {
	tool = name;
	canvas.style.cursor = name === "move" ? "default" : "crosshair";
	for (const k in toolButtons)
		toolButtons[k].classList.toggle("on", k === name);
}
addButton("Wall (W)", () => pick("wall"), "wall", bar);
addButton("Erase (E)", () => pick("erase"), "erase", bar);
addButton("Move (M)", () => pick("move"), "move", bar);
gap();
addButton("Ramp", () => pick("ramp"), "ramp", bar);
addButton("Quarter-pipe", () => pick("pipe"), "pipe", bar);
addButton("Slow-mo zone", () => pick("zone"), "zone", bar).style.color = "#aaa";
addButton("Slow-mo circle", () => pick("zonec"), "zonec", bar).style.color = "#aaa";
level.players.forEach((p, i) => {
	addButton(`Goal P${i + 1}`, () => pick(`goal${i}`), `goal${i}`, bar).style.color =
		p.color; // P1 scores here
	addButton(
		`Goal P${i + 1} circle`,
		() => pick(`goalc${i}`),
		`goalc${i}`,
    bar
	).style.color = p.color;
});
gap();
for (const name of Object.keys(STAMPS)) addButton(name, () => pick(name), name, bar);
gap();
addButton("Duplicate (Ctrl+D)", duplicate, null, bar);
addButton("Flip (F)", flip, null, bar);
addButton("Rotate (R)", rotate, null, bar);
addButton("Mirror (Shift+F)", mirror, null, bar);
addButton("Delete (Del)", deleteSelected, null, bar);
addButton("Grass (G)", toggleGrass, null, bar);
addButton("Goal sparks (S)", cycleSparks, null, bar);
gap();
addButton("Undo (Ctrl+Z)", undoLast, null, bar);
gap();
addButton(
	"Play",
	() => {
		localStorage.setItem("wizardball-level", JSON.stringify(level));
		window.open("index.html?level=custom"); // the game's level select starts on "Your level (from the builder)"
	},
	null,
	bar,
);
addButton(
	"Reset to default",
	() => {
		localStorage.removeItem("wizardball-level");
		edit(() => {
			level = structuredClone(DEFAULT_LEVEL);
		});
	},
	null,
	bar,
);
gap();
// JSON Buttons

const jsonActions = document.getElementById("json-actions");
addButton(
	"Copy JSON",
	() => {
		out.select();
		navigator.clipboard?.writeText(out.value);
	},
	null,
	jsonActions,
);
addButton(
	"Load JSON",
	() => {
		try {
			const l = JSON.parse(out.value);
			if (!isValidLevel(l))
				throw new Error(
					"needs walls, goals, zones (numeric x/y/w/h), players, ball; goal owner must be a player index",
				);
			edit(() => {
				l.slopes ??= [];
				level = l;
			}); // slopes are optional in older levels
		} catch (err) {
			alert(`Invalid level: ${err.message}`);
		}
	},
	null,
	jsonActions,
);

// Start from one of the built-in levels instead of from scratch.
const template = document.createElement("select");
template.ariaLabel = "Start from a built-in level";
for (const [i, label] of [
	"Start from...",
	...DEFAULT_LEVELS.map((l, k) => levelName(l, k)),
].entries()) {
	const option = document.createElement("option");
	option.value = i === 0 ? "" : String(i - 1);
	option.textContent = label;
	template.append(option);
}
template.onchange = () => {
	if (template.value === "") return;
	edit(() => {
		level = structuredClone(DEFAULT_LEVELS[Number(template.value)]);
		level.slopes ??= []; // (older levels have none)
	});
	template.value = "";
};
bar.append(template);
// The name shown in the game's level select and in lobbies.
nameInput = document.createElement("input");
nameInput.placeholder = "Level name";
nameInput.maxLength = 40;
nameInput.ariaLabel = "Level name";
nameInput.onchange = () =>
	edit(() => {
		const name = nameInput.value.trim();
		if (name) level.name = name;
		else delete level.name;
	});
bar.append(nameInput);
pick("wall");
sync();

// ---------- Drawing ----------
function strokeRects(rects, color, dash = []) {
	ctx.strokeStyle = color;
	ctx.setLineDash(dash);
	for (const r of rects) ctx.strokeRect(r.x, r.y, r.w, r.h);
	ctx.setLineDash([]);
}

// A box, or with shape: 'circle' the ellipse inscribed in it (a circle when the box is square).
function pathShape(r) {
	ctx.beginPath();
	if (r.shape === "circle")
		ctx.ellipse(
			r.x + r.w / 2,
			r.y + r.h / 2,
			r.w / 2,
			r.h / 2,
			0,
			0,
			Math.PI * 2,
		);
	else ctx.rect(r.x, r.y, r.w, r.h);
}

function strokeShapes(list, color, dash = []) {
	ctx.strokeStyle = color;
	ctx.setLineDash(dash);
	for (const r of list) {
		pathShape(r);
		ctx.stroke();
	}
	ctx.setLineDash([]);
}

// Walls have small rounded corners in the game (the hitbox stays square), so draw them that way here too.
function strokeWalls() {
	ctx.strokeStyle = "#fff";
	for (const w of level.walls) {
		ctx.beginPath();
		ctx.roundRect(w.x, w.y, w.w, w.h, Math.min(WALL_RADIUS, w.w / 2, w.h / 2));
		ctx.stroke();
	}
}

function strokePoly(pts, color) {
	ctx.strokeStyle = color;
	ctx.beginPath();
	ctx.moveTo(pts[0].x, pts[0].y);
	for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
	ctx.closePath();
	ctx.stroke();
}

function drawGrass() {
	// the same blades the game grows (seeded by the wall's index)
	ctx.strokeStyle = "#fff";
	ctx.lineWidth = 2;
	ctx.beginPath();
	level.walls.forEach((w, i) => {
		if (!w.grass) return;
		for (const b of grassBlades(w.w, i)) {
			ctx.moveTo(w.x + b.x, w.y);
			ctx.lineTo(w.x + b.x + b.lean, w.y - b.h);
		}
	});
	ctx.stroke();
	ctx.lineWidth = 3;
}

function draw() {
	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, W, H);
	ctx.lineWidth = 2;
	ctx.strokeStyle = "#1c1c1c";
	for (let x = 0; x <= W; x += 96) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, H);
		ctx.stroke();
	}
	for (let y = 0; y <= H; y += 96) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(W, y);
		ctx.stroke();
	}

	ctx.lineWidth = 3;
	strokeWalls();
	drawGrass();
	for (const s of level.slopes) strokePoly(slopePoints(s), "#fff"); // same outline the game collides with
	for (const g of level.goals) {
		// goal: tinted in its scorer's color, like in the game
		const color = level.players[g.owner].color;
		ctx.globalAlpha = 0.2;
		ctx.fillStyle = color;
		pathShape(g);
		ctx.fill();
		ctx.globalAlpha = 1;
		strokeShapes([g], color);
		if (g.sparks && g.shape === "circle") {
			// the arc of the rim that sheds sparks
			const [dx, dy] = {
				left: [-1, 0],
				right: [1, 0],
				top: [0, -1],
				bottom: [0, 1],
			}[g.sparks];
			const mid = Math.atan2(dy, dx);
			ctx.strokeStyle = "#fff";
			ctx.lineWidth = 6;
			ctx.setLineDash([4, 10]);
			ctx.beginPath();
			ctx.ellipse(
				g.x + g.w / 2,
				g.y + g.h / 2,
				g.w / 2,
				g.h / 2,
				0,
				mid - 0.7,
				mid + 0.7,
			);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.lineWidth = 3;
		} else if (g.sparks) {
			// the edge that sheds sparks: bright dashes
			const [from, to] = {
				left: [
					[g.x, g.y],
					[g.x, g.y + g.h],
				],
				right: [
					[g.x + g.w, g.y],
					[g.x + g.w, g.y + g.h],
				],
				top: [
					[g.x, g.y],
					[g.x + g.w, g.y],
				],
				bottom: [
					[g.x, g.y + g.h],
					[g.x + g.w, g.y + g.h],
				],
			}[g.sparks];
			ctx.strokeStyle = "#fff";
			ctx.lineWidth = 6;
			ctx.setLineDash([4, 10]);
			ctx.beginPath();
			ctx.moveTo(...from);
			ctx.lineTo(...to);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.lineWidth = 3;
		}
	}
	strokeShapes(level.zones, "#888", [8, 8]); // slow-mo zones: grey, dashed (circles too)
	for (const p of level.players) {
		// health bars: 3 bevelled segments, filled like the game's
		for (let i = 0; i < 3; i++) {
			strokePoly(hudSegment(p.hud.x, p.hud.y + i * 70), p.color);
			ctx.globalAlpha = 0.35;
			ctx.fillStyle = p.color;
			ctx.fill(); // the path strokePoly just drew is still current
			ctx.globalAlpha = 1;
		}
	}
	for (const p of level.players) {
		// spawn point: the wizard itself, facing the middle like it does in the game
		ctx.save();
		ctx.translate(p.x + 16, p.y + 24); // sprites are drawn around the center of their 32 x 48 hitbox
		drawWizard(ctx, p.color, {
			facing: p.x < W / 2 ? 1 : -1,
			phase: 0,
			moving: false,
			air: false,
			vy: 0,
		});
		ctx.restore();
	}
	ctx.beginPath();
	ctx.arc(level.ball.x, level.ball.y, 22, 0, Math.PI * 2);
	ctx.fillStyle = "#000"; // solid black, like in the game
	ctx.fill();
	ctx.strokeStyle = "#fff";
	ctx.stroke();

	const sel = current();
	if (sel) {
		// selected: cyan outline + the 8 points where a resize grabs
		ctx.lineWidth = 5;
		if (selected.list === "slopes") strokePoly(slopePoints(sel), "#0ff");
		else strokeShapes([sel], "#0ff");
		ctx.lineWidth = 3;
		ctx.fillStyle = "#0ff";
		for (const hx of [sel.x, sel.x + sel.w / 2, sel.x + sel.w])
			for (const hy of [sel.y, sel.y + sel.h / 2, sel.y + sel.h])
				if (hx !== sel.x + sel.w / 2 || hy !== sel.y + sel.h / 2)
					ctx.fillRect(hx - 6, hy - 6, 12, 12);
	}

	if (drag) {
		// in-progress shape, with its size
		const r = drawnRect();
		if (tool === "ramp" || tool === "pipe")
			// live preview shows which end is tall
			strokePoly(
				slopePoints({
					...r,
					high: drag.x1 >= drag.x0 ? "right" : "left",
					curve: tool === "pipe",
				}),
				"#ff0",
			);
		else if (CIRCLE_TOOLS.has(tool))
			strokeShapes([{ ...r, shape: "circle" }], "#ff0");
		else strokeRects([r], "#ff0");
		ctx.fillStyle = "#ff0";
		ctx.font = "20px monospace";
		ctx.fillText(`${r.w} x ${r.h}`, r.x, r.y - 6);
	} else if (STAMPS[tool]) {
		// ghost of the stamp under the cursor
		ctx.globalAlpha = 0.5;
		strokeRects(
			STAMPS[tool].map(([x, y, w, h]) => ({
				x: mouse.x + x,
				y: mouse.y + y,
				w,
				h,
			})),
			"#ff0",
		);
		ctx.globalAlpha = 1;
	}
	if (guides.x.length || guides.y.length) {
		// Dashed guides across the whole arena for each edge the drag has snapped to.
		ctx.strokeStyle = "#f0f";
		ctx.lineWidth = 1;
		ctx.setLineDash([6, 6]);
		ctx.beginPath();
		for (const x of guides.x) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
		for (const y of guides.y) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.lineWidth = 3;
	}
	requestAnimationFrame(draw);
}
draw();
