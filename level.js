const DEFAULT_LEVELS = [
	{
		name: "Classic",
		walls: [
			{ x: -56, y: 734, w: 152, h: 2 },
			{ x: 1826, y: 734, w: 176, h: 2 },
			{ x: 1826, y: 430, w: 192, h: 2 },
			{ x: -98, y: 432, w: 192, h: 2 },
			{ x: 208, y: 22, w: 1512, h: 2 },
			{ x: 264, y: 960, w: 1384, h: 2, grass: true },
			{ x: 94, y: 184, w: 2, h: 248 },
			{ x: 1822, y: 184, w: 2, h: 248 },
			{ x: 1824, y: 736, w: 2, h: 80 },
			{ x: 96, y: 734, w: 2, h: 90 },
		],
		ball: {
			x: 960,
			y: 400,
		},
		players: [
			{
				color: "#48f",
				x: 332,
				y: 912,
				hud: {
					x: 32,
					y: 164,
				},
				keys: {
					left: "KeyA",
					right: "KeyD",
					jump: "Space",
				},
			},
			{
				color: "#f44",
				x: 1548,
				y: 912,
				hud: {
					x: 1864,
					y: 164,
				},
				keys: {
					left: "ArrowLeft",
					right: "ArrowRight",
					jump: "Enter",
				},
			},
		],
		goals: [
			{ owner: 0, x: 1888, y: 432, w: 48, h: 304, sparks: "left" },
			{ owner: 1, x: -24, y: 432, w: 54, h: 304, sparks: "right" },
		],
		zones: [
			{ x: 1608, y: 392, w: 376, h: 376, shape: "circle" },
			{ x: -64, y: 400, w: 376, h: 376, shape: "circle" },
		],
		slopes: [
			{ x: 96, y: 768, w: 176, h: 192, high: "left", curve: true },
			{ x: 1632, y: 784, w: 192, h: 176, high: "right", curve: true },
			{ x: 1648, y: 24, w: 176, h: 192, high: "right", curve: true, ceiling: true },
			{ x: 96, y: 24, w: 192, h: 176, high: "left", curve: true, ceiling: true },
		],
	},
	{
		name: "Rise and Shine",
		walls: [
			{ x: 104, y: 32, w: 1718, h: 2 },
			{ x: 92, y: 34, w: 2, h: 926 },
			{ x: 1822, y: 48, w: 2, h: 922 },
			{ x: 256, y: 968, w: 1408, h: 2, grass: true },
		],
		ball: {
			x: 960,
			y: 376,
		},
		players: [
			{
				color: "#48f",
				x: 356,
				y: 904,
				hud: {
					x: 40,
					y: 60,
				},
				keys: {
					left: "KeyA",
					right: "KeyD",
					jump: "Space",
				},
			},
			{
				color: "#f44",
				x: 1524,
				y: 912,
				hud: {
					x: 1856,
					y: 60,
				},
				keys: {
					left: "ArrowLeft",
					right: "ArrowRight",
					jump: "Enter",
				},
			},
		],
		goals: [
			{ owner: 0, x: 320, y: 328, w: 72, h: 72, shape: "circle" },
			{ owner: 1, x: 1528, y: 328, w: 72, h: 72, shape: "circle" },
		],
		zones: [
			{ x: 192, y: 200, w: 328, h: 328, shape: "circle" },
			{ x: 1400, y: 200, w: 328, h: 328, shape: "circle" },
		],
		slopes: [
			{ x: 94, y: 34, w: 200, h: 192, high: "left", curve: true, ceiling: true },
			{ x: 1624, y: 778, w: 200, h: 192, high: "right", curve: true },
			{ x: 94, y: 776, w: 200, h: 192, high: "left", curve: true },
			{ x: 1616, y: 34, w: 206, h: 192, high: "right", curve: true, ceiling: true },
		],
	},
	{
		name: "Pongz",
		walls: [
			{ x: 1824, y: -16, w: 104, h: 40 },
			{ x: -8, y: -16, w: 104, h: 40 },
			{ x: 296, y: -48, w: 1336, h: 72 },
			{ x: -8, y: 192, w: 104, h: 328 },
			{ x: 1824, y: 200, w: 104, h: 320 },
			{ x: 1832, y: 824, w: 96, h: 240 },
			{ x: -8, y: 824, w: 96, h: 232 },
			{ x: 296, y: 968, w: 1336, h: 72, grass: true },
			{ x: 1256, y: 392, w: 80, h: 272 },
			{ x: 584, y: 392, w: 88, h: 272 },
		],
		ball: {
			x: 960,
			y: 400,
		},
		players: [
			{
				color: "#48f",
				x: 348,
				y: 912,
				hud: {
					x: 24,
					y: 260,
				},
				keys: {
					left: "KeyA",
					right: "KeyD",
					jump: "Space",
				},
			},
			{
				color: "#f44",
				x: 1532,
				y: 912,
				hud: {
					x: 1872,
					y: 260,
				},
				keys: {
					left: "ArrowLeft",
					right: "ArrowRight",
					jump: "Enter",
				},
			},
		],
		goals: [
			{ owner: 0, x: 1872, y: 24, w: 48, h: 176 },
			{ owner: 0, x: 1872, y: 520, w: 48, h: 304 },
			{ owner: 1, x: 0, y: 24, w: 40, h: 168 },
			{ owner: 1, x: 0, y: 520, w: 48, h: 304 },
		],
		zones: [
			{ x: 1600, y: -96, w: 368, h: 368, shape: "circle" },
			{ x: -56, y: -112, w: 384, h: 384, shape: "circle" },
			{ x: 1664, y: 488, w: 416, h: 416, shape: "circle" },
			{ x: -160, y: 488, w: 416, h: 416, shape: "circle" },
		],
		slopes: [],
	},
	{
		name: "Floor is Lava",
		walls: [
			{ x: -184, y: 24, w: 2296, h: 2 },
			{ x: 92, y: 190, w: 2, h: 770 },
			{ x: 1822, y: 192, w: 2, h: 778 },
			{ x: 256, y: 970, w: 1408, h: 2 },
			{ x: 1824, y: 190, w: 152, h: 2, grass: true },
			{ x: -26, y: 188, w: 118, h: 2, grass: true },
			{ x: 480, y: 728, w: 960, h: 176, grass: true },
		],
		ball: {
			x: 960,
			y: 144,
		},
		players: [
			{
				color: "#48f",
				x: 620,
				y: 680,
				hud: {
					x: 32,
					y: 300,
				},
				keys: {
					left: "KeyA",
					right: "KeyD",
					jump: "Space",
				},
			},
			{
				color: "#f44",
				x: 1268,
				y: 680,
				hud: {
					x: 1864,
					y: 300,
				},
				keys: {
					left: "ArrowLeft",
					right: "ArrowRight",
					jump: "Enter",
				},
			},
		],
		goals: [
			{ owner: 0, x: 964, y: 912, w: 858, h: 58, sparks: "top" },
			{ owner: 1, x: 92, y: 912, w: 870, h: 58, sparks: "top" },
		],
		zones: [
			{ x: 1120, y: 568, w: 688, h: 688, shape: "circle" },
			{ x: 94, y: 568, w: 688, h: 688, shape: "circle" },
		],
		slopes: [
			{ x: 1624, y: 780, w: 200, h: 192, high: "right", curve: true },
			{ x: 94, y: 780, w: 200, h: 192, high: "left", curve: true },
		],
	},
];

// A level is plain data (JSON-friendly); the builder writes this shape and the game reads it.
// walls: `grass: true` grows little blades along the top edge.
// goals: any number. `owner` = index into `players` of who SCORES there (the others lose a life).
//        `sparks` ('left'|'right'|'top'|'bottom', optional) = which edge sheds particles.
//        `shape: 'circle'` makes the goal a circle (an ellipse if the box isn't square) instead of a box.
// zones: any number of grey slow-mo boxes, not tied to a player. `shape: 'circle'` works here too.
// slopes: `ceiling: true` flips one upside down (solid above the surface). Rotate = turn through the 4 corners.
// name: optional, shown in the level select.
// Shared by the game (index.html) and the builder (builder.html).
const DEFAULT_LEVEL = DEFAULT_LEVELS[0];
const WALL_RADIUS = 6; // walls are drawn with small rounded corners (visual only: the hitbox stays square)

// One segment of a health bar (24 wide, 60 tall) with 45-degree bevelled top and bottom, as polygon points.
function hudSegment(x, y) {
	return [
		{ x, y: y + 12 },
		{ x: x + 12, y },
		{ x: x + 24, y: y + 12 },
		{ x: x + 24, y: y + 48 },
		{ x: x + 12, y: y + 60 },
		{ x, y: y + 48 },
	];
}

// Little grass blades along the top of a wall `width` px wide, as { x, h, lean } (x is relative to the wall).
// Deterministic from `seed` (the wall's index), and each blade depends only on the ones before it, so
// resizing a wall never reshuffles the grass it already had, and the game, the builder and any watcher
// all draw the same blades.
function grassBlades(width, seed) {
	let s = Math.imul(seed + 1, 2654435761) >>> 0 || 1;
	const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
	const blades = [];
	for (let x = 3 + rand() * 4; x < width - 2; x += 5 + rand() * 6)
		blades.push({
			x: Math.round(x * 10) / 10,
			h: Math.round(5 + rand() * 10),
			lean: Math.round((rand() - 0.5) * 9),
		});
	return blades;
}

// Height (world y) of slope s's surface at world x. u = 0 at the thin edge, 1 at the thick edge.
// For a ceiling slope the solid is ABOVE this line; for a floor slope it is below it.
function slopeY(s, x) {
	const u = Math.max(0, Math.min(1, s.high === "right" ? (x - s.x) / s.w : (s.x + s.w - x) / s.w));
	const y = s.curve ? s.y + s.h * Math.sqrt(1 - u * u) : s.y + s.h * (1 - u);
	return s.ceiling ? 2 * s.y + s.h - y : y; // a ceiling slope is the same shape flipped top-to-bottom
}

// Outline of a slope as a closed polygon: along the surface from the low edge to the tall edge,
// along the thick face to the base. (The polygon closes back along the base.) Used to draw it and
// to bounce the ball off it, so the two can never disagree.
function slopePoints(s) {
	const n = s.curve ? 16 : 1;
	const pts = [];
	for (let i = 0; i <= n; i++) {
		const x = s.high === "right" ? s.x + (s.w * i) / n : s.x + s.w - (s.w * i) / n;
		pts.push({ x, y: slopeY(s, x) });
	}
	pts.push({
		x: s.high === "right" ? s.x + s.w : s.x,
		y: s.ceiling ? s.y : s.y + s.h,
	}); // down/up the thick face to the base
	return pts;
}

// Is world point (x, y) inside r? r is a box, or with `shape: 'circle'` the ellipse inscribed in the box
// (a circle when the box is square). Used for slow-mo zones, goals, and by the builder to select them.
function inShape(x, y, r) {
	if (r.shape !== "circle") return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
	const a = r.w / 2,
		b = r.h / 2;
	return ((x - r.x - a) / a) ** 2 + ((y - r.y - b) / b) ** 2 <= 1;
}

// A level's display name: its own `name`, or "Level N" by position.
const levelName = (l, i = 0) => (typeof l?.name === "string" && l.name.trim() ? l.name.trim() : `Level ${i + 1}`);

// Is (x, y) inside the closed polygon `pts` (even-odd rule)? Used to ask whether the ball's centre is IN a slope.
function inPolygon(pts, x, y) {
	let inside = false;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
		if (
			pts[i].y > y !== pts[j].y > y &&
			x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x
		)
			inside = !inside;
	return inside;
}

// The point on the polygon's outline nearest to (x, y), how far away it is, whether (x, y) is INSIDE the solid,
// and the normal (nx, ny) that points OUT of the solid from there. The direction from the ball to the nearest
// point is only "out" when the ball is outside: when it is inside (it reached the surface, or got shoved past it)
// that same direction points deeper in, so it has to be flipped. Getting this wrong pushes the ball further INTO
// the solid, and it comes out the other side.
function polygonContact(pts, x, y) {
	let best = null;
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i],
			b = pts[(i + 1) % pts.length];
		const ex = b.x - a.x,
			ey = b.y - a.y;
		const len2 = ex * ex + ey * ey;
		const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
		const cx = a.x + t * ex,
			cy = a.y + t * ey;
		const dist = Math.hypot(x - cx, y - cy);
		if (!best || dist < best.dist) best = { x: cx, y: cy, dist, ex, ey };
	}
	const inside = inPolygon(pts, x, y);
	let nx, ny;
	if (best.dist > 1e-6) {
		nx = (x - best.x) / best.dist;
		ny = (y - best.y) / best.dist;
		if (inside) {
			nx = -nx;
			ny = -ny;
		} // from inside, "away from the nearest edge" is deeper in: flip it
	} else {
		// Exactly ON the outline: use the edge's own outward normal (the side that is not inside the polygon).
		const len = Math.hypot(best.ex, best.ey) || 1;
		nx = best.ey / len;
		ny = -best.ex / len;
		if (inPolygon(pts, best.x + nx * 0.5, best.y + ny * 0.5)) {
			nx = -nx;
			ny = -ny;
		}
	}
	return { x: best.x, y: best.y, dist: best.dist, inside, nx, ny };
}

// Trust boundary: levels come from localStorage or pasted JSON, so check the shape before using it.
function isValidLevel(l) {
	const rect = (r) =>
		["x", "y", "w", "h"].every((k) => Number.isFinite(r?.[k])) &&
		r.w > 0 &&
		r.h > 0 && // (a zero-size box would divide by zero in the circle test)
		(r.shape === undefined || r.shape === "circle");
	return Boolean(
		l &&
		Array.isArray(l.walls) &&
		l.walls.every(rect) &&
		Array.isArray(l.zones) &&
		l.zones.every(rect) &&
		(l.slopes ?? []).every(
			(s) =>
				rect(s) &&
				(s.high === "left" || s.high === "right") &&
				(s.ceiling === undefined || typeof s.ceiling === "boolean"),
		) && // optional: older levels have none
		(l.name === undefined || (typeof l.name === "string" && l.name.length <= 40)) &&
		Array.isArray(l.players) &&
		l.players.length > 0 &&
		l.players.every(
			(p) =>
				Number.isFinite(p.x) &&
				Number.isFinite(p.y) &&
				p.keys &&
				p.color &&
				Number.isFinite(p.hud?.x) &&
				Number.isFinite(p.hud?.y),
		) &&
		Array.isArray(l.goals) &&
		l.goals.every(
			(g) =>
				rect(g) &&
				l.players[g.owner] &&
				(g.sparks === undefined || ["left", "right", "top", "bottom"].includes(g.sparks)),
		) &&
		Number.isFinite(l.ball?.x) &&
		Number.isFinite(l.ball?.y),
	);
}

// ---------- Saved levels ----------
// The builder's Save button keeps levels in this browser's localStorage, as a list; each is found by its own `name`
// (saving again under the same name replaces it). The game's level select and the builder's "Start from..." list them.
// Trust boundary: storage can hold anything (an older version, another tab, a hand edit), so invalid ones are skipped.
const SAVED_KEY = "wizardball-levels";
function readSavedLevels() {
	try {
		const all = JSON.parse(localStorage.getItem(SAVED_KEY));
		return Array.isArray(all)
			? all.filter((l) => isValidLevel(l) && typeof l.name === "string" && l.name.trim())
			: [];
	} catch {
		return [];
	}
}
// Returns true if it replaced a saved level with the same name. Throws if storage is full or turned off.
function saveLevel(level) {
	const all = readSavedLevels();
	const i = all.findIndex((l) => l.name === level.name);
	if (i >= 0) all[i] = level;
	else all.push(level);
	localStorage.setItem(SAVED_KEY, JSON.stringify(all));
	return i >= 0;
}
