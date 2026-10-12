// @ts-check
// The GA loop: evolve a population of arrangement plans, one generation at a time
// (port of src/ga/evolution.py).
//
// Generation 0 is a random population. Each later generation is built from the previous one:
// 1. score every plan with the fitness function;
// 2. copy the `eliteCount` best plans unchanged (elitism);
// 3. fill the remaining places with children: pick parents with roulette selection, cut and swap
//    them with one-point crossover, then mutate the children gene by gene.
//
// The loop stops after `maxGenerations` new generations, or earlier when the best fitness has not
// improved for `stagnationWindow` generations (more generations would most likely not help). Every
// generation is logged with its best and mean fitness and its diversity, the share of distinct
// plans, which shows how fast selection makes the population converge.
//
// Unlike the Python function, `evolve` is a generator function: it pauses after each generation
// and hands its stats to the caller, who decides when to continue. The worker uses those pauses
// to draw the run live, to keep a steady pace and to stop on request (research R6). The pauses
// never touch the random stream, so they cannot change the result.
//
// Two population buffers take turns (double buffering): each generation is written into the
// buffer the previous one no longer needs, so a run allocates no population after generation 0.

import { fitness } from "./fitness.js";
import { GENES_PER_BAR, randomPopulation } from "./genome.js";
import { eliteIndices, mutate, onePointCrossover, rouletteSelect } from "./operators.js";

/**
 * Improvements this small are floating-point noise, not progress.
 * @type {number}
 */
export const IMPROVEMENT_TOLERANCE = 1e-12;

/**
 * Hyperparameters of one GA run (the Python `GAParams`).
 * @typedef {object} GAParams
 * @property {number} populationSize number of plans in every generation (m).
 * @property {number} maxGenerations number of generations evolved after the random generation 0.
 * @property {number} stagnationWindow generations without improvement of the best fitness before
 *   stopping.
 * @property {number} mutationRate probability that each gene of a child is mutated.
 * @property {number} eliteCount number of best plans copied unchanged into the next generation.
 */

/**
 * One row of the fitness log.
 * @typedef {object} GenerationStats
 * @property {number} generation generation number, 0 for the random population.
 * @property {number} best highest fitness in the generation.
 * @property {number} mean mean fitness of the generation.
 * @property {number} diversity number of distinct plans divided by the population size, in (0, 1].
 * @property {number} stagnation generations in a row, up to this one, without an improvement of
 *   the best fitness (0 when this generation improved it); the run stops when it reaches the
 *   stagnation window.
 */

/**
 * What a GA run gives back. `evolve` updates it after every generation.
 * @typedef {object} EvolutionResult
 * @property {Uint8Array} bestPlan the best plan seen in any generation (nBars × 4 genes).
 * @property {number} bestFitness its fitness.
 * @property {GenerationStats[]} log one row per generation, starting with generation 0.
 * @property {"stagnation" | "max_generations" | "stopped" | null} stopReason null while the run
 *   goes on; "stopped" when the caller ended it early.
 * @property {Uint8Array} initialBestPlan the best plan of the random generation 0, a baseline to
 *   compare with.
 */

/**
 * Check and freeze the hyperparameters of a run.
 *
 * At least one place must be left for children, or the population could never change.
 *
 * @param {GAParams} fields the five hyperparameters.
 * @returns {Readonly<GAParams>} a frozen copy.
 * @throws {RangeError} when eliteCount is outside 0..populationSize − 1 (the Python message), or
 *   a count is not a whole number, or the rate is outside [0, 1].
 * @example
 * createGAParams({ populationSize: 60, maxGenerations: 3000, stagnationWindow: 300,
 *   mutationRate: 0.01, eliteCount: 60 });
 * // throws RangeError("elite_count must be at least 0 and smaller than population_size")
 */
export function createGAParams(fields) {
  const { populationSize, maxGenerations, stagnationWindow, mutationRate, eliteCount } = fields;
  /** @type {[string, number, number][]} */
  const counts = [
    ["populationSize", populationSize, 1],
    ["maxGenerations", maxGenerations, 0],
    ["stagnationWindow", stagnationWindow, 0],
  ];
  for (const [name, value, low] of counts) {
    if (!Number.isInteger(value) || value < low) {
      throw new RangeError(`${name} must be a whole number of at least ${low}, got ${value}`);
    }
  }
  if (!(mutationRate >= 0 && mutationRate <= 1)) {
    throw new RangeError(`mutationRate must be in [0, 1], got ${mutationRate}`);
  }
  if (!Number.isInteger(eliteCount) || eliteCount < 0 || eliteCount >= populationSize) {
    throw new RangeError("elite_count must be at least 0 and smaller than population_size");
  }
  return Object.freeze({
    populationSize,
    maxGenerations,
    stagnationWindow,
    mutationRate,
    eliteCount,
  });
}

/**
 * Share of distinct plans in a population: 1 when all differ, 1/m when all are copies.
 *
 * Each plan gets a 32-bit FNV-1a hash of its genes; only plans with equal hashes are compared
 * gene by gene, so a converged population costs one comparison per plan.
 *
 * @param {Uint8Array} population m plans of nBars × 4 genes, one after the other.
 * @param {number} m number of plans.
 * @param {number} nBars bars per plan.
 * @returns {number} distinct plans / m.
 * @example
 * // four 1-bar plans: [0,0,0,0], [0,0,0,0], [1,0,0,0], [2,0,0,0]
 * diversity(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0), 4, 1); // → 0.75
 */
export function diversity(population, m, nBars) {
  const planLength = nBars * GENES_PER_BAR;
  const hashes = new Int32Array(m);
  for (let plan = 0; plan < m; plan++) {
    let hash = 0x811c9dc5;
    for (let gene = plan * planLength; gene < (plan + 1) * planLength; gene++) {
      hash = Math.imul(hash ^ population[gene], 0x01000193);
    }
    hashes[plan] = hash;
  }
  let distinct = 0;
  for (let plan = 0; plan < m; plan++) {
    let seenBefore = false;
    for (let earlier = 0; earlier < plan && !seenBefore; earlier++) {
      seenBefore =
        hashes[earlier] === hashes[plan] && samePlan(population, earlier, plan, planLength);
    }
    if (!seenBefore) distinct++;
  }
  return distinct / m;
}

/**
 * @param {Uint8Array} population
 * @param {number} first @param {number} second plan indices
 * @param {number} planLength genes per plan
 */
function samePlan(population, first, second, planLength) {
  const firstStart = first * planLength;
  const secondStart = second * planLength;
  for (let gene = 0; gene < planLength; gene++) {
    if (population[firstStart + gene] !== population[secondStart + gene]) return false;
  }
  return true;
}

/**
 * Build the next population: the elite unchanged, then mutated children of roulette parents.
 *
 * Draws, in this order: all parents at once (`rouletteSelect` of 2 per pair of children), one
 * crossover cut per pair, in pair order, then the mutation of the children block. When the number
 * of free places is odd, the second child of the last pair is dropped, as in Python.
 *
 * @param {import("./random.js").Random} rng the run's generator.
 * @param {Uint8Array} population the current m plans.
 * @param {ArrayLike<number>} fitnessValues their m fitness values.
 * @param {Readonly<GAParams>} params the run's hyperparameters (m = params.populationSize).
 * @param {number} nBars bars per plan.
 * @param {Uint8Array} out the buffer to write the next population into; same length as
 *   `population`, and a different buffer.
 * @returns {Uint8Array} out.
 * @throws {RangeError} when out has the wrong length or shares its buffer with the population.
 * @example
 * // 4 plans of 3 bars, all genes 0, equal fitness, no mutation: the children stay all 0
 * const params = createGAParams({ populationSize: 4, maxGenerations: 1, stagnationWindow: 1,
 *   mutationRate: 0, eliteCount: 1 });
 * nextGeneration(createRandom(0), new Uint8Array(48), new Float64Array(4).fill(1), params, 3,
 *   new Uint8Array(48)); // → Uint8Array(48) of zeros
 */
export function nextGeneration(rng, population, fitnessValues, params, nBars, out) {
  if (out.length !== population.length || out.buffer === population.buffer) {
    throw new RangeError("out must be a separate buffer of the population's length");
  }
  const planLength = nBars * GENES_PER_BAR;
  /** @param {Uint8Array} plans @param {number} index */
  const planOf = (plans, index) => plans.subarray(index * planLength, (index + 1) * planLength);

  const elite = eliteIndices(fitnessValues, params.eliteCount);
  elite.forEach((plan, place) => out.set(planOf(population, plan), place * planLength));

  const nChildren = params.populationSize - elite.length;
  const pairs = Math.ceil(nChildren / 2);
  const parents = rouletteSelect(rng, fitnessValues, 2 * pairs);
  // Only an odd number of children needs a spare place for the dropped second child.
  const spare = nChildren % 2 === 1 ? new Uint8Array(planLength) : null;
  for (let pair = 0; pair < pairs; pair++) {
    const firstPlace = elite.length + 2 * pair;
    const secondChild =
      firstPlace + 1 < params.populationSize ? planOf(out, firstPlace + 1) : spare;
    onePointCrossover(
      rng,
      planOf(population, parents[2 * pair]),
      planOf(population, parents[2 * pair + 1]),
      planOf(out, firstPlace),
      /** @type {Uint8Array} */ (secondChild),
    );
  }
  mutate(rng, out.subarray(elite.length * planLength), params.mutationRate);
  return out;
}

/**
 * Run the GA on one tune, one generation per step.
 *
 * Each `next()` evolves one generation and yields its stats; the generator returns the result
 * when a stop rule fires. `result` is updated after every generation, so a caller that ends the
 * run early (`break` in a for…of, or `.return()`) still holds the best plan so far; its
 * `stopReason` is then "stopped".
 *
 * Draws: `randomPopulation` for generation 0, then `nextGeneration` for each later one.
 *
 * @param {import("./random.js").Random} rng the run's generator.
 * @param {import("./tables.js").ScoreTables} tables the score tables of the lead sheet.
 * @param {number} nBars bars per plan; must equal `tables.nBars`.
 * @param {GAParams} params the run's hyperparameters (checked with createGAParams).
 * @param {Record<string, number>} weights weight of each criterion.
 * @param {EvolutionResult} [result] object to keep up to date; a new one when omitted.
 * @returns {Generator<GenerationStats, EvolutionResult, void>}
 * @throws {RangeError} on the first `next()` when the parameters are invalid.
 * @example
 * // twoBars: the Python doctest tables, two bars where only the melody is active
 * const fidelityOnly = { fidelity: 1 };
 * const params = { populationSize: 10, maxGenerations: 30, stagnationWindow: 10,
 *   mutationRate: 0.05, eliteCount: 1 };
 * const run = evolve(createRandom(0), twoBars, 2, params, fidelityOnly);
 * let step = run.next();
 * while (!step.done) step = run.next(); // step.value is a GenerationStats until the end
 * [step.value.bestFitness, step.value.bestPlan[3], step.value.bestPlan[7]]; // → [1, 0, 0]
 */
export function* evolve(rng, tables, nBars, params, weights, result = /** @type {any} */ ({})) {
  const checked = createGAParams(params);
  const m = checked.populationSize;
  const planLength = nBars * GENES_PER_BAR;

  let population = randomPopulation(rng, m, nBars);
  let spareBuffer = new Uint8Array(population.length);
  const fitnessValues = new Float64Array(m);
  Object.assign(result, {
    bestPlan: new Uint8Array(planLength),
    bestFitness: -Infinity,
    log: [],
    stopReason: null,
    initialBestPlan: new Uint8Array(planLength),
  });

  let stagnation = 0;
  try {
    for (let generation = 0; ; generation++) {
      fitness(tables, population, nBars, weights, fitnessValues);
      let leader = 0;
      let sum = 0;
      for (let plan = 0; plan < m; plan++) {
        sum += fitnessValues[plan];
        // Strictly greater: the first of equal plans leads, as numpy's argmax.
        if (fitnessValues[plan] > fitnessValues[leader]) leader = plan;
      }
      const best = fitnessValues[leader];
      const leaderPlan = population.subarray(leader * planLength, (leader + 1) * planLength);
      if (generation === 0) result.initialBestPlan = leaderPlan.slice();
      if (best > result.bestFitness + IMPROVEMENT_TOLERANCE) {
        result.bestFitness = best;
        result.bestPlan = leaderPlan.slice();
        stagnation = 0;
      } else {
        stagnation++;
      }

      /** @type {GenerationStats} */
      const stats = {
        generation,
        best,
        mean: sum / m,
        diversity: diversity(population, m, nBars),
        stagnation,
      };
      result.log.push(stats);
      if (stagnation >= checked.stagnationWindow) result.stopReason = "stagnation";
      else if (generation === checked.maxGenerations) result.stopReason = "max_generations";

      yield stats;
      if (result.stopReason !== null) return result;

      const next = nextGeneration(rng, population, fitnessValues, checked, nBars, spareBuffer);
      spareBuffer = population;
      population = next;
    }
  } finally {
    // Reached without a stop reason only when the caller ended the run early.
    if (result.stopReason === null) result.stopReason = "stopped";
  }
}
