// Analytics page: matches, training, and a step-through replay viewer.
(function () {
  const $ = (id) => document.getElementById(id);
  const STRAT_NAMES = Object.keys(STRATEGIES);
  const STRAT_COLORS = {
    buy: "#4ea865",
    take: "#38bdf8",
    take2: "#7c5cff",
    reserve: "#f4c430",
  };

  // ---------- Strategy descriptions ----------
  $("strategy-list").innerHTML = STRAT_NAMES.map((k) => {
    const s = STRATEGIES[k];
    return `<div><strong>${s.name}</strong> — ${s.description}</div>`;
  }).join("");

  // ---------- Seat selectors ----------
  const seats = [];
  function buildSeat(idx, defaultStrat) {
    const wrap = document.createElement("div");
    wrap.className = "seat-row";
    const lbl = document.createElement("div");
    lbl.textContent = `Seat ${idx + 1}`;
    const sel = document.createElement("select");
    for (const k of STRAT_NAMES) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = STRATEGIES[k].name;
      sel.appendChild(opt);
    }
    sel.value = defaultStrat;
    wrap.append(lbl, sel);
    seats.push({ wrap, sel });
    $("seats").appendChild(wrap);
  }
  buildSeat(0, "balanced");
  buildSeat(1, "greedy");

  $("add-seat").addEventListener("click", () => {
    if (seats.length >= 4) return;
    const defaults = ["points", "nobleRusher"];
    buildSeat(seats.length, defaults[seats.length - 2] || "random");
  });
  $("remove-seat").addEventListener("click", () => {
    if (seats.length <= 2) return;
    const last = seats.pop();
    last.wrap.remove();
  });

  // ---------- Match runner ----------
  $("run-match").addEventListener("click", async () => {
    const games = parseInt($("games").value, 10);
    const strats = seats.map((s) => SplendorSim.buildStrategy(s.sel.value));
    const progress = $("match-progress");
    progress.style.width = "0%";
    $("match-results").innerHTML = "<p style='color:var(--text-dim);'>Running…</p>";

    // Run in chunks so the UI doesn't freeze
    const result = await runMatchChunked(strats, games, (pct) => {
      progress.style.width = (pct * 100).toFixed(1) + "%";
    });
    progress.style.width = "100%";
    renderMatchResults(result, strats);
  });

  function runMatchChunked(strats, games, onProgress) {
    return new Promise((resolve) => {
      const chunkSize = 25;
      let done = 0;
      const aggregate = {
        games: 0,
        results: strats.map((s) => ({
          label: s.label,
          wins: 0, totalPoints: 0, totalCards: 0, totalNobles: 0,
          actions: { take: 0, take2: 0, reserve: 0, buy: 0 },
        })),
        avgTurns: 0,
        turnHistogram: [],
      };
      function runChunk() {
        const n = Math.min(chunkSize, games - done);
        if (n === 0) {
          // finalize averages
          for (const r of aggregate.results) {
            r.winRate = r.wins / aggregate.games;
            r.avgPoints = r.totalPoints / aggregate.games;
            r.avgCards = r.totalCards / aggregate.games;
            r.avgNobles = r.totalNobles / aggregate.games;
            const total = Object.values(r.actions).reduce((a, b) => a + b, 0) || 1;
            r.actionPct = {
              take: r.actions.take / total,
              take2: r.actions.take2 / total,
              reserve: r.actions.reserve / total,
              buy: r.actions.buy / total,
            };
          }
          aggregate.avgTurns = aggregate.turnHistogram.reduce((a, b) => a + b, 0) / Math.max(1, aggregate.turnHistogram.length);
          resolve(aggregate);
          return;
        }
        const partial = SplendorSim.runMatch(strats, n);
        // merge
        aggregate.games += partial.games;
        aggregate.turnHistogram.push(...partial.turnHistogram);
        for (let i = 0; i < strats.length; i++) {
          const a = aggregate.results[i], p = partial.results[i];
          a.wins += p.wins;
          a.totalPoints += p.totalPoints;
          a.totalCards += p.totalCards;
          a.totalNobles += p.totalNobles;
          for (const k of Object.keys(a.actions)) a.actions[k] += p.actions[k];
        }
        done += n;
        onProgress(done / games);
        setTimeout(runChunk, 0);
      }
      runChunk();
    });
  }

  function renderMatchResults(match, strats) {
    const target = $("match-results");
    let html = `<p style="color:var(--text-dim); margin-top:14px;">${match.games} games · avg ${match.avgTurns.toFixed(1)} turns</p>`;
    html += `<table class="stats">
      <thead><tr>
        <th>Strategy</th>
        <th class="winbar-cell">Win Rate</th>
        <th>Avg Pts</th>
        <th>Avg Cards</th>
        <th>Avg Nobles</th>
        <th>Action Mix (Buy / Take3 / Take2 / Reserve)</th>
      </tr></thead><tbody>`;
    for (let i = 0; i < strats.length; i++) {
      const r = match.results[i];
      const winPct = (r.winRate * 100).toFixed(1);
      const actBar = `<div class="action-bar">
        <div style="width:${(r.actionPct.buy*100).toFixed(1)}%; background:${STRAT_COLORS.buy};" title="Buy"></div>
        <div style="width:${(r.actionPct.take*100).toFixed(1)}%; background:${STRAT_COLORS.take};" title="Take 3"></div>
        <div style="width:${(r.actionPct.take2*100).toFixed(1)}%; background:${STRAT_COLORS.take2};" title="Take 2"></div>
        <div style="width:${(r.actionPct.reserve*100).toFixed(1)}%; background:${STRAT_COLORS.reserve};" title="Reserve"></div>
      </div>`;
      html += `<tr>
        <td><strong>${STRATEGIES[strats[i].label].name}</strong></td>
        <td><div class="winbar"><div style="width:${winPct}%"></div><span>${winPct}%</span></div></td>
        <td class="num">${r.avgPoints.toFixed(2)}</td>
        <td class="num">${r.avgCards.toFixed(2)}</td>
        <td class="num">${r.avgNobles.toFixed(2)}</td>
        <td>${actBar}<div class="legend" style="margin-top:2px;">
          <span><span class="swatch" style="background:${STRAT_COLORS.buy}"></span>${(r.actionPct.buy*100).toFixed(0)}%</span>
          <span><span class="swatch" style="background:${STRAT_COLORS.take}"></span>${(r.actionPct.take*100).toFixed(0)}%</span>
          <span><span class="swatch" style="background:${STRAT_COLORS.take2}"></span>${(r.actionPct.take2*100).toFixed(0)}%</span>
          <span><span class="swatch" style="background:${STRAT_COLORS.reserve}"></span>${(r.actionPct.reserve*100).toFixed(0)}%</span>
        </div></td>
      </tr>`;
    }
    html += `</tbody></table>`;
    target.innerHTML = html;
  }

  // ---------- Trainer ----------
  $("run-train").addEventListener("click", () => {
    const opponent = $("train-opponent").value;
    const rounds = parseInt($("train-rounds").value, 10);
    const games = parseInt($("train-games").value, 10);
    const progress = $("train-progress");
    progress.style.width = "0%";
    const target = $("train-results");
    target.innerHTML = "<p style='color:var(--text-dim);'>Training…</p>";

    runTrainingChunked(opponent, rounds, games, progress, target);
  });

  function runTrainingChunked(opponent, rounds, gamesPerRound, progressEl, target) {
    let bestWeights = { ...DEFAULT_WEIGHTS };
    let bestWinRate = -1;
    const history = [];
    const opp = { label: opponent, choose: STRATEGIES[opponent].choose };

    function step(r) {
      if (r >= rounds) {
        renderTrainingFinal(target, bestWeights, bestWinRate, history);
        progressEl.style.width = "100%";
        return;
      }
      const candidate = SplendorSim.perturbWeights(bestWeights, 0.4);
      const stratA = { label: "candidate", choose: STRATEGIES.balanced.choose, weights: candidate };
      const match = SplendorSim.runMatch([stratA, opp], gamesPerRound);
      const wr = match.results[0].winRate;
      const accepted = wr > bestWinRate;
      if (accepted) { bestWeights = candidate; bestWinRate = wr; }
      history.push({ round: r + 1, winRate: wr, accepted, weights: candidate });
      progressEl.style.width = ((r + 1) / rounds * 100).toFixed(1) + "%";
      renderTrainingProgress(target, bestWeights, bestWinRate, history);
      setTimeout(() => step(r + 1), 0);
    }
    step(0);
  }

  function renderTrainingProgress(target, bestW, bestWR, history) {
    const bestLine = `<p><strong>Best win rate so far: ${(bestWR * 100).toFixed(1)}%</strong> (round ${history.findLast?.((h) => h.accepted)?.round ?? "—"})</p>`;
    const sparkline = renderWinrateSparkline(history);
    const histRows = history.slice(-30).reverse().map((h) =>
      `<div class="row${h.accepted ? " accepted" : ""}">round ${String(h.round).padStart(3)}: ${(h.winRate * 100).toFixed(1).padStart(5)}% ${h.accepted ? "✓ accepted" : ""}</div>`
    ).join("");
    target.innerHTML = bestLine + sparkline + `<div class="training-history">${histRows}</div>`;
  }

  function renderTrainingFinal(target, bestW, bestWR, history) {
    const sparkline = renderWinrateSparkline(history);
    const deltas = Object.keys(bestW).map((k) => {
      const d = bestW[k] - DEFAULT_WEIGHTS[k];
      const dir = d > 0.05 ? "delta-up" : d < -0.05 ? "delta-down" : "";
      const sym = d > 0 ? "+" : "";
      return `<div><span class="key">${k}</span></div>
        <div class="${dir}">${bestW[k].toFixed(3)} <span style="opacity:0.5;">(${sym}${d.toFixed(2)})</span></div>`;
    }).join("");
    const rows = history.slice().reverse().map((h) =>
      `<div class="row${h.accepted ? " accepted" : ""}">round ${String(h.round).padStart(3)}: ${(h.winRate * 100).toFixed(1).padStart(5)}% ${h.accepted ? "✓ accepted" : ""}</div>`
    ).join("");
    target.innerHTML = `<p><strong>Final best win rate: ${(bestWR * 100).toFixed(1)}%</strong> over ${history.length} rounds.</p>
      ${sparkline}
      <h3 style="margin-top:16px;">Tuned Weights (vs default)</h3>
      <div class="weights-grid">${deltas}</div>
      <h3 style="margin-top:16px;">Round History</h3>
      <div class="training-history">${rows}</div>`;
  }

  function renderWinrateSparkline(history) {
    if (!history.length) return "";
    const w = 600, h = 80;
    const xs = history.map((_, i) => i / Math.max(1, history.length - 1) * w);
    const ys = history.map((h) => h.winRate);
    const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${(h - ys[i] * h).toFixed(1)}`).join(" ");
    let running = -1;
    const acceptedPts = [];
    for (let i = 0; i < history.length; i++) {
      if (history[i].winRate > running) { running = history[i].winRate; acceptedPts.push({ x: xs[i], y: h - running * h }); }
    }
    const runPath = acceptedPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%; max-width:600px; background:var(--bg-2); border-radius:6px; margin-top:8px;">
      <path d="${path}" fill="none" stroke="#4d6680" stroke-width="1.5" />
      <path d="${runPath}" fill="none" stroke="#f4c430" stroke-width="2" />
      <text x="6" y="14" fill="#9aa3b5" font-size="10">win-rate per round (gold = running best)</text>
    </svg>`;
  }

  // ---------- Replay ----------
  for (const id of ["replay-p1", "replay-p2"]) {
    const sel = $(id);
    for (const k of STRAT_NAMES) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = STRATEGIES[k].name;
      sel.appendChild(opt);
    }
  }
  $("replay-p1").value = "balanced";
  $("replay-p2").value = "greedy";

  let replayState = null, autoPlay = false, autoTimer = null;

  $("replay-start").addEventListener("click", () => {
    const a = $("replay-p1").value;
    const b = $("replay-p2").value;
    replayState = createGame({ playerNames: [a, b], vsAI: false });
    autoPlay = false;
    if (autoTimer) clearTimeout(autoTimer);
    $("replay-step").disabled = false;
    $("replay-auto").disabled = false;
    $("replay-auto").textContent = "Auto-Play";
    renderReplay();
  });

  $("replay-step").addEventListener("click", () => stepReplay());
  $("replay-auto").addEventListener("click", () => {
    autoPlay = !autoPlay;
    $("replay-auto").textContent = autoPlay ? "Pause" : "Auto-Play";
    if (autoPlay) tickAuto();
    else if (autoTimer) clearTimeout(autoTimer);
  });

  function tickAuto() {
    if (!autoPlay || !replayState || replayState.gameOver) return;
    stepReplay();
    autoTimer = setTimeout(tickAuto, 250);
  }

  function stepReplay() {
    if (!replayState || replayState.gameOver) return;
    const idx = replayState.current;
    const stratName = idx === 0 ? $("replay-p1").value : $("replay-p2").value;
    const action = STRATEGIES[stratName].choose(replayState);
    if (!action) { endTurn(replayState); renderReplay(); return; }
    applyAction(replayState, action, { autoDiscard: true });
    renderReplay(action, stratName);
    if (replayState.gameOver) {
      autoPlay = false;
      $("replay-auto").textContent = "Auto-Play";
    }
  }

  function renderReplay(lastAction, stratName) {
    if (!replayState) return;
    const s = replayState;
    const cur = s.players[s.current];
    const status = $("replay-status");
    let txt = `Turn ${s.turnNumber} · `;
    if (s.gameOver) {
      txt = `🏆 ${s.winner.name} wins with ${s.winner.points} prestige.`;
    } else {
      txt += `${cur.name}'s turn.`;
    }
    if (lastAction) {
      txt += ` <em style="color:var(--text-dim);">Last: ${stratName} → ${escapeHtml(explainAction(s, lastAction))}</em>`;
    }
    status.innerHTML = txt;

    const board = $("replay-board");
    const lines = [];
    for (const p of s.players) {
      const bonuses = allBonuses(p);
      const bChips = COLORS.map((c) => bonuses[c] ? `${c[0].toUpperCase()}${bonuses[c]}` : "").filter(Boolean).join(" ");
      const tChips = [...COLORS, "gold"].map((c) => p.tokens[c] ? `${c[0].toUpperCase()}${p.tokens[c]}` : "").filter(Boolean).join(" ");
      lines.push(`<div style="margin-bottom:6px;"><strong>${p.name}</strong> · ${p.points} pts · cards: ${p.cards.length} · reserved: ${p.reserved.length} · nobles: ${p.nobles.length}<br/>
        <span style="color:var(--text-dim); font-family: ui-monospace, monospace; font-size: 12px;">bonuses: ${bChips || "—"} · tokens: ${tChips || "—"}</span></div>`);
    }
    const recent = s.log.slice(-6).map((l) => `<div style="font-family:ui-monospace,monospace; font-size:12px; color:var(--text-dim);">${escapeHtml(l.text)}</div>`).join("");
    board.innerHTML = lines.join("") + recent;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
