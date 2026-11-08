// The title screen: pick a level, then Play (this keyboard, two players), play the computer, host an online
// game, join or watch one by code, or pick one from the list of open games.
// Hosting, joining and the open-games list live in online.js; this file runs the screen itself.

// ---------- Level select ----------
// The level in play is LEVEL (main.js). It can be one of the built-in DEFAULT_LEVELS, the level the builder last
// saved, or one pasted in as JSON. Whatever the host picks is what joiners and watchers get.
let pastedLevel = null;
let savedLevels = readSavedLevels(); // the builder's Save button (level.js); re-read each time the title opens
let levelLabel = levelName(LEVEL, 0); // what the lobby shows for the level in play

const nameOf = (l, fallback) => (typeof l?.name === 'string' && l.name.trim() ? l.name.trim() : fallback);

function levelOptions() {
  const options = DEFAULT_LEVELS.map((l, i) => ({ value: `d${i}`, text: levelName(l, i) }));
  if (savedLevel) options.push({ value: 'custom', text: `Yours: ${nameOf(savedLevel, 'Untitled level')} (from the builder)` });
  for (const l of savedLevels) options.push({ value: `s:${l.name}`, text: `Saved: ${l.name}` });
  if (pastedLevel) options.push({ value: 'pasted', text: `Pasted: ${nameOf(pastedLevel, 'Untitled level')}` });
  return options;
}

function buildLevelOptions(selectValue) {
  const select = $('level-select');
  const options = levelOptions();
  select.replaceChildren(...options.map(({ value, text }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    return option;
  }));
  select.value = options.some((o) => o.value === selectValue) ? selectValue : options[0].value;
}

function levelFor(value) {
  if (value === 'custom') return savedLevel;
  if (value === 'pasted') return pastedLevel;
  if (value.startsWith('s:')) return savedLevels.find((l) => `s:${l.name}` === value);
  return DEFAULT_LEVELS[Number(value.slice(1))];
}

// Switch to a level: the dimmed arena behind the menu previews it, and anyone already connected to our room
// (watchers waiting for a player) switches too.
function useLevel(level, label) {
  LEVEL = level;
  levelLabel = label;
  showLevel();
  resetWorld(LEVEL);
  round.t = 0; // resetWorld starts a countdown; the title screen is up
  broadcastLevel();
  publishInfo();
}

const levelMsg = (text) => { $('level-msg').textContent = text; };
const showLevel = () => { $('level-now').textContent = `Level: ${levelLabel}`; }; // on the menu itself, so you can see what is selected without opening Options

$('level-select').onchange = () => {
  const value = $('level-select').value;
  const option = levelOptions().find((o) => o.value === value);
  useLevel(levelFor(value), option.text.replace(/^(Yours|Pasted|Saved): /, '').replace(/ \(from the builder\)$/, ''));
  levelMsg('');
};

$('level-paste-btn').onclick = () => { $('level-box').hidden = !$('level-box').hidden; };

$('level-use-btn').onclick = () => {
  try {
    const text = $('level-json').value;
    if (text.length > 200000) throw new Error('that is far too big to be a level');
    const level = JSON.parse(text);
    if (!isValidLevel(level)) throw new Error('that is not a WizardBall level (it needs walls, goals, zones, players and a ball)');
    pastedLevel = level;
    buildLevelOptions('pasted');
    useLevel(level, nameOf(level, 'Pasted level'));
    $('level-box').hidden = true;
    levelMsg('Using the pasted level.');
  } catch (err) {
    levelMsg(`Can't use that: ${err.message}`);
  }
};

$('level-copy-btn').onclick = async () => {
  const json = JSON.stringify(LEVEL, null, 1);
  try {
    await navigator.clipboard.writeText(json);
    levelMsg('Level JSON copied. A friend can paste it with "Paste level JSON".');
  } catch { // no clipboard access (e.g. not https): show it so it can be copied by hand
    $('level-box').hidden = false;
    $('level-json').value = json;
    levelMsg('Copy the JSON from the box.');
  }
};

// ---------- The Options dialog ----------
const dialog = () => $('options-dialog');
$('options-btn').onclick = () => { if (dialog().showModal) dialog().showModal(); else dialog().open = true; };
$('options-close').onclick = () => { if (dialog().close) dialog().close(); else dialog().open = false; };

// ---------- Opening and closing ----------
function openTitle() {
  menu.open = true;
  savedLevel = readSavedLevel(); // the builder may have saved a new one since we last looked
  savedLevels = readSavedLevels();
  buildLevelOptions($('level-select').value || (LEVEL === savedLevel ? 'custom' : 'd0'));
  $('title').hidden = false;
  $('play-btn').focus();
  refreshGames();
}

function closeTitle() {
  menu.open = false;
  $('title').hidden = true;
  dialog().close?.();
  $('code-in').blur(); // otherwise typed keys would keep going into the room-code box
}

// ---------- Starting a game ----------
$('play-btn').onclick = () => {
  cancelHosting();
  ai.slot = -1; // two people on this keyboard
  resetWorld(LEVEL); // fresh game, 3-2-1 countdown
  closeTitle();
};

$('ai-btn').onclick = () => {
  cancelHosting();
  resetWorld(LEVEL);
  ai.slot = 1; // you are blue (slot 0); the computer is red
  ai.skill = $('ai-skill').value;
  aiReset();
  closeTitle();
};

// Esc (or the touch menu button, touch.js) during a game: back to the menu, leaving any online game.
function backToMenu() {
  if (menu.open) return;
  leaveOnline();
  openTitle();
}
addEventListener('keydown', (e) => { if (e.code === 'Escape') backToMenu(); });

// Left / right arrow (or the arrow buttons beside "Level:") on the title screen: the previous / next level, from the
// same list as Options (wrapping round), so you don't have to open Options to change it.
function cycleLevel(step) {
  const options = levelOptions();
  const i = options.findIndex((o) => o.value === $('level-select').value);
  $('level-select').value = options[(i + step + options.length) % options.length].value;
  $('level-select').onchange();
}
$('level-prev').onclick = () => cycleLevel(-1);
$('level-next').onclick = () => cycleLevel(1);
addEventListener('keydown', (e) => {
  if ((e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') || !menu.open || $('title').hidden || dialog().open) return;
  if (e.target instanceof HTMLInputElement) return; // typing in the room-code box: the arrows move the cursor (as in main.js)
  e.preventDefault();
  cycleLevel(e.code === 'ArrowRight' ? 1 : -1);
});

// Enter in the code box joins, so you don't have to reach for the mouse.
$('code-in').addEventListener('keydown', (e) => { if (e.code === 'Enter') joinGame('play'); });

// ---------- Start up ----------
showLevel();
buildLevelOptions(LEVEL === savedLevel ? 'custom' : 'd0'); // ?level=custom (from the builder's Play button) starts on your level
$('play-btn').focus();
refreshGames();
(function pollGames() { // keep the open-games list fresh while the menu is up
  if (menu.open && !$('title').hidden) refreshGames();
  setTimeout(pollGames, 3000);
})();

// Options: music and sound effects on / off, remembered in this browser.
for (const key of ['music', 'sfx']) {
  const cb = $(`${key}-cb`);
  soundOn[key] = cb.checked = localStorage.getItem(`wizardball-${key}`) !== 'off';
  cb.onchange = () => {
    soundOn[key] = cb.checked;
    localStorage.setItem(`wizardball-${key}`, cb.checked ? 'on' : 'off');
    musicSystem(); // stop / start the title music now
  };
}
