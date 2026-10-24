/*
 * game.js — Gobblet rules engine (no p5 dependency).
 *
 * Rules implemented (from the Blue Orange "Gobblet" rules sheet):
 *  - 4x4 board. Each player has 12 Gobblets: 3 external stacks of 4 nesting
 *    sizes (1 = small ... 4 = extra large). Only the top (largest remaining)
 *    piece of an external stack can be played.
 *  - On your turn do ONE of:
 *      1. Put a new Gobblet from an external stack on an EMPTY square.
 *         Exception: if the opponent has 3 in a row, you may gobble one of
 *         those 3 pieces with a bigger Gobblet from an external stack.
 *      2. Move one of your Gobblets on the board to any empty square.
 *      3. Move one of your Gobblets on the board onto any smaller Gobblet
 *         (yours or the opponent's, any smaller size).
 *  - Lifting a piece can uncover what is underneath. If that reveals 4 in a
 *    row for the opponent, you lose — unless the piece you are moving lands
 *    on a different square of that same line and breaks it.
 *  - First to show 4 of their colour in a row (any sizes; row, column or
 *    diagonal) wins.
 *  - Draw if the same position comes up 3 times (both players repeating the
 *    same moves), or by mutual agreement.
 *
 * Encoding (kept small so the AI search is fast):
 *  - Player 0 = Yellow, Player 1 = Red.
 *  - A piece is an integer 1..8: size + 4 * player  (1..4 Yellow, 5..8 Red).
 *  - board[cell] is an array (bottom ... top) of piece codes; cell = row*4+col.
 *  - reserves[player][stack] is an array of sizes (bottom ... top).
 */
(function (root) {
  'use strict';

  const N = 4;
  const PLAYER_NAMES = ['Yellow', 'Red'];
  const SIZE_NAMES = ['', 'small', 'medium', 'large', 'extra-large'];
  const COLS = 'ABCD';

  // All 10 winning lines.
  const LINES = [];
  for (let r = 0; r < N; r++) LINES.push([0, 1, 2, 3].map((c) => r * N + c));
  for (let c = 0; c < N; c++) LINES.push([0, 1, 2, 3].map((r) => r * N + c));
  LINES.push([0, 5, 10, 15]);
  LINES.push([3, 6, 9, 12]);

  const LINE_NAMES = [
    'row 1', 'row 2', 'row 3', 'row 4',
    'column A', 'column B', 'column C', 'column D',
    'the diagonal A1 to D4', 'the diagonal D1 to A4',
  ];

  const owner = (code) => (code > 4 ? 1 : 0);
  const sizeOf = (code) => ((code - 1) % 4) + 1;
  const pieceCode = (player, size) => size + 4 * player;
  const cellName = (cell) => COLS[cell % N] + (Math.floor(cell / N) + 1);

  function newState(firstPlayer) {
    return {
      board: Array.from({ length: N * N }, () => []),
      reserves: [0, 1].map(() => [[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]]),
      turn: firstPlayer || 0,
    };
  }

  function cloneState(s) {
    return {
      board: s.board.map((st) => st.slice()),
      reserves: s.reserves.map((p) => p.map((st) => st.slice())),
      turn: s.turn,
    };
  }

  function top(s, cell) {
    const st = s.board[cell];
    return st.length ? st[st.length - 1] : 0;
  }

  /** Cells that are part of a line where `player` shows exactly 3 tops. */
  function threeInRowCells(s, player) {
    const set = new Set();
    for (const line of LINES) {
      let count = 0;
      for (const c of line) {
        const t = top(s, c);
        if (t && owner(t) === player) count++;
      }
      if (count === 3) {
        for (const c of line) {
          const t = top(s, c);
          if (t && owner(t) === player) set.add(c);
        }
      }
    }
    return set;
  }

  /** Lines (indices into LINES) fully showing `player`'s colour. */
  function winningLines(s, player) {
    const out = [];
    LINES.forEach((line, i) => {
      if (line.every((c) => { const t = top(s, c); return t && owner(t) === player; })) out.push(i);
    });
    return out;
  }

  /**
   * All legal moves for the player to move.
   * Move = { src: 'r', i: stackIndex, to: cell } or { src: 'b', i: fromCell, to: cell }
   * dedupe: collapse reserve stacks whose top sizes are equal (same outcome) — used by the AI.
   */
  function legalMoves(s, dedupe) {
    const p = s.turn;
    const opp = 1 - p;
    const moves = [];
    const threes = threeInRowCells(s, opp);
    const seenSizes = new Set();

    // 1. From external stacks.
    s.reserves[p].forEach((stack, i) => {
      if (!stack.length) return;
      const size = stack[stack.length - 1];
      if (dedupe) {
        if (seenSizes.has(size)) return;
        seenSizes.add(size);
      }
      for (let c = 0; c < 16; c++) {
        const t = top(s, c);
        if (!t) moves.push({ src: 'r', i, to: c });
        else if (threes.has(c) && sizeOf(t) < size) moves.push({ src: 'r', i, to: c });
      }
    });

    // 2 & 3. Move a piece already on the board.
    for (let from = 0; from < 16; from++) {
      const t = top(s, from);
      if (!t || owner(t) !== p) continue;
      const size = sizeOf(t);
      for (let c = 0; c < 16; c++) {
        if (c === from) continue;
        const u = top(s, c);
        if (!u || sizeOf(u) < size) moves.push({ src: 'b', i: from, to: c });
      }
    }
    return moves;
  }

  function movesFrom(s, src, i) {
    return legalMoves(s, false).filter((m) => m.src === src && m.i === i);
  }

  function sameMove(a, b) {
    return a && b && a.src === b.src && a.i === b.i && a.to === b.to;
  }

  /** Mutating apply. Returns an undo record. Does NOT change s.turn. */
  function applyMove(s, m) {
    const p = s.turn;
    let code;
    if (m.src === 'r') {
      code = pieceCode(p, s.reserves[p][m.i].pop());
    } else {
      code = s.board[m.i].pop();
    }
    s.board[m.to].push(code);
    return m;
  }

  function undoMove(s, m) {
    const p = s.turn;
    const code = s.board[m.to].pop();
    if (m.src === 'r') s.reserves[p][m.i].push(sizeOf(code));
    else s.board[m.i].push(code);
  }

  /**
   * After `mover` has moved: who has won, if anyone?
   * An opponent line takes priority (the uncover rule: you lose).
   */
  function winnerAfter(s, mover) {
    const opp = 1 - mover;
    if (winningLines(s, opp).length) return opp;
    if (winningLines(s, mover).length) return mover;
    return -1;
  }

  function positionKey(s) {
    let k = s.turn + '|';
    for (const st of s.board) k += st.join('') + ',';
    k += '|' + s.reserves.map((p) => p.map((st) => st.length).join('')).join('/');
    return k;
  }

  /** Human-readable sentence for a move, computed BEFORE it is applied. */
  function describeMove(s, m) {
    const p = s.turn;
    const name = PLAYER_NAMES[p];
    let size;
    let text;
    if (m.src === 'r') {
      const st = s.reserves[p][m.i];
      size = st[st.length - 1];
      text = `${name} plays a new ${SIZE_NAMES[size]} piece from stack ${m.i + 1} to ${cellName(m.to)}`;
    } else {
      size = sizeOf(top(s, m.i));
      text = `${name} moves the ${SIZE_NAMES[size]} piece from ${cellName(m.i)} to ${cellName(m.to)}`;
    }
    const under = top(s, m.to);
    if (under) {
      const whose = owner(under) === p ? 'their own' : `${PLAYER_NAMES[owner(under)]}'s`;
      text += `, gobbling ${whose} ${SIZE_NAMES[sizeOf(under)]} piece`;
    }
    if (m.src === 'b' && s.board[m.i].length > 1) {
      const revealed = s.board[m.i][s.board[m.i].length - 2];
      text += ` and uncovering ${PLAYER_NAMES[owner(revealed)]}'s ${SIZE_NAMES[sizeOf(revealed)]} piece on ${cellName(m.i)}`;
    }
    return text + '.';
  }

  function shortNotation(s, m) {
    const p = s.turn;
    const letter = p === 0 ? 'Y' : 'R';
    if (m.src === 'r') {
      const st = s.reserves[p][m.i];
      return `${letter}${st[st.length - 1]} →${cellName(m.to)}`;
    }
    return `${letter}${sizeOf(top(s, m.i))} ${cellName(m.i)}→${cellName(m.to)}`;
  }

  const api = {
    N, LINES, LINE_NAMES, PLAYER_NAMES, SIZE_NAMES, COLS,
    owner, sizeOf, pieceCode, cellName,
    newState, cloneState, top, threeInRowCells, winningLines,
    legalMoves, movesFrom, sameMove, applyMove, undoMove, winnerAfter,
    positionKey, describeMove, shortNotation,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Gobblet = api;
})(typeof self !== 'undefined' ? self : this);
