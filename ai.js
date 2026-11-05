// A rule-based computer opponent. It plays by filling inputs[slot] with { left, right, jump }: exactly
// what the keyboard and the network produce, so the physics can't tell it from a person.
//
// The whole idea: stand on the FAR side of the ball from where it should go, then run (or air-jump)
// through it. A bubble pushes the ball away from the player's center, so jumping in the air with the
// ball just ahead of you is a kick toward the goal.
//
//   1. d = which way the ball should travel (-1 left / +1 right): toward a goal it scores in, or away
//      from a goal it has to defend when the ball gets close to one.
//   2. Ball AHEAD of it in direction d (good side): line up just behind it, then drive through it.
//      Ball high: jump for it. In the air with the ball close and ahead: jump again to pop a bubble.
//   3. Ball BEHIND it (wrong side): run back around it, hopping over it.
//   4. Ball resting on a platform above it: climb up beside the platform (chaining air jumps, which
//      are unlimited), then drift over onto it and carry on from rule 2.
//
// It decides a few times a second (not every step), which is what makes it beatable. Difficulty is
// how fast it reacts, whether it leads the ball, how often it takes a strike, and how often it blunders.

const SKILLS = {
  easy: { reaction: 0.30, lookahead: 0, jumpChance: 0.6, mistake: 0.12 },
  normal: { reaction: 0.14, lookahead: 0.25, jumpChance: 0.85, mistake: 0.03 },
  hard: { reaction: 0.06, lookahead: 0.4, jumpChance: 1, mistake: 0 },
};

const aiMem = {};
function aiReset() {
  Object.assign(aiMem, { clock: 0, nextThink: 0, left: false, right: false, jump: false, lastJump: -1, lastX: 0, climbing: false });
}
aiReset();

// Called once per sim step by fillInputs() for the AI's slot.
function aiInput(slot) {
  aiMem.clock += DT;
  if (aiMem.clock >= aiMem.nextThink) {
    const skill = SKILLS[ai.skill] ?? SKILLS.normal;
    aiMem.nextThink = aiMem.clock + skill.reaction * (0.7 + Math.random() * 0.6); // jitter: not a metronome
    aiThink(slot, skill);
  }
  const input = { left: aiMem.left, right: aiMem.right, jump: aiMem.jump };
  aiMem.jump = false; // a jump is a one-step edge, like a key press
  return input;
}

// The solid the ball is resting on, if any (so the AI knows when the ball is on a platform).
function ballSupport(bp, r) {
  for (const [, p, b] of query('pos', 'box', 'solid'))
    if (bp.x >= p.x && bp.x <= p.x + b.w && Math.abs(p.y - (bp.y + r)) < 12) return { x: p.x, y: p.y, w: b.w };
  return null;
}

const nearestTo = (goals, x) => goals.reduce((best, g) => (!best || Math.abs(g.x - x) < Math.abs(best.x - x) ? g : best), null);

function aiThink(slot, skill) {
  const me = [...query('pos', 'box', 'vel', 'body', 'controls')].find((e) => e[5].slot === slot);
  const ball = [...query('pos', 'vel', 'circle')][0]; // bubbles have no vel, so this is the ball
  if (!me || !ball) return;
  const [myId, pos, box, vel, body] = me;
  const [, bp, bv, circle] = ball;
  const mx = pos.x + box.w / 2, my = pos.y + box.h / 2;

  // Where the ball will be shortly. No bounces: good enough, and being wrong is part of being beatable.
  const t = skill.lookahead;
  const bx = Math.max(40, Math.min(W - 40, bp.x + bv.x * t));
  const by = Math.min(954, bp.y + bv.y * t + 450 * t * t);

  // Goals come from the level, so this works on any level you build. A goal is "mine" if I score in it.
  const goals = [...query('pos', 'box', 'goal')].map(([, p, b, g]) => ({ x: p.x + b.w / 2, mine: g.owner === myId }));
  const attack = nearestTo(goals.filter((g) => g.mine), bx);
  const defend = nearestTo(goals.filter((g) => !g.mine), bx);
  let d = attack ? Math.sign(attack.x - bx) : Math.sign(W / 2 - bx);
  if (defend && Math.abs(defend.x - bx) < 450) d = -Math.sign(defend.x - bx); // ball near a goal I guard: knock it away
  if (d === 0) d = 1;

  // Which side of the ball I'm really on, and how close, uses where it IS. The prediction (bx, by) is only
  // for lining up: a ball rolling away is "predicted" far ahead, which hid it from the hop check below and
  // had the AI chasing it for seconds, nudging it into its own goal.
  const dx = bp.x - mx;
  const ahead = dx * d > 0; // the ball is in front of me in the direction it should go: I'm on the good side
  const dist = Math.hypot(bp.x - mx, bp.y - my);
  let dir = 0, hop = false, strike = false;

  // Ball resting on a platform above my feet: I can't hit it from underneath (I'd just bump my head), so
  // I climb first. `climbing` stays on (even once I'm higher than the ball) until I'm standing on the platform.
  const support = bv.y < 40 ? ballSupport(bp, circle.r) : null;
  const feet = pos.y + box.h;
  if (support && feet > support.y + 30) aiMem.climbing = true;
  if (!support || (body.grounded && feet <= support.y + 4 && mx >= support.x && mx <= support.x + support.w)) aiMem.climbing = false;

  if (aiMem.climbing && support) {
    const stageX = Math.max(70, Math.min(W - 70, d < 0 ? support.x + support.w + 40 : support.x - 40)); // behind the ball, outside the platform
    if (feet > support.y + 100) { // still low: line up beside the platform and start jumping up it
      if (Math.abs(mx - stageX) > 24) dir = Math.sign(stageX - mx);
      if (Math.abs(mx - stageX) <= 40) strike = true;
    } else { // near the top: drift over and land BESIDE the ball, never on top of it
      const landX = bx - d * 70; // (landing on a ball squeezes it sideways, at a random speed and direction)
      dir = Math.abs(landX - mx) > 16 ? Math.sign(landX - mx) : 0;
      if (feet > support.y - 6) strike = true; // still below the top: keep jumping
    }
    if (strike && !body.grounded && vel.y < -30) strike = false; // jump again at the top of a jump, not while rising
  } else if (ahead) {
    dir = Math.abs(dx) > 160 ? Math.sign(bx - d * 40 - mx) : d; // far: line up behind where it's going. close: drive through it
    if (body.grounded && bp.y < my - 50 && Math.abs(dx) < 90) strike = true;        // ball over my head: jump for it
    if (!body.grounded && dist < 78 && dx * d > 0.7 * dist) strike = true;          // airborne, ball close and roughly LEVEL, ahead: bubble kick sideways
  } else {
    dir = -d; // wrong side: get back around it...
    if (Math.abs(dx) < 150) {
      if (body.grounded && bp.y > my - 100) hop = true; // ...hopping over it (running into it from here would knock it the wrong way)
      else if (Math.abs(dx) < 110) dir = -Math.sign(dx); // ball up in the air next to me: back off and let it land, don't walk under it
    }
  }

  // Blocked by a wall or a ledge (not moving though it wants to): hop.
  if (dir !== 0 && body.grounded && Math.abs(pos.x - aiMem.lastX) < 1) hop = true;
  aiMem.lastX = pos.x;

  if (strike && Math.random() > skill.jumpChance) strike = false; // a weaker player misses some chances
  if (Math.random() < skill.mistake) dir = Math.floor(Math.random() * 3) - 1; // ...and sometimes just blunders
  if ((mx < 70 && dir < 0) || (mx > W - 70 && dir > 0)) dir = 0; // don't wander out through a goal gap

  const jump = (hop || strike) && aiMem.clock - aiMem.lastJump > 0.3; // no jump spam: each air jump drops a bubble
  aiMem.left = dir < 0;
  aiMem.right = dir > 0;
  if (jump) { aiMem.jump = true; aiMem.lastJump = aiMem.clock; }
}
