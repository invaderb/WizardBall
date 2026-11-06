// Player sprites: little wizards drawn as line art, with no image files. Everything is relative to the
// CENTER of the 32 x 48 hitbox, so the game's somersault (ctx.rotate around that center) just works.
// Shared by the game and the level builder.
//
// `pose` is the game's `anim` component: { facing: 1 | -1, moving, air, phase (0..1 run cycle), vy, slide }.
// `time` only drives the idle breathing, so it can come from the wall clock: it never affects gameplay.
//
// The body is filled black with an outline (white for everyone, or the player's color: see WIZARD_OUTLINE), so it hides whatever is behind it (bubbles, grass).
// Standing and running it's a full wizard; in the air (when it somersaults) it curls into a tight ball; sliding
// (a double tap on the ground) it leans back with its feet out in front.
// With `pose.dead` (0 -> 1 through the death animation) it arches backward, red-outlined, and topples over.

// Outline color for every wizard. Set to null to outline each one in its player's color instead.
const WIZARD_OUTLINE = '#fff';
// Dying wizards are outlined in red, whatever their player color.
const DEATH_OUTLINE = '#f33';
const WIZARD_SCALE = 1.2; // drawn a bit bigger than the hitbox, which doesn't change
const WIZARD_GROUND = 24 - 23 * WIZARD_SCALE; // lifts the sprite so its feet (y = 23 before scaling) still land on the hitbox bottom

function drawWizard(ctx, color, pose, time = 0) {
  const f = pose.facing || 1;
  const cycle = pose.phase * Math.PI * 2;
  const swing = pose.moving ? Math.sin(cycle) : 0; // -1..1 through the run cycle
  const fall = pose.air ? Math.max(-1, Math.min(1, pose.vy / 600)) : 0; // -1 rising ... +1 falling
  const dead = pose.dead || 0;
  const bob = pose.moving || pose.air || pose.slide || dead > 0 ? 0 : Math.sin(time / 350) * 1.2; // idle breathing

  ctx.save();
  if (dead > 0) { // falling over backwards, pivoting on the feet (the bottom of the hitbox): slowly at first, then faster
    const topple = Math.min(1, dead / 0.55);
    ctx.translate(0, 24);
    ctx.rotate(-f * (Math.PI / 2) * 0.97 * topple * topple);
    ctx.translate(0, -24);
  }
  // The tucked ball is centered on the hitbox (so the somersault pivots around it); the standing wizard is lifted so its feet stay on the ground.
  ctx.translate(0, bob + (pose.air ? 0 : WIZARD_GROUND));
  ctx.scale(WIZARD_SCALE, WIZARD_SCALE);
  const line = dead > 0 ? DEATH_OUTLINE : (WIZARD_OUTLINE ?? color);
  ctx.strokeStyle = ctx.fillStyle = line;
  ctx.lineWidth = 2.5;
  ctx.lineCap = ctx.lineJoin = 'round';
  const solid = () => { ctx.fillStyle = '#000'; ctx.fill(); ctx.fillStyle = line; ctx.stroke(); }; // black fill, outlined
  const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); solid(); };
  const foot = (x, y) => { ctx.beginPath(); ctx.moveTo(x - 2.5, y); ctx.lineTo(x + 2.5, y); ctx.stroke(); };

  // Hat: a floppy cone whose tip trails behind when moving and flutters up when falling. Drawn from the
  // top of the head (`base` = the brim's height), the same way in both poses.
  const hat = (base, halfBrim, tipX, tipY) => {
    ctx.beginPath();
    ctx.moveTo(-halfBrim + 2.5, base);
    ctx.quadraticCurveTo(tipX * 0.3 - 2, base - 8, tipX, tipY);
    ctx.quadraticCurveTo(tipX * 0.3 + 4, base - 7, halfBrim - 2.5, base);
    ctx.closePath();
    solid();
    ctx.beginPath();
    ctx.moveTo(-halfBrim, base);
    ctx.lineTo(halfBrim, base);
    ctx.stroke();
  };

  // Arched backward: belly pushed forward, shoulders and head thrown back, arms flung up, hat knocked off,
  // X eyes. The arch builds quickly (the first quarter of the animation); the topple above does the rest.
  const drawDead = () => {
    const arch = Math.min(1, dead / 0.25);
    const lerp = (a, b) => a + (b - a) * arch;
    // Robe as 6 points (top-left, top-right, mid-right, hem-right, hem-left, mid-left), standing -> arched.
    const standing = [[-6, -2], [6, -2], [8.5, 8], [11, 18], [-11, 18], [-8.5, 8]];
    const arched = [[-14, -2], [-2, -2], [16, 7], [11, 18], [-11, 18], [0, 7]];
    ctx.beginPath();
    standing.forEach(([x, y], i) => {
      const px = f * lerp(x, arched[i][0]), py = lerp(y, arched[i][1]);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.closePath();
    solid();
    foot(-4, 23);
    foot(4, 23);
    ctx.beginPath(); // arms flung up and back
    ctx.moveTo(f * lerp(3, -9), lerp(0, -1));
    ctx.lineTo(f * lerp(9, -19), lerp(4, -11));
    ctx.moveTo(f * lerp(-3, -12), 0);
    ctx.lineTo(f * lerp(-9, -22), lerp(4, -4));
    ctx.stroke();
    const hx = f * lerp(0, -13), hy = lerp(-9, -3); // head thrown back
    circle(hx, hy, 5.5);
    const ex = hx + f * 2.5, ey = hy - 0.5; // an X for an eye
    ctx.beginPath();
    ctx.moveTo(ex - 1.4, ey - 1.4); ctx.lineTo(ex + 1.4, ey + 1.4);
    ctx.moveTo(ex - 1.4, ey + 1.4); ctx.lineTo(ex + 1.4, ey - 1.4);
    ctx.stroke();
    ctx.save(); // the hat flies off forward and tumbles
    ctx.translate(f * 16 * arch, -12 * arch);
    ctx.rotate(f * arch);
    hat(-13, 9, -f * 3, -27);
    ctx.restore();
  };

  if (dead > 0) drawDead();
  else if (pose.air) {
    // Tucked: knees to chest, arms wrapped round them. A ball with the head and hat poking out.
    circle(0, 2, 11);
    ctx.beginPath(); // arms and knees: a curve across the lower half of the ball
    ctx.arc(0, 3, 6.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    foot(-3.5, 13);
    foot(3.5, 13);
    circle(f * 2, -7, 5);
    ctx.beginPath();
    ctx.arc(f * 4, -7.5, 1.1, 0, Math.PI * 2); // the eye shows which way it's facing
    ctx.fill();
    hat(-11, 6.5, -f * 7, -19 - fall * 2);
  } else if (pose.slide) {
    // Sliding feet first: leaning back on one hand, legs out in front along the ground, hat blown back.
    ctx.beginPath(); // the robe, stretched from the shoulders (back and up) to a hem along the ground
    ctx.moveTo(f * -13, 4);
    ctx.lineTo(f * -5, 1);
    ctx.lineTo(f * 7, 15);
    ctx.lineTo(f * 12, 21);
    ctx.lineTo(f * -9, 21);
    ctx.closePath();
    solid();
    foot(f * 16, 22);
    foot(f * 11, 23);
    ctx.beginPath(); // the back arm, its hand on the ground
    ctx.moveTo(f * -9, 7);
    ctx.lineTo(f * -16, 21);
    ctx.stroke();
    circle(f * -12, -4, 5.5);
    ctx.beginPath();
    ctx.arc(f * -9, -4.5, 1.1, 0, Math.PI * 2); // the eye still looks the way it's going
    ctx.fill();
    ctx.save(); // the hat, tipped back about the head and streaming out behind
    ctx.translate(f * -12, -4);
    ctx.rotate(-f * 0.4);
    hat(-4, 9, -f * 10, -17);
    ctx.restore();
  } else {
    // Robe: a trapezoid whose hem sways as you run.
    const hem = swing * 2.5;
    ctx.beginPath();
    ctx.moveTo(-6, -2);
    ctx.lineTo(6, -2);
    ctx.lineTo(11 + hem, 18);
    ctx.lineTo(-11 + hem, 18);
    ctx.closePath();
    solid();

    // Feet: they alternate while running.
    const c = pose.moving ? Math.cos(cycle) : 0;
    foot(-4 + swing * 5, 23 - 3 * Math.max(0, c));
    foot(4 - swing * 5, 23 - 3 * Math.max(0, -c));

    // Arm: pumps while running.
    ctx.beginPath();
    ctx.moveTo(f * 3, 0);
    ctx.lineTo(f * 9, 4 - swing * 2);
    ctx.stroke();

    // Head, eye, hat.
    circle(0, -9, 5.5);
    ctx.beginPath();
    ctx.arc(f * 3, -9.5, 1.1, 0, Math.PI * 2);
    ctx.fill();
    hat(-13, 9, -f * (3 + (pose.moving ? 5 : 0)), -27 - fall * 3);
  }

  ctx.restore();
}
