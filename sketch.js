/*
 * sketch.js — p5.js front end for Gobblet.
 *
 * Drawing happens on a p5 canvas, which is hidden from assistive technology.
 * Every interactive thing on the canvas (16 squares + 6 stacks) also exists as a
 * real <button> laid exactly over its drawing, so mouse, touch, keyboard and
 * screen readers all use the same controls.
 */
/* global Gobblet, GobbletAI, createCanvas, resizeCanvas, pixelDensity, clear, noStroke, stroke, fill, noFill,
   strokeWeight, circle, rect, line, text, textAlign, textSize, textStyle, textFont, push, pop, translate,
   drawingContext, CENTER, BOLD, NORMAL, millis, lerp, sin, PI, triangle, cursor */
'use strict';

const G = Gobblet;

// ---- Colours that represent the physical game (constant in both themes) ----
const COLOR = {
  yellow: '#FFD21E',
  yellowShade: '#E0B000',
  red: '#E4432B',
  redShade: '#B8301C',
  outline: '#14181F',
  plate: '#C5CCD6',        // grey wooden board plate
  plateEdge: '#8F99A8',
  hole: '#2B5D9B',         // blue cups
  holeShade: '#1F4677',
  coord: '#14181F',
  white: '#FFFFFF',
};
// Diameter of each size as a fraction of a board square.
const SIZE_D = [0, 0.38, 0.54, 0.7, 0.86];

// ---------------------------------------------------------------- state ----
const settings = loadSettings();
let state;                 // Gobblet state
let history = [];          // snapshots for undo
let repeatCount = new Map();
let moveLog = [];          // { text, short }
let lastMove = null;
let result = null;         // { type: 'win'|'draw', winner, lines, reason }
let selection = null;      // { src: 'r'|'b', i }
let locked = false;        // touch-move lock
let targets = [];          // legal moves for current selection
let anim = null;
let cpuTimer = null;
let gameId = 0;
let thinking = false;
let focusCell = 0;
let L = null;              // layout
let theme = {};
let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// p5 entry points ------------------------------------------------------------
function setup() {
  const stage = document.getElementById('stage');
  const c = createCanvas(stage.clientWidth, stage.clientHeight);
  c.parent(stage);
  c.elt.setAttribute('aria-hidden', 'true');
  c.elt.setAttribute('tabindex', '-1');
  stage.insertBefore(c.elt, stage.firstChild);
  pixelDensity(Math.min(window.devicePixelRatio || 1, 3));

  buildControls();
  wireUI();
  readTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  new ResizeObserver(() => relayout()).observe(stage);

  applySettingsToForm();
  relayout();
  newGame();
}

function draw() {
  clear();
  if (!L) return;
  drawPanels();
  drawBoard();
  drawReserves();
  drawAnimation();
  drawWinLine();
}

function windowResized() { relayout(); }

// --------------------------------------------------------------- layout ----
function relayout() {
  const stage = document.getElementById('stage');
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  resizeCanvas(w, h);
  L = computeLayout(w, h);
  positionControls();
}

function computeLayout(w, h) {
  const pad = Math.max(12, Math.min(w, h) * 0.025);
  const landscape = w >= h * 1.12;
  let cell, ox, oy, margin;
  const reserve = [[], []];
  const panels = [];

  if (landscape) {
    // Board in the middle, a column of 3 stacks on each side (like the rules sheet).
    // width budget: 2 trays (1.3 cell each) + board (4 cells + margins) + gaps
    cell = Math.min((h - 2 * pad) / 4.7, (w - 4 * pad) / (4.7 + 2 * 1.35));
    margin = cell * 0.35;
    const boardPx = 4 * cell + 2 * margin;
    ox = (w - boardPx) / 2 + margin;
    oy = (h - boardPx) / 2 + margin;
    const trayW = cell * 1.3;
    const trayH = boardPx;
    const gap = Math.max(pad, (w - boardPx - 2 * trayW) / 2 * 0.35);
    const xs = [ox - margin - gap - trayW / 2, ox + 4 * cell + margin + gap + trayW / 2];
    for (let p = 0; p < 2; p++) {
      panels.push({ p, x: xs[p] - trayW / 2, y: oy - margin, w: trayW, h: trayH, labelTop: true });
      const top = oy - margin + cell * 0.55;
      const span = trayH - cell * 0.55;
      for (let i = 0; i < 3; i++) {
        reserve[p].push({ x: xs[p], y: top + span * (i + 0.5) / 3, d: cell });
      }
    }
  } else {
    // Portrait (phones, iPad upright): Red's tray on top, Yellow's at the bottom.
    cell = Math.min((w - 2 * pad) / 4.7, (h - 4 * pad) / (4.7 + 2 * 1.45));
    margin = cell * 0.35;
    const boardPx = 4 * cell + 2 * margin;
    ox = (w - boardPx) / 2 + margin;
    oy = (h - boardPx) / 2 + margin;
    const trayH = cell * 1.45;
    const trayW = boardPx;
    const gap = Math.max(pad * 0.6, (h - boardPx - 2 * trayH) / 2 * 0.3);
    const ys = [oy + 4 * cell + margin + gap + trayH / 2, oy - margin - gap - trayH / 2];
    for (let p = 0; p < 2; p++) {
      const px = ox - margin;
      panels.push({ p, x: px, y: ys[p] - trayH / 2, w: trayW, h: trayH, labelTop: false });
      const left = px + cell * 1.5;
      const span = trayW - cell * 1.55;
      for (let i = 0; i < 3; i++) {
        reserve[p].push({ x: left + span * (i + 0.5) / 3, y: ys[p], d: cell });
      }
    }
  }
  return { w, h, cell, ox, oy, margin, landscape, reserve, panels };
}

function cellCenter(c) {
  return { x: L.ox + (c % 4 + 0.5) * L.cell, y: L.oy + (Math.floor(c / 4) + 0.5) * L.cell };
}

// ---------------------------------------------------------------- theme ----
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  theme = {
    panel: cs.getPropertyValue('--panel').trim() || '#e3e8ef',
    panelInk: cs.getPropertyValue('--panel-ink').trim() || '#14181f',
    muted: cs.getPropertyValue('--muted').trim() || '#4a5566',
    focus: cs.getPropertyValue('--focus').trim() || '#000',
  };
}

// -------------------------------------------------------------- drawing ----
// Canvas text drawn straight on the 2D context so a full CSS font fallback stack works
// (p5's textFont() quotes the whole string, which breaks multi-family stacks).
const CANVAS_FONT = '"Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
function label(str, x, y, px, bold, color) {
  const ctx = drawingContext;
  ctx.save();
  ctx.font = `${bold ? '700 ' : '400 '}${Math.round(px)}px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function animationsOn() { return settings.anim && !reduceMotion.matches; }

function drawPanels() {
  for (const pn of L.panels) {
    const active = !result && state.turn === pn.p;
    push();
    noStroke();
    fill(theme.panel);
    rect(pn.x, pn.y, pn.w, pn.h, L.cell * 0.18);
    if (active) {
      noFill();
      stroke(COLOR.outline);
      strokeWeight(Math.max(5, L.cell * 0.07));
      rect(pn.x, pn.y, pn.w, pn.h, L.cell * 0.18);
      stroke(pn.p === 0 ? COLOR.yellow : COLOR.red);
      strokeWeight(Math.max(2.5, L.cell * 0.035));
      rect(pn.x, pn.y, pn.w, pn.h, L.cell * 0.18);
    }
    // Label
    const fs = Math.max(13, L.cell * 0.2);
    const name = G.PLAYER_NAMES[pn.p];
    const who = seatLabel(pn.p).split('\n');
    const cx = pn.labelTop ? pn.x + pn.w / 2 : pn.x + L.cell * 0.72;
    let y = pn.labelTop ? pn.y + L.cell * 0.2 : pn.y + pn.h / 2 - who.length * fs * 0.5;
    label(name, cx, y, fs, true, theme.panelInk);
    for (const w of who) { y += fs * (pn.labelTop ? 0.95 : 1); label(w, cx, y, fs * 0.8, false, theme.panelInk); }
    pop();
  }
}

function seatLabel(p) {
  const seat = settings.seats[p];
  if (seat === 'human') return settings.mode === 2 ? 'Player ' + (p + 1) : 'You';
  return seat === 'hard' ? 'Computer\nHard' : 'Computer\nEasy';
}

function drawBoard() {
  const { cell, ox, oy, margin } = L;
  const size = 4 * cell + 2 * margin;
  push();
  // plate
  stroke(COLOR.plateEdge);
  strokeWeight(Math.max(2, cell * 0.03));
  fill(COLOR.plate);
  rect(ox - margin, oy - margin, size, size, cell * 0.6);

  // coordinates
  const cfs = Math.max(11, cell * 0.17);
  for (let i = 0; i < 4; i++) {
    label(G.COLS[i], ox + (i + 0.5) * cell, oy - margin * 0.5, cfs, true, COLOR.coord);
    label(String(i + 1), ox - margin * 0.5, oy + (i + 0.5) * cell, cfs, true, COLOR.coord);
  }

  const targetCells = new Set(targets.map((m) => m.to));
  const now = millis();

  for (let c = 0; c < 16; c++) {
    const { x, y } = cellCenter(c);
    // cup
    noStroke();
    fill(COLOR.holeShade);
    circle(x, y + cell * 0.02, cell * 0.9);
    fill(COLOR.hole);
    circle(x, y, cell * 0.88);

    // stack contents (skip the piece that is still flying in)
    let st = state.board[c];
    if (anim && anim.to === c) st = st.slice(0, -1);
    const t = st.length ? st[st.length - 1] : 0;

    const isSel = selection && selection.src === 'b' && selection.i === c;
    if (t) {
      const lift = isSel ? cell * 0.05 : 0;
      if (isSel) { noStroke(); fill(0, 0, 0, 70); circle(x + cell * 0.04, y + cell * 0.06, cell * SIZE_D[G.sizeOf(t)]); }
      drawPiece(x, y - lift, t, cell);
      if (settings.hidden && st.length > 1) drawHidden(x, y - lift, st, cell);
      if (isSel) drawSelectRing(x, y - lift, cell * SIZE_D[G.sizeOf(t)] + cell * 0.08, now);
    }

    if (lastMove && lastMove.to === c && !result) drawLastMarker(x, y, cell);

    if (targetCells.has(c)) drawTargetRing(x, y, cell, !!t, now);
  }
  pop();
}

function drawPiece(x, y, code, cell, scale) {
  const p = G.owner(code);
  const s = G.sizeOf(code);
  const d = cell * SIZE_D[s] * (scale || 1);
  push();
  stroke(COLOR.outline);
  strokeWeight(Math.max(2, cell * 0.03));
  fill(p === 0 ? COLOR.yellow : COLOR.red);
  circle(x, y, d);
  // soft shade on the lower rim to read as a cylinder top
  noStroke();
  fill(p === 0 ? COLOR.yellowShade : COLOR.redShade);
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.arc(x, y, d / 2 - Math.max(1, cell * 0.015), 0.15 * Math.PI, 0.85 * Math.PI);
  drawingContext.arc(x, y - d * 0.06, d / 2 * 0.94, 0.85 * Math.PI, 0.15 * Math.PI, true);
  drawingContext.closePath();
  drawingContext.fill();
  drawingContext.restore();

  if (p === 1) {
    // Non-colour cue: red pieces carry a white ring.
    noFill();
    stroke(COLOR.white);
    strokeWeight(Math.max(2, d * 0.07));
    circle(x, y, d * 0.66);
  }
  if (settings.numbers) {
    label(String(s), x, y + d * 0.03, Math.max(10, d * 0.42), true, p === 0 ? COLOR.outline : COLOR.white);
  }
  pop();
}

function drawHidden(x, y, st, cell) {
  // Learning mode: dashed outlines of covered pieces, smallest innermost.
  push();
  noFill();
  drawingContext.setLineDash([4, 3]);
  for (let k = st.length - 2; k >= 0; k--) {
    const code = st[k];
    const d = cell * SIZE_D[G.sizeOf(code)] * 0.98;
    stroke(COLOR.outline);
    strokeWeight(4);
    circle(x, y, d);
    stroke(G.owner(code) === 0 ? COLOR.yellow : COLOR.white);
    strokeWeight(2);
    circle(x, y, d);
  }
  drawingContext.setLineDash([]);
  pop();
}

function drawSelectRing(x, y, d, now) {
  const pulse = animationsOn() ? 0.5 + 0.5 * sin(now / 220) : 1;
  push();
  noFill();
  stroke(COLOR.outline);
  strokeWeight(7);
  circle(x, y, d + 2);
  stroke(COLOR.white);
  strokeWeight(3 + pulse * 1.5);
  circle(x, y, d + 2);
  pop();
}

function drawTargetRing(x, y, cell, occupied, now) {
  const off = animationsOn() ? (now / 60) % 14 : 0;
  push();
  noFill();
  const d = cell * (occupied ? 0.95 : 0.8);
  drawingContext.setLineDash([8, 6]);
  drawingContext.lineDashOffset = -off;
  stroke(COLOR.outline);
  strokeWeight(6);
  circle(x, y, d);
  stroke(COLOR.white);
  strokeWeight(3);
  circle(x, y, d);
  drawingContext.setLineDash([]);
  if (!occupied) {
    noStroke();
    fill(COLOR.white);
    circle(x, y, cell * 0.14);
    noFill(); stroke(COLOR.outline); strokeWeight(2);
    circle(x, y, cell * 0.14);
  }
  pop();
}

function drawLastMarker(x, y, cell) {
  // small notch at the top-right of the square that was just played
  push();
  const r = cell * 0.44;
  const ax = x + r * 0.72, ay = y - r * 0.72;
  stroke(COLOR.outline); strokeWeight(2); fill(COLOR.white);
  const s = cell * 0.1;
  triangle(ax - s, ay - s * 0.2, ax + s * 0.2, ay - s * 0.2, ax + s * 0.2, ay + s);
  pop();
}

function drawReserves() {
  const now = millis();
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < 3; i++) {
      const slot = L.reserve[p][i];
      const st = state.reserves[p][i];
      const isSel = selection && selection.src === 'r' && state.turn === p && selection.i === i;
      push();
      // dish
      noFill();
      stroke(theme.muted);
      strokeWeight(1.5);
      drawingContext.setLineDash([3, 4]);
      circle(slot.x, slot.y, slot.d * 1.0);
      drawingContext.setLineDash([]);
      let visible = st;
      if (anim && anim.fromReserve && anim.p === p && anim.i === i) visible = st; // already popped
      if (visible.length) {
        const size = visible[visible.length - 1];
        const lift = isSel ? L.cell * 0.05 : 0;
        drawPiece(slot.x, slot.y - lift, G.pieceCode(p, size), L.cell);
        if (isSel) drawSelectRing(slot.x, slot.y - lift, L.cell * SIZE_D[size] + L.cell * 0.08, now);
      }
      // remaining count pips (one per piece in the stack)
      noStroke();
      const pipR = Math.max(3, L.cell * 0.045);
      const total = visible.length;
      const pipY = slot.y + slot.d * 0.5 + pipR * 0.4;
      for (let k = 0; k < 4; k++) {
        const px = slot.x + (k - 1.5) * pipR * 2.6;
        if (k < total) { fill(theme.panelInk); circle(px, pipY, pipR * 1.6); }
        else { noFill(); stroke(theme.muted); strokeWeight(1); circle(px, pipY, pipR * 1.6); noStroke(); }
      }
      pop();
    }
  }
}

function drawAnimation() {
  if (!anim) return;
  const t = Math.min(1, (millis() - anim.start) / anim.dur);
  const e = 1 - Math.pow(1 - t, 3);
  const x = lerp(anim.x0, anim.x1, e);
  const y = lerp(anim.y0, anim.y1, e) - Math.sin(e * PI) * L.cell * 0.35;
  drawPiece(x, y, anim.code, L.cell, 1 + Math.sin(e * PI) * 0.12);
  if (t >= 1) {
    anim = null;
    if (anim === null && pendingAfterAnim) { const f = pendingAfterAnim; pendingAfterAnim = null; f(); }
  }
}
let pendingAfterAnim = null;

function drawWinLine() {
  if (!result || result.type !== 'win') return;
  push();
  for (const li of result.lines) {
    const cells = G.LINES[li];
    const a = cellCenter(cells[0]);
    const b = cellCenter(cells[3]);
    const ext = 0.3 * L.cell;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const ux = dx / len * ext, uy = dy / len * ext;
    stroke(COLOR.outline);
    strokeWeight(L.cell * 0.2);
    line(a.x - ux, a.y - uy, b.x + ux, b.y + uy);
    stroke(COLOR.white);
    strokeWeight(L.cell * 0.11);
    line(a.x - ux, a.y - uy, b.x + ux, b.y + uy);
  }
  pop();
}

// ------------------------------------------------- accessible controls ----
const cellButtons = [];
const stackButtons = [[], []];

function buildControls() {
  const grid = document.getElementById('board-grid');
  for (let r = 0; r < 4; r++) {
    const row = document.createElement('div');
    row.setAttribute('role', 'row');
    row.setAttribute('aria-rowindex', String(r + 1));
    for (let c = 0; c < 4; c++) {
      const idx = r * 4 + c;
      const wrap = document.createElement('div');
      wrap.className = 'cellwrap';
      wrap.setAttribute('role', 'gridcell');
      wrap.setAttribute('aria-colindex', String(c + 1));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.tabIndex = idx === 0 ? 0 : -1;
      b.dataset.cell = String(idx);
      b.addEventListener('click', () => { focusCell = idx; onCell(idx); });
      b.addEventListener('focus', () => { focusCell = idx; setRoving(idx); });
      b.addEventListener('keydown', onGridKey);
      wrap.appendChild(b);
      row.appendChild(wrap);
      cellButtons.push({ wrap, b });
    }
    grid.appendChild(row);
  }
  for (let p = 0; p < 2; p++) {
    const g = document.getElementById('reserve-' + p);
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stack';
      b.addEventListener('click', () => onStack(p, i));
      b.addEventListener('keydown', onStackKey);
      g.appendChild(b);
      stackButtons[p].push(b);
    }
  }
}

function positionControls() {
  if (!L) return;
  const pad = L.cell * 0.04;
  for (let c = 0; c < 16; c++) {
    const { x, y } = cellCenter(c);
    const s = cellButtons[c].wrap.style;
    s.left = (x - L.cell / 2 + pad) + 'px';
    s.top = (y - L.cell / 2 + pad) + 'px';
    s.width = s.height = (L.cell - 2 * pad) + 'px';
  }
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < 3; i++) {
      const slot = L.reserve[p][i];
      const s = stackButtons[p][i].style;
      const sz = slot.d * 1.08;
      s.left = (slot.x - sz / 2) + 'px';
      s.top = (slot.y - sz / 2) + 'px';
      s.width = sz + 'px';
      s.height = (sz + L.cell * 0.12) + 'px';
    }
  }
  // Reading order: Red tray first when it is drawn on top.
  const hit = document.getElementById('hit');
  const r0 = document.getElementById('reserve-0');
  const r1 = document.getElementById('reserve-1');
  const grid = document.getElementById('board-grid');
  if (L.landscape) { hit.append(r0, grid, r1); } else { hit.append(r1, grid, r0); }
}

function setRoving(idx) {
  cellButtons.forEach(({ b }, i) => { b.tabIndex = i === idx ? 0 : -1; });
}

function onGridKey(e) {
  const r = Math.floor(focusCell / 4), c = focusCell % 4;
  let n = null;
  switch (e.key) {
    case 'ArrowUp': n = Math.max(0, r - 1) * 4 + c; break;
    case 'ArrowDown': n = Math.min(3, r + 1) * 4 + c; break;
    case 'ArrowLeft': n = r * 4 + Math.max(0, c - 1); break;
    case 'ArrowRight': n = r * 4 + Math.min(3, c + 1); break;
    case 'Home': n = e.ctrlKey ? 0 : r * 4; break;
    case 'End': n = e.ctrlKey ? 15 : r * 4 + 3; break;
    default: onStackKey(e); return;
  }
  e.preventDefault();
  focusCell = n;
  setRoving(n);
  cellButtons[n].b.focus();
}

function onStackKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelSelection(true); return; }
  if (['1', '2', '3'].includes(e.key) && isHumanTurn()) {
    e.preventDefault();
    onStack(state.turn, Number(e.key) - 1);
  }
}

function updateLabels() {
  const targetMap = new Map(targets.map((m) => [m.to, m]));
  for (let c = 0; c < 16; c++) {
    const st = state.board[c];
    const t = st.length ? st[st.length - 1] : 0;
    let label = G.cellName(c) + ': ';
    label += t ? `${G.PLAYER_NAMES[G.owner(t)]} ${G.SIZE_NAMES[G.sizeOf(t)]} (size ${G.sizeOf(t)})` : 'empty';
    if (t && settings.hidden && st.length > 1) {
      const under = st.slice(0, -1).reverse().map((k) => `${G.PLAYER_NAMES[G.owner(k)]} ${G.SIZE_NAMES[G.sizeOf(k)]}`);
      label += `, covering ${under.join(', then ')}`;
    }
    if (selection && selection.src === 'b' && selection.i === c) label += '. Selected';
    if (targetMap.has(c)) label += t ? '. You can gobble here' : '. You can move here';
    if (lastMove && lastMove.to === c) label += '. Last move';
    const b = cellButtons[c].b;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-disabled', String(!!result || !isHumanTurn()));
  }
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < 3; i++) {
      const st = state.reserves[p][i];
      let label = `${G.PLAYER_NAMES[p]} stack ${i + 1}: `;
      label += st.length
        ? `${G.SIZE_NAMES[st[st.length - 1]]} (size ${st[st.length - 1]}) on top, ${st.length} ${st.length === 1 ? 'piece' : 'pieces'} left`
        : 'empty';
      if (selection && selection.src === 'r' && state.turn === p && selection.i === i) label += '. Selected';
      const b = stackButtons[p][i];
      b.setAttribute('aria-label', label);
      const usable = !result && isHumanTurn() && state.turn === p && st.length > 0;
      b.setAttribute('aria-disabled', String(!usable));
    }
  }
  setButtonState('btn-undo', canUndo());
  setButtonState('btn-draw', !result && settings.mode !== 0 && isHumanTurn());
}

function setButtonState(id, enabled) {
  document.getElementById(id).setAttribute('aria-disabled', String(!enabled));
}

// ---------------------------------------------------------- game flow ----
function isHumanTurn() { return settings.seats[state.turn] === 'human' && !thinking && !anim; }

function newGame() {
  gameId++;
  clearTimeout(cpuTimer);
  thinking = false;
  anim = null;
  pendingAfterAnim = null;
  const first = settings.first === 'r' ? (Math.random() < 0.5 ? 0 : 1) : Number(settings.first);
  state = G.newState(first);
  history = [];
  repeatCount = new Map([[G.positionKey(state), 1]]);
  moveLog = [];
  lastMove = null;
  result = null;
  selection = null;
  locked = false;
  targets = [];
  renderMoveList();
  const setupText = settings.mode === 2
    ? 'Two players'
    : settings.mode === 1
      ? `You are ${G.PLAYER_NAMES[settings.seats.indexOf('human')]} against the ${settings.seats.find((s) => s !== 'human')} computer`
      : 'Computer against computer';
  announce(`New game. ${setupText}. ${G.PLAYER_NAMES[first]} moves first.`);
  refreshStatus();
  maybeComputer();
}

function onStack(p, i) {
  if (result) { say('The game is over. Choose New game to play again.'); return; }
  if (!isHumanTurn()) { say(thinking ? 'Please wait, the computer is thinking.' : 'It is not your turn.'); return; }
  if (p !== state.turn) { say(`That is ${G.PLAYER_NAMES[p]}'s stack. It is ${G.PLAYER_NAMES[state.turn]}'s turn.`); return; }
  if (locked) { say(`Touch-move: you must play the piece on ${G.cellName(selection.i)}.`); return; }
  if (!state.reserves[p][i].length) { say('That stack is empty.'); return; }
  if (selection && selection.src === 'r' && selection.i === i) { cancelSelection(true); return; }
  chooseSelection({ src: 'r', i });
}

function onCell(c) {
  if (result) { say('The game is over. Choose New game to play again.'); return; }
  if (!isHumanTurn()) { say(thinking ? 'Please wait, the computer is thinking.' : 'It is not your turn.'); return; }
  const move = targets.find((m) => m.to === c);
  if (selection && move) { playMove(move, true); return; }

  const t = G.top(state, c);
  if (selection && selection.src === 'b' && selection.i === c) {
    if (locked) say(`Touch-move: you must play this piece. Choose a highlighted square.`);
    else cancelSelection(true);
    return;
  }
  if (t && G.owner(t) === state.turn) {
    if (locked) { say(`Touch-move: you must play the piece on ${G.cellName(selection.i)}.`); return; }
    chooseSelection({ src: 'b', i: c });
    return;
  }
  if (selection) {
    say(explainIllegal(c));
  } else if (t) {
    say(`${G.cellName(c)} has ${G.PLAYER_NAMES[G.owner(t)]}'s piece. Choose one of your stacks or one of your own pieces.`);
  } else {
    say(`First choose a piece: one of your stacks, or one of your pieces on the board.`);
  }
}

function explainIllegal(c) {
  const t = G.top(state, c);
  const size = selectedSize();
  if (!t) return `${G.cellName(c)} is not a legal move.`;
  if (G.sizeOf(t) >= size) return `Your size ${size} piece is not bigger than the size ${G.sizeOf(t)} piece on ${G.cellName(c)}.`;
  if (selection.src === 'r') return `A new piece from a stack can only gobble a piece that is part of your opponent's 3 in a row. Try an empty square.`;
  return `${G.cellName(c)} is not a legal move.`;
}

function selectedSize() {
  if (!selection) return 0;
  if (selection.src === 'r') { const st = state.reserves[state.turn][selection.i]; return st[st.length - 1]; }
  return G.sizeOf(G.top(state, selection.i));
}

function chooseSelection(sel) {
  const moves = G.movesFrom(state, sel.src, sel.i);
  selection = sel;
  targets = moves;
  locked = false;
  const size = selectedSize();
  const where = sel.src === 'r' ? `stack ${sel.i + 1}` : G.cellName(sel.i);
  if (!moves.length) {
    say(`The size ${size} piece on ${where} has no legal moves. Choose another piece.`);
    selection = null; targets = [];
  } else {
    if (sel.src === 'b' && settings.touchMove) locked = true;
    const list = moves.map((m) => G.cellName(m.to));
    say(`Selected ${G.SIZE_NAMES[size]} piece from ${where}. ${moves.length} legal ${moves.length === 1 ? 'square' : 'squares'}: ${list.join(', ')}.` +
      (locked ? ' Touch-move: this piece must be played.' : ''));
  }
  refreshStatus();
}

function cancelSelection(speak) {
  if (!selection) return;
  if (locked) { if (speak) say('Touch-move: this piece must be played.'); return; }
  selection = null; targets = []; locked = false;
  if (speak) say('Selection cancelled.');
  refreshStatus();
}

function playMove(move, byHuman) {
  const before = G.cloneState(state);
  history.push({ state: before, repeat: new Map(repeatCount), log: moveLog.length, lastMove, result });
  const sentence = G.describeMove(state, move);
  const short = G.shortNotation(state, move);
  const mover = state.turn;

  // animation source / destination
  const from = move.src === 'r' ? L.reserve[mover][move.i] : cellCenter(move.i);
  const to = cellCenter(move.to);

  G.applyMove(state, move);
  const code = G.top(state, move.to);
  selection = null; targets = []; locked = false;
  lastMove = move;
  moveLog.push({ text: sentence, short, player: mover });
  renderMoveList();

  const w = G.winnerAfter(state, mover);
  let extra = '';
  if (w !== -1) {
    const lines = G.winningLines(state, w);
    result = { type: 'win', winner: w, lines };
    const lineName = G.LINE_NAMES[lines[0]];
    extra = w === mover
      ? ` ${G.PLAYER_NAMES[w]} wins with four in a row on ${lineName}!`
      : ` That uncovered four in a row for ${G.PLAYER_NAMES[w]} on ${lineName}. ${G.PLAYER_NAMES[w]} wins!`;
  } else {
    state.turn = 1 - mover;
    const key = G.positionKey(state);
    const n = (repeatCount.get(key) || 0) + 1;
    repeatCount.set(key, n);
    if (n >= 3) {
      result = { type: 'draw', reason: 'The same position has come up 3 times.' };
      extra = ' Draw: the same position has come up 3 times.';
    } else if (!G.legalMoves(state).length) {
      state.turn = mover;
      if (!G.legalMoves(state).length) {
        result = { type: 'draw', reason: 'Neither player can move.' };
        extra = ' Draw: neither player can move.';
      } else {
        extra = ` ${G.PLAYER_NAMES[1 - mover]} has no legal move and must pass.`;
      }
    }
  }
  announce(sentence + extra);

  const finish = () => { refreshStatus(); if (byHuman) refocus(move.to); maybeComputer(); };
  if (animationsOn()) {
    anim = { code, x0: from.x, y0: from.y, x1: to.x, y1: to.y, to: move.to, start: millis(), dur: 320 };
    pendingAfterAnim = finish;
    refreshStatus();
  } else {
    finish();
  }
}

function refocus(c) {
  // keep keyboard users on the square they just played
  const active = document.activeElement;
  if (active && (active.classList.contains('cell') || active.classList.contains('stack'))) {
    focusCell = c; setRoving(c); cellButtons[c].b.focus();
  }
}

function maybeComputer() {
  if (result || anim) return;
  const seat = settings.seats[state.turn];
  if (seat === 'human') return;
  thinking = true;
  refreshStatus();
  const id = gameId;
  const delay = settings.mode === 0 ? 650 : 350;
  cpuTimer = setTimeout(() => {
    if (id !== gameId) return;
    const r = GobbletAI.chooseMove(state, seat, 900);
    thinking = false;
    if (id !== gameId) return;
    if (!r) { refreshStatus(); return; }
    playMove(r.move, false);
  }, delay);
}

function canUndo() {
  if (!history.length || settings.mode === 0 || thinking || anim) return false;
  return history.some((h) => settings.seats[h.state.turn] === 'human');
}

function undo() {
  if (!canUndo()) { say('Nothing to undo.'); return; }
  gameId++; clearTimeout(cpuTimer); thinking = false; anim = null; pendingAfterAnim = null;
  // Step back to the most recent position where a human was to move.
  let h;
  do { h = history.pop(); } while (history.length && settings.seats[h.state.turn] !== 'human');
  state = h.state; repeatCount = h.repeat; moveLog.length = h.log; lastMove = h.lastMove; result = null;
  selection = null; targets = []; locked = false;
  renderMoveList();
  announce(`Move undone. ${G.PLAYER_NAMES[state.turn]} to move.`);
  refreshStatus();
}

function offerDraw() {
  if (result || settings.mode === 0 || !isHumanTurn()) return;
  const me = state.turn;
  const other = 1 - me;
  if (settings.seats[other] === 'human') {
    document.getElementById('draw-text').textContent =
      `${G.PLAYER_NAMES[me]} offers a draw. ${G.PLAYER_NAMES[other]}, do you accept?`;
    const dlg = document.getElementById('dlg-draw');
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => {
      if (dlg.returnValue === 'yes') endByAgreement();
      else announce(`${G.PLAYER_NAMES[other]} declines the draw.`);
    }, { once: true });
  } else if (GobbletAI.acceptsDraw(state, other, settings.seats[other])) {
    endByAgreement();
  } else {
    announce('The computer declines the draw. Keep playing.');
    refreshStatus();
  }
}

function endByAgreement() {
  result = { type: 'draw', reason: 'Both players agreed to a draw.' };
  selection = null; targets = []; locked = false;
  announce('Draw by agreement.');
  refreshStatus();
}

// ------------------------------------------------------------- status ----
function refreshStatus() {
  const status = document.getElementById('status');
  const hint = document.getElementById('hint');
  const chip = document.getElementById('turn-chip');
  chip.className = 'chip';
  if (result) {
    if (result.type === 'win') {
      chip.classList.add('p' + result.winner);
      const human = settings.mode === 1 && settings.seats[result.winner] === 'human';
      const cpuWon = settings.mode === 1 && !human;
      status.textContent = `${G.PLAYER_NAMES[result.winner]} wins${human ? ' — well played!' : cpuWon ? '. The computer wins this one.' : '!'}`;
      hint.textContent = `Four in a row on ${G.LINE_NAMES[result.lines[0]]}. Choose New game to play again, or Undo to go back.`;
    } else {
      chip.classList.add('over');
      status.textContent = 'Draw';
      hint.textContent = result.reason + ' Choose New game to play again.';
    }
  } else {
    chip.classList.add('p' + state.turn);
    const name = G.PLAYER_NAMES[state.turn];
    const seat = settings.seats[state.turn];
    if (seat !== 'human') {
      status.textContent = `${name} (computer) is thinking…`;
      hint.textContent = seat === 'hard' ? 'Hard computer: searching ahead for the best move.' : 'Easy computer: picks a random legal move.';
    } else {
      status.textContent = settings.mode === 1 ? `Your turn (${name})` : `${name} to move`;
      if (!selection) hint.textContent = 'Choose a piece: one of your stacks, or one of your pieces on the board.';
      else hint.textContent = locked
        ? 'Touch-move: this piece must be played. Choose a square with a dashed ring.'
        : 'Choose a square with a dashed ring. Choose the piece again to cancel.';
    }
  }
  updateLabels();
}

function renderMoveList() {
  const ol = document.getElementById('move-list');
  ol.innerHTML = '';
  for (const m of moveLog) {
    const li = document.createElement('li');
    li.textContent = m.text;
    ol.appendChild(li);
  }
  document.getElementById('moves-empty').hidden = moveLog.length > 0;
}

function announce(msg) {
  const el = document.getElementById('announce');
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 30);
}
function say(msg) {
  announce(msg);
  document.getElementById('hint').textContent = msg;
}

// ----------------------------------------------------------- settings ----
function defaultSettings() {
  return {
    mode: 1, human: 0, levels: ['hard', 'hard'], first: '0',
    touchMove: true, numbers: true, hidden: false, anim: true,
    seats: ['human', 'hard'],
  };
}
function loadSettings() {
  let s = defaultSettings();
  try {
    const raw = localStorage.getItem('gobblet-settings');
    if (raw) s = Object.assign(s, JSON.parse(raw));
  } catch (e) { /* storage unavailable: use defaults */ }
  s.seats = seatsFor(s);
  return s;
}
function saveSettings() {
  try { localStorage.setItem('gobblet-settings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
}
function seatsFor(s) {
  if (s.mode === 2) return ['human', 'human'];
  if (s.mode === 0) return [s.levels[0], s.levels[1]];
  return [0, 1].map((p) => (p === s.human ? 'human' : s.levels[p]));
}

function applySettingsToForm() {
  document.getElementById('mode-' + settings.mode).checked = true;
  document.getElementById('human-' + settings.human).checked = true;
  document.getElementById('lvl-0').value = settings.levels[0];
  document.getElementById('lvl-1').value = settings.levels[1];
  document.getElementById('first-' + settings.first).checked = true;
  document.getElementById('opt-touch').checked = settings.touchMove;
  document.getElementById('opt-numbers').checked = settings.numbers;
  document.getElementById('opt-hidden').checked = settings.hidden;
  document.getElementById('opt-anim').checked = settings.anim;
  syncSetupForm();
}

function syncSetupForm() {
  const mode = Number(document.querySelector('input[name="mode"]:checked').value);
  const human = Number(document.querySelector('input[name="human"]:checked').value);
  document.getElementById('fs-color').hidden = mode !== 1;
  document.getElementById('fs-level').hidden = mode === 2;
  document.getElementById('lvl0-wrap').hidden = !(mode === 0 || (mode === 1 && human === 1));
  document.getElementById('lvl1-wrap').hidden = !(mode === 0 || (mode === 1 && human === 0));
}

function readSetupForm() {
  settings.mode = Number(document.querySelector('input[name="mode"]:checked').value);
  settings.human = Number(document.querySelector('input[name="human"]:checked').value);
  settings.levels = [document.getElementById('lvl-0').value, document.getElementById('lvl-1').value];
  settings.first = document.querySelector('input[name="first"]:checked').value;
  settings.touchMove = document.getElementById('opt-touch').checked;
  settings.numbers = document.getElementById('opt-numbers').checked;
  settings.hidden = document.getElementById('opt-hidden').checked;
  settings.anim = document.getElementById('opt-anim').checked;
  settings.seats = seatsFor(settings);
  saveSettings();
}

// ---------------------------------------------------------------- wiring ----
function guard(id, fn) {
  document.getElementById(id).addEventListener('click', (e) => {
    if (e.currentTarget.getAttribute('aria-disabled') === 'true') {
      if (id === 'btn-undo') say('Nothing to undo right now.');
      if (id === 'btn-draw') say(result ? 'The game is already over.' : 'You can offer a draw on your own turn.');
      return;
    }
    fn();
  });
}

function wireUI() {
  const setup = document.getElementById('dlg-setup');
  guard('btn-new', () => { applySettingsToForm(); setup.showModal(); });
  guard('btn-undo', undo);
  guard('btn-draw', offerDraw);
  guard('btn-moves', () => document.getElementById('dlg-moves').showModal());
  guard('btn-rules', () => document.getElementById('dlg-rules').showModal());
  document.getElementById('setup-cancel').addEventListener('click', () => setup.close('cancel'));
  document.getElementById('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    readSetupForm();
    setup.close('start');
    relayout();
    newGame();
  });
  document.querySelectorAll('#setup-form input[name="mode"], #setup-form input[name="human"]').forEach((el) =>
    el.addEventListener('change', syncSetupForm));

  // Escape on the page (outside dialogs) cancels a selection.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) cancelSelection(true);
  });
  reduceMotion.addEventListener('change', () => refreshStatus());
}

// Expose p5 globals.
window.setup = setup;
window.draw = draw;
window.windowResized = windowResized;
