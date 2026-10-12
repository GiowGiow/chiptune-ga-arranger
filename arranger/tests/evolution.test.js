// @ts-check
// Tests for core/evolution.js, the GA loop. They port the doctests of src/ga/evolution.py and
// check the generator interface the worker drives: one stats object per generation, the two stop
// rules, a best fitness that never decreases, reproducibility from the seed, and a best plan that
// survives an early stop.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  IMPROVEMENT_TOLERANCE,
  createGAParams,
  diversity,
  evolve,
  nextGeneration,
} from "../src/core/evolution.js";
import { CRITERIA, fitness } from "../src/core/fitness.js";
import { ALL_ALLOWED, GENES_PER_BAR, NO, OCT, P2, TR, randomPopulation } from "../src/core/genome.js";
import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { mutate, onePointCrossover, rouletteSelect } from "../src/core/operators.js";
import { createRandom } from "../src/core/random.js";
import { buildTables } from "../src/core/tables.js";
import { readFixture, readJson, repoRoot } from "./helpers.js";

/**
 * The hand-written tables of the Python evolve doctest: two bars where only the melody is
 * active, so with fidelity-only weights the best plan keeps both bars at the written octave.
 * @returns {import("../src/core/tables.js").ScoreTables}
 */
function twoBarTables() {
  return {
    nBars: 2,
    actP1: new Float64Array(6).fill(1),
    actP2: new Float64Array(10),
    actTr: new Float64Array(8),
    actNo: new Float64Array(5),
    regBoth: new Int32Array(30),
    regOk: new Int32Array(30),
    bassInner: new Float64Array(8).fill(Number.NaN),
    bassInnerLeaps: new Int32Array(8),
    bassAcross: new Float64Array(16).fill(1),
    singleChord: new Uint8Array(2),
    phraseEnd: new Uint8Array(2),
    phrase: Int32Array.of(0, 0),
    isChorus: new Uint8Array(2),
    shape: {
      actP1: [2, 3],
      actP2: [2, 5],
      actTr: [2, 4],
      actNo: [5],
      regBoth: [2, 3, 5],
      regOk: [2, 3, 5],
      bassInner: [2, 4],
      bassInnerLeaps: [2, 4],
      bassAcross: [1, 4, 4],
      singleChord: [2],
      phraseEnd: [2],
      phrase: [2],
      isChorus: [2],
    },
  };
}

const FIDELITY_ONLY = Object.fromEntries(CRITERIA.map((name) => [name, name === "fidelity" ? 1 : 0]));

/** @param {Partial<import("../src/core/evolution.js").GAParams>} [overrides] */
function smallParams(overrides = {}) {
  return createGAParams({
    populationSize: 10,
    maxGenerations: 30,
    stagnationWindow: 10,
    mutationRate: 0.05,
    eliteCount: 1,
    ...overrides,
  });
}

/**
 * Run a generator to its end and return the yielded values and the return value.
 * @template Y, R
 * @param {Generator<Y, R>} generator
 * @returns {{yielded: Y[], returned: R}}
 */
function drain(generator) {
  const yielded = [];
  for (;;) {
    const step = generator.next();
    if (step.done) return { yielded, returned: step.value };
    yielded.push(step.value);
  }
}

let korobeinikiCache = /** @type {import("../src/core/tables.js").ScoreTables | null} */ (null);
function korobeinikiTables() {
  korobeinikiCache ??= buildTables(leadSheetFromJson(readFixture("leadsheets/korobeiniki.json")));
  return korobeinikiCache;
}

// Parameters and diversity

test("improvements smaller than 1e-12 are floating-point noise", () => {
  assert.equal(IMPROVEMENT_TOLERANCE, 1e-12);
});

test("the elite must leave at least one place for children", () => {
  const message = "elite_count must be at least 0 and smaller than population_size";
  assert.throws(() => smallParams({ eliteCount: 10 }), { name: "RangeError", message });
  assert.throws(() => smallParams({ eliteCount: -1 }), { name: "RangeError", message });
  assert.equal(smallParams({ eliteCount: 9 }).eliteCount, 9);
  assert.equal(smallParams({ eliteCount: 0 }).eliteCount, 0);
});

test("GA parameters must be whole counts and a rate in [0, 1]", () => {
  assert.throws(() => smallParams({ populationSize: 0, eliteCount: 0 }), RangeError);
  assert.throws(() => smallParams({ maxGenerations: 2.5 }), RangeError);
  assert.throws(() => smallParams({ stagnationWindow: -1 }), RangeError);
  assert.throws(() => smallParams({ mutationRate: 1.5 }), RangeError);
  assert.ok(Object.isFrozen(smallParams()));
});

// Allowed values (spec 003, research R12)

/** Every value of every gene but arp32 (P2 gene value 2). */
const NO_ARP32 = [[0, 1, 3, 4], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2]];

test("GA parameters allow every gene value when allowed is omitted", () => {
  const params = smallParams();
  assert.deepEqual(params.allowed, ALL_ALLOWED);
  assert.ok(Object.isFrozen(params.allowed));
});

test("GA parameters keep a frozen copy of the allowed gene values", () => {
  const allowed = NO_ARP32.map((values) => [...values]);
  const params = smallParams({ allowed });
  allowed[0].push(2);
  assert.deepEqual(params.allowed, NO_ARP32);
  assert.ok(Object.isFrozen(params.allowed));
  for (const values of params.allowed) assert.ok(Object.isFrozen(values));
});

test("GA parameters reject a gene with no allowed value", () => {
  const allowed = [[], ...NO_ARP32.slice(1)];
  assert.throws(() => smallParams({ allowed }), RangeError);
});

test("GA parameters reject allowed values that no gene has, repeated values or missing genes", () => {
  assert.throws(() => smallParams({ allowed: [[0, 5], ...NO_ARP32.slice(1)] }), RangeError);
  assert.throws(() => smallParams({ allowed: [[0, 0], ...NO_ARP32.slice(1)] }), RangeError);
  assert.throws(() => smallParams({ allowed: NO_ARP32.slice(1) }), RangeError);
});

test("evolve rejects invalid parameters before generation 0", () => {
  const params = { ...smallParams(), eliteCount: 10 };
  assert.throws(() => evolve(createRandom(1), twoBarTables(), 2, params, FIDELITY_ONLY).next(), RangeError);
});

test("diversity is the share of distinct plans: 3 distinct of 4 gives 0.75", () => {
  const plans = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0);
  assert.equal(diversity(plans, 4, 1), 0.75);
});

test("diversity is 1 when all plans differ and 1/m when all are copies", () => {
  assert.equal(diversity(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0), 3, 1), 1);
  assert.equal(diversity(new Uint8Array(5 * 8), 5, 2), 0.2);
});

test("diversity compares whole plans, not single bars", () => {
  // Plans [bar x, bar y] and [bar y, bar x] share their bars but differ as plans.
  const x = [1, 2, 3, 0];
  const y = [4, 3, 2, 1];
  assert.equal(diversity(Uint8Array.of(...x, ...y, ...y, ...x, ...x, ...y), 3, 2), 2 / 3);
});

// One generation

test("nextGeneration keeps the population shape (the Python doctest)", () => {
  const population = new Uint8Array(4 * 3 * 4);
  const out = new Uint8Array(population.length);
  const params = createGAParams({
    populationSize: 4,
    maxGenerations: 1,
    stagnationWindow: 1,
    mutationRate: 0,
    eliteCount: 1,
  });
  const result = nextGeneration(createRandom(0), population, new Float64Array(4).fill(1), params, 3, out);
  assert.equal(result, out);
  assert.equal(out.length, 48);
  assert.deepEqual(out, new Uint8Array(48));
});

test("nextGeneration copies the elite first, best first, then fills the rest with children", () => {
  const nBars = 2;
  const planLength = nBars * GENES_PER_BAR;
  // Plan i has every gene equal to i.
  const population = Uint8Array.from({ length: 5 * planLength }, (_, i) => Math.floor(i / planLength));
  const fitnessValues = Float64Array.of(0.1, 0.9, 0.3, 0.8, 0.2);
  const params = createGAParams({
    populationSize: 5,
    maxGenerations: 1,
    stagnationWindow: 1,
    mutationRate: 0,
    eliteCount: 2,
  });
  const out = new Uint8Array(population.length);
  nextGeneration(createRandom(3), population, fitnessValues, params, nBars, out);
  assert.deepEqual(Array.from(out.subarray(0, planLength)), new Array(planLength).fill(1));
  assert.deepEqual(Array.from(out.subarray(planLength, 2 * planLength)), new Array(planLength).fill(3));
  // Without mutation, every child bar is a bar of some parent; the worst plan (0) never breeds.
  for (let gene = 2 * planLength; gene < out.length; gene++) {
    assert.ok([1, 2, 3, 4].includes(out[gene]), `gene ${gene} = ${out[gene]}`);
  }
});

test("nextGeneration draws parents, then cuts, then mutations, in a fixed order", () => {
  // 5 plans with 1 elite leave 4 children (2 pairs); 4 plans with 1 elite leave 3 (the second
  // child of the last pair is dropped).
  for (const populationSize of [5, 4]) {
    const nBars = 3;
    const planLength = nBars * GENES_PER_BAR;
    const params = createGAParams({
      populationSize,
      maxGenerations: 1,
      stagnationWindow: 1,
      mutationRate: 0.2,
      eliteCount: 1,
    });
    const length = populationSize * planLength;
    const population = Uint8Array.from({ length }, (_, index) => (index * 7) % 3);
    const fitnessValues = Float64Array.from({ length: populationSize }, (_, plan) => 0.1 * (plan + 1));

    const reference = createRandom(21);
    const expected = new Uint8Array(population.length);
    expected.set(population.subarray((populationSize - 1) * planLength, populationSize * planLength));
    const nChildren = populationSize - 1;
    const pairs = Math.ceil(nChildren / 2);
    const parents = rouletteSelect(reference, fitnessValues, 2 * pairs);
    const children = new Uint8Array(2 * pairs * planLength);
    for (let pair = 0; pair < pairs; pair++) {
      /** @param {number} index */
      const plan = (index) => population.subarray(index * planLength, (index + 1) * planLength);
      onePointCrossover(
        reference,
        plan(parents[2 * pair]),
        plan(parents[2 * pair + 1]),
        children.subarray(2 * pair * planLength, (2 * pair + 1) * planLength),
        children.subarray((2 * pair + 1) * planLength, (2 * pair + 2) * planLength),
      );
    }
    expected.set(children.subarray(0, nChildren * planLength), planLength);
    mutate(reference, expected.subarray(planLength), 0.2);

    const out = new Uint8Array(population.length);
    nextGeneration(createRandom(21), population, fitnessValues, params, nBars, out);
    assert.deepEqual(out, expected, `population of ${populationSize}`);
  }
});

test("nextGeneration refuses to write over the population it reads", () => {
  const population = new Uint8Array(4 * 4);
  const params = createGAParams({
    populationSize: 4,
    maxGenerations: 1,
    stagnationWindow: 1,
    mutationRate: 0,
    eliteCount: 1,
  });
  /** @param {Uint8Array} out */
  const writeInto = (out) => () =>
    nextGeneration(createRandom(1), population, new Float64Array(4), params, 1, out);
  assert.throws(writeInto(population), RangeError);
  assert.throws(writeInto(new Uint8Array(8)), RangeError);
});

test("nextGeneration mutates the children inside the allowed values", () => {
  const nBars = 4;
  const params = createGAParams({
    populationSize: 30,
    maxGenerations: 1,
    stagnationWindow: 1,
    mutationRate: 1,
    eliteCount: 2,
    allowed: NO_ARP32,
  });
  const population = randomPopulation(createRandom(22), 30, nBars, NO_ARP32);
  const fitnessValues = Float64Array.from({ length: 30 }, (_, plan) => plan / 30);
  const out = new Uint8Array(population.length);
  nextGeneration(createRandom(23), population, fitnessValues, params, nBars, out);
  for (let index = P2; index < out.length; index += GENES_PER_BAR) {
    assert.notEqual(out[index], 2, `gene ${index} is arp32`);
  }
});

// The GA loop

test("two bars, fidelity-only weights: fitness 1, both melody bars at the written octave", () => {
  const { returned } = drain(evolve(createRandom(0), twoBarTables(), 2, smallParams(), FIDELITY_ONLY));
  assert.equal(returned.bestFitness, 1);
  assert.deepEqual([returned.bestPlan[OCT], returned.bestPlan[GENES_PER_BAR + OCT]], [0, 0]);
});

test("evolve yields one stats object per generation and returns the result", () => {
  const generator = evolve(createRandom(2), twoBarTables(), 2, smallParams(), FIDELITY_ONLY);
  assert.equal(typeof generator.next, "function");
  const { yielded, returned } = drain(generator);
  yielded.forEach((stats, index) => {
    assert.deepEqual(Object.keys(stats).sort(), ["best", "diversity", "generation", "mean", "stagnation"]);
    assert.equal(stats.generation, index);
    assert.ok(stats.mean <= stats.best);
    assert.ok(stats.diversity > 0 && stats.diversity <= 1);
  });
  assert.deepEqual(Object.keys(returned).sort(), [
    "bestFitness",
    "bestPlan",
    "initialBestPlan",
    "log",
    "stopReason",
  ]);
  assert.deepEqual(returned.log, yielded);
  assert.equal(returned.bestPlan.length, 8);
  assert.equal(returned.initialBestPlan.length, 8);
});

test("evolve stops with 'stagnation' when the generations without improvement reach the window", () => {
  // With no weight at all every plan scores 0: generation 0 sets the best, and nothing beats it.
  const params = smallParams({ stagnationWindow: 5, maxGenerations: 100 });
  const { yielded, returned } = drain(evolve(createRandom(3), twoBarTables(), 2, params, {}));
  assert.equal(returned.stopReason, "stagnation");
  assert.deepEqual(yielded.map((stats) => stats.stagnation), [0, 1, 2, 3, 4, 5]);
});

test("evolve stops with 'max_generations' after the last allowed generation", () => {
  const params = smallParams({ stagnationWindow: 1000, maxGenerations: 7 });
  const { yielded, returned } = drain(evolve(createRandom(4), twoBarTables(), 2, params, {}));
  assert.equal(returned.stopReason, "max_generations");
  assert.equal(yielded.at(-1)?.generation, 7);
  assert.equal(returned.log.length, 8);
});

test("the best fitness never decreases, and the best plan scores the best fitness", () => {
  const tables = korobeinikiTables();
  const params = createGAParams({
    populationSize: 20,
    maxGenerations: 120,
    stagnationWindow: 1000,
    mutationRate: 0.01,
    eliteCount: 1,
  });
  const weights = readJson(join(repoRoot, "configs", "default.json")).weights;
  const { returned } = drain(evolve(createRandom(5), tables, tables.nBars, params, weights));
  returned.log.slice(1).forEach((stats, index) => {
    assert.ok(stats.best >= returned.log[index].best, `generation ${stats.generation} lost fitness`);
  });
  assert.equal(fitness(tables, returned.bestPlan, tables.nBars, weights)[0], returned.bestFitness);
  assert.equal(fitness(tables, returned.initialBestPlan, tables.nBars, weights)[0], returned.log[0].best);
  assert.ok(returned.bestFitness > returned.log[0].best);
});

test("two runs with seed 7 give identical logs and best plans", () => {
  const tables = korobeinikiTables();
  const params = createGAParams({
    populationSize: 16,
    maxGenerations: 80,
    stagnationWindow: 30,
    mutationRate: 0.02,
    eliteCount: 2,
  });
  const weights = readJson(join(repoRoot, "configs", "default.json")).weights;
  const first = drain(evolve(createRandom(7), tables, tables.nBars, params, weights)).returned;
  const second = drain(evolve(createRandom(7), tables, tables.nBars, params, weights)).returned;
  assert.deepEqual(second.log, first.log);
  assert.deepEqual(second.bestPlan, first.bestPlan);
  assert.deepEqual(second.initialBestPlan, first.initialBestPlan);
  const other = drain(evolve(createRandom(8), tables, tables.nBars, params, weights)).returned;
  assert.notDeepEqual(other.log, first.log);
});

test("calling .return() mid-run leaves a result holding the best plan so far", () => {
  const tables = korobeinikiTables();
  const params = createGAParams({
    populationSize: 12,
    maxGenerations: 500,
    stagnationWindow: 500,
    mutationRate: 0.02,
    eliteCount: 1,
  });
  const weights = readJson(join(repoRoot, "configs", "default.json")).weights;
  const result = /** @type {import("../src/core/evolution.js").EvolutionResult} */ ({});
  const generator = evolve(createRandom(9), tables, tables.nBars, params, weights, result);
  const seen = [];
  for (const stats of generator) {
    seen.push(stats);
    if (stats.generation === 40) break; // break calls generator.return()
  }
  assert.equal(result.stopReason, "stopped");
  assert.deepEqual(result.log, seen);
  assert.equal(result.bestFitness, Math.max(...seen.map((stats) => stats.best)));
  assert.equal(fitness(tables, result.bestPlan, tables.nBars, weights)[0], result.bestFitness);
  assert.equal(result.initialBestPlan.length, tables.nBars * GENES_PER_BAR);
});

test("the result object passed to evolve is the one it returns", () => {
  const result = /** @type {import("../src/core/evolution.js").EvolutionResult} */ ({});
  const run = evolve(createRandom(1), twoBarTables(), 2, smallParams(), FIDELITY_ONLY, result);
  const { returned } = drain(run);
  assert.equal(returned, result);
  assert.notEqual(result.stopReason, "stopped");
});

test("evolve draws generation 0 and every mutation from the allowed values only", () => {
  // One allowed value for P2, TR and NO: every plan of every generation must hold exactly it.
  const allowed = [[3], [1], [4], [0, 1, 2]];
  for (const seed of [0, 1, 2]) {
    const params = smallParams({ mutationRate: 0.5, allowed });
    const { returned } = drain(evolve(createRandom(seed), twoBarTables(), 2, params, FIDELITY_ONLY));
    for (const plan of [returned.initialBestPlan, returned.bestPlan]) {
      for (let bar = 0; bar < 2; bar++) {
        const genes = plan.subarray(bar * GENES_PER_BAR, (bar + 1) * GENES_PER_BAR);
        assert.deepEqual([genes[P2], genes[TR], genes[NO]], [3, 1, 4], `seed ${seed}, bar ${bar}`);
      }
    }
  }
});

test("with every value allowed, evolve gives the same run as without the setting", () => {
  const plain = drain(evolve(createRandom(7), twoBarTables(), 2, smallParams(), FIDELITY_ONLY));
  const params = smallParams({ allowed: ALL_ALLOWED });
  const allAllowed = drain(evolve(createRandom(7), twoBarTables(), 2, params, FIDELITY_ONLY));
  assert.deepEqual(allAllowed.returned.log, plain.returned.log);
  assert.deepEqual(allAllowed.returned.bestPlan, plain.returned.bestPlan);
});

test("Korobeiniki (32 bars) with the default settings and seed 1 evolves to a stop", (t) => {
  const config = readJson(join(repoRoot, "configs", "default.json"));
  const tables = korobeinikiTables();
  assert.equal(tables.nBars, 32);
  const params = createGAParams({
    populationSize: config.population_size,
    maxGenerations: config.max_generations,
    stagnationWindow: config.stagnation_window,
    mutationRate: config.mutation_rate,
    eliteCount: config.elite_count,
  });
  const started = performance.now();
  const { returned } = drain(evolve(createRandom(1), tables, tables.nBars, params, config.weights));
  const milliseconds = performance.now() - started;
  const generations = returned.log.length - 1;
  t.diagnostic(
    `Korobeiniki seed 1: ${generations} generations, best fitness ${returned.bestFitness.toFixed(4)}, ` +
      `${returned.stopReason}, ${milliseconds.toFixed(0)} ms`,
  );
  assert.ok(["stagnation", "max_generations"].includes(/** @type {string} */ (returned.stopReason)));
  assert.ok(returned.bestFitness > returned.log[0].best);
  assert.ok(returned.bestFitness > 0.85 && returned.bestFitness <= 1, `${returned.bestFitness}`);
});

test("the JSDoc examples of evolution.js hold", () => {
  assert.throws(
    () =>
      createGAParams({
        populationSize: 60,
        maxGenerations: 3000,
        stagnationWindow: 300,
        mutationRate: 0.01,
        eliteCount: 60,
      }),
    { name: "RangeError", message: "elite_count must be at least 0 and smaller than population_size" },
  );
  const defaults = createGAParams({
    populationSize: 60,
    maxGenerations: 3000,
    stagnationWindow: 300,
    mutationRate: 0.01,
    eliteCount: 1,
  });
  assert.deepEqual(defaults.allowed, [[0, 1, 2, 3, 4], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2]]);
  // evolve accepts plain parameters and a weights object that names only some criteria.
  const params = {
    populationSize: 10,
    maxGenerations: 30,
    stagnationWindow: 10,
    mutationRate: 0.05,
    eliteCount: 1,
  };
  const run = evolve(createRandom(0), twoBarTables(), 2, params, { fidelity: 1 });
  let step = run.next();
  while (!step.done) step = run.next();
  assert.deepEqual([step.value.bestFitness, step.value.bestPlan[3], step.value.bestPlan[7]], [1, 0, 0]);
});
