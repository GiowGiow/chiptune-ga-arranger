// @ts-check
// Tests for core/arrangement.js: assembling a plan into the four NES channels (port of
// src/arrangement/assemble.py) and checking the NES rules before export (port of
// src/arrangement/validation.py). Every committed sample's best plan must assemble to the notes
// the Python code wrote to fixtures/plans/, and pass the rules. The synthetic cases port
// tests/test_validation.py: each starts from a valid arrangement and breaks one rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { assemble, findViolations } from "../src/core/arrangement.js";
import { P2_TEXTURES } from "../src/core/genome.js";
import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { CHANNELS, KICK, SNARE } from "../src/core/textures.js";
import { assertClose, fixturesDir, readFixture } from "./helpers.js";

/**
 * @param {import("../src/core/textures.js").ChannelNote[]} notes
 */
function asRows(notes) {
  return notes.map((note) => [note.pitch, note.onset, note.duration, note.velocity]);
}

/** @param {string} symbol @param {number} root @param {number[]} tones @param {number} onset @param {number} duration */
function chord(symbol, root, tones, onset, duration) {
  return { symbol, root, tones, onset, duration };
}

// Two bars: C for the whole first bar, then F and Am for half a bar each.
const C = chord("C", 0, [0, 4, 7], 0, 4);
const F = chord("F", 5, [5, 9, 0], 0, 2);
const AM = chord("Am", 9, [9, 0, 4], 2, 2);

/** @type {import("../src/core/leadsheet.js").LeadSheet} */
const LEAD_SHEET = {
  title: "Test tune",
  key: "C major",
  tempoBpm: 120,
  beatsPerBar: 4,
  sourceGrid: null,
  bars: [
    { index: 0, melody: [], chords: [C], label: "A", role: "verse", phrase: 0, phraseEnd: false },
    { index: 1, melody: [], chords: [F, AM], label: "A", role: "verse", phrase: 0, phraseEnd: true },
  ],
};

const HOLD = P2_TEXTURES.indexOf("hold");
const ECHO = P2_TEXTURES.indexOf("echo");

/**
 * Channel notes from [pitch, onset from the piece start, duration] triples.
 * @param {...[number, number, number]} triples
 */
function notes(...triples) {
  return triples.map(([pitch, onset, duration]) => ({ pitch, onset, duration, velocity: 80 }));
}

const VALID_CHANNELS = {
  P1: notes([60, 0, 2], [64, 2, 2], [65, 4, 2], [69, 6, 2]),
  P2: notes([48, 0, 4], [53, 4, 2], [57, 6, 2]),
  TR: notes([36, 0, 2], [43, 2, 2], [29, 4, 2], [33, 6, 2]),
  NO: notes([KICK, 0, 0.25], [SNARE, 2, 0.25], [KICK, 4, 0.25], [SNARE, 6, 0.25]),
};

/**
 * The valid arrangement, with the given P2 genes and some channels replaced.
 * @param {Partial<Record<"P1" | "P2" | "TR" | "NO", ReturnType<typeof notes>>>} [channels]
 * @param {number[]} [p2Textures]
 * @returns {import("../src/core/arrangement.js").Arrangement}
 */
function makeArrangement(channels = {}, p2Textures = [HOLD, HOLD]) {
  const plan = Uint8Array.from(p2Textures.flatMap((texture) => [texture, 0, 0, 0]));
  return { title: "Test tune", tempoBpm: 120, plan, channels: { ...VALID_CHANNELS, ...channels } };
}

// Assembling the committed samples

const planFiles = readdirSync(join(fixturesDir, "plans")).filter((name) => name.endsWith(".json"));

for (const file of planFiles) {
  const sample = readFixture(`plans/${file}`);
  const leadSheet = leadSheetFromJson(readFixture(`leadsheets/${sample.leadsheet}.json`));
  const plan = Uint8Array.from(sample.best_plan.flat());

  test(`the best plan of ${file.replace(".json", "")} assembles to the Python notes, note for note`, () => {
    const arrangement = assemble(leadSheet, plan);
    assert.equal(arrangement.title, leadSheet.title);
    assert.equal(arrangement.tempoBpm, leadSheet.tempoBpm);
    assert.deepEqual([...arrangement.plan], [...plan]);
    assert.deepEqual(Object.keys(arrangement.channels), [...CHANNELS]);
    for (const channel of CHANNELS) {
      assertClose(asRows(arrangement.channels[channel]), sample.arrangement[channel]);
    }
  });

  test(`the arrangement of ${file.replace(".json", "")} breaks no NES rule`, () => {
    assert.deepEqual(findViolations(assemble(leadSheet, plan), leadSheet), []);
  });
}

test("assemble shifts each bar's notes by 4 beats per bar and keeps its own copy of the plan", () => {
  const plan = Uint8Array.of(HOLD, 0, 1, 0, HOLD, 0, 1, 0);
  const arrangement = assemble(LEAD_SHEET, plan);
  assert.deepEqual(asRows(arrangement.channels.P2), [
    [48, 0, 4, 80],
    [53, 4, 2, 80],
    [57, 6, 2, 80],
  ]);
  assert.deepEqual(
    arrangement.channels.NO.map((note) => note.onset),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  plan[0] = ECHO;
  assert.equal(arrangement.plan[0], HOLD);
});

test("two C bars with hold and half time: P2 holds 48 at beats 0 and 4, drums hit every beat", () => {
  /** @type {import("../src/core/leadsheet.js").Bar} */
  const bar = { index: 0, melody: [], chords: [C], label: "A", role: "verse", phrase: 0, phraseEnd: true };
  const sheet = { title: "Two bars", key: "", tempoBpm: 120, beatsPerBar: 4, sourceGrid: null, bars: [bar, { ...bar, index: 1 }] };
  const arrangement = assemble(sheet, Uint8Array.of(0, 0, 1, 0, 0, 0, 1, 0));
  assert.deepEqual(
    arrangement.channels.P2.map((note) => [note.pitch, note.onset]),
    [
      [48, 0],
      [48, 4],
    ],
  );
  assert.deepEqual(
    arrangement.channels.NO.map((note) => note.onset),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
});

test("assemble refuses a plan whose length is not 4 genes per bar of the lead sheet", () => {
  assert.throws(() => assemble(LEAD_SHEET, Uint8Array.of(0, 0, 0, 0)), RangeError);
});

// The NES rules

test("a bass note on beat 3 that is not a tone of C is reported (doctest)", () => {
  const sheet = { ...LEAD_SHEET, bars: [{ ...LEAD_SHEET.bars[0], phraseEnd: true }] };
  const bass = [
    { pitch: 36, onset: 0, duration: 2, velocity: 90 },
    { pitch: 38, onset: 2, duration: 2, velocity: 90 },
  ];
  const bassOnly = { title: "Tune", tempoBpm: 120, plan: Uint8Array.of(0, 0, 0, 0), channels: { TR: bass } };
  assert.deepEqual(findViolations(bassOnly, sheet), ["TR bar 1: pitch 38 at beat 3 is not a chord tone of C"]);
});

test("a valid arrangement has no violations", () => {
  assert.deepEqual(findViolations(makeArrangement(), LEAD_SHEET), []);
});

test("two overlapping notes in one channel are reported", () => {
  const melody = notes([60, 0, 2.5], [64, 2, 2], [65, 4, 2], [69, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ P1: melody }), LEAD_SHEET), [
    "P1 bar 1: the note at beat 1 overlaps the next note",
  ]);
});

test("a P1 pitch of 110 is outside the pulse range", () => {
  const melody = notes([60, 0, 2], [110, 2, 2], [65, 4, 2], [69, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ P1: melody }), LEAD_SHEET), [
    "P1 bar 1: pitch 110 at beat 3 is outside the range 33-108",
  ]);
});

test("a pulse note below MIDI 33 is reported", () => {
  const melody = notes([60, 0, 2], [64, 2, 2], [32, 4, 2], [69, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ P1: melody }), LEAD_SHEET), [
    "P1 bar 2: pitch 32 at beat 1 is outside the range 33-108",
  ]);
});

test("a triangle note above MIDI 108 is reported", () => {
  const bass = notes([36, 0, 1], [109, 1, 1], [43, 2, 2], [29, 4, 2], [33, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ TR: bass }), LEAD_SHEET), [
    "TR bar 1: pitch 109 at beat 2 is outside the range 21-108",
  ]);
});

test("a bass note on beat 3 outside the chord in effect is reported", () => {
  // F is the chord of beats 1-2 of bar 2, but on beat 3 the chord is Am.
  const bass = notes([36, 0, 2], [43, 2, 2], [29, 4, 2], [29, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ TR: bass }), LEAD_SHEET), [
    "TR bar 2: pitch 29 at beat 3 is not a chord tone of Am",
  ]);
});

test("bass passing notes on beats 2 and 4 are allowed", () => {
  const walkingBass = notes([36, 0, 1], [38, 1, 1], [43, 2, 1], [28, 3, 1], [29, 4, 2], [33, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ TR: walkingBass }), LEAD_SHEET), []);
});

test("a harmony note on beat 1 outside the chord is reported in a hold bar", () => {
  const harmony = notes([50, 0, 4], [53, 4, 2], [57, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ P2: harmony }), LEAD_SHEET), [
    "P2 bar 1: pitch 50 at beat 1 is not a chord tone of C",
  ]);
});

test("a harmony note on beat 1 outside the chord is allowed in an echo bar", () => {
  // The echo replays the melody, which may hold a passing tone on any beat.
  const harmony = notes([50, 0, 4], [53, 4, 2], [57, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ P2: harmony }, [ECHO, HOLD]), LEAD_SHEET), []);
});

test("a note that crosses its bar end is reported", () => {
  const melody = notes([60, 0, 2], [64, 2, 2.5], [69, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ P1: melody }), LEAD_SHEET), [
    "P1 bar 1: the note at beat 3 crosses the bar end",
  ]);
});

test("a NO hit that rings past the end of its bar leaves the bar's drum grid incomplete", () => {
  const drums = notes([KICK, 0, 0.25], [SNARE, 2, 0.25], [SNARE, 3.875, 0.25], [KICK, 4, 0.25]);
  assert.deepEqual(findViolations(makeArrangement({ NO: drums }), LEAD_SHEET), [
    "NO bar 1: the note at beat 4.875 overlaps the next note",
    "NO bar 1: the note at beat 4.875 crosses the bar end",
  ]);
});

test("a note before the start of the piece is reported", () => {
  const drums = notes([KICK, -0.25, 0.25], [SNARE, 2, 0.25], [KICK, 4, 0.25]);
  assert.deepEqual(findViolations(makeArrangement({ NO: drums }), LEAD_SHEET), [
    "NO bar 1: the note at onset -0.25 starts before the piece",
  ]);
});

test("every broken rule gets its own message, in rule order", () => {
  const bass = notes([36, 0, 2], [109, 2, 3], [29, 4, 2], [33, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ TR: bass }), LEAD_SHEET), [
    "TR bar 1: the note at beat 3 overlaps the next note",
    "TR bar 1: pitch 109 at beat 3 is outside the range 21-108",
    "TR bar 1: pitch 109 at beat 3 is not a chord tone of C",
    "TR bar 1: the note at beat 3 crosses the bar end",
  ]);
});

test("notes are checked in time order even when a channel lists them out of order", () => {
  const melody = notes([65, 4, 2], [60, 0, 2], [69, 6, 2], [64, 2, 2]);
  assert.deepEqual(findViolations(makeArrangement({ P1: melody }), LEAD_SHEET), []);
});

test("beat labels print like Python's :g format", () => {
  const melody = notes([60, 0, 1.5], [64, 1.4, 2.6], [65, 4, 2], [69, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ P1: melody }), LEAD_SHEET), [
    "P1 bar 1: the note at beat 1 overlaps the next note",
  ]);
  const triplet = notes([60, 0, 1 / 3], [64, 1 / 3, 4], [65, 4, 2], [69, 6, 2]);
  assert.deepEqual(findViolations(makeArrangement({ P1: triplet }), LEAD_SHEET), [
    "P1 bar 1: the note at beat 1.33333 overlaps the next note",
    "P1 bar 1: the note at beat 1.33333 crosses the bar end",
  ]);
});
