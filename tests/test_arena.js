// Test helper (not a test): a frozen copy of the original "Classic" level, for tests to run against.
// Many tests set things up by position: "a ramp on the floor at y=976", "the platform at 700..1220", "the goal gap under
// y=766". They used the first built-in level for that, so redesigning the built-in levels broke them. Now they get this
// arena instead, and the built-in levels can change freely. (ai_test.js also plays the AI on the REAL built-in levels.)
//
//   const { gameSource } = require('./test_arena');
//   const src = gameSource(['level.js', 'sprites.js', 'main.js']);   // read + joined, ready for vm.runInContext
//
// gameSource reads the files the same way the tests always did, but right after level.js it swaps the first built-in
// level for TEST_ARENA. It changes that level object in place, so DEFAULT_LEVEL (the same object) follows, and main.js
// then loads it as the level in play.
const fs = require('fs');
const dir = require('path').join(__dirname, '..') + '/';

const TEST_ARENA = {
  name: 'Classic',
  walls: [
    { x: -100, y: 976, w: 2120, h: 24, grass: true }, // floor: extends past the edges so you don't fall off in a goal gap
    { x: 0, y: 0, w: 1920, h: 24 }, // ceiling
    { x: 0, y: 0, w: 24, h: 766 }, // left wall, gap above the floor = goal opening
    { x: 1896, y: 0, w: 24, h: 766 }, // right wall
    { x: 700, y: 700, w: 520, h: 24, grass: true }, // platform
  ],
  ball: { x: 960, y: 400 },
  players: [
    { color: '#48f', x: 140, y: 928, hud: { x: 40, y: 60 }, keys: { left: 'KeyA', right: 'KeyD', jump: 'Space' } },
    { color: '#f44', x: 1748, y: 928, hud: { x: 1856, y: 60 }, keys: { left: 'ArrowLeft', right: 'ArrowRight', jump: 'Enter' } },
  ],
  goals: [
    { owner: 0, x: 1896, y: 766, w: 224, h: 210, sparks: 'left' }, // blue scores on the right
    { owner: 1, x: -200, y: 766, w: 224, h: 210, sparks: 'right' }, // red scores on the left
  ],
  zones: [
    { x: 1796, y: 646, w: 100, h: 330 },
    { x: 24, y: 646, w: 100, h: 330 },
  ],
  slopes: [],
};

// The original "Simple" level (since renamed and changed in level.js): four quarter-pipes, two hung from the ceiling, with
// hairline walls flush against them. player_test.js uses its corners; pass it to loadLevel() directly.
const PIPES_ARENA = {
  name: 'Simple',
  walls: [
    { x: 104, y: 32, w: 1718, h: 2 },
    { x: 92, y: 34, w: 2, h: 926 },
    { x: 1822, y: 48, w: 2, h: 922 },
    { x: 256, y: 968, w: 1408, h: 2, grass: true },
  ],
  ball: { x: 1008, y: 304 },
  players: [
    { color: '#48f', x: 356, y: 904, hud: { x: 40, y: 60 }, keys: { left: 'KeyA', right: 'KeyD', jump: 'Space' } },
    { color: '#f44', x: 1524, y: 912, hud: { x: 1856, y: 60 }, keys: { left: 'ArrowLeft', right: 'ArrowRight', jump: 'Enter' } },
  ],
  goals: [
    { owner: 0, x: 320, y: 328, w: 64, h: 64, shape: 'circle' },
    { owner: 1, x: 1536, y: 336, w: 64, h: 64, shape: 'circle' },
  ],
  zones: [
    { x: 192, y: 200, w: 328, h: 328, shape: 'circle' },
    { x: 1400, y: 200, w: 328, h: 328, shape: 'circle' },
  ],
  slopes: [
    { x: 94, y: 34, w: 200, h: 192, high: 'left', curve: true, ceiling: true },
    { x: 1624, y: 778, w: 200, h: 192, high: 'right', curve: true },
    { x: 94, y: 776, w: 200, h: 192, high: 'left', curve: true },
    { x: 1616, y: 34, w: 206, h: 192, high: 'right', curve: true, ceiling: true },
  ],
};

const SWAP = `;(() => { const first = DEFAULT_LEVELS[0]; for (const k of Object.keys(first)) delete first[k]; Object.assign(first, ${JSON.stringify(TEST_ARENA)}); })();`;

function gameSource(files) {
  return files.map((f) => fs.readFileSync(dir + f, 'utf8') + (f === 'level.js' ? SWAP : '')).join('\n');
}

module.exports = { TEST_ARENA, PIPES_ARENA, gameSource };
