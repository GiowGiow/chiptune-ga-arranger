// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { defaultSettings } from "../src/core/settings.js";
import { RUN_LIMIT, addRun, describeRun } from "../src/ui/run-list.js";
import { repoRoot } from "./helpers.js";

const defaults = defaultSettings(
  JSON.parse(readFileSync(join(repoRoot, "configs/default.json"), "utf8")),
);

/** @param {number} index */
function run(index) {
  return { id: `song-s${index}-0000000${index}`, settings: { ...defaults, seed: index }, bestFitness: 0.8 + index / 100 };
}

test("the run list keeps the last 5 runs, newest first", () => {
  let runs = [];
  for (let index = 1; index <= 7; index += 1) runs = addRun(runs, run(index));
  assert.equal(RUN_LIMIT, 5);
  assert.deepEqual(runs.map((entry) => entry.settings.seed), [7, 6, 5, 4, 3]);
});

test("a run that repeats an id replaces the older entry", () => {
  let runs = addRun([], run(1));
  runs = addRun(runs, run(2));
  runs = addRun(runs, { ...run(1), bestFitness: 0.5 });
  assert.deepEqual(runs.map((entry) => entry.id), [run(1).id, run(2).id]);
  assert.equal(runs[0].bestFitness, 0.5);
});

test("a run is described by its seed, its changed settings (named as in the form) and its best fitness", () => {
  const settings = structuredClone(defaults);
  settings.seed = 3;
  settings.weights.fidelity = 0;
  const described = describeRun({ id: "x", settings, bestFitness: 0.90312 }, defaults);
  assert.deepEqual(described, {
    id: "x",
    seed: 3,
    changed: [{ key: "weights.fidelity", label: "Fidelity weight", value: "0" }],
    fitness: "0.9031",
  });
});
