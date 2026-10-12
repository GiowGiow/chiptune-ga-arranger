// @ts-check
// Tests for core/textures.js, the realizers that turn one gene value into the notes of one
// channel in one bar. They port the doctests and the meter cases of src/arrangement/textures.py
// (tests/test_textures.py), and compare every gene value of every bar of every song in
// fixtures/realizations/ (two 4/4 songs and the meter test tunes) with the notes the Python
// realizers wrote (src/export/fixtures.py).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { NO_PATTERNS, P2_TEXTURES, TR_TEXTURES } from "../src/core/genome.js";
import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { FOUR_FOUR, parseMeter } from "../src/core/meter.js";
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
  drumSteps,
  realizeNo,
  realizeP1,
  realizeP2,
  realizeTr,
} from "../src/core/textures.js";
import { fixturesDir, readFixture } from "./helpers.js";

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
 * A verse bar with the given melody and chords, in 4/4 unless a meter is given.
 * @param {import("../src/core/leadsheet.js").MelodyNote[]} melody
 * @param {import("../src/core/leadsheet.js").ChordSegment[]} chords
 * @param {number} [index]
 * @param {import("../src/core/meter.js").Meter} [meter]
 * @returns {import("../src/core/leadsheet.js").Bar}
 */
function makeBar(melody, chords, index = 0, meter = FOUR_FOUR) {
  return { index, melody, chords, label: "A", role: "verse", phrase: 0, phraseEnd: false, meter };
}

/**
 * A verse bar in `meter` with one chord over the whole bar, and no melody.
 * @param {string} meterText
 * @param {string} symbol
 * @param {number} root
 * @param {number[]} tones
 */
function wholeBarChord(meterText, symbol, root, tones) {
  const meter = parseMeter(meterText);
  return makeBar([], [{ symbol, root, tones, onset: 0, duration: meter.barBeats }], 0, meter);
}

/**
 * [onset, drum] of every noise hit, the way a drummer reads a pattern.
 * @param {import("../src/core/textures.js").ChannelNote[]} notes
 */
function hits(notes) {
  return notes.map((note) => [note.onset, note.pitch]);
}

/**
 * Onsets of the hits of one drum.
 * @param {import("../src/core/textures.js").ChannelNote[]} notes
 * @param {number} drum
 */
function onsetsOf(notes, drum) {
  return notes.filter((note) => note.pitch === drum).map((note) => note.onset);
}

/**
 * The steps of each drum of a pattern, sorted, as the Python doctest prints them.
 * @param {Record<number, Set<number>>} steps
 */
function sortedSteps(steps) {
  return Object.fromEntries(Object.entries(steps).map(([drum, set]) => [drum, [...set].sort((a, b) => a - b)]));
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

test("the 4/4 eighth beat kicks on steps 0 and 8, snares on 4 and 12, hi-hats every eighth", () => {
  assert.deepEqual(sortedSteps(drumSteps("eighth_beat")), {
    36: [0, 8],
    38: [4, 12],
    42: [0, 2, 4, 6, 8, 10, 12, 14],
  });
});

test("the 6/8 eighth beat kicks on eighth 1 and snares on eighth 4", () => {
  assert.deepEqual(sortedSteps(drumSteps("eighth_beat", parseMeter("6/8"))), {
    36: [0],
    38: [6],
    42: [0, 2, 4, 6, 8, 10],
  });
});

test("the pattern none has no drum steps", () => {
  assert.deepEqual(drumSteps("none", parseMeter("3/4")), {});
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

// Bars in other meters (tests/test_textures.py, spec 003)

const WALTZ = parseMeter("3/4");
const C_WALTZ_BAR = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 3 };

test("in 3/4 root_fifth plays oom-pah-pah: root, fifth, fifth", () => {
  const notes = realizeTr(makeBar([], [C_WALTZ_BAR], 0, WALTZ), TR_TEXTURES.indexOf("root_fifth"), null);
  assert.deepEqual(
    notes.map((n) => [n.pitch, n.onset, n.duration]),
    [
      [36, 0, 1],
      [43, 1, 1],
      [43, 2, 1],
    ],
  );
});

test("in 3/4 the walking bass plays root, third and the approach", () => {
  const gBar = wholeBarChord("3/4", "G", 7, [7, 11, 2]);
  const notes = realizeTr(makeBar([], [C_WALTZ_BAR], 0, WALTZ), TR_TEXTURES.indexOf("walking"), gBar);
  assert.deepEqual(
    notes.map((n) => [n.pitch, n.onset, n.duration]),
    [
      [36, 0, 1],
      [40, 1, 1],
      [30, 2, 1],
    ],
  );
});

test("in 3/4 the octave pump plays six eighths", () => {
  const notes = realizeTr(makeBar([], [C_WALTZ_BAR], 0, WALTZ), TR_TEXTURES.indexOf("octave_pump"), null);
  assert.deepEqual(
    notes.map((n) => [n.pitch, n.onset]),
    [
      [36, 0],
      [48, 0.5],
      [36, 1],
      [48, 1.5],
      [36, 2],
      [48, 2.5],
    ],
  );
});

test("in 3/4 the eighth beat is a waltz: kick on 1, snare on 2 and 3", () => {
  assert.deepEqual(hits(realizeNo(NO_PATTERNS.indexOf("eighth_beat"), WALTZ)), [
    [0, KICK],
    [0.5, HIHAT],
    [1, SNARE],
    [1.5, HIHAT],
    [2, SNARE],
    [2.5, HIHAT],
  ]);
});

test("in 3/4 the fill rolls the snare on the last beat", () => {
  assert.deepEqual(hits(realizeNo(NO_PATTERNS.indexOf("fill"), WALTZ)), [
    [0, KICK],
    [0.5, HIHAT],
    [1, SNARE],
    [1.5, HIHAT],
    [2, SNARE],
    [2.25, SNARE],
    [2.5, SNARE],
    [2.75, SNARE],
  ]);
});

test("in 3/4 half time has no snare, and the sixteenth beat adds a pickup kick", () => {
  const half = realizeNo(NO_PATTERNS.indexOf("half_time"), WALTZ);
  const sixteenth = realizeNo(NO_PATTERNS.indexOf("sixteenth_beat"), WALTZ);
  assert.deepEqual(hits(half), [
    [0, KICK],
    [1, HIHAT],
    [2, HIHAT],
  ]);
  assert.deepEqual(onsetsOf(sixteenth, KICK), [0, 0.75]);
  assert.deepEqual(onsetsOf(sixteenth, SNARE), [1, 2]);
  assert.equal(sixteenth.length, 12); // a hit on every sixteenth step
});

test("every drum hit keeps its velocity and lasts one sixteenth in any meter", () => {
  for (let gene = 0; gene < NO_PATTERNS.length; gene++) {
    for (const note of realizeNo(gene, WALTZ)) {
      assert.equal(note.velocity, DRUM_VELOCITY[note.pitch]);
      assert.equal(note.duration, 0.25);
    }
  }
});

test("in 3/4 the echo is cut at the bar end", () => {
  const melody = [
    { pitch: 72, onset: 0, duration: 2 },
    { pitch: 74, onset: 2, duration: 1 },
  ];
  const notes = realizeP2(makeBar(melody, [C_WALTZ_BAR], 0, WALTZ), P2_TEXTURES.indexOf("echo"));
  assert.deepEqual(asRows(notes), [
    [72, 0.5, 2, VELOCITY_ECHO],
    [74, 2.5, 0.5, VELOCITY_ECHO],
  ]);
});

test("in 2/4 the eighth beat kicks on 1 and snares on 2", () => {
  assert.deepEqual(hits(realizeNo(NO_PATTERNS.indexOf("eighth_beat"), parseMeter("2/4"))), [
    [0, KICK],
    [0.5, HIHAT],
    [1, SNARE],
    [1.5, HIHAT],
  ]);
});

test("in cut time half time is a kick and a hi-hat on the half notes", () => {
  assert.deepEqual(hits(realizeNo(NO_PATTERNS.indexOf("half_time"), parseMeter("2/2"))), [
    [0, KICK],
    [2, HIHAT],
  ]);
});

test("in cut time root_fifth plays half notes", () => {
  const notes = realizeTr(wholeBarChord("2/2", "C", 0, [0, 4, 7]), TR_TEXTURES.indexOf("root_fifth"), null);
  assert.deepEqual(asRows(notes), [
    [36, 0, 2, VELOCITY_TR],
    [43, 2, 2, VELOCITY_TR],
  ]);
});

test("in 6/8 root_fifth plays two dotted quarters", () => {
  const notes = realizeTr(wholeBarChord("6/8", "C", 0, [0, 4, 7]), TR_TEXTURES.indexOf("root_fifth"), null);
  assert.deepEqual(
    notes.map((n) => [n.pitch, n.onset, n.duration]),
    [
      [36, 0, 1.5],
      [43, 1.5, 1.5],
    ],
  );
});

test("in 6/8 the eighth beat kicks on eighth 1 and snares on eighth 4", () => {
  assert.deepEqual(hits(realizeNo(NO_PATTERNS.indexOf("eighth_beat"), parseMeter("6/8"))), [
    [0, KICK],
    [0.5, HIHAT],
    [1, HIHAT],
    [1.5, SNARE],
    [2, HIHAT],
    [2.5, HIHAT],
  ]);
});

test("in 6/8 the walking bass plays the root and the approach", () => {
  const gBar = wholeBarChord("6/8", "G", 7, [7, 11, 2]);
  const notes = realizeTr(wholeBarChord("6/8", "C", 0, [0, 4, 7]), TR_TEXTURES.indexOf("walking"), gBar);
  assert.deepEqual(
    notes.map((n) => [n.pitch, n.onset, n.duration]),
    [
      [36, 0, 1.5],
      [30, 1.5, 1.5],
    ],
  );
});

test("in 12/8 the octave pump plays twelve eighths", () => {
  const notes = realizeTr(wholeBarChord("12/8", "C", 0, [0, 4, 7]), TR_TEXTURES.indexOf("octave_pump"), null);
  assert.equal(notes.length, 12);
  assert.deepEqual(
    notes.slice(0, 4).map((n) => n.pitch),
    [36, 48, 36, 48],
  );
});

test("in 9/8 the fill rolls on the last dotted quarter", () => {
  const notes = realizeNo(NO_PATTERNS.indexOf("fill"), parseMeter("9/8"));
  assert.deepEqual(onsetsOf(notes, SNARE), [1.5, 3, 3.25, 3.5, 3.75, 4, 4.25]);
  assert.deepEqual(onsetsOf(notes, KICK), [0]);
});

test("arpeggios keep their sixteenth subdivision in compound meters", () => {
  const notes = realizeP2(wholeBarChord("6/8", "C", 0, [0, 4, 7]), P2_TEXTURES.indexOf("arp16"));
  assert.equal(notes.length, 12);
  assert.ok(notes.every((n) => n.duration === 0.25));
});

test("in 5/4 the kick marks the 3 + 2 grouping", () => {
  const five = parseMeter("5/4");
  const eighth = realizeNo(NO_PATTERNS.indexOf("eighth_beat"), five);
  const half = realizeNo(NO_PATTERNS.indexOf("half_time"), five);
  assert.deepEqual(onsetsOf(eighth, KICK), [0, 3]);
  assert.deepEqual(onsetsOf(eighth, SNARE), [1, 2, 4]);
  assert.deepEqual(onsetsOf(half, SNARE), [3]);
});

test("in 7/8 the bass moves on each group of 2, 2 and 3 eighths", () => {
  const bar = wholeBarChord("7/8", "D", 2, [2, 6, 9]);
  const rootFifth = realizeTr(bar, TR_TEXTURES.indexOf("root_fifth"), null);
  const walking = realizeTr(bar, TR_TEXTURES.indexOf("walking"), null);
  assert.deepEqual(
    rootFifth.map((n) => [n.pitch, n.onset, n.duration]),
    [
      [38, 0, 1],
      [45, 1, 1],
      [45, 2, 1.5],
    ],
  );
  assert.deepEqual(
    walking.map((n) => [n.onset, n.duration]),
    [
      [0, 1],
      [1, 1],
      [2, 1.5],
    ],
  );
  assert.deepEqual(
    walking.map((n) => n.pitch),
    [38, 42, 45], // root, third, and the fifth to end the piece
  );
});

test("an invalid gene value is refused", () => {
  const bar = makeBar([], [C_WHOLE_BAR]);
  assert.throws(() => realizeP1(bar, 3), RangeError);
  assert.throws(() => realizeP2(bar, 5), RangeError);
  assert.throws(() => realizeTr(bar, 4, null), RangeError);
  assert.throws(() => realizeNo(5), RangeError);
});

// Parity with the Python realizers: two 4/4 songs and the meter test tunes

const realizationIds = readdirSync(join(fixturesDir, "realizations"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(".json", ""));

test("the realization fixtures cover two 4/4 songs and the seven meter tunes", () => {
  assert.deepEqual(realizationIds.sort(), [
    "changes",
    "five",
    "jig",
    "korobeiniki",
    "mulher_de_fases",
    "polka",
    "seven",
    "slow_twelve",
    "waltz",
  ]);
});

for (const songId of realizationIds) {
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

  test(`every drum pattern of every bar of ${songId} realizes the Python notes in the bar's meter`, () => {
    leadSheet.bars.forEach((bar, b) => {
      realizations.bars[b].no.forEach((/** @type {unknown} */ notes, /** @type {number} */ gene) => {
        assert.deepEqual(asRows(realizeNo(gene, bar.meter)), notes, `bar ${b} (${bar.meter}) NO gene ${gene}`);
      });
    });
  });
}
