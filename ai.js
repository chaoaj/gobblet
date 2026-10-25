/*
 * ai.js — Computer opponents for Gobblet.
 *   easy   : picks a uniformly random legal move.
 *   medium : looks exactly 2 plies ahead (its move + your reply). It always
 *            takes a win and avoids moves that let you win next turn, but
 *            MEDIUM_SLIP of the time it plays one of its next-best safe moves
 *            (from the top MEDIUM_POOL) instead of its best one, so it can be
 *            outplanned.
 *   hard   : negamax search with alpha-beta pruning and iterative deepening
 *            under a time budget, plus a line-based evaluation.
 */
(function (root) {
  'use strict';
  const G = (typeof module !== 'undefined' && module.exports) ? require('./game.js') : root.Gobblet;
  const { LINES, owner, sizeOf, top, legalMoves, applyMove, undoMove, winnerAfter } = G;

  const WIN = 100000;
  const MEDIUM_DEPTH = 2;   // plies searched by Medium
  const MEDIUM_SLIP = 0.2;  // chance Medium plays a next-best move instead of its best
  const MEDIUM_POOL = 5;    // how many next-best safe moves a slip chooses from
  // Value of showing k pieces of your colour in an otherwise friendly line.
  const LINE_W = [0, 2, 12, 70, 0];

  class Timeout extends Error {}

  /** Static evaluation from the point of view of `p`. */
  function evaluate(s, p) {
    let score = 0;
    for (const line of LINES) {
      let mine = 0, theirs = 0, mineSize = 0, theirSize = 0;
      for (const c of line) {
        const t = top(s, c);
        if (!t) continue;
        if (owner(t) === p) { mine++; mineSize += sizeOf(t); }
        else { theirs++; theirSize += sizeOf(t); }
      }
      // A line is still worth something when mixed, because smaller enemy
      // pieces in it can be gobbled.
      score += LINE_W[mine] * (theirs ? 0.35 : 1);
      score -= LINE_W[theirs] * (mine ? 0.35 : 1);
      score += (mineSize - theirSize) * 0.4;
    }
    // Pieces that pin down (cover) enemy pieces are valuable.
    for (let c = 0; c < 16; c++) {
      const st = s.board[c];
      if (st.length < 2) continue;
      const t = st[st.length - 1];
      for (let k = 0; k < st.length - 1; k++) {
        if (owner(st[k]) !== owner(t)) score += owner(t) === p ? 3 : -3;
      }
    }
    // Centre squares sit on 3 lines.
    for (const c of [5, 6, 9, 10]) {
      const t = top(s, c);
      if (t) score += owner(t) === p ? 1.5 : -1.5;
    }
    return score;
  }

  function orderScore(s, m) {
    let v = 0;
    const target = top(s, m.to);
    if (target) v += 20 + sizeOf(target) * 2 + (owner(target) !== s.turn ? 10 : -10);
    const piece = m.src === 'r'
      ? s.reserves[s.turn][m.i][s.reserves[s.turn][m.i].length - 1]
      : sizeOf(top(s, m.i));
    v += piece;
    if (m.src === 'b' && s.board[m.i].length > 1) v -= 6; // uncovering is risky
    return v;
  }

  function search(s, depth, alpha, beta, ply, ctx) {
    if ((++ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) throw new Timeout();
    const me = s.turn;
    if (depth === 0) return evaluate(s, me);
    const moves = legalMoves(s, true);
    if (!moves.length) return 0;
    moves.sort((a, b) => orderScore(s, b) - orderScore(s, a));
    let best = -Infinity;
    for (const m of moves) {
      applyMove(s, m);
      const w = winnerAfter(s, me);
      let v;
      if (w !== -1) {
        v = w === me ? WIN - ply : -(WIN - ply);
      } else {
        s.turn = 1 - me;
        try { v = -search(s, depth - 1, -beta, -alpha, ply + 1, ctx); }
        finally { s.turn = me; }
      }
      undoMove(s, m);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  function hardMove(state, timeMs, maxDepth) {
    const s = G.cloneState(state);
    const me = s.turn;
    const ctx = { nodes: 0, deadline: performance.now() + (timeMs || 900) };
    let moves = legalMoves(s, true);
    if (!moves.length) return null;
    moves.sort((a, b) => orderScore(s, b) - orderScore(s, a));

    let bestMove = moves[0];
    let reached = 0;
    let lastScored = null;
    for (let depth = 1; depth <= (maxDepth || 8); depth++) {
      const scored = [];
      let alpha = -Infinity;
      try {
        for (const m of moves) {
          applyMove(s, m);
          const w = winnerAfter(s, me);
          let v;
          if (w !== -1) v = w === me ? WIN : -WIN;
          else {
            s.turn = 1 - me;
            try { v = -search(s, depth - 1, -Infinity, -alpha + 0.001, 1, ctx); }
            finally { s.turn = me; }
          }
          undoMove(s, m);
          scored.push({ m, v });
          if (v > alpha) alpha = v;
        }
      } catch (e) {
        if (e instanceof Timeout) break;
        throw e;
      }
      reached = depth;
      scored.sort((a, b) => b.v - a.v);
      lastScored = scored;
      // Pick randomly among moves tied for best so games vary.
      const top1 = scored[0].v;
      const ties = scored.filter((x) => x.v >= top1 - 0.0001);
      bestMove = ties[Math.floor(Math.random() * ties.length)].m;
      moves = scored.map((x) => x.m);
      if (Math.abs(top1) >= WIN - 50) break; // forced result found
    }
    return { move: bestMove, depth: reached, nodes: ctx.nodes, scored: lastScored };
  }

  function mediumMove(state) {
    // Full-width search to MEDIUM_DEPTH (generous time cap so it always finishes).
    const r = hardMove(state, 5000, MEDIUM_DEPTH);
    if (!r || !r.scored) return r;
    const best = r.scored[0];
    if (best.v >= WIN - 50) return r;                        // always take a win
    const safe = r.scored.filter((x) => x.v > -(WIN - 50));  // your reply can't win
    if (safe.length > 1 && Math.random() < MEDIUM_SLIP) {
      // Slip to a decent alternative, not a wild one: ranks 2..(MEDIUM_POOL+1).
      const pool = safe.slice(1, 1 + MEDIUM_POOL);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return { move: pick.m, depth: r.depth, nodes: r.nodes, slipped: true };
    }
    return r;
  }

  function easyMove(state) {
    const moves = legalMoves(state, false);
    if (!moves.length) return null;
    return { move: moves[Math.floor(Math.random() * moves.length)], depth: 0, nodes: 0 };
  }

  function chooseMove(state, level, timeMs) {
    if (level === 'hard') return hardMove(state, timeMs);
    if (level === 'medium') return mediumMove(state);
    return easyMove(state);
  }

  /** Would the computer accept a draw offer? (score from its own view) */
  function acceptsDraw(state, cpuPlayer, level) {
    if (level === 'easy') return Math.random() < 0.5;
    const s = G.cloneState(state);
    s.turn = cpuPlayer;
    return evaluate(s, cpuPlayer) <= 5;
  }

  const api = { chooseMove, evaluate, acceptsDraw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GobbletAI = api;
})(typeof self !== 'undefined' ? self : this);
