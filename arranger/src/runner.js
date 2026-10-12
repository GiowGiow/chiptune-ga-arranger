// @ts-check
// The GA side of the page ↔ worker protocol (contracts/worker-protocol.md, research R6).
//
// The genetic algorithm of core/evolution.js is a generator: each step evolves one generation.
// The runner decides when to take those steps, so that the page stays live while a run goes on:
// - it works in slices of about 8 ms, then pauses, so `stop`, `pace` and a new `run` get in;
// - at the "watch" pace, generation g is not computed before g / 400 s after the start, so a
//   run lasts a few seconds and the visitor sees the curve grow; "full" never waits;
// - it sends the stats of the new generations in one `progress` message at most every 50 ms;
// - `stop` ends the run after the current slice, with the best plan found so far.
// Pauses fall between generations and never touch the random generator, so the pace and the
// timing of messages cannot change the plan a run finds.
//
// The clock, the pause and the message channel come from outside (`createRunner`), so the
// runner holds no browser API: worker.js wires it to the real worker, and the tests to a fake
// clock. This module ports the run part of `arrange` in src/main.py (tables, then evolve), with
// the GA drawing only the gene values that `settings.allowed` keeps.

import { createGAParams, evolve } from "./core/evolution.js";
import { criterionScores } from "./core/fitness.js";
import { allowedGenes } from "./core/genome.js";
import { createRandom } from "./core/random.js";
import { validateSettings } from "./core/settings.js";
import { buildTables } from "./core/tables.js";

/** Longest stretch of GA work before the runner pauses, in ms. @type {number} */
export const SLICE_MS = 8;

/** Shortest time between two `progress` messages, in ms. @type {number} */
export const PROGRESS_INTERVAL_MS = 50;

/** Generations per second at the "watch" pace. @type {number} */
export const WATCH_GENERATIONS_PER_SECOND = 400;

const MS_PER_WATCHED_GENERATION = 1000 / WATCH_GENERATIONS_PER_SECOND;

/**
 * What the runner needs from its host.
 * @typedef {object} RunnerHost
 * @property {(message: object) => void} post sends a message to the page.
 * @property {() => number} now a clock in ms (performance.now in the worker).
 * @property {(milliseconds: number) => Promise<void>} sleep resolves after a pause, letting other
 *   messages in.
 */

/**
 * The state of the current run, changed by `stop`, `pace` and a newer `run`.
 * @typedef {object} RunState
 * @property {string} runId
 * @property {"watch" | "full"} pace
 * @property {number | null} watchOrigin time at which generation 0 is due at the watch pace;
 *   null until the watch pace (re)starts, so a switch to "watch" continues from where the run is.
 * @property {boolean} stopRequested
 * @property {boolean} cancelled true when a newer run replaced this one; it then posts nothing.
 */

/**
 * Create the message handler of the GA worker.
 *
 * @param {RunnerHost} host the message channel, the clock and the pause.
 * @returns {{handle: (message: any) => Promise<void> | undefined}} `handle` takes one page
 *   message (`run`, `stop` or `pace`). For `run` it returns a promise that settles when the run
 *   ends (the tests await it; the worker ignores it).
 * @example
 * const runner = createRunner({ post: console.log, now: () => performance.now(),
 *   sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
 * await runner.handle({ type: "run", runId: "korobeiniki-s1", leadSheet, settings, pace: "full" });
 * // logs started, progress…, then done with stopReason "stagnation" or "max_generations"
 */
export function createRunner({ post, now, sleep }) {
  /** @type {RunState | null} */
  let current = null;

  /**
   * @param {RunState} run
   * @param {import("./core/leadsheet.js").LeadSheet} leadSheet
   * @param {import("./core/settings.js").Settings} settings
   */
  async function execute(run, leadSheet, settings) {
    /** @param {string} type @param {object} fields */
    const send = (type, fields) => {
      if (!run.cancelled) post({ type, runId: run.runId, ...fields });
    };
    try {
      const problems = validateSettings(settings);
      if (problems.length > 0) {
        throw new RangeError(problems.map((problem) => problem.message).join("; "));
      }
      const params = createGAParams({
        populationSize: settings.population_size,
        maxGenerations: settings.max_generations,
        stagnationWindow: settings.stagnation_window,
        mutationRate: settings.mutation_rate,
        eliteCount: settings.elite_count,
        allowed: allowedGenes(settings.allowed),
      });
      const tables = buildTables(leadSheet);
      const nBars = tables.nBars;
      send("started", { nBars, tables: { applicable: applicableCriteria(tables) } });

      /** @type {import("./core/evolution.js").EvolutionResult} */
      const result = /** @type {any} */ ({});
      const rng = createRandom(settings.seed);
      const evolution = evolve(rng, tables, nBars, params, settings.weights, result);
      const startedAt = now();
      /** @type {import("./core/evolution.js").GenerationStats[]} */
      let unsent = [];
      let lastProgressAt = -Infinity;
      let generationCount = 0;
      const sendProgress = () => {
        const bestPlan = result.bestPlan.slice();
        send("progress", { generations: unsent, bestPlan, bestFitness: result.bestFitness });
        unsent = [];
      };
      /** Time at which the next generation is due at the watch pace. */
      const dueTime = () => {
        run.watchOrigin ??= now() - generationCount * MS_PER_WATCHED_GENERATION;
        return run.watchOrigin + generationCount * MS_PER_WATCHED_GENERATION;
      };

      try {
        let finished = false;
        while (!finished) {
          const sliceStart = now();
          for (;;) {
            if (run.pace === "watch" && now() < dueTime()) break;
            const step = evolution.next();
            if (step.done) {
              finished = true;
              break;
            }
            unsent.push(step.value);
            generationCount++;
            if (now() - sliceStart >= SLICE_MS) break;
          }
          if (finished) break;
          if (unsent.length > 0 && now() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
            sendProgress();
            lastProgressAt = now();
          }
          await sleep(run.pace === "watch" ? Math.max(0, dueTime() - now()) : 0);
          if (run.cancelled) return;
          if (run.stopRequested) break;
        }
      } finally {
        // Ends the generator if the run was stopped or cancelled; evolve then marks it "stopped".
        evolution.return(result);
      }

      if (unsent.length > 0) sendProgress();
      const scores = criterionScores(tables, result.bestPlan, nBars);
      send("done", {
        bestPlan: result.bestPlan.slice(),
        initialBestPlan: result.initialBestPlan.slice(),
        bestFitness: result.bestFitness,
        scores: Object.fromEntries(
          Object.entries(scores).map(([name, [score]]) => [
            name,
            Number.isNaN(score) ? null : score, // JSON has no NaN: null is "not applicable"
          ]),
        ),
        stopReason: result.stopReason,
        generations: result.log.length - 1,
        durationMs: now() - startedAt,
      });
    } catch (error) {
      send("error", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (current === run) current = null;
    }
  }

  return {
    handle(message) {
      if (message.type === "run") {
        if (current) current.cancelled = true;
        /** @type {RunState} */
        const run = {
          runId: message.runId,
          pace: message.pace === "watch" ? "watch" : "full",
          watchOrigin: null,
          stopRequested: false,
          cancelled: false,
        };
        current = run;
        return execute(run, message.leadSheet, message.settings);
      }
      // stop and pace act on the current run only; a late message about an older run is ignored
      if (current === null || message.runId !== current.runId) return undefined;
      if (message.type === "stop") {
        current.stopRequested = true;
      } else if (message.type === "pace") {
        current.pace = message.pace === "watch" ? "watch" : "full";
        current.watchOrigin = null; // the watch pace restarts from the current generation
      }
      return undefined;
    },
  };
}

/**
 * Which plan-independent criteria can score this tune, as the fitness decides (NaN otherwise):
 * contrast needs both chorus and verse bars, coherence two adjacent bars in one phrase, and
 * bass_smoothness at least one possible leap of the bass line (a bar line, or a bass texture
 * that leaps inside a bar).
 *
 * @param {import("./core/tables.js").ScoreTables} tables
 * @returns {{contrast: boolean, coherence: boolean, bass_smoothness: boolean}}
 */
function applicableCriteria(tables) {
  const { nBars, isChorus, phrase, bassInnerLeaps } = tables;
  let chorusBars = 0;
  let phrasePairs = 0;
  for (let b = 0; b < nBars; b++) {
    if (isChorus[b]) chorusBars++;
    if (b + 1 < nBars && phrase[b] === phrase[b + 1]) phrasePairs++;
  }
  return {
    contrast: chorusBars > 0 && chorusBars < nBars,
    coherence: phrasePairs > 0,
    bass_smoothness: nBars > 1 || bassInnerLeaps.some((leaps) => leaps > 0),
  };
}
