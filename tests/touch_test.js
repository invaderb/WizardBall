// The on-screen touch buttons (touch.js) on the real game code, with a fake page: which button is under each finger,
// and the window's touch listeners. Fingers are lists of buttons ('left' | 'right' | 'jump' | 'menu' | null = the arena).
const fs = require('fs'), vm = require('vm');
const { gameSource } = require('./test_arena');
const dir = require('path').join(__dirname, '..') + '/';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

const noop = new Proxy({}, { get: () => () => {}, set: () => true });
const listeners = {};
const buttons = ['left', 'right', 'jump', 'menu'].map((b, i) => ({ dataset: { touch: b }, x: i * 100, classList: { on: false, toggle(_, v) { this.on = v; }, remove() { this.on = false; } }, closest() { return this; } }));
const sandbox = {
  console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Uint8Array, Float64Array, Int32Array, performance: { now: () => 0 }, requestAnimationFrame: () => {},
  addEventListener: (t, f) => { (listeners[t] ??= []).push(f); }, localStorage: { getItem: () => null }, HTMLInputElement: class {},
  document: {
    getElementById: () => ({ getContext: () => noop }), fonts: { load() {} },
    elementFromPoint: (x) => buttons.find((b) => b.x === x) ?? { closest: () => null }, // x picks the button; anything else is the arena
    querySelectorAll: () => buttons,
  },
};
vm.createContext(sandbox);
vm.runInContext(gameSource(['level.js', 'sprites.js', 'main.js', 'ai.js']) + '\nlet backed = 0; function backToMenu() { backed++; menu.open = true; }\n' + fs.readFileSync(dir + 'touch.js', 'utf8'), sandbox);
const run = (c) => vm.runInContext(c, sandbox);
const at = (b) => ({ clientX: b === null ? 999 : buttons.find((x) => x.dataset.touch === b).x, clientY: 0 });
// Every touch event carries the fingers still down; returns whether the page's default (scroll / zoom) was blocked.
const fingers = (type, ...bs) => { let blocked = false; const e = { touches: bs.map(at), preventDefault() { blocked = true; } }; for (const f of listeners[type] ?? []) f(e); return blocked; };
const input = () => JSON.stringify(run('localInput()'));
const lit = () => buttons.filter((b) => b.classList.on).map((b) => b.dataset.touch).join();

run('menu.open = false; round.t = 0');
check('in a game, a touch is kept from scrolling / zooming the page', fingers('touchstart', 'right') === true);
check('holding > is "right", lit up', input() === '{"left":false,"right":true,"jump":false}' && lit() === 'right', input());
fingers('touchstart', 'right', 'jump'); // a second finger on jump
check('a second finger on jump while holding >: right AND a jump', input() === '{"left":false,"right":true,"jump":true}' && lit() === 'right,jump', input());
run('pressed.clear()'); // the game consumed the jump press this step
fingers('touchmove', 'right', 'jump');
check('keeping jump held is not another jump (a press, like a key)', run('localInput().jump') === false && run('localInput().right') === true);
fingers('touchend', 'right');
fingers('touchmove', 'left'); // the finger slides across from > to <
check('sliding a finger from > to < switches direction without lifting it', input() === '{"left":true,"right":false,"jump":false}' && lit() === 'left', input());
fingers('touchend');
check('all fingers up: nothing held, nothing lit', input() === '{"left":false,"right":false,"jump":false}' && lit() === '' && run('down.size') === 0);
fingers('touchstart', null);
check('a finger on the arena (not a button) does nothing, but still does not scroll the page', input() === '{"left":false,"right":false,"jump":false}' && fingers('touchmove', null) === true);
fingers('touchend');
{ // Firefox for Android: elementFromPoint can be offset from what you see (its bottom toolbar), so the point misses
  const e = { touches: [{ clientX: 999, clientY: 0, target: buttons.find((b) => b.dataset.touch === 'left') }], preventDefault() {} };
  for (const f of listeners.touchstart) f(e);
  check('a finger whose point misses every button still presses the one it went down on', input() === '{"left":true,"right":false,"jump":false}', input());
  fingers('touchend');
}
const blocks = (type) => { let blocked = false; for (const f of listeners[type] ?? []) f({ preventDefault() { blocked = true; } }); return blocked; };
check('in a game, no text selection or long-press menu (Firefox\'s select / search bar), and no pinch zoom (Safari)', blocks('selectstart') && blocks('contextmenu') && blocks('gesturestart'));

// the slide: a double tap on > drives the same double-tap detection as the keyboard
run('resetSystem(); for (let i = 0; i < 20; i++) { fillInputs(); controlSystem(); physicsSystem(); pressed.clear(); }'); // standing
const stepN = (n) => run(`for (let i = 0; i < ${n}; i++) { fillInputs(); controlSystem(); physicsSystem(); pressed.clear(); }`);
fingers('touchstart', 'right'); stepN(4); fingers('touchend'); stepN(4); fingers('touchstart', 'right'); stepN(1);
check('double-tapping > slides (vs the computer / one player: blue)', run('[...query("body", "controls")].find((e) => e[2].slot === 0)[1].slide') > 0);
fingers('touchend');
run('ai.slot = 1; ai.skill = "hard"; aiReset()'); // vs the computer, as the title button starts it: the human is blue (slot 0), red is the AI
fingers('touchstart', 'left'); run('fillInputs()');
check('vs the computer, holding < moves the human (blue), not the AI', run('inputs[0].left') === true);
fingers('touchend');
run('ai.slot = -1');

// game over: jump is rematch
run('round.winner = { color: "#48f" }; pressed.clear()');
fingers('touchstart', 'jump'); fingers('touchend');
check('game over: jump also presses R (rematch)', run('pressed.has("KeyR")') === true);
run('round.winner = null; pressed.clear()');

// the menu button, and the title screen taking touches normally
fingers('touchstart', 'right');
fingers('touchstart', 'right', 'menu');
check('the menu button goes back to the menu, letting go of everything held', run('backed') === 1 && run('down.size') === 0 && lit() === '');
fingers('touchend');
check('on the title screen, touches are left alone (taps, scrolling the menu)', fingers('touchstart', 'right') === false && run('down.size') === 0);
fingers('touchend');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
