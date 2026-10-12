// @ts-check
// Tests for core/textures.js, the realizers that turn one gene value into the notes of one
// channel in one bar. They port the doctests of src/arrangement/textures.py and compare every
// gene value of every bar of two songs with the notes the Python realizers wrote to
// fixtures/realizations/ (src/export/fixtures.py).

import { test } from "node:test";
import assert from "node:assert/strict";

import { NO_PATTERNS, P2_TEXTURES, TR_TEXTURES } from "../src/core/genome.js";
import { leadSheetFromJson } from "../src/core/leadsheet.js";
import {
  CHANNELS,
  DRUM_PRIORITY,
  DRUM_VELOCITY,
  HIHAT,
  KICK,
  P2_ROOT_LOW,
  PITCH_RANGES,
  SNARE,
  TR_ROOT_LOW,
  VELOCITY_ECHO,
  VELOCITY_P1,
  VELOCITY_P2,
  VELOCITY_TR,
  realizeNo,
  realizeP1,
  realizeP2,
  realizeTr,
} from "../src/core/textures.js";
import { readFixture } from "./helpers.js";

/**
 * Notes as the fixtures store them: [pitch, onset, duration, velocity].
 * @param {import("../src/core/textures.js").ChannelNote[]} notes
 */
function asRows(notes) {
  return notes.map((note) => [note.pitch, note.onset, note.duration, note.velocity]);
}

/** @type {import("../src/core/leadsheet.js").ChordSegment} */
const C_WHOLE_BAR = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 };
/** @type {import("../src/core/leadsheet.js").ChordSegment} */
const C_FIRST_HALF = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 2 };
/** @type {import("../src/core/leadsheet.js").ChordSegment} */
const G_SECOND_HALF = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 2, duration: 2 };
/** @type {import("../src/core/leadsheet.js").ChordSegment} */
const G_WHOLE_BAR = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 0, duration: 4 };

/**
 * A verse bar with the given melody and chords.
 * @param {import("../src/core/leadsheet.js").MelodyNote[]} melody
 * @param {import("../src/core/leadsheet.js").ChordSegment[]} chords
 * @returns {import("../src/core/leadsheet.js").Bar}
 */
function makeBar(melody, chords, index = 0) {
  return { index, melody, chords, label: "A", role: "verse", phrase: 0, phraseEnd: false };
}

// Chip constants (src/arrangement/model.py)

test("the channels are P1, P2, TR and NO, in that order", () => {
  assert.deepEqual(CHANNELS, ["P1", "P2", "TR", "NO"]);
});

test("pulse channels play MIDI 33-108 and the triangle 21-108", () => {
  assert.deepEqual(PITCH_RANGES, { P1: [33, 108], P2: [33, 108], TR: [21, 108] });
  assert.ok(Object.isFrozen(PITCH_RANGES) && Object.isFrozen(PITCH_RANGES.P1));
});

test("P2 places chord roots in 48-59 and TR in 28-39", () => {
  assert.equal(P2_ROOT_LOW, 48);
  assert.equal(TR_ROOT_LOW, 28);
});

test("velocities are 100 for the melody, 80 for harmony, 60 for the echo and 90 for the bass", () => {
  assert.deepEqual([VELOCITY_P1, VELOCITY_P2, VELOCITY_ECHO, VELOCITY_TR], [100, 80, 60, 90]);
});

test("drums are General MIDI kick 36, snare 38 and hi-hat 42, and the kick wins a shared step", () => {
  assert.deepEqual([KICK, SNARE, HIHAT], [36, 38, 42]);
  assert.deepEqual(DRUM_VELOCITY, { 36: 100, 38: 90, 42: 60 });
  assert.deepEqual(DRUM_PRIORITY, [KICK, SNARE, HIHAT]);
});

// Doctests of src/arrangement/textures.py

test("P1 one octave up folds 112 back to 100 and keeps 60 + 12", () => {
  const melody = [
    { pitch: 60, onset: 0, duration: 2 },
    { pitch: 100, onset: 2, duration: 2 },
  ];
  const bar = makeBar(melody, [C_WHOLE_BAR]);
  assert.deepEqual(
    realizeP1(bar, 1).map((note) => note.pitch),
    [72, 100],
  );
});

test("P2 hold on a C/G bar plays 48 at beat 0 and 55 at beat 2", () => {
  const bar = makeBar([], [C_FIRST_HALF, G_SECOND_HALF]);
  assert.deepEqual(
    realizeP2(bar, P2_TEXTURES.indexOf("hold")).map((note) => [note.pitch, note.onset]),
    [
      [48, 0],
      [55, 2],
    ],
  );
});

test("P2 arp16 on C starts 48, 52, 55, 48", () => {
  const bar = makeBar([], [C_FIRST_HALF, G_SECOND_HALF]);
  const pitches = realizeP2(bar, P2_TEXTURES.indexOf("arp16")).map((note) => note.pitch);
  assert.deepEqual(pitches.slice(0, 4), [48, 52, 55, 48]);
});

test("TR walking from C to G plays 36, 40, 43 and the approach 30", () => {
  const cBar = makeBar([], [C_WHOLE_BAR], 0);
  const gBar = makeBar([], [G_WHOLE_BAR], 1);
  assert.deepEqual(
    realizeTr(cBar, TR_TEXTURES.indexOf("walking"), gBar).map((note) => note.pitch),
    [36, 40, 43, 30],
  );
});

test("NO half_time plays kick, hi-hat, snare, hi-hat on the four beats", () => {
  assert.deepEqual(
    realizeNo(NO_PATTERNS.indexOf("half_time")).map((note) => [note.onset, note.pitch]),
    [
      [0, 36],
      [1, 42],
      [2, 38],
      [3, 42],
    ],
  );
});

// Further behavior

test("P2 echo replays the melody an eighth later, softer, and drops the echo past the bar end", () => {
  const melody = [
    { pitch: 72, onset: 0, duration: 3.5 },
    { pitch: 74, onset: 3.5, duration: 0.5 },
  ];
  const notes = realizeP2(makeBar(melody, [C_WHOLE_BAR]), P2_TEXTURES.indexOf("echo"));
  assert.deepEqual(asRows(notes), [[72, 0.5, 3.5, VELOCITY_ECHO]]);
});

test("P2 third walks down from a minor third below the melody to the first chord tone", () => {
  // 72 - 3 = 69 (A) is not in C major; 68, then 67 (G) is.
  const notes = realizeP2(makeBar([{ pitch: 72, onset: 0, duration: 4 }], [C_WHOLE_BAR]), 4);
  assert.deepEqual(asRows(notes), [[67, 0, 4, VELOCITY_P2]]);
});

test("an arpeggio adds no tiny note when float noise makes a chord a hair longer", () => {
  const duration = 1.1 - 0.35; // 0.7500000000000001: three sixteenths plus float noise
  const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration };
  const g = { symbol: "G", root: 7, tones: [7, 11, 2], onset: duration, duration: 4 - duration };
  const notes = realizeP2(makeBar([], [c, g]), P2_TEXTURES.indexOf("arp16"));
  assert.deepEqual(
    notes.slice(0, 4).map((note) => note.pitch),
    [48, 52, 55, 55],
  );
});

test("an arpeggio shortens its last note to end with the chord", () => {
  const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 0.3 };
  const g = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 0.3, duration: 3.7 };
  const notes = realizeP2(makeBar([], [c, g]), P2_TEXTURES.indexOf("arp16"));
  assert.deepEqual(asRows(notes.slice(0, 2)).map(([pitch, onset]) => [pitch, onset]), [
    [48, 0],
    [52, 0.25],
  ]);
  assert.ok(Math.abs(notes[1].duration - 0.05) < 1e-12);
});

test("an invalid gene value is refused", () => {
  const bar = makeBar([], [C_WHOLE_BAR]);
  assert.throws(() => realizeP1(bar, 3), RangeError);
  assert.throws(() => realizeP2(bar, 5), RangeError);
  assert.throws(() => realizeTr(bar, 4, null), RangeError);
  assert.throws(() => realizeNo(5), RangeError);
});

// Parity with the Python realizers

for (const songId of ["korobeiniki", "mulher_de_fases"]) {
  const leadSheet = leadSheetFromJson(readFixture(`leadsheets/${songId}.json`));
  const realizations = readFixture(`realizations/${songId}.json`);

  test(`every gene value of every bar of ${songId} realizes the Python notes`, () => {
    assert.equal(realizations.bars.length, leadSheet.bars.length);
    leadSheet.bars.forEach((bar, b) => {
      const nextBar = b + 1 < leadSheet.bars.length ? leadSheet.bars[b + 1] : null;
      const expected = realizations.bars[b];
      expected.p1.forEach((/** @type {unknown} */ notes, /** @type {number} */ gene) => {
        assert.deepEqual(asRows(realizeP1(bar, gene)), notes, `bar ${b} P1 gene ${gene}`);
      });
      expected.p2.forEach((/** @type {unknown} */ notes, /** @type {number} */ gene) => {
        assert.deepEqual(asRows(realizeP2(bar, gene)), notes, `bar ${b} P2 gene ${gene}`);
      });
      expected.tr.forEach((/** @type {unknown} */ notes, /** @type {number} */ gene) => {
        assert.deepEqual(asRows(realizeTr(bar, gene, nextBar)), notes, `bar ${b} TR gene ${gene}`);
      });
    });
  });

  test(`every drum pattern of ${songId} realizes the Python notes`, () => {
    realizations.no.forEach((/** @type {unknown} */ notes, /** @type {number} */ gene) => {
      assert.deepEqual(asRows(realizeNo(gene)), notes, `NO gene ${gene}`);
    });
  });
}
