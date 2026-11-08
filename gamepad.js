// Controllers (the Gamepad API): controller 1 plays blue, controller 2 red (vs the computer or online, either one plays
// you). Left stick (8 ways, like the touch stick) or d-pad to move and aim air jumps, A / Cross to jump, Start for the
// menu. A controller presses its player's keyboard keys in the same down / pressed sets, so everything that reads keys
// works with it unchanged: aimed jumps, the slide (a double flick), online, rematch. Browsers only report a controller
// once a button on it has been pressed.
// shortcut: a controller letting go of a key lets go of it for the keyboard too, if both were holding it at once; track
// who holds what if that ever bites.

const PAD_DEAD = 0.35; // stick dead zone (0..1): worn sticks rest a little off centre
const padHeld = []; // per controller: the key codes it's holding
const padStart = []; // per controller: Start was down last poll (it acts on the press)

// The stick's 8 ways: past the dead zone, rounded to the nearest 45 degrees (y is down, as on screen).
function padDirs(x, y) {
  if (Math.hypot(x, y) < PAD_DEAD) return [];
  const a = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
  const dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a));
  return [dx < 0 && 'left', dx > 0 && 'right', dy < 0 && 'up', dy > 0 && 'down'].filter(Boolean);
}

function padPoll() {
  const pads = navigator.getGamepads?.() ?? [];
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i], button = (n) => !!pad?.buttons[n]?.pressed;
    const keys = [...query('controls')].find(([, c]) => c.slot === i)?.[1];
    const now = new Set();
    if (pad && keys && !menu.open) { // (the title screen: let go of everything)
      const dirs = new Set(padDirs(pad.axes[0] ?? 0, pad.axes[1] ?? 0));
      [[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']].forEach(([n, d]) => button(n) && dirs.add(d)); // the d-pad (standard layout)
      for (const d of dirs) if (keys[d]) now.add(keys[d]);
      if (button(0)) now.add(keys.jump);
    }
    const before = padHeld[i] ?? new Set();
    for (const k of now)
      if (!before.has(k)) { // a fresh press
        down.add(k);
        pressed.add(k);
        if (k === keys.jump && round.winner) pressed.add('KeyR'); // game over: jump is "rematch"
      }
    for (const k of before) if (!now.has(k)) down.delete(k);
    padHeld[i] = now;
    if (button(9) && !padStart[i] && !menu.open) backToMenu();
    padStart[i] = button(9);
  }
  requestAnimationFrame(padPoll);
}
requestAnimationFrame(padPoll);
