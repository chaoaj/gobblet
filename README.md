# Gobblet (p5.js)
[Production url](https://chaoaj.github.io/gobblet)

An accessible, responsive p5.js version of Gobblet (Blue Orange Games), following the official 2-player rules sheet.

## Run it

Open `index.html` in a browser. p5.js 1.9.4 and the fonts load from CDNs, so you need a network connection. Because the game uses plain `<script>` tags (no modules or workers), it also runs straight from `file://`.

## Files

| File | What it does |
|---|---|
| `game.js` | Rules engine with no p5 dependency: legal moves, gobbling, the 3-in-a-row exception, the uncover rule, win and repetition checks. Also loads in Node (`require('./game.js')`). |
| `ai.js` | Computer players. **Easy** picks a random legal move. **Hard** runs negamax with alpha-beta pruning and iterative deepening for about 0.9 s (usually 4–5 plies). |
| `sketch.js` | p5 drawing, layout, input, screen-reader labels and game flow. |
| `style.css` | Page chrome, light/dark themes, focus styles, dialogs. |
| `index.html` | Page structure, dialogs, rules text. |

## Game modes

- 1 player vs the computer (choose your colour and the difficulty)
- 2 players on one device (pass and play)
- Computer vs computer (each side gets its own difficulty; useful for demos)

You can also choose who moves first, turn the touch-move rule on or off, show or hide size numbers, switch on a learning mode that shows covered pieces, and turn off animation.

## How the rules are implemented

- A new piece from a stack goes on an empty square, unless it is gobbling one of the opponent's pieces in a line where they have 3 in a row.
- A piece on the board can move to any empty square or onto any smaller piece.
- After each move, if the opponent shows 4 in a row (for example because you uncovered their piece), the opponent wins, even if you also made a line. This is the rules sheet's "you lose unless you cover a piece in that line".
- "Identical moves 3 times in a row" is treated as the same position (including whose turn it is) coming up 3 times.
- Draw by agreement: in a 2-player game the other person accepts or declines. A Hard computer accepts when its evaluation is not ahead. An Easy computer accepts half the time.
- If a player has no legal move they pass. If neither can move, the game is a draw.

## Accessibility (WCAG 2.2 AA / Section 508)

- The canvas is decorative (`aria-hidden`). Each square and stack is a real `<button>` placed exactly over its drawing. The board is an ARIA grid with roving tabindex: arrow keys move between squares, Home and End jump along a row, and Enter or Space chooses.
- Keys 1, 2 and 3 pick your stacks, but only while focus is on the board or a stack (WCAG 2.1.4). Escape cancels a choice.
- Every move is announced in a polite live region. Labels give each square's name, its contents, and whether you can move or gobble there.
- Colour is never the only cue: red pieces have a white ring and yellow pieces are solid, size numbers are shown, legal squares have a dashed ring and a dot, and the selected piece gets a double ring.
- Piece and board colours match the physical game and stay the same in light and dark mode. Every piece has a dark outline for 3:1 non-text contrast.
- Touch targets are at least 44 × 44 px. Animation follows `prefers-reduced-motion` and can also be switched off.
- A Moves dialog lists every move as text, and a Rules dialog explains the rules and the controls.
- axe-core 4.9 reported no WCAG 2.0/2.1/2.2 A or AA violations, in light or dark theme.
