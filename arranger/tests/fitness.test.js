// @ts-check
// Tests for core/fitness.js, the weighted mean of seven music-theory criteria. They port the
// one-bar doctests of src/ga/fitness.py and check SC-010: for the best plan of every committed
// sample, and for the fixed plan of every meter test tune, the criterion scores and the fitness
// match the Python values to 12 decimal places, with NaN (null in the fixtures) where a criterion
// does not apply.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { CRITERIA, criterionScores, fitness } from "../src/core/fitness.js";
import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { buildTables } from "../src/core/tables.js";
import { assertClose, fixturesDir, readFixture } from "./helpers.js";

/**
 * The hand-written tables of the Python doctest: one bar of a busy melody with a single chord.
 * Hold on P2 suits the melody, but an arpeggio suits the NES idiom.
 * @returns {import("../src/core/tables.js").ScoreTables}
 */
function oneBarTables() {
  return {
    nBars: 1,
    actP1: Float64Array.of(1, 1, 1),
    actP2: Float64Array.of(0, 1, 1, 0.5, 0.5),
    actTr: new Float64Array(4),
    actNo: new Float64Array(5),
    regBoth: new Int32Array(15),
    regOk: new Int32Array(15),
    bassInner: new Float64Array(4).fill(Number.NaN),
    bassInnerLeaps: new Int32Array(4),
    bassAcross: new Float64Array(0),
    singleChord: Uint8Array.of(1),
    phraseEnd: Uint8Array.of(0),
    phrase: Int32Array.of(0),
    isChorus: Uint8Array.of(0),
    shape: {
      actP1: [1, 3],
      actP2: [1, 5],
      actTr: [1, 4],
      actNo: [1, 5],
      regBoth: [1, 3, 5],
      regOk: [1, 3, 5],
      bassInner: [1, 4],
      bassInnerLeaps: [1, 4],
      bassAcross: [0, 4, 4],
      singleChord: [1],
      phraseEnd: [1],
      phrase: [1],
      isChorus: [1],
    },
  };
}

const EQUAL_WEIGHTS = Object.fromEntries(CRITERIA.map((name) => [name, 1]));

test("the seven criteria come in the Python order", () => {
  assert.deepEqual(CRITERIA, [
    "complementarity",
    "register",
    "coherence",
    "contrast",
    "bass_smoothness",
    "idiom",
    "fidelity",
  ]);
});

test("on one busy bar, hold wins complementarity, arp16 wins idiom, and coherence does not apply", () => {
  const hold = [0, 0, 0, 0];
  const arp16 = [1, 0, 0, 0];
  const scores = criterionScores(oneBarTables(), Uint8Array.of(...hold, ...arp16), 1);
  assert.deepEqual([...scores.complementarity], [1, 0]);
  assert.deepEqual([...scores.idiom], [0.5, 1]);
  assert.deepEqual([...scores.coherence], [Number.NaN, Number.NaN]);
  assert.ok(Object.values(scores).every((values) => values instanceof Float64Array));
});

test("on one bar, fitness averages only the four criteria that apply: 0.875 for hold, 0.5 for arp16 up an octave", () => {
  const hold = [0, 0, 0, 0];
  const arp16OctaveUp = [1, 0, 0, 1];
  const values = fitness(oneBarTables(), Uint8Array.of(...hold, ...arp16OctaveUp), 1, EQUAL_WEIGHTS);
  assert.ok(values instanceof Float64Array);
  assertClose([...values], [0.875, 0.5], 12);
});

test("a criterion missing from the weights counts with weight 0", () => {
  const values = fitness(oneBarTables(), Uint8Array.of(1, 0, 0, 0), 1, { idiom: 1 });
  assert.deepEqual([...values], [1]);
});

test("fitness is 0 when no weighted criterion applies", () => {
  const values = fitness(oneBarTables(), Uint8Array.of(0, 0, 0, 0), 1, { coherence: 1, contrast: 2 });
  assert.deepEqual([...values], [0]);
});

test("fitness writes into the out array when one is given", () => {
  const out = new Float64Array(2);
  const result = fitness(oneBarTables(), Uint8Array.of(0, 0, 0, 0, 1, 0, 0, 1), 1, EQUAL_WEIGHTS, out);
  assert.equal(result, out);
  assertClose([...out], [0.875, 0.5], 12);
});

test("a population that is not whole plans is refused", () => {
  assert.throws(() => fitness(oneBarTables(), Uint8Array.of(0, 0, 0), 1, EQUAL_WEIGHTS), RangeError);
  assert.throws(() => criterionScores(oneBarTables(), new Uint8Array(8), 3), RangeError);
});

const planFiles = readdirSync(join(fixturesDir, "plans")).filter((name) => name.endsWith(".json"));

test("there are 17 plan fixtures: 10 samples and the fixed plans of 7 meter tunes", () => {
  assert.equal(planFiles.length, 17);
  assert.equal(planFiles.filter((name) => name.startsWith("meters-")).length, 7);
});

test("contrast measures the drums of each bar with that bar's own row of drum activity", () => {
  // The same pattern is half as busy in the verse bar as in the chorus bar (as a bar in another
  // meter can be), so the chorus is denser by (1 - 0.5) / 3 and contrast is 0.5 + 1/6.
  const tables = {
    ...oneBarTables(),
    nBars: 2,
    actP1: new Float64Array(6),
    actP2: new Float64Array(10),
    actTr: new Float64Array(8),
    actNo: Float64Array.of(0, 0.5, 0.5, 0.5, 0.5, 0, 1, 1, 1, 1),
    regBoth: new Int32Array(30),
    regOk: new Int32Array(30),
    bassInner: new Float64Array(8).fill(Number.NaN),
    bassInnerLeaps: new Int32Array(8),
    bassAcross: new Float64Array(16).fill(1),
    singleChord: new Uint8Array(2),
    phraseEnd: new Uint8Array(2),
    phrase: Int32Array.of(0, 1),
    isChorus: Uint8Array.of(0, 1),
  };
  const halfTime = [0, 0, 1, 0];
  const scores = criterionScores(tables, Uint8Array.of(...halfTime, ...halfTime), 2);
  assertClose(scores.contrast[0], 0.5 + 1 / 6, 12);
});

for (const file of planFiles) {
  test(`SC-010: the plan of ${file.replace(".json", "")} gets the Python scores and fitness`, () => {
    const sample = readFixture(`plans/${file}`);
    const leadSheet = leadSheetFromJson(readFixture(`leadsheets/${sample.leadsheet}.json`));
    const tables = buildTables(leadSheet);
    const nBars = leadSheet.bars.length;
    assert.equal(sample.best_plan.length, nBars);
    const population = Uint8Array.from(sample.best_plan.flat());

    const scores = criterionScores(tables, population, nBars);
    const firstPlanScores = Object.fromEntries(CRITERIA.map((name) => [name, scores[name][0]]));
    assertClose(firstPlanScores, sample.scores, 12);
    assertClose(fitness(tables, population, nBars, sample.settings.weights)[0], sample.fitness, 12);
  });
}

test("every plan of a population is scored on its own", () => {
  const sample = readFixture("plans/korobeiniki-s1.json");
  const tables = buildTables(leadSheetFromJson(readFixture("leadsheets/korobeiniki.json")));
  const best = sample.best_plan.flat();
  const allHold = best.map((/** @type {number} */ gene, /** @type {number} */ index) => (index % 4 === 0 ? 0 : gene));
  const population = Uint8Array.from([...allHold, ...best, ...allHold]);
  const values = fitness(tables, population, 32, sample.settings.weights);
  const alone = fitness(tables, Uint8Array.from(allHold), 32, sample.settings.weights)[0];
  assertClose([...values], [alone, sample.fitness, alone], 12);
});
