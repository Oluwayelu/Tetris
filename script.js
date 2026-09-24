/* ============================================================================
 * TETRIS — vanilla JavaScript
 * ----------------------------------------------------------------------------
 *  1. Constants & piece data   — board size, SRS shapes, kick tables, speeds
 *  2. Storage                  — settings, high scores, saved game
 *  3. DOM handles
 *  4. State                    — game state + a separate `fx` bag for juice
 *  5. Helpers                  — rotation, collision, 7-bag randomiser
 *  6. Mechanics                — spawn, move, rotate, lock, clear, score
 *  7. Juice                    — particles, popups, screen shake, sound
 *  8. Layout                   — resolution-independent canvas sizing
 *  9. Rendering                — board + hold/next previews
 * 10. HUD
 * 11. Game loop                — requestAnimationFrame, delta-time gravity
 * 12. Input                    — keyboard (DAS/ARR), buttons, touch gestures
 * 13. Screens                  — boot, menu, help, scores, settings, game
 * 14. Boot
 *
 * Coordinates: x grows right, y grows DOWN. The board keeps 2 hidden rows at
 * the top for spawning and overflow; only rows 2–21 are painted.
 * ==========================================================================*/

'use strict';

/* ==========================================================================
 * 1. CONSTANTS & PIECE DATA
 * ========================================================================*/

const COLS        = 10;
const ROWS        = 22;              // includes the hidden rows
const HIDDEN_ROWS = 2;
const VIS_ROWS    = ROWS - HIDDEN_ROWS;

const LOCK_DELAY      = 500;  // ms a piece may rest before it locks
const MAX_LOCK_RESETS = 15;   // how often moving may refresh that timer
const CLEAR_ANIM      = 300;  // ms of line-clear animation
const COUNTDOWN       = 1150; // ms of "3 · 2 · 1" before play starts

/** Spawn orientations, SRS-standard. Square matrices so rotation is arithmetic. */
const SHAPES = {
  I: [[0,0,0,0],
      [1,1,1,1],
      [0,0,0,0],
      [0,0,0,0]],
  J: [[1,0,0],
      [1,1,1],
      [0,0,0]],
  L: [[0,0,1],
      [1,1,1],
      [0,0,0]],
  O: [[1,1],
      [1,1]],
  S: [[0,1,1],
      [1,1,0],
      [0,0,0]],
  T: [[0,1,0],
      [1,1,1],
      [0,0,0]],
  Z: [[1,1,0],
      [0,1,1],
      [0,0,0]],
};

/** Each piece gets a base colour plus a lighter tint for the bevel/glow. */
const COLORS = {
  I: ['#22d3ee', '#a5f3fc'],
  J: ['#3b82f6', '#bfdbfe'],
  L: ['#f97316', '#fed7aa'],
  O: ['#facc15', '#fef08a'],
  S: ['#4ade80', '#bbf7d0'],
  T: ['#a855f7', '#e9d5ff'],
  Z: ['#ef4444', '#fecaca'],
};

const TYPES = Object.keys(SHAPES);

/**
 * Super Rotation System wall kicks. Key is "<from><to>", states 0=spawn,
 * 1=CW, 2=180, 3=CCW. Offsets are already converted to screen space (y down).
 */
const KICKS_JLSTZ = {
  '01': [[0,0], [-1,0], [-1,-1], [0, 2], [-1, 2]],
  '10': [[0,0], [ 1,0], [ 1, 1], [0,-2], [ 1,-2]],
  '12': [[0,0], [ 1,0], [ 1, 1], [0,-2], [ 1,-2]],
  '21': [[0,0], [-1,0], [-1,-1], [0, 2], [-1, 2]],
  '23': [[0,0], [ 1,0], [ 1,-1], [0, 2], [ 1, 2]],
  '32': [[0,0], [-1,0], [-1, 1], [0,-2], [-1,-2]],
  '30': [[0,0], [-1,0], [-1, 1], [0,-2], [-1,-2]],
  '03': [[0,0], [ 1,0], [ 1,-1], [0, 2], [ 1, 2]],
};

const KICKS_I = {
  '01': [[0,0], [-2,0], [ 1,0], [-2, 1], [ 1,-2]],
  '10': [[0,0], [ 2,0], [-1,0], [ 2,-1], [-1, 2]],
  '12': [[0,0], [-1,0], [ 2,0], [-1,-2], [ 2, 1]],
  '21': [[0,0], [ 1,0], [-2,0], [ 1, 2], [-2,-1]],
  '23': [[0,0], [ 2,0], [-1,0], [ 2,-1], [-1, 2]],
  '32': [[0,0], [-2,0], [ 1,0], [-2, 1], [ 1,-2]],
  '30': [[0,0], [ 1,0], [-2,0], [ 1, 2], [-2,-1]],
  '03': [[0,0], [-1,0], [ 2,0], [-1,-2], [ 2, 1]],
};

/** Gravity interval in ms, indexed by level (index 0 unused). */
const GRAVITY = [0, 1000, 793, 618, 473, 355, 262, 190, 135, 94, 64, 46, 32, 22, 16, 12];
const MAX_LEVEL = GRAVITY.length - 1;

/** Base line-clear scores, multiplied by the current level. */
const LINE_SCORE = [0, 100, 300, 500, 800];
const CLEAR_NAME = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];

/** Cached once: getComputedStyle in a per-frame draw call is a real cost. */
const FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif';

const REDUCED_MOTION =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ==========================================================================
 * 2. STORAGE — settings, high scores, saved game
 * ========================================================================*/

const KEY_BEST     = 'tetris.highscore.v1';
const KEY_SCORES   = 'tetris.scores.v1';
const KEY_SETTINGS = 'tetris.settings.v1';
const KEY_SAVE     = 'tetris.save.v1';

/* localStorage throws in some private-browsing modes — never let that break play. */
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* non-fatal */ }
}
function removeKey(key) {
  try { localStorage.removeItem(key); } catch { /* non-fatal */ }
}

const DEFAULT_SETTINGS = {
  sound:      true,
  haptics:    true,
  effects:    true,
  ghost:      true,
  countdown:  true,
  goal:       40,   // lines to win; 0 = endless
  startLevel: 1,
};

/** Merged with defaults so a new setting doesn't break an old saved object. */
let settings = { ...DEFAULT_SETTINGS, ...readJSON(KEY_SETTINGS, {}) };

function saveSettings() { writeJSON(KEY_SETTINGS, settings); }

/** Effects are on only when the user wants them AND the OS allows motion. */
const fxOn = () => settings.effects && !REDUCED_MOTION;

/* ── High scores ────────────────────────────────────────────────────────── */

let scores = readJSON(KEY_SCORES, []);
let best   = Number(readJSON(KEY_BEST, 0)) || 0;

function recordScore(entry) {
  scores.push({ ...entry, at: Date.now() });
  scores.sort((a, b) => b.score - a.score);
  scores = scores.slice(0, 10);
  writeJSON(KEY_SCORES, scores);
  if (entry.score > best) { best = entry.score; writeJSON(KEY_BEST, best); }
}

/* ── Saved game (the Continue entry) ────────────────────────────────────── */

function saveGame() {
  if (!['playing', 'paused', 'countdown'].includes(state.phase)) return;
  writeJSON(KEY_SAVE, {
    grid: state.grid, piece: state.piece, hold: state.hold, holdUsed: state.holdUsed,
    bag: state.bag, queue: state.queue, score: state.score, lines: state.lines,
    level: state.level, combo: state.combo, backToBack: state.backToBack,
    goal: settings.goal, at: Date.now(),
  });
}

const getSave  = () => readJSON(KEY_SAVE, null);
const clearSave = () => removeKey(KEY_SAVE);

/* ==========================================================================
 * 3. DOM HANDLES
 * ========================================================================*/

const boardCanvas = document.getElementById('board');
const boardCtx    = boardCanvas.getContext('2d');
const holdCanvas  = document.getElementById('hold');
const holdCtx     = holdCanvas.getContext('2d');
const nextCanvas  = document.getElementById('next');
const nextCtx     = nextCanvas.getContext('2d');

const el = {
  wrap:     document.getElementById('board-wrap'),
  holdPane: document.querySelector('.panel--hold'),
  score:    document.getElementById('score'),
  best:     document.getElementById('best'),
  lines:    document.getElementById('lines'),
  level:    document.getElementById('level'),
  goalWrap: document.getElementById('goal-wrap'),
  goalText: document.getElementById('goal-text'),
  goalBar:  document.getElementById('goal-bar'),
  overlay:  document.getElementById('overlay'),
  oTitle:   document.getElementById('overlay-title'),
  oMsg:     document.getElementById('overlay-msg'),
  oBtn:     document.getElementById('overlay-btn'),
  oBtn2:    document.getElementById('overlay-btn2'),
  pauseBtn: document.getElementById('pause'),
  live:     document.getElementById('live'),
  // screens & menu
  bootFill:   document.getElementById('boot-fill'),
  bootStatus: document.getElementById('boot-status'),
  menuBest:   document.getElementById('menu-best'),
  menuTag:    document.getElementById('menu-tag'),
  btnContinue: document.getElementById('btn-continue'),
  continueInfo: document.getElementById('continue-info'),
  helpGoal:   document.getElementById('help-goal'),
  scoresBest: document.getElementById('scores-best'),
  scoresBody: document.getElementById('scores-body'),
  scoresEmpty: document.getElementById('scores-empty'),
};

/* ==========================================================================
 * 4. STATE
 * ========================================================================*/

/** phase: 'idle' | 'countdown' | 'playing' | 'paused' | 'clearing' | 'won' | 'lost' */
const state = {
  phase:      'idle',
  grid:       [],
  piece:      null,      // { type, matrix, x, y, rotation, spawnT }
  hold:       null,
  holdUsed:   false,
  bag:        [],
  queue:      [],
  score:      0,
  lines:      0,
  level:      1,
  combo:      -1,
  backToBack: false,
  clearRows:  [],
  dropTimer:  0,
  lockTimer:  0,
  lockResets: 0,
  clearTimer: 0,
  countTimer: 0,
};

/** Everything purely cosmetic lives here, so the game logic stays readable. */
const fx = {
  particles: [],   // { x, y, vx, vy, life, max, size, color, rot, vrot }
  popups:    [],   // { text, sub, x, y, life, max, color }
  trails:    [],   // { cells, y0, y1, life, max, color }
  flashes:   [],   // { cells, life, max }  — lock flash
  shake:     { t: 0, max: 0, mag: 0 },
};

/* Geometry filled in by layout(). */
const view = { cell: 0, dpr: 1, w: 0, h: 0 };

/* ==========================================================================
 * 5. HELPERS
 * ========================================================================*/

function emptyGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand  = (lo, hi) => lo + Math.random() * (hi - lo);

/** Rotate a square matrix 90° clockwise. */
function rotateCW(m) {
  const n = m.length;
  return m.map((row, y) => row.map((_, x) => m[n - 1 - x][y]));
}
/** Rotate a square matrix 90° counter-clockwise. */
function rotateCCW(m) {
  const n = m.length;
  return m.map((row, y) => row.map((_, x) => m[x][n - 1 - y]));
}

/** Run `fn(boardX, boardY)` for every filled cell of a matrix placed at an origin. */
function eachCell(matrix, originX, originY, fn) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (matrix[y][x]) fn(originX + x, originY + y);
    }
  }
}

/**
 * True when the matrix placed at (x, y) overlaps a wall, the floor, or a
 * locked cell. Every mechanic in the game is a question asked of this one.
 */
function collides(matrix, x, y) {
  for (let ry = 0; ry < matrix.length; ry++) {
    for (let rx = 0; rx < matrix[ry].length; rx++) {
      if (!matrix[ry][rx]) continue;
      const bx = x + rx, by = y + ry;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && state.grid[by][bx]) return true;
    }
  }
  return false;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 7-bag randomiser: deal all seven, reshuffle. No 20-piece I droughts. */
function nextType() {
  if (state.bag.length === 0) state.bag = shuffle(TYPES.slice());
  return state.bag.pop();
}
function refillQueue() {
  while (state.queue.length < 3) state.queue.push(nextType());
}

const firstFilledRow = (m) => m.findIndex(row => row.some(Boolean));

/** Height of the tallest column, in visible rows — drives the danger glow. */
function stackHeight() {
  for (let y = HIDDEN_ROWS; y < ROWS; y++) {
    if (state.grid[y].some(Boolean)) return ROWS - y;
  }
  return 0;
}

/** Level from lines cleared, never below the chosen starting level. */
function levelFor(lines) {
  return clamp(Math.max(settings.startLevel, Math.floor(lines / 10) + 1), 1, MAX_LEVEL);
}

/* ==========================================================================
 * 6. MECHANICS
 * ========================================================================*/

function makePiece(type) {
  const matrix = SHAPES[type].map(row => row.slice()); // deep copy: never mutate the template
  return {
    type,
    matrix,
    rotation: 0,
    x: Math.floor((COLS - matrix.length) / 2),
    y: HIDDEN_ROWS - firstFilledRow(matrix),
    spawnT: 0,
  };
}

/** Take the next piece from the queue. Returns false on a spawn block-out. */
function spawn(type = null) {
  refillQueue();
  const piece = makePiece(type ?? state.queue.shift());
  refillQueue();

  state.piece      = piece;
  state.holdUsed   = false;
  state.dropTimer  = 0;
  state.lockTimer  = 0;
  state.lockResets = 0;

  if (collides(piece.matrix, piece.x, piece.y)) { gameOver(); return false; }
  return true;
}

function move(dx, dy, quiet = false) {
  const p = state.piece;
  if (!p) return false;
  if (collides(p.matrix, p.x + dx, p.y + dy)) return false;
  p.x += dx;
  p.y += dy;
  touchLockTimer();
  if (!quiet && dx) sfx.move();
  return true;
}

/** Rotate with SRS wall kicks: try the pure rotation, then up to four nudges. */
function rotate(dir) {
  const p = state.piece;
  if (!p || p.type === 'O') return false;   // O is identical in every state

  const matrix = dir === 1 ? rotateCW(p.matrix) : rotateCCW(p.matrix);
  const from   = p.rotation;
  const to     = (from + (dir === 1 ? 1 : 3)) % 4;
  const kicks  = (p.type === 'I' ? KICKS_I : KICKS_JLSTZ)[`${from}${to}`] || [[0, 0]];

  for (const [dx, dy] of kicks) {
    if (!collides(matrix, p.x + dx, p.y + dy)) {
      p.matrix = matrix; p.rotation = to; p.x += dx; p.y += dy;
      touchLockTimer();
      sfx.rotate();
      return true;
    }
  }
  sfx.deny();
  return false;
}

/** A successful move while grounded re-arms the lock delay (capped). */
function touchLockTimer() {
  if (state.lockResets < MAX_LOCK_RESETS && isGrounded()) {
    state.lockTimer = 0;
    state.lockResets++;
  }
}

function isGrounded() {
  const p = state.piece;
  return !!p && collides(p.matrix, p.x, p.y + 1);
}

/** How far straight down the piece can travel — ghost and hard drop use this. */
function dropDistance() {
  const p = state.piece;
  let d = 0;
  while (!collides(p.matrix, p.x, p.y + d + 1)) d++;
  return d;
}

function softDrop() {
  if (move(0, 1, true)) {
    state.score += 1;
    state.lockTimer = 0;   // falling freely, the delay hasn't started
    updateStats();
  }
}

function hardDrop() {
  const p = state.piece;
  if (!p) return;
  const d = dropDistance();
  if (d > 0) addTrail(p, p.y, p.y + d);
  p.y += d;
  state.score += d * 2;
  updateStats();
  sfx.drop();
  shake(clamp(d * 0.5, 2, 9), 220);
  buzz(12);
  lock(true);
}

/** Swap the active piece with the hold slot (once per piece). */
function holdPiece() {
  if (state.holdUsed || !state.piece) return;
  const current = state.piece.type;
  const swap    = state.hold;
  state.hold    = current;
  spawn(swap ?? null);     // null → pull a fresh piece from the queue
  state.holdUsed = true;   // set after spawn(), which resets it
  sfx.hold();
  buzz(8);
  el.holdPane.classList.remove('flash');
  void el.holdPane.offsetWidth;
  el.holdPane.classList.add('flash');
  drawHold();
  drawNext();
}

/** Freeze the active piece into the grid and resolve the consequences. */
function lock(wasHard = false) {
  const p = state.piece;
  const cells = [];
  let topOut = true;

  eachCell(p.matrix, p.x, p.y, (x, y) => {
    if (y >= 0) state.grid[y][x] = p.type;
    if (y >= HIDDEN_ROWS) topOut = false;
    cells.push([x, y]);
  });

  fx.flashes.push({ cells, life: 0, max: 130 });
  if (fx.flashes.length > 3) fx.flashes.shift();
  if (!wasHard) { sfx.lock(); shake(2, 120); }

  // Dust puff along the bottom edge of the piece.
  for (const [x, y] of cells) {
    if (y >= HIDDEN_ROWS && !cells.some(([cx, cy]) => cx === x && cy === y + 1)) {
      burst(x + 0.5, y + 1, COLORS[p.type][0], wasHard ? 4 : 2, wasHard ? 1.6 : 1);
    }
  }

  state.piece = null;

  // Lock-out: the whole piece came to rest inside the hidden rows.
  if (topOut) { gameOver(); return; }

  const full = [];
  for (let y = 0; y < ROWS; y++) if (state.grid[y].every(Boolean)) full.push(y);

  if (full.length) {
    beginClear(full);
  } else {
    state.combo = -1;   // a lock with no clear ends the combo chain
    if (!spawn()) return;
    drawNext();
  }
  updateStats();
  saveGame();
}

/** Kick off the line-clear animation; resolveClear() finishes the bookkeeping. */
function beginClear(rows) {
  state.clearRows  = rows;
  state.clearTimer = 0;
  state.phase      = 'clearing';

  for (const y of rows) {
    for (let x = 0; x < COLS; x++) {
      burst(x + 0.5, y + 0.5, COLORS[state.grid[y][x]][0], 7, 2.2);
    }
  }
  sfx.clear(rows.length);
  shake(rows.length === 4 ? 14 : 4 + rows.length * 2, 300);
  buzz(rows.length === 4 ? [18, 40, 18] : 20);
}

/** Remove the cleared rows, award points, bump the level, check the win. */
function resolveClear() {
  const cleared = state.clearRows.length;

  // splice + unshift shifts everything above down by one, for free.
  for (const y of state.clearRows) {
    state.grid.splice(y, 1);
    state.grid.unshift(new Array(COLS).fill(null));
  }
  const lowest = Math.max(...state.clearRows);
  state.clearRows = [];

  let points     = LINE_SCORE[cleared] * state.level;
  const isTetris = cleared === 4;
  const b2b      = isTetris && state.backToBack;
  if (b2b) points = Math.floor(points * 1.5);
  state.backToBack = isTetris;

  state.combo++;
  if (state.combo > 0) points += 50 * state.combo * state.level;

  const prevLevel = state.level;
  state.score += points;
  state.lines += cleared;
  state.level  = levelFor(state.lines);

  if (state.score > best) { best = state.score; writeJSON(KEY_BEST, best); }

  const sub = [
    b2b ? 'BACK-TO-BACK' : '',
    state.combo > 0 ? `COMBO ×${state.combo}` : '',
  ].filter(Boolean).join('  ');
  popup(CLEAR_NAME[cleared], `+${points}${sub ? '  ' + sub : ''}`,
        COLS / 2, lowest - HIDDEN_ROWS + 0.5,
        isTetris ? '#facc15' : '#4cc9f0');

  if (state.level > prevLevel) {
    popup(`LEVEL ${state.level}`, 'SPEED UP', COLS / 2, VIS_ROWS * 0.34, '#a855f7');
    sfx.levelUp();
    shake(9, 340);
  }

  updateStats(true);
  announce(`${cleared} line${cleared > 1 ? 's' : ''} cleared. Score ${state.score}.`);

  if (settings.goal > 0 && state.lines >= settings.goal) { win(); return; }

  state.phase = 'playing';
  if (spawn()) { drawNext(); saveGame(); }
}

/* ── End states ─────────────────────────────────────────────────────────── */

function finish(won) {
  recordScore({ score: state.score, lines: state.lines, level: state.level, won });
  clearSave();
  updateStats();
  refreshMenu();
}

function win() {
  state.phase = 'won';
  finish(true);
  sfx.win();
  confetti();
  showOverlay('win', 'YOU WIN',
    `${state.lines} lines cleared with ${state.score.toLocaleString()} points.`,
    'Play again');
  announce('You win!');
}

function gameOver() {
  state.phase = 'lost';
  const record = state.score > 0 && state.score >= best;
  finish(false);
  sfx.gameOver();
  shake(16, 520);
  buzz([30, 60, 30, 60, 90]);
  for (let y = HIDDEN_ROWS; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (state.grid[y][x] && Math.random() < 0.45) {
        burst(x + 0.5, y + 0.5, COLORS[state.grid[y][x]][0], 2, 1.4);
      }
    }
  }
  showOverlay('lose', 'GAME OVER',
    `${state.lines} lines · ${state.score.toLocaleString()} points` +
    (record ? ' · new best!' : ` · best ${best.toLocaleString()}`),
    'Try again');
  announce('Game over.');
}

/* ── Session control ────────────────────────────────────────────────────── */

function resetFx() {
  fx.particles.length = 0;
  fx.popups.length    = 0;
  fx.trails.length    = 0;
  fx.flashes.length   = 0;
  fx.shake.t = 0; fx.shake.mag = 0;
  el.wrap.style.transform = '';
}

function newGame() {
  clearSave();
  Object.assign(state, {
    grid: emptyGrid(), piece: null, hold: null, holdUsed: false,
    bag: [], queue: [], score: 0, lines: 0, level: levelFor(0),
    combo: -1, backToBack: false, clearRows: [],
    dropTimer: 0, lockTimer: 0, lockResets: 0, clearTimer: 0, countTimer: 0,
    phase: settings.countdown ? 'countdown' : 'playing',
  });
  resetFx();
  hideOverlay();
  updateStats();
  spawn();            // visible immediately; gravity waits for the countdown
  drawHold();
  drawNext();
  audioReady();       // called inside a user gesture, so audio unlocks here
}

/** Restore the saved run behind the Continue button. */
function continueGame() {
  const s = getSave();
  if (!s) { newGame(); return; }

  Object.assign(state, {
    grid: s.grid, piece: s.piece, hold: s.hold, holdUsed: s.holdUsed,
    bag: s.bag, queue: s.queue, score: s.score, lines: s.lines, level: s.level,
    combo: s.combo, backToBack: s.backToBack, clearRows: [],
    dropTimer: 0, lockTimer: 0, lockResets: 0, clearTimer: 0, countTimer: 0,
    phase: settings.countdown ? 'countdown' : 'playing',
  });
  // A save made under a different goal would otherwise be unwinnable/instant.
  if (typeof s.goal === 'number') { settings.goal = s.goal; saveSettings(); }
  if (!state.piece) spawn();

  resetFx();
  hideOverlay();
  updateStats();
  drawHold();
  drawNext();
  audioReady();
}

function togglePause() {
  if (state.phase === 'playing' || state.phase === 'countdown') {
    state.phase = 'paused';
    saveGame();
    showOverlay('pause', 'PAUSED', 'Take your time.', 'Resume');
  } else if (state.phase === 'paused') {
    state.phase = settings.countdown ? 'countdown' : 'playing';
    state.countTimer = COUNTDOWN * 0.45;   // short re-entry count
    hideOverlay();
  }
}

/** Leave the game, keeping the run on the Continue button if it's still live. */
function quitToMenu() {
  if (['playing', 'paused', 'countdown', 'clearing'].includes(state.phase)) saveGame();
  state.phase = 'idle';
  hideOverlay();
  resetFx();
  showScreen('menu');
}

/* ==========================================================================
 * 7. JUICE — particles, popups, shake, haptics, sound
 * ========================================================================*/

/** Screen shake is written straight onto the wrapper's transform each frame. */
function shake(mag, ms) {
  if (!fxOn()) return;
  fx.shake.mag = Math.max(fx.shake.mag, mag);
  fx.shake.max = ms;
  fx.shake.t   = ms;
}

/** Spawn `n` particles at a board coordinate (in cells, fractional allowed). */
function burst(cx, cy, color, n, power = 1) {
  if (!fxOn()) return;
  for (let i = 0; i < n; i++) {
    fx.particles.push({
      x: cx, y: cy,
      vx: rand(-3.4, 3.4) * power,
      vy: rand(-5.5, -0.5) * power,
      life: 0, max: rand(380, 820),
      size: rand(0.12, 0.3),
      color,
      rot: rand(0, Math.PI * 2),
      vrot: rand(-0.25, 0.25),
    });
  }
  if (fx.particles.length > 420) fx.particles.splice(0, fx.particles.length - 420);
}

function confetti() {
  if (!fxOn()) return;
  for (let i = 0; i < 140; i++) {
    fx.particles.push({
      x: rand(0, COLS), y: rand(-4, 2),
      vx: rand(-2, 2), vy: rand(1, 4),
      life: 0, max: rand(1200, 2400),
      size: rand(0.14, 0.32), color: COLORS[TYPES[i % TYPES.length]][0],
      rot: rand(0, 6.28), vrot: rand(-0.3, 0.3),
    });
  }
}

/** Floating text. `y` is in VISIBLE rows. */
function popup(text, sub, x, y, color) {
  fx.popups.push({ text, sub, x, y: clamp(y, 2, VIS_ROWS - 2), life: 0, max: 1100, color });
}

/** Fading afterimage of a hard-dropped piece. */
function addTrail(piece, y0, y1) {
  if (!fxOn()) return;
  const cells = [];
  eachCell(piece.matrix, piece.x, 0, (x, y) => cells.push([x, y]));
  fx.trails.push({ cells, y0, y1, life: 0, max: 260, color: COLORS[piece.type][0] });
  if (fx.trails.length > 3) fx.trails.shift();
}

/**
 * Vibration API. Browsers refuse (and log) a vibrate before the first real
 * user gesture, so wait for one rather than spamming the console.
 */
let hasInteracted = false;
['pointerdown', 'keydown'].forEach(type =>
  window.addEventListener(type, () => { hasInteracted = true; }, { once: true, capture: true }));

function buzz(pattern) {
  if (!hasInteracted || !settings.haptics || REDUCED_MOTION) return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

/* ── Sound: tiny Web Audio synth, no asset files ────────────────────────── */

let actx = null;
let master = null;

function audioReady() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  master = actx.createGain();
  master.gain.value = settings.sound ? 0.5 : 0;
  master.connect(actx.destination);
}

/** One enveloped oscillator. `slide` sweeps the pitch over the note. */
function tone({ freq, type = 'square', dur = 0.08, vol = 0.14, slide = 0, delay = 0 }) {
  if (!actx || !settings.sound) return;
  const t = actx.currentTime + delay;
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain); gain.connect(master);
  osc.start(t); osc.stop(t + dur + 0.02);
}

/** Filtered white noise — the percussive half of the drop/lock sounds. */
function noise({ dur = 0.09, vol = 0.1, freq = 1200, delay = 0 }) {
  if (!actx || !settings.sound) return;
  const t = actx.currentTime + delay;
  const len = Math.max(1, Math.floor(actx.sampleRate * dur));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = actx.createBufferSource(); src.buffer = buf;
  const filter = actx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = freq;
  const gain = actx.createGain(); gain.gain.value = vol;
  src.connect(filter); filter.connect(gain); gain.connect(master);
  src.start(t);
}

const sfx = {
  move:   () => tone({ freq: 220, type: 'square',   dur: 0.03, vol: 0.05 }),
  rotate: () => tone({ freq: 380, type: 'triangle', dur: 0.05, vol: 0.09, slide: 90 }),
  deny:   () => tone({ freq: 110, type: 'sawtooth', dur: 0.05, vol: 0.05 }),
  ui:     () => tone({ freq: 620, type: 'triangle', dur: 0.05, vol: 0.07, slide: 140 }),
  hold:   () => { tone({ freq: 500, type: 'sine', dur: 0.07, vol: 0.1 });
                  tone({ freq: 760, type: 'sine', dur: 0.09, vol: 0.08, delay: 0.05 }); },
  lock:   () => { tone({ freq: 130, type: 'square', dur: 0.06, vol: 0.09, slide: -50 });
                  noise({ dur: 0.05, vol: 0.05, freq: 900 }); },
  drop:   () => { tone({ freq: 90, type: 'square', dur: 0.1, vol: 0.13, slide: -45 });
                  noise({ dur: 0.1, vol: 0.1, freq: 1600 }); },
  clear:  (n) => {
    const base = [0, 440, 494, 587, 659][n] || 440;
    const steps = n === 4 ? [0, 4, 7, 12, 16] : [0, 4, 7];
    steps.forEach((s, i) => tone({
      freq: base * Math.pow(2, s / 12),
      type: n === 4 ? 'square' : 'triangle',
      dur: 0.16, vol: 0.12, delay: i * 0.055,
    }));
    if (n === 4) noise({ dur: 0.3, vol: 0.09, freq: 2600 });
  },
  levelUp: () => [523, 659, 784, 1046].forEach((f, i) =>
    tone({ freq: f, type: 'triangle', dur: 0.14, vol: 0.12, delay: i * 0.07 })),
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) =>
    tone({ freq: f, type: 'square', dur: 0.26, vol: 0.13, delay: i * 0.11 })),
  gameOver: () => [392, 330, 262, 196].forEach((f, i) =>
    tone({ freq: f, type: 'sawtooth', dur: 0.3, vol: 0.12, delay: i * 0.14 })),
  count: (final) => tone({
    freq: final ? 880 : 440, type: 'triangle',
    dur: final ? 0.22 : 0.1, vol: 0.12,
  }),
};

/* ==========================================================================
 * 8. LAYOUT — resolution-independent canvas sizing
 * ========================================================================*/

/**
 * CSS decides how big each canvas box is; this reads the result and matches
 * the backing store to it at device pixel ratio, so the game is crisp on
 * retina phones and re-resolutions itself on rotate/resize.
 */
function sizeCanvas(canvas, ctx) {
  const dpr  = Math.min(window.devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, dpr };
}

function layout() {
  // The game screen may be hidden (zero-sized) — nothing to lay out yet.
  if (!boardCanvas.getBoundingClientRect().width) return;

  const b = sizeCanvas(boardCanvas, boardCtx);
  view.w = b.w; view.h = b.h; view.dpr = b.dpr;
  view.cell = b.w / COLS;          // board is always exactly COLS cells wide

  sizeCanvas(holdCanvas, holdCtx);
  sizeCanvas(nextCanvas, nextCtx);

  drawBoard();
  drawHold();
  drawNext();
}

/* ==========================================================================
 * 9. RENDERING
 * ========================================================================*/

/** One block: fill, top-left bevel, bottom shade, outline. */
function drawCell(ctx, px, py, size, colors, alpha = 1, scale = 1) {
  const s = size * scale;
  const ox = px + (size - s) / 2;
  const oy = py + (size - s) / 2;
  const r  = Math.max(1, s * 0.14);
  const [base, light] = Array.isArray(colors) ? colors : [colors, colors];

  ctx.globalAlpha = alpha;

  ctx.beginPath();
  ctx.roundRect(ox, oy, s, s, r);
  ctx.fillStyle = base;
  ctx.fill();

  ctx.fillStyle = light;
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillRect(ox + s * 0.1, oy + s * 0.1, s * 0.8, Math.max(1, s * 0.13));
  ctx.fillRect(ox + s * 0.1, oy + s * 0.1, Math.max(1, s * 0.13), s * 0.8);

  ctx.globalAlpha = alpha * 0.3;
  ctx.fillStyle = '#000';
  ctx.fillRect(ox + s * 0.1, oy + s * 0.78, s * 0.8, s * 0.12);

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(0,0,0,.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(ox + 0.5, oy + 0.5, s - 1, s - 1, r);
  ctx.stroke();

  ctx.globalAlpha = 1;
}

function drawGridLines(ctx, cell) {
  ctx.strokeStyle = 'rgba(80,110,170,.09)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < COLS; x++) { ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, view.h); }
  for (let y = 1; y < VIS_ROWS; y++) { ctx.moveTo(0, y * cell); ctx.lineTo(view.w, y * cell); }
  ctx.stroke();
}

function drawBoard() {
  const ctx  = boardCtx;
  const cell = view.cell;
  if (!cell) return;

  ctx.clearRect(0, 0, view.w, view.h);

  const g = ctx.createLinearGradient(0, 0, 0, view.h);
  g.addColorStop(0, '#0b1224');
  g.addColorStop(1, '#070c18');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
  drawGridLines(ctx, cell);

  // ── Locked cells ──────────────────────────────────────────
  for (let y = HIDDEN_ROWS; y < ROWS; y++) {
    const clearing = state.clearRows.includes(y);
    // During a clear the row flashes white, then collapses vertically.
    let scale = 1, alpha = 1, white = false;
    if (clearing) {
      const t = clamp(state.clearTimer / CLEAR_ANIM, 0, 1);
      white = t < 0.35;
      scale = 1 - Math.max(0, (t - 0.3) / 0.7);
      alpha = 1 - Math.max(0, (t - 0.45) / 0.55);
    }
    for (let x = 0; x < COLS; x++) {
      const type = state.grid[y]?.[x];
      if (!type) continue;
      drawCell(ctx, x * cell, (y - HIDDEN_ROWS) * cell, cell,
               white ? ['#ffffff', '#ffffff'] : COLORS[type], alpha, scale);
    }
  }

  // ── Hard-drop trails ──────────────────────────────────────
  for (const tr of fx.trails) {
    const t = tr.life / tr.max;
    ctx.globalAlpha = (1 - t) * 0.45;
    for (const [cx, cy] of tr.cells) {
      const top = Math.max(0, (tr.y0 + cy - HIDDEN_ROWS) * cell);
      const bot = (tr.y1 + cy - HIDDEN_ROWS) * cell;
      if (bot <= top) continue;
      // Fade the streak out towards the top, so it reads as motion, not a bar.
      const grad = ctx.createLinearGradient(0, top, 0, bot);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, tr.color);
      ctx.fillStyle = grad;
      ctx.fillRect(cx * cell + cell * 0.26, top, cell * 0.48, bot - top);
    }
    ctx.globalAlpha = 1;
  }

  // ── Active piece + ghost ──────────────────────────────────
  const p = state.piece;
  if (p) {
    if (settings.ghost) {
      const ghostY = p.y + dropDistance();
      const pulse = REDUCED_MOTION ? 0.2 : 0.16 + Math.sin(performance.now() / 260) * 0.06;
      eachCell(p.matrix, p.x, ghostY, (x, y) => {
        if (y < HIDDEN_ROWS) return;
        const px = x * cell, py = (y - HIDDEN_ROWS) * cell;
        ctx.globalAlpha = pulse + 0.18;
        ctx.strokeStyle = COLORS[p.type][1];
        ctx.lineWidth = Math.max(1, cell * 0.07);
        ctx.beginPath();
        ctx.roundRect(px + cell * 0.12, py + cell * 0.12, cell * 0.76, cell * 0.76, cell * 0.12);
        ctx.stroke();
        ctx.globalAlpha = pulse * 0.5;
        ctx.fillStyle = COLORS[p.type][0];
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    }

    // Piece, with a short scale-in on spawn and a glow when it's about to lock.
    const intro = REDUCED_MOTION ? 1 : clamp(p.spawnT / 130, 0, 1);
    const scale = 0.7 + 0.3 * (1 - Math.pow(1 - intro, 3));
    const lockGlow = isGrounded() ? clamp(state.lockTimer / LOCK_DELAY, 0, 1) : 0;

    if (lockGlow > 0) {
      ctx.shadowColor = COLORS[p.type][1];
      ctx.shadowBlur = cell * 0.5 * lockGlow;
    }
    eachCell(p.matrix, p.x, p.y, (x, y) => {
      if (y >= HIDDEN_ROWS) {
        drawCell(ctx, x * cell, (y - HIDDEN_ROWS) * cell, cell, COLORS[p.type], 1, scale);
      }
    });
    ctx.shadowBlur = 0;
  }

  // ── Lock flashes ──────────────────────────────────────────
  for (const f of fx.flashes) {
    ctx.globalAlpha = (1 - f.life / f.max) * 0.85;
    ctx.fillStyle = '#fff';
    for (const [x, y] of f.cells) {
      if (y < HIDDEN_ROWS) continue;
      ctx.beginPath();
      ctx.roundRect(x * cell, (y - HIDDEN_ROWS) * cell, cell, cell, cell * 0.14);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawParticles(ctx, cell);
  drawPopups(ctx, cell);
  if (state.phase === 'countdown') drawCountdown(ctx);
}

function drawParticles(ctx, cell) {
  for (const p of fx.particles) {
    const t = p.life / p.max;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.95;
    ctx.translate(p.x * cell, (p.y - HIDDEN_ROWS) * cell);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    const s = p.size * cell * (1 - t * 0.35);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawPopups(ctx, cell) {
  for (const p of fx.popups) {
    const t = p.life / p.max;
    // Overshoot in, drift up, fade out.
    const grow = t < 0.18 ? 0.5 + 2.8 * t : 1 + Math.max(0, 0.1 - t * 0.1);
    const rise = -t * cell * 2.2;
    const alpha = t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28;

    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.translate(p.x * cell, p.y * cell + rise);
    ctx.scale(grow, grow);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = `800 ${cell * 0.92}px ${FONT}`;
    ctx.lineWidth = cell * 0.18;
    ctx.strokeStyle = 'rgba(4,8,18,.85)';
    ctx.strokeText(p.text, 0, 0);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, 0, 0);

    if (p.sub) {
      ctx.font = `700 ${cell * 0.4}px ${FONT}`;
      ctx.lineWidth = cell * 0.12;
      ctx.strokeText(p.sub, 0, cell * 0.8);
      ctx.fillStyle = '#e8eefb';
      ctx.fillText(p.sub, 0, cell * 0.8);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawCountdown(ctx) {
  const left = COUNTDOWN - state.countTimer;
  const n = Math.ceil(left / (COUNTDOWN / 3));
  const label = n <= 0 ? 'GO' : String(n);
  const phase = (left % (COUNTDOWN / 3)) / (COUNTDOWN / 3);   // 1 → 0 within a beat

  ctx.save();
  ctx.globalAlpha = clamp(phase * 1.4, 0, 1);
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(0.7 + phase * 0.8, 0.7 + phase * 0.8);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${view.cell * 2.6}px ${FONT}`;
  ctx.lineWidth = view.cell * 0.22;
  ctx.strokeStyle = 'rgba(4,8,18,.9)';
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = label === 'GO' ? '#4ade80' : '#4cc9f0';
  ctx.fillText(label, 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Draw a piece centred in a box. Used by both preview canvases. */
function drawPreview(ctx, type, bx, by, bw, bh, alpha = 1) {
  if (!type) return;
  const cells = [];
  eachCell(SHAPES[type], 0, 0, (x, y) => cells.push([x, y]));
  const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
  const cw = Math.max(...xs) - Math.min(...xs) + 1;
  const ch = Math.max(...ys) - Math.min(...ys) + 1;

  const size = Math.min(bw / (cw + 0.8), bh / (ch + 0.8));
  const ox = bx + (bw - cw * size) / 2 - Math.min(...xs) * size;
  const oy = by + (bh - ch * size) / 2 - Math.min(...ys) * size;

  for (const [x, y] of cells) {
    drawCell(ctx, ox + x * size, oy + y * size, size, COLORS[type], alpha);
  }
}

function paneBackdrop(ctx) {
  const dpr = view.dpr || 1;
  const w = ctx.canvas.width / dpr, h = ctx.canvas.height / dpr;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a1020';
  ctx.fillRect(0, 0, w, h);
  return { w, h };
}

function drawHold() {
  if (!view.cell) return;
  const { w, h } = paneBackdrop(holdCtx);
  drawPreview(holdCtx, state.hold, 0, 0, w, h, state.holdUsed ? 0.3 : 1);
}

function drawNext() {
  if (!view.cell) return;
  const { w, h } = paneBackdrop(nextCtx);
  const horizontal = w > h;     // the phone layout makes this box wide
  const n = 3;

  state.queue.slice(0, n).forEach((type, i) => {
    const alpha = 1 - i * 0.22;   // the further out, the dimmer
    if (horizontal) drawPreview(nextCtx, type, (w / n) * i, 0, w / n, h, alpha);
    else            drawPreview(nextCtx, type, 0, (h / n) * i, w, h / n, alpha);
  });
}

/* ==========================================================================
 * 10. HUD
 * ========================================================================*/

function updateStats(bump = false) {
  el.score.textContent = state.score.toLocaleString();
  el.best.textContent  = best.toLocaleString();
  el.lines.textContent = state.lines;
  el.level.textContent = state.level;

  if (settings.goal > 0) {
    el.goalWrap.hidden = false;
    const done = Math.min(state.lines, settings.goal);
    el.goalText.textContent = `${done} / ${settings.goal}`;
    el.goalBar.style.width  = `${(done / settings.goal) * 100}%`;
  } else {
    el.goalWrap.hidden = true;   // endless mode has no goal to show
  }

  if (bump) {
    el.score.classList.remove('bump');
    void el.score.offsetWidth;   // force reflow so the animation restarts
    el.score.classList.add('bump');
  }
}

function showOverlay(kind, title, message, button) {
  el.overlay.dataset.state = kind;
  el.oTitle.textContent    = title;
  el.oMsg.textContent      = message;
  el.oBtn.textContent      = button;
  el.overlay.hidden        = false;
}

function hideOverlay() {
  el.overlay.hidden = true;
  // Drop focus, or the next Space would re-activate the button mid-game.
  el.oBtn.blur();
  el.oBtn2.blur();
}

const announce = (text) => { el.live.textContent = text; };

/* ==========================================================================
 * 11. GAME LOOP
 * ========================================================================*/

let lastFrame = performance.now();
let lastCountBeat = -1;

function tick(now) {
  const dt = Math.min(now - lastFrame, 100);   // clamp after a tab switch
  lastFrame = now;

  switch (state.phase) {
    case 'countdown': {
      state.countTimer += dt;
      const beat = Math.ceil((COUNTDOWN - state.countTimer) / (COUNTDOWN / 3));
      if (beat !== lastCountBeat) { lastCountBeat = beat; sfx.count(beat <= 0); }
      if (state.countTimer >= COUNTDOWN) { state.phase = 'playing'; lastCountBeat = -1; }
      if (state.piece) state.piece.spawnT += dt;
      break;
    }
    case 'playing':
      update(dt);
      break;
    case 'clearing':
      state.clearTimer += dt;
      if (state.clearTimer >= CLEAR_ANIM) resolveClear();
      break;
  }

  if (state.phase !== 'idle') {
    stepFx(dt);
    drawBoard();
    drawHold();
  }
  requestAnimationFrame(tick);
}

function update(dt) {
  if (!state.piece) return;
  state.piece.spawnT += dt;

  // Gravity.
  state.dropTimer += dt;
  const interval = GRAVITY[state.level];
  if (state.dropTimer >= interval) {
    state.dropTimer -= interval;
    move(0, 1, true);
  }

  // Lock delay only runs while the piece is resting on something.
  if (isGrounded()) {
    state.lockTimer += dt;
    if (state.lockTimer >= LOCK_DELAY) lock();
  } else {
    state.lockTimer = 0;
  }

  stepAutoRepeat(dt);
  stepSoftRepeat(dt);
}

/** Advance every cosmetic system and prune anything that has expired. */
function stepFx(dt) {
  const s = dt / 16.67;   // physics tuned in frames, applied in real time

  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i];
    p.life += dt;
    p.x += p.vx * 0.05 * s;
    p.y += p.vy * 0.05 * s;
    p.vy += 0.26 * s;            // gravity
    p.vx *= Math.pow(0.99, s);   // drag
    p.rot += p.vrot * s;
    if (p.life >= p.max || p.y > ROWS + 4) fx.particles.splice(i, 1);
  }

  for (let i = fx.popups.length - 1; i >= 0; i--) {
    fx.popups[i].life += dt;
    if (fx.popups[i].life >= fx.popups[i].max) fx.popups.splice(i, 1);
  }
  for (let i = fx.trails.length - 1; i >= 0; i--) {
    fx.trails[i].life += dt;
    if (fx.trails[i].life >= fx.trails[i].max) fx.trails.splice(i, 1);
  }
  for (let i = fx.flashes.length - 1; i >= 0; i--) {
    fx.flashes[i].life += dt;
    if (fx.flashes[i].life >= fx.flashes[i].max) fx.flashes.splice(i, 1);
  }

  // Screen shake: random offset scaled by remaining time, applied to the wrapper.
  if (fx.shake.t > 0) {
    fx.shake.t -= dt;
    const k = Math.max(0, fx.shake.t / fx.shake.max);
    const m = fx.shake.mag * k * k;
    el.wrap.style.transform =
      `translate3d(${rand(-m, m).toFixed(2)}px, ${rand(-m, m).toFixed(2)}px, 0)`;
    if (fx.shake.t <= 0) { fx.shake.mag = 0; el.wrap.style.transform = ''; }
  }

  // Danger glow once the stack climbs past two thirds of the field.
  el.wrap.classList.toggle('danger',
    state.phase === 'playing' && stackHeight() >= VIS_ROWS - 6);
}

/* ==========================================================================
 * 12. INPUT
 * ========================================================================*/

const DAS = 150;  // ms before horizontal auto-repeat starts
const ARR = 42;   // ms between repeats
const SDR = 38;   // ms between soft-drop repeats

const repeat = { dir: 0, elapsed: 0, started: false };
const soft   = { on: false, elapsed: 0 };

function stepAutoRepeat(dt) {
  if (!repeat.dir) return;
  repeat.elapsed += dt;
  if (!repeat.started) {
    if (repeat.elapsed >= DAS) { repeat.started = true; repeat.elapsed = 0; move(repeat.dir, 0); }
  } else if (repeat.elapsed >= ARR) {
    repeat.elapsed = 0;
    move(repeat.dir, 0);
  }
}

function stepSoftRepeat(dt) {
  if (!soft.on) return;
  soft.elapsed += dt;
  if (soft.elapsed >= SDR) { soft.elapsed = 0; softDrop(); }
}

function startRepeat(dir) {
  repeat.dir = dir; repeat.elapsed = 0; repeat.started = false;
  move(dir, 0);
}
function stopRepeat(dir) { if (repeat.dir === dir) repeat.dir = 0; }

function doAction(action) {
  if (state.phase !== 'playing') return;
  switch (action) {
    case 'left':  move(-1, 0); break;
    case 'right': move( 1, 0); break;
    case 'cw':    rotate( 1);  break;
    case 'ccw':   rotate(-1);  break;
    case 'soft':  softDrop();  break;
    case 'hard':  hardDrop();  break;
    case 'hold':  holdPiece(); break;
  }
}

/* ── Keyboard ───────────────────────────────────────────────────────────── */

/**
 * Normalise to a physical key name. `event.code` is layout-independent;
 * `event.key` is the fallback for older browsers and synthetic events.
 */
function keyName(e) {
  const code = e.code || '';
  if (code) {
    if (code.startsWith('Key')) return code.slice(3);   // KeyX -> X
    if (code === 'Space') return 'SPACE';
    return code.toUpperCase();
  }
  const k = e.key || '';
  return k === ' ' ? 'SPACE' : k.toUpperCase();
}

document.addEventListener('keydown', (e) => {
  const k = keyName(e);

  // Outside the game screen, Esc walks back towards the menu.
  if (current !== 'game') {
    if (k === 'ESCAPE' && current !== 'menu' && current !== 'boot') {
      e.preventDefault(); showScreen('menu');
    } else if ((k === 'ENTER' || k === 'SPACE') && current === 'menu') {
      e.preventDefault(); startFromMenu(getSave() ? 'resume' : 'new');
    }
    return;
  }

  if (state.phase === 'won' || state.phase === 'lost') {
    if (k === 'ENTER' || k === 'NUMPADENTER' || k === 'SPACE') { e.preventDefault(); newGame(); }
    if (k === 'ESCAPE') { e.preventDefault(); quitToMenu(); }
    return;
  }
  if (k === 'P' || k === 'ESCAPE') { e.preventDefault(); togglePause(); return; }
  if (state.phase !== 'playing') return;

  switch (k) {
    case 'ARROWLEFT':  e.preventDefault(); if (!e.repeat) startRepeat(-1); break;
    case 'ARROWRIGHT': e.preventDefault(); if (!e.repeat) startRepeat( 1); break;
    case 'ARROWDOWN':  e.preventDefault(); if (!e.repeat) { soft.on = true; soft.elapsed = 0; softDrop(); } break;
    case 'ARROWUP':
    case 'X':          e.preventDefault(); rotate(1); break;
    case 'Z':          e.preventDefault(); rotate(-1); break;
    case 'SPACE':      e.preventDefault(); hardDrop(); break;
    case 'C':          e.preventDefault(); holdPiece(); break;
  }
});

document.addEventListener('keyup', (e) => {
  const k = keyName(e);
  if (k === 'ARROWLEFT')  stopRepeat(-1);
  if (k === 'ARROWRIGHT') stopRepeat(1);
  if (k === 'ARROWDOWN')  soft.on = false;
});

/* ── In-game buttons ────────────────────────────────────────────────────── */

el.oBtn.addEventListener('click', () => {
  audioReady();
  if (state.phase === 'paused') togglePause();
  else newGame();                     // Retry / Play again
});
el.oBtn2.addEventListener('click', () => { audioReady(); quitToMenu(); });
el.pauseBtn.addEventListener('click', () => { audioReady(); togglePause(); });

/** Held pad buttons repeat, so you can slide a piece across without tapping. */
document.querySelectorAll('.pad__btn').forEach((btn) => {
  const act = btn.dataset.act;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audioReady();
    if (act === 'left' || act === 'right') startRepeat(act === 'left' ? -1 : 1);
    else if (act === 'soft') { soft.on = true; soft.elapsed = 0; softDrop(); }
    else doAction(act);
    buzz(6);
  });
  const release = () => {
    if (act === 'left' || act === 'right') stopRepeat(act === 'left' ? -1 : 1);
    if (act === 'soft') soft.on = false;
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

/* ── Touch gestures on the board ────────────────────────────────────────── */
/* Drag horizontally to slide (1 cell per cell-width of travel), drag down to
   soft drop, flick down to hard drop, tap to rotate. Tracking the piece's
   column at drag start means the piece follows your thumb exactly instead of
   drifting from accumulated deltas. */

let drag = null;

boardCanvas.addEventListener('pointerdown', (e) => {
  audioReady();
  if (state.phase !== 'playing') return;
  boardCanvas.setPointerCapture?.(e.pointerId);
  drag = {
    x: e.clientX, y: e.clientY,
    startCol: state.piece ? state.piece.x : 0,
    lastRow: 0, t: performance.now(), moved: false,
  };
});

boardCanvas.addEventListener('pointermove', (e) => {
  if (!drag || state.phase !== 'playing' || !state.piece) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;

  const wantCol = drag.startCol + Math.round(dx / view.cell);
  let guard = COLS;
  while (state.piece.x !== wantCol && guard-- > 0) {
    if (!move(Math.sign(wantCol - state.piece.x), 0)) break;
    drag.moved = true;
  }

  const rows = Math.floor(dy / view.cell);
  if (rows > drag.lastRow) {
    for (let i = drag.lastRow; i < rows; i++) softDrop();
    drag.lastRow = rows;
    drag.moved = true;
  }

  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) drag.moved = true;
});

function endDrag(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  const dt = performance.now() - drag.t;
  const wasDrag = drag.moved;
  drag = null;
  if (state.phase !== 'playing') return;

  // Flick down: fast, mostly-vertical, long enough.
  if (dy > view.cell * 1.6 && dt < 260 && Math.abs(dy) > Math.abs(dx) * 1.6) { hardDrop(); return; }
  // Tap: barely moved, quick.
  if (!wasDrag && dt < 260) rotate(1);
}

boardCanvas.addEventListener('pointerup', endDrag);
boardCanvas.addEventListener('pointercancel', () => { drag = null; });

/* ── Window events ──────────────────────────────────────────────────────── */

let resizeRaf = 0;
function onResize() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(layout);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(layout, 220));
if (window.ResizeObserver) new ResizeObserver(onResize).observe(el.wrap);

// Losing focus or hiding the tab shouldn't cost you the run.
window.addEventListener('blur', () => {
  if (state.phase === 'playing' || state.phase === 'countdown') togglePause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state.phase === 'playing' || state.phase === 'countdown')) togglePause();
});
window.addEventListener('pagehide', saveGame);

// Block double-tap-to-zoom and pull-to-refresh on phones.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => {
  if (e.target.closest('.board-wrap, .pad')) e.preventDefault();
}, { passive: false });

/* ==========================================================================
 * 13. SCREENS — boot · menu · help · scores · settings · game
 * ========================================================================*/

const screens = {};
document.querySelectorAll('.screen').forEach(s => { screens[s.dataset.screen] = s; });
let current = 'boot';

function showScreen(name) {
  if (!screens[name]) return;
  for (const [key, node] of Object.entries(screens)) {
    const on = key === name;
    node.classList.toggle('is-active', on);
    node.hidden = !on;
  }
  current = name;

  // Replay the entrance animation.
  const node = screens[name];
  node.classList.remove('is-entering');
  void node.offsetWidth;
  node.classList.add('is-entering');

  if (name === 'menu')     refreshMenu();
  if (name === 'scores')   renderScores();
  if (name === 'settings') renderSettings();
  if (name === 'help')     el.helpGoal.textContent = settings.goal || '∞';
  // The board has no size while its screen is hidden. The screen is already
  // un-hidden above, so a synchronous layout here measures correctly — and
  // unlike rAF it still runs when the tab is hidden or throttled.
  if (name === 'game')     layout();
}

/* ── Menu ───────────────────────────────────────────────────────────────── */

function refreshMenu() {
  el.menuBest.textContent = best.toLocaleString();
  el.menuTag.textContent = settings.goal > 0
    ? `Clear ${settings.goal} lines to win.`
    : 'Endless — play until you top out.';

  const save = getSave();
  el.btnContinue.hidden = !save;
  if (save) {
    const when = new Date(save.at);
    el.continueInfo.textContent =
      `${save.score.toLocaleString()} pts · ${save.lines} lines · ${when.toLocaleDateString()}`;
  }
}

function startFromMenu(kind) {
  audioReady();
  sfx.ui();
  showScreen('game');            // also lays the board out
  if (kind === 'resume') continueGame(); else newGame();
  layout();                      // re-measure now the HUD has its real values
}

document.querySelectorAll('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const to = btn.dataset.go;
    audioReady();
    if (to === 'new' || to === 'resume') { startFromMenu(to); return; }
    sfx.ui();
    showScreen(to);
  });
});

/* ── Settings screen ────────────────────────────────────────────────────── */

function renderSettings() {
  document.querySelectorAll('[data-set]').forEach((input) => {
    input.checked = !!settings[input.dataset.set];
  });
  document.querySelectorAll('[data-goal]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.goal) === settings.goal));
  });
  document.querySelectorAll('[data-level]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.level) === settings.startLevel));
  });
}

document.querySelectorAll('[data-set]').forEach((input) => {
  input.addEventListener('change', () => {
    settings[input.dataset.set] = input.checked;
    saveSettings();
    audioReady();
    if (input.dataset.set === 'sound' && master) master.gain.value = settings.sound ? 0.5 : 0;
    sfx.ui();
    if (input.dataset.set === 'effects' && !settings.effects) resetFx();
  });
});

document.querySelectorAll('[data-goal]').forEach((b) => {
  b.addEventListener('click', () => {
    settings.goal = Number(b.dataset.goal);
    saveSettings(); renderSettings(); updateStats(); sfx.ui();
  });
});
document.querySelectorAll('[data-level]').forEach((b) => {
  b.addEventListener('click', () => {
    settings.startLevel = Number(b.dataset.level);
    saveSettings(); renderSettings(); sfx.ui();
  });
});

document.getElementById('btn-reset-settings').addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS };
  saveSettings();
  renderSettings();
  updateStats();
  if (master) master.gain.value = settings.sound ? 0.5 : 0;
  sfx.ui();
  announce('Settings reset to defaults.');
});

/* ── High scores screen ─────────────────────────────────────────────────── */

function renderScores() {
  el.scoresBest.textContent = best.toLocaleString();
  el.scoresBody.innerHTML = '';
  el.scoresEmpty.hidden = scores.length > 0;

  scores.forEach((s, i) => {
    const tr = document.createElement('tr');
    if (i === 0) tr.className = 'is-top';
    const when = new Date(s.at);
    const cells = [
      String(i + 1),
      s.score.toLocaleString(),
      String(s.lines),
      String(s.level),
      when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    ];
    cells.forEach((text, col) => {
      const td = document.createElement('td');
      td.textContent = text;
      // The WON badge is a ::after on this cell, so it can't be injected text.
      if (col === 1 && s.won) td.classList.add('won');
      tr.appendChild(td);
    });
    el.scoresBody.appendChild(tr);
  });
}

document.getElementById('btn-clear-scores').addEventListener('click', () => {
  scores = [];
  best = 0;
  writeJSON(KEY_SCORES, scores);
  writeJSON(KEY_BEST, 0);
  renderScores();
  refreshMenu();
  updateStats();
  sfx.ui();
  announce('High scores cleared.');
});

/* ==========================================================================
 * 14. BOOT
 * ========================================================================*/

/**
 * A short staged boot. Each step does real work (or verifies something), so
 * the bar reflects progress rather than faking a delay.
 */
const BOOT_STEPS = [
  ['Loading piece data…',  () => { if (TYPES.length !== 7) throw new Error('bad piece table'); }],
  ['Building rotations…',  () => { for (const t of TYPES) rotateCW(SHAPES[t]); }],
  ['Preparing board…',     () => { state.grid = emptyGrid(); refillQueue(); }],
  ['Reading save data…',   () => { refreshMenu(); renderSettings(); }],
  ['Warming up canvas…',   () => { layout(); }],
  ['Ready',                () => {}],
];

function runBoot() {
  let i = 0;
  const step = () => {
    const [label, work] = BOOT_STEPS[i];
    el.bootStatus.textContent = label;
    try { work(); } catch (err) { el.bootStatus.textContent = 'Error: ' + err.message; return; }
    el.bootFill.style.width = `${((i + 1) / BOOT_STEPS.length) * 100}%`;
    i++;
    if (i < BOOT_STEPS.length) setTimeout(step, 150 + Math.random() * 90);
    else setTimeout(() => showScreen('menu'), 320);
  };
  step();
}

// roundRect landed in 2023; fall back to plain rectangles on older engines.
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) {
    this.rect(x, y, w, h);
    return this;
  };
}

updateStats();
runBoot();
requestAnimationFrame(tick);
