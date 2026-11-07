const W = 1920,
	H = 1000;
const DT = 1 / 120; // fixed physics step, in seconds
const MAX_BALL_SPEED = 1000;
// Players' terminal velocity. Without one, falling through an open bottom (which warps you back to the top) speeds you
// up forever, until you move further in a step than you are tall and drop straight through floors.
const MAX_FALL = 1000;
const BUBBLE_LIFE = 2.5; // seconds for a bubble to fade away
const DEATH_TIME = 1.2; // seconds the death animation lasts
// Running, and the slide: double-tap left or right on the ground for a burst of speed that eases back to a run.
const RUN_SPEED = 450;
const SLIDE_SPEED = 900; // at the start of a slide
const SLIDE_TIME = 0.4; // seconds
const DOUBLE_TAP = 0.25; // seconds between the two presses
const SLIDE_COOLDOWN = 0.3; // seconds after one ends before the next can start (no chaining them across the arena)
const NO_SLIDE = { slide: 0, slideDir: 1, slideCool: 0, held: 0, tapDir: 0, tapAge: 9 }; // a player's slide state at spawn / reset
const GRASS = "#fff";

// A "resource": global state that isn't tied to any entity. round.t > 0 = countdown, world frozen.
// t = countdown seconds left. hit = death-animation seconds left (beam = what to draw during it).
// winner = { color } once someone runs out of lives; play stays frozen until R is pressed.
const round = { t: 0, hit: 0, beam: null, winner: null }; // t starts at 0: the title screen is up, Play starts the countdown
// Another resource: how fast game time runs. 1 = normal, <1 = slow-mo.
const clock = { scale: 1 };
// Another: is the title screen up? While it is, nothing simulates (see title.js).
const menu = { open: true };
// Online state (see online.js). mode: 'local' = two players on one keyboard, 'host' = runs the game,
// 'guest' = only draws what the host sends. localSlot = which player this machine controls online.
// remote = the other player's latest input; tick = called once per frame by online.js.
const net = {
	mode: "local",
	localSlot: 0,
	remote: { left: false, right: false, jump: false },
	tick: null,
	spectating: false,
	roomCode: "",
	watchers: 0, // for the on-screen label
};
// The computer opponent (see ai.js): slot < 0 = nobody, otherwise that player slot is played by the AI.
const ai = { slot: -1, skill: "normal" };
const ctx = document.getElementById("c").getContext("2d");
document.fonts.load('120px "Press Start 2P"'); // canvas won't fetch fonts on its own; kick it off now

// ---------- ECS ----------
// Entity    = just an integer id.
// Component = plain data, stored per-id in a Map, one Map per component name.
// System    = a function that loops over entities having certain components.
const components = {}; // { pos: Map(id -> {x,y}), vel: Map(...), ... }
let nextId = 0;

// Spawn with a chosen id. Online, the guest uses the host's ids so both sides name things the same.
function spawnAs(id, parts) {
	for (const name in parts) {
		components[name] ??= new Map();
		components[name].set(id, parts[name]);
	}
	return id;
}
const spawn = (parts) => spawnAs(nextId++, parts);

// Yields [id, compA, compB, ...] for every entity that has all the named components.
function* query(...names) {
	for (const id of components[names[0]]?.keys() ?? [])
		if (names.every((n) => components[n]?.has(id)))
			yield [id, ...names.map((n) => components[n].get(id))];
}

// ---------- Input ----------
const down = new Set(); // keys currently held
const pressed = new Set(); // keys that went down this frame (for jump)
addEventListener("keydown", (e) => {
	if (e.target instanceof HTMLInputElement) return; // typing a room code shouldn't move the players
	if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault(); // don't scroll
	if (!e.repeat) pressed.add(e.code);
	down.add(e.code);
});
addEventListener("keyup", (e) => down.delete(e.code));

// The on-screen buttons on phones (touch.js) hold these pseudo-keys in the same down / pressed sets as real keys.
// They play as player 1: the human vs the computer, this machine's player online, blue on a shared screen.
const TOUCH = { left: "TouchLeft", right: "TouchRight", jump: "TouchJump" };

// What the local keyboard (and touch buttons) are asking for. Online, either player's keys work, since each machine has one player.
function localInput() {
	const all = [...query("controls")].map(([, c]) => c);
	return {
		left: down.has(TOUCH.left) || all.some((c) => down.has(c.left)),
		right: down.has(TOUCH.right) || all.some((c) => down.has(c.right)),
		jump: pressed.has(TOUCH.jump) || all.some((c) => pressed.has(c.jump)), // an edge: true only on the step the key went down
	};
}

// Systems never read the keyboard; they read inputs[slot]. Local play fills it from the keys,
// online play fills the remote player's slot from the network instead. That one indirection
// is what makes networking possible: the host can't tell (or care) where an input came from.
const inputs = [];
function fillInputs() {
	for (const [, c] of query("controls")) {
		if (c.slot === ai.slot) inputs[c.slot] = aiInput(c.slot);
		else if (ai.slot >= 0)
			inputs[c.slot] = localInput(); // vs the computer: the human can use either key set
		else if (net.mode === "local") {
			const touch = c.slot === 0; // the touch buttons play blue
			inputs[c.slot] = {
				left: down.has(c.left) || (touch && down.has(TOUCH.left)),
				right: down.has(c.right) || (touch && down.has(TOUCH.right)),
				jump: pressed.has(c.jump) || (touch && pressed.has(TOUCH.jump)),
			};
		}
		else inputs[c.slot] = c.slot === net.localSlot ? localInput() : net.remote;
	}
}

// ---------- Systems ----------
function despawn(id) {
	for (const name in components) components[name].delete(id);
}

// Air jump: drop a new bubble where you are. Your previous one stops being solid (it would be confusing if
// the ball ricocheted off a faint ghost) but keeps fading, so jumping quickly in a row leaves a trail.
// Every bubble fades out over BUBBLE_LIFE seconds, solid or not (see bubbleFadeSystem).
function placeBubble(body, pos, box, color) {
	const previous = components.bubble?.get(body.bubble);
	if (previous) previous.solid = false;
	body.bubble = spawn({
		pos: { x: pos.x + box.w / 2, y: pos.y + box.h / 2 },
		circle: { r: 50 },
		bubble: { solid: true, t: BUBBLE_LIFE, max: BUBBLE_LIFE },
		look: { color },
	});
}

function controlSystem() {
	for (const [, vel, body, keys, pos, box, look] of query(
		"vel",
		"body",
		"controls",
		"pos",
		"box",
		"look",
	)) {
		const input = inputs[keys.slot];
		const held = input.right - input.left; // -1, 0 or 1

		// Double tap: a fresh press in the same direction as a press less than DOUBLE_TAP ago, on the ground, starts a
		// slide. Read from the inputs here (not the keyboard) so it works the same for a guest online and for the AI.
		if (held !== 0 && held !== body.held) {
			if (held === body.tapDir && body.tapAge < DOUBLE_TAP && body.grounded && body.slide <= 0 && body.slideCool <= 0) {
				body.slide = SLIDE_TIME;
				body.slideDir = held;
			}
			body.tapDir = held;
			body.tapAge = 0;
		}
		body.held = held;
		body.tapAge += DT;
		if (body.slide > 0 && (input.jump || !body.grounded)) {
			// jumping, or sliding off a ledge, ends it
			body.slide = 0;
			body.slideCool = SLIDE_COOLDOWN;
		}
		if (body.slide > 0) {
			// the slide's direction is locked; its speed eases from SLIDE_SPEED back down to a run
			vel.x = body.slideDir * (RUN_SPEED + (SLIDE_SPEED - RUN_SPEED) * (body.slide / SLIDE_TIME));
			body.slide -= DT;
			if (body.slide <= 0) body.slideCool = SLIDE_COOLDOWN;
		} else {
			body.slideCool -= DT;
			vel.x = held * RUN_SPEED;
		}

		if (input.jump) {
			if (!body.grounded)
				placeBubble(body, pos, box, look.color); // air jump = bubble
			else
				for (
					let i = 0;
					i < 14;
					i++ // ground launch burst
				)
					emit(
						pos.x + box.w / 2,
						pos.y + box.h,
						(Math.random() - 0.5) * 400,
						-Math.random() * 250,
						"#fff",
						0.5,
					);
			vel.y = -620; // ponytail: unlimited air jumps, like the original; add a limit if it feels broken
		}
	}
}

const overlaps = (a, ab, b, bb) =>
	a.x < b.x + bb.w && a.x + ab.w > b.x && a.y < b.y + bb.h && a.y + ab.h > b.y;

const MAX_STEP = 24; // tallest bump (px, per physics step) a player walks up; steeper acts like a wall

// How far the player's feet are sunk below slope s's surface: > 0 = inside it, < 0 = above it.
// null = not over the slope at all (or entirely under its base). The box corner nearest the
// tall side touches first, so that's where we probe.
function slopePen(pos, box, s) {
	if (pos.x >= s.x + s.w || pos.x + box.w <= s.x || pos.y >= s.y + s.h)
		return null;
	const xp =
		s.high === "right"
			? Math.min(pos.x + box.w, s.x + s.w)
			: Math.max(pos.x, s.x);
	return pos.y + box.h - slopeY(s, xp);
}

// Move one axis at a time, then push out of anything solid. Doing axes separately
// is what lets you slide along a wall/floor instead of sticking to it.
// Ceiling slopes (solid ABOVE their surface). How far up inside the solid the player's head is:
// > 0 = the head is in it, <= 0 = clear. null = not beside/under it at all. The head corner under the
// thick (low-hanging) end meets it first, so that is where we probe.
function ceilingPen(pos, box, s) {
	if (
		pos.x >= s.x + s.w ||
		pos.x + box.w <= s.x ||
		pos.y + box.h <= s.y ||
		pos.y >= s.y + s.h
	)
		return null;
	const xp =
		s.high === "right"
			? Math.min(pos.x + box.w, s.x + s.w)
			: Math.max(pos.x, s.x);
	return slopeY(s, xp) - pos.y;
}

// Out of a wall along one axis: back the way we came (moved > 0: to its near side), or if we didn't move along this
// axis (wrapped round the screen into it, or spawned in it), the shortest way out.
function pushOut(moved, at, size, wallAt, wallSize) {
	const before = wallAt - size, after = wallAt + wallSize;
	if (moved > 0) return before;
	if (moved < 0) return after;
	return at - before < after - at ? before : after;
}

// Would a box of this size at (x, y) be inside a wall or a slope?
function blockedAt(x, y, box) {
	const at = { x, y };
	for (const [, sp, sb] of query("pos", "box", "solid")) if (overlaps(at, box, sp, sb)) return true;
	for (const [, s] of query("slope")) if ((s.ceiling ? ceilingPen(at, box, s) : slopePen(at, box, s)) > 0) return true;
	return false;
}

// Where you'd come out warping through a side edge to x: at height y, or stepped up onto the far side's floor if that's
// at most a step higher (MAX_STEP, the same bump you can walk up). The two sides of a level are rarely lined up to
// the pixel (Pongz's top corners are 8px apart), and walking off one ledge should still land you on the other.
// null = no room there (a wall at head height, say): that edge is a wall.
function warpY(x, y, box) {
	for (let up = 0; up <= MAX_STEP; up++) if (!blockedAt(x, y - up, box)) return y - up;
	return null;
}

function physicsSystem() {
	for (const [, pos, vel, box, body] of query("pos", "vel", "box", "body")) {
		vel.y = Math.min(vel.y + 900 * DT, MAX_FALL); // gravity, up to a terminal velocity
		body.grounded = false;
		const prevSlope = body.slope; // the slope we were standing on last step, if any
		body.slope = null;

		// Which side of a wall to push out to comes from how we MOVED this step (dx), not vel.x: the first wall we bump
		// zeroes vel.x, and where two walls are stacked (a hairline against a shelf's end) the second used to read that 0
		// as "moving left" and push us out of its far side: straight through it and out of the arena.
		const x0 = pos.x,
			dx = vel.x * DT;
		pos.x += dx;
		for (const [, sp, sb] of query("pos", "box", "solid"))
			if (overlaps(pos, box, sp, sb)) {
				pos.x = pushOut(dx, pos.x, box.w, sp.x, sb.w);
				vel.x = 0;
			}
		// Only warp through a side edge (see the end) if there's room where you'd come out. If the far side is walled off
		// there (a wall running past the edge of the screen), this edge is a wall instead: no warping INTO that wall.
		if (pos.x + box.w > W && warpY(-box.w, pos.y, box) === null) {
			pos.x = W - box.w;
			vel.x = 0;
		} else if (pos.x < 0 && warpY(W, pos.y, box) === null) {
			pos.x = 0;
			vel.x = 0;
		}
		for (const [, s] of query("slope")) {
			if (s.ceiling) {
				// Walking into a ceiling slope (or its thick end) is like walking into a wall: no stepping up or down it.
				if ((ceilingPen(pos, box, s) ?? 0) > 0) {
					pos.x = x0; // back where this step started (not "minus vel.x": a wall above may have zeroed that)
					vel.x = 0;
				}
				continue;
			}
			const pen = slopePen(pos, box, s);
			if (pen === null) {
				// Just walked off the LOW end: drop to the base level so we don't hover a pixel above the floor
				// (which would count as airborne and turn a jump into a bubble). The tall end is >MAX_STEP up, so no snap there.
				const gap = s.y + s.h - (pos.y + box.h);
				if (s === prevSlope && vel.y >= 0 && gap > 0 && gap < MAX_STEP)
					pos.y += gap;
				continue;
			}
			if (pen > MAX_STEP) {
				pos.x = x0; // back where this step started (see dx above)
				vel.x = 0;
			} // too steep (e.g. the tall face): a wall
			else if (pen > 0)
				pos.y -= pen; // walking up: ride the surface
			else if (s === prevSlope && vel.y >= 0 && pen > -MAX_STEP) pos.y -= pen; // walking down: stay glued, stay grounded
		}

		const vyMove = vel.y; // the velocity this step actually moved by: the wall pass below zeroes vel.y when it bumps, and the slope checks need the original
		pos.y += vel.y * DT;
		for (const [, sp, sb] of query("pos", "box", "solid"))
			if (overlaps(pos, box, sp, sb)) {
				// as for x: decide by how we moved (vyMove), since the first wall we bump zeroes vel.y
				pos.y = pushOut(vyMove, pos.y, box.h, sp.y, sb.h);
				if (pos.y + box.h <= sp.y) body.grounded = true; // pushed out on TOP of it: standing
				vel.y = 0;
			}
		// The same for the top and bottom edges: no dropping out of the bottom into a wall at the top.
		if (pos.y + box.h > H && blockedAt(pos.x, -box.h, box)) {
			pos.y = H - box.h;
			vel.y = 0;
			body.grounded = true;
		} else if (pos.y < 0 && blockedAt(pos.x, H, box)) {
			pos.y = 0;
			vel.y = 0;
		}
		for (const [, s] of query("slope")) {
			if (s.ceiling) {
				const prevFeet = pos.y + box.h - vyMove * DT;
				const overlapX = pos.x < s.x + s.w && pos.x + box.w > s.x;
				if (
					overlapX &&
					vyMove > 0 &&
					prevFeet <= s.y + 2 &&
					pos.y + box.h > s.y
				) {
					// fell onto the flat top of it: stand on it
					pos.y = s.y - box.h;
					vel.y = 0;
					body.grounded = true;
				} else {
					// Head inside the ceiling: push it back down to the surface, whatever it was doing. (This used to require
					// "was moving up", but a wall above, e.g. a hairline bar flush with the pipe's top edge, bumps the head
					// first and zeroes the velocity, so the player was left stuck inside the curve.)
					const pen = ceilingPen(pos, box, s);
					if (pen !== null && pen > 0) {
						pos.y += pen;
						if (vel.y < 0) vel.y = 0;
					}
				}
				continue;
			}
			const pen = slopePen(pos, box, s);
			if (pen === null || pen <= 0) continue;
			if (pen > MAX_STEP) {
				if (vyMove < 0) {
					pos.y = s.y + s.h;
					vel.y = 0;
				}
			} // rose into the underside: head bump
			else if (vyMove >= 0) {
				pos.y -= pen;
				vel.y = 0;
				body.grounded = true;
				body.slope = s;
			} // landed / standing
		}

		// Walk fully out of one goal gap and you come out of the other side. (Checked again here, as the vertical move
		// since the edge check above can bring you level with a wall on the far side: then stop at this edge instead.)
		if (pos.x + box.w < 0) {
			const y = warpY(W, pos.y, box);
			if (y === null) { pos.x = 0; vel.x = 0; } else { pos.x = W; pos.y = y; }
		} else if (pos.x > W) {
			const y = warpY(-box.w, pos.y, box);
			if (y === null) { pos.x = W - box.w; vel.x = 0; } else { pos.x = -box.w; pos.y = y; }
		}
		// ...and the same up and down: fall out of an open bottom and you drop back in from the top.
		if (pos.y + box.h < 0) pos.y = H;
		else if (pos.y > H) pos.y = -box.h;
	}
}

const NOT_MOVING = { x: 0, y: 0 };

// Shared by every ball collision: push the ball out to `reach` from the contact point along the
// normal (dx, dy), then bounce using its velocity RELATIVE to what it hit (ov), so a moving
// player can hit the ball.
function bounceOff(pos, vel, ball, cx, cy, dx, dy, reach, ov) {
	pos.x = cx + dx * reach; // push out so we don't stay stuck inside
	pos.y = cy + dy * reach;
	const vn = (vel.x - ov.x) * dx + (vel.y - ov.y) * dy;
	if (vn < 0) {
		const e = -vn < 30 ? 0 : ball.bounce; // tiny impacts: stop, don't jitter forever
		vel.x -= (1 + e) * vn * dx;
		vel.y -= (1 + e) * vn * dy;
	}
	vel.x *= 0.995; // crude rolling friction
}

// ---------- The ball ----------
// Is the ball's centre inside something solid? It never should end a step there: that is how a ball
// ends up on the wrong side of a thin wall, or inside a quarter-pipe, i.e. "glitches out of the game".
function centreInSolid(x, y) {
	for (const [, p, b] of query("pos", "box", "solid"))
		if (x > p.x && x < p.x + b.w && y > p.y && y < p.y + b.h) return true;
	for (const [, s] of query("slope")) if (inPolygon(s.pts, x, y)) return true;
	return false;
}

// One contact between the ball and a box (a wall, or a player's pill). Returns true if they were touching.
// Note the ball's `pos` is its CENTRE, while a box's `pos` is its top-left corner.
function contactBox(pos, vel, ball, id, bp, bb, prev) {
	// Players are pills (a vertical line segment with radius w/2), so the ball rolls off
	// their rounded ends instead of catching on corners. Walls stay plain boxes (rad 0).
	// The same code covers both: find the closest point on the shape's "core", then
	// treat it as circle vs. circle with radius ball.r + rad.
	const pill = components.body.has(id);
	const rad = pill ? bb.w / 2 : 0;
	const reach = ball.r + rad;
	let cx = pill ? bp.x + rad : Math.max(bp.x, Math.min(pos.x, bp.x + bb.w));
	let cy = pill
		? Math.max(bp.y + rad, Math.min(pos.y, bp.y + bb.h - rad))
		: Math.max(bp.y, Math.min(pos.y, bp.y + bb.h));
	let dx = pos.x - cx,
		dy = pos.y - cy;
	const dist = Math.hypot(dx, dy);
	if (dist >= reach - 1e-4) return false; // (a hair of tolerance: a ball pushed out to exactly `reach` is not touching again)

	if (dist === 0 && pill) {
		dx = pos.x >= cx ? 1 : -1;
		dy = 0; // dead center on the spine: pick a side
	} else if (dist === 0) {
		// The centre is INSIDE the box. Leave by the face on the side the ball CAME FROM (`prev`): for a thin
		// wall the nearest face is often the far one, and leaving by it would carry the ball through the wall.
		// (If it was already inside last step, there is no "came from": use the nearest face.)
		const faces = [
			{ d: pos.x - bp.x, from: prev.x <= bp.x, dx: -1, dy: 0, cx: bp.x }, // left face
			{ d: bp.x + bb.w - pos.x, from: prev.x >= bp.x + bb.w, dx: 1, dy: 0, cx: bp.x + bb.w }, // right face
			{ d: pos.y - bp.y, from: prev.y <= bp.y, dx: 0, dy: -1, cy: bp.y }, // top face
			{ d: bp.y + bb.h - pos.y, from: prev.y >= bp.y + bb.h, dx: 0, dy: 1, cy: bp.y + bb.h }, // bottom face
		];
		const cameFrom = faces.filter((f) => f.from);
		const face = (cameFrom.length ? cameFrom : faces).reduce((a, f) => (f.d < a.d ? f : a));
		dx = face.dx;
		dy = face.dy;
		if (face.cx !== undefined) cx = face.cx;
		if (face.cy !== undefined) cy = face.cy;
	} else {
		dx /= dist;
		dy /= dist;
	} // contact normal, box -> ball
	bounceOff(pos, vel, ball, cx, cy, dx, dy, reach, components.vel?.get(id) ?? NOT_MOVING);
	return true;
}

// One contact between the ball and a ramp / quarter-pipe. Unlike a box, the ball's centre can be INSIDE the solid
// (it reached the surface, or got shoved past it); polygonContact knows that and gives a normal that points OUT.
function contactSlope(pos, vel, ball, s) {
	const c = polygonContact(s.pts, pos.x, pos.y);
	if (!c.inside && c.dist >= ball.r - 1e-4) return false;
	bounceOff(pos, vel, ball, c.x, c.y, c.nx, c.ny, ball.r, NOT_MOVING);
	return true;
}

// Resolve the ball against everything solid. A few passes, because pushing it out of one thing can push it into
// another (a wedge: a quarter-pipe meeting a flat wall). Within a pass: players, then slopes, then walls LAST, so
// the walls always win and nothing can shove the ball through one. (Goals are boxes too, but the ball passes through.)
function resolveBall(pos, vel, ball, prev) {
	const players = [...query("pos", "box", "body")];
	const walls = [...query("pos", "box", "solid")];
	for (let pass = 0; pass < 3; pass++) {
		let touched = false;
		for (const [id, bp, bb] of players) touched = contactBox(pos, vel, ball, id, bp, bb, prev) || touched;
		for (const [, s] of query("slope")) touched = contactSlope(pos, vel, ball, s) || touched;
		for (const [id, bp, bb] of walls) touched = contactBox(pos, vel, ball, id, bp, bb, prev) || touched;
		if (!touched) break;
	}
}

// Move the ball to (tx, ty) in small steps, resolving contacts after each, so a jump (a bubble pop) cannot
// carry it through a wall or into a slope: it stops at the first thing in the way.
function moveBall(pos, vel, ball, tx, ty) {
	const steps = Math.max(1, Math.ceil(Math.hypot(tx - pos.x, ty - pos.y) / 4)); // 4px: far less than the ball + a 2px wall
	const dx = (tx - pos.x) / steps,
		dy = (ty - pos.y) / steps;
	for (let i = 0; i < steps; i++) {
		const prev = { x: pos.x, y: pos.y };
		// Advance from where the ball IS now, not along the original line: if a wall pushed it back, it stays pushed back.
		// (Stepping along the original line forgot the push-back and eventually landed on the far side of the wall.)
		pos.x += dx;
		pos.y += dy;
		resolveBall(pos, vel, ball, prev);
		if (centreInSolid(pos.x, pos.y) && !centreInSolid(prev.x, prev.y)) {
			pos.x = prev.x;
			pos.y = prev.y;
			return;
		}
	}
}

function ballSystem() {
	for (const [, pos, vel, ball] of query("pos", "vel", "circle")) {
		const prev = { x: pos.x, y: pos.y }; // where it was: which side of a wall it came from
		vel.y += 900 * DT;
		pos.x += vel.x * DT;
		pos.y += vel.y * DT;

		resolveBall(pos, vel, ball, prev);

		// Last line of defence: the centre must never END a step inside something solid. If the passes above could
		// not get it out (a tight wedge), put it back where it was, bouncing a little.
		if (centreInSolid(pos.x, pos.y) && !centreInSolid(prev.x, prev.y)) {
			pos.x = prev.x;
			pos.y = prev.y;
			vel.x *= -0.5;
			vel.y *= -0.5;
		}

		// Pinned bug fix: a player pushing the ball into a wall re-applies their speed every
		// step (wall pushes ball back into player, player kicks again...), so energy piles up.
		// Capping speed stops the runaway. Proper fix (resolve player/wall/ball together) is later.
		const speed = Math.hypot(vel.x, vel.y);
		if (speed > MAX_BALL_SPEED) {
			vel.x *= MAX_BALL_SPEED / speed;
			vel.y *= MAX_BALL_SPEED / speed;
		}

		// Same wrap as players, for any open gap that isn't a goal (goals reset the ball first).
		if (pos.x + ball.r < 0) pos.x = W + ball.r;
		else if (pos.x - ball.r > W) pos.x = -ball.r;
		if (pos.y + ball.r < 0) pos.y = H + ball.r;
		else if (pos.y - ball.r > H) pos.y = -ball.r;
	}
}

// A particle is just an entity: position, velocity, a color, and a countdown to deletion.
function emit(x, y, vx, vy, color, life, g = 600) {
	spawn({
		pos: { x, y },
		vel: { x: vx, y: vy },
		particle: { life, max: life, g },
		look: { color },
	});
}

// A bubble particle (the goals'): drawn as a ring of radius r, and it sways from side to side across its path.
// `wave` = the sideways direction (unit vector) and where in the sway it starts.
function emitBubble(x, y, vx, vy, color, life, g, r) {
	const speed = Math.hypot(vx, vy) || 1;
	spawn({
		pos: { x, y },
		vel: { x: vx, y: vy },
		particle: { life, max: life, g, r, wave: { x: -vy / speed, y: vx / speed, phase: Math.random() * Math.PI * 2 } },
		look: { color },
	});
}

// Age particles, drift them, delete the dead ones. (Deleting from a Map mid-loop is safe in JS.)
function particleSystem() {
	for (const [id, pos, vel, p] of query("pos", "vel", "particle")) {
		vel.y += p.g * DT;
		pos.x += vel.x * DT;
		pos.y += vel.y * DT;
		if (p.wave) {
			// the sway: a sine wave across the path, about 7px each way at ~1 wobble a second
			const s = Math.cos((p.max - p.life) * 7 + p.wave.phase) * 50 * DT;
			pos.x += p.wave.x * s;
			pos.y += p.wave.y * s;
		}
		p.life -= DT;
		if (p.life <= 0) despawn(id);
	}
}

// Player visuals: trail while moving, somersault while airborne.
let tick = 0;
function effectsSystem() {
	tick++;
	for (const [id, pos, vel, box, body, look] of query(
		"pos",
		"vel",
		"box",
		"body",
		"look",
	)) {
		if (tick % 4 === 0 && Math.abs(vel.x) > 100)
			// every 4th step so it's a trail, not a smear
			emit(
				pos.x + box.w / 2,
				pos.y + Math.random() * box.h,
				-vel.x * 0.1,
				(Math.random() - 0.5) * 40,
				look.color,
				0.4,
			);
		const spin = components.spin.get(id);
		if (body.grounded) spin.a = 0;
		else spin.a += (vel.x < 0 ? -1 : 1) * 10 * DT; // flip in the direction you're moving

		// Sprite state. It keeps facing the way you last moved; the run cycle advances with distance covered.
		const anim = components.anim.get(id);
		if (Math.abs(vel.x) > 20) anim.facing = Math.sign(vel.x);
		anim.moving = body.grounded && Math.abs(vel.x) > 20;
		if (anim.moving)
			anim.phase = (anim.phase + (Math.abs(vel.x) * DT) / 80) % 1; // one stride per ~80px
		anim.air = !body.grounded;
		anim.vy = vel.y;
		anim.slide = body.slide > 0;
		if (anim.slide) {
			anim.facing = body.slideDir;
			if (tick % 2 === 0) // dust kicked up behind the slide
				emit(
					pos.x + box.w / 2 - body.slideDir * 6,
					pos.y + box.h - 2,
					-body.slideDir * (40 + Math.random() * 80),
					-30 - Math.random() * 70,
					"#fff",
					0.3 + Math.random() * 0.2,
					400,
				);
		}
	}
}

// Bubbles only affect the ball (players pass through). Ball gets pushed out along the
// bubble->ball direction and kicked outward at a minimum speed, so it always pops off.
function bubbleSystem() {
	for (const [, pos, vel, ball] of query("pos", "vel", "circle")) {
		for (const [, bp, bc, bubble] of query("pos", "circle", "bubble")) {
			if (!bubble.solid) continue; // a fading ghost
			const dx = pos.x - bp.x,
				dy = pos.y - bp.y,
				dist = Math.hypot(dx, dy);
			if (dist >= ball.r + bc.r || dist === 0) continue;
			const nx = dx / dist,
				ny = dy / dist;
			// Out to the bubble's surface, but in small steps so walls and slopes still stop it (a pop can be up to
			// 72px: as a teleport it could carry the ball clean through a thin wall).
			moveBall(pos, vel, ball, bp.x + nx * (ball.r + bc.r), bp.y + ny * (ball.r + bc.r));
			const speed = Math.hypot(vel.x, vel.y);
			const out = 500 + speed / 8; // tune: bigger = punchier bubbles
			vel.x = nx * out;
			vel.y = ny * out;
		}
	}
}

// Age every bubble; when one has faded out, remove it (and forget it if it was a player's current one).
function bubbleFadeSystem() {
	for (const [id, bubble] of query("bubble")) {
		bubble.t -= DT;
		if (bubble.t > 0) continue;
		despawn(id);
		for (const [, body] of query("body"))
			if (body.bubble === id) body.bubble = null;
	}
}

// The death beam: a stream of particles flowing from where the ball scored to each victim.
function beamSystem() {
	const { color, x, y, victims } = round.beam;
	for (const id of victims) {
		const p = components.pos.get(id),
			b = components.box.get(id);
		const tx = p.x + b.w / 2,
			ty = p.y + b.h / 2;
		const len = Math.hypot(tx - x, ty - y) || 1;
		for (let i = 0; i < 3; i++) {
			const f = Math.random(); // somewhere along the beam
			emit(
				x + (tx - x) * f + (Math.random() - 0.5) * 10,
				y + (ty - y) * f + (Math.random() - 0.5) * 10,
				((tx - x) / len) * 250 + (Math.random() - 0.5) * 60,
				((ty - y) / len) * 250 + (Math.random() - 0.5) * 60, // flowing toward the victim
				color,
				0.2 + Math.random() * 0.2,
				0,
			);
		}
	}
}

// Goals with a `sparks` edge shed particles from that edge, drifting out and up. (Set per goal in the builder.)
const EDGES = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
function goalSparkSystem() {
	if (tick % 4 !== 0) return;
	for (const [, gp, gb, goal, look] of query("pos", "box", "goal", "look")) {
		const n = EDGES[goal.sparks];
		if (!n) continue;
		const speed = () => 20 + Math.random() * 35; // bubbles float off slowly (they rise as they go: negative gravity below)
		let x, y;
		let dx = n[0],
			dy = n[1];
		if (goal.shape === "circle") {
			// a circular goal sheds from the arc of its rim that faces the chosen side
			const a = Math.atan2(n[1], n[0]) + (Math.random() - 0.5) * 1.4;
			x = gp.x + gb.w / 2 + Math.cos(a) * (gb.w / 2);
			y = gp.y + gb.h / 2 + Math.sin(a) * (gb.h / 2);
			dx = Math.cos(a);
			dy = Math.sin(a);
		} else {
			x =
				n[0] === 0 ? gp.x + Math.random() * gb.w : gp.x + (n[0] > 0 ? gb.w : 0); // a random point along the edge
			y =
				n[1] === 0 ? gp.y + Math.random() * gb.h : gp.y + (n[1] > 0 ? gb.h : 0);
		}
		emitBubble(
			x,
			y,
			dx * speed() + (Math.random() - 0.5) * 20,
			dy * speed() + (Math.random() - 0.5) * 20 - (n[1] === 0 ? 25 : 0),
			look.color,
			1 + Math.random() * 0.7,
			-30,
			2 + Math.random() * 3.5,
		);
	}
}

// Slow-mo zones: while the BALL is inside one, game time slows down (players walking through do nothing).
// Zones also shed floaty sparkles (zero gravity) so you can see where they are.
// The area of a box entity as a shape for inShape(): a box, or with `shape: "circle"` the circle/ellipse inside it.
const shapeOf = (p, b, shape) => ({ x: p.x, y: p.y, w: b.w, h: b.h, shape });
function slowSystem() {
	let slow = false;
	for (const [, zp, zb, zone] of query("pos", "box", "slow")) {
		const area = shapeOf(zp, zb, zone.shape);
		for (const [, p] of query("pos", "vel", "circle")) // only the ball slows the game (bubbles have no vel, so they're skipped)
			if (inShape(p.x, p.y, area)) slow = true;
		// A steady drift of sparkles rising through the zone: ~90 a second (3 in every 4 steps), so it reads as a
		// field. Slightly varied speed and life so it doesn't look like a grid of dots.
		if (Math.random() < 0.75) {
			let x,
				y,
				tries = 0;
			do {
				// a random point inside the zone (a circular zone: retry until it lands inside the circle)
				x = zp.x + Math.random() * zb.w;
				y = zp.y + Math.random() * zb.h;
			} while (!inShape(x, y, area) && ++tries < 8);
			if (inShape(x, y, area))
				emit(
					x,
					y,
					(Math.random() - 0.5) * 20,
					-30 - Math.random() * 30,
					zone.color,
					1 + Math.random() * 0.6,
					0,
				);
		}
	}
	clock.scale = slow ? 0.35 : 1;
}

// Put everything with a `spawn` point back there, stopped. Bubbles are removed.
function resetSystem() {
	clock.scale = 1;
	for (const [id] of query("particle")) despawn(id);
	for (const [, spin] of query("spin")) spin.a = 0;
	for (const [id] of query("bubble")) despawn(id);
	for (const [, body] of query("body")) Object.assign(body, { bubble: null, ...NO_SLIDE });
	for (const [, pos, vel, sp] of query("pos", "vel", "spawn")) {
		pos.x = sp.x;
		pos.y = sp.y;
		vel.x = 0;
		vel.y = 0;
	}
	// The pose only updates during play, so without this a player would sit through the countdown still tucked
	// in mid-jump (or facing wherever the goal caught them). Back to how they spawn: standing, facing the middle.
	for (const [, anim, sp] of query("anim", "spawn"))
		Object.assign(anim, { facing: sp.x < W / 2 ? 1 : -1, phase: 0, moving: false, air: false, vy: 0, slide: false });
}

// Trigger zone: ball center inside a goal box = the goal's owner loses a life.
function goalSystem() {
	for (const [, bpos] of query("pos", "vel", "circle")) {
		// vel = ball only; a bubble in the gap must not score
		for (const [, gp, gb, goal, glook] of query("pos", "box", "goal", "look")) {
			if (!inShape(bpos.x, bpos.y, shapeOf(gp, gb, goal.shape))) continue;
			// Owner SCORES here; everyone else loses a life.
			let over = false;
			const victims = [];
			for (const [id, l] of query("lives"))
				if (id !== goal.owner) {
					l.n -= 1;
					over ||= l.n <= 0;
					victims.push(id);
				}
			if (over) round.winner = { color: glook.color }; // the goal's color is the scorer's color

			// Death animation: freeze play, a particle beam from the ball to the victims, and the victims are
			// knocked back and fall over backwards (they keep their sprite: see drawWizard's `dead` pose).
			round.hit = DEATH_TIME;
			round.beam = { color: glook.color, x: bpos.x, y: bpos.y, victims };
			clock.scale = 1;
			// Everyone stops where they are... (Not `grounded = false` as well: effectsSystem runs right after this step and
			// would read that as airborne, freezing the scorer in the tucked jump pose for the whole animation. physicsSystem
			// works grounded out afresh every step anyway.)
			for (const [, vel] of query("vel", "body")) {
				vel.x = 0;
				vel.y = 0;
			}
			for (const id of victims) {
				// ...except the victims, who are thrown backwards: away from the way they were facing
				const vel = components.vel.get(id);
				vel.x = -components.anim.get(id).facing * 140;
				vel.y = -260;
			}
			return; // one goal per step
		}
	}
}

function tracePath(pts) {
	ctx.beginPath();
	ctx.moveTo(pts[0].x, pts[0].y);
	for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
	ctx.closePath();
}

function renderSystem() {
	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, W, H);
	ctx.lineWidth = 3;
	// Lives bar: vertical, 3 segments, filled = life left.
	for (const [, lives, hud, look] of query("lives", "hud", "look")) {
		ctx.strokeStyle = ctx.fillStyle = look.color;
		for (let i = 0; i < 3; i++) {
			// segments with 45-degree bevelled ends; filled = life left
			tracePath(hudSegment(hud.x, hud.y + i * 70));
			ctx.stroke();
			if (i < lives.n) ctx.fill();
		}
	}
	for (const [, s, look] of query("slope", "look")) {
		ctx.strokeStyle = look.color;
		tracePath(s.pts);
		ctx.stroke();
	}
	// Grass: little blades along the top of walls marked `grass`.
	ctx.strokeStyle = GRASS;
	ctx.lineWidth = 2;
	ctx.beginPath();
	for (const [, pos, blades] of query("pos", "grass"))
		for (const b of blades) {
			ctx.moveTo(pos.x + b.x, pos.y);
			ctx.lineTo(pos.x + b.x + b.lean, pos.y - b.h);
		}
	ctx.stroke();
	ctx.lineWidth = 3;
	// Bubbles: filled with their player's color, fading out as they age. Drawn behind the players.
	for (const [, pos, c, bubble, look] of query(
		"pos",
		"circle",
		"bubble",
		"look",
	)) {
		const fade = Math.max(0, bubble.t / bubble.max); // 1 -> 0
		ctx.fillStyle = ctx.strokeStyle = look.color;
		ctx.beginPath();
		ctx.arc(pos.x, pos.y, c.r, 0, Math.PI * 2);
		ctx.globalAlpha = 0.3 * fade;
		ctx.fill();
		ctx.globalAlpha = (bubble.solid ? 0.9 : 0.6) * fade;
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
	for (const [id, pos, box, look] of query("pos", "box", "look")) {
		// Victims of the death animation stay on screen, falling over backwards (progress 0 -> 1).
		const dying = round.hit > 0 && round.beam.victims.includes(id);
		const dead = dying ? Math.max(0.001, 1 - round.hit / DEATH_TIME) : 0;
		ctx.strokeStyle = look.color;
		// Rotate around the box center if it has a `spin` component (players do).
		ctx.save();
		ctx.translate(pos.x + box.w / 2, pos.y + box.h / 2);
		ctx.rotate(dying ? 0 : (components.spin?.get(id)?.a ?? 0)); // a dying wizard topples (see drawWizard), it doesn't somersault
		const goal = components.goal?.get(id);
		const circular = goal?.shape === "circle";
		const ellipse = () => {
			ctx.beginPath();
			ctx.ellipse(0, 0, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
		};
		if (goal) {
			// goals are tinted with their owner's color
			ctx.globalAlpha = 0.2;
			ctx.fillStyle = look.color;
			if (circular) {
				ellipse();
				ctx.fill();
			} else ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);
			ctx.globalAlpha = 1;
		}
		if (components.anim?.has(id)) {
			const anim = components.anim.get(id); // players. A dying one is never tucked or running: it's the death pose, from wherever it was.
			drawWizard(
				ctx,
				look.color,
				dying ? { ...anim, air: false, moving: false, slide: false, dead } : anim,
				performance.now(),
			);
		} else if (circular) {
			ellipse();
			ctx.stroke();
		} else if (components.solid?.has(id)) {
			// walls have small rounded corners (the hitbox stays square)
			ctx.beginPath();
			ctx.roundRect(
				-box.w / 2,
				-box.h / 2,
				box.w,
				box.h,
				Math.min(WALL_RADIUS, box.w / 2, box.h / 2),
			);
			ctx.stroke();
		} else ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
		ctx.restore();
	}
	for (const [, pos, p, look] of query("pos", "particle", "look")) {
		ctx.globalAlpha = p.life / p.max; // fade out as it ages
		ctx.fillStyle = look.color;
		if (p.r) {
			// a bubble: a thin ring that swells a little as it floats off, with a glint on its upper left
			const r = p.r * (1.6 - 0.6 * (p.life / p.max));
			ctx.strokeStyle = look.color;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
			ctx.stroke();
			ctx.fillRect(pos.x - r * 0.45 - 0.75, pos.y - r * 0.45 - 0.75, 1.5, 1.5);
		} else ctx.fillRect(pos.x - 3, pos.y - 3, 6, 6);
	}
	ctx.globalAlpha = 1;
	ctx.lineWidth = 1;
	for (const [id, pos, c, look] of query("pos", "circle", "look")) {
		if (components.bubble?.has(id)) continue; // bubbles were drawn above
		ctx.beginPath();
		ctx.arc(pos.x, pos.y, c.r, 0, Math.PI * 2);
		ctx.fillStyle = "#000"; // solid black, so it hides whatever is behind it
		ctx.fill();
		ctx.strokeStyle = look.color;
		ctx.stroke();
	}
	if (round.t > 0) {
		ctx.fillStyle = "#fff";
		ctx.font = '100px "Press Start 2P", monospace';
		ctx.textAlign = "center";
		ctx.fillText(Math.ceil(round.t), W / 2, H / 2);
	}
	// Online status, top center: watchers see where they are; the host sees the code to share.
	const label = net.spectating
		? "WATCHING - ESC TO LEAVE"
		: net.roomCode
			? `ROOM ${net.roomCode} - ${net.watchers} WATCHING`
			: ai.slot >= 0
				? `VS COMPUTER - ${ai.skill.toUpperCase()}`
				: "";
	if (label && !menu.open) {
		ctx.font = '18px "Press Start 2P", monospace';
		ctx.textAlign = "center";
		ctx.fillStyle = "#888";
		ctx.fillText(label, W / 2, 56);
	}
	if (round.winner && round.hit <= 0) {
		// ponytail: name comes from the color; add a `name` to each LEVEL.players entry if you want real names
		const name = round.winner.color === "#48f" ? "BLUE" : "RED";
		ctx.textAlign = "center";
		ctx.fillStyle = round.winner.color;
		ctx.font = '80px "Press Start 2P", monospace';
		ctx.fillText(`${name} WINS`, W / 2, H / 2);
		ctx.fillStyle = "#fff";
		ctx.font = '28px "Press Start 2P", monospace';
		ctx.fillText("PRESS R FOR REMATCH", W / 2, H / 2 + 80);
	}
}

// ---------- Level ----------
// The level being played. The title screen can change it (level select, pasted JSON); the builder's "Play"
// button saves its level to localStorage and opens the game with ?level=custom. Bad/missing saved data is ignored.
function readSavedLevel() {
	try {
		const saved = JSON.parse(localStorage.getItem("wizardball-level"));
		return isValidLevel(saved) ? saved : null;
	} catch {
		return null;
	}
}
let savedLevel = readSavedLevel(); // the title screen re-reads it each time it opens, in case the builder changed it
let LEVEL =
	savedLevel &&
	typeof location !== "undefined" &&
	new URLSearchParams(location.search).get("level") === "custom"
		? savedLevel
		: DEFAULT_LEVELS[0];

const rect = (r) => ({ pos: { x: r.x, y: r.y }, box: { w: r.w, h: r.h } });

function loadLevel(level) {
	level.walls.forEach((w, i) =>
		spawn({
			...rect(w),
			solid: true,
			look: { color: "#fff" },
			...(w.grass ? { grass: grassBlades(w.w, i) } : {}), // seeded by index: every machine grows the same grass
		}),
	);

	spawn({
		pos: { ...level.ball },
		vel: { x: 0, y: 0 },
		spawn: { ...level.ball },
		circle: { r: 22, bounce: 0.7 },
		look: { color: "#fff" },
	});

	const ids = level.players.map((p, slot) =>
		spawn({
			pos: { x: p.x, y: p.y },
			vel: { x: 0, y: 0 },
			spawn: { x: p.x, y: p.y },
			box: { w: 32, h: 48 },
			// slide: seconds left of one (slideDir its direction); held / tapDir / tapAge spot a double tap
			body: { grounded: false, bubble: null, slope: null, ...NO_SLIDE },
			spin: { a: 0 },
			anim: {
				facing: p.x < W / 2 ? 1 : -1,
				phase: 0,
				moving: false,
				air: false,
				vy: 0,
				slide: false,
			}, // for the sprite: starts facing the middle
			controls: { ...p.keys, slot },
			look: { color: p.color },
			lives: { n: 3 },
			hud: { ...p.hud },
		}),
	);

	// A goal's color is its scorer's color; `owner` is a player index, turned into that player's entity id.
	for (const g of level.goals)
		spawn({
			...rect(g),
			goal: { owner: ids[g.owner], sparks: g.sparks, shape: g.shape },
			look: { color: level.players[g.owner].color },
		});

	// Slow-mo zones are grey and belong to nobody. No `look`: invisible, the sparkles show them.
	for (const z of level.zones)
		spawn({ ...rect(z), slow: { color: "#888", shape: z.shape } });

	// Slopes have no `box`/`pos`, so the box systems ignore them; they get their own collision code.
	for (const s of level.slopes ?? [])
		spawn({ slope: { ...s, pts: slopePoints(s) }, look: { color: "#fff" } });
}
loadLevel(LEVEL);

// ---------- Loop ----------
// Fixed timestep: physics always advances in DT chunks, no matter the frame rate.
let last = performance.now(),
	acc = 0;
function frame(now) {
	acc += Math.min((now - last) / 1000, 0.1) * clock.scale; // slow-mo = fewer physics steps per real second // clamp so a background tab doesn't spiral
	last = now;
	if (net.mode === "guest") acc = 0; // the guest never simulates; it only draws what the host sends
	if (menu.open) {
		acc = 0;
		pressed.clear();
	} // title screen: world frozen, key presses don't pile up
	while (acc >= DT) {
		if (round.hit > 0) {
			// death animation: only particles move, then reset + countdown
			round.hit -= DT;
			physicsSystem(); // the victims fall, and everyone settles onto the ground
			if (round.hit > 0.4) beamSystem(); // the beam stops a moment before the animation ends
			particleSystem();
			if (round.hit <= 0) {
				resetSystem();
				if (!round.winner) round.t = 3;
			}
		} else if (round.winner) {
			// game over: wait for R, then refill lives and go again
			if (pressed.has("KeyR")) {
				for (const [, l] of query("lives")) l.n = 3;
				round.winner = null;
				round.t = 3;
			}
		} else if (round.t > 0)
			round.t -= DT; // countdown: skip every gameplay system
		else {
			fillInputs();
			controlSystem();
			physicsSystem();
			ballSystem();
			bubbleSystem();
			bubbleFadeSystem();
			goalSystem();
			slowSystem();
			effectsSystem();
			goalSparkSystem();
			particleSystem();
		}
		pressed.clear(); // jump presses are consumed by the first step
		net.remote.jump = false; // ...and so is the remote player's
		acc -= DT;
	}
	net.tick?.(); // online: host sends a snapshot, guest sends its input
	renderSystem();
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
