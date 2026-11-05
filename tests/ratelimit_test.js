// Real server.js with rate limits ON and a short host grace period: checks the limits kick in (429 + Retry-After),
// that normal polling is never limited, and that a room lives exactly as long as its host's event stream.
const { spawn } = require('child_process');
const ROOT = require('path').join(__dirname, '..') + '/';
const PORT = 3918, BASE = `http://localhost:${PORT}`;
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (method, path, token, body) => fetch(BASE + path, { method, body, headers: token ? { 'X-Host-Token': token } : {} });
const hostStream = require('./host_stream');
const listed = async (code) => (await (await call('GET', '/api/rooms')).json()).rooms.some((r) => r.code === code);

(async () => {
  const server = spawn('node', [ROOT + 'server.js', String(PORT)], { cwd: ROOT, env: { ...process.env, HOST_GRACE_MS: '300' } });
  await new Promise((r) => server.stdout.on('data', (d) => d.toString().includes('http://localhost') && r()));
  try {
    // (5 creates per address in a burst: this file uses exactly that many before the cap check.)
    // a room lives as long as its host's stream is open, however long that is...
    const { code, token } = await (await call('POST', '/api/rooms', null, JSON.stringify({ public: true }))).json();
    const s = await hostStream(BASE, code, token);
    await sleep(1000);
    check('room outlives 3x the grace period while the host stream is open', await listed(code));

    // normal use: a joiner polling for its offer (2/s) for a few seconds is never limited
    const { id } = await (await call('POST', `/api/rooms/${code}/join`, null, 'play')).json();
    let limited = 0;
    for (let i = 0; i < 6; i++) { if ((await call('GET', `/api/rooms/${code}/joins/${id}`)).status === 429) limited++; await sleep(500); }
    check('a joiner polling normally is not limited', limited === 0);

    const never = await (await call('POST', '/api/rooms')).json();
    await sleep(500);
    check('a room whose host never connects is dropped', (await call('POST', `/api/rooms/${never.code}/join`, null, 'watch')).status === 404);

    // creating rooms: capped per address (the live room above counts; the dropped one doesn't)
    let last;
    for (let i = 0; i < 4 && last?.status !== 429; i++) last = await call('POST', '/api/rooms');
    const why = (await last.json()).error;
    check('per-address open-room cap -> 429', last.status === 429 && /several open/.test(why), why);

    // ...and the live room leaves the lobby soon after the host refreshes or closes the tab (the stream drops)
    s.close();
    await sleep(100);
    check('a short drop is forgiven (time for the host to reconnect)', await listed(code));
    await sleep(400);
    check('a host whose stream dropped has its game taken out of the lobby', !(await listed(code)));
    check('...and joining it says so', (await call('POST', `/api/rooms/${code}/join`, null, 'watch')).status === 404);

    // hammering the API: 429 with Retry-After, then the host's own poll is limited too (same address)
    let hit;
    for (let i = 0; i < 200 && !hit; i++) { const r = await call('GET', '/api/rooms'); if (r.status === 429) hit = r; }
    check('hammering GET /api/rooms -> 429', !!hit);
    check('429 carries Retry-After', Number(hit?.headers.get('retry-after')) >= 1);
    // and static files have their own bucket, so the page still loads while the API is being hammered
    check('static files unaffected by API hammering', (await fetch(BASE + '/')).status === 200);
    await sleep(1200);
    check('limit recovers after a pause', (await call('GET', '/api/rooms')).status === 200);
  } finally { server.kill(); }
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
