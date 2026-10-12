// @ts-check
// Genetic operators: how parents are chosen and how children are made from them
// (port of src/ga/operators.py).
//
// The GA follows the scheme taught in the course:
// - Roulette selection gives each plan a slice of a wheel proportional to its fitness and spins
//   the wheel once per parent. The slices use windowing: the lowest fitness of the generation is
//   subtracted first. A weighted mean of seven criteria gives fitness values close to each other
//   (say 0.70 to 0.80), and plain proportional slices would then be almost equal, so selection
//   would barely prefer the better plans.
// - Elitism copies the best plans unchanged into the next generation, so the best fitness never
//   goes down.
// - One-point crossover cuts both parents at the same bar line and swaps the tails, so each
//   child keeps whole bars of its parents.
// - Mutation replaces each gene, with a small probability, by a different allowed value, which
//   brings back choices that selection has lost. The setting `allowed` (see genome.js) keeps
//   values out of the search, so mutation only moves a gene among the values it may take.
//
// Plans are flat Uint8Array ranges of nBars × 4 genes (see genome.js). Every function that draws
// random numbers takes the generator of random.js as its first parameter, and its draw order is
// fixed and documented, so a run is reproducible from its seed. The order differs from numpy's,
// which the app does not need to match (spec FR-028).

import { ALL_ALLOWED, GENES_PER_BAR } from "./genome.js";

/**
 * Fitness values closer than this are ties: the same weighted mean summed in a different order
 * can differ in the last bits, and that noise must not decide who reproduces.
 * @type {number}
 */
export const TIE_TOLERANCE = 1e-12;

/**
 * Pick n parent indices with probability proportional to fitness minus the lowest fitness.
 *
 * The worst plan of the generation gets an empty slice. When all fitness values are equal (up
 * to TIE_TOLERANCE), every plan gets the same slice: windowing would otherwise give the whole
 * wheel to whichever plan is one rounding error above the others.
 *
 * Draws: one `rng.pickWeighted` per pick, or one `rng.integer(0, m)` per pick when all fitness
 * values tie.
 *
 * @param {import("./random.js").Random} rng the run's generator.
 * @param {ArrayLike<number>} fitness one value per plan, m ≥ 1 values.
 * @param {number} n number of picks.
 * @returns {Int32Array} n plan indices, in draw order.
 * @throws {RangeError} when fitness is empty.
 * @example
 * const picks = rouletteSelect(createRandom(1), [0.2, 0.9, 0.9], 1000);
 * picks.includes(0); // → false: the worst plan is never picked
 */
export function rouletteSelect(rng, fitness, n) {
  const m = fitness.length;
  if (m === 0) throw new RangeError("roulette needs at least one plan");
  let lowest = fitness[0];
  let highest = fitness[0];
  for (let i = 1; i < m; i++) {
    if (fitness[i] < lowest) lowest = fitness[i];
    if (fitness[i] > highest) highest = fitness[i];
  }

  const picks = new Int32Array(n);
  if (highest - lowest <= TIE_TOLERANCE) {
    for (let k = 0; k < n; k++) picks[k] = rng.integer(0, m); // equal slices
    return picks;
  }
  // The wheel as running sums of the windowed weights, built once for all n spins.
  const cumulative = new Float64Array(m);
  let total = 0;
  for (let i = 0; i < m; i++) {
    total += fitness[i] - lowest;
    cumulative[i] = total;
  }
  for (let k = 0; k < n; k++) picks[k] = rng.pickWeighted(cumulative, total);
  return picks;
}

/**
 * Return the indices of the k highest fitness values, best first.
 *
 * Ties keep the lower index first, so the choice does not depend on chance.
 *
 * @param {ArrayLike<number>} fitness one value per plan.
 * @param {number} k elite size, an integer from 0 to the number of plans.
 * @returns {Int32Array} k plan indices, best first.
 * @throws {RangeError} when k is outside 0..m.
 * @example
 * eliteIndices([0.3, 0.9, 0.1, 0.9], 2); // → Int32Array [1, 3]
 */
export function eliteIndices(fitness, k) {
  if (!Number.isInteger(k) || k < 0 || k > fitness.length) {
    throw new RangeError(`the elite size must be in 0..${fitness.length}, got ${k}`);
  }
  const order = Array.from({ length: fitness.length }, (_, index) => index);
  // Best first; equal values fall back to index order, which makes the sort stable by design.
  order.sort((i, j) => fitness[j] - fitness[i] || i - j);
  return Int32Array.from(order.slice(0, k));
}

/**
 * Cut two parent plans at the same random bar line and swap their tails.
 *
 * The cut c is drawn with `rng.integer(1, nBars)`, so each child takes at least one bar from
 * each parent: childA = bars 0..c-1 of parentA, then bars c.. of parentB; childB is the mirror.
 * Parents of one bar cannot be cut: the children are copies of them, c is 1 and no random
 * number is drawn.
 *
 * The children are written into the given arrays (for example `subarray` views of the next
 * population), so a generation allocates no plan. They must not overlap the parents.
 *
 * @param {import("./random.js").Random} rng the run's generator.
 * @param {Uint8Array} parentA a plan of nBars × 4 genes.
 * @param {Uint8Array} parentB a plan of the same length.
 * @param {Uint8Array} childA receives parentA's head and parentB's tail.
 * @param {Uint8Array} childB receives parentB's head and parentA's tail.
 * @returns {number} the cut c: the number of bars each child takes from its first parent.
 * @throws {RangeError} when the four plans differ in length or are not whole bars.
 * @example
 * const zeros = new Uint8Array(16), ones = new Uint8Array(16).fill(1); // 4 bars each
 * const childA = new Uint8Array(16), childB = new Uint8Array(16);
 * onePointCrossover(createRandom(1), zeros, ones, childA, childB);
 * // → 2: childA's bars are [0, 0, 1, 1] (all four genes of each bar), childB's [1, 1, 0, 0]
 */
export function onePointCrossover(rng, parentA, parentB, childA, childB) {
  const length = parentA.length;
  if (
    length === 0 ||
    length % GENES_PER_BAR !== 0 ||
    parentB.length !== length ||
    childA.length !== length ||
    childB.length !== length
  ) {
    throw new RangeError("crossover needs four plans of the same length, in whole bars");
  }
  const nBars = length / GENES_PER_BAR;
  const cut = nBars > 1 ? rng.integer(1, nBars) : nBars;
  const tailStart = cut * GENES_PER_BAR;
  childA.set(parentA.subarray(0, tailStart));
  childA.set(parentB.subarray(tailStart), tailStart);
  childB.set(parentB.subarray(0, tailStart));
  childB.set(parentA.subarray(tailStart), tailStart);
  return cut;
}

/**
 * Give each gene, with probability rate, a different allowed value, in place.
 *
 * A gene holding the value at position p of its k allowed values moves to position
 * (p + shift) mod k, with a random shift from 1 to k - 1. Wrapping around never gives back the
 * old value, and reaches each of the other allowed values with equal probability. A gene with
 * one allowed value has nowhere to go and keeps it.
 *
 * Draws, gene by gene in index order: one `rng.float()`, and when it is below rate and the gene
 * has k ≥ 2 allowed values, one `rng.integer(1, k)` for the shift. With every value allowed, the
 * position is the value itself, so the draws and the results are those of the app before the
 * setting existed.
 *
 * @param {import("./random.js").Random} rng the run's generator.
 * @param {Uint8Array} genes one plan or several consecutive plans; index 0 must be the first
 *   gene of a bar, so that index % 4 tells the gene (P2, TR, NO or OCT).
 * @param {number} rate probability that each gene mutates, in [0, 1].
 * @param {import("./genome.js").AllowedGenes} [allowed] the values each gene column may take
 *   (see `allowedGenes`); every value by default.
 * @returns {number} how many genes changed.
 * @throws {RangeError} when rate is outside [0, 1] or genes is not whole bars.
 * @example
 * const plan = new Uint8Array(8); // 2 bars, every gene 0
 * mutate(createRandom(1), plan, 1); // → 8: at rate 1 every gene takes another value
 * const onlyHold = [[0], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2]];
 * mutate(createRandom(1), new Uint8Array(8), 1, onlyHold); // → 6: both P2 genes stay "hold"
 */
export function mutate(rng, genes, rate, allowed = ALL_ALLOWED) {
  if (!(rate >= 0 && rate <= 1)) throw new RangeError(`the rate must be in [0, 1], got ${rate}`);
  if (genes.length % GENES_PER_BAR !== 0) {
    throw new RangeError(`mutation needs whole bars of 4 genes, got ${genes.length} genes`);
  }
  let changed = 0;
  for (let index = 0; index < genes.length; index++) {
    if (rng.float() < rate) {
      const values = allowed[index % GENES_PER_BAR];
      const k = values.length;
      if (k < 2) continue;
      // A value outside the allowed ones (the GA never makes one) has position -1, so the shift
      // still lands on an allowed value.
      const position = values.indexOf(genes[index]);
      genes[index] = values[(position + rng.integer(1, k)) % k];
      changed++;
    }
  }
  return changed;
}
