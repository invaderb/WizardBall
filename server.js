// Dev server for Wizardhball. It does two jobs, with no dependencies:
//   1. serves the game files, and
//   2. runs the tiny "room code" API that lets two browsers find each other (WebRTC "signaling").
// The game itself is still peer to peer: once two browsers are introduced, this server is out of the loop.
//
//   node server.js [port]        then open http://localhost:3000
//   Friends on your wifi can use the http://<your-ip>:3000 address printed below.
//   Friends elsewhere need this server reachable from the internet (a tunnel like ngrok, or a host).

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 3000);
const ROOT = __dirname;
// A room lives as long as its host's open event stream (see /events below). When that drops (refresh, closed tab,
// crash) the room goes after this grace period, which is just long enough for the host to reconnect after a blip.
const HOST_GRACE = Number(process.env.HOST_GRACE_MS) || 8000;
const KEEPALIVE = 25 * 1000;      // a comment down every stream, so proxies don't cut idle ones and dead sockets get noticed
const JOIN_TTL = 2 * 60 * 1000;   // a join request that nobody finishes is dropped
const MAX_JOINS = 32;             // pending join requests per room
const MAX_BODY = 64 * 1024;   // a connection description is a few KB; refuse anything silly
const MAX_ROOMS = 1000;
const MAX_LISTED = 50;           // the lobby shows at most this many open games
const MAX_ROOMS_PER_IP = 3;      // open rooms one address can hold at once
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // behind nginx/Cloudflare etc: use X-Forwarded-For as the client address
// Per-address token buckets: { burst, per second }. Polling is the heavy legit use (a joiner polls ~2/s while it connects),
// so these are generous for a person and tiny for a script. Creating rooms is the expensive one.
const LIMITS = {
  api: { burst: 60, rate: 10 },
  create: { burst: 5, rate: 5 / 60 },
  files: { burst: 100, rate: 30 },
};
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they look like 1 and 0
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'audio/mp4',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

// code -> { token, stream, lostAt, public, info, joins: Map(id -> { role, offer, answer, error, created }) }
// `stream` is the host's open event stream (null while it has none, since `lostAt`).
// `info` is what the lobby shows about the game; the HOST reports it (players, watchers, level, playing).
const rooms = new Map();
const push = (room, obj) => room.stream?.write(`data: ${JSON.stringify(obj)}\n\n`); // one Server-Sent Event to the host
setInterval(() => { for (const r of rooms.values()) r.stream?.write(':\n\n'); }, KEEPALIVE).unref();

const UNLIMITED = process.env.NO_RATE_LIMIT === '1'; // for tests that hammer the API
const buckets = new Map(); // "kind ip" -> { tokens, at }
function allow(kind, ip) {
  if (UNLIMITED) return 0;
  const { burst, rate } = LIMITS[kind], now = Date.now(), key = `${kind} ${ip}`;
  const b = buckets.get(key) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
  b.at = now;
  buckets.set(key, b);
  if (b.tokens < 1) return Math.ceil((1 - b.tokens) / rate); // seconds until the next request is allowed
  b.tokens -= 1;
  return 0;
}
setInterval(() => { // forget addresses that have been quiet long enough to be full again
  for (const [k, b] of buckets) if (Date.now() - b.at > 5 * 60 * 1000) buckets.delete(k);
}, 60 * 1000).unref();
// Behind Cloudflare, CF-Connecting-IP is set by Cloudflare itself; X-Forwarded-For's first entry is whatever the client sent.
const clientIp = (req) => (TRUST_PROXY && (req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for']?.split(',')[0].trim())) || req.socket.remoteAddress;

function newCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
    if (!rooms.has(code)) return code;
  }
}

// Whatever the host reports is untrusted text/numbers that other people's browsers will show: clamp and strip it.
const cleanInfo = (i) => ({
  level: typeof i?.level === 'string' ? i.level.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '',
  players: Math.max(0, Math.min(2, Math.trunc(Number(i?.players) || 0))),
  watchers: Math.max(0, Math.min(99, Math.trunc(Number(i?.watchers) || 0))),
  playing: i?.playing === true,
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Every WebRTC connection needs its own offer, and a room can have a player AND watchers, so joining is
// a short back-and-forth that this server just relays. "host" calls need the secret token the host got
// when it opened the room, so a stranger who guesses the 4-letter code can't hijack anyone's join.
//
//   host   POST   /api/rooms  { public?, level? }    -> { code, token }   (public rooms are listed below)
//   anyone GET    /api/rooms                         -> { rooms: [{ code, level, players, watchers, playing }] }  (public only)
//   host   POST   /api/rooms/CODE/info               { level, players, watchers, playing }  (what the lobby shows)
//   host   GET    /api/rooms/CODE/events             Server-Sent Events, held open: `data: {id, role}` per join request.
//                                                    The room lives while this is open; a reconnect re-sends pending joins.
//   guest  POST   /api/rooms/CODE/join   'play'|'watch' -> { id }            (ask to join; pushed to the host)
//   host   POST   /api/rooms/CODE/joins/ID/offer     (or .../reject with a reason)
//   guest  GET    /api/rooms/CODE/joins/ID           -> { offer, error }       (polls)
//   guest  POST   /api/rooms/CODE/joins/ID/answer
//   host   GET    /api/rooms/CODE/joins/ID/answer    -> { answer }             (polls; request is deleted once read)
//   host   DELETE /api/rooms/CODE                    (close the room)
async function api(req, res, parts, ip) {
  const reply = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const [, , rawCode, sub, id, action] = parts;

  if (req.method === 'GET' && !rawCode) { // the lobby: open games anyone can join or watch. Never includes tokens.
    const open = [...rooms].filter(([, r]) => r.public).slice(0, MAX_LISTED).map(([code, r]) => ({ code, ...r.info }));
    return reply(200, { rooms: open });
  }

  if (req.method === 'POST' && !rawCode) {
    if (rooms.size >= MAX_ROOMS) return reply(503, { error: 'server busy, try again in a minute' });
    const wait = allow('create', ip);
    if (wait) return reply(429, { error: `too many games created, try again in ${wait}s` });
    if (!UNLIMITED && [...rooms.values()].filter((r) => r.owner === ip).length >= MAX_ROOMS_PER_IP) return reply(429, { error: 'you already have several open games; close one first' });
    let opts = {};
    try { opts = JSON.parse((await readBody(req)) || '{}') ?? {}; } catch { /* no body, or junk: a private room */ }
    const code = newCode();
    const token = crypto.randomBytes(16).toString('hex');
    rooms.set(code, {
      token, owner: ip, stream: null, lostAt: Date.now(), joins: new Map(), // the host has HOST_GRACE to connect its stream
      public: opts.public === true, info: cleanInfo({ level: opts.level, players: 1 }),
    });
    return reply(200, { code, token });
  }

  const code = rawCode?.toUpperCase();
  const room = rooms.get(code);
  if (!room) return reply(404, { error: 'no game with that code' });
  const isHost = req.headers['x-host-token'] === room.token;
  const hostOnly = () => reply(403, { error: 'only the host can do that' });

  if (!sub) {
    if (req.method !== 'DELETE') return reply(404, { error: 'not found' });
    if (!isHost) return hostOnly();
    rooms.delete(code);
    room.stream?.end();
    return reply(200, { ok: true });
  }

  if (sub === 'events' && req.method === 'GET') {
    if (!isHost) return hostOnly();
    room.stream?.end(); // a newer connection replaces an older one
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }); // (nginx would otherwise buffer the stream)
    res.flushHeaders();
    room.stream = res;
    for (const [joinId, j] of room.joins) if (j.offer === null && j.error === null) push(room, { id: joinId, role: j.role });
    res.on('close', () => { if (room.stream === res) { room.stream = null; room.lostAt = Date.now(); } });
    return;
  }

  if (sub === 'info' && req.method === 'POST') { // the host reports what the lobby should show
    if (!isHost) return hostOnly();
    try { room.info = cleanInfo(JSON.parse(await readBody(req))); } catch { return reply(400, { error: 'info must be JSON' }); }
    return reply(200, { ok: true });
  }

  if (sub === 'join' && req.method === 'POST') {
    const role = (await readBody(req)).trim();
    if (role !== 'play' && role !== 'watch') return reply(400, { error: 'role must be play or watch' });
    if (room.joins.size >= MAX_JOINS) return reply(429, { error: 'too many people joining at once' });
    const joinId = crypto.randomBytes(6).toString('hex');
    room.joins.set(joinId, { role, offer: null, answer: null, error: null, created: Date.now() });
    push(room, { id: joinId, role });
    return reply(200, { id: joinId });
  }

  const join = room.joins.get(id);
  if (sub !== 'joins' || !join) return reply(404, { error: 'no such join request' });

  if (!action && req.method === 'GET') return reply(200, { offer: join.offer, error: join.error });
  if (action === 'offer' && req.method === 'POST') {
    if (!isHost) return hostOnly();
    join.offer = await readBody(req);
    return reply(200, { ok: true });
  }
  if (action === 'reject' && req.method === 'POST') {
    if (!isHost) return hostOnly();
    join.error = (await readBody(req)).slice(0, 200) || 'the host declined';
    return reply(200, { ok: true });
  }
  if (action === 'answer' && req.method === 'POST') {
    if (join.answer) return reply(409, { error: 'already answered' });
    join.answer = await readBody(req);
    return reply(200, { ok: true });
  }
  if (action === 'answer' && req.method === 'GET') {
    if (!isHost) return hostOnly();
    if (!join.answer) return reply(200, { answer: null });
    room.joins.delete(id); // delivered: this request is done
    return reply(200, { answer: join.answer });
  }
  return reply(404, { error: 'not found' });
}

function serveFile(res, pathname) {
  const file = path.join(ROOT, pathname === '/' ? 'index.html' : decodeURIComponent(pathname));
  const type = TYPES[path.extname(file)];
  // Only known file types, only inside this folder (no ../), no dotfiles, not this script.
  const ok = type && file.startsWith(ROOT + path.sep) && !path.basename(file).startsWith('.') && file !== __filename;
  if (!ok) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.stream && room.lostAt + HOST_GRACE < now) rooms.delete(code);
    else for (const [id, j] of room.joins) if (j.created + JOIN_TTL < now) room.joins.delete(id);
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const ip = clientIp(req), isApi = parts[0] === 'api' && parts[1] === 'rooms';
    const wait = allow(isApi ? 'api' : 'files', ip);
    if (wait) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': wait });
      return res.end(JSON.stringify({ error: `slow down, try again in ${wait}s` }));
    }
    if (isApi) return await api(req, res, parts, ip);
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    serveFile(res, url.pathname);
  } catch (err) {
    if (!res.headersSent) res.writeHead(400);
    res.end(String(err.message));
  }
}).listen(PORT, () => {
  console.log(`WizardBall: http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets ?? []) if (n.family === 'IPv4' && !n.internal) console.log(`  on your network: http://${n.address}:${PORT}`);
});
