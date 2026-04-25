# Splendor — Web Edition + AI Lab

A self-contained browser implementation of the Splendor board game with:

- **Live game** — solo vs. AI, or 2/3/4-player hot-seat
- **Six AI strategies** with a tunable heuristic
- **Simulation harness** that runs in the browser *and* via Node CLI
- **Analytics page** — strategy matches, training (random search), strategic insights, single-game replays
- **Reproducible sims** via a seedable PRNG
- **Unit tests** in `tests/` running on Node 18 / 20 / 22 in CI

No build step. No `npm install`. Just open the file or run `node`.

```
splendor/
├── index.html        live game
├── analytics.html    AI matches + training + insights + replays
├── style.css
├── data.js           card and noble data, constants
├── game.js           pure rules engine
├── ai.js             strategies, advisor, tunable weights
├── sim.js            Node CLI + browser simulator
├── ui.js             live-game DOM rendering
├── analytics.js      analytics-page rendering
└── tests/
    ├── engine.test.js
    ├── ai.test.js
    └── train_defaults.js   one-off script to retrain default weights
```

## Quick start

```bash
# Live game in your browser:
open splendor/index.html      # macOS
xdg-open splendor/index.html  # Linux

# Run the simulator from the terminal:
cd splendor
node sim.js --games 500 --strategies balanced,greedy,points,nobleRusher
node sim.js --train --rounds 25 --games 30
node --test tests/*.test.js
```

## Strategies

| name           | summary                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `random`       | Uniform over legal moves. Baseline.                                      |
| `greedy`       | Always buy the highest-VP card you can afford; otherwise take 3 different. |
| `points`       | Rush high-VP tier-2/3 cards; reserve when close.                         |
| `nobleRusher`  | Stack bonus colors that the noble pool requires.                         |
| `balanced`     | Score every legal move with a weighted heuristic; **default weights are trained**. |
| `lookahead`    | `balanced` + 1-ply minimax against opponent's best reply.                |

The balanced heuristic accepts a `weights` object — see `DEFAULT_WEIGHTS` in `ai.js`. Tune them via the **Train** panel on the analytics page or by running `node tests/train_defaults.js`.

## Sample results

Trained default weights perform well across opponents and player counts:

```
=== 200 games, 2-player ===
balanced  74.0%  ← 14.98 pts avg
greedy    26.0%  ← 11.94 pts avg

=== 200 games, 4-player ===
balanced     44.5%  (top)
greedy       29.5%
nobleRusher  22.5%
points        3.5%   ← brittle: rushes VP without economy

=== 100 games, lookahead vs balanced (2p) ===
lookahead 58%  /  balanced 42%
```

## Strategic findings

From self-play data with the trained balanced strategy:

- **First-mover advantage is real and grows with player count.**
  - 2-player: seat 1 wins **56%** vs seat 2 **44%** (Δ +12 pp)
  - 4-player: seat 1 wins **42%**, others **24% / 16% / 18%** (Δ +23 pp vs seat 2)
- **Game phases shift cleanly from gathering to spending.** Action mix per third of game:
  - Early — **buy 37% / take3 55% / take2 7% / reserve 1%**
  - Mid   — **buy 65% / take3 29% / take2 5% / reserve 1%**
  - Late  — **buy 74% / take3 18% / take2 1% / reserve 6%**
  - Reserve barely matters until late game when blocking opponents from a winning card becomes worthwhile.
- **Average game length** is ≈57 player-turns in 2-player, ≈108 in 4-player.

If you want to play to win:

1. **Open with cheap tier-1 buys** that contribute to a noble's color requirement.
2. **Take 3 different gems early** — never start the game with a take-2 unless you are one gem short of a key card.
3. **Don't rush high-VP cards** without an economy. The `points` strategy collapses to **3.5%** in 4-player precisely because it ignores cheap bonus-building.
4. **Reserve to block, not to plan.** Reserving for a future buy is rarely better than buying something now and re-targeting next turn.

## Architecture notes

- `data.js`, `game.js`, `ai.js` all carry a Node interop shim at the bottom — they assign their exports onto `global` so the same source is consumed identically by browser `<script>` tags and Node `require()`.
- `cloneState()` uses `JSON.parse(JSON.stringify(state))`, which intentionally drops the `rng` function from cloned states. The engine only consumes `rng` during `createGame`, so clones are safe — but if you add deck-shuffling actions later, re-derive `rng = mulberry32(state.seed)` after cloning.
- The **balanced** strategy intentionally introduces tiny tiebreaking randomness through `state.rng` so that two top-tied moves don't always pick the same one. With a seed, this is still fully reproducible.

## Reproducing the trained weights

`DEFAULT_WEIGHTS` in `ai.js` were produced by random search against a mixed pool (`{greedy, points, nobleRusher}`):

```bash
node tests/train_defaults.js
```

The script holds out a fresh seed for the final readout to avoid overfitting to the training seeds. Re-running with different seeds may produce slightly different (but similarly performant) weights.

## CI

`.github/workflows/splendor-ci.yml` runs on every push touching `splendor/**`:

- Syntax-checks every `.js` file under `splendor/`
- Runs `node --test tests/*.test.js` on Node 18, 20, 22
- Smoke-tests `sim.js` with a 30-game match

## Persistence

The live game auto-saves to `localStorage` after every action. Reopen the page and a **Resume saved game** button appears on the start screen. The save is cleared when the game ends or you start a new one.

## Accessibility

- Every interactive piece (gem piles, market cards, reserved cards) is keyboard-focusable and activates with `Enter` / `Space`.
- Live regions (`role="status"`, `aria-live="polite"`) announce status and pending-take changes.
- Hotkeys: `1-5` select gems, `Enter` confirms, `Esc` clears, `H` shows a hint, `?` lists shortcuts.
