// The touch controls (touch.js) on the real game code, with a fake page: the joystick (a thumb on the left half),
// the jump and menu buttons, and the window's touch listeners. A finger is { id, x, y }; the screen is 1000 wide.
const fs = require('fs'), vm = require('vm');
const { gameSource } = require('./test_arena');
const dir = require('path').join(__dirname, '..') + '/';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

const noop = new Proxy({}, { get: () => () => {}, set: () => true });
const listeners = {};
const classes = () => ({ on: false, toggle(_, v) { this.on = v; }, remove() { this.on = false; } });
const JUMP = { x: 900, y: 500 }, MENU = { x: 30, y: 30 }; // where the buttons are
const buttons = [['jump', JUMP], ['menu', MENU]].map(([b, at]) => ({ dataset: { touch: b }, at, classList: classes(), closest() { return this; } }));
const knob = { style: {} };
const stickEl = { offsetWidth: 160, style: {}, classList: classes(), firstElementChild: knob };
const sandbox = {
  console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Uint8Array, Float64Array, Int32Array, performance: { now: () => 0 }, requestAnimationFrame: () => {},
  addEventListener: (t, f) => { (listeners[t] ??= []).push(f); }, localStorage: { getItem: () => null }, HTMLInputElement: class {}, innerWidth: 1000,
  document: {
    getElementById: (id) => (id === 'touch-stick' ? stickEl : { getContext: () => noop }), fonts: { load() {} },
    elementFromPoint: (x, y) => buttons.find((b) => b.at.x === x && b.at.y === y) ?? { closest: () => null }, // anywhere else is the arena
    querySelectorAll: () => buttons,
  },
};
vm.createContext(sandbox);
vm.runInContext(gameSource(['level.js', 'sprites.js', 'main.js', 'ai.js']) + '\nlet backed = 0; function backToMenu() { backed++; menu.open = true; }\n' + fs.readFileSync(dir + 'touch.js', 'utf8'), sandbox);
const run = (c) => vm.runInContext(c, sandbox);
// Every touch event carries the fingers still down; returns whether the page's default (scroll / zoom) was blocked.
const fingers = (type, ...fs) => { let blocked = false; const e = { touches: fs.map((f) => ({ identifier: f.id, clientX: f.x, clientY: f.y, target: f.target })), preventDefault() { blocked = true; } }; for (const l of listeners[type] ?? []) l(e); return blocked; };
const thumb = (x, y) => ({ id: 1, x, y }), jumpFinger = { id: 2, ...JUMP };
const input = () => JSON.stringify(run('localInput()'));
const held = (...ds) => JSON.stringify({ left: ds.includes('left'), right: ds.includes('right'), up: ds.includes('up'), down: ds.includes('down'), jump: ds.includes('jump') });

run('menu.open = false; round.t = 0');
check('in a game, a touch is kept from scrolling / zooming the page', fingers('touchstart', thumb(200, 300)) === true);
check('a thumb on the left half: the stick centres there, nothing pushed yet', input() === held() && stickEl.classList.on && stickEl.style.left === '200px' && stickEl.style.top === '300px', input());
fingers('touchmove', thumb(260, 300));
check('pushing it right: "right"', input() === held('right'), input());
check('...and the knob follows the thumb (up to the edge of the stick)', knob.style.transform === 'translate(56px, 0px)', knob.style.transform);
fingers('touchmove', thumb(250, 250));
check('up and to the right (45 degrees): right AND up', input() === held('right', 'up'), input());
fingers('touchmove', thumb(250, 250), jumpFinger);
check('a second finger on jump while holding the stick: the direction AND a jump', input() === held('right', 'up', 'jump') && buttons[0].classList.on, input());
run('pressed.clear()'); // the game consumed the jump press this step
fingers('touchmove', thumb(250, 250), jumpFinger);
check('keeping jump held is not another jump (a press, like a key)', run('localInput().jump') === false);
fingers('touchend', thumb(200, 360));
check('straight down: "down" only (the jump finger lifted)', input() === held('down'), input());
fingers('touchmove', thumb(160, 300));
check('the thumb can swing round without lifting: left', input() === held('left'), input());
fingers('touchmove', thumb(205, 303));
check('a small wobble near the middle is nothing (the dead zone)', input() === held(), input());
fingers('touchmove', thumb(600, 300));
check('the stick follows its thumb even past the middle of the screen', input() === held('right'), input());
fingers('touchend');
check('all fingers up: nothing held, the stick back at its resting place', input() === held() && run('down.size') === 0 && !stickEl.classList.on && stickEl.style.left === '' && knob.style.transform === '');
check('a finger on the right half (not jump) does nothing, but still does not scroll the page', fingers('touchstart', { id: 3, x: 700, y: 300 }) === true && input() === held() && !stickEl.classList.on);
fingers('touchend');
fingers('touchstart', { id: 4, x: 999, y: 999, target: buttons[0] }); // Firefox for Android: the point can be offset from what you see
check('a finger whose point misses the jump button still presses the one it went down on', run('pressed.has(TOUCH.jump)') === true);
fingers('touchend'); run('pressed.clear()');
const blocks = (type) => { let blocked = false; for (const f of listeners[type] ?? []) f({ preventDefault() { blocked = true; } }); return blocked; };
check('in a game, no text selection or long-press menu (Firefox\'s select / search bar), and no pinch zoom (Safari)', blocks('selectstart') && blocks('contextmenu') && blocks('gesturestart'));

// the game, through the stick: the slide (a double flick) and an aimed air jump
run('resetSystem(); for (let i = 0; i < 20; i++) { fillInputs(); controlSystem(); physicsSystem(); pressed.clear(); }'); // standing
const stepN = (n) => run(`for (let i = 0; i < ${n}; i++) { fillInputs(); controlSystem(); physicsSystem(); pressed.clear(); }`);
const blue = '[...query("vel", "body", "controls")].find((e) => e[3].slot === 0)';
fingers('touchstart', thumb(200, 300)); fingers('touchmove', thumb(280, 300)); stepN(4); fingers('touchmove', thumb(200, 300)); stepN(4); fingers('touchmove', thumb(280, 300)); stepN(1);
check('a double flick right (out, back to the middle, out again) slides', run(`${blue}[2].slide`) > 0);
fingers('touchend'); stepN(60);
fingers('touchstart', jumpFinger); fingers('touchend'); stepN(20); // a ground jump, then up in the air
const vyBefore = run(`${blue}[1].y`);
fingers('touchstart', thumb(200, 300)); fingers('touchmove', thumb(200, 380), jumpFinger); stepN(1);
check('in the air, stick down + jump: an air jump that dives (moving down fast)', vyBefore < 0 && run(`${blue}[1].y`) > 500, `vy before ${vyBefore}, after ${run(`${blue}[1].y`)}`);
fingers('touchend');
run('sfx.length = 0'); fingers('touchstart', jumpFinger); stepN(1); fingers('touchend');
check('a jump plays the jump sound', run('sfx.join()') === 'jump', run('sfx.join()'));
run('ai.slot = 1; ai.skill = "hard"; aiReset()'); // vs the computer, as the title button starts it: the human is blue (slot 0), red is the AI
fingers('touchstart', thumb(200, 300)); fingers('touchmove', thumb(120, 300)); run('fillInputs()');
check('vs the computer, the stick moves the human (blue), not the AI', run('inputs[0].left') === true);
fingers('touchend');
run('ai.slot = -1');

// game over: jump is rematch
run('round.winner = { color: "#48f" }; pressed.clear()');
fingers('touchstart', jumpFinger); fingers('touchend');
check('game over: jump also presses R (rematch)', run('pressed.has("KeyR")') === true);
run('round.winner = null; pressed.clear()');

// the menu button, and the title screen taking touches normally
fingers('touchstart', thumb(200, 300)); fingers('touchmove', thumb(280, 300));
const menuBtn = buttons[1];
let menuBlocked = false;
for (const f of listeners.touchstart) f({ touches: [{ identifier: 1, clientX: 280, clientY: 300 }, { identifier: 5, clientX: MENU.x, clientY: MENU.y, target: menuBtn }], target: menuBtn, preventDefault() { menuBlocked = true; } });
check('a touch on the menu button is left to the browser (so it becomes a click: on iPhones it did nothing otherwise)', !menuBlocked && run('backed') === 0);
menuBtn.onclick();
check('...and the click goes back to the menu, letting go of everything held (the stick too)', run('backed') === 1 && run('down.size') === 0 && !stickEl.classList.on);
fingers('touchend');
check('on the title screen, touches are left alone (taps, scrolling the menu)', fingers('touchstart', thumb(200, 300)) === false && run('down.size') === 0);
fingers('touchend');

// aimed air jumps from any input (the keyboard here): a sideways one carries you for AIM_LOCK, then the stick steers
run('menu.open = false; resetSystem(); round.t = 0');
const none = { left: false, right: false, up: false, down: false, jump: false };
const stepIn = (n, i) => run(`for (let k = 0; k < ${n}; k++) { inputs[0] = ${JSON.stringify({ ...none, ...i })}; inputs[1] = ${JSON.stringify(none)}; controlSystem(); physicsSystem(); }`);
stepIn(30, {}); stepIn(1, { jump: true }); stepIn(20, {}); // a ground jump: in the air now
stepIn(1, { right: true, jump: true }); stepIn(5, { left: true }); // a dash right, then the stick pulled left at once
const vxCarried = run(`${blue}[1].x`);
stepIn(Math.ceil(run('AIM_LOCK') * 120), { left: true });
check('a sideways air jump dashes at JUMP_SPEED, and pulling the other way does not cancel it during AIM_LOCK...', vxCarried === run('JUMP_SPEED'), `vx ${vxCarried}`);
check('...after which the stick steers again', run(`${blue}[1].x`) === -run('RUN_SPEED'), `vx ${run(`${blue}[1].x`)}`);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
