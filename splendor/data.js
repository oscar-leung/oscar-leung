// Card and noble data. Costs use {w,u,g,r,k} for white/blue/green/red/black.
// bonus is the card's gem production color.

const COLORS = ["white", "blue", "green", "red", "black"];
const COLOR_KEYS = { white: "w", blue: "u", green: "g", red: "r", black: "k" };
const COLOR_LETTERS = { white: "W", blue: "U", green: "G", red: "R", black: "K" };

function c(w, u, g, r, k) {
  return { white: w || 0, blue: u || 0, green: g || 0, red: r || 0, black: k || 0 };
}

// ---------- Tier 1 (40 cards) — cheap, mostly 0 pts, one 1-pt per color ----------
const TIER1 = [
  // White bonus (8)
  { tier: 1, bonus: "white", points: 0, cost: c(0,1,1,1,1) },
  { tier: 1, bonus: "white", points: 0, cost: c(0,1,2,1,1) },
  { tier: 1, bonus: "white", points: 0, cost: c(0,2,2,0,1) },
  { tier: 1, bonus: "white", points: 0, cost: c(0,0,1,3,1) },
  { tier: 1, bonus: "white", points: 0, cost: c(0,0,0,2,1) },
  { tier: 1, bonus: "white", points: 0, cost: c(0,0,2,0,2) },
  { tier: 1, bonus: "white", points: 0, cost: c(0,0,0,0,3) },
  { tier: 1, bonus: "white", points: 1, cost: c(0,4,0,0,0) },

  // Blue bonus (8)
  { tier: 1, bonus: "blue", points: 0, cost: c(1,0,1,1,1) },
  { tier: 1, bonus: "blue", points: 0, cost: c(1,0,1,2,1) },
  { tier: 1, bonus: "blue", points: 0, cost: c(1,0,2,2,0) },
  { tier: 1, bonus: "blue", points: 0, cost: c(0,1,3,1,0) },
  { tier: 1, bonus: "blue", points: 0, cost: c(1,0,0,0,2) },
  { tier: 1, bonus: "blue", points: 0, cost: c(0,0,2,0,2) },
  { tier: 1, bonus: "blue", points: 0, cost: c(3,0,0,0,0) },
  { tier: 1, bonus: "blue", points: 1, cost: c(0,0,0,4,0) },

  // Green bonus (8)
  { tier: 1, bonus: "green", points: 0, cost: c(1,1,0,1,1) },
  { tier: 1, bonus: "green", points: 0, cost: c(1,1,0,1,2) },
  { tier: 1, bonus: "green", points: 0, cost: c(0,1,0,2,2) },
  { tier: 1, bonus: "green", points: 0, cost: c(3,1,0,0,1) },
  { tier: 1, bonus: "green", points: 0, cost: c(2,0,0,0,1) },
  { tier: 1, bonus: "green", points: 0, cost: c(0,2,0,2,0) },
  { tier: 1, bonus: "green", points: 0, cost: c(0,0,0,3,0) },
  { tier: 1, bonus: "green", points: 1, cost: c(0,0,0,0,4) },

  // Red bonus (8)
  { tier: 1, bonus: "red", points: 0, cost: c(1,1,1,0,1) },
  { tier: 1, bonus: "red", points: 0, cost: c(2,1,1,0,1) },
  { tier: 1, bonus: "red", points: 0, cost: c(2,0,1,0,2) },
  { tier: 1, bonus: "red", points: 0, cost: c(0,1,1,0,3) },
  { tier: 1, bonus: "red", points: 0, cost: c(0,0,2,0,1) },
  { tier: 1, bonus: "red", points: 0, cost: c(2,0,0,0,2) },
  { tier: 1, bonus: "red", points: 0, cost: c(0,0,3,0,0) },
  { tier: 1, bonus: "red", points: 1, cost: c(4,0,0,0,0) },

  // Black bonus (8)
  { tier: 1, bonus: "black", points: 0, cost: c(1,1,1,1,0) },
  { tier: 1, bonus: "black", points: 0, cost: c(1,2,1,1,0) },
  { tier: 1, bonus: "black", points: 0, cost: c(2,2,0,1,0) },
  { tier: 1, bonus: "black", points: 0, cost: c(0,3,1,1,0) },
  { tier: 1, bonus: "black", points: 0, cost: c(0,2,1,0,0) },
  { tier: 1, bonus: "black", points: 0, cost: c(0,0,2,2,0) },
  { tier: 1, bonus: "black", points: 0, cost: c(0,3,0,0,0) },
  { tier: 1, bonus: "black", points: 1, cost: c(0,0,4,0,0) },
];

// ---------- Tier 2 (30 cards) — 1-3 pts ----------
const TIER2 = [
  // White bonus (6)
  { tier: 2, bonus: "white", points: 1, cost: c(0,0,3,2,2) },
  { tier: 2, bonus: "white", points: 1, cost: c(0,0,3,0,3) },
  { tier: 2, bonus: "white", points: 2, cost: c(0,0,0,1,4) },
  { tier: 2, bonus: "white", points: 2, cost: c(0,0,0,5,3) },
  { tier: 2, bonus: "white", points: 2, cost: c(0,0,5,0,0) },
  { tier: 2, bonus: "white", points: 3, cost: c(6,0,0,0,0) },

  // Blue bonus (6)
  { tier: 2, bonus: "blue", points: 1, cost: c(3,0,0,2,2) },
  { tier: 2, bonus: "blue", points: 1, cost: c(0,2,3,0,3) },
  { tier: 2, bonus: "blue", points: 2, cost: c(1,4,0,0,0) },
  { tier: 2, bonus: "blue", points: 2, cost: c(5,3,0,0,0) },
  { tier: 2, bonus: "blue", points: 2, cost: c(0,5,0,0,0) },
  { tier: 2, bonus: "blue", points: 3, cost: c(0,6,0,0,0) },

  // Green bonus (6)
  { tier: 2, bonus: "green", points: 1, cost: c(3,2,0,2,0) },
  { tier: 2, bonus: "green", points: 1, cost: c(2,3,0,0,2) },
  { tier: 2, bonus: "green", points: 2, cost: c(4,0,1,0,0) },
  { tier: 2, bonus: "green", points: 2, cost: c(0,5,3,0,0) },
  { tier: 2, bonus: "green", points: 2, cost: c(0,0,5,0,0) },
  { tier: 2, bonus: "green", points: 3, cost: c(0,0,6,0,0) },

  // Red bonus (6)
  { tier: 2, bonus: "red", points: 1, cost: c(2,0,0,3,2) },
  { tier: 2, bonus: "red", points: 1, cost: c(0,3,0,2,3) },
  { tier: 2, bonus: "red", points: 2, cost: c(0,1,4,0,0) },
  { tier: 2, bonus: "red", points: 2, cost: c(3,0,0,0,5) },
  { tier: 2, bonus: "red", points: 2, cost: c(0,0,0,5,0) },
  { tier: 2, bonus: "red", points: 3, cost: c(0,0,0,6,0) },

  // Black bonus (6)
  { tier: 2, bonus: "black", points: 1, cost: c(2,2,3,0,0) },
  { tier: 2, bonus: "black", points: 1, cost: c(3,0,2,3,0) },
  { tier: 2, bonus: "black", points: 2, cost: c(0,0,1,4,0) },
  { tier: 2, bonus: "black", points: 2, cost: c(0,0,0,3,5) },
  { tier: 2, bonus: "black", points: 2, cost: c(0,0,0,0,5) },
  { tier: 2, bonus: "black", points: 3, cost: c(0,0,0,0,6) },
];

// ---------- Tier 3 (20 cards) — 3-5 pts ----------
const TIER3 = [
  // White bonus (4)
  { tier: 3, bonus: "white", points: 3, cost: c(0,3,3,5,3) },
  { tier: 3, bonus: "white", points: 4, cost: c(0,0,0,7,0) },
  { tier: 3, bonus: "white", points: 4, cost: c(3,0,0,7,3) },
  { tier: 3, bonus: "white", points: 5, cost: c(3,0,0,7,0) },

  // Blue bonus (4)
  { tier: 3, bonus: "blue", points: 3, cost: c(3,0,3,3,5) },
  { tier: 3, bonus: "blue", points: 4, cost: c(7,0,0,0,0) },
  { tier: 3, bonus: "blue", points: 4, cost: c(7,3,0,0,3) },
  { tier: 3, bonus: "blue", points: 5, cost: c(7,3,0,0,0) },

  // Green bonus (4)
  { tier: 3, bonus: "green", points: 3, cost: c(5,3,0,3,3) },
  { tier: 3, bonus: "green", points: 4, cost: c(0,7,0,0,0) },
  { tier: 3, bonus: "green", points: 4, cost: c(3,7,3,0,0) },
  { tier: 3, bonus: "green", points: 5, cost: c(0,7,3,0,0) },

  // Red bonus (4)
  { tier: 3, bonus: "red", points: 3, cost: c(3,5,3,0,3) },
  { tier: 3, bonus: "red", points: 4, cost: c(0,0,7,0,0) },
  { tier: 3, bonus: "red", points: 4, cost: c(0,3,7,3,0) },
  { tier: 3, bonus: "red", points: 5, cost: c(0,0,7,3,0) },

  // Black bonus (4)
  { tier: 3, bonus: "black", points: 3, cost: c(3,3,5,3,0) },
  { tier: 3, bonus: "black", points: 4, cost: c(0,0,0,0,7) },
  { tier: 3, bonus: "black", points: 4, cost: c(0,0,3,7,3) },
  { tier: 3, bonus: "black", points: 5, cost: c(0,0,0,7,3) },
];

// ---------- Nobles ----------
// Each noble has a name, points (3), and a requirement of bonus cards.
const NOBLES = [
  { name: "Elisabeth",    points: 3, req: c(0,0,4,4,0) },
  { name: "Charles V",    points: 3, req: c(0,0,0,4,4) },
  { name: "Mary Stuart",  points: 3, req: c(0,4,4,0,0) },
  { name: "Suleiman",     points: 3, req: c(0,4,0,0,4) },
  { name: "Anne of Austria", points: 3, req: c(0,0,3,3,3) },
  { name: "Isabella",     points: 3, req: c(4,4,0,0,0) },
  { name: "Francis I",    points: 3, req: c(0,0,3,3,3) },
  { name: "Henry VIII",   points: 3, req: c(3,0,0,3,3) },
  { name: "Catherine de Medici", points: 3, req: c(3,3,0,0,3) },
  { name: "Machiavelli",  points: 3, req: c(3,3,3,0,0) },
];

// ---------- Assemble deck + meta ----------
const ALL_CARDS = [...TIER1, ...TIER2, ...TIER3].map((card, i) => ({
  ...card,
  id: `c${i}`,
}));

// Token supply per player count
const TOKENS_PER_COLOR = { 2: 4, 3: 5, 4: 7 };
const NOBLES_PER_GAME = { 2: 3, 3: 4, 4: 5 };
const GOLD_SUPPLY = 5;
const MARKET_SIZE = 4;
const WIN_SCORE = 15;
const TOKEN_CAP = 10;
const MAX_RESERVED = 3;

// Node interop: expose all symbols on global so game.js/ai.js can resolve them.
if (typeof module !== "undefined" && module.exports) {
  const __exports = {
    COLORS, COLOR_KEYS, COLOR_LETTERS, ALL_CARDS, TIER1, TIER2, TIER3, NOBLES,
    TOKENS_PER_COLOR, NOBLES_PER_GAME, GOLD_SUPPLY, MARKET_SIZE, WIN_SCORE,
    TOKEN_CAP, MAX_RESERVED, c,
  };
  Object.assign(global, __exports);
  module.exports = __exports;
}
