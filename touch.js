// Touch controls for phones and tablets: left / right at the bottom left, jump at the bottom right, and a menu button
// (phones have no Esc key) at the top left. They hold the pseudo-keys in main.js's TOUCH in the same down / pressed
// sets the keyboard uses, so everything that reads keys works with them unchanged: playing the computer, online,
// and the double-tap slide. The buttons are only shown on touch screens (CSS), and only in a game: the title screen
// sits on top of them.
//
// Every finger is looked at on every change, not one button at a time, so you can hold a direction while tapping
// jump, and slide a finger from left to right without lifting it.

let touchHeld = new Set(); // the buttons ('left' | 'right' | 'jump' | 'menu') under a finger right now

function touchUpdate(touches) {
  const now = new Set();
  for (const t of touches) {
    // what's under the finger now (so it can slide between buttons), else the button it went down on: Firefox for
    // Android's bottom toolbar can offset elementFromPoint from what you see, which made the bottom buttons miss
    const button = document.elementFromPoint(t.clientX, t.clientY)?.closest?.('[data-touch]') ?? t.target?.closest?.('[data-touch]');
    if (button) now.add(button.dataset.touch);
  }
  for (const b of now)
    if (!touchHeld.has(b)) { // a fresh press
      if (b === 'menu') { touchRelease(); return backToMenu(); }
      down.add(TOUCH[b]);
      pressed.add(TOUCH[b]);
      if (b === 'jump' && round.winner) pressed.add('KeyR'); // game over: jump is "rematch"
    }
  for (const b of touchHeld) if (!now.has(b)) down.delete(TOUCH[b]);
  touchHeld = now;
  for (const el of document.querySelectorAll('[data-touch]')) el.classList.toggle('on', now.has(el.dataset.touch));
}

// Let go of everything (the title screen opened, say, with a finger still down).
function touchRelease() {
  for (const b of touchHeld) down.delete(TOUCH[b]);
  touchHeld = new Set();
  for (const el of document.querySelectorAll('[data-touch]')) el.classList.remove('on');
}

for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
  addEventListener(type, (e) => {
    if (menu.open) { if (touchHeld.size) touchRelease(); return; } // the title screen takes touches normally (taps, scrolling)
    e.preventDefault(); // in a game: no scrolling, zooming or long-press menus
    touchUpdate(e.touches);
  }, { passive: false });

// Belt and braces for what preventDefault on touches doesn't stop everywhere: pinch zoom (Safari's gesture events),
// and in a game, text selection and long-press menus (Firefox for Android's select / search / find-in-page bar).
for (const type of ['gesturestart', 'gesturechange']) addEventListener(type, (e) => e.preventDefault(), { passive: false });
for (const type of ['selectstart', 'contextmenu']) addEventListener(type, (e) => { if (!menu.open) e.preventDefault(); });
