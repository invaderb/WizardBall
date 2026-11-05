// The lobby API on the real server.js: public rooms, host-reported info, what is (not) listed.
const { spawn } = require('child_process');
const ROOT = require('path').join(__dirname, '..') + '/';
const PORT = 3918, BASE = `http://localhost:${PORT}`;
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const call = async (method, path, { body, token } = {}) => {
  const r = await fetch(BASE + path, { method, body: typeof body === 'object' ? JSON.stringify(body) : body, headers: token ? { 'X-Host-Token': token } : {} });
  return { status: r.status, body: await r.json() };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const server = spawn('node', [ROOT + 'server.js', String(PORT)], { cwd: ROOT, env: { ...process.env, NO_RATE_LIMIT: '1' } });
  await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('http://localhost') && resolve()));
  try {
    check('empty lobby to start with', (await call('GET', '/api/rooms')).body.rooms.length === 0);
    const priv = (await call('POST', '/api/rooms')).body;           // no body: a private room (the old behaviour)
    const privJson = (await call('POST', '/api/rooms', { body: { public: false, level: 'Secret' } })).body;
    const junk = (await call('POST', '/api/rooms', { body: '{not json' })).body;
    check('rooms without public:true, or with a junk body, are private', (await call('GET', '/api/rooms')).body.rooms.length === 0 && /^[A-Z]{4}$/.test(junk.code));
    const pub = (await call('POST', '/api/rooms', { body: { public: true, level: 'Classic' } })).body;
    let list = (await call('GET', '/api/rooms')).body.rooms;
    check('a public room appears in the lobby with just a code, its level, and 1 player (the host)', list.length === 1 && JSON.stringify(list[0]) === JSON.stringify({ code: pub.code, level: 'Classic', players: 1, watchers: 0, playing: false }), JSON.stringify(list));
    check('the lobby never leaks host tokens', !JSON.stringify(list).includes(pub.token) && !('token' in list[0]));
    check('private rooms stay unlisted but still work by code', (await call('POST', `/api/rooms/${priv.code}/join`, { body: 'watch' })).status === 200);

    // host-reported info
    check('info needs the host token', (await call('POST', `/api/rooms/${pub.code}/info`, { body: { players: 2 } })).status === 403);
    check('host updates the info', (await call('POST', `/api/rooms/${pub.code}/info`, { token: pub.token, body: { level: 'Bowl Arena', players: 2, watchers: 3, playing: true } })).status === 200);
    list = (await call('GET', '/api/rooms')).body.rooms;
    check('the lobby shows the new info', JSON.stringify(list[0]) === JSON.stringify({ code: pub.code, level: 'Bowl Arena', players: 2, watchers: 3, playing: true }), JSON.stringify(list[0]));
    // untrusted input is clamped / cleaned
    await call('POST', `/api/rooms/${pub.code}/info`, { token: pub.token, body: { level: 'x'.repeat(500) + '\u0007', players: 99, watchers: -5, playing: 'yes' } });
    list = (await call('GET', '/api/rooms')).body.rooms;
    check('level names are cut to 40 chars; players clamped to 0..2; watchers to 0..99; playing must be exactly true', list[0].level.length === 40 && list[0].players === 2 && list[0].watchers === 0 && list[0].playing === false, JSON.stringify(list[0]));
    await call('POST', `/api/rooms/${pub.code}/info`, { token: pub.token, body: { level: 'A\nB\u0000C', players: 'lots', watchers: 1.9 } });
    list = (await call('GET', '/api/rooms')).body.rooms;
    check('control characters are stripped; junk numbers become 0; fractions truncate', list[0].level === 'ABC' && list[0].players === 0 && list[0].watchers === 1, JSON.stringify(list[0]));
    check('non-JSON info is rejected (400) and does not change anything', (await call('POST', `/api/rooms/${pub.code}/info`, { token: pub.token, body: 'nope' })).status === 400 && (await call('GET', '/api/rooms')).body.rooms[0].level === 'ABC');
    check('info for an unknown room -> 404', (await call('POST', '/api/rooms/ZZZZ/info', { token: 'x', body: {} })).status === 404);

    // lifecycle
    const second = (await call('POST', '/api/rooms', { body: { public: true, level: 'Second' } })).body;
    check('two public rooms are both listed', (await call('GET', '/api/rooms')).body.rooms.length === 2);
    await call('DELETE', `/api/rooms/${pub.code}`, { token: pub.token });
    list = (await call('GET', '/api/rooms')).body.rooms;
    check('a closed room disappears from the lobby straight away', list.length === 1 && list[0].code === second.code);
    check('the lobby is GET-only on the list route (POST is how you create)', (await call('POST', '/api/rooms', { body: { public: true } })).body.token.length > 10);
    // the lobby is capped
    for (let i = 0; i < 60; i++) await call('POST', '/api/rooms', { body: { public: true, level: `L${i}` } });
    check('the lobby lists at most 50 games', (await call('GET', '/api/rooms')).body.rooms.length === 50);
    // existing handshake still works on a public room
    const j = (await call('POST', `/api/rooms/${second.code}/join`, { body: 'play' })).body;
    check('joining a public room works exactly like a private one', typeof j.id === 'string' && (await call('GET', `/api/rooms/${second.code}/joins`, { token: second.token })).body.joins.length === 1);
  } finally { server.kill(); }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
