// Renders the live game board and handles human interactions.
// Communicates with the engine in game.js and AI in ai.js.

(function () {
  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);

  const setupScreen = $("setup");
  const gameScreen = $("game");
  const startBtn = $("start-btn");
  const newGameBtn = $("new-game-btn");
  const turnIndicator = $("turn-indicator");
  const supplyEl = $("gem-supply");
  const pendingEl = $("pending-gems");
  const confirmTakeBtn = $("confirm-take");
  const cancelTakeBtn = $("cancel-take");
  const noblesEl = $("nobles");
  const tiersEl = $("tiers");
  const playersEl = $("players");
  const statusBar = $("status-bar");
  const logEl = $("log");
  const modalRoot = $("modal-root");

  // ---------- UI state ----------
  let state = null;
  let pendingTake = []; // colors selected by human for a take action
  let aiTurnTimer = null;
  let discardMode = false;
  let discardTarget = TOKEN_CAP;

  // ---------- Setup ----------
  startBtn.addEventListener("click", () => {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const playerName = $("player-name").value.trim() || "Player 1";
    let players, vsAI = false;
    if (mode === "solo") { players = [playerName, "AI Opponent"]; vsAI = true; }
    else if (mode === "hotseat2") players = [playerName, "Player 2"];
    else if (mode === "hotseat3") players = [playerName, "Player 2", "Player 3"];
    else players = [playerName, "Player 2", "Player 3", "Player 4"];

    state = createGame({ playerNames: players, vsAI });
    setupScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    pendingTake = [];
    discardMode = false;
    setStatus(`${state.players[0].name}'s turn. Pick an action.`);
    render();
    maybeRunAI();
  });

  newGameBtn.addEventListener("click", () => {
    if (aiTurnTimer) clearTimeout(aiTurnTimer);
    state = null;
    gameScreen.classList.add("hidden");
    setupScreen.classList.remove("hidden");
  });

  confirmTakeBtn.addEventListener("click", () => {
    if (!pendingTake.length) return;
    if (discardMode) return;
    const r = takeGems(state, pendingTake);
    if (!r.ok) { setStatus(r.error); return; }
    pendingTake = [];
    afterPlayerAction(r.needsDiscard);
  });

  cancelTakeBtn.addEventListener("click", () => {
    if (!pendingTake.length) return;
    pendingTake = [];
    render();
  });

  // ---------- Action wrappers ----------

  function afterPlayerAction(needsDiscard) {
    if (needsDiscard) {
      const p = state.players[state.current];
      discardMode = true;
      discardTarget = totalTokens(p) - TOKEN_CAP;
      setStatus(`Over the 10-token cap. Click your tokens to discard ${discardTarget} more.`);
      render();
      return;
    }
    finalizeTurn();
  }

  function finalizeTurn() {
    const eligible = checkNobles(state);
    if (eligible.length === 1) claimNoble(state, eligible[0].name);
    else if (eligible.length > 1) {
      // For simplicity, auto-claim the first (all are 3 prestige in this implementation)
      claimNoble(state, eligible[0].name);
    }
    endTurn(state);
    render();
    if (state.gameOver) { showGameOver(); return; }
    setStatus(`${state.players[state.current].name}'s turn.`);
    maybeRunAI();
  }

  function maybeRunAI() {
    const p = state.players[state.current];
    if (!p.isAI || state.gameOver) return;
    setStatus(`${p.name} is thinking...`);
    aiTurnTimer = setTimeout(() => runAITurn(), 600);
  }

  function runAITurn() {
    const p = state.players[state.current];
    const action = STRATEGIES.balanced.choose(state);
    if (!action) {
      // No legal action — should be impossible, but skip turn safely
      endTurn(state);
      render();
      maybeRunAI();
      return;
    }
    const ok = applyAction(state, action, { autoDiscard: true });
    render();
    if (state.gameOver) { showGameOver(); return; }
    setStatus(`${state.players[state.current].name}'s turn.`);
    maybeRunAI();
  }

  // ---------- Rendering ----------

  function render() {
    if (!state) return;
    renderSupply();
    renderPending();
    renderNobles();
    renderTiers();
    renderPlayers();
    renderTurnIndicator();
    renderLog();
  }

  function renderTurnIndicator() {
    const p = state.players[state.current];
    let txt = `Turn ${state.turnNumber} — ${p.name}`;
    if (state.finalRound) txt += " · Final round";
    turnIndicator.textContent = txt;
    turnIndicator.classList.toggle("active", !p.isAI);
  }

  function renderSupply() {
    supplyEl.innerHTML = "";
    const order = ["white", "blue", "green", "red", "black", "gold"];
    for (const color of order) {
      const cnt = state.supply[color];
      const div = document.createElement("div");
      div.className = "gem-pile";
      const isHumanTurn = !state.players[state.current].isAI && !state.gameOver;
      const canTake1 = isHumanTurn && color !== "gold" && cnt > 0 && !discardMode &&
        !pendingTake.includes(color) &&
        // can't add a 4th selection or duplicate (unless at most 1 selection toward take2)
        canAddToTake(color);
      const isSelected = pendingTake.includes(color);
      if (cnt === 0 || (!canTake1 && !isSelected) || color === "gold")
        div.classList.add("disabled");
      if (isSelected) div.classList.add("selectable");

      const gem = makeGem(color);
      const lbl = document.createElement("span");
      lbl.className = "gem-pile-label";
      lbl.textContent = color;
      const c = document.createElement("span");
      c.className = "gem-pile-count";
      c.textContent = cnt;
      div.append(gem, lbl, c);

      if (color !== "gold" && isHumanTurn && !discardMode) {
        div.addEventListener("click", () => onSupplyClick(color));
      }
      supplyEl.appendChild(div);
    }
  }

  function canAddToTake(color) {
    // Allow rules:
    //  - up to 3 different colors, OR
    //  - up to 2 same color (only if supply >= 4)
    if (pendingTake.length === 0) return true;
    if (pendingTake.length === 1 && pendingTake[0] === color) {
      return state.supply[color] >= 4;
    }
    if (pendingTake.length >= 1 && pendingTake[0] !== color) {
      // building up "3 different" path; ensure no duplicates
      if (pendingTake.includes(color)) return false;
      if (pendingTake.length >= 3) return false;
      return true;
    }
    return false;
  }

  function onSupplyClick(color) {
    if (!canAddToTake(color)) return;
    pendingTake.push(color);
    // If reached 2 same-color, auto-confirm
    render();
  }

  function renderPending() {
    pendingEl.innerHTML = "";
    if (!pendingTake.length) {
      const span = document.createElement("span");
      span.className = "empty-slot";
      span.textContent = "Click gem piles to plan a take.";
      pendingEl.appendChild(span);
    } else {
      for (const c of pendingTake) {
        const g = makeGem(c, "small");
        g.style.cursor = "pointer";
        g.title = "Click to remove";
        g.addEventListener("click", () => {
          const idx = pendingTake.indexOf(c);
          if (idx >= 0) pendingTake.splice(idx, 1);
          render();
        });
        pendingEl.appendChild(g);
      }
    }
    confirmTakeBtn.disabled = !canConfirmTake();
    cancelTakeBtn.disabled = pendingTake.length === 0;
  }

  function canConfirmTake() {
    if (state.players[state.current].isAI || state.gameOver || discardMode) return false;
    if (pendingTake.length === 0) return false;
    const unique = new Set(pendingTake);
    if (unique.size === pendingTake.length && pendingTake.length <= 3) return true;
    if (pendingTake.length === 2 && unique.size === 1 && state.supply[pendingTake[0]] >= 4) return true;
    return false;
  }

  function renderNobles() {
    noblesEl.innerHTML = "";
    for (const n of state.nobles) {
      const card = document.createElement("div");
      card.className = "noble-card";
      card.title = n.name;
      const pts = document.createElement("div");
      pts.className = "pts";
      pts.textContent = `${n.points}`;
      const req = document.createElement("div");
      req.className = "req";
      for (const color of COLORS) {
        const v = n.req[color] || 0;
        if (v > 0) {
          const wrap = document.createElement("span");
          wrap.style.display = "inline-flex";
          wrap.style.alignItems = "center";
          wrap.style.gap = "1px";
          wrap.append(makeGem(color, "tiny"));
          const t = document.createElement("span");
          t.style.fontSize = "11px";
          t.style.fontWeight = "700";
          t.textContent = v;
          wrap.append(t);
          req.appendChild(wrap);
        }
      }
      card.append(pts, req);
      noblesEl.appendChild(card);
    }
  }

  function renderTiers() {
    tiersEl.innerHTML = "";
    for (const tier of [3, 2, 1]) {
      const row = document.createElement("div");
      row.className = "tier-row";

      const deck = document.createElement("div");
      deck.className = "deck";
      const remaining = state.decks[tier].length;
      const isHumanTurn = !state.players[state.current].isAI && !state.gameOver;
      const canReserveDeck = isHumanTurn && remaining > 0 &&
        state.players[state.current].reserved.length < MAX_RESERVED && !discardMode;
      if (!canReserveDeck) deck.classList.add("disabled");
      const tn = document.createElement("div");
      tn.className = "tier-name";
      tn.textContent = `Tier ${tier}`;
      const cn = document.createElement("div");
      cn.className = "deck-count";
      cn.textContent = remaining;
      deck.append(tn, cn);
      if (canReserveDeck) {
        deck.title = "Click to reserve top of deck (gain a gold wildcard)";
        deck.addEventListener("click", () => doReserve(tier, "deck"));
      }
      row.appendChild(deck);

      for (let i = 0; i < MARKET_SIZE; i++) {
        const card = state.market[tier][i];
        if (!card) {
          const empty = document.createElement("div");
          empty.className = "dev-card";
          empty.style.opacity = "0.25";
          row.appendChild(empty);
          continue;
        }
        row.appendChild(renderDevCard(card, "market"));
      }
      tiersEl.appendChild(row);
    }
  }

  function renderDevCard(card, source) {
    const isHumanTurn = !state.players[state.current].isAI && !state.gameOver && !discardMode;
    const player = state.players[state.current];
    const aff = affordabilityFor(player, card);
    const wrap = document.createElement("div");
    wrap.className = "dev-card";
    if (aff.canAfford) wrap.classList.add("affordable");

    const head = document.createElement("div");
    head.className = "dev-card-head";
    const bonus = document.createElement("div");
    bonus.className = `dev-card-bonus ${card.bonus}`;
    bonus.textContent = COLOR_LETTERS[card.bonus];
    const pts = document.createElement("div");
    pts.className = `dev-card-pts ${card.points ? "" : "zero"}`;
    pts.textContent = card.points || "0";
    head.append(bonus, pts);

    const cost = document.createElement("div");
    cost.className = "dev-card-cost";
    for (const color of COLORS) {
      const v = card.cost[color] || 0;
      if (v > 0) {
        const row = document.createElement("div");
        row.className = "cost-row";
        row.append(makeGem(color, "small"));
        const num = document.createElement("span");
        num.className = "cost-num";
        num.textContent = v;
        row.append(num);
        cost.appendChild(row);
      }
    }
    wrap.append(head, cost);

    if (isHumanTurn) {
      wrap.addEventListener("click", () => showCardActions(card, source, wrap));
    }
    return wrap;
  }

  function showCardActions(card, source, wrapEl) {
    const player = state.players[state.current];
    const aff = affordabilityFor(player, card);
    document.querySelectorAll(".dev-card.selected").forEach((e) => e.classList.remove("selected"));
    document.querySelectorAll(".card-actions").forEach((e) => e.remove());
    wrapEl.classList.add("selected");

    const actions = document.createElement("div");
    actions.className = "card-actions";
    if (aff.canAfford) {
      const buyBtn = document.createElement("button");
      buyBtn.className = "primary-btn small";
      buyBtn.textContent = "Buy";
      buyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        doBuy(source, card);
      });
      actions.appendChild(buyBtn);
    }
    if (source === "market" && player.reserved.length < MAX_RESERVED) {
      const resBtn = document.createElement("button");
      resBtn.className = "ghost-btn small";
      resBtn.textContent = "Reserve";
      resBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        doReserve(card.tier, card.id);
      });
      actions.appendChild(resBtn);
    }
    if (!actions.children.length) {
      const lbl = document.createElement("span");
      lbl.style.fontSize = "11px";
      lbl.style.color = "var(--text-dim)";
      lbl.textContent = "No legal action";
      actions.appendChild(lbl);
    }
    wrapEl.appendChild(actions);
  }

  function doBuy(source, card) {
    const r = buyCard(state, source, card.tier, card.id);
    if (!r.ok) { setStatus(r.error); return; }
    afterPlayerAction(false);
  }

  function doReserve(tier, cardId) {
    const r = reserveCard(state, tier, cardId);
    if (!r.ok) { setStatus(r.error); return; }
    afterPlayerAction(r.needsDiscard);
  }

  function renderPlayers() {
    playersEl.innerHTML = "";
    for (const p of state.players) {
      const panel = document.createElement("div");
      panel.className = "player-panel";
      if (p.id === state.current && !state.gameOver) panel.classList.add("active");

      const head = document.createElement("div");
      head.className = "player-header";
      const name = document.createElement("div");
      name.className = "player-name";
      name.textContent = p.name;
      if (p.isAI) {
        const b = document.createElement("span");
        b.className = "badge";
        b.textContent = "AI";
        name.appendChild(b);
      }
      const pts = document.createElement("div");
      pts.className = "player-pts";
      pts.textContent = `${p.points} pts`;
      head.append(name, pts);
      panel.append(head);

      // Bonuses + tokens
      const bonuses = allBonuses(p);
      const bonusLabel = document.createElement("div");
      bonusLabel.className = "player-row-label";
      bonusLabel.textContent = `Cards: ${p.cards.length}`;
      const bonusRow = document.createElement("div");
      bonusRow.className = "player-bonuses";
      for (const c of COLORS) {
        if (bonuses[c] > 0) {
          const chip = document.createElement("span");
          chip.className = "token-chip";
          chip.append(makeGem(c, "tiny"));
          const n = document.createElement("span");
          n.className = "count";
          n.textContent = bonuses[c];
          chip.append(n);
          bonusRow.appendChild(chip);
        }
      }

      const tokenLabel = document.createElement("div");
      tokenLabel.className = "player-row-label";
      tokenLabel.textContent = `Tokens: ${totalTokens(p)}/10`;
      const tokenRow = document.createElement("div");
      tokenRow.className = "player-tokens";
      for (const c of [...COLORS, "gold"]) {
        if ((p.tokens[c] || 0) > 0) {
          const chip = document.createElement("span");
          chip.className = "token-chip";
          if (discardMode && p.id === state.current && c !== "gold") {
            chip.style.cursor = "pointer";
            chip.title = "Click to discard";
            chip.addEventListener("click", () => discardOne(c));
          }
          chip.append(makeGem(c, "tiny"));
          const n = document.createElement("span");
          n.className = "count";
          n.textContent = p.tokens[c];
          chip.append(n);
          tokenRow.appendChild(chip);
        }
      }

      panel.append(bonusLabel, bonusRow, tokenLabel, tokenRow);

      if (p.reserved.length) {
        const resLabel = document.createElement("div");
        resLabel.className = "player-row-label";
        resLabel.textContent = `Reserved: ${p.reserved.length}/3`;
        panel.append(resLabel);
        const resRow = document.createElement("div");
        resRow.className = "player-reserved";
        for (const card of p.reserved) {
          const aff = affordabilityFor(p, card);
          const mini = document.createElement("div");
          mini.className = "reserved-card";
          if (aff.canAfford) mini.classList.add("affordable");
          const head = document.createElement("div");
          head.className = "dev-card-head";
          const bonus = document.createElement("div");
          bonus.className = `dev-card-bonus ${card.bonus}`;
          bonus.textContent = COLOR_LETTERS[card.bonus];
          const ptsEl = document.createElement("div");
          ptsEl.className = `dev-card-pts ${card.points ? "" : "zero"}`;
          ptsEl.textContent = card.points || "0";
          head.append(bonus, ptsEl);
          mini.append(head);
          for (const color of COLORS) {
            const v = card.cost[color] || 0;
            if (v > 0) {
              const row = document.createElement("div");
              row.className = "cost-row";
              row.append(makeGem(color, "tiny"));
              const num = document.createElement("span");
              num.className = "cost-num";
              num.textContent = v;
              row.append(num);
              mini.appendChild(row);
            }
          }
          if (p.id === state.current && !p.isAI && !discardMode && !state.gameOver) {
            mini.title = aff.canAfford ? "Click to buy this reserved card" : "Cannot afford yet";
            mini.addEventListener("click", () => {
              showCardActions(card, "reserved", mini);
            });
          }
          resRow.appendChild(mini);
        }
        panel.append(resRow);
      }

      if (p.nobles.length) {
        const nobLabel = document.createElement("div");
        nobLabel.className = "player-row-label";
        nobLabel.textContent = `Nobles: ${p.nobles.length}`;
        panel.append(nobLabel);
        const nobRow = document.createElement("div");
        nobRow.className = "player-nobles";
        for (const n of p.nobles) {
          const m = document.createElement("div");
          m.className = "noble-mini";
          m.textContent = n.points;
          m.title = n.name;
          nobRow.appendChild(m);
        }
        panel.append(nobRow);
      }

      playersEl.appendChild(panel);
    }
  }

  function discardOne(color) {
    const p = state.players[state.current];
    if ((p.tokens[color] || 0) <= 0) return;
    p.tokens[color]--;
    state.supply[color]++;
    discardTarget--;
    if (discardTarget <= 0 || totalTokens(p) <= TOKEN_CAP) {
      discardMode = false;
      finalizeTurn();
    } else {
      setStatus(`Discard ${discardTarget} more.`);
      render();
    }
  }

  function renderLog() {
    logEl.innerHTML = "";
    for (const e of state.log.slice(-30)) {
      const row = document.createElement("div");
      row.className = "entry" + (e.turn ? " turn" : "");
      row.textContent = e.text;
      logEl.appendChild(row);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---------- Hint ----------

  function setStatus(msg) {
    statusBar.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = msg;
    statusBar.appendChild(span);

    const isHumanTurn = state && !state.players[state.current].isAI && !state.gameOver && !discardMode;
    if (isHumanTurn) {
      const hintBtn = document.createElement("button");
      hintBtn.className = "ghost-btn small";
      hintBtn.textContent = "💡 Hint";
      hintBtn.style.marginLeft = "12px";
      hintBtn.addEventListener("click", showHint);
      statusBar.appendChild(hintBtn);

      const advisorBtn = document.createElement("button");
      advisorBtn.className = "ghost-btn small";
      advisorBtn.textContent = "📊 Move Scores";
      advisorBtn.style.marginLeft = "8px";
      advisorBtn.addEventListener("click", showMoveScores);
      statusBar.appendChild(advisorBtn);
    }
  }

  function showHint() {
    const action = suggestMove(state);
    const text = explainAction(state, action);
    showModal({
      title: "Recommended Move",
      body: `<p>${escapeHtml(text)}</p>
        <p style="font-size: 12px; color: var(--text-dim); margin-top: 12px;">
        Based on the Balanced Heuristic. Open the analytics page to see how each strategy performs over many games.</p>`,
      actions: [{ label: "Got it", primary: true }],
    });
  }

  function showMoveScores() {
    const acts = legalActions(state);
    const scored = acts.map((a) => ({ a, score: scoreAction(state, a), text: explainAction(state, a) }));
    scored.sort((x, y) => y.score - x.score);
    const rows = scored.slice(0, 10).map((s) =>
      `<tr><td style="padding:4px 8px; font-weight:700; color: var(--accent);">${s.score.toFixed(2)}</td>
        <td style="padding:4px 8px;">${escapeHtml(s.text)}</td></tr>`
    ).join("");
    showModal({
      title: "Top 10 Moves Scored",
      body: `<table style="width:100%; border-collapse:collapse; font-size:13px;"><tbody>${rows}</tbody></table>
        <p style="font-size: 11px; color: var(--text-dim); margin-top: 12px;">
        Total legal moves this turn: ${acts.length}.</p>`,
      actions: [{ label: "Close", primary: true }],
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- Modal ----------

  function showModal({ title, body, actions }) {
    modalRoot.innerHTML = "";
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<h2>${escapeHtml(title)}</h2><div>${body}</div>`;
    const actRow = document.createElement("div");
    actRow.className = "modal-actions";
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = a.primary ? "primary-btn small" : "ghost-btn small";
      b.textContent = a.label;
      b.addEventListener("click", () => {
        modalRoot.innerHTML = "";
        if (a.onClick) a.onClick();
      });
      actRow.appendChild(b);
    }
    m.appendChild(actRow);
    overlay.appendChild(m);
    modalRoot.appendChild(overlay);
  }

  function showGameOver() {
    const w = state.winner;
    const board = state.players
      .map((p) => `<tr>
        <td style="padding:4px 8px;">${escapeHtml(p.name)}${p.id === w.id ? " 🏆" : ""}</td>
        <td style="padding:4px 8px; text-align:right;">${p.points} pts</td>
        <td style="padding:4px 8px; text-align:right; color:var(--text-dim);">${p.cards.length} cards · ${p.nobles.length} nobles</td>
      </tr>`)
      .join("");
    showModal({
      title: `${w.name} wins!`,
      body: `<table style="width:100%; border-collapse:collapse;"><tbody>${board}</tbody></table>`,
      actions: [
        { label: "New Game", primary: true, onClick: () => newGameBtn.click() },
        { label: "Close", onClick: () => {} },
      ],
    });
  }

  // ---------- Helpers ----------

  function makeGem(color, size) {
    const g = document.createElement("span");
    g.className = `gem ${color}` + (size ? ` ${size}` : "");
    g.textContent = COLOR_LETTERS[color] || (color === "gold" ? "★" : "");
    return g;
  }
})();
