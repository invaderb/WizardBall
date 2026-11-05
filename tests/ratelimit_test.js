// Real server.js with rate limits ON and a short room TTL: checks the limits kick in (429 + Retry-After),
// that normal polling is never limited, and that a room lives exactly as long as its host keeps checking in.
const { spawn } = require('child_process');
const ROOT = require('path').join(__dirname, '..') + '/';
const PORT = 3918, BASE = `http://localhost:${PORT}`;
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (method, path, token) => fetch(BASE + path, { method, headers: token ? { 'X-Host-Token': token } : {} });

(async () => {
  const server = spawn('node', [ROOT + 'server.js', String(PORT)], { cwd: ROOT, env: { ...process.env, ROOM_TTL_MS: '600' } });
  await new Promise((r) => server.stdout.on('data', (d) => d.toString().includes('http://localhost') && r()));
  try {
    // a room survives many TTLs while its host polls (the "games vanish after N minutes" question)...
    const { code, token } = await (await call('POST', '/api/rooms')).json();
    for (let i = 0; i < 12; i++) { await sleep(150); if (i % 2) await call('GET', `/api/rooms/${code}/joins`, token); }
    check('room outlives 3x its TTL while the host polls', (await call('GET', `/api/rooms/${code}/joins`, token)).status === 200);
    // ...and goes away once it stops
    await sleep(800);
    check('room expires after the host goes quiet', (await call('GET', `/api/rooms/${code}/joins`, token)).status === 404);

    // normal use: 1.5 polls/s for a few seconds is never limited
    const mk = await (await call('POST', '/api/rooms')).json();
    let limited = 0;
    for (let i = 0; i < 6; i++) { if ((await call('GET', `/api/rooms/${mk.code}/joins`, mk.token)).status === 429) limited++; await sleep(300); }
    check('a host polling normally is not limited', limited === 0);

    // creating rooms: capped per address
    let last;
    for (let i = 0; i < 4 && last?.status !== 429; i++) last = await call('POST', '/api/rooms');
    const why = (await last.json()).error;
    check('per-address open-room cap -> 429', last.status === 429 && /several open/.test(why), why);

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
