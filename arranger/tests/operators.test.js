// @ts-check
// Tests for core/operators.js: roulette selection with windowing, elitism, one-point crossover
// and mutation. They port the doctests of src/ga/operators.py and pin the documented draw order,
// so a run stays reproducible from its seed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { GENE_SIZES, randomPopulation } from "../src/core/genome.js";
import {
  TIE_TOLERANCE,
  eliteIndices,
  mutate,
  onePointCrossover,
  rouletteSelect,
} from "../src/core/operators.js";
import { createRandom } from "../src/core/random.js";

/** @param {ArrayLike<number>} picks @param {number} m */
function countPicks(picks, m) {
  const counts = new Array(m).fill(0);
  for (let i = 0; i < picks.length; i++) counts[picks[i]]++;
  return counts;
}

/**
 * A plan of nBars bars whose genes all equal value.
 * @param {number} nBars @param {number} value
 */
function uniformPlan(nBars, value) {
  return new Uint8Array(nBars * 4).fill(value);
}

/**
 * Cross two parents into fresh child arrays.
 * @param {import("../src/core/random.js").Random} rng
 * @param {Uint8Array} parentA @param {Uint8Array} parentB
 */
function crossover(rng, parentA, parentB) {
  const childA = new Uint8Array(parentA.length);
  const childB = new Uint8Array(parentA.length);
  const cut = onePointCrossover(rng, parentA, parentB, childA, childB);
  return { cut, childA, childB };
}

/**
 * The first `cut` bars of head followed by the remaining bars of tail.
 * @param {Uint8Array} head @param {Uint8Array} tail @param {number} cut
 */
function joinAtBar(head, tail, cut) {
  return Uint8Array.of(...head.subarray(0, cut * 4), ...tail.subarray(cut * 4));
}

// Roulette selection

test("fitness values closer than 1e-12 count as ties", () => {
  assert.equal(TIE_TOLERANCE, 1e-12);
});

test("roulette never picks the worst plan of [0.2, 0.9, 0.9] in 1,000 draws", () => {
  const picks = rouletteSelect(createRandom(1), [0.2, 0.9, 0.9], 1000);
  assert.ok(picks instanceof Int32Array);
  assert.equal(picks.length, 1000);
  assert.equal(picks.includes(0), false);
  assert.ok(picks.includes(1) && picks.includes(2));
});

test("roulette gives each plan a slice proportional to its fitness minus the lowest", () => {
  // Windowing turns [0.2, 0.5, 0.8] into the weights [0, 0.3, 0.6]: shares 0, 1/3 and 2/3.
  const picks = rouletteSelect(createRandom(2), Float64Array.of(0.2, 0.5, 0.8), 3000);
  const [worst, middle, best] = countPicks(picks, 3);
  assert.equal(worst, 0);
  assert.ok(middle > 850 && middle < 1150, `middle picked ${middle} times`);
  assert.ok(best > 1850 && best < 2150, `best picked ${best} times`);
});

test("roulette spins the wheel once per pick with rng.pickWeighted", () => {
  const fitness = [0.25, 0.5, 1.0];
  const reference = createRandom(3);
  const cumulative = Float64Array.of(0, 0.25, 1.0);
  const expected = Array.from({ length: 20 }, () => reference.pickWeighted(cumulative, 1.0));
  assert.deepEqual(Array.from(rouletteSelect(createRandom(3), fitness, 20)), expected);
});

test("with every fitness within 1e-12, roulette picks each plan about equally often", () => {
  const nearlyEqual = [0.75, 0.75 + 5e-13, 0.75 - 4e-13];
  const counts = countPicks(rouletteSelect(createRandom(4), nearlyEqual, 3000), 3);
  for (const count of counts) assert.ok(count > 850 && count < 1150, `counts ${counts}`);
});

test("with tied fitness, roulette draws rng.integer(0, m) once per pick", () => {
  const reference = createRandom(5);
  const expected = Array.from({ length: 20 }, () => reference.integer(0, 4));
  assert.deepEqual(Array.from(rouletteSelect(createRandom(5), [0.5, 0.5, 0.5, 0.5], 20)), expected);
});

test("roulette of zero picks is empty, and roulette over no plan throws RangeError", () => {
  assert.equal(rouletteSelect(createRandom(1), [0.1, 0.2], 0).length, 0);
  assert.throws(() => rouletteSelect(createRandom(1), [], 2), RangeError);
});

// Elitism

test("eliteIndices([0.3, 0.9, 0.1, 0.9], 2) gives [1, 3], best first", () => {
  assert.deepEqual(Array.from(eliteIndices([0.3, 0.9, 0.1, 0.9], 2)), [1, 3]);
});

test("elitism orders from best to worst and keeps tied plans in index order", () => {
  const elite = eliteIndices(Float64Array.of(0.5, 0.7, 0.5, 0.9, 0.5), 5);
  assert.ok(elite instanceof Int32Array);
  assert.deepEqual(Array.from(elite), [3, 1, 0, 2, 4]);
});

test("an elite of 0 plans is empty, and an elite larger than the population throws", () => {
  assert.equal(eliteIndices([0.3, 0.9], 0).length, 0);
  assert.throws(() => eliteIndices([0.3, 0.9], 3), RangeError);
  assert.throws(() => eliteIndices([0.3, 0.9], -1), RangeError);
});

// One-point crossover

test("crossover of zeros and ones with seed 1 cuts after bar 2 (the JSDoc example)", () => {
  const { cut, childA, childB } = crossover(createRandom(1), uniformPlan(4, 0), uniformPlan(4, 1));
  assert.equal(cut, 2);
  assert.deepEqual(Array.from(childA), [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(Array.from(childB), [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("crossover keeps the length and swaps whole bars after a cut from 1 to n - 1", () => {
  const nBars = 5;
  const length = nBars * 4;
  const seenCuts = new Set();
  for (let seed = 0; seed < 200; seed++) {
    const parents = randomPopulation(createRandom(1000 + seed), 2, nBars);
    const parentA = parents.subarray(0, length);
    const parentB = parents.subarray(length);
    const { cut, childA, childB } = crossover(createRandom(seed), parentA, parentB);
    assert.ok(Number.isInteger(cut) && cut >= 1 && cut <= nBars - 1, `cut ${cut}`);
    seenCuts.add(cut);
    assert.equal(childA.length, length);
    assert.equal(childB.length, length);
    assert.deepEqual(childA, joinAtBar(parentA, parentB, cut));
    assert.deepEqual(childB, joinAtBar(parentB, parentA, cut));
  }
  assert.deepEqual([...seenCuts].sort(), [1, 2, 3, 4]);
});

test("crossover writes into subarray views of a population", () => {
  const population = randomPopulation(createRandom(12), 2, 3);
  const [mother, father] = [population.subarray(0, 12), population.subarray(12)];
  const next = new Uint8Array(24);
  const cut = onePointCrossover(
    createRandom(12),
    mother,
    father,
    next.subarray(0, 12),
    next.subarray(12),
  );
  assert.deepEqual(next.subarray(0, 12), joinAtBar(mother, father, cut));
  assert.deepEqual(next.subarray(12), joinAtBar(father, mother, cut));
});

test("crossover draws the cut with rng.integer(1, nBars) and nothing else", () => {
  const reference = createRandom(6);
  const expectedCut = reference.integer(1, 3);
  const rng = createRandom(6);
  const { cut } = crossover(rng, uniformPlan(3, 0), uniformPlan(3, 1));
  assert.equal(cut, expectedCut);
  assert.equal(rng.uint32(), reference.uint32());
});

test("crossover of 1-bar parents copies them and draws no random number", () => {
  const rng = createRandom(7);
  const parentA = Uint8Array.of(1, 2, 3, 0);
  const parentB = Uint8Array.of(4, 0, 1, 2);
  const { cut, childA, childB } = crossover(rng, parentA, parentB);
  assert.equal(cut, 1);
  assert.deepEqual(childA, parentA);
  assert.deepEqual(childB, parentB);
  assert.equal(rng.uint32(), createRandom(7).uint32());
});

test("crossover rejects parents of different lengths or of partial bars", () => {
  const rng = createRandom(1);
  /** @param {number[]} lengths the lengths of parentA, parentB, childA and childB */
  const crossLengths = (lengths) => {
    const [parentA, parentB, childA, childB] = lengths.map((length) => new Uint8Array(length));
    return () => onePointCrossover(rng, parentA, parentB, childA, childB);
  };
  assert.throws(crossLengths([8, 12, 8, 8]), RangeError);
  assert.throws(crossLengths([6, 6, 6, 6]), RangeError);
  assert.throws(crossLengths([8, 8, 4, 8]), RangeError);
  assert.throws(crossLengths([0, 0, 0, 0]), RangeError);
});

// Mutation

test("mutation at rate 0 changes nothing", () => {
  const plan = uniformPlan(2, 0);
  assert.equal(mutate(createRandom(1), plan, 0), 0);
  assert.deepEqual(plan, uniformPlan(2, 0));
});

test("mutation at rate 1 changes every gene to a different valid value", () => {
  const population = randomPopulation(createRandom(8), 10, 6);
  const before = population.slice();
  assert.equal(mutate(createRandom(8), population, 1), population.length);
  population.forEach((gene, index) => {
    assert.notEqual(gene, before[index], `gene ${index} kept its value`);
    assert.ok(gene < GENE_SIZES[index % 4], `gene ${index} = ${gene} is not valid`);
  });
});

test("the JSDoc example of mutate holds: a plan of zeros at rate 1 changes all 8 genes", () => {
  const plan = new Uint8Array(8);
  assert.equal(mutate(createRandom(1), plan, 1), 8);
  assert.ok(plan.every((gene) => gene !== 0));
});

test("a mutated gene reaches each other value about equally often", () => {
  // P2 has 5 values: from 0, a shift of 1 to 4 lands on 1, 2, 3 or 4, each about 25%.
  const counts = [0, 0, 0, 0, 0];
  const rng = createRandom(9);
  for (let trial = 0; trial < 4000; trial++) {
    const bar = new Uint8Array(4);
    mutate(rng, bar, 1);
    counts[bar[0]]++;
  }
  assert.equal(counts[0], 0);
  for (const count of counts.slice(1)) assert.ok(count > 850 && count < 1150, `counts ${counts}`);
});

test("mutation changes about rate × genes", () => {
  const genes = new Uint8Array(10000);
  const changed = mutate(createRandom(10), genes, 0.1);
  assert.ok(changed > 900 && changed < 1100, `${changed} genes changed`);
  assert.equal(genes.reduce((count, gene) => count + (gene !== 0 ? 1 : 0), 0), changed);
});

test("mutation draws, gene by gene, a float and then a shift only when the gene mutates", () => {
  const rate = 0.3;
  const reference = createRandom(11);
  const expected = Uint8Array.of(0, 1, 2, 0, 4, 3, 1, 2);
  for (let index = 0; index < expected.length; index++) {
    if (reference.float() < rate) {
      const size = GENE_SIZES[index % 4];
      expected[index] = (expected[index] + reference.integer(1, size)) % size;
    }
  }
  const genes = Uint8Array.of(0, 1, 2, 0, 4, 3, 1, 2);
  mutate(createRandom(11), genes, rate);
  assert.deepEqual(genes, expected);
});

test("mutation rejects a rate outside [0, 1] and a range of partial bars", () => {
  const rng = createRandom(1);
  assert.throws(() => mutate(rng, new Uint8Array(4), -0.1), RangeError);
  assert.throws(() => mutate(rng, new Uint8Array(4), 1.5), RangeError);
  assert.throws(() => mutate(rng, new Uint8Array(4), NaN), RangeError);
  assert.throws(() => mutate(rng, new Uint8Array(6), 0.1), RangeError);
});
