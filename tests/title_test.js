// The title screen: level select, pasted / copied level JSON, hosting a listed room, and the open-games list.
// Real level.js + sprites.js + net.js + main.js + online.js + ai.js + title.js with a small fake DOM.
const fs = require('fs'), vm = require('vm');
const dir = require('path').join(__dirname, '..') + '/';
const files = ['level.js', 'sprites.js', 'net.js', 'main.js', 'online.js', 'ai.js', 'title.js'];
const srcs = files.map((f) => fs.readFileSync(dir + f, 'utf8'));
const src = srcs.join('\n');

function makeWorld({ search = '', saved = null, rooms = null, clipboard = null } = {}) {
  const noop = new Proxy({}, { get: () => () => {}, set: () => true });
  const els = {};
  const makeEl = (tag = 'div') => ({
    tag, children: [], hidden: false, value: '', textContent: '', checked: false, className: '', onclick: null, onchange: null, listeners: {}, style: {}, classList: { toggle() {} },
    append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; },
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }, focus() {}, blur() {}, select() {}, getContext: () => noop,
    open: false, showModal() { this.open = true; this.modal = true; }, close() { this.open = false; },
  });
  const fetched = [];
  const sandbox = {
    console, Math, JSON, Set, Map, Object, Boolean, Number, Array, Promise, setTimeout, URLSearchParams, performance: { now: () => 0 },
    requestAnimationFrame: () => {}, addEventListener: () => {}, HTMLInputElement: class {}, encodeURIComponent, TypeError,
    localStorage: { getItem: () => (saved ? JSON.stringify(saved) : null) }, location: { search },
    navigator: clipboard ? { clipboard } : {},
    fetch: (url, opts) => {
      fetched.push({ url, method: opts?.method ?? 'GET', body: opts?.body, headers: opts?.headers });
      if (url === '/api/rooms' && (opts?.method ?? 'GET') === 'GET') return rooms === 'down' ? Promise.reject(new TypeError('fetch failed')) : Promise.resolve({ ok: true, json: async () => ({ rooms: rooms ?? [] }) });
      if (url === '/api/rooms') return Promise.resolve({ ok: true, json: async () => ({ code: 'ABCD', token: 'tok' }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    },
    document: { getElementById: (id) => (els[id] ??= makeEl()), createElement: (tag) => makeEl(tag), fonts: { load() {} } },
  };
  vm.createContext(sandbox);
  for (const id of ['level-select', 'level-box', 'level-json', 'level-use-btn', 'level-paste-btn', 'level-copy-btn', 'level-msg', 'level-now', 'options-btn', 'options-dialog', 'options-close', 'public-cb', 'games', 'games-refresh', 'title', 'play-btn', 'ai-btn', 'ai-skill', 'host-btn', 'code-in', 'join-btn', 'watch-btn', 'room-code', 'online-status'])
    sandbox.document.getElementById(id); // the page has all of these from the start
  vm.runInContext(src, sandbox);
  return { sandbox, els, fetched, run: (c) => vm.runInContext(c, sandbox) };
}
const flush = () => new Promise((r) => setTimeout(r, 20));
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const optionTexts = (w) => w.els['level-select'].children.map((o) => `${o.value}=${o.textContent}`);
// The built-in levels are whatever DEFAULT_LEVELS holds (there can be any number), so the tests never hard-code the list.
const defaultOpts = (w) => w.run('DEFAULT_LEVELS.map((l, i) => `d${i}=${levelName(l, i)}`).join("|")'); // e.g. "d0=Classic|d1=Simple"
const lastDefault = (w) => `d${w.run('DEFAULT_LEVELS.length') - 1}`; // the select value of the level most recently pushed

(async () => {
  // ===================== the Options dialog =====================
  {
    const html = fs.readFileSync(dir + 'index.html', 'utf8');
    const menu = html.slice(html.indexOf('<div id="menu">'), html.indexOf('<div id="room-code"'));
    const dlg = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'));
    const levelIds = ['level-select', 'level-paste-btn', 'level-copy-btn', 'level-box', 'level-json', 'level-use-btn', 'level-msg', 'builder.html'];
    check('all the level controls (select, paste, copy, JSON box, builder link) are inside the dialog', levelIds.every((i) => dlg.includes(i)));
    check('...and none of them are on the main menu any more', levelIds.every((i) => !menu.includes(i)));
    check('the main menu has the Options button and the current level name instead', menu.includes('id="options-btn"') && menu.includes('id="level-now"'));
    check('the dialog is a native <dialog> (focus trap, Esc to close, backdrop) with a Close button', /^<dialog id="options-dialog"/.test(dlg) && dlg.includes('id="options-close"'));
    check('the dialog sits inside the title screen so it picks up its button styles', html.indexOf('<dialog') > html.indexOf('<div id="title">') && html.indexOf('</dialog>') < html.indexOf('</div>\n  <script src="level.js">') + 1);

    const w = makeWorld();
    check('the menu shows which level is selected: "Level: Classic"', w.els['level-now'].textContent === 'Level: Classic', w.els['level-now'].textContent);
    check('the dialog starts closed', w.els['options-dialog'].open === false);
    w.els['options-btn'].onclick();
    check('Options opens it as a MODAL (showModal)', w.els['options-dialog'].open === true && w.els['options-dialog'].modal === true);
    w.els['options-close'].onclick();
    check('Close closes it', w.els['options-dialog'].open === false);
    w.run(`DEFAULT_LEVELS.push({ ...JSON.parse(JSON.stringify(DEFAULT_LEVELS[0])), name: 'Bowl Arena' }); buildLevelOptions('d0')`);
    w.els['options-btn'].onclick();
    w.els['level-select'].value = lastDefault(w); w.els['level-select'].onchange();
    check('picking a level inside the dialog updates the name on the menu behind it (and the dialog stays open)', w.els['level-now'].textContent === 'Level: Bowl Arena' && w.els['options-dialog'].open === true);
    w.els['level-json'].value = JSON.stringify({ ...JSON.parse(w.run('JSON.stringify(DEFAULT_LEVELS[0])')), name: 'Pasted one' }); w.els['level-use-btn'].onclick();
    check('pasting a level in the dialog updates the menu label too', w.els['level-now'].textContent === 'Level: Pasted one');
    w.els['play-btn'].onclick();
    check('starting a game closes the dialog along with the title screen', w.els['options-dialog'].open === false && w.els.title.hidden === true);
    check('...and the game plays the level chosen in the dialog', w.run('LEVEL.name') === 'Pasted one');
    const bare = makeWorld();
    bare.run('globalThis.__d = document.getElementById("options-dialog"); __d.showModal = undefined; __d.close = undefined');
    bare.els['options-btn'].onclick();
    check('a browser without <dialog> support still opens it (falls back to the open flag)', bare.els['options-dialog'].open === true);
    bare.els['options-close'].onclick();
    check('...and closes it', bare.els['options-dialog'].open === false);
  }

  // ===================== level select =====================
  {
    const w = makeWorld();
    check('the level select lists every built-in level by name, starting with Classic', optionTexts(w).join('|') === defaultOpts(w) && optionTexts(w)[0] === 'd0=Classic', optionTexts(w).join('|'));
    check('it starts on the first level, and LEVEL is that level', w.els['level-select'].value === 'd0' && w.run('LEVEL === DEFAULT_LEVELS[0]') && w.run('levelLabel') === 'Classic');
    // a second built-in level appears as soon as the list is rebuilt
    w.run(`DEFAULT_LEVELS.push({ ...JSON.parse(JSON.stringify(DEFAULT_LEVELS[0])), name: 'Bowl Arena', walls: DEFAULT_LEVELS[0].walls.slice(0, 3) })`);
    w.run("buildLevelOptions('d0')");
    const bowl = lastDefault(w);
    check('another built-in level shows up in the list as soon as it is rebuilt', optionTexts(w).join('|') === defaultOpts(w) && optionTexts(w).at(-1) === `${bowl}=Bowl Arena`, optionTexts(w).join('|'));
    w.run("DEFAULT_LEVELS.push({ ...JSON.parse(JSON.stringify(DEFAULT_LEVELS[0])) }); delete DEFAULT_LEVELS[DEFAULT_LEVELS.length - 1].name; buildLevelOptions('d0')");
    const unnamedIdx = w.run('DEFAULT_LEVELS.length') - 1;
    check('an unnamed level is called "Level N" by its position', optionTexts(w)[unnamedIdx] === `d${unnamedIdx}=Level ${unnamedIdx + 1}`, optionTexts(w)[unnamedIdx]);
    w.els['level-select'].value = bowl; w.els['level-select'].onchange();
    check('choosing a level makes it the one in play, and the arena behind the menu changes to it', w.run('LEVEL.name') === 'Bowl Arena' && w.run('[...query("solid")].length') === 3 && w.run('levelLabel') === 'Bowl Arena');
    check('...with no countdown running behind the title screen', w.run('round.t') === 0 && w.run('menu.open') === true);
    w.els['play-btn'].onclick();
    check('Play starts a game on the chosen level (3 walls, countdown running, title closed)', w.run('[...query("solid")].length') === 3 && w.run('round.t') === 3 && w.run('menu.open') === false && w.els.title.hidden === true);
    w.run("openTitle()");
    check('reopening the title keeps the choice', w.els['level-select'].value === bowl && w.run('LEVEL.name') === 'Bowl Arena');
    w.els['ai-btn'].onclick();
    check('Play vs computer uses the chosen level too', w.run('[...query("solid")].length') === 3 && w.run('ai.slot') === 1);
  }

  // ===================== the builder's level =====================
  {
    const mine = { ...JSON.parse(fs.readFileSync(dir + 'level.js', 'utf8').length ? '{}' : '{}') };
    const base = makeWorld();
    const lv = JSON.parse(base.run('JSON.stringify({ ...DEFAULT_LEVELS[0], name: "My arena", walls: DEFAULT_LEVELS[0].walls.slice(0, 2) })'));
    const w = makeWorld({ saved: lv });
    check('a level saved by the builder is offered as "Yours: ... (from the builder)"', optionTexts(w).join('|') === `${defaultOpts(w)}|custom=Yours: My arena (from the builder)`, optionTexts(w).join('|'));
    check('...but is not selected unless you came from the builder', w.els['level-select'].value === 'd0' && w.run('LEVEL === DEFAULT_LEVELS[0]'));
    w.els['level-select'].value = 'custom'; w.els['level-select'].onchange();
    check('choosing it loads it (2 walls) with its name as the label (no "Yours:" decoration)', w.run('[...query("solid")].length') === 2 && w.run('levelLabel') === 'My arena', w.run('levelLabel'));
    const fromBuilder = makeWorld({ saved: lv, search: '?level=custom' });
    check('opening the game with ?level=custom (the builder\'s Play button) starts on it', fromBuilder.els['level-select'].value === 'custom' && fromBuilder.run('LEVEL.name') === 'My arena');
    const none = makeWorld({ search: '?level=custom' });
    check('...and with nothing saved there is no such option', optionTexts(none).join('|') === defaultOpts(none));
    const unnamed = makeWorld({ saved: { ...lv, name: undefined } });
    check('an unnamed saved level is "Untitled level"', optionTexts(unnamed).at(-1) === 'custom=Yours: Untitled level (from the builder)', optionTexts(unnamed).at(-1));
    const bad = makeWorld({ saved: { walls: 'nope' } });
    check('a corrupt saved level is simply not offered', optionTexts(bad).join('|') === defaultOpts(bad));
  }

  // ===================== paste + copy JSON =====================
  {
    const w = makeWorld();
    const level = JSON.parse(w.run('JSON.stringify({ ...DEFAULT_LEVELS[0], name: "From a friend", walls: DEFAULT_LEVELS[0].walls.slice(0, 4) })'));
    check('the paste box starts hidden (the HTML says so); the button toggles it', /id="level-box" hidden/.test(fs.readFileSync(dir + 'index.html', 'utf8')) && (() => { w.els['level-box'].hidden = true; w.els['level-paste-btn'].onclick(); const open = w.els['level-box'].hidden === false; w.els['level-paste-btn'].onclick(); return open && w.els['level-box'].hidden === true; })());
    w.els['level-json'].value = JSON.stringify(level); w.els['level-use-btn'].onclick();
    check('pasting a valid level uses it: LEVEL, the arena, the label, the select', w.run('LEVEL.name') === 'From a friend' && w.run('[...query("solid")].length') === 4 && w.run('levelLabel') === 'From a friend' && w.els['level-select'].value === 'pasted');
    check('...it is listed as "Pasted: From a friend", the paste box closes, and it says so', optionTexts(w).includes('pasted=Pasted: From a friend') && w.els['level-box'].hidden === true && /Using the pasted level/.test(w.els['level-msg'].textContent));
    w.els['level-json'].value = 'not json'; w.els['level-use-btn'].onclick();
    check('junk is refused with a message and the level does not change', /Can't use that/.test(w.els['level-msg'].textContent) && w.run('LEVEL.name') === 'From a friend');
    w.els['level-json'].value = JSON.stringify({ walls: [], ball: {}, players: [] }); w.els['level-use-btn'].onclick();
    check('valid JSON that is not a level is refused too, with a helpful hint', /not a WizardBall level/.test(w.els['level-msg'].textContent), w.els['level-msg'].textContent);
    w.els['level-json'].value = JSON.stringify({ ...level, zones: [{ x: 0, y: 0, w: 0, h: 5 }] }); w.els['level-use-btn'].onclick();
    check('a level that would break the game (a zero-size zone) is refused', /not a WizardBall level/.test(w.els['level-msg'].textContent) && w.run('LEVEL.name') === 'From a friend');
    w.els['level-json'].value = 'x'.repeat(200001); w.els['level-use-btn'].onclick();
    check('an enormous paste is refused before it is even parsed', /too big/.test(w.els['level-msg'].textContent));
    // back to a built-in one, then paste something with circles + ceiling slopes + names
    w.els['level-select'].value = 'd0'; w.els['level-select'].onchange();
    check('switching back to a built-in level works and drops the pasted one from use', w.run('LEVEL === DEFAULT_LEVELS[0]'));
    const fancy = { ...level, goals: [{ ...level.goals[0], shape: 'circle' }, level.goals[1]], zones: [{ x: 500, y: 300, w: 200, h: 200, shape: 'circle' }], slopes: [{ x: 600, y: 800, w: 120, h: 120, high: 'left', ceiling: true, curve: true }] };
    w.els['level-json'].value = JSON.stringify(fancy); w.els['level-use-btn'].onclick();
    check('a level with circles and a ceiling quarter-pipe pastes and loads (goal shape + slope reached the world)', w.run('LEVEL.goals[0].shape') === 'circle' && w.run('[...query("slope")].length') === 1 && w.run('[...query("slow")][0][1].shape') === 'circle');
  }
  {
    let copied = null;
    const w = makeWorld({ clipboard: { writeText: async (t) => { copied = t; } } });
    await w.els['level-copy-btn'].onclick();
    check('Copy level JSON puts the current level on the clipboard (round-trips through the validator)', copied && w.run(`isValidLevel(JSON.parse(${JSON.stringify(copied)}))`) && JSON.parse(copied).name === 'Classic');
    check('...and says so', /copied/.test(w.els['level-msg'].textContent));
    const noClip = makeWorld({ clipboard: { writeText: async () => { throw new Error('denied'); } } });
    await noClip.els['level-copy-btn'].onclick();
    check('if the clipboard is blocked, the JSON is shown in the box to copy by hand', noClip.els['level-box'].hidden === false && JSON.parse(noClip.els['level-json'].value).name === 'Classic' && /from the box/.test(noClip.els['level-msg'].textContent));
  }

  // ===================== hosting: listed or not, sharing the level =====================
  {
    const w = makeWorld();
    w.els['public-cb'].checked = true;
    w.els['host-btn'].onclick(); await flush();
    const post = w.fetched.find((f) => f.url === '/api/rooms' && f.method === 'POST');
    check('hosting with the box ticked asks the server for a PUBLIC room, naming the level', JSON.parse(post.body).public === true && JSON.parse(post.body).level === 'Classic', post.body);
    w.run('closeRoom()');
    const w2 = makeWorld();
    w2.els['host-btn'].onclick(); await flush();
    check('unticked: a private room', JSON.parse(w2.fetched.find((f) => f.url === '/api/rooms' && f.method === 'POST').body).public === false);
    w2.run('closeRoom()');

    // the host changes the level while someone is already connected: they are told
    const w3 = makeWorld();
    w3.els['host-btn'].onclick(); await flush();
    w3.run(`const sent = []; const fake = (open) => ({ role: 'watch', link: { channel: { readyState: open ? 'open' : 'connecting' }, send: (m) => sent.push(m), pc: { close() {} } } }); room.peers.push(fake(true), fake(false)); globalThis.sent = sent;
      DEFAULT_LEVELS.push({ ...JSON.parse(JSON.stringify(DEFAULT_LEVELS[0])), name: 'Bowl Arena' }); buildLevelOptions('d0');`);
    w3.fetched.length = 0;
    w3.els['level-select'].value = lastDefault(w3); w3.els['level-select'].onchange();
    const sent = JSON.parse(w3.run('JSON.stringify(sent.map(m => ({ t: m.t, name: m.level.name })))'));
    check('changing the level while hosting sends it to everyone connected (once, only to the open connection)', sent.length === 1 && sent[0].t === 'level' && sent[0].name === 'Bowl Arena', JSON.stringify(sent));
    const info = w3.fetched.find((f) => f.url === '/api/rooms/ABCD/info');
    check('...and tells the lobby the new level name, with the host token', info && JSON.parse(info.body).level === 'Bowl Arena' && info.headers['X-Host-Token'] === 'tok', JSON.stringify(info));
    check('the info says: players = 1 (just the host), 0 watching connected as "watch" peers counted by readyState', JSON.parse(info.body).players === 1 && JSON.parse(info.body).watchers === 1 && JSON.parse(info.body).playing === false, info.body);
    w3.run("room.peers.push({ role: 'play', link: { channel: { readyState: 'open' }, send() {}, pc: { close() {} } } }); net.mode = 'host'; publishInfo()");
    const info2 = JSON.parse(w3.fetched.filter((f) => f.url === '/api/rooms/ABCD/info').at(-1).body);
    check('once a player is connected and the game runs: 2 players, playing: true', info2.players === 2 && info2.playing === true, JSON.stringify(info2));
    w3.run('room.peers.length = 0; net.mode = "local"; closeRoom()');
    w3.fetched.length = 0; w3.run('publishInfo()');
    check('with no room, publishing does nothing (no stray requests)', w3.fetched.length === 0);
    const w4 = makeWorld();
    w4.els['level-select'].value = 'd0'; w4.els['level-select'].onchange();
    check('changing level when NOT hosting touches no network', !w4.fetched.some((f) => f.url !== '/api/rooms'));
  }

  // ===================== open games =====================
  {
    const rooms = [
      { code: 'AAAA', level: 'Classic', players: 1, watchers: 0, playing: false },
      { code: 'BBBB', level: 'Bowl Arena', players: 2, watchers: 3, playing: true },
      { code: 'CCCC', level: '<img src=x onerror=alert(1)>', players: 1, watchers: 1, playing: false },
    ];
    const w = makeWorld({ rooms }); await flush();
    const rows = w.els.games.children;
    check('every open game becomes a row', rows.length === 3 && rows.every((r) => r.className === 'game'), String(rows.length));
    const text = (row) => row.children[0].children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
    check('a row shows the code, level, players, watchers and whether it is in progress', text(rows[0]) === 'AAAA Classic · 1/2 players · 0 watching · waiting' && text(rows[1]) === 'BBBB Bowl Arena · 2/2 players · 3 watching · in progress', `${text(rows[0])} || ${text(rows[1])}`);
    const buttons = (row) => row.children.slice(1).map((b) => b.textContent);
    check('a game with a free seat offers Join and Watch; a full / running one only Watch (so you can spectate active games)', JSON.stringify(buttons(rows[0])) === '["Join","Watch"]' && JSON.stringify(buttons(rows[1])) === '["Watch"]');
    check('a hostile level name is only ever TEXT (no innerHTML anywhere, so no script can run)', text(rows[2]).includes('<img src=x onerror=alert(1)>') && !/innerHTML/.test(srcs.join('')));
    rows[0].children[1].onclick(); await flush();
    const join = w.fetched.find((f) => f.url === '/api/rooms/AAAA/join');
    check('Join on a row asks to PLAY in that game (no typing the code)', join && join.method === 'POST' && join.body === 'play', JSON.stringify(join));
    rows[1].children[1].onclick(); await flush();
    check('Watch on a row asks to WATCH it', w.fetched.find((f) => f.url === '/api/rooms/BBBB/join')?.body === 'watch');

    const own = makeWorld({ rooms: [{ code: 'ABCD', level: 'Mine', players: 1, watchers: 0, playing: false }, rooms[0]] });
    own.els['host-btn'].onclick(); await flush(); await own.run('refreshGames()');
    check('your own hosted game is not listed back to you', own.els.games.children.length === 1 && own.els.games.children[0].children[0].children[0].textContent === 'AAAA');
    own.run('closeRoom()');

    const empty = makeWorld({ rooms: [] }); await flush();
    check('no games: a helpful note, not a blank box', empty.els.games.children.length === 1 && /No open games/.test(empty.els.games.children[0].textContent));
    const down = makeWorld({ rooms: 'down' }); await flush();
    check('server unreachable: says so quietly (the rest of the menu still works)', /not reachable/.test(down.els.games.children[0].textContent) && down.els['play-btn'].onclick !== null);
    empty.els['games-refresh'].onclick(); await flush();
    check('Refresh fetches the list again', empty.fetched.filter((f) => f.url === '/api/rooms' && f.method === 'GET').length >= 2);
    const refetch = makeWorld({ rooms }); await flush();
    const n0 = refetch.fetched.length; refetch.run('openTitle()'); await flush();
    check('opening the title screen refreshes the list', refetch.fetched.length > n0);
    refetch.run('menu.open = false; closeTitle()');
    check('the menu hides the lobby along with itself (closed = hidden)', refetch.els.title.hidden === true);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
