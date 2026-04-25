// Pure game state + rules engine. No DOM here.

function emptyGems() {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
}

// Mulberry32 — a small, fast, well-distributed PRNG. Seedable for reproducible games and tests.
function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const r = rng || Math.random;
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sumGems(g) {
  return COLORS.reduce((s, c) => s + (g[c] || 0), 0) + (g.gold || 0);
}

function totalTokens(player) {
  return sumGems(player.tokens);
}

function cardBonusCount(player, color) {
  return player.cards.filter((c) => c.bonus === color).length;
}

function allBonuses(player) {
  const b = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  for (const c of player.cards) b[c.bonus]++;
  return b;
}

// Returns {canAfford, goldNeeded, payment: {color: amount, gold: amount}}
function affordabilityFor(player, card) {
  const bonuses = allBonuses(player);
  const payment = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
  let goldNeeded = 0;
  for (const color of COLORS) {
    const effectiveCost = Math.max(0, (card.cost[color] || 0) - bonuses[color]);
    const pay = Math.min(effectiveCost, player.tokens[color] || 0);
    payment[color] = pay;
    const short = effectiveCost - pay;
    goldNeeded += short;
  }
  const hasGold = player.tokens.gold || 0;
  payment.gold = Math.min(goldNeeded, hasGold);
  const canAfford = goldNeeded <= hasGold;
  return { canAfford, goldNeeded, payment };
}

function createGame(options) {
  const { playerNames, vsAI } = options;
  const n = playerNames.length;
  if (n < 2 || n > 4) throw new Error(`Splendor supports 2-4 players; got ${n}`);

  const seed = options.seed != null
    ? (options.seed >>> 0)
    : (Math.floor(Math.random() * 0x100000000) >>> 0);
  const rng = mulberry32(seed);

  const state = {
    seed,
    rng, // not serialized through cloneState (JSON drops functions); only used in setup
    players: playerNames.map((name, i) => ({
      id: i,
      name,
      isAI: vsAI && i > 0,
      tokens: emptyGems(),
      cards: [],
      reserved: [],
      nobles: [],
      points: 0,
    })),
    current: 0,
    supply: (() => {
      const base = TOKENS_PER_COLOR[n] || 4;
      const s = emptyGems();
      for (const c of COLORS) s[c] = base;
      s.gold = GOLD_SUPPLY;
      return s;
    })(),
    decks: {
      1: shuffle(ALL_CARDS.filter((c) => c.tier === 1), rng),
      2: shuffle(ALL_CARDS.filter((c) => c.tier === 2), rng),
      3: shuffle(ALL_CARDS.filter((c) => c.tier === 3), rng),
    },
    market: { 1: [], 2: [], 3: [] },
    nobles: shuffle(NOBLES, rng).slice(0, NOBLES_PER_GAME[n] || 3),
    log: [],
    turnNumber: 1,
    finalRound: false,
    lastPlayer: null,
    winner: null,
    gameOver: false,
  };

  // Deal 4 face-up per tier
  for (const t of [1, 2, 3]) {
    for (let i = 0; i < MARKET_SIZE && state.decks[t].length; i++) {
      state.market[t].push(state.decks[t].shift());
    }
  }

  return state;
}

function log(state, entry, turn = false) {
  state.log.push({ turn, text: entry });
  if (state.log.length > 200) state.log.shift();
}

// ---------- Actions ----------
// Each action validates and mutates state, then calls endTurn.

function takeGems(state, colors) {
  const p = state.players[state.current];
  if (colors.length === 0) return { ok: false, error: "Select at least one gem." };
  if (colors.includes("gold")) return { ok: false, error: "Cannot take gold directly." };

  // Rule: either take 3 different, or take 2 same (only if stack >=4)
  const unique = new Set(colors);
  if (unique.size === colors.length) {
    // all different
    if (colors.length > 3) return { ok: false, error: "Take at most 3 different gems." };
    // must take as many as possible if asking for 3 different — but we allow any number if supply is limited
    for (const c of colors) {
      if ((state.supply[c] || 0) < 1) return { ok: false, error: `No ${c} available.` };
    }
  } else if (colors.length === 2 && unique.size === 1) {
    const c = colors[0];
    if ((state.supply[c] || 0) < 4) return { ok: false, error: `Need 4+ ${c} in supply to take 2.` };
  } else {
    return { ok: false, error: "Invalid gem selection." };
  }

  for (const c of colors) {
    state.supply[c]--;
    p.tokens[c]++;
  }
  log(state, `${p.name} takes ${colors.map((c) => c[0].toUpperCase()).join("")}`);
  return { ok: true, needsDiscard: totalTokens(p) > TOKEN_CAP };
}

function discardTokens(state, discards) {
  const p = state.players[state.current];
  for (const c of Object.keys(discards)) {
    if ((p.tokens[c] || 0) < discards[c])
      return { ok: false, error: "Cannot discard more than held." };
  }
  for (const c of Object.keys(discards)) {
    p.tokens[c] -= discards[c];
    state.supply[c] += discards[c];
  }
  if (totalTokens(p) > TOKEN_CAP) return { ok: false, error: "Still over the 10-token cap." };
  return { ok: true };
}

function reserveCard(state, tier, cardId) {
  const p = state.players[state.current];
  if (p.reserved.length >= MAX_RESERVED) return { ok: false, error: "Already have 3 reserved." };

  let card;
  if (cardId === "deck") {
    if (!state.decks[tier].length) return { ok: false, error: "That deck is empty." };
    card = state.decks[tier].shift();
  } else {
    const idx = state.market[tier].findIndex((c) => c.id === cardId);
    if (idx < 0) return { ok: false, error: "Card not available." };
    card = state.market[tier][idx];
    state.market[tier].splice(idx, 1);
    if (state.decks[tier].length) state.market[tier].splice(idx, 0, state.decks[tier].shift());
  }
  p.reserved.push(card);
  if (state.supply.gold > 0) {
    state.supply.gold--;
    p.tokens.gold++;
  }
  log(state, `${p.name} reserves a tier-${tier} card`);
  return { ok: true, needsDiscard: totalTokens(p) > TOKEN_CAP };
}

function buyCard(state, source, tier, cardId, goldAllocation) {
  // source: 'market' | 'reserved'
  // goldAllocation: optional object {color: amount} specifying how many gold to spend per color
  const p = state.players[state.current];
  let card, removeFromMarket = false, removeIdx = -1;
  if (source === "market") {
    removeIdx = state.market[tier].findIndex((c) => c.id === cardId);
    if (removeIdx < 0) return { ok: false, error: "Card not available." };
    card = state.market[tier][removeIdx];
    removeFromMarket = true;
  } else {
    const idx = p.reserved.findIndex((c) => c.id === cardId);
    if (idx < 0) return { ok: false, error: "Card not reserved." };
    card = p.reserved[idx];
  }

  const afford = affordabilityFor(p, card);
  if (!afford.canAfford) return { ok: false, error: "You cannot afford that card." };

  const payment = afford.payment;
  // If caller supplied goldAllocation, verify it covers shortfall and does not over-allocate
  if (goldAllocation) {
    // Recompute payment with explicit gold allocation
    const bonuses = allBonuses(p);
    const newPayment = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
    let totalGold = 0;
    for (const color of COLORS) {
      const effectiveCost = Math.max(0, (card.cost[color] || 0) - bonuses[color]);
      const gold = goldAllocation[color] || 0;
      const fromTokens = effectiveCost - gold;
      if (fromTokens < 0) return { ok: false, error: `Over-allocated gold for ${color}.` };
      if (fromTokens > (p.tokens[color] || 0))
        return { ok: false, error: `Not enough ${color} tokens.` };
      newPayment[color] = fromTokens;
      totalGold += gold;
    }
    if (totalGold > (p.tokens.gold || 0)) return { ok: false, error: "Not enough gold." };
    newPayment.gold = totalGold;
    Object.assign(payment, newPayment);
  }

  // Apply payment
  for (const color of COLORS) {
    p.tokens[color] -= payment[color];
    state.supply[color] += payment[color];
  }
  p.tokens.gold -= payment.gold;
  state.supply.gold += payment.gold;

  // Add card
  if (removeFromMarket) {
    state.market[tier].splice(removeIdx, 1);
    if (state.decks[tier].length) {
      state.market[tier].splice(removeIdx, 0, state.decks[tier].shift());
    }
  } else {
    const idx = p.reserved.findIndex((c) => c.id === cardId);
    p.reserved.splice(idx, 1);
  }
  p.cards.push(card);
  p.points += card.points || 0;
  log(state, `${p.name} buys a tier-${card.tier} ${card.bonus}${card.points ? ` (+${card.points}pt)` : ""}`);
  return { ok: true };
}

function checkNobles(state) {
  const p = state.players[state.current];
  const bonuses = allBonuses(p);
  const eligible = state.nobles.filter((n) =>
    COLORS.every((c) => bonuses[c] >= (n.req[c] || 0))
  );
  return eligible;
}

function claimNoble(state, nobleName) {
  const p = state.players[state.current];
  const idx = state.nobles.findIndex((n) => n.name === nobleName);
  if (idx < 0) return { ok: false };
  const noble = state.nobles[idx];
  state.nobles.splice(idx, 1);
  p.nobles.push(noble);
  p.points += noble.points;
  log(state, `${p.name} is visited by ${noble.name} (+${noble.points})`);
  return { ok: true };
}

function endTurn(state) {
  // Check final-round trigger
  if (!state.finalRound && state.players[state.current].points >= WIN_SCORE) {
    state.finalRound = true;
    // Final player to act is the one right before current in seating order — i.e.,
    // play continues until the last player in the round has had equal turns.
    state.lastPlayer = (state.current - 1 + state.players.length) % state.players.length;
    log(state, `${state.players[state.current].name} triggered the final round!`);
  }

  // If final round and current is lastPlayer, game ends
  if (state.finalRound && state.current === state.lastPlayer) {
    finishGame(state);
    return;
  }

  state.current = (state.current + 1) % state.players.length;
  if (state.current === 0) state.turnNumber++;
}

function finishGame(state) {
  state.gameOver = true;
  // Winner: most points; tiebreaker: fewest purchased cards
  let best = state.players[0];
  for (const p of state.players) {
    if (p.points > best.points) best = p;
    else if (p.points === best.points && p.cards.length < best.cards.length) best = p;
  }
  state.winner = best;
  log(state, `Game over. Winner: ${best.name} with ${best.points} prestige.`);
}

if (typeof module !== "undefined" && module.exports) {
  const __exports = {
    emptyGems, mulberry32, shuffle, sumGems, totalTokens, cardBonusCount,
    allBonuses, affordabilityFor, createGame, log, takeGems, discardTokens,
    reserveCard, buyCard, checkNobles, claimNoble, endTurn, finishGame,
  };
  Object.assign(global, __exports);
  module.exports = __exports;
}
