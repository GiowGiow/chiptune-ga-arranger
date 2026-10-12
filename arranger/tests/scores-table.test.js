// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { CRITERIA } from "../src/core/fitness.js";
import { describeScores } from "../src/ui/scores-table.js";

const weights = {
  complementarity: 1, register: 1, coherence: 1, contrast: 1, bass_smoothness: 1, idiom: 1, fidelity: 0.5,
};

test("each criterion shows its weight, its score with two decimals and a bar from 0 to 1", () => {
  const scores = {
    complementarity: 0.7071, register: 0.976, coherence: 0.958, contrast: 0.979,
    bass_smoothness: 0.931, idiom: 0.868, fidelity: 1,
  };
  const table = describeScores(scores, 0.91062, weights);
  assert.equal(table.rows.length, CRITERIA.length);
  assert.deepEqual(table.rows[0], {
    name: "complementarity", label: "Complementarity", weight: "1", score: "0.71", bar: 0.7071,
  });
  assert.deepEqual(table.rows.at(-1), { name: "fidelity", label: "Fidelity", weight: "0.5", score: "1.00", bar: 1 });
  assert.equal(table.fitness, "0.91");
});

test("a criterion that does not apply to the song has no score and no bar", () => {
  const scores = {
    complementarity: 0.7, register: 0.9, coherence: 0.9, contrast: null,
    bass_smoothness: 0.9, idiom: 0.9, fidelity: Number.NaN,
  };
  const rows = describeScores(scores, 0.85, weights).rows;
  assert.deepEqual(rows[3], { name: "contrast", label: "Contrast", weight: "1", score: "not applicable", bar: null });
  assert.equal(rows[6].score, "not applicable");
});
