# Tetris - HTML, CSS & JavaScript

A complete Tetris game in three files - no build step, no dependencies, no
framework. Boot screen, main menu, how-to-play, settings, high-score table and
the game itself. Open `index.html` and play.

```
tetris/
├── index.html   six screens: boot · menu · help · scores · settings · game
├── style.css    layout + theme + all the animation
├── script.js    game logic + juice + input + screens (commented by section)
└── README.md    this file
```

## Screens

| Screen | What it does |
| --- | --- |
| **Boot** | Runs the real init steps (piece tables, rotation warm-up, board allocation, saved data, canvas sizing) behind a progress bar, then hands off to the menu. |
| **Menu** | New Game, Continue (only when a run is saved), How to Play, High Scores, Settings, and your personal best. |
| **How to Play** | Goal, keyboard map, touch gestures, the scoring table, and the four techniques worth knowing. |
| **High Scores** | Top 10 runs with score, lines, level and date; wins get a badge. Clearable. |
| **Settings** | Sound, haptics, visual effects, ghost piece, countdown, lines-to-win (20/40/100/∞) and starting level (1-10). |
| **Game** | The board, HUD, hold/next previews and the control pad. |

**Continue** is a real save: the grid, active piece, hold slot, bag, queue and
score are written to `localStorage` on every lock and whenever you pause, quit
or hide the tab. Finishing a run (win or loss) clears it and files the score.

## Running it

Double-clicking `index.html` works. If you want a local server (needed if you
later add modules or fetch data):

```bash
python3 -m http.server 4321 --directory tetris
```

Then open <http://localhost:4321>.

> A `tetris-static` entry was also added to `../.claude/launch.json` so the
> preview pane can serve this folder.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` | Move left / right (auto-repeats when held) |
| `↓` | Soft drop - 1 point per cell |
| `↑` or `X` | Rotate clockwise |
| `Z` | Rotate counter-clockwise |
| `Space` | Hard drop - 2 points per cell, locks instantly |
| `C` | Hold / swap the current piece |
| `P` or `Esc` | Pause |
| `Enter` | Start / restart |

`Esc` also backs out of any sub-page to the menu. Every effect is synthesised
at runtime - there are no audio files - and sound can be turned off in Settings.

### Touch

A button pad sits under the board, and the board itself is a gesture surface:

| Gesture | Action |
| --- | --- |
| Drag left/right | Slide the piece - it tracks your thumb cell for cell |
| Drag down | Soft drop, one row per cell of travel |
| Flick down | Hard drop |
| Tap | Rotate clockwise |

Holding a pad button repeats, so you can slide a piece across without
tapping four times. Supported devices get haptic feedback on drops and clears.

## Rules as implemented

- **Win** - clear the goal number of lines (**40** by default). Classic Tetris
  has no win state, so this is an explicit goal, a "40-line sprint". Settings
  offers 20 / 40 / 100 / ∞; the progress bar follows automatically, and ∞ hides
  it and never wins.
- **Lose** - *block out* (a new piece cannot fit at its spawn position) or
  *lock out* (a piece comes to rest entirely inside the two hidden rows).
- **High scores** - the top 10 runs live in `localStorage`, so they survive
  reloads. Every read and write goes through a `try/catch` wrapper because
  storage throws in some private-browsing modes - the game stays fully playable
  with storage disabled, it just forgets.

### Storage keys

| Key | Holds |
| --- | --- |
| `tetris.settings.v1` | The settings object (merged over defaults on load, so adding a setting never breaks an old save) |
| `tetris.scores.v1` | Top 10 runs: score, lines, level, won, timestamp |
| `tetris.highscore.v1` | Personal best, cached for the menu |
| `tetris.save.v1` | The in-progress run behind **Continue** |

---

# How it works

## 1. The board is just a 2D array

```js
const COLS = 10, ROWS = 22, HIDDEN_ROWS = 2;
state.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
```

Each cell is either `null` (empty) or a piece letter (`'T'`, `'I'`, …) that
doubles as a colour lookup. Storing the letter rather than a boolean means the
renderer knows what colour to paint a settled block without a second array.

`x` grows right, `y` grows **down** - same as canvas coordinates, which removes
a whole class of sign-flip bugs.

The top **two rows are hidden**. Pieces spawn there and overflow into them, and
the renderer simply subtracts `HIDDEN_ROWS` when painting. This is how you get a
top-out condition that doesn't require special-casing negative coordinates.

## 2. Pieces are square matrices

```js
T: [[0,1,0],
    [1,1,1],
    [0,0,0]]
```

Every piece is stored in a **square** matrix (3×3, except I at 4×4 and O at 2×2)
precisely so rotation is index arithmetic rather than seven hand-written tables:

```js
// clockwise:        result[y][x] = m[n-1-x][y]
// counter-clockwise: result[y][x] = m[x][n-1-y]
```

The active piece is one small object:

```js
{ type: 'T', matrix: [[...]], x: 3, y: 2, rotation: 0 }
```

`x`/`y` is where the matrix's top-left corner sits on the grid. Nothing about
the piece is baked into the grid until it locks.

## 3. One collision function backs everything

This is the single most important function in the file:

```js
function collides(matrix, x, y) {
  for each filled cell (rx, ry) of matrix:
    bx = x + rx, by = y + ry
    if (bx < 0 || bx >= COLS || by >= ROWS) return true;   // wall or floor
    if (by >= 0 && grid[by][bx]) return true;              // settled block
  return false;
}
```

Every mechanic is expressed as *"would this placement collide?"*:

| Mechanic | Implementation |
| --- | --- |
| Move left | `collides(m, x-1, y)` → if false, commit |
| Gravity tick | `collides(m, x, y+1)` → if true, start the lock timer |
| Rotation | build rotated matrix, test it at candidate offsets |
| Ghost piece | increment `y` until it collides, draw there |
| Hard drop | same distance, then apply it and lock |
| Game over | `collides()` at the spawn position |

Because it is a pure predicate over `(matrix, x, y)`, you can *test* a move
before committing to it - the thing that makes rotation with wall kicks
tractable at all.

## 4. Rotation with SRS wall kicks

Naive rotation refuses to turn a piece that's flush against a wall or nestled in
a well, which feels broken. The **Super Rotation System** fixes this: if the
pure rotation collides, try up to four small translations ("kicks") and take the
first that fits.

```js
const kicks = table[`${fromRotation}${toRotation}`];   // e.g. "01"
for (const [dx, dy] of kicks) {
  if (!collides(rotated, p.x + dx, p.y + dy)) { commit(dx, dy); return true; }
}
return false;   // genuinely no room - refuse the rotation
```

Two kick tables exist: one for J/L/S/T/Z, one for I (its rotation centre is
offset). O never rotates visibly, so it's skipped entirely.

Published SRS tables use **y-up** coordinates. The tables in `script.js` have
already been negated to y-down. If you copy fresh tables from a reference, you
must flip the sign of every `dy` - otherwise kicks push pieces the wrong way and
you'll chase the bug for an hour.

## 5. Randomness: the 7-bag

Uniform random piece selection produces long droughts (no I piece for 20 pieces)
that feel unfair. Modern Tetris deals from a **bag**: shuffle all seven pieces,
deal them out, reshuffle. You never wait more than 12 pieces for any given one.

```js
function nextType() {
  if (bag.length === 0) bag = shuffle(TYPES.slice());   // Fisher-Yates
  return bag.pop();
}
```

A three-piece `queue` is kept topped up from the bag and drives the Next panel.

## 6. Gravity, lock delay, and the game loop

The loop is `requestAnimationFrame` with **delta time**, not a `setInterval`.
That keeps the fall speed identical on 60 Hz and 144 Hz displays:

```js
function tick(now) {
  const dt = Math.min(now - lastFrame, 100);  // clamp: tab was backgrounded
  lastFrame = now;
  if (phase === 'playing') update(dt);
  drawBoard();
  requestAnimationFrame(tick);
}
```

`update(dt)` accumulates time and drops the piece one row when the accumulator
passes the current level's interval:

```js
dropTimer += dt;
if (dropTimer >= GRAVITY[level]) { dropTimer -= GRAVITY[level]; move(0, 1); }
```

`GRAVITY` is a lookup table in milliseconds per row, from 1000 ms at level 1 to
12 ms at level 15 - the classic curve, converted from frames-at-60fps.

**Lock delay** is what separates a game that feels good from one that doesn't. A
piece touching the stack does not freeze immediately; it gets 500 ms, and any
successful move or rotation resets that timer - up to 15 resets, so you can't
stall forever. Without this, fast levels are unplayable; without the reset cap,
you can hover indefinitely.

## 7. Locking and clearing lines

```js
function lock() {
  eachCell(piece.matrix, piece.x, piece.y, (x, y) => grid[y][x] = piece.type);
  const full = rows where every cell is truthy;
  if (full.length) { phase = 'clearing'; }   // flash, then resolve
  else { spawn(); }
}
```

Clearing itself is two lines, using the fact that `splice` + `unshift` shifts
everything above down by one automatically:

```js
for (const y of clearRows) {
  grid.splice(y, 1);                      // remove the full row
  grid.unshift(new Array(COLS).fill(null)); // push a fresh empty row on top
}
```

A short `'clearing'` phase (180 ms) sits between lock and resolve so the flash is
visible. Because the phase - not a timer callback - gates `update()`, gravity
and input are naturally frozen during the animation. **Modelling the game as a
state machine (`start → playing → clearing → playing → won | lost`, plus
`paused`) is what keeps this from becoming a tangle of boolean flags.**

## 8. Scoring

```js
const LINE_SCORE = [0, 100, 300, 500, 800];   // by lines cleared at once
points = LINE_SCORE[cleared] * level;
if (cleared === 4 && backToBack) points = Math.floor(points * 1.5);
if (combo > 0) points += 50 * combo * level;
score += points;
```

Plus 1 point per cell soft-dropped and 2 per cell hard-dropped. The structure
is deliberately super-linear: four singles score 400, one Tetris scores 800.
That's the entire risk/reward design of the game expressed in one array.

- **Combo** - a counter incremented on every consecutive piece that clears at
  least one line, reset to `-1` on a lock that clears nothing.
- **Back-to-back** - consecutive Tetrises get a 1.5× bonus.
- **Level** - `floor(lines / 10) + 1`, capped at the gravity table length.

## 9. Rendering

Three canvases: the board (300×600 at 30 px per cell), the hold preview, and the
next queue. Every frame redraws from scratch - at 10×20 cells that's trivially
cheap and removes any possibility of stale pixels.

Draw order matters: background → grid lines → settled blocks → **ghost** →
active piece. The ghost is drawn at `globalAlpha = 0.22` so the real piece reads
clearly on top of it.

Each block is a flat fill plus a light top-left bevel and a dark bottom edge -
four `fillRect` calls that sell depth far more cheaply than gradients.

## 10. Input

Keyboard events are normalised through `keyName(e)`, which prefers
`event.code` (layout-independent, so WASD-style physical positions stay put on
AZERTY) and falls back to `event.key`.

Horizontal movement implements **DAS/ARR**, the standard two-stage auto-repeat:
the first press moves one cell, then after a 160 ms delay (DAS) the piece
repeats every 45 ms (ARR). This is driven from the game loop with `dt`, *not*
from the OS key-repeat rate, so it's identical on every machine.

One non-obvious detail worth knowing: the overlay's Start button keeps DOM focus
after you click it, so the next `Space` would re-activate the button and restart
the game mid-play. `hideOverlay()` calls `oBtn.blur()` to prevent that.

## 11. Game feel

Mechanically the game was finished at section 7. Everything here is
presentation - but it is most of what makes a Tetris feel good rather than
merely correct. All of it lives in a separate `fx` object so the rules stay
readable:

```js
const fx = { particles: [], popups: [], trails: [], flashes: [], shake: {...} };
```

| Effect | Trigger | What it does |
| --- | --- | --- |
| **Screen shake** | Hard drop, line clear, level up, game over | Random offset written to the board wrapper's `transform`, decaying on `k²` so it snaps rather than wobbles. Magnitude scales with drop distance and lines cleared. |
| **Particles** | Lock, clear, game over, win | Little squares with velocity, gravity and drag, coloured from the piece they came from. |
| **Drop trail** | Hard drop | A vertical streak from where the piece was to where it landed, fading out along its length so it reads as motion. |
| **Lock flash** | Every lock | A white overlay on the piece's cells for 130 ms - the "it landed" confirmation. |
| **Row collapse** | Line clear | Rows flash white, then scale and fade out over 300 ms before the splice. |
| **Score popups** | Line clear, level up | `SINGLE`/`DOUBLE`/`TRIPLE`/`TETRIS` with the point value, combo and back-to-back, overshooting in and drifting upward. |
| **Ghost pulse** | Always | The landing outline breathes gently so it never reads as a settled block. |
| **Lock glow** | Grounded piece | A canvas `shadowBlur` that ramps up with the lock timer: a visual countdown to the freeze. |
| **Spawn scale-in** | New piece | 130 ms ease-out from 70% scale. |
| **Danger glow** | Stack past two thirds | The board's border pulses red. |
| **Countdown** | Start / resume | "3 · 2 · 1" so play never begins while your hands are elsewhere. |

Two rules keep this from turning into a mess:

1. **Cosmetics never touch game state.** `stepFx(dt)` advances and prunes every
   effect; deleting the whole function would leave a fully playable game.
2. **Everything is capped.** Particles are hard-limited to 420, flashes and
   trails to 3. Without that, a fast stack of locks whites out the board and
   the frame rate falls off a cliff.

`prefers-reduced-motion` short-circuits shake, particles and trails at the
source - `REDUCED_MOTION` is checked inside `shake()` and `burst()`, so there's
no per-call-site branching to forget.

### Sound without asset files

Every effect is a few oscillators through a gain envelope:

```js
function tone({ freq, type = 'square', dur = .08, vol = .14, slide = 0, delay = 0 }) {
  const osc = actx.createOscillator(), gain = actx.createGain();
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq + slide, t + dur);
  gain.gain.linearRampToValueAtTime(vol, t + .008);          // fast attack
  gain.gain.exponentialRampToValueAtTime(.0001, t + dur);    // exponential decay
  ...
}
```

A line clear is an arpeggio (three notes for 1-3 lines, a five-note run plus a
noise sweep for a Tetris); the drop is a descending square wave plus filtered
white noise. Total cost: no network requests and no asset pipeline.

Browsers won't let you create an `AudioContext` outside a user gesture, so
`audioReady()` is called from the start button, the pad buttons and the first
board touch - whichever comes first.

## 12. Responsive design

The board is **not** a fixed 300×600 canvas. CSS decides how big it should be,
and JS matches the canvas backing store to whatever CSS produced:

```js
function sizeCanvas(canvas, ctx) {
  const dpr  = Math.min(devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  canvas.width  = Math.round(rect.width)  * dpr;   // backing store
  canvas.height = Math.round(rect.height) * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);          // draw in CSS pixels
}
view.cell = rect.width / COLS;                     // everything derives from this
```

Three consequences worth having:

- **Crisp on retina.** Backing store at DPR, drawing in CSS pixels, so nothing
  is upscaled and no draw code has to know about pixel ratios.
- **No shared magic numbers.** `style.css` and `script.js` agree on exactly one
  thing: the board is `COLS` cells wide. Change a breakpoint and the game
  re-resolutions itself.
- **Rotation just works.** A `ResizeObserver` on the board wrapper plus
  `resize`/`orientationchange` re-runs `layout()`.

Every size in the renderer is expressed as a multiple of `view.cell` - bevels,
particle sizes, popup fonts, the countdown - so the whole thing scales as one.

### The layouts

| Breakpoint | Shape |
| --- | --- |
| Desktop | Three columns: hold + stats, board, next. Board is **height-driven** (`min(620px, 100vh - 48px)`) so it always fits the window. |
| ≤ 900px | Same, narrower rails. |
| ≤ 720px, or coarse pointer ≤ 900px | HUD strip on top (hold · stats · next), board centred, control pad below. Board is **width-driven**: `min(100%, (100dvh - var(--chrome)) / 2)`, where `--chrome` is the vertical budget for the HUD and pad. |
| ≤ 700px tall | `--chrome` shrinks so the board keeps a usable size on small phones. |
| Landscape, ≤ 560px tall | Pad moves beside the board; board becomes height-driven again. |

`--chrome` is the whole trick for phones: the board takes *whatever vertical
space is left*, so the DROP button is never pushed below the fold. The
`/ 2` is the 1:2 aspect ratio - solving for width from the available height.

The next-piece preview reads its own box and lays the queue out **vertically
when the box is tall and horizontally when it's wide**, so the same canvas
serves the desktop sidebar and the phone's HUD strip with no extra code:

```js
const horizontal = w > h;
```

Other mobile details that matter: `100dvh` rather than `100vh` (so the mobile
browser's collapsing toolbar doesn't crop the pad), `env(safe-area-inset-bottom)`
for the home indicator, `touch-action`/`gesturestart` handling to kill
double-tap zoom and pull-to-refresh, and an auto-pause on `visibilitychange` so
a notification doesn't end your run.


## 13. The screen system

Six `<section class="screen">` elements share the page; exactly one is visible.
There's no router and no framework - just a map and a function:

```js
const screens = {};
document.querySelectorAll('.screen').forEach(s => { screens[s.dataset.screen] = s; });

function showScreen(name) {
  for (const [key, node] of Object.entries(screens)) {
    node.classList.toggle('is-active', key === name);
    node.hidden = key !== name;           // hidden, not just a class
  }
  current = name;
  if (name === 'menu')   refreshMenu();
  if (name === 'scores') renderScores();
  ...
  if (name === 'game')   layout();        // the board had no size until now
}
```

Three details that are easy to get wrong:

- **Use the `hidden` attribute, not only a class**, so screen readers and
  sequential focus skip the inactive screens. But an author `display` beats the
  UA's `[hidden] { display: none }` rule, and several components here set one -
  hence one global `[hidden] { display: none !important; }`. Without it the
  Continue button showed up with no save behind it.
- **Lay out the board on entry.** A canvas inside a hidden screen measures
  0×0, so `layout()` has to run *after* the screen is un-hidden. Do it
  synchronously rather than in `requestAnimationFrame`: rAF is throttled while
  the tab is hidden, which would leave the game un-started until you came back.
- **Re-render on entry, not on change.** `showScreen` refreshes whatever the
  target screen displays. Nothing has to remember to invalidate a view.

### Settings that actually do something

Settings are one plain object, merged over the defaults on load so adding a new
one never breaks an existing save:

```js
let settings = { ...DEFAULT_SETTINGS, ...readJSON(KEY_SETTINGS, {}) };
```

Each is read at the point of use rather than copied into game state - flip
*Ghost piece* and the next frame simply stops drawing it. `effects` combines
with the OS preference in one place:

```js
const fxOn = () => settings.effects && !REDUCED_MOTION;
```

### Saving a run

The save is just the game state, minus everything derivable:

```js
writeJSON(KEY_SAVE, { grid, piece, hold, holdUsed, bag, queue,
                      score, lines, level, combo, backToBack, goal, at });
```

The active piece serialises cleanly because it's a plain object holding a plain
matrix - one more payoff from never storing class instances or functions in
game state. The `goal` rides along too, so resuming a 100-line run after
switching to 20 doesn't hand you an instant win.


---

# Building one yourself

If you're writing this from scratch, this order gets you a playable game fastest
and never leaves you debugging two unknowns at once:

1. **Render a static grid.** A 2D array of colours, a canvas, a draw loop. Hand-
   poke a few values into the array and confirm they appear where you expect.
2. **Drop one hard-coded piece.** Add `{matrix, x, y}` and a `setInterval` that
   increments `y`. Draw it over the grid.
3. **Write `collides()`.** Stop the piece at the floor. This is the keystone -
   everything after it is a use of this one function.
4. **Move and lock.** Arrow keys change `x` if `collides()` says it's safe. On a
   failed downward move, write the piece into the grid and spawn a new one.
5. **Clear lines.** `splice` + `unshift`. Your game is now technically complete.
6. **Add rotation.** Plain matrix rotation first. Play it, hit a wall, and *then*
   add the SRS kick tables - you'll understand what they're for.
7. **Swap `setInterval` for rAF + delta time.** Then add the level/gravity table.
8. **Add feel.** Ghost piece, lock delay, hold, next queue, 7-bag. Each is
   independently small; together they're the difference between a demo and a
   game.
9. **Add the shell.** Scoring, win/lose states, `localStorage` high score, pause,
   overlay, touch controls.
10. **Add juice last.** Shake, particles, popups, sound. Do it only once the
    game is correct - otherwise you will spend an afternoon debugging a
    particle system while a collision bug sits untouched.
11. **Wrap it in screens.** Boot, menu, settings, scores. This is the cheapest
    part of the whole build and the part that makes it feel finished.

## Mistakes that cost the most time

- **Mixing y-up and y-down.** Pick y-down (canvas-native) and convert every
  table you copy from a reference.
- **`setInterval` for gravity.** Ships fine on your 60 Hz laptop, runs at double
  speed on a 120 Hz phone. Use delta time.
- **Mutating the piece before validating.** Always build the candidate
  (rotated matrix, new x/y), test it, *then* commit.
- **Copying arrays by reference.** `SHAPES[type]` must be deep-copied at spawn
  (`.map(row => row.slice())`), or rotating one piece corrupts the template for
  every future piece of that type.
- **No lock delay.** The most common reason a hand-rolled Tetris feels wrong.
- **Forgetting hidden rows.** Without spawn space above the visible field,
  "game over" is ambiguous and pieces appear to materialise mid-board.
- **Refreshing the HUD only on line clears.** Hard-drop points accrue on every
  piece; the score display has to update on every lock, not just on clears.
- **A fixed-size canvas.** Hard-coding 300×600 means blurry on retina and
  unplayable on a phone. Let CSS size the box and derive the cell size from it.
- **Uncapped effects.** Particles and flashes must have hard limits, or a fast
  stack of locks whites out the board and tanks the frame rate.
- **Leaving focus on the Start button.** It keeps DOM focus after the click, so
  the next `Space` re-activates it and restarts the game mid-play. `blur()` it.
- **Creating an `AudioContext` at load.** Browsers suspend it outside a user
  gesture; create or resume it from the first real interaction. The same goes
  for `navigator.vibrate`, which logs a console error until the first tap.
- **Measuring a canvas inside a hidden screen.** It reports 0×0. Size it after
  the screen becomes visible, synchronously.

## Ideas to extend it

- **T-spin detection** - check that three of the four corners around a T's
  centre are occupied after a rotation that needed a kick. Score it above a
  Tetris.
- **Two-player** - a second board plus garbage lines sent on multi-line clears.
- **Marathon vs. sprint** - you already have the goal machinery; expose
  `WIN_LINES` and a timer as a mode selector.
- **Replays** - the game is deterministic given a seed and an input log. Seed
  the shuffle, record `(frame, action)` pairs, and replay is nearly free.
- **Music** - the same oscillator helpers that make the effects would carry a
  simple looping bassline that speeds up with the level.
