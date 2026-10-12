// @ts-check
// Fitness: how good an arrangement plan is, as a weighted mean of seven music-theory criteria
// (port of src/ga/fitness.py).
//
// Each criterion turns one arranging heuristic into a score from 0 (bad) to 1 (good):
// 1. complementarity: P2 is calm when the melody is busy and active when the melody rests.
// 2. register: P2 sounds below the melody, so the melody stays on top.
// 3. coherence: bars inside a phrase keep the same choices (a drum fill may end the phrase).
// 4. contrast: the chorus is denser than the verse.
// 5. bass_smoothness: the bass line moves by small leaps, inside bars and across bar lines.
// 6. idiom: NES habits: fast arpeggios on bars with a single chord, drum fills at phrase ends.
// 7. fidelity: the melody stays at its written octave.
//
// Criteria that count decisions (register, bass_smoothness, idiom) pool their counts over the
// whole piece instead of averaging per-bar or per-rule shares, so every overlap step, leap or bar
// decision weighs the same, however the piece happens to be divided.
//
// A criterion that has nothing to judge scores NaN and is left out of the mean: contrast in a
// tune without both a verse and a chorus, coherence when no phrase has two bars,
// bass_smoothness when the bass line never leaps. Scoring 1 there would reward a plan for a rule
// it was never tested on.
//
// The GA calls the fitness about 180,000 times per run, so every score is a lookup in the
// precomputed score tables (tables.js). Python scores the whole population at once with numpy
// fancy indexing; here one loop walks each plan bar by bar and gathers the counts of all seven
// criteria in a single pass, without allocating anything per plan. A population is one flat
// Uint8Array of m × nBars × 4 genes (genome.js).

import { GENES_PER_BAR, NO, NO_PATTERNS, OCT, P1_OCTAVES, P2, P2_TEXTURES, TR, TR_TEXTURES } from "./genome.js";

/**
 * The criterion names, in the order of the Python `CRITERIA`.
 * @type {readonly string[]}
 */
export const CRITERIA = Object.freeze([
  "complementarity",
  "register",
  "coherence",
  "contrast",
  "bass_smoothness",
  "idiom",
  "fidelity",
]);

const FILL = NO_PATTERNS.indexOf("fill");
const ARP16 = P2_TEXTURES.indexOf("arp16");
const ARP32 = P2_TEXTURES.indexOf("arp32");
const WRITTEN_OCTAVE = P1_OCTAVES.indexOf(0);

const N_OCTAVES = P1_OCTAVES.length;
const N_P2 = P2_TEXTURES.length;
const N_TR = TR_TEXTURES.length;
const N_NO = NO_PATTERNS.length;

// Positions of the criteria in a score vector, as in CRITERIA.
const COMPLEMENTARITY = 0;
const REGISTER = 1;
const COHERENCE = 2;
const CONTRAST = 3;
const BASS_SMOOTHNESS = 4;
const IDIOM = 5;
const FIDELITY = 6;

/**
 * Facts of the tune that do not depend on the plan.
 * @typedef {object} PieceFacts
 * @property {number} phrasePairs adjacent bar pairs inside one phrase.
 * @property {number} chorusBars
 * @property {number} verseBars
 * @property {number} singleChordBars
 */

/**
 * Check the population layout and return the number of plans m.
 * @param {import("./tables.js").ScoreTables} tables
 * @param {Uint8Array} population
 * @param {number} nBars
 */
function planCount(tables, population, nBars) {
  const planLength = nBars * GENES_PER_BAR;
  if (!Number.isInteger(nBars) || nBars < 1 || nBars !== tables.nBars) {
    throw new RangeError(`nBars is ${nBars}, but the tables have ${tables.nBars} bars`);
  }
  if (population.length % planLength !== 0) {
    throw new RangeError(`a population of ${population.length} genes is not whole plans of ${planLength} genes`);
  }
  return population.length / planLength;
}

/**
 * @param {import("./tables.js").ScoreTables} tables
 * @param {number} nBars
 * @returns {PieceFacts}
 */
function pieceFacts(tables, nBars) {
  let phrasePairs = 0;
  let chorusBars = 0;
  let singleChordBars = 0;
  for (let b = 0; b < nBars; b++) {
    if (b + 1 < nBars && tables.phrase[b] === tables.phrase[b + 1]) phrasePairs++;
    if (tables.isChorus[b]) chorusBars++;
    if (tables.singleChord[b]) singleChordBars++;
  }
  return { phrasePairs, chorusBars, verseBars: nBars - chorusBars, singleChordBars };
}

/**
 * Write the seven criterion scores of the plan that starts at `start` into `scores`.
 *
 * Every table lookup reads entry [b, gene] of a Python table at the flat index
 * b × (number of gene values) + gene (tables.js header).
 *
 * @param {import("./tables.js").ScoreTables} tables
 * @param {Uint8Array} population
 * @param {number} start index of the plan's first gene.
 * @param {number} nBars
 * @param {PieceFacts} facts
 * @param {Float64Array} scores 7 slots, in CRITERIA order.
 */
function scorePlan(tables, population, start, nBars, facts, scores) {
  const { actP1, actP2, actTr, actNo, regBoth, regOk, bassInner, bassInnerLeaps, bassAcross } = tables;
  const { phrase, phraseEnd, isChorus, singleChord } = tables;
  let complementaritySum = 0;
  let stepsTogether = 0;
  let stepsP2Below = 0;
  let coherentPairs = 0;
  let chorusDensity = 0;
  let verseDensity = 0;
  let innerScoreSum = 0;
  let innerLeaps = 0;
  let acrossScoreSum = 0;
  let fillMatches = 0;
  let arpeggioHits = 0;
  let writtenOctaveBars = 0;

  for (let b = 0; b < nBars; b++) {
    const g = start + b * GENES_PER_BAR;
    const p2 = population[g + P2];
    const tr = population[g + TR];
    const no = population[g + NO];
    const octave = population[g + OCT];
    const hasNext = b + 1 < nBars;

    const melody = actP1[b * N_OCTAVES + octave];
    const harmony = actP2[b * N_P2 + p2];
    complementaritySum += 1 - Math.abs(harmony - (1 - melody));

    // The overlap counts are pooled over bars, so a bar weighs as much as P1 and P2 overlap in it.
    const registerCell = (b * N_OCTAVES + octave) * N_P2 + p2;
    stepsTogether += regBoth[registerCell];
    stepsP2Below += regOk[registerCell];

    if (hasNext && phrase[b] === phrase[b + 1]) {
      const n = g + GENES_PER_BAR;
      const sameTextures = p2 === population[n + P2] && tr === population[n + TR] && octave === population[n + OCT];
      // A fill closes a phrase and leads into the next, so it may follow any groove, but only in
      // the bar that ends the phrase; a mid-phrase fill would let the groove change for free.
      const nextDrums = population[n + NO];
      const drumsFit = no === nextDrums || (nextDrums === FILL && phraseEnd[b + 1] === 1);
      if (sameTextures && drumsFit) coherentPairs++;
    }

    // The drums are read from the bar's own row, since a pattern's activity depends on its meter.
    const density = (harmony + actTr[b * N_TR + tr] + actNo[b * N_NO + no]) / 3;
    if (isChorus[b]) chorusDensity += density;
    else verseDensity += density;

    // A bar's inner mean times its number of leaps gives back its sum, so the leaps of all bars
    // pool into one mean in which each leap counts once. A one-note line (NaN mean) adds 0.
    const bassCell = b * N_TR + tr;
    const leaps = bassInnerLeaps[bassCell];
    const innerMean = bassInner[bassCell];
    innerScoreSum += (Number.isNaN(innerMean) ? 0 : innerMean) * leaps;
    innerLeaps += leaps;
    if (hasNext) acrossScoreSum += bassAcross[bassCell * N_TR + population[g + GENES_PER_BAR + TR]];

    if ((no === FILL) === (phraseEnd[b] === 1)) fillMatches++;
    if (singleChord[b] && (p2 === ARP16 || p2 === ARP32)) arpeggioHits++;
    if (octave === WRITTEN_OCTAVE) writtenOctaveBars++;
  }

  scores[COMPLEMENTARITY] = complementaritySum / nBars;
  scores[REGISTER] = stepsTogether > 0 ? stepsP2Below / stepsTogether : 1;
  scores[COHERENCE] = facts.phrasePairs > 0 ? coherentPairs / facts.phrasePairs : Number.NaN;
  if (facts.chorusBars === 0 || facts.verseBars === 0) {
    scores[CONTRAST] = Number.NaN;
  } else {
    // Equal densities score 0.5, so the GA is pushed toward a denser chorus, not just allowed.
    const lift = chorusDensity / facts.chorusBars - verseDensity / facts.verseBars;
    scores[CONTRAST] = Math.min(1, Math.max(0, 0.5 + lift));
  }
  const leapCount = innerLeaps + (nBars - 1);
  scores[BASS_SMOOTHNESS] = leapCount > 0 ? (innerScoreSum + acrossScoreSum) / leapCount : Number.NaN;
  // Every bar makes one drum decision and every single-chord bar one arpeggio decision.
  scores[IDIOM] = (arpeggioHits + fillMatches) / (facts.singleChordBars + nBars);
  scores[FIDELITY] = writtenOctaveBars / nBars;
}

/**
 * Score every plan of a population on every criterion.
 *
 * @param {import("./tables.js").ScoreTables} tables the score tables of the lead sheet.
 * @param {Uint8Array} population m plans of nBars × 4 genes, one after the other.
 * @param {number} nBars bars per plan; must equal `tables.nBars`.
 * @returns {Record<string, Float64Array>} for each name in CRITERIA, m scores in [0, 1], or NaN
 *   when the criterion does not apply to the tune.
 * @throws {RangeError} when nBars does not match the tables or the population is not whole plans.
 * @example
 * // oneBar: the Python doctest tables, one single-chord verse bar of a busy melody
 * // (actP1 all 1, actP2 [0, 1, 1, 0.5, 0.5], every other activity 0, no bass leap).
 * const scores = criterionScores(oneBar, Uint8Array.of(0, 0, 0, 0, 1, 0, 0, 0), 1); // hold, arp16
 * [...scores.complementarity]; // [1, 0]
 * [...scores.idiom]; // [0.5, 1]
 * [...scores.coherence]; // [NaN, NaN]: one bar has no pair of bars
 */
export function criterionScores(tables, population, nBars) {
  const m = planCount(tables, population, nBars);
  const facts = pieceFacts(tables, nBars);
  const columns = CRITERIA.map(() => new Float64Array(m));
  const scores = new Float64Array(CRITERIA.length);
  for (let plan = 0; plan < m; plan++) {
    scorePlan(tables, population, plan * nBars * GENES_PER_BAR, nBars, facts, scores);
    for (let criterion = 0; criterion < CRITERIA.length; criterion++) columns[criterion][plan] = scores[criterion];
  }
  return Object.fromEntries(CRITERIA.map((name, criterion) => [name, columns[criterion]]));
}

/**
 * Weighted mean of the criteria that apply, for every plan of a population.
 *
 * fitness = Σ w·s / Σ w over the criteria whose score is not NaN. A criterion missing from
 * `weights` has weight 0. The fitness is 0 when the weights of the applicable criteria sum to 0:
 * all plans then tie at 0, roulette selection draws uniformly and the GA stops by stagnation,
 * instead of a NaN fitness breaking the selection.
 *
 * @param {import("./tables.js").ScoreTables} tables the score tables of the lead sheet.
 * @param {Uint8Array} population m plans of nBars × 4 genes, one after the other.
 * @param {number} nBars bars per plan; must equal `tables.nBars`.
 * @param {Record<string, number>} weights weight of each criterion (finite, ≥ 0).
 * @param {Float64Array} [out] array of length m to write into, so a GA loop allocates nothing.
 * @returns {Float64Array} m fitness values in [0, 1] (`out` when given).
 * @throws {RangeError} when nBars does not match the tables or the population is not whole plans.
 * @example
 * // oneBar as in criterionScores. One bar has no pair for coherence, no chorus for contrast and
 * // no bass leap, so the mean runs over the other four criteria.
 * const weights = Object.fromEntries(CRITERIA.map((name) => [name, 1]));
 * fitness(oneBar, Uint8Array.of(0, 0, 0, 0, 1, 0, 0, 1), 1, weights); // [0.875, 0.5]
 * // hold wins on complementarity and fidelity; arp16 an octave up only on idiom
 */
export function fitness(tables, population, nBars, weights, out) {
  const m = planCount(tables, population, nBars);
  const result = out ?? new Float64Array(m);
  if (result.length !== m) throw new RangeError(`out has ${result.length} slots for ${m} plans`);
  const facts = pieceFacts(tables, nBars);
  const weightOf = CRITERIA.map((name) => (Object.hasOwn(weights, name) ? weights[name] : 0));
  const scores = new Float64Array(CRITERIA.length);
  for (let plan = 0; plan < m; plan++) {
    scorePlan(tables, population, plan * nBars * GENES_PER_BAR, nBars, facts, scores);
    let weightedSum = 0;
    let weightSum = 0;
    for (let criterion = 0; criterion < CRITERIA.length; criterion++) {
      if (Number.isNaN(scores[criterion])) continue;
      weightedSum += weightOf[criterion] * scores[criterion];
      weightSum += weightOf[criterion];
    }
    result[plan] = weightSum > 0 ? weightedSum / weightSum : 0;
  }
  return result;
}
