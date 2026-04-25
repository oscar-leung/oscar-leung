// AI + simulator tests.
const test = require("node:test");
const assert = require("node:assert/strict");

require("../data.js");
require("../game.js");
require("../ai.js");
const sim = require("../sim.js");

test("legalActions returns at least one move for a fresh game", () => {
  const s = createGame({ playerNames: ["A","B"], seed: 1 });
  const acts = legalActions(s);
  assert.ok(acts.length > 0);
  assert.ok(acts.some((a) => a.type === "take"));
});

test("legalActions includes take2 only when supply has 4+", () => {
  const s = createGame({ playerNames: ["A","B"], seed: 1 });
  s.supply.white = 4; s.supply.blue = 3;
  const acts = legalActions(s);
  assert.ok(acts.some((a) => a.type === "take2" && a.color === "white"));
  assert.ok(!acts.some((a) => a.type === "take2" && a.color === "blue"));
});

test("legalActions excludes reserve when 3 already reserved", () => {
  const s = createGame({ playerNames: ["A","B"], seed: 1 });
  s.players[0].reserved = [s.market[1][0], s.market[1][1], s.market[1][2]];
  const acts = legalActions(s);
  assert.ok(!acts.some((a) => a.type === "reserve"));
});

test("each strategy returns a legal action on a fresh game", () => {
  const s = createGame({ playerNames: ["A","B"], seed: 1 });
  for (const name of Object.keys(STRATEGIES)) {
    const action = STRATEGIES[name].choose(s);
    assert.ok(action, `${name} returned no action`);
    const legal = legalActions(s);
    const found = legal.some((l) => JSON.stringify(l) === JSON.stringify(action));
    assert.ok(found, `${name} returned an illegal action: ${JSON.stringify(action)}`);
  }
});

test("applyAction advances turn and clears no-ops", () => {
  const s = createGame({ playerNames: ["A","B"], seed: 1 });
  const before = s.current;
  applyAction(s, { type: "take", colors: ["white","blue","green"] });
  assert.equal(s.current, (before + 1) % 2);
});

test("runMatch with seed is deterministic", () => {
  const a = sim.buildStrategy("greedy");
  const b = sim.buildStrategy("balanced");
  const m1 = sim.runMatch([a, b], 5, null, { seed: 12345 });
  const m2 = sim.runMatch([a, b], 5, null, { seed: 12345 });
  assert.deepEqual(
    m1.results.map((r) => r.wins),
    m2.results.map((r) => r.wins),
    "Same seed should yield same wins"
  );
  assert.deepEqual(m1.turnHistogram, m2.turnHistogram);
});

test("runGame terminates within hard limit even for random play", () => {
  const r = sim.buildStrategy("random");
  const result = sim.runGame([r, r], { seed: 7 });
  // Either someone won, or we hit the safety cap. Either way, game state must be terminal.
  assert.ok(result.turns > 0);
  assert.ok(typeof result.winner === "number");
});

test("greedy outperforms random over a small match", () => {
  // This is a sanity check: greedy should clearly beat random.
  const greedy = sim.buildStrategy("greedy");
  const random = sim.buildStrategy("random");
  const m = sim.runMatch([greedy, random], 30, null, { seed: 1 });
  assert.ok(
    m.results[0].winRate > m.results[1].winRate,
    `Greedy should beat Random; got greedy=${m.results[0].winRate}, random=${m.results[1].winRate}`
  );
});

test("perturbWeights stays non-negative", () => {
  const w = sim.perturbWeights({ a: 1, b: 0.1, c: 5 }, 0.5);
  for (const k of Object.keys(w)) assert.ok(w[k] >= 0);
});

test("explainAction returns a non-empty description for every action type", () => {
  const s = createGame({ playerNames: ["A","B"], seed: 1 });
  const samples = [
    { type: "take", colors: ["white","blue","green"] },
    { type: "take2", color: "white" },
    { type: "reserve", tier: 1, cardId: "deck" },
    { type: "reserve", tier: 1, cardId: s.market[1][0].id },
    { type: "buy", source: "market", tier: 1, cardId: s.market[1][0].id },
  ];
  for (const a of samples) {
    const txt = explainAction(s, a);
    assert.ok(typeof txt === "string" && txt.length > 0, `Empty explanation for ${JSON.stringify(a)}`);
  }
});
