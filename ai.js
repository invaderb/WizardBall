// The computer opponent. It plays by filling inputs[slot] with { left, right, jump }: exactly what the keyboard and
// the network produce, so the physics can't tell it from a person.
//
// Two layers:
//   WHAT to do: a small behaviour tree, re-run from the top every time the AI "thinks". The first branch that
//     succeeds wins:
//       Defend     my goal is in danger -> get back goal-side of the ball, then clear it away from the goal
//       Get round  I'm on the wrong side of the ball -> go round it (not through it) to the side it should leave from
//       Attack     line up behind the ball, then run through it / bubble-kick it toward the goal I score in
//   HOW to get there: A* over a grid of the places the player fits, built from the level's walls, slopes and goals,
//     so it climbs onto platforms and goes round walls on any level the builder makes.
//
// Kicking: a bubble pushes the ball away from the player's center, so an air jump with the ball just ahead is a kick.
// Difficulty is how often it thinks, how well it reads where the ball is going, how often it takes a chance or
// notices a threat, and how often it blunders. Easy and Normal think a few times a second, which is what makes them
// beatable. Hard is superhuman on purpose: it thinks every step and meets the ball where it will be.

const SKILLS = {
  easy: { reaction: 0.30, lookahead: 0, intercept: false, jumpChance: 0.6, awareness: 0.4, mistake: 0.12, slide: 0 },
  normal: { reaction: 0.12, lookahead: 0.25, intercept: false, jumpChance: 0.85, awareness: 0.8, mistake: 0.03, slide: 0.3 },
  hard: { reaction: 0, lookahead: 0, intercept: true, jumpChance: 1, awareness: 1, mistake: 0, slide: 1 },
};

const aiMem = {};
function aiReset() {
  Object.assign(aiMem, { clock: 0, nextThink: 0, left: false, right: false, jump: false, lastAirJump: -1, lastX: 0, lastDir: 0, branch: '', path: [], route: null, tap: [] });
  buildNav(); // the level may have changed since the last game
}

// Called once per sim step by fillInputs() for the AI's slot.
function aiInput(slot) {
  aiMem.clock += DT;
  if (aiMem.clock >= aiMem.nextThink) {
    const skill = SKILLS[ai.skill] ?? SKILLS.normal;
    aiMem.nextThink = aiMem.clock + skill.reaction * (0.7 + Math.random() * 0.6); // jitter: not a metronome
    aiThink(slot, skill);
  }
  const input = { left: aiMem.left, right: aiMem.right, jump: aiMem.jump };
  if (aiMem.tap.length) { // playing out a double tap (see wantsSlide): this step's left/right comes from the sequence
    const t = aiMem.tap.shift();
    input.left = t < 0;
    input.right = t > 0;
  }
  aiMem.jump = false; // a jump is a one-step edge, like a key press
  return input;
}

// ---------- Where it can go: the nav grid ----------
// Node (i, j) = the player's box with its top-left corner at (i*CELL, j*CELL). Open = the box fits there without
// touching a wall, a slope or a goal (walking into a goal gap wraps you round to the far side of the arena).
// Air jumps are unlimited, so ANY open node next to another can be reached; the costs below are what make it
// prefer walking to climbing (each air jump drops a bubble) and to hanging about in mid-air.
const CELL = 24;
const PLAYER = { w: 32, h: 48 };
const nav = { cols: 0, rows: 0, open: new Uint8Array(0), floor: new Uint8Array(0), walls: [], slopes: [] };

function buildNav() {
  nav.cols = Math.floor((W - PLAYER.w) / CELL) + 1;
  nav.rows = Math.floor((H - PLAYER.h) / CELL) + 1;
  nav.open = new Uint8Array(nav.cols * nav.rows);
  nav.floor = new Uint8Array(nav.cols * nav.rows); // open, with something to stand on right below
  const boxes = [...query('pos', 'box', 'solid'), ...query('pos', 'box', 'goal')];
  const slopes = [...query('slope')].map(([, s]) => s);
  for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
    const pos = { x: i * CELL, y: j * CELL };
    nav.open[j * nav.cols + i] = !boxes.some(([, p, b]) => overlaps(pos, PLAYER, p, b))
      && !slopes.some((s) => (s.ceiling ? ceilingPen(pos, PLAYER, s) : slopePen(pos, PLAYER, s)) > 0);
  }
  for (let k = 0; k < nav.open.length - nav.cols; k++) nav.floor[k] = nav.open[k] && !nav.open[k + nav.cols];

  // For predicting the ball: the same solids as the game's centreInSolid(), collected once (they never move), so the
  // ~180 probes a prediction makes are plain loops instead of entity queries. That took Hard's thinking from ~5ms a step to well under 1.
  nav.walls = [...query('pos', 'box', 'solid')].map(([, p, b]) => ({ x0: p.x, y0: p.y, x1: p.x + b.w, y1: p.y + b.h }));
  nav.slopes = slopes.map((s) => ({ pts: s.pts, x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h }));
}

// centreInSolid() (main.js) for a static level, fast: is (x, y) inside a wall or a slope?
function solidAt(x, y) {
  for (const r of nav.walls) if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
  for (const s of nav.slopes) if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1 && inPolygon(s.pts, x, y)) return true;
  return false;
}

// The open node nearest a box top-left of (x, y), or -1 if there's none close (e.g. wrapping round off-screen).
function nodeAt(x, y) {
  const i0 = Math.round(x / CELL), j0 = Math.round(y / CELL);
  for (let r = 0; r <= 4; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; // just ring r; rows above come first, so on a floor it picks the spot standing on it
    const i = i0 + di, j = j0 + dj;
    if (i >= 0 && j >= 0 && i < nav.cols && j < nav.rows && nav.open[j * nav.cols + i]) return j * nav.cols + i;
  }
  return -1;
}

// A min-heap of [priority, node] for A*'s open set.
function heapPush(h, item) {
  h.push(item);
  for (let i = h.length - 1; i > 0;) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

const STEPS = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
// What one step costs. Up = a jump; down = just falling; sideways is cheap on the ground, dearer in the air.
function stepCost(di, dj, k, avoid) {
  let c = dj < 0 ? 2.5 : dj > 0 ? 0.8 : nav.floor[k] ? 1 : 1.6;
  if (di && dj) c *= 1.4;
  const j = Math.floor(k / nav.cols);
  if (j >= nav.rows - 2 && !nav.floor[k]) c += 30; // the bottom edge over a pit: fall out and you drop in from the top
  if (avoid && Math.hypot((k % nav.cols) * CELL + PLAYER.w / 2 - avoid.x, j * CELL + PLAYER.h / 2 - avoid.y) < avoid.r) c += 40; // all but forbidden
  return c;
}

// A* from node `from` to node `to`. `avoid` = { x, y, r }: going within r of that point costs extra (the ball, so the
// route goes round it instead of knocking it the wrong way). Returns the nodes after `from`, [] if there's no route.
function findPath(from, to, avoid = null) {
  const { cols, open } = nav;
  const g = new Float64Array(open.length).fill(Infinity), came = new Int32Array(open.length).fill(-1);
  const ti = to % cols, tj = Math.floor(to / cols);
  const h = (k) => 0.8 * Math.max(Math.abs((k % cols) - ti), Math.abs(Math.floor(k / cols) - tj)); // never overestimates: 0.8 is the cheapest step
  const heap = [[h(from), from]];
  g[from] = 0;
  while (heap.length) {
    const [f, k] = heapPop(heap);
    if (k === to) break;
    if (f > g[k] + h(k)) continue; // a stale entry: k was reached more cheaply since
    const i = k % cols, j = Math.floor(k / cols);
    for (const [di, dj] of STEPS) {
      const ni = i + di, nj = j + dj, n = nj * cols + ni;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= nav.rows || !open[n]) continue;
      if (di && dj && !(open[j * cols + ni] && open[nj * cols + i])) continue; // no cutting a corner
      const cost = g[k] + stepCost(di, dj, n, avoid);
      if (cost < g[n]) { g[n] = cost; came[n] = k; heapPush(heap, [cost + h(n), n]); }
    }
  }
  if (from !== to && came[to] < 0) return [];
  const path = [];
  for (let k = to; k !== from; k = came[k]) path.push(k);
  return path.reverse();
}

// Head for (x, y) (a point the player's CENTER should reach) along an A* route.
function goTo(bb, x, y, avoidR = 0) {
  const from = nodeAt(bb.pos.x, bb.pos.y), to = nodeAt(x - PLAYER.w / 2, y - PLAYER.h / 2);
  if (from < 0 || to < 0) { bb.dir = Math.sign(x - bb.mx); return; } // off the grid: just head that way
  // Hard thinks every step, but a route barely changes in 1/30s: reuse the last one if it's going to the same place and
  // I'm still on it (from where I am now). A* was most of the AI's cost.
  const r = aiMem.route;
  const fresh = r && r.to === to && aiMem.clock - r.at < 1 / 30;
  const along = !fresh ? -1 : from === r.from ? 0 : r.path.indexOf(from) + 1; // how far along it I am (-1 / 0 = not on it)
  if (fresh && (from === r.from || along > 0)) {
    bb.path = r.path.slice(along);
  } else {
    bb.path = findPath(from, to, avoidR ? { x: bb.bp.x, y: bb.bp.y, r: avoidR } : null);
    aiMem.route = { from, to, at: aiMem.clock, path: bb.path };
  }
  if (!bb.path.length) { bb.dir = from === to ? 0 : Math.sign(x - bb.mx); return; }
  // Aim two nodes along: steady enough not to dither, close enough not to cut a corner into a platform.
  const k = bb.path[Math.min(1, bb.path.length - 1)];
  const tx = (k % nav.cols) * CELL + PLAYER.w / 2, ty = Math.floor(k / nav.cols) * CELL + PLAYER.h / 2;
  bb.dir = Math.abs(tx - bb.mx) > 6 ? Math.sign(tx - bb.mx) : 0;
  if (ty < bb.my - 20 && (bb.body.grounded || bb.vel.y > -60)) bb.hop = true; // up: jump (again at the top of a jump, not while rising)
}

// Slide? A slide (a double tap: see controlSystem in main.js) covers ~270px at up to 900 px/s and can't be steered, so
// it's worth it on a long flat run toward a spot well beyond where the slide ends: never INTO the ball. Ploughing into it
// just shoves it along the floor (no aimed kick: measured, that cost Pongz 5 of its 6 goals) and carries me past it.
// And never when I'm going ROUND the ball and it's low down in the way.
const SLIDE_RUN = 12; // nodes (~290px, about a slide) of flat floor the route must run along, the way I'm heading
const SLIDE_ROOM = 15; // nodes (~360px): the route must go on past where the slide ends
function wantsSlide(bb) {
  const b = bb.body;
  if (!bb.dir || !b.grounded || b.slide > 0 || b.slideCool > 0 || bb.path.length < SLIDE_ROOM) return false;
  const start = nodeAt(bb.pos.x, bb.pos.y);
  if (start < 0) return false;
  const row = Math.floor(start / nav.cols);
  for (let n = 0; n < SLIDE_RUN; n++) {
    const k = bb.path[n];
    if (Math.floor(k / nav.cols) !== row || !nav.floor[k] || Math.sign((k % nav.cols) - (start % nav.cols)) !== bb.dir) return false;
  }
  const goingRound = bb.branch === 'get round' || bb.branch === 'defend: get back';
  const ahead = (bb.bp.x - bb.mx) * bb.dir;
  return !(goingRound && ahead > 0 && ahead < 350 && Math.abs(bb.bp.y - bb.my) < 120);
}

// ---------- What to do: the behaviour tree ----------
// Every node is a function of the blackboard `bb` that succeeds (true) or fails (false).
//   selector: try children in order until one succeeds.   sequence: run children in order while they succeed.
// The tree is re-run from the top every think, so no node needs a "running" state: the world moves too fast for plans.
const selector = (...kids) => (bb) => kids.some((k) => k(bb));
const sequence = (...kids) => (bb) => kids.every((k) => k(bb));
const action = (name, fn) => (bb) => { bb.branch = name; fn(bb); return true; };

// Conditions
// My goal is in danger: the ball is close to it, or on its way there, or the opponent has it in my half.
// TODO: this only measures how close the ball is to a goal SIDEWAYS, so a goal the ball lands on (Floor is Lava: each
// half of the floor is one) never looks threatened. Use where predictBall says it will land. (README: Computer opponent)
function threatened(bb) {
  if (!bb.guard) return false;
  const toGoal = Math.sign(bb.guard.x - bb.bp.x) || 1; // which way the ball must travel to go in
  const gap = Math.abs(bb.guard.x - bb.bx);
  const close = gap < 450;
  const incoming = gap < 700 && bb.bv.x * toGoal > 150;
  const near = (p) => Math.hypot(p.x - bb.bp.x, p.y - bb.bp.y);
  const theyHaveIt = bb.them && near(bb.them) < 200 && near(bb.them) < near({ x: bb.mx, y: bb.my })
    && (bb.them.x - bb.bp.x) * toGoal < 0 // ...from the far side, so they can push it toward my goal
    && gap < W / 2;
  return (close || incoming || theyHaveIt) && Math.random() < bb.skill.awareness; // a weaker player doesn't always notice
}
const playAway = (bb) => { bb.want = -Math.sign(bb.guard.x - bb.bp.x) || 1; return true; }; // clear it away from my goal
const wrongSide = (bb) => (bb.bp.x - bb.mx) * bb.want <= 0; // the ball isn't in front of me in the direction it should go

// Actions
// Get round the ball to the side it should be played from, keeping clear of it on the way.
function goRound(bb) {
  goTo(bb, bb.bx - bb.want * 90, bb.by, 110);
  // An air jump drops a bubble (r 50) at my center, and one touching the ball (r 22) kicks it, from this side the WRONG
  // way: done over and over, that herds it the length of the pitch into my own goal. The route above already arcs
  // round out of reach; if I'm still within touching range, no air jump (a ground hop drops no bubble).
  if (!bb.body.grounded && Math.hypot(bb.bp.x - bb.mx, bb.bp.y - bb.my) < 85) bb.hop = false;
}

// Which way to kick the ball, as a unit vector. A kick leaves at about KICK px/s and falls under the same 900 px/s²
// gravity as everything else, so when attacking and in range it's the low arc that lands in the goal; out of range,
// or when clearing, it's a low shot along the way the ball should go (it rolls on from there).
// TODO: when no kick can reach the goal (it's raised or floating: Rise and Shine), the low roll below just runs the ball
// along the floor underneath it. Lift it instead: kick it up, follow it, kick again from below. (README: Computer opponent)
const KICK = 550, GRAVITY = 900;
function aimAt(bb) {
  const goal = bb.want === bb.d ? bb.target : null;
  if (goal) {
    const X = Math.abs(goal.x - bb.bx), Y = bb.by - goal.y; // Y: how far the goal is ABOVE the ball
    const disc = KICK ** 4 - GRAVITY * (GRAVITY * X * X + 2 * Y * KICK * KICK);
    if (X > 1 && disc >= 0) {
      const a = Math.atan((KICK * KICK - Math.sqrt(disc)) / (GRAVITY * X));
      return { x: bb.want * Math.cos(a), y: -Math.sin(a) };
    }
  }
  return { x: bb.want * Math.cos(0.2), y: -Math.sin(0.2) };
}

// On the right side: get to the spot just behind the ball on the line I want to kick it along, then kick. An air jump
// drops a bubble at my center, and the bubble knocks the ball straight away from it: along that line. From the ground,
// hop first (a ground jump drops no bubble) and kick on the way up.
function drive(bb) {
  const aim = aimAt(bb);
  const spot = { x: bb.bx - aim.x * 55, y: bb.by - aim.y * 55 };
  const dx = bb.bp.x - bb.mx, dy = bb.bp.y - bb.my, dist = Math.hypot(dx, dy);
  if (dist > 110 || dy < -200) goTo(bb, spot.x, spot.y, 60); // far, or up on a platform: go there, round the ball
  else bb.dir = dx * bb.want > 20 ? bb.want : Math.sign(spot.x - bb.mx); // close: press in, or back off if I'm level with / past it
  const lined = dist > 0 && (dx * aim.x + dy * aim.y) / dist > 0.85; // the ball sits along the aim line from me
  if (!bb.body.grounded && dist < 70 && lined) bb.strike = true; // in reach and lined up: kick
  else if (bb.body.grounded && dist < 110 && dx * bb.want > 0 && (lined || dy < -30)) { bb.strike = true; bb.combo = true; } // hop, to kick on the way up
}

const TREE = selector(
  sequence(threatened, playAway, selector(
    sequence(wrongSide, action('defend: get back', goRound)),
    action('defend: clear', drive),
  )),
  sequence(wrongSide, action('get round', goRound)),
  action('attack', drive),
);

// ---------- Thinking ----------
// What the tree reads (the world, from my point of view) and writes (dir / hop / strike).
function blackboard(slot, skill) {
  const players = [...query('pos', 'box', 'vel', 'body', 'controls')];
  const me = players.find((e) => e[5].slot === slot), them = players.find((e) => e[5].slot !== slot);
  const ball = [...query('pos', 'vel', 'circle')][0]; // bubbles have no vel, so this is the ball
  if (!me || !ball) return null;
  const [myId, pos, box, vel, body] = me;
  const [, bp, bv, circle] = ball;
  const mx = pos.x + box.w / 2, my = pos.y + box.h / 2;

  // Where to play the ball: where it IS (easy), where it will be shortly (normal), or (hard) the first point on its
  // flight I can get to in time. Which side of the ball I'm on uses where it is; the prediction is for lining up.
  const flight = predictBall(bp, bv, circle.r);
  const reachable = (p) => Math.abs(p.x - mx) / 450 + Math.max(0, my - p.y) / 500 <= p.t; // run at 450 px/s; climbing is slower
  const at = skill.intercept ? flight.find(reachable) ?? flight.at(-1) : skill.lookahead ? flight[Math.round(skill.lookahead * 30) - 1] : bp;
  const bx = Math.max(40, Math.min(W - 40, at.x)), by = at.y;

  // Goals come from the level. A goal is "mine" if I score in it; I guard the others. x/y = the middle of its mouth.
  const goals = [...query('pos', 'box', 'goal')].map(([, p, b, g]) => ({ x: Math.max(0, Math.min(W, p.x + b.w / 2)), y: p.y + b.h / 2, mine: g.owner === myId }));
  const nearest = (gs) => gs.reduce((best, g) => (!best || Math.abs(g.x - bx) < Math.abs(best.x - bx) ? g : best), null);
  const target = nearest(goals.filter((g) => g.mine));
  const d = Math.sign((target ? target.x : W / 2) - bx) || 1;

  return {
    skill, pos, vel, body, mx, my, bp, bv, bx, by, target, d,
    guard: nearest(goals.filter((g) => !g.mine)),
    them: them && { x: them[1].x + them[2].w / 2, y: them[1].y + them[2].h / 2 },
    want: d, // the way the ball should go; Defend changes it
    dir: 0, hop: false, strike: false, combo: false, branch: '', path: [],
  };
}

// The ball's flight for the next 1.5s, a point every 1/30s: gravity, and bounces off walls and slopes the way the game
// does them (roughly). Players and bubbles in the way are ignored: they're what make it unpredictable anyway.
function predictBall(bp, bv, r) {
  const out = [], dt = 1 / 60;
  let { x, y } = bp, vx = bv.x, vy = bv.y;
  for (let i = 1; i <= 90; i++) {
    vy += GRAVITY * dt;
    if (solidAt(x + vx * dt + Math.sign(vx) * r, y)) vx *= -0.7; else x += vx * dt;
    if (solidAt(x, y + vy * dt + Math.sign(vy) * r)) vy = Math.abs(vy) < 30 ? 0 : vy * -0.7; else y += vy * dt;
    if (i % 2 === 0) out.push({ t: i * dt, x, y });
  }
  return out;
}

function aiThink(slot, skill) {
  const bb = blackboard(slot, skill);
  if (!bb) return;
  TREE(bb);
  aiMem.branch = bb.branch;
  aiMem.path = bb.path;
  // Slide along the way if it helps: let go, tap, let go, then the held direction below is the second press.
  if (!aiMem.tap.length && wantsSlide(bb) && Math.random() < skill.slide) aiMem.tap = [0, 0, bb.dir, bb.dir, 0, 0];

  // Blocked by a wall or a ledge (wanted to move last time too, but hasn't): hop.
  // (Not while a double tap is playing out: its brief let-go stops me on purpose.)
  if (!aiMem.tap.length && bb.dir !== 0 && aiMem.lastDir !== 0 && bb.body.grounded && Math.abs(bb.pos.x - aiMem.lastX) < 1) bb.hop = true;
  aiMem.lastX = bb.pos.x;

  if (bb.strike && Math.random() > skill.jumpChance) bb.strike = false; // a weaker player misses some chances
  if (Math.random() < skill.mistake) bb.dir = Math.floor(Math.random() * 3) - 1; // ...and sometimes just blunders
  if ((bb.mx < 70 && bb.dir < 0) || (bb.mx > W - 70 && bb.dir > 0)) bb.dir = 0; // don't follow the ball out through a goal gap
  aiMem.lastDir = bb.dir;

  // No bubble spam: air jumps (each drops a bubble) at most every 0.3s. Ground jumps drop none, so they're free.
  const jump = (bb.hop || bb.strike) && (bb.body.grounded || aiMem.clock - aiMem.lastAirJump > 0.3);
  aiMem.left = bb.dir < 0;
  aiMem.right = bb.dir > 0;
  if (jump) {
    aiMem.jump = true;
    if (!bb.body.grounded) aiMem.lastAirJump = aiMem.clock;
    // A hop to kick on the way up: the kick has to come a moment later, while the ball is still in line, so look again then.
    if (bb.combo && bb.body.grounded) aiMem.nextThink = Math.min(aiMem.nextThink, aiMem.clock + 2 * DT);
  }
}
