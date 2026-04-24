// AI strategies and the in-game advisor. Pure logic — no DOM access.
// Works in both the browser and Node (via the bottom export shim).

// ---------- Action helpers ----------

// Returns all legal actions for the current player.
// Action shape:
//   { type: 'take', colors: ['blue','green','red'] }
//   { type: 'take2', color: 'blue' }
//   { type: 'reserve', tier, cardId }              // cardId = 'deck' to draw blind
//   { type: 'buy', source: 'market'|'reserved', tier, cardId }
//   { type: 'discard', tokens: { color: count, ... } }
function legalActions(state) {
  const p = state.players[state.current];
  const actions = [];

  // Take 3 different
  const available = COLORS.filter((c) => state.supply[c] > 0);
  // Generate up to 3-combinations
  if (available.length >= 3) {
    for (let i = 0; i < available.length; i++) {
      for (let j = i + 1; j < available.length; j++) {
        for (let k = j + 1; k < available.length; k++) {
          actions.push({ type: "take", colors: [available[i], available[j], available[k]] });
        }
      }
    }
  } else if (available.length > 0) {
    // Allow taking fewer if supply is restricted
    actions.push({ type: "take", colors: available.slice() });
  }

  // Take 2 same
  for (const c of COLORS) {
    if (state.supply[c] >= 4) actions.push({ type: "take2", color: c });
  }

  // Buy face-up
  for (const tier of [1, 2, 3]) {
    for (const card of state.market[tier]) {
      const aff = affordabilityFor(p, card);
      if (aff.canAfford) actions.push({ type: "buy", source: "market", tier, cardId: card.id });
    }
  }

  // Buy reserved
  for (const card of p.reserved) {
    const aff = affordabilityFor(p, card);
    if (aff.canAfford) actions.push({ type: "buy", source: "reserved", tier: card.tier, cardId: card.id });
  }

  // Reserve face-up + deck top
  if (p.reserved.length < MAX_RESERVED) {
    for (const tier of [1, 2, 3]) {
      for (const card of state.market[tier]) {
        actions.push({ type: "reserve", tier, cardId: card.id });
      }
      if (state.decks[tier].length > 0) {
        actions.push({ type: "reserve", tier, cardId: "deck" });
      }
    }
  }

  return actions;
}

// Apply an action to a (mutable) state. Returns true if applied successfully.
// Wraps the game.js mutators and handles auto-discard + noble auto-claim.
function applyAction(state, action, opts = {}) {
  let result;
  switch (action.type) {
    case "take":
      result = takeGems(state, action.colors);
      break;
    case "take2":
      result = takeGems(state, [action.color, action.color]);
      break;
    case "reserve":
      result = reserveCard(state, action.tier, action.cardId);
      break;
    case "buy":
      result = buyCard(state, action.source, action.tier, action.cardId);
      break;
    default:
      return false;
  }
  if (!result || !result.ok) return false;

  // Force discard if over cap (AI: discard least-needed colors first; for human this is handled by UI)
  const p = state.players[state.current];
  if (totalTokens(p) > TOKEN_CAP) {
    const over = totalTokens(p) - TOKEN_CAP;
    if (opts.autoDiscard !== false) {
      autoDiscard(state, over);
    } else {
      return { needsDiscard: over };
    }
  }

  // Noble auto-claim (always pick the first eligible — all nobles are worth 3)
  const eligible = checkNobles(state);
  if (eligible.length > 0) claimNoble(state, eligible[0].name);

  endTurn(state);
  return true;
}

function autoDiscard(state, count) {
  const p = state.players[state.current];
  const order = ["white", "blue", "green", "red", "black", "gold"];
  // Discard from the largest non-gold pile first, keep gold last
  for (let i = 0; i < count; i++) {
    let best = null;
    for (const c of order) {
      if (c === "gold") continue;
      if ((p.tokens[c] || 0) > 0 && (!best || p.tokens[c] > p.tokens[best])) best = c;
    }
    if (!best) {
      // Have to dump gold
      if (p.tokens.gold > 0) best = "gold";
      else break;
    }
    p.tokens[best]--;
    state.supply[best]++;
  }
}

// ---------- Cloning ----------

function cloneState(state) {
  // No functions in state; JSON clone is fine.
  return JSON.parse(JSON.stringify(state));
}

// ---------- Heuristic scoring ----------

function nobleProgress(player, noble) {
  const bonuses = allBonuses(player);
  let need = 0, have = 0;
  for (const c of COLORS) {
    const r = noble.req[c] || 0;
    need += r;
    have += Math.min(r, bonuses[c]);
  }
  return have / Math.max(1, need);
}

function gemDistanceToCard(player, card) {
  // How many additional tokens needed (after bonuses + tokens) to afford this card.
  const bonuses = allBonuses(player);
  let need = 0;
  for (const c of COLORS) {
    const eff = Math.max(0, (card.cost[c] || 0) - bonuses[c]);
    need += Math.max(0, eff - (player.tokens[c] || 0));
  }
  // Gold can offset some
  return Math.max(0, need - (player.tokens.gold || 0));
}

function bestAffordableTargets(state, player, depth = 6) {
  // Cards across market and reserved, sorted by current distance asc, then points desc.
  const candidates = [];
  for (const tier of [1, 2, 3]) {
    for (const card of state.market[tier]) {
      candidates.push({ card, distance: gemDistanceToCard(player, card), source: "market" });
    }
  }
  for (const card of player.reserved) {
    candidates.push({ card, distance: gemDistanceToCard(player, card), source: "reserved" });
  }
  candidates.sort((a, b) => a.distance - b.distance || b.card.points - a.card.points);
  return candidates.slice(0, depth);
}

// ---------- Strategies ----------

const STRATEGIES = {
  random: {
    name: "Random",
    description: "Picks any legal action uniformly. Baseline.",
    choose(state) {
      const acts = legalActions(state);
      if (!acts.length) return null;
      return acts[Math.floor(Math.random() * acts.length)];
    },
  },

  greedy: {
    name: "Greedy",
    description: "Buy the most-points-per-turn card you can afford; otherwise take 3 different gems.",
    choose(state) {
      const acts = legalActions(state);
      if (!acts.length) return null;
      // Prefer buys
      const buys = acts.filter((a) => a.type === "buy").map((a) => ({ a, card: findCard(state, a) }));
      if (buys.length) {
        buys.sort((x, y) => (y.card.points || 0) - (x.card.points || 0) || x.card.tier - y.card.tier);
        return buys[0].a;
      }
      // Otherwise take 3 different from richest piles, biased toward useful colors
      const takes = acts.filter((a) => a.type === "take" && a.colors.length === 3);
      if (takes.length) return pickWeightedTake(state, takes);
      const take2s = acts.filter((a) => a.type === "take2");
      if (take2s.length) return take2s[0];
      // Reserve as a fallback
      const reserves = acts.filter((a) => a.type === "reserve" && a.cardId !== "deck");
      if (reserves.length) return reserves[0];
      return acts[0];
    },
  },

  points: {
    name: "Point Rusher",
    description: "Aggressively chases tier-2/3 high-VP cards; reserves them when close.",
    choose(state) {
      const acts = legalActions(state);
      if (!acts.length) return null;
      const player = state.players[state.current];

      // Buy highest VP
      const buys = acts
        .filter((a) => a.type === "buy")
        .map((a) => ({ a, card: findCard(state, a) }));
      if (buys.length) {
        buys.sort(
          (x, y) =>
            (y.card.points || 0) - (x.card.points || 0) || y.card.tier - x.card.tier
        );
        // Skip buying a 0-pt card if a better target is within 2 tokens
        const targets = bestAffordableTargets(state, player, 4);
        const worthy = buys[0].card.points > 0 || targets[0]?.distance >= 3;
        if (worthy) return buys[0].a;
      }

      // If a great card is within 1 token away, take that gem
      const targets = bestAffordableTargets(state, player, 6).filter((t) => t.card.points >= 1);
      if (targets.length) {
        const need = neededColors(player, targets[0].card);
        const takeAct = bestTakeForNeed(state, acts, need);
        if (takeAct) return takeAct;
      }

      // Reserve a high-value tier-3 if available and we can't reach it yet
      if (player.reserved.length < MAX_RESERVED) {
        const reserves = acts.filter((a) => a.type === "reserve" && a.cardId !== "deck");
        const ranked = reserves
          .map((a) => ({ a, card: findCard(state, a) }))
          .filter((x) => x.card.tier >= 2 && x.card.points >= 3)
          .sort((x, y) => y.card.points - x.card.points);
        if (ranked.length) return ranked[0].a;
      }

      // Generic gems
      const takes = acts.filter((a) => a.type === "take" && a.colors.length === 3);
      if (takes.length) return pickWeightedTake(state, takes);
      return acts[0];
    },
  },

  nobleRusher: {
    name: "Noble Rusher",
    description: "Aims for nobles by stacking the bonus colors they require.",
    choose(state) {
      const acts = legalActions(state);
      if (!acts.length) return null;
      const player = state.players[state.current];

      // Pick the best noble target
      const nobleScores = state.nobles.map((n) => ({ n, score: nobleProgress(player, n) }));
      nobleScores.sort((a, b) => b.score - a.score);
      const target = nobleScores[0]?.n;

      // Buy the cheapest card whose bonus contributes to that noble
      if (target) {
        const buys = acts
          .filter((a) => a.type === "buy")
          .map((a) => ({ a, card: findCard(state, a) }))
          .filter((x) => (target.req[x.card.bonus] || 0) > 0);
        if (buys.length) {
          buys.sort((x, y) => x.card.tier - y.card.tier || (y.card.points || 0) - (x.card.points || 0));
          return buys[0].a;
        }
      }

      // Else any cheap buy
      const allBuys = acts.filter((a) => a.type === "buy");
      if (allBuys.length) {
        const sorted = allBuys
          .map((a) => ({ a, card: findCard(state, a) }))
          .sort((x, y) => x.card.tier - y.card.tier);
        return sorted[0].a;
      }

      // Take gems toward target color
      if (target) {
        const need = COLORS.filter((c) => (target.req[c] || 0) > cardBonusCount(player, c));
        const take = bestTakeForColors(state, acts, need);
        if (take) return take;
      }
      const takes = acts.filter((a) => a.type === "take" && a.colors.length === 3);
      if (takes.length) return pickWeightedTake(state, takes);
      return acts[0];
    },
  },

  balanced: {
    name: "Balanced Heuristic",
    description: "Scores every legal move with a weighted heuristic and picks the best.",
    choose(state, weights) {
      const acts = legalActions(state);
      if (!acts.length) return null;
      if (!acts.length) return null;
      const scored = acts.map((a) => ({ a, score: scoreAction(state, a, weights) }));
      scored.sort((x, y) => y.score - x.score);
      const top = scored.filter((s) => s.score >= scored[0].score - 0.05);
      return top[Math.floor(Math.random() * top.length)].a;
    },
  },

  lookahead: {
    name: "1-Ply Lookahead",
    description: "Balanced + simulates 1 step deeper to evaluate resulting position.",
    choose(state) {
      const acts = legalActions(state);
      if (!acts.length) return null;
      let best = null, bestScore = -Infinity;
      for (const a of acts) {
        const next = cloneState(state);
        const ok = applyAction(next, a, { autoDiscard: true });
        if (!ok) continue;
        // Score = immediate score - opponent's best reply score
        const me = state.current;
        const myAfterScore = positionScore(next, me);
        const oppMoves = legalActions(next).slice(0, 24); // cap branching
        let oppBest = -Infinity;
        for (const oa of oppMoves) {
          const next2 = cloneState(next);
          if (!applyAction(next2, oa, { autoDiscard: true })) continue;
          const oppPos = positionScore(next2, next.current);
          if (oppPos > oppBest) oppBest = oppPos;
        }
        const ev = myAfterScore - 0.5 * (oppBest === -Infinity ? 0 : oppBest);
        if (ev > bestScore) {
          bestScore = ev;
          best = a;
        }
      }
      return best || acts[0];
    },
  },
};

function positionScore(state, playerIdx) {
  const p = state.players[playerIdx];
  let s = p.points * 3;
  s += p.cards.length * 0.6;
  s += sumGems(p.tokens) * 0.15;
  // Noble proximity
  for (const n of state.nobles) s += nobleProgress(p, n) * 1.5;
  return s;
}

const DEFAULT_WEIGHTS = {
  buyBase: 5,
  buyPoints: 2.5,
  buyNobleBonus: 0.8,
  buyTier: 0.4,
  buyReservedBonus: 0.2,
  reserveBase: 0.4,
  reservePoints: 0.5,
  reserveLockHigh: 1.5,
  reserveBlock: 1.0,
  reserveGoldBonus: 0.3,
  takeBase: 0.6,
  takePerColor: 0.15,
  takeMatch: 0.5,
  take2Match: 0.5,
  overTokenPenalty: 0.4,
};

function scoreAction(state, action, w) {
  w = { ...DEFAULT_WEIGHTS, ...(w || {}) };
  const p = state.players[state.current];

  if (action.type === "buy") {
    const card = findCard(state, action);
    let s = w.buyBase + (card.points || 0) * w.buyPoints;
    for (const n of state.nobles) {
      const req = n.req[card.bonus] || 0;
      if (req > cardBonusCount(p, card.bonus)) s += w.buyNobleBonus;
    }
    s += card.tier * w.buyTier;
    if (action.source === "reserved") s += w.buyReservedBonus;
    return s;
  }

  if (action.type === "reserve") {
    const card = action.cardId === "deck" ? null : findCard(state, action);
    let s = w.reserveBase;
    if (card) {
      s += (card.points || 0) * w.reservePoints;
      const dist = gemDistanceToCard(p, card);
      if (dist <= 3 && card.points >= 3) s += w.reserveLockHigh;
      for (let i = 0; i < state.players.length; i++) {
        if (i === state.current) continue;
        const opp = state.players[i];
        const oa = affordabilityFor(opp, card);
        if (oa.canAfford && (card.points || 0) >= 2) s += w.reserveBlock;
      }
    }
    if (state.supply.gold > 0) s += w.reserveGoldBonus;
    if (p.reserved.length >= MAX_RESERVED) return -Infinity;
    return s;
  }

  if (action.type === "take" || action.type === "take2") {
    const colors = action.type === "take" ? action.colors : [action.color, action.color];
    let s = w.takeBase + colors.length * w.takePerColor;
    const targets = bestAffordableTargets(state, p, 4);
    if (targets.length) {
      const target = targets[0].card;
      const need = neededColors(p, target);
      const matches = colors.filter((c) => need[c] > 0).length;
      s += matches * w.takeMatch;
      if (action.type === "take2" && need[action.color] >= 2) s += w.take2Match;
    }
    if (totalTokens(p) + colors.length > TOKEN_CAP) s -= w.overTokenPenalty;
    return s;
  }

  return 0;
}

// ---------- Helpers used by strategies ----------

function findCard(state, action) {
  if (action.source === "reserved") {
    const p = state.players[state.current];
    return p.reserved.find((c) => c.id === action.cardId);
  }
  if (action.type === "reserve" && action.cardId === "deck") return null;
  if (action.tier && action.cardId && action.cardId !== "deck") {
    const fromMarket = state.market[action.tier].find((c) => c.id === action.cardId);
    if (fromMarket) return fromMarket;
  }
  return null;
}

function neededColors(player, card) {
  const bonuses = allBonuses(player);
  const need = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  for (const c of COLORS) {
    const eff = Math.max(0, (card.cost[c] || 0) - bonuses[c]);
    need[c] = Math.max(0, eff - (player.tokens[c] || 0));
  }
  return need;
}

function pickWeightedTake(state, takes) {
  const p = state.players[state.current];
  const targets = bestAffordableTargets(state, p, 4);
  if (!targets.length) return takes[Math.floor(Math.random() * takes.length)];
  const need = neededColors(p, targets[0].card);
  let best = takes[0], bestScore = -1;
  for (const t of takes) {
    const s = t.colors.reduce((acc, c) => acc + (need[c] > 0 ? 1 : 0), 0);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best;
}

function bestTakeForNeed(state, acts, need) {
  const takes = acts.filter((a) => a.type === "take" && a.colors.length === 3);
  if (!takes.length) {
    const t2s = acts.filter((a) => a.type === "take2" && need[a.color] >= 2);
    if (t2s.length) return t2s[0];
    return null;
  }
  let best = null, bestScore = -1;
  for (const t of takes) {
    const s = t.colors.reduce((acc, c) => acc + (need[c] > 0 ? 1 : 0), 0);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best;
}

function bestTakeForColors(state, acts, colors) {
  const takes = acts.filter((a) => a.type === "take" && a.colors.length === 3);
  let best = null, bestScore = -1;
  for (const t of takes) {
    const s = t.colors.reduce((acc, c) => acc + (colors.includes(c) ? 1 : 0), 0);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best;
}

// ---------- Advisor (used by the live UI) ----------

function explainAction(state, action) {
  const p = state.players[state.current];
  if (!action) return "No legal moves found.";
  if (action.type === "buy") {
    const card = findCard(state, action);
    const reasons = [];
    if (card.points >= 3) reasons.push(`high prestige (+${card.points})`);
    else if (card.points > 0) reasons.push(`+${card.points} prestige`);
    reasons.push(`gives a permanent ${card.bonus} bonus`);
    for (const n of state.nobles) {
      if ((n.req[card.bonus] || 0) > cardBonusCount(p, card.bonus)) {
        reasons.push(`progress toward ${n.name}`);
        break;
      }
    }
    return `Buy the tier-${card.tier} ${card.bonus} card — ${reasons.join("; ")}.`;
  }
  if (action.type === "reserve") {
    const card = action.cardId === "deck" ? null : findCard(state, action);
    if (!card) return `Reserve the top of the tier-${action.tier} deck (gain a gold wildcard).`;
    return `Reserve the tier-${card.tier} ${card.bonus}${card.points ? ` (+${card.points})` : ""} card and gain a gold wildcard.`;
  }
  if (action.type === "take") {
    return `Take 3 different gems: ${action.colors.join(", ")} — moves you toward an affordable card.`;
  }
  if (action.type === "take2") {
    return `Take 2 ${action.color} gems — that pile is full enough and you need them.`;
  }
  return JSON.stringify(action);
}

function suggestMove(state) {
  return STRATEGIES.balanced.choose(state);
}

// ---------- Module export shim (Node) ----------

if (typeof module !== "undefined" && module.exports) {
  const __exports = {
    STRATEGIES, DEFAULT_WEIGHTS,
    legalActions, applyAction, cloneState, suggestMove, explainAction,
    scoreAction, positionScore, autoDiscard,
  };
  Object.assign(global, __exports);
  module.exports = __exports;
}
