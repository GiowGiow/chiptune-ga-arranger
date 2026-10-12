// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { chordLabels } from "../src/ui/plan-grid.js";

/**
 * @param {string} label part label
 * @param {...string} symbols chord symbols of the bar
 */
const bar = (label, ...symbols) => ({ label, chords: symbols.map((symbol) => ({ symbol })) });

test("the chord row names a bar's chords where they change, and leaves a repeated bar blank", () => {
  const bars = [bar("A", "D"), bar("A", "D"), bar("A", "F#m"), bar("A", "G", "Gm"), bar("A", "G", "Gm")];
  assert.deepEqual(chordLabels(bars).map((cell) => cell.text), ["D", "", "F#m", "G Gm", ""]);
  assert.deepEqual(chordLabels(bars).map((cell) => cell.full), ["D", "D", "F#m", "G Gm", "G Gm"]);
});

test("the first bar of a part names its chords even when they repeat the bar before", () => {
  const bars = [bar("A", "Em"), bar("Chorus", "Em"), bar("Chorus", "Em")];
  assert.deepEqual(chordLabels(bars).map((cell) => cell.text), ["Em", "Em", ""]);
});
