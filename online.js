// Online play, host-authoritative: the HOST runs the whole game (physics, scoring, everything);
// everyone else runs nothing. They draw whatever the host reports back. One machine deciding what's
// true means the screens can never disagree about a goal.
//
// The host keeps a separate connection (a "peer") to each person who joins: at most one PLAYER, who
// also sends their keys, plus any number of WATCHERS, who only receive.
//
//   player --{t:'in', left, right, jump}-->  host     (reliable channel, ~60/s)
//   host   --{t:'snap', ...positions...}-->  everyone (unreliable channel, ~60/s)
//   host   --{t:'level', level}-->           everyone (once, when they connect)
//
// Needs net.js (createLink), main.js (the game and its `net` state) and server.js (introductions).

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (text) => { $('online-status').textContent = text; };
const SERVER_HELP = "Can't reach the game server. Start it with `node server.js` and open the game from its address.";
const describe = (err) => (err instanceof TypeError ? SERVER_HELP : `Failed: ${err.message}`);
const MAX_WATCHERS = 8;

let room = null;        // host only: { code, token, peers: [{ role, link }], seen: Set of join ids }
let link = null;        // guest/watcher only: the one connection to the host
let joinRole = 'play';  // guest/watcher: what we asked for
let attempt = 0;        // bumped to cancel any in-progress hosting/joining loop
let seq = 0;            // host: snapshot counter
let lastSeq = -1;       // guest: newest snapshot applied (the state channel can reorder packets)
let levelReady = false; // guest: don't apply snapshots until we've built the host's level

// Wipe the world and rebuild it from a level. Used when a game starts and when the guest receives the host's level.
function resetWorld(level) {
  for (const map of Object.values(components)) map.clear();
  nextId = 0;
  Object.assign(round, { t: 3, hit: 0, beam: null, winner: null });
  clock.scale = 1;
  loadLevel(level);
}

// ---------- Host: describe the world ----------
// Only what changes is sent. Walls, goals, zones and slopes come from the level, which the guest
// already has, and entity ids match on both sides because loadLevel() spawns in the same order.
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

function snapshot() {
  const players = [], ball = [], bubbles = [], particles = [];
  for (const [id, pos, spin, lives, anim] of query('pos', 'spin', 'lives', 'anim'))
    players.push([id, r1(pos.x), r1(pos.y), r2(spin.a), lives.n, anim.facing, anim.moving ? 1 : 0, anim.air ? 1 : 0, r2(anim.phase), Math.round(anim.vy)]);
  for (const [id, pos] of query('pos', 'vel', 'circle')) ball.push([id, r1(pos.x), r1(pos.y)]); // bubbles have no vel
  for (const [id, pos, c, bubble, look] of query('pos', 'circle', 'bubble', 'look')) // components.bubble doesn't exist until the first air jump
    bubbles.push([id, r1(pos.x), r1(pos.y), c.r, look.color, r2(bubble.t / bubble.max)]); // how faded it is, 1 -> 0
  for (const [id, pos, p, look] of query('pos', 'particle', 'look')) {
    if (particles.length >= 300) break; // ponytail: cap keeps a packet under ~12KB (the death beam is the busiest moment); simulate particles on the guest instead if it ever matters
    particles.push([id, Math.round(pos.x), Math.round(pos.y), r2(p.life), p.max, look.color]);
  }
  const { t, hit, beam, winner } = round;
  return { t: 'snap', seq: ++seq, players, ball, bubbles, particles, round: { t: r2(t), hit: r2(hit), beam, winner } };
}

// ---------- Guest: apply a description ----------
// Make the guest's set of short-lived entities (bubbles, particles) match the host's: update, create, delete.
function syncSet(rows, marker, build) {
  const keep = new Set();
  for (const row of rows) {
    const id = row[0];
    keep.add(id);
    const parts = build(row);
    if (components.pos.has(id)) {
      Object.assign(components.pos.get(id), parts.pos);
      if (parts.particle) Object.assign(components.particle.get(id), parts.particle);
      if (parts.bubble) Object.assign(components.bubble.get(id), parts.bubble);
    } else spawnAs(id, parts);
  }
  for (const id of [...(components[marker]?.keys() ?? [])]) if (!keep.has(id)) despawn(id);
}

function applySnapshot(m) {
  if (m.seq <= lastSeq) return; // older than what we already show: ignore
  lastSeq = m.seq;
  for (const [id, x, y, a, n, facing, moving, air, phase, vy] of m.players) {
    Object.assign(components.pos.get(id), { x, y });
    components.spin.get(id).a = a;
    components.lives.get(id).n = n;
    Object.assign(components.anim.get(id), { facing, moving: Boolean(moving), air: Boolean(air), phase, vy }); // the sprite's pose
  }
  for (const [id, x, y] of m.ball) Object.assign(components.pos.get(id), { x, y });
  syncSet(m.bubbles, 'bubble', ([, x, y, r, color, fade]) => ({ pos: { x, y }, circle: { r }, bubble: { solid: false, t: fade, max: 1 }, look: { color } })); // solidity only matters on the host
  syncSet(m.particles, 'particle', ([, x, y, life, max, color]) => ({ pos: { x, y }, particle: { life, max }, look: { color } }));
  Object.assign(round, m.round);
}

// ---------- Messages ----------
// Guest/watcher: what the host sends us.
function onGuestMessage(m) {
  try {
    if (m.t === 'level') { // trust boundary: check the host's level before building anything
      if (!isValidLevel(m.level)) return say('The host sent an invalid level.');
      resetWorld(m.level);
      lastSeq = -1;
      levelReady = true;
    } else if (m.t === 'snap' && levelReady) applySnapshot(m);
  } catch (err) { console.error('bad message', err); }
}

// Host: what one peer sends. Only the player's keys matter; watchers are read-only.
function onHostMessage(peer, m) {
  try {
    if (peer.role !== 'play') return;
    if (m.t === 'in') {
      net.remote.left = Boolean(m.left);
      net.remote.right = Boolean(m.right);
      if (m.jump) net.remote.jump = true; // stays set until the first sim step consumes it
    } else if (m.t === 'rematch') pressed.add('KeyR');
  } catch (err) { console.error('bad message', err); }
}

// ---------- Hosting ----------
// A join is a short back-and-forth the server relays: they ask, we make an offer FOR THEM (each
// connection needs its own), they answer, and the direct connection opens.
const hostHeaders = (r) => ({ 'X-Host-Token': r.token });
const isOpen = (p) => p.link.channel?.readyState === 'open';
const watcherCount = (r) => r.peers.filter((p) => p.role === 'watch' && isOpen(p)).length;

// Every frame: describe the world to everyone connected (even before a player joins, so watchers see the arena).
function hostTick() {
  const open = room?.peers.filter(isOpen) ?? [];
  if (!open.length) return;
  const snap = snapshot();
  for (const p of open) p.link.sendState(snap);
}

async function hostGame() {
  closeRoom();
  const mine = ++attempt;
  try {
    say('Setting up...');
    const res = await fetch('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ public: $('public-cb').checked, level: levelLabel }), // public = listed in everyone's Open games
    });
    const body = await res.json();
    if (!res.ok) return say(body.error);
    if (attempt !== mine) return; // cancelled while we waited
    room = { code: body.code, token: body.token, peers: [], seen: new Set() };
    net.roomCode = room.code;
    net.tick = hostTick;
    $('room-code').textContent = room.code;
    say('Share this code. Friends can Join to play, or Watch.');
    pollJoins(room);
  } catch (err) { say(describe(err)); }
}

// Check in with the server every moment or so: it's how we hear about new joiners (and how it knows we're alive).
async function pollJoins(r) {
  let beat = 0;
  while (room === r) {
    if (++beat % 10 === 0) publishInfo(); // a heartbeat, so the lobby's counts can't go stale
    try {
      const res = await fetch(`/api/rooms/${r.code}/joins`, { headers: hostHeaders(r) });
      if (res.status === 404) { say('The room closed on the server.'); return closeRoom(); } // (a 429 or 5xx is just a hiccup)
      if (res.ok) for (const j of (await res.json()).joins)
        if (!r.seen.has(j.id)) { r.seen.add(j.id); acceptJoin(r, j); } // each join runs on its own
    } catch { /* server hiccup: try again next round */ }
    await sleep(700);
  }
}

async function acceptJoin(r, j) {
  const base = `/api/rooms/${r.code}/joins/${j.id}`;
  const reject = (why) => fetch(`${base}/reject`, { method: 'POST', headers: hostHeaders(r), body: why });
  if (j.role === 'play' && r.peers.some((p) => p.role === 'play'))
    return reject('That game already has two players. Use Watch to spectate.');
  if (j.role === 'watch' && r.peers.filter((p) => p.role === 'watch').length >= MAX_WATCHERS)
    return reject('That game has too many watchers.');

  const peer = { role: j.role, link: createLink() };
  r.peers.push(peer); // claims the slot right away, so two people can't both become the player
  peer.link.onopen = () => peerOpened(r, peer);
  peer.link.onclose = () => peerClosed(r, peer);
  peer.link.onmessage = (m) => onHostMessage(peer, m);
  try {
    await fetch(`${base}/offer`, { method: 'POST', headers: hostHeaders(r), body: await peer.link.host() });
    for (let i = 0; i < 40 && room === r && r.peers.includes(peer); i++) { // ~20s for them to answer
      const { answer } = await (await fetch(`${base}/answer`, { headers: hostHeaders(r) })).json();
      if (answer) return await peer.link.accept(answer);
      await sleep(500);
    }
  } catch (err) { console.error(err); }
  if (!isOpen(peer)) dropPeer(r, peer); // never connected: free the slot
}

function dropPeer(r, peer) {
  const i = r.peers.indexOf(peer);
  if (i >= 0) r.peers.splice(i, 1);
  peer.link.onclose = null;
  peer.link.pc.close();
}

function peerOpened(r, peer) {
  if (room !== r) return;
  peer.link.send({ t: 'level', level: LEVEL });
  if (peer.role === 'play') { // the player is here: start the game
    ai.slot = -1;
    net.mode = 'host';
    net.localSlot = 0;
    net.remote.left = net.remote.right = net.remote.jump = false;
    resetWorld(LEVEL);
    closeTitle();
  }
  net.watchers = watcherCount(r);
  publishInfo();
}

function peerClosed(r, peer) {
  const i = r.peers.indexOf(peer);
  if (i >= 0) r.peers.splice(i, 1);
  if (room !== r) return;
  net.watchers = watcherCount(r);
  if (peer.role === 'play' && net.mode === 'host') { // the player left; the room stays open for a new one
    net.mode = 'local';
    resetWorld(LEVEL);
    round.t = 0;
    openTitle();
    say('Your opponent left. The room is still open: share the code for a new player.');
  }
  publishInfo();
}

function closeRoom() {
  ++attempt;
  const r = room;
  if (!r) return;
  room = null;
  net.roomCode = '';
  net.watchers = 0;
  if (net.tick === hostTick) net.tick = null;
  fetch(`/api/rooms/${r.code}`, { method: 'DELETE', headers: hostHeaders(r) }).catch(() => {});
  for (const p of r.peers) { p.link.onclose = null; p.link.pc.close(); }
}

// Tell the server what the lobby should show about this game. Fire and forget: if it fails the next one will do.
function publishInfo() {
  const r = room;
  if (!r) return;
  const players = 1 + (r.peers.some((p) => p.role === 'play' && isOpen(p)) ? 1 : 0); // you, plus the second player if there is one
  fetch(`/api/rooms/${r.code}/info`, {
    method: 'POST',
    headers: hostHeaders(r),
    body: JSON.stringify({ level: levelLabel, players, watchers: watcherCount(r), playing: net.mode === 'host' }),
  }).catch(() => {});
}

// The host picked a different level while people are connected (the title screen is up, so no game is running):
// everyone connected switches to it.
function broadcastLevel() {
  for (const p of room?.peers ?? []) if (isOpen(p)) p.link.send({ t: 'level', level: LEVEL });
}

// ---------- Joining or watching ----------
async function joinGame(role, codeArg) { // codeArg: from a row in the open-games list; otherwise the code box
  const code = (codeArg ?? $('code-in').value).trim().toUpperCase();
  if (!code) return say('Type the 4-letter code first.');
  cancelHosting(); // joining someone else's game closes any room of our own
  const mine = ++attempt;
  const base = `/api/rooms/${encodeURIComponent(code)}`;
  try {
    say(role === 'watch' ? 'Joining as a watcher...' : 'Joining...');
    const res = await fetch(`${base}/join`, { method: 'POST', body: role });
    const joined = await res.json();
    if (!res.ok) return say(joined.error);
    let offer = null;
    for (let i = 0; i < 40 && attempt === mine; i++) { // wait for the host to make us an offer
      const r = await (await fetch(`${base}/joins/${joined.id}`)).json();
      if (r.error) return say(r.error);
      if (r.offer) { offer = r.offer; break; }
      await sleep(500);
    }
    if (!offer) return attempt === mine ? say("The host didn't respond. Is their game still open?") : undefined;
    joinRole = role;
    newGuestLink();
    const answer = await link.join(offer);
    const reply = await fetch(`${base}/joins/${joined.id}/answer`, { method: 'POST', body: answer });
    if (!reply.ok) return say((await reply.json()).error);
    say('Connecting...');
  } catch (err) { say(describe(err)); }
}

function newGuestLink() {
  link = createLink();
  link.onopen = guestConnected;
  link.onclose = disconnected;
  link.onmessage = onGuestMessage;
}

function guestConnected() {
  closeTitle();
  ai.slot = -1;
  net.mode = 'guest';
  net.spectating = joinRole === 'watch';
  net.localSlot = net.spectating ? -1 : 1;
  levelReady = false;
  net.tick = net.spectating
    ? () => pressed.clear() // watching: send nothing, and don't let key presses pile up
    : () => {
      link.send({ t: 'in', ...localInput() });
      if (pressed.has('KeyR')) link.send({ t: 'rematch' });
      pressed.clear(); // the guest's loop doesn't run steps, so it clears key presses itself
    };
}

// ---------- Leaving ----------
// Back to a plain local world (the title screen shows it dimmed, with no countdown).
function backToLocal() {
  net.mode = 'local';
  net.spectating = false;
  net.tick = null;
  resetWorld(LEVEL);
  round.t = 0;
}

function closeLink() {
  if (!link) return;
  link.onclose = null; // we're the one leaving: don't treat it as the host dropping
  link.pc.close();
  link = null;
}

// Esc: leave whatever online game we're in (hosting closes the room for everyone).
function leaveOnline() {
  if (net.mode === 'local' && !room && !link) return;
  closeRoom();
  closeLink();
  backToLocal();
}

// The host left, or the connection died.
function disconnected() {
  closeLink();
  backToLocal();
  openTitle();
  say('Disconnected.');
}

// Stop hosting / waiting (used by the Play and Join buttons).
function cancelHosting() {
  closeRoom();
  $('room-code').textContent = '';
  say('');
}

$('host-btn').onclick = hostGame;
$('join-btn').onclick = () => joinGame('play');
$('watch-btn').onclick = () => joinGame('watch');

// ---------- Open games (the lobby) ----------
// Public games, listed by the server. Everything in a row came from someone else's browser (via the server),
// so it is only ever shown with textContent, never as HTML.
const note = (text) => { const p = document.createElement('p'); p.className = 'games-note'; p.textContent = text; return p; };

function gameRow(g) {
  const row = document.createElement('div');
  row.className = 'game';
  const info = document.createElement('span');
  info.className = 'info';
  const code = document.createElement('span');
  code.className = 'code';
  code.textContent = g.code;
  info.append(code, ` ${g.level || 'Unnamed level'} \u00b7 ${g.players}/2 players \u00b7 ${g.watchers} watching \u00b7 ${g.playing ? 'in progress' : 'waiting'}`);
  row.append(info);
  if (g.players < 2) {
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'small';
    join.textContent = 'Join';
    join.onclick = () => joinGame('play', g.code);
    row.append(join);
  }
  const watch = document.createElement('button'); // you can watch any game, including ones in progress
  watch.type = 'button';
  watch.className = 'small';
  watch.textContent = 'Watch';
  watch.onclick = () => joinGame('watch', g.code);
  row.append(watch);
  return row;
}

async function refreshGames() {
  const box = $('games');
  try {
    const { rooms } = await (await fetch('/api/rooms')).json();
    const others = rooms.filter((g) => g.code !== room?.code); // not our own
    box.replaceChildren(...(others.length ? others.map(gameRow) : [note('No open games right now. Tick "List it in Open games" when you host.')]));
  } catch {
    box.replaceChildren?.(note('Open games are unavailable: the game server is not reachable.'));
  }
}

$('games-refresh').onclick = refreshGames;
