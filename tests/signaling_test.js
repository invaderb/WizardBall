// Starts the REAL server.js, then tests (1) its HTTP API (join requests, host token, limits, static files)
// and (2) the real client code in online.js hosting a room while a player, a watcher and a 2nd "player"
// join it (with a fake WebRTC link, since there's no browser here).
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs'), vm = require('vm');
const ROOT = require('path').join(__dirname, '..') + '/';
const PORT = 3917, BASE = `http://localhost:${PORT}`;

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const raw = (path, method = 'GET') => new Promise((resolve, reject) => {
  http.request({ host: 'localhost', port: PORT, path, method }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  }).on('error', reject).end();
});
const call = async (method, path, { body, token } = {}) => {
  const r = await fetch(BASE + path, { method, body, headers: token ? { 'X-Host-Token': token } : {} });
  return { status: r.status, body: await r.json() };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostStream = require('./host_stream');

async function main() {
  const server = spawn('node', [ROOT + 'server.js', String(PORT)], { cwd: ROOT, env: { ...process.env, NO_RATE_LIMIT: '1' } });
  await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('http://localhost') && resolve()));
  try {
    // ---- API: a full join ----
    const made = await call('POST', '/api/rooms');
    const { code, token } = made.body;
    check('create room -> 4-letter code + host token', /^[A-HJ-NP-Z]{4}$/.test(code) && token.length >= 16, code);
    const R = `/api/rooms/${code}`;
    check('host-only: event stream without token -> 403', (await hostStream(BASE, code)).status === 403);
    check('host-only: wrong token -> 403', (await hostStream(BASE, code, 'nope')).status === 403);
    const stream = await hostStream(BASE, code, token);
    await sleep(50);
    check('host stream opens, no joins yet', stream.status === 200 && stream.joins.length === 0);
    check('bad role rejected', (await call('POST', `${R.toLowerCase()}/join`, { body: 'admin' })).status === 400);
    const j1 = (await call('POST', `${R.toLowerCase()}/join`, { body: 'play' })).body.id; // lowercase code ok
    check('guest asks to join -> id', typeof j1 === 'string' && j1.length > 0);
    for (let i = 0; i < 40 && !stream.joins.length; i++) await sleep(25);
    check('the request is pushed to the host straight away, with its role', stream.joins.length === 1 && stream.joins[0].id === j1 && stream.joins[0].role === 'play', JSON.stringify(stream.joins));
    check('guest sees no offer yet', (await call('GET', `${R}/joins/${j1}`)).body.offer === null);
    check('offer without token -> 403', (await call('POST', `${R}/joins/${j1}/offer`, { body: 'OFFER-1' })).status === 403);
    check('host posts offer', (await call('POST', `${R}/joins/${j1}/offer`, { body: 'OFFER-1', token })).status === 200);
    // What a reconnecting host is sent: every request still waiting for an offer.
    const pending = async () => { const s = await hostStream(BASE, code, token); await sleep(100); s.close(); return s.joins.map((j) => j.id); };
    check('a newer host stream replaces the older one', (await pending()).length === 0 && (await sleep(50), stream.ended));
    check('a request with an offer is not re-sent on reconnect', (await pending()).length === 0);
    check('guest gets the offer', (await call('GET', `${R}/joins/${j1}`)).body.offer === 'OFFER-1');
    check('guest answers', (await call('POST', `${R}/joins/${j1}/answer`, { body: 'ANSWER-1' })).status === 200);
    check('second answer refused (409)', (await call('POST', `${R}/joins/${j1}/answer`, { body: 'X' })).status === 409);
    check('reading the answer needs the token', (await call('GET', `${R}/joins/${j1}/answer`)).status === 403);
    check('host reads the answer', (await call('GET', `${R}/joins/${j1}/answer`, { token })).body.answer === 'ANSWER-1');
    check('request is deleted after delivery', (await call('GET', `${R}/joins/${j1}`)).status === 404);

    // ---- API: reject, several joiners, limits ----
    const j2 = (await call('POST', `${R}/join`, { body: 'watch' })).body.id;
    const j3 = (await call('POST', `${R}/join`, { body: 'play' })).body.id;
    check('two requests pending at once are both sent on reconnect', (await pending()).length === 2);
    await call('POST', `${R}/joins/${j3}/reject`, { body: 'game is full', token });
    check('guest sees the rejection reason', (await call('GET', `${R}/joins/${j3}`)).body.error === 'game is full');
    check('a rejected request is not re-sent', (await pending()).join() === j2);
    let last = 200;
    for (let i = 0; i < 40 && last !== 429; i++) last = (await call('POST', `${R}/join`, { body: 'watch' })).status;
    check('join requests are capped (429)', last === 429);

    check('unknown code -> 404 with a message', (await call('GET', '/api/rooms/ZZZZ/joins/x', { token })).body.error === 'no game with that code');
    check('close room needs the token', (await call('DELETE', R)).status === 403);
    const last1 = await hostStream(BASE, code, token);
    check('host closes the room', (await call('DELETE', R, { token })).status === 200);
    await sleep(50);
    check("closing the room ends the host's stream", last1.ended);
    check('closed room is gone', (await call('POST', `${R}/join`, { body: 'play' })).status === 404);
    const big = await fetch(BASE + '/api/rooms/' + code + '/join', { method: 'POST', body: 'x'.repeat(100 * 1024) }).then((r) => r.status, () => 'connection dropped');
    check('oversized body rejected', big !== 200, String(big));

    // ---- static files ----
    const index = await raw('/');
    check('GET / serves the game', index.status === 200 && index.body.includes('WizardBall'));
    check('GET /main.js', (await raw('/main.js')).status === 200);
    check('server.js is not served', (await raw('/server.js')).status === 404);
    check('README.md (unknown type) not served', (await raw('/README.md')).status === 404);
    check('path traversal blocked', (await raw('/..%2f..%2f..%2fetc%2fpasswd')).status === 404);
    check('bad URL escape handled (no crash)', [400, 404].includes((await raw('/%E0%A4%A')).status));
    check('POST to a static path -> 405', (await raw('/main.js', 'POST')).status === 405);
    // fonts: the server only serves known file types, so .ttf must be on the list (the title screen's Wizard font)
    const font = await fetch(BASE + '/fonts/Wizard.ttf');
    const fontBytes = Buffer.from(await font.arrayBuffer());
    check('the Wizard font is served: 200, content-type font/ttf, byte-for-byte the file on disk', font.status === 200 && font.headers.get('content-type') === 'font/ttf' && fontBytes.equals(fs.readFileSync(ROOT + 'fonts/Wizard.ttf')), `${font.status} ${font.headers.get('content-type')} ${fontBytes.length} bytes`);
    const lic = await fetch(BASE + '/fonts/Wizard-READ-ME.txt');
    check("the font's license note is served next to it (text/plain)", lic.status === 200 && /text\/plain/.test(lic.headers.get('content-type')));
    check('a path that merely ends like a font is still contained (no ../ escape to server.js via /fonts/..)', (await raw('/fonts/..%2fserver.js')).status === 404);
    check('server still alive after all that', (await raw('/')).status === 200);

    // ---- the real client code ----
    const src = ['level.js', 'sprites.js', 'net.js', 'main.js', 'online.js', 'title.js'].map((f) => fs.readFileSync(ROOT + f, 'utf8')).join('\n');
    function world(fetchImpl) {
      const noop = new Proxy({}, { get: () => () => {}, set: () => true });
      const els = {};
      const el = () => ({ getContext: () => noop, hidden: false, value: '', textContent: '', onclick: null, select() {}, focus() {}, blur() {}, addEventListener() {}, append() {}, replaceChildren() {}, checked: false });
      const sandbox = {
        console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Promise, setTimeout, AbortController, TextDecoderStream, performance: { now: () => 0 },
        requestAnimationFrame: () => {}, addEventListener: () => {}, localStorage: { getItem: () => null },
        HTMLInputElement: class {}, encodeURIComponent, TypeError,
        fetch: fetchImpl ?? ((u, o) => fetch(BASE + u, o)),
        document: { getElementById: (id) => (els[id] ??= el()), createElement: () => el(), fonts: { load() {} } },
      };
      vm.createContext(sandbox);
      for (const id of ['room-code', 'code-in', 'online-status']) sandbox.document.getElementById(id);
      vm.runInContext(src, sandbox);
      // Fake WebRTC link: host() makes an "offer", join() turns it into an "answer", accept() records it.
      sandbox.accepted = [];
      vm.runInContext(`createLink = () => ({ pc: { close() {} }, channel: null,
        host: async () => 'OFFER-' + Math.random().toString(36).slice(2),
        join: async (offer) => 'ANSWER-FOR-' + offer,
        accept: async (a) => { accepted.push(a); },
        send() {}, sendState() {} })`, sandbox);
      return { sandbox, els, run: (c) => vm.runInContext(c, sandbox) };
    }

    const host = world();
    host.run('hostGame()'); // not awaited: it holds the event stream open
    for (let i = 0; i < 60 && !host.els['room-code'].textContent; i++) await sleep(50);
    const roomCode = host.els['room-code'].textContent;
    check('host sees a room code on screen', /^[A-Z]{4}$/.test(roomCode), roomCode);
    check('host status tells people what to do', /Join to play, or Watch/.test(host.els['online-status'].textContent));
    check('net.roomCode set for the on-screen label', host.run('net.roomCode') === roomCode);

    const player = world();
    player.els['code-in'].value = ` ${roomCode.toLowerCase()} `; // sloppy typing: spaces + lowercase
    await player.run("joinGame('play')");
    check('player ends up at "Connecting..."', player.els['online-status'].textContent === 'Connecting...', player.els['online-status'].textContent);
    for (let i = 0; i < 60 && host.run('accepted.length') < 1; i++) await sleep(50);
    check('host answered the player: made an offer for them and took their answer',
      host.run('accepted.length') === 1 && /^ANSWER-FOR-OFFER-/.test(host.run('accepted[0]')));
    check('host has one peer, role play', host.run("JSON.stringify(room.peers.map(p => p.role))") === '["play"]');

    const watcher = world();
    watcher.els['code-in'].value = roomCode;
    await watcher.run("joinGame('watch')");
    for (let i = 0; i < 60 && host.run('accepted.length') < 2; i++) await sleep(50);
    check('watcher connects too', host.run('accepted.length') === 2);
    check('host has a player and a watcher', host.run("JSON.stringify(room.peers.map(p => p.role))") === '["play","watch"]');

    const second = world();
    second.els['code-in'].value = roomCode;
    await second.run("joinGame('play')");
    check('a second player is told the game is full', /already has two players/.test(second.els['online-status'].textContent), second.els['online-status'].textContent);
    check('...and the host did NOT add a peer for them', host.run('room.peers.length') === 2);

    const stranger = world();
    stranger.els['code-in'].value = 'QQQQ';
    await stranger.run("joinGame('watch')");
    check('bad code shows the server message', stranger.els['online-status'].textContent === 'no game with that code');
    stranger.els['code-in'].value = '';
    await stranger.run("joinGame('play')");
    check('empty code asks for one', stranger.els['online-status'].textContent === 'Type the 4-letter code first.');

    host.run('closeRoom()'); // aborts the event stream
    check('closing the room clears the label', host.run("net.roomCode === '' && room === null"));
    await sleep(300);
    check('the room is closed on the server', (await call('POST', `/api/rooms/${roomCode}/join`, { body: 'watch' })).status === 404);

    const down = world(() => Promise.reject(new TypeError('fetch failed')));
    await down.run('hostGame()');
    check('server unreachable -> helpful message', /node server\.js/.test(down.els['online-status'].textContent));
    const down2 = world(() => Promise.reject(new TypeError('fetch failed')));
    down2.els['code-in'].value = 'ABCD';
    await down2.run("joinGame('watch')");
    check('same for joining', /node server\.js/.test(down2.els['online-status'].textContent));
  } finally {
    server.kill();
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
}
main();
