// @ts-check
// Tests for core/meter.js: a meter tells how long a bar is, where its beats fall and which beats
// are strong. They port tests/test_meter.py and check the examples of the module's doc comments.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FOUR_FOUR,
  SUPPORTED_METERS,
  barStarts,
  beatOnsets,
  groups,
  makeMeter,
  meterText,
  parseMeter,
  strongOnsets,
  totalBeats,
} from "../src/core/meter.js";

const SUPPORTED_TEXT = "2/2, 2/4, 3/4, 4/4, 6/8, 9/8, 12/8, 5/4, 7/8";

/** @type {[string, number, number[], number[], number][]} */
const METER_CASES = [
  ["2/2", 4.0, [2.0, 2.0], [0], 16],
  ["2/4", 2.0, [1.0, 1.0], [0], 8],
  ["3/4", 3.0, [1.0, 1.0, 1.0], [0], 12],
  ["4/4", 4.0, [1.0, 1.0, 1.0, 1.0], [0, 2], 16],
  ["6/8", 3.0, [1.5, 1.5], [0], 12],
  ["9/8", 4.5, [1.5, 1.5, 1.5], [0], 18],
  ["12/8", 6.0, [1.5, 1.5, 1.5, 1.5], [0, 2], 24],
  ["5/4", 5.0, [1.0, 1.0, 1.0, 1.0, 1.0], [0, 3], 20],
  ["7/8", 3.5, [1.0, 1.0, 1.5], [0], 14],
];

for (const [text, barBeats, beats, strong, steps] of METER_CASES) {
  test(`${text} has its bar length, beats and strong beats`, () => {
    const meter = parseMeter(text);

    assert.deepEqual(
      [meter.barBeats, [...meter.beats], [...meter.strong], meter.steps],
      [barBeats, beats, strong, steps],
    );
    assert.equal(
      meter.beats.reduce((sum, beat) => sum + beat, 0),
      meter.barBeats,
    );
    assert.equal(String(meter), text);
    assert.equal(meterText(meter), text);
  });
}

test("the supported meters are the nine of the spec", () => {
  assert.deepEqual(SUPPORTED_METERS.map(String), [
    "2/2",
    "2/4",
    "3/4",
    "4/4",
    "6/8",
    "9/8",
    "12/8",
    "5/4",
    "7/8",
  ]);
});

test("a meter and its lists of beats cannot be changed", () => {
  assert.ok(Object.isFrozen(SUPPORTED_METERS));
  for (const meter of SUPPORTED_METERS) {
    assert.ok(Object.isFrozen(meter));
    assert.ok(Object.isFrozen(meter.beats));
    assert.ok(Object.isFrozen(meter.strong));
  }
});

test("the same meter is always the same object, so meters compare with ===", () => {
  assert.equal(makeMeter(3, 4), makeMeter(3, 4));
  assert.equal(parseMeter("6/8"), makeMeter(6, 8));
  assert.equal(SUPPORTED_METERS[2], makeMeter(3, 4));
});

test("common time is four four and cut time is two two", () => {
  assert.equal(parseMeter("C"), FOUR_FOUR);
  assert.equal(FOUR_FOUR, makeMeter(4, 4));
  assert.equal(parseMeter("C|"), makeMeter(2, 2));
});

test("spaces around the meter are ignored", () => {
  assert.equal(parseMeter(" 3/4 "), makeMeter(3, 4));
});

for (const text of ["11/16", "3/8", "4", "none"]) {
  test(`the unsupported meter "${text}" is refused, naming the meter and the bar`, () => {
    assert.throws(() => parseMeter(text, 5), {
      name: "Error",
      message: `bar 5: the meter ${text} is not supported; supported meters: ${SUPPORTED_TEXT}`,
    });
  });
}

test("without a bar number the message names only the meter", () => {
  assert.throws(() => parseMeter("11/16"), {
    message: `the meter 11/16 is not supported; supported meters: ${SUPPORTED_TEXT}`,
  });
});

test("constructing an unsupported meter directly is refused", () => {
  assert.throws(() => makeMeter(11, 16), /^Error: the meter 11\/16 is not supported/);
});

test("beat and strong onsets are running sums of the beats", () => {
  assert.deepEqual(beatOnsets(FOUR_FOUR), [0.0, 1.0, 2.0, 3.0]);
  assert.deepEqual(strongOnsets(FOUR_FOUR), [0.0, 2.0]);
  const seven = parseMeter("7/8");
  assert.deepEqual(beatOnsets(seven), [0.0, 1.0, 2.0]);
  assert.deepEqual(strongOnsets(seven), [0.0]);
  assert.deepEqual(strongOnsets(parseMeter("12/8")), [0.0, 3.0]);
  assert.deepEqual(strongOnsets(parseMeter("5/4")), [0.0, 3.0]);
});

test("groups run from one strong beat to the next", () => {
  assert.deepEqual(groups(FOUR_FOUR), [
    [0.0, 2.0],
    [2.0, 2.0],
  ]);
  assert.deepEqual(groups(parseMeter("5/4")), [
    [0.0, 3.0],
    [3.0, 2.0],
  ]);
  assert.deepEqual(groups(parseMeter("3/4")), [[0.0, 3.0]]);
  assert.deepEqual(groups(parseMeter("12/8")), [
    [0.0, 3.0],
    [3.0, 3.0],
  ]);
});

test("bar starts add up the lengths of the bars before", () => {
  const bars = [{ meter: FOUR_FOUR }, { meter: parseMeter("2/4") }, { meter: parseMeter("3/4") }];

  assert.deepEqual(barStarts(bars), [0.0, 4.0, 6.0]);
  assert.equal(totalBeats(bars), 9.0);
});

test("a piece of two 6/8 bars lasts six quarter notes", () => {
  assert.equal(totalBeats([{ meter: parseMeter("6/8") }, { meter: parseMeter("6/8") }]), 6.0);
});

test("a piece without bars has no bar starts and lasts zero beats", () => {
  assert.deepEqual(barStarts([]), []);
  assert.equal(totalBeats([]), 0);
});
