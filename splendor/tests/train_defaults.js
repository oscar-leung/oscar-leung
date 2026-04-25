// One-off script to discover better default weights for the balanced heuristic.
// Trains against a mixed pool of opponents (greedy, points, nobleRusher) so we
// don't overfit to any single one. Run with:
//   node tests/train_defaults.js
//
// Prints the best weights to stdout for hand-pasting into ai.js's DEFAULT_WEIGHTS.

require("../data.js");
require("../game.js");
require("../ai.js");
const sim = require("../sim.js");

const ROUNDS = 60;
const GAMES_PER_OPPONENT = 25;
const OPPONENTS = ["greedy", "points", "nobleRusher"];
const SEED_BASE = 0xC0DECAFE;

function evalWeights(weights, baseSeed) {
  // Returns the average win rate across opponents.
  let totalWR = 0;
  for (const opp of OPPONENTS) {
    const stratA = { label: "candidate", choose: STRATEGIES.balanced.choose, weights };
    const stratB = { label: opp, choose: STRATEGIES[opp].choose };
    const m = sim.runMatch([stratA, stratB], GAMES_PER_OPPONENT, null, { seed: baseSeed });
    totalWR += m.results[0].winRate;
  }
  return totalWR / OPPONENTS.length;
}

let bestWeights = { ...DEFAULT_WEIGHTS };
let bestScore = evalWeights(bestWeights, SEED_BASE);
console.log(`Baseline (default weights): avg win rate = ${(bestScore * 100).toFixed(1)}%`);

for (let r = 0; r < ROUNDS; r++) {
  const candidate = sim.perturbWeights(bestWeights, 0.35);
  // Evaluate each candidate on a fresh seed to reduce variance correlation.
  const candidateSeed = (SEED_BASE ^ (r * 0x9E3779B1)) >>> 0;
  const score = evalWeights(candidate, candidateSeed);
  // Re-evaluate baseline on the same seed for fair comparison.
  const baseScore = evalWeights(bestWeights, candidateSeed);
  const accepted = score > baseScore;
  if (accepted) {
    bestWeights = candidate;
    bestScore = score;
  }
  process.stdout.write(`\rRound ${r + 1}/${ROUNDS}: candidate=${(score * 100).toFixed(1)}% baseline=${(baseScore * 100).toFixed(1)}% ${accepted ? "✓" : " "}     `);
}

// Re-evaluate the final best weights on a fresh independent seed for an honest readout
const honestScore = evalWeights(bestWeights, SEED_BASE ^ 0xDEADBEEF);

console.log(`\n\nFinal trained weights (avg win rate vs mix on held-out seed: ${(honestScore * 100).toFixed(1)}%):`);
console.log("const DEFAULT_WEIGHTS = {");
for (const [k, v] of Object.entries(bestWeights)) {
  console.log(`  ${k}: ${Number(v).toFixed(3)},`);
}
console.log("};");
