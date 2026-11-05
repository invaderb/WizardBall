// Host + player + watcher, as three separate game worlds (vm contexts) joined by fake links that pass
// JSON like the wire does. Tests OUR netcode (roles, snapshots, leaving), not WebRTC itself.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const src = ['level.js', 'sprites.js', 'net.js', 'main.js', 'online.js', 'title.js'].map((f) => fs.readFileSync(dir + f, 'utf8')).join('\n');

function makeWorld() {
  const noop = new Proxy({}, { get: () => () => {}, set: () => true });
  const els = {}, fetched = [];
  const el = () => ({ getContext: () => noop, hidden: false, value: '', textContent: '', onclick: null, select() {}, focus() {}, blur() {}, addEventListener() {}, append() {}, replaceChildren() {}, checked: false });
  const sandbox = {
    console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Promise, setTimeout, performance: { now: () => 0 },
    requestAnimationFrame: () => {}, addEventListener: () => {}, localStorage: { getItem: () => null },
    HTMLInputElement: class {}, encodeURIComponent, TypeError,
    fetch: (url, opts) => { fetched.push([opts?.method ?? 'GET', url]); return Promise.resolve({}); },
    document: { getElementById: (id) => (els[id] ??= el()), createElement: () => el(), fonts: { load() {} } },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { sandbox, els, fetched, run: (c) => vm.runInContext(c, sandbox) };
}

// Two ends of a fake connection; each send() lands in the other end's onmessage (JSON round trip).
function linkPair() {
  const mk = () => ({ onmessage: null, onclose: null, onopen: null, channel: { readyState: 'open' }, sent: 0, closed: false, peer: null,
    pc: null,
    send(o) { this.sent++; this.peer.onmessage?.(JSON.parse(JSON.stringify(o))); },
    sendState(o) { this.sent++; this.peer.onmessage?.(JSON.parse(JSON.stringify(o))); } });
  const a = mk(), b = mk(); a.peer = b; b.peer = a;
  a.pc = { close() { a.closed = true; } }; b.pc = { close() { b.closed = true; } };
  return [a, b];
}

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

const host = makeWorld(), player = makeWorld(), watcher = makeWorld();
const [hostToPlayer, playerEnd] = linkPair();
const [hostToWatcher, watcherEnd] = linkPair();
Object.assign(host.sandbox, { hp: hostToPlayer, hw: hostToWatcher });
Object.assign(player.sandbox, { gl: playerEnd });
Object.assign(watcher.sandbox, { gl: watcherEnd });

// Host: a room with a player peer and a watcher peer (what acceptJoin builds), then the links "open".
host.run(`room = { code: 'TEST', token: 't', peers: [], seen: new Set() }; net.roomCode = 'TEST'; net.tick = hostTick;
  globalThis.peerP = { role: 'play', link: hp };  hp.onmessage = (m) => onHostMessage(peerP, m);
  globalThis.peerW = { role: 'watch', link: hw }; hw.onmessage = (m) => onHostMessage(peerW, m);
  room.peers.push(peerP, peerW);`);
player.run("link = gl; joinRole = 'play'; link.onmessage = onGuestMessage; guestConnected()");
watcher.run("link = gl; joinRole = 'watch'; link.onmessage = onGuestMessage; guestConnected()");
host.run('peerOpened(room, peerP); peerOpened(room, peerW)'); // sends each the level; the player starts the game

// ---- roles ----
check('host mode', host.run('net.mode') === 'host' && host.run('net.localSlot') === 0);
check('player is a guest in slot 1', player.run('net.mode') === 'guest' && player.run('net.localSlot') === 1 && player.run('net.spectating') === false);
check('watcher is a guest with no slot, spectating', watcher.run('net.mode') === 'guest' && watcher.run('net.localSlot') === -1 && watcher.run('net.spectating') === true);
check('both received the level', player.run('levelReady') === true && watcher.run('levelReady') === true);
check('host counts 1 watcher', host.run('net.watchers') === 1);
const ids = (w) => w.run('JSON.stringify([...query("controls")].map(e=>e[0]))');
check('same entity ids on all three', ids(host) === ids(player) && ids(host) === ids(watcher));

// ---- the player drives slot 1 on the host ----
host.run('round.t = 0');
player.run('down.add("KeyD")'); player.run('net.tick()');
check('player input reaches the host', host.run('net.remote.right') === true);
const x1 = () => host.run('[...query("pos","controls")].find(e=>e[2].slot===1)[1].x');
const start = x1();
for (let i = 0; i < 20; i++) host.run('fillInputs(); controlSystem(); physicsSystem(); ballSystem(); bubbleSystem(); goalSystem(); slowSystem(); effectsSystem(); particleSystem();');
check("player's keys move player 2 on the host", x1() > start + 70, `(${start} -> ${x1().toFixed(1)})`);

// ---- a watcher can't affect the game ----
host.run('net.remote.right = false; net.remote.left = false; net.remote.jump = false; pressed.delete("KeyR")');
host.run('onHostMessage(peerW, { t: "in", left: true, right: true, jump: true })');
check("watcher's input is ignored", host.run('net.remote.left === false && net.remote.right === false && net.remote.jump === false'));
host.run('onHostMessage(peerW, { t: "rematch" })');
check("watcher's rematch is ignored", host.run('pressed.has("KeyR")') === false);
const before = watcherEnd.sent;
watcher.run('down.add("KeyD"); pressed.add("Space")'); watcher.run('net.tick()');
check('watcher sends nothing to the host, even while pressing keys', watcherEnd.sent === before);
check("watcher's key presses don't pile up", watcher.run('pressed.size') === 0);
player.run('pressed.add("KeyR")'); player.run('net.tick()');
check("player's rematch does reach the host", host.run('pressed.has("KeyR")') === true);

// ---- snapshots reach BOTH ----
host.run('placeBubble([...query("body")][1][1], {x: 500, y: 500}, {w: 32, h: 48}, "#f44"); emit(600, 600, 0, 0, "#fff", 1);');
host.run('net.tick()');
const state = (w) => w.run('JSON.stringify({ p: [...query("pos","spin","lives")].map(([id,p,s,l])=>[id,Math.round(p.x*10)/10,Math.round(p.y*10)/10,l.n]), b: [...query("pos","vel","circle")].map(([id,p])=>[id,Math.round(p.x*10)/10,Math.round(p.y*10)/10]) })');
check('player world matches host', state(host) === state(player));
check('watcher world matches host', state(host) === state(watcher));
const count = (w, n) => w.run(`components.${n}?.size ?? 0`);
check('bubble + particles replicate to the watcher', count(watcher, 'bubble') === 1 && count(watcher, 'particle') === count(host, 'particle') && count(host, 'particle') > 0);

// ---- on-screen labels render without throwing ----
let threw = null;
try { host.run('renderSystem()'); watcher.run('renderSystem()'); player.run('renderSystem()'); } catch (e) { threw = e.message; }
check('host / watcher / player all render (labels included)', threw === null, threw ?? '');

// ---- bad data from the host ----
watcher.run('levelReady = false');
watcher.run('onGuestMessage({ t: "level", level: { walls: "nope" } })');
check('guest rejects an invalid level', watcher.run('levelReady') === false);
const keep = state(player);
player.run('applySnapshot({ seq: 0, players: [[...query("controls")][0][0], 1, 1, 0, 3], ball: [], bubbles: [], particles: [], round: {} })');
check('stale snapshot (old seq) ignored', state(player) === keep);

// ---- a watcher leaves: the game carries on ----
host.run('peerClosed(room, peerW)');
check('watcher leaving updates the host', host.run('room.peers.length') === 1 && host.run('net.watchers') === 0 && host.run('net.mode') === 'host');

// ---- the player leaves: back to the title, room stays open ----
host.run('peerClosed(room, peerP)');
check('player leaving returns the host to the title screen', host.run('net.mode') === 'local' && host.run('menu.open') === true && host.run('round.t') === 0);
check('...the room stays open for a new player', host.run('room !== null && net.roomCode === "TEST" && net.tick === hostTick'));
check('...and says so', /opponent left/.test(host.els['online-status'].textContent), host.els['online-status'].textContent);
let tickErr = null;
try { host.run('hostTick()'); } catch (e) { tickErr = e.message; }
check('hostTick with nobody connected is harmless', tickErr === null);

// ---- closing the room ----
host.run('closeRoom()');
check('closeRoom clears everything', host.run('room === null && net.tick === null && net.roomCode === "" && net.watchers === 0'));
check('closeRoom tells the server (DELETE)', host.fetched.some(([m, u]) => m === 'DELETE' && u === '/api/rooms/TEST'));

// ---- host leaving takes everyone out: simulate Esc on a fresh host with peers ----
const h2 = makeWorld(); const [x, y] = linkPair();
h2.sandbox.l1 = x;
h2.run(`room = { code: 'ABCD', token: 't', peers: [{ role: 'watch', link: l1 }], seen: new Set() }; net.mode = 'host'; leaveOnline()`);
check('Esc while hosting closes every peer connection', x.closed === true && h2.run('room === null && net.mode === "local"'));

// ---- the guest side: the host dropping ----
player.run('disconnected()');
check('guest returns to local + title when the host drops', player.run('net.mode') === 'local' && player.run('menu.open') === true && player.run('link') === null && player.run('net.spectating') === false);
watcher.run('disconnected()');
check('watcher too', watcher.run('net.mode') === 'local' && watcher.run('net.spectating') === false);

// ---- local play is untouched ----
const l = makeWorld(); l.run('down.add("KeyA"); fillInputs()');
check('local mode: inputs come from the keys', l.run('inputs[0].left') === true);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
