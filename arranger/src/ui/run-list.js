// @ts-check
/**
 * Run list: the last runs of a visit, to compare what the settings changed (spec 002, FR-019).
 *
 * The GA's behavior is the subject of the project: change the seed, the fidelity weight or the
 * stopping window, arrange again, and compare. The list keeps the last 5 runs, newest first, and
 * describes each one by its seed, the settings that differ from the defaults (the orange chips
 * of the listening page) and its best fitness. These functions are pure; `runs.js` draws them.
 */

import { changedSettings } from "./settings-form.js";

/** How many runs a visit keeps. */
export const RUN_LIMIT = 5;

/** @typedef {{id: string, settings: import("../core/settings.js").Settings, bestFitness: number}} RunEntry */

/**
 * Put a run at the head of the list, drop an older run with the same id and keep RUN_LIMIT runs.
 *
 * @template {RunEntry} T
 * @param {T[]} runs
 * @param {T} run
 * @returns {T[]} a new list
 * @example
 * addRun([], {id: "a-s1-00000000", settings, bestFitness: 0.9}).length // 1
 */
export function addRun(runs, run) {
  return [run, ...runs.filter((entry) => entry.id !== run.id)].slice(0, RUN_LIMIT);
}

/**
 * What the run list shows for one run.
 *
 * @param {RunEntry} run
 * @param {import("../core/settings.js").Settings} defaults
 * @returns {{id: string, seed: number, changed: Array<{key: string, value: string}>, fitness: string}}
 * @example
 * describeRun({id: "x", settings: {...defaults, seed: 3}, bestFitness: 0.9}, defaults).changed // []
 */
export function describeRun(run, defaults) {
  const changed = changedSettings(run.settings, defaults).map((key) => ({
    key,
    value: JSON.stringify(key.split(".").reduce((node, part) => node?.[part], /** @type {any} */ (run.settings))),
  }));
  return { id: run.id, seed: run.settings.seed, changed, fitness: run.bestFitness.toFixed(4) };
}
