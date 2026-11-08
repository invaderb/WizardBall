// Controllers (gamepad.js) on the real game code, with fake gamepads: which player each one plays, the stick's 8 ways
// and dead zone, the d-pad, A to jump (once per press), Start for the menu, and an aimed air jump through it.
const fs = require('fs'), vm = require('vm');
const { gameSource } = require('./test_arena');
const dir = require('path').join(__dirname, '..') + '/';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

const noop = new Proxy({}, { get: () => () => {}, set: () => true });
const pads = [null, null];
const pad = (axes = [0, 0], pressedButtons = []) => ({ axes, buttons: Array.from({ length: 17 }, (_, n) => ({ pressed: pressedButtons.includes(n) })) });
const sandbox = {
  console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Uint8Array, Float64Array, Int32Array, performance: { now: () => 0 }, requestAnimationFrame: () => {},
  addEventListener: () => {}, localStorage: { getItem: () => null }, HTMLInputElement: class {}, navigator: { getGamepads: () => pads },
  document: { getElementById: () => ({ getContext: () => noop }), fonts: { load() {} } },
};
vm.createContext(sandbox);
vm.runInContext(gameSource(['level.js', 'sprites.js', 'main.js', 'ai.js']) + '\nlet backed = 0; function backToMenu() { backed++; menu.open = true; }\n' + fs.readFileSync(dir + 'gamepad.js', 'utf8'), sandbox);
const run = (c) => vm.runInContext(c, sandbox);
const poll = () => run('padPoll()');
const inputOf = (slot) => { run('fillInputs()'); return JSON.stringify(run(`inputs[${slot}]`)); };
const held = (...ds) => JSON.stringify({ left: ds.includes('left'), right: ds.includes('right'), up: ds.includes('up'), down: ds.includes('down'), jump: ds.includes('jump') });

run('menu.open = false; round.t = 0; ai.slot = -1');
pads[0] = pad([1, 0]); poll();
check('controller 1, stick right: blue moves right', inputOf(0) === held('right') && inputOf(1) === held(), inputOf(0));
pads[1] = pad([-0.7, -0.7]); poll();
check('controller 2, stick up-left: red gets left AND up (8 ways)', inputOf(1) === held('left', 'up'), inputOf(1));
pads[0] = pad([0.2, 0.1]); poll();
check('a stick resting a little off centre is nothing (the dead zone)', inputOf(0) === held(), inputOf(0));
pads[0] = pad([0, 0], [13, 15]); poll();
check('the d-pad works too: down + right', inputOf(0) === held('down', 'right'), inputOf(0));
pads[0] = pad([0, 0], [0]); run('pressed.clear()'); poll();
check('A: a jump', inputOf(0) === held('jump'), inputOf(0));
run('pressed.clear()'); poll();
check('...held, it is not another jump (a press, like a key)', inputOf(0) === held());
pads[0] = pad(); pads[1] = pad(); poll();
check('all let go: nothing held', run('down.size') === 0);

// an aimed air jump through a controller: in the air, stick down + A dives
const blue = '[...query("vel", "body", "controls")].find((e) => e[3].slot === 0)';
const stepN = (n) => run(`for (let i = 0; i < ${n}; i++) { padPoll(); fillInputs(); controlSystem(); physicsSystem(); pressed.clear(); }`);
run('resetSystem(); round.t = 0'); stepN(30);
pads[0] = pad([0, 0], [0]); stepN(1); pads[0] = pad(); stepN(20); // a ground jump, then up in the air
const vyBefore = run(`${blue}[1].y`);
pads[0] = pad([0, 1], [0]); stepN(1);
check('in the air, stick down + A: an air jump that dives', vyBefore < 0 && run(`${blue}[1].y`) > 500, `vy ${vyBefore} -> ${run(`${blue}[1].y`)}`);
pads[0] = pad(); stepN(1);

// vs the computer: controller 1 plays the human
run('ai.slot = 1; ai.skill = "hard"; aiReset()');
pads[0] = pad([-1, 0]); poll();
check('vs the computer, controller 1 moves the human (blue)', inputOf(0) === held('left'), inputOf(0));
pads[0] = pad(); poll(); run('ai.slot = -1');

// game over, Start, and the title screen
run('round.winner = { color: "#48f" }; pressed.clear()');
pads[0] = pad([0, 0], [0]); poll(); pads[0] = pad(); poll();
check('game over: A also presses R (rematch)', run('pressed.has("KeyR")') === true);
run('round.winner = null; pressed.clear()');
pads[0] = pad([1, 0], [9]); poll();
check('Start goes back to the menu', run('backed') === 1);
poll();
check('...once per press, and on the title screen the controller lets go of everything', run('backed') === 1 && run('down.size') === 0);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
