// Touch controls for phones and tablets: a joystick on the left half of the screen (it centres wherever your thumb lands),
// jump at the bottom right, and a menu button (phones have no Esc key) at the top left. They hold the pseudo-keys in
// main.js's TOUCH in the same down / pressed sets the keyboard uses, so everything that reads keys works with them
// unchanged: aimed air jumps, playing the computer, online, and the slide (a double flick: flick the stick to one side,
// let it come back to the middle, flick again). The controls are only shown on touch screens (CSS), and only in a game:
// the title screen sits on top of them.
//
// Every finger is looked at on every change, not one at a time, so you can hold the stick while tapping jump.

const stick = { id: null, x: 0, y: 0 }; // the finger on the stick (a touch identifier), and where it went down: the stick's middle
let touchHeld = new Set(); // what's held right now: 'left' | 'right' | 'up' | 'down' (the stick) and 'jump'
const stickEl = document.getElementById('touch-stick');

// The stick's 8 ways: a push past the dead zone, rounded to the nearest 45 degrees.
function stickDirs(dx, dy) {
  if (Math.hypot(dx, dy) < (stickEl.offsetWidth || 100) * 0.15) return [];
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const x = Math.round(Math.cos(a)), y = Math.round(Math.sin(a));
  return [x < 0 && 'left', x > 0 && 'right', y < 0 && 'up', y > 0 && 'down'].filter(Boolean);
}

// Draw the stick where the thumb went down, its knob pushed toward the thumb; back at its resting place when let go.
function drawStick(dx, dy) {
  const on = stick.id !== null, r = (stickEl.offsetWidth || 100) * 0.35, d = Math.hypot(dx, dy), k = d > r ? r / d : 1;
  stickEl.classList.toggle('on', on);
  stickEl.style.left = on ? `${stick.x}px` : '';
  stickEl.style.top = on ? `${stick.y}px` : '';
  stickEl.firstElementChild.style.transform = on ? `translate(${dx * k}px, ${dy * k}px)` : '';
}

function touchUpdate(touches) {
  const now = new Set();
  let thumb = null; // the stick's finger, if it's still down
  for (const t of touches) {
    if (t.identifier === stick.id) { thumb = t; continue; }
    // what's under the finger, else what it went down on: Firefox for Android's bottom toolbar can offset
    // elementFromPoint from what you see, which made the bottom buttons miss
    const button = document.elementFromPoint(t.clientX, t.clientY)?.closest?.('[data-touch]') ?? t.target?.closest?.('[data-touch]');
    if (button) { if (button.dataset.touch === 'jump') now.add('jump'); continue; }
    if (stick.id === null && !thumb && t.clientX < innerWidth / 2) { // a new thumb on the left half: the stick centres on it
      Object.assign(stick, { id: t.identifier, x: t.clientX, y: t.clientY });
      thumb = t;
    }
  }
  if (!thumb) stick.id = null;
  const dx = thumb ? thumb.clientX - stick.x : 0, dy = thumb ? thumb.clientY - stick.y : 0;
  for (const d of stickDirs(dx, dy)) now.add(d);
  for (const b of now)
    if (!touchHeld.has(b)) { // a fresh press
      down.add(TOUCH[b]);
      pressed.add(TOUCH[b]);
      if (b === 'jump' && round.winner) pressed.add('KeyR'); // game over: jump is "rematch"
    }
  for (const b of touchHeld) if (!now.has(b)) down.delete(TOUCH[b]);
  touchHeld = now;
  for (const el of document.querySelectorAll('[data-touch]')) el.classList.toggle('on', now.has(el.dataset.touch));
  drawStick(dx, dy);
}

// Let go of everything (the title screen opened, say, with a finger still down).
function touchRelease() {
  for (const b of touchHeld) down.delete(TOUCH[b]);
  touchHeld = new Set();
  stick.id = null;
  for (const el of document.querySelectorAll('[data-touch]')) el.classList.remove('on');
  drawStick(0, 0);
}

for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
  addEventListener(type, (e) => {
    if (menu.open) { if (touchHeld.size || stick.id !== null) touchRelease(); return; } // the title screen takes touches normally (taps, scrolling)
    if (e.target?.closest?.('[data-touch="menu"]')) return; // left alone so the browser makes it a click (below)
    e.preventDefault(); // in a game: no scrolling, zooming or long-press menus
    touchUpdate(e.touches);
  }, { passive: false });

// The menu button is a plain click, like the title screen's buttons: on iPhones (Safari and Firefox) it did nothing
// when pressed from the touch handler above, while ordinary buttons always worked.
for (const el of document.querySelectorAll('[data-touch]'))
  if (el.dataset.touch === 'menu') el.onclick = () => { touchRelease(); backToMenu(); };

// Belt and braces for what preventDefault on touches doesn't stop everywhere: pinch zoom (Safari's gesture events),
// and in a game, text selection and long-press menus (Firefox for Android's select / search / find-in-page bar).
for (const type of ['gesturestart', 'gesturechange']) addEventListener(type, (e) => e.preventDefault(), { passive: false });
for (const type of ['selectstart', 'contextmenu']) addEventListener(type, (e) => { if (!menu.open) e.preventDefault(); });
