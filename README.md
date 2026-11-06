# WizardBall

You and an adversarial wizard do battle to the death with arcade soccer platforming action for the magical implement known only as the WizardBall.

Designed to be a simple one-button, one-joystick game packed with an expressive set of moves

want to look into using webrtc for peer to peer to allow for online gameplay

each player sprite has a few animations depending on the playders action
- running sprite running animation
- jumping
    - jumping off the ground has a launch animation like grass/ground explosion
    - while jumping in the air they do summersalts 
    - while jumping in the air the playuers leave behind bubbles that the soccer ball can ricochet off of, the left over players colors balls only last untill they jump again
    - the ball can only interact with the left over colored light ball, players dont interact with them
    - while players are moving a small particle trail of the players color is left behind the player
- the ball bounces off walls and floors and the left over light balls the players leave while jumping
- when a ball goes in to the goal a light beam shoots the other players from the ball in the goal and plays a death animation
- by each goal post has a particle field that when a ball or player enters it the game slows down
- on each side of the field each players has three lives the it's a verticle bar divided in to 3rds and has the color representing the players color and their goal
- the field and players are very simple lines and outlined sprites with walls and floors being white lines and some floors having little lines that is supposed to be grass
- time slows only when the ball is in the slow mo

- it would be cool to have a level builder
- environmental effects
lightnign stuns
rain - slows down
fog - hard to see

- map scaling: small / medium / large maps for multiplayer games (see Team play in the TODO list)

## TODO

- [x] Level select (title screen > Options): built-in levels (`DEFAULT_LEVELS` in `level.js`), the level the builder last saved, or pasted JSON
- [x] Share / set a level from JSON: paste or copy level JSON in Options; whatever the host picks is what joiners and watchers get (switching level while people are waiting in your room switches them too)
- [x] Open games able to join: tick "List it in Open games" when hosting, and the list on everyone's title screen shows code, level, players, watchers and whether it's in progress, with Join / Watch buttons
- [x] Spectate active games: every row in Open games has Watch, including games already in progress
- [x] Link to level builder (title screen > Options)
- fps counter
- debugging options

### Level builder (`builder.html`)
- [x] Select an object (Move tool, click it; anything you draw is selected)
- [x] Duplicate the selected object (Ctrl/Cmd+D)
- [x] Flip a ramp in place (F), and mirror any object across the arena's center line (Shift+F)
- [x] Hotkeys: `M` move, `W` wall, `E` erase, `Del` delete, `Esc` deselect
- [x] Copy / paste objects (Ctrl/Cmd+C, Ctrl/Cmd+V pastes at the cursor)
- [x] Circular slow-mo zones and circular goals (drag out a square; resizing keeps it round; ellipses via JSON `shape: "circle"` with a non-square box)
- [x] Rotate (R): ramps and quarter-pipes turn 90 degrees clockwise through all four corners, including ceiling pieces (players bump their heads on them and can stand on top)
- [x] Walls have small rounded corners (visual only; hitboxes stay square)
- [x] Hairline walls: a straight drag with the Wall tool makes a 2px wall, an edge can be dragged in to 2px, then walls grow in 8px steps (so they can line up with a ramp's edge). Thin walls get a few pixels of grab and erase slack
- [x] Snap to other objects' edges (6px magnet, dashed guides; hold Alt/Option for the plain grid), so hairline walls and quarter-pipes line up exactly: a hairline snapped onto an edge sits flush on the side your cursor is on
- [x] Arrow-key nudging (1px, Shift = 8px) for lining things up exactly
- [x] Start from a built-in level, and name your level (the name appears in the level select and Open games)
- [ ] Select and move several objects at once
- [ ] Change a goal's owner without editing the JSON

### Team play: 2v2, up to 4v4
Today a game is exactly two players, one per goal; these are the pieces that assume it.
- [ ] Teams in the level format: each player gets a `team`, and a goal's `owner` becomes a team rather than a player index (`level.js` `isValidLevel`, `goalSystem` in `main.js`)
- [ ] Lives and the HUD per team (or per player), and "who wins" when a team is out
- [ ] Online: more than one player slot per room (the host takes a single `play` peer now: `acceptJoin` in `online.js`), each sending its own input; the lobby's player count is capped at 2 (`cleanInfo` in `server.js`)
- [ ] Local play with more people: more key sets, or gamepads (two key sets now)
- [ ] AI teammates and opponents to fill empty slots, team-aware so they spread out instead of all chasing the ball (`ai.js` assumes one opponent)
- [ ] Map scaling: small / medium / large arenas to fit more players. The arena is a fixed 1920 x 1000 (`W` / `H` in `main.js`): levels need their own size, the game a camera or scale-to-fit, the builder a size picker, and the AI's nav grid sizing from the level
- [ ] Builder: place a spawn per player per team, and pick the arena size

### Controllers
Every way of playing (one keyboard, vs the computer, online) reads its input as `{ left, right, jump }` from `localInput()` / `fillInputs()` in `main.js`, so a controller only has to produce that; the slide (double tap) then works on it for free.
- [ ] Gamepad support via the browser's Gamepad API: poll `navigator.getGamepads()` each frame; stick (with a deadzone) or d-pad to move, a button to jump (a press, not a hold, like the keyboard's `pressed`)
- [ ] One controller per local player, and controllers alongside keyboards (pairs with Team play's "more key sets, or gamepads")
- [ ] Mapping screen in Options: press the button you want for jump / left / right, per player, saved in this browser (localStorage, like saved levels). Keyboard keys too: today they live in each level's JSON (`players[].keys`)
- [ ] Drive the title screen and Options with a controller (move between buttons, A to press, B to go back), and R / rematch on a button

### Computer opponent (`ai.js`)
`tests/ai_test.js` plays the Hard AI on every built-in level; levels it can't play yet show up as `TODO` lines when you run the tests.
- [ ] Lift the ball in stages toward raised or floating goals (Classic's goals up the side walls, Rise and Shine's mid-air circles). One kick tops out at ~170px of height, so it needs a run of air kicks under the ball; today, with no kick that reaches the goal, it just rolls the ball along the floor (`aimAt`)
- [ ] See a ball about to LAND on its own goal as a threat (Floor is Lava, where each half of the floor is a goal). Danger is only judged by how close the ball is to a goal sideways (`threatened`), so it concedes own goals there

### Online play (WebRTC, peer to peer)
- [x] Step 1: connect two browsers with a copy/paste handshake and measure ping (`net.html`)
- [x] Step 2: host runs the simulation, guest sends inputs, host sends state snapshots (`online.js`; untested over a real connection)
- [ ] Step 3: guest smoothing (interpolate snapshots) and input prediction
- [x] Step 4: a signaling server so players can join with a short room code instead of copy/paste (`server.js`)

- [x] Title screen (Play / Host online game / Join room / Watch)
- [x] Spectators: anyone with the room code can Watch a game; they receive the same snapshots as the player but can't send input (up to 8)
- [ ] Spectator polish: show who is playing, let watchers see a replay of the last goal

### Computer opponent (`ai.js`, paused)
- [x] First rule-based version: stand on the far side of the ball from where it should go, then run or air-jump through it. "Play vs computer" on the title screen with Easy / Normal / Hard.
- [ ] Known bug: when the ball rests on a platform (the default level's opening), the AI stays in its "climb" mode and just jumps around under the platform without ever getting on top. Found with a headless trace; the climb needs to stage beside the platform and make sure it isn't blocked by it.
- [ ] Then re-measure against an idle opponent (goals scored vs own goals); a headless harness for that exists in the scratchpad.

### Looks
- [x] Health bar segments with 45 degree bevelled ends
- [x] Death beam is a stream of particles
- [x] Goals tinted with their owner's color; optional spark edge per goal (builder: select a goal, press S)
- [x] Bubbles are filled with the player's color and fade out over ~2.5s; fast jumps leave a trail (only the newest bubble is solid)
- [x] Grass on floors and platforms (builder: G toggles it on a selected wall; wide walls get it automatically)
- [ ] Real names for the winner text (it still derives BLUE / RED from the color)

### Tests (`tests/`)
`npm test` (or `node tests/run.js`) runs everything in about 5 seconds, with no dependencies. `node tests/run.js builder` runs just the files whose name contains "builder".
They run the real game files headless against a stubbed browser, so they check logic, physics and what gets drawn (with a recording canvas), not how it looks. A few start `server.js` on their own port.

| File | What it covers |
|---|---|
| `slope_test.js` | ramps and quarter-pipes: player riding, head bumps, the ball rolling |
| `ball_test.js` | the ball never ends up inside a wall or quarter-pipe or on the far side of a thin wall: direct cases, bubble pops, the pipe/hairline wedge, a fixed-seed fuzz of whole arenas, and "mutants" proving the old bugs would be caught |
| `shapes_test.js` | circular zones and goals, rounded walls, ceiling slopes, `?level=custom` |
| `sprites_test.js`, `death_test.js`, `visuals_test.js` | the wizard sprites and poses, the death animation, bubbles/beam/goal tint/grass |
| `zone_particles_test.js`, `slow_test.js` | slow-mo zone sparkles, and only the ball slowing the game |
| `online_test.js` | host / player / watcher netcode over fake links |
| `signaling_test.js`, `lobby_test.js` | the real server: handshake, host token, limits, public rooms and the open-games list |
| `title_test.js` | the title screen: Options dialog, level select, paste/copy JSON, hosting, open games |
| `builder_test.js` | the level builder: selection, circles, rotate, hotkeys, template and name |

`tests/tools/` holds scripts that are not pass/fail: `ball_fuzz.js` (throws hundreds of random balls at the "Simple" arena and others; `TRACE=1` shows how a failing ball got there; `node tests/tools/ball_fuzz.js 300 7` = 300 balls, seed 7), `ai_measure.js` (goals scored vs own goals for each AI difficulty) and `ai_trace.js` (the lead-up to an AI goal), for the paused AI work.

### Fonts and licenses
- Title screen: **Wizard** by Graphiqa Studio, in `fonts/Wizard.ttf` (with its readme next to it). It is a **demo licensed for personal use only: no commercial use**. If WizardBall is ever sold, released commercially, or monetised, buy a license first (https://graphiqastudio.com/wizard/) or swap the font out. To switch back, remove `'Wizard'` from the `#title` font stack in `index.html`.
- In-game text (countdown, "WINS", labels): **Press Start 2P** and **MedievalSharp**, both loaded from Google Fonts (open licenses).

### Running the game
`node server.js` then open http://localhost:3000. It serves the game and the room-code API (no dependencies).
Online play needs the page opened from that server. `net.html` is the manual copy/paste version, which still works without one.