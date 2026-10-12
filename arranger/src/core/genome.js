// @ts-check
// The genotype: one arrangement plan as four integer genes per bar (port of src/ga/genome.py).
//
// For every bar of the tune, the GA chooses how the three accompanying NES channels play and
// where the melody sits:
// - gene P2: the harmony texture of the second pulse channel (an index into P2_TEXTURES);
// - gene TR: the bass texture of the triangle channel (an index into TR_TEXTURES);
// - gene NO: the drum pattern of the noise channel (an index into NO_PATTERNS);
// - gene OCT: the octave shift of the melody on P1 (an index into P1_OCTAVES, in semitones).
//
// The setting `allowed` narrows the values each gene may take, for example to keep the fast
// 32nd-note arpeggio out of the arrangement (spec 003, research R12). The GA draws generation 0
// and every mutation from the allowed values only; crossover and elitism just move genes, so no
// plan of any generation holds a disallowed value.
//
// Python stores a plan as an array of shape (n_bars, 4). Here a plan is a flat Uint8Array of
// n_bars × 4 genes: bar b holds the genes 4b … 4b + 3 (data-model.md "Plan"). A population of
// m plans is one Uint8Array of m × n_bars × 4, so a generation allocates no object per plan.

/**
 * Harmony textures of the P2 channel, in gene order.
 * @type {readonly string[]}
 */
export const P2_TEXTURES = Object.freeze(["hold", "arp16", "arp32", "echo", "third"]);

/**
 * Bass textures of the triangle channel, in gene order.
 * @type {readonly string[]}
 */
export const TR_TEXTURES = Object.freeze(["root", "octave_pump", "root_fifth", "walking"]);

/**
 * Drum patterns of the noise channel, in gene order.
 * @type {readonly string[]}
 */
export const NO_PATTERNS = Object.freeze([
  "none",
  "half_time",
  "eighth_beat",
  "sixteenth_beat",
  "fill",
]);

/**
 * Octave shifts of the melody on P1, in semitones, in gene order.
 * @type {readonly number[]}
 */
export const P1_OCTAVES = Object.freeze([0, 12, -12]);

/**
 * Number of possible values of each gene, in gene order: [5, 4, 5, 3].
 * @type {readonly number[]}
 */
export const GENE_SIZES = Object.freeze([
  P2_TEXTURES.length,
  TR_TEXTURES.length,
  NO_PATTERNS.length,
  P1_OCTAVES.length,
]);

/**
 * Genes per bar: a plan of n bars has n × GENES_PER_BAR genes.
 * @type {number}
 */
export const GENES_PER_BAR = GENE_SIZES.length;

/**
 * The gene values the GA may draw, one sorted array per gene column (P2, TR, NO, OCT).
 * @typedef {readonly (readonly number[])[]} AllowedGenes
 */

/**
 * Every value of every gene, the default of the `allowed` setting:
 * [[0, 1, 2, 3, 4], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2]].
 * @type {AllowedGenes}
 */
export const ALL_ALLOWED = Object.freeze(
  GENE_SIZES.map((size) => Object.freeze(Array.from({ length: size }, (_, value) => value))),
);

// The config key under `allowed` and the value names of each gene column, in column order.
const GENE_VALUE_NAMES = /** @type {const} */ ([
  ["p2", P2_TEXTURES],
  ["tr", TR_TEXTURES],
  ["no", NO_PATTERNS],
  ["p1_octave", P1_OCTAVES],
]);

/**
 * Turn the `allowed` setting (value names per gene) into sorted gene values per column.
 *
 * The setting is checked by `validateSettings` (settings.js); the order of its lists does not
 * matter, because the draws use the sorted values.
 *
 * @param {{p2: string[], tr: string[], no: string[], p1_octave: number[]}} allowed value names
 *   of each gene, as in `configs/default.json`; octaves are semitones.
 * @returns {number[][]} one sorted array of gene values per column (P2, TR, NO, OCT).
 * @throws {RangeError} when a list is missing or names a value that its gene does not have.
 * @example
 * allowedGenes({ p2: ["third", "hold"], tr: ["root"], no: ["fill"], p1_octave: [0] });
 * // → [[0, 4], [0], [4], [0]]
 */
export function allowedGenes(allowed) {
  return GENE_VALUE_NAMES.map(([key, names]) => {
    const listed = /** @type {Record<string, unknown>} */ (allowed)[key];
    if (!Array.isArray(listed)) throw new RangeError(`allowed.${key} must be a list`);
    return listed
      .map((name) => {
        const value = /** @type {readonly unknown[]} */ (names).indexOf(name);
        if (value < 0) throw new RangeError(`allowed.${key}: unknown value "${name}"`);
        return value;
      })
      .sort((a, b) => a - b);
  });
}

/** Position of the P2 texture gene inside a bar. @type {number} */
export const P2 = 0;
/** Position of the TR texture gene inside a bar. @type {number} */
export const TR = 1;
/** Position of the NO pattern gene inside a bar. @type {number} */
export const NO = 2;
/** Position of the P1 octave gene inside a bar. @type {number} */
export const OCT = 3;

/**
 * One bar of a decoded plan.
 * @typedef {object} BarChoice
 * @property {string} p2 P2 texture name.
 * @property {string} tr TR texture name.
 * @property {string} no NO pattern name.
 * @property {number} p1Octave melody shift in semitones (0, 12 or -12).
 */

/**
 * Draw m random plans of nBars bars, every gene uniform over its allowed values.
 *
 * This is generation 0 of the GA: no plan is preferred, so the search starts from an unbiased
 * sample of the space. Draws, in storage order (plan by plan, bar by bar, gene by gene): one
 * `rng.integer(0, k)` per gene, the position of its value among the gene's k allowed values.
 * With every value allowed, the position is the value itself, so the draws are those of the app
 * before the setting existed, and a seed keeps its arrangement.
 *
 * @param {import("./random.js").Random} rng the run's generator.
 * @param {number} m number of plans, a positive integer.
 * @param {number} nBars bars per plan, a positive integer.
 * @param {AllowedGenes} [allowed] the values each gene column may take (see `allowedGenes`);
 *   every value by default.
 * @returns {Uint8Array} the population, m × nBars × 4 genes; plan i is the slice
 *   [i × nBars × 4, (i + 1) × nBars × 4).
 * @throws {RangeError} when m or nBars is not a positive integer.
 * @example
 * const population = randomPopulation(createRandom(1), 3, 2);
 * population.length; // → 24 (3 plans × 2 bars × 4 genes)
 * population.every((gene, i) => gene < GENE_SIZES[i % 4]); // → true
 * const noArp32 = randomPopulation(createRandom(1), 3, 2, [[0, 1, 3, 4], [0, 1, 2, 3],
 *   [0, 1, 2, 3, 4], [0, 1, 2]]);
 * noArp32.some((gene, i) => i % 4 === P2 && gene === 2); // → false
 */
export function randomPopulation(rng, m, nBars, allowed = ALL_ALLOWED) {
  if (!Number.isInteger(m) || m < 1 || !Number.isInteger(nBars) || nBars < 1) {
    throw new RangeError(`m and nBars must be positive integers, got ${m} and ${nBars}`);
  }
  const population = new Uint8Array(m * nBars * GENES_PER_BAR);
  for (let index = 0; index < population.length; index++) {
    const values = allowed[index % GENES_PER_BAR];
    population[index] = values[rng.integer(0, values.length)];
  }
  return population;
}

/**
 * Translate a plan into readable choices, one object per bar.
 *
 * @param {ArrayLike<number>} plan nBars × 4 genes, bar b at indices 4b … 4b + 3.
 * @returns {BarChoice[]} one entry per bar, in bar order.
 * @throws {RangeError} when the plan is not whole bars or a gene is outside its valid values.
 * @example
 * decode(Uint8Array.of(1, 3, 4, 2));
 * // → [{p2: "arp16", tr: "walking", no: "fill", p1Octave: -12}]
 */
export function decode(plan) {
  if (plan.length % GENES_PER_BAR !== 0) {
    throw new RangeError(`a plan has 4 genes per bar, got ${plan.length} genes`);
  }
  for (let index = 0; index < plan.length; index++) {
    const size = GENE_SIZES[index % GENES_PER_BAR];
    if (!(plan[index] >= 0 && plan[index] < size)) {
      throw new RangeError(`gene ${index} is ${plan[index]}, outside 0..${size - 1}`);
    }
  }
  const bars = [];
  for (let start = 0; start < plan.length; start += GENES_PER_BAR) {
    bars.push({
      p2: P2_TEXTURES[plan[start + P2]],
      tr: TR_TEXTURES[plan[start + TR]],
      no: NO_PATTERNS[plan[start + NO]],
      p1Octave: P1_OCTAVES[plan[start + OCT]],
    });
  }
  return bars;
}
