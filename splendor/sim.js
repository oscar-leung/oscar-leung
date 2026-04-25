// Splendor simulation harness. Runs many AI-vs-AI games and reports stats.
//
// Usage (Node):
//   node sim.js                                      # quick default match
//   node sim.js --games 500 --strategies balanced,greedy,points,nobleRusher
//   node sim.js --train --games 200 --rounds 25      # tune balanced weights
//
// Browser usage: this file exposes window.SplendorSim with the same API,
// used by analytics.html.

(function () {
  const isNode = typeof module !== "undefined" && module.exports;
  if (isNode) {
    require("./data.js");
    require("./game.js");
    require("./ai.js");
  }

  const TURN_HARD_LIMIT = 60; // safety cap to abort runaway games

  // ---------- Run a single game ----------
  function runGame(strategies, opts = {}) {
    if (strategies.length < 2 || strategies.length > 4) {
      throw new Error(`Splendor supports 2-4 players; got ${strategies.length}`);
    }
    const playerNames = strategies.map((s, i) => `${s.label || ("S" + i)}-${i}`);
    const state = createGame({ playerNames, vsAI: false, seed: opts.seed });
    const actionLog = opts.collectActions ? [] : null;
    const stats = {
      turns: 0,
      winner: null,
      perPlayer: state.players.map(() => ({
        actions: { take: 0, take2: 0, reserve: 0, buy: 0 },
        cards: 0, points: 0, nobles: 0,
      })),
      finalPoints: state.players.map(() => 0),
    };

    while (!state.gameOver && stats.turns < TURN_HARD_LIMIT * state.players.length) {
      const idx = state.current;
      const strat = strategies[idx];
      const action = strat.choose(state, strat.weights);
      if (!action) {
        // No legal move; force-end safely
        endTurn(state);
        stats.turns++;
        continue;
      }
      stats.perPlayer[idx].actions[action.type === "take2" ? "take2" : action.type]++;
      if (actionLog) {
        let cardBonus = null;
        if (action.type === "buy") {
          const card = action.source === "reserved"
            ? state.players[idx].reserved.find((c) => c.id === action.cardId)
            : state.market[action.tier].find((c) => c.id === action.cardId);
          if (card) cardBonus = card.bonus;
        }
        actionLog.push({
          turn: state.turnNumber,
          seat: idx,
          type: action.type,
          tier: action.tier || null,
          bonus: cardBonus,
        });
      }
      const ok = applyAction(state, action, { autoDiscard: true });
      stats.turns++;
      if (!ok) {
        // Defensive fallback: skip turn rather than crash
        endTurn(state);
        continue;
      }
    }

    if (!state.gameOver) finishGame(state);

    state.players.forEach((p, i) => {
      stats.perPlayer[i].cards = p.cards.length;
      stats.perPlayer[i].points = p.points;
      stats.perPlayer[i].nobles = p.nobles.length;
      stats.finalPoints[i] = p.points;
    });
    stats.winner = state.winner.id;
    if (actionLog) stats.actionLog = actionLog;
    return stats;
  }

  // ---------- Run a match (N games) ----------
  function runMatch(strategies, n = 100, onProgress = null, opts = {}) {
    const results = strategies.map((s) => ({
      label: s.label,
      wins: 0, totalPoints: 0, totalCards: 0, totalNobles: 0,
      actions: { take: 0, take2: 0, reserve: 0, buy: 0 },
    }));
    const turnHistogram = [];
    for (let g = 0; g < n; g++) {
      // Rotate seat to fairly evaluate first-move advantage across runs
      const rot = g % strategies.length;
      const seat = strategies.slice(rot).concat(strategies.slice(0, rot));
      // Per-game seed: deterministic when caller provides a base seed; otherwise random
      const gameSeed = opts.seed != null ? ((opts.seed >>> 0) ^ (g * 0x9E3779B1)) >>> 0 : undefined;
      const result = runGame(seat, { seed: gameSeed });
      turnHistogram.push(result.turns);
      for (let i = 0; i < seat.length; i++) {
        const original = strategies.indexOf(seat[i]);
        results[original].totalPoints += result.perPlayer[i].points;
        results[original].totalCards += result.perPlayer[i].cards;
        results[original].totalNobles += result.perPlayer[i].nobles;
        for (const k of Object.keys(result.perPlayer[i].actions)) {
          results[original].actions[k] += result.perPlayer[i].actions[k];
        }
      }
      const winnerSeat = result.winner;
      const winnerOriginal = strategies.indexOf(seat[winnerSeat]);
      results[winnerOriginal].wins++;
      if (onProgress && (g + 1) % Math.max(1, Math.floor(n / 25)) === 0) onProgress((g + 1) / n);
    }
    // Normalize
    for (const r of results) {
      r.winRate = r.wins / n;
      r.avgPoints = r.totalPoints / n;
      r.avgCards = r.totalCards / n;
      r.avgNobles = r.totalNobles / n;
      const total = Object.values(r.actions).reduce((a, b) => a + b, 0) || 1;
      r.actionPct = {
        take: r.actions.take / total,
        take2: r.actions.take2 / total,
        reserve: r.actions.reserve / total,
        buy: r.actions.buy / total,
      };
    }
    const avgTurns = turnHistogram.reduce((a, b) => a + b, 0) / Math.max(1, turnHistogram.length);
    return { games: n, results, avgTurns, turnHistogram };
  }

  // ---------- Random-search "training" of balanced weights ----------
  function trainBalanced(opts = {}) {
    const rounds = opts.rounds || 25;
    const gamesPerRound = opts.games || 30;
    const opponent = opts.opponent || { label: "greedy", choose: STRATEGIES.greedy.choose };
    const onProgress = opts.onProgress || null;

    const baseline = STRATEGIES.balanced;
    let bestWeights = { ...DEFAULT_WEIGHTS };
    let bestWinRate = -1;
    const history = [];

    for (let r = 0; r < rounds; r++) {
      const candidate = perturbWeights(bestWeights, 0.4);
      const stratA = { label: "candidate", choose: baseline.choose, weights: candidate };
      const stratB = { label: opponent.label, choose: opponent.choose, weights: opponent.weights };
      const match = runMatch([stratA, stratB], gamesPerRound);
      const wr = match.results[0].winRate;
      const accepted = wr > bestWinRate;
      if (accepted) { bestWeights = candidate; bestWinRate = wr; }
      history.push({ round: r + 1, winRate: wr, accepted, weights: candidate });
      if (onProgress) onProgress((r + 1) / rounds, history[history.length - 1]);
    }
    return { bestWeights, bestWinRate, history };
  }

  function perturbWeights(w, scale) {
    const out = { ...w };
    for (const k of Object.keys(out)) {
      const noise = (Math.random() * 2 - 1) * scale * Math.max(0.5, Math.abs(out[k]));
      out[k] = Math.max(0, out[k] + noise);
    }
    return out;
  }

  // ---------- Insights: data-driven strategic findings ----------
  // Plays N self-play games with the same strategy and aggregates:
  //   - first-move advantage (seat-0 win rate vs others)
  //   - average game length
  //   - action mix by turn quartile (early/mid/late game)
  //   - which bonus colors get bought most frequently among winners
  function analyzeInsights(strategy, n = 100, opts = {}) {
    const playerCount = opts.playerCount || 2;
    const strategies = Array.from({ length: playerCount }, () => ({
      label: strategy.label, choose: strategy.choose, weights: strategy.weights,
    }));
    const seatWins = Array(playerCount).fill(0);
    const turnLengths = [];
    const quartileMix = { early: { take: 0, take2: 0, reserve: 0, buy: 0 },
                          mid:   { take: 0, take2: 0, reserve: 0, buy: 0 },
                          late:  { take: 0, take2: 0, reserve: 0, buy: 0 } };
    const winnerBonusCounts = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
    const tierBuysByQuartile = { early: { 1: 0, 2: 0, 3: 0 }, mid: { 1: 0, 2: 0, 3: 0 }, late: { 1: 0, 2: 0, 3: 0 } };

    for (let g = 0; g < n; g++) {
      const seed = opts.seed != null ? ((opts.seed >>> 0) ^ (g * 0x9E3779B1)) >>> 0 : undefined;
      const result = runGame(strategies, { seed, collectActions: true });
      seatWins[result.winner]++;
      turnLengths.push(result.turns);

      const maxTurn = Math.max(1, ...result.actionLog.map((a) => a.turn));
      for (const a of result.actionLog) {
        const q = a.turn / maxTurn;
        const bucket = q < 0.34 ? "early" : q < 0.67 ? "mid" : "late";
        const t = a.type === "take2" ? "take2" : a.type;
        if (quartileMix[bucket][t] != null) quartileMix[bucket][t]++;
        if (a.type === "buy" && a.tier) tierBuysByQuartile[bucket][a.tier]++;
      }
      // Winner bonus distribution: re-run a parallel game to grab final state isn't easy here;
      // instead infer from actionLog buys made by the winner.
      const winnerBuys = result.actionLog.filter((a) => a.type === "buy" && a.seat === result.winner && a.bonus);
      for (const a of winnerBuys) winnerBonusCounts[a.bonus]++;
    }

    const seatRates = seatWins.map((w) => w / n);
    return {
      games: n,
      playerCount,
      seatWinRates: seatRates,
      firstMoverAdvantage: seatRates[0] - (seatRates.slice(1).reduce((a, b) => a + b, 0) / (playerCount - 1)),
      avgTurns: turnLengths.reduce((a, b) => a + b, 0) / n,
      actionMixByQuartile: normalizeMix(quartileMix),
      tierBuysByQuartile,
      winnerBonusDistribution: normalizeCounts(winnerBonusCounts),
    };
  }

  function normalizeMix(mix) {
    const out = {};
    for (const k of Object.keys(mix)) {
      const total = Object.values(mix[k]).reduce((a, b) => a + b, 0) || 1;
      out[k] = {};
      for (const t of Object.keys(mix[k])) out[k][t] = mix[k][t] / total;
    }
    return out;
  }

  function normalizeCounts(counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const out = {};
    for (const k of Object.keys(counts)) out[k] = counts[k] / total;
    return out;
  }

  // ---------- Strategy bundle helpers ----------

  function buildStrategy(name) {
    const s = STRATEGIES[name];
    if (!s) throw new Error(`Unknown strategy: ${name}`);
    return { label: name, choose: s.choose };
  }

  // ---------- CLI ----------

  function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
      const a = argv[i];
      if (a.startsWith("--")) {
        const k = a.slice(2);
        const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
        out[k] = v;
      }
    }
    return out;
  }

  function formatPercent(x) { return (x * 100).toFixed(1) + "%"; }

  function printMatchReport(match, strategies) {
    console.log("\n=== Splendor AI Match Report ===");
    console.log(`Games:     ${match.games}`);
    console.log(`Avg turns: ${match.avgTurns.toFixed(1)}`);
    console.log("");
    const headers = ["Strategy", "Win%", "Avg Pts", "Avg Cards", "Avg Nobles", "Buy%", "Take3%", "Take2%", "Reserve%"];
    const rows = match.results.map((r, i) => [
      strategies[i].label,
      formatPercent(r.winRate),
      r.avgPoints.toFixed(2),
      r.avgCards.toFixed(2),
      r.avgNobles.toFixed(2),
      formatPercent(r.actionPct.buy),
      formatPercent(r.actionPct.take),
      formatPercent(r.actionPct.take2),
      formatPercent(r.actionPct.reserve),
    ]);
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
    const fmt = (vals) => vals.map((v, i) => String(v).padEnd(widths[i] + 2)).join("");
    console.log(fmt(headers));
    console.log(fmt(widths.map((w) => "-".repeat(w))));
    for (const row of rows) console.log(fmt(row));
  }

  function cli() {
    const args = parseArgs(process.argv);
    if (args.train) {
      const games = parseInt(args.games || 30, 10);
      const rounds = parseInt(args.rounds || 25, 10);
      console.log(`Training balanced heuristic vs greedy: ${rounds} rounds × ${games} games...`);
      const result = trainBalanced({
        rounds, games,
        onProgress: (pct, last) => {
          process.stdout.write(`\rRound ${last.round}/${rounds} winRate=${formatPercent(last.winRate)} ${last.accepted ? "✓" : " "}     `);
        },
      });
      console.log(`\n\nBest win rate vs greedy: ${formatPercent(result.bestWinRate)}`);
      console.log("Best weights:");
      for (const k of Object.keys(result.bestWeights)) {
        console.log(`  ${k.padEnd(22)} ${result.bestWeights[k].toFixed(3)}`);
      }
      return;
    }

    const stratNames = (args.strategies || "balanced,greedy,points,nobleRusher").split(",");
    const games = parseInt(args.games || 200, 10);
    const strategies = stratNames.map(buildStrategy);
    console.log(`Running ${games} games among: ${stratNames.join(", ")}`);
    const match = runMatch(strategies, games, (pct) => {
      process.stdout.write(`\rProgress: ${(pct * 100).toFixed(0)}%   `);
    });
    process.stdout.write("\r" + " ".repeat(40) + "\r");
    printMatchReport(match, strategies);
  }

  // ---------- Exports ----------

  const api = {
    runGame, runMatch, trainBalanced, buildStrategy, perturbWeights,
    analyzeInsights, TURN_HARD_LIMIT,
  };

  if (isNode) {
    module.exports = api;
    if (require.main === module) cli();
  } else {
    window.SplendorSim = api;
  }
})();
