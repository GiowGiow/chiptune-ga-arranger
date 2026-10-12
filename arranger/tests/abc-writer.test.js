// @ts-check
// Tests for core/abc-writer.js: a lead sheet written as ABC text, so the visitor can download
// the reduction of a MIDI song (or of an ABC tune) and read it back unchanged.
//
// The Python writer (src/leadsheet/abc_writer.py) wrote fixtures/abc/<id>.abc from the lead
// sheets in fixtures/leadsheets/; the JavaScript writer must give the same text, byte for byte.
// That holds for the meter test tunes too (spec 003): `M:` gives the first bar's meter and an
// inline `[M:x]` starts each bar whose meter changes.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readLeadSheetAbc } from "../src/core/abc-reader.js";
import { writeLeadSheetAbc } from "../src/core/abc-writer.js";
import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { FOUR_FOUR, parseMeter } from "../src/core/meter.js";
import { assertClose, fixturesDir, loadAbcjs, readFixture } from "./helpers.js";

/** The MIDI songs whose lead sheets the Python code wrote as ABC (all with K:none). */
const WRITTEN_LEAD_SHEETS = [
  "amor_i_love_you",
  "aquarela",
  "fico_assim_sem_voce",
  "mulher_de_fases",
  "por_voce",
  "voa_voa",
];

/** The meter test tunes of tests/data/meters/, read and written back by the Python code. */
const METER_TUNES = ["waltz", "polka", "jig", "slow_twelve", "five", "seven", "changes"];

/**
 * Every lead sheet fixture, including the two ABC tunes with a key (Ievan Polkka, Korobeiniki)
 * and the meter test tunes.
 */
const ALL_LEAD_SHEETS = [...WRITTEN_LEAD_SHEETS, "ievan_polkka", "korobeiniki", ...METER_TUNES];

/**
 * @param {string} id
 * @returns {import("../src/core/leadsheet.js").LeadSheet}
 */
function fixtureLeadSheet(id) {
  return leadSheetFromJson(readFixture(`leadsheets/${id}.json`));
}

/**
 * The one-bar lead sheet of the Python docstring: C then G, a C4 and an F#4.
 * @param {Partial<import("../src/core/leadsheet.js").LeadSheet>} [changes]
 * @returns {import("../src/core/leadsheet.js").LeadSheet}
 */
function demoLeadSheet(changes = {}) {
  return {
    title: "Demo",
    key: "C major",
    tempoBpm: 120,
    bars: [
      {
        index: 0,
        melody: [
          { pitch: 60, onset: 0, duration: 1 },
          { pitch: 66, onset: 1, duration: 3 },
        ],
        chords: [
          { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 2 },
          { symbol: "G", root: 7, tones: [7, 11, 2], onset: 2, duration: 2 },
        ],
        label: "A",
        role: "verse",
        phrase: 0,
        phraseEnd: true,
        meter: FOUR_FOUR,
      },
    ],
    sourceGrid: null,
    ...changes,
  };
}

/**
 * @param {string | RegExp} pattern
 * @returns {(error: unknown) => boolean}
 */
function errorMatching(pattern) {
  return (error) =>
    error instanceof Error &&
    (typeof pattern === "string" ? error.message.includes(pattern) : pattern.test(error.message));
}

for (const id of WRITTEN_LEAD_SHEETS) {
  test(`the lead sheet of ${id} is written exactly as the Python writer wrote it`, () => {
    const expected = readFileSync(join(fixturesDir, "abc", `${id}.abc`), "utf8");
    assert.equal(writeLeadSheetAbc(fixtureLeadSheet(id), { phraseLength: 4 }), expected);
  });
}

for (const id of METER_TUNES) {
  test(`the meter tune ${id} is written exactly as the Python writer wrote it`, () => {
    const expected = readFileSync(join(fixturesDir, "abc", `${id}.abc`), "utf8");
    assert.equal(writeLeadSheetAbc(fixtureLeadSheet(id), { phraseLength: 4 }), expected);
  });
}

test("the docstring example: a chord change inside a note writes the note as two tied pieces", () => {
  const expected = [
    "%abc-2.1",
    "X:1",
    "T:Demo",
    "M:4/4",
    "L:1/16",
    "Q:1/4=120",
    "K:C",
    "P:A",
    '"C"C4 ^F4- "G"^F8 |',
    "",
  ].join("\n");
  assert.equal(writeLeadSheetAbc(demoLeadSheet()), expected);
});

test("comment lines go at the top, after the version line, without trailing spaces", () => {
  const text = writeLeadSheetAbc(demoLeadSheet(), { comments: ["Reduced from song.mid", ""] });
  assert.deepEqual(text.split("\n").slice(0, 4), ["%abc-2.1", "% Reduced from song.mid", "%", "X:1"]);
});

test("a tempo with more than 6 decimals is rounded in Q: and given in full in a comment", () => {
  const text = writeLeadSheetAbc(demoLeadSheet({ tempoBpm: 132.50005520835634 }));
  const lines = text.split("\n");
  const q = lines.indexOf("Q:1/4=132.500055");
  assert.ok(q > 0, text);
  assert.equal(
    lines[q + 1],
    "% Exact tempo 132.50005520835634 quarter notes per minute; Q: keeps 6 decimals.",
  );
  assert.ok(writeLeadSheetAbc(demoLeadSheet({ tempoBpm: 110.1 })).includes("\nQ:1/4=110.1\nK:"));
});

test("a key is written with its key signature, and notes it gives need no accidental", () => {
  /** @type {Record<string, string>} */
  const fields = {
    "": "none",
    "C major": "C",
    "a minor": "Am",
    "e- minor": "Ebm",
    "f# minor": "F#m",
    "B- mixolydian": "BbMix",
    "D dorian": "DDor",
    "G# major": "G#",
  };
  for (const [key, field] of Object.entries(fields)) {
    assert.ok(writeLeadSheetAbc(demoLeadSheet({ key })).includes(`\nK:${field}\n`), key);
  }
  // In E-flat minor, B4 is spelled C-flat 5 (MIDI 71), which the key signature already flattens.
  const bar = demoLeadSheet().bars[0];
  const sheet = demoLeadSheet({
    key: "e- minor",
    bars: [{ ...bar, melody: [{ pitch: 71, onset: 0, duration: 4 }] }],
  });
  assert.ok(writeLeadSheetAbc(sheet).includes('\n"C"c8- "G"c8 |\n'));
});

test("once a letter needs an accidental in a bar, every later note of that letter is marked", () => {
  const bar = demoLeadSheet().bars[0];
  const sheet = demoLeadSheet({
    bars: [
      {
        ...bar,
        melody: [
          { pitch: 66, onset: 0, duration: 1 },
          { pitch: 65, onset: 1, duration: 1 },
          { pitch: 65, onset: 2, duration: 2 },
        ],
      },
    ],
  });
  assert.ok(writeLeadSheetAbc(sheet).includes('\n"C"^F4 =F4 "G"=F8 |\n'));
});

test("a key with an unknown mode cannot be written", () => {
  assert.throws(() => writeLeadSheetAbc(demoLeadSheet({ key: "C xyz" })), errorMatching("C xyz"));
});

test("M: is the first bar's meter, and [M:x] starts each bar whose meter differs from the last", () => {
  const bar = demoLeadSheet().bars[0];
  const waltz = parseMeter("3/4");
  const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 3 };
  const waltzBar = { ...bar, melody: [{ pitch: 67, onset: 0, duration: 3 }], chords: [c], meter: waltz };
  const bars = [
    { ...waltzBar, index: 0, phraseEnd: false },
    { ...waltzBar, index: 1, phraseEnd: false },
    { ...bar, index: 2, phraseEnd: false },
    { ...waltzBar, index: 3, phraseEnd: true },
  ];
  const text = writeLeadSheetAbc(demoLeadSheet({ bars }));
  assert.ok(text.includes("\nM:3/4\nL:1/16\n"), text);
  assert.ok(text.endsWith('\n"C"G12 | "C"G12 | [M:4/4]"C"C4 ^F4- "G"^F8 | [M:3/4]"C"G12 |\n'), text);
});

test("the meter is written as a fraction: a 2/2 bar gives M:2/2, never M:C|", () => {
  const bar = { ...demoLeadSheet().bars[0], meter: parseMeter("C|") };
  assert.ok(writeLeadSheetAbc(demoLeadSheet({ bars: [bar] })).includes("\nM:2/2\n"));
});

test("a 3/4 bar holds 12 sixteenths: a note past beat 3 is refused, naming the bar", () => {
  const bar = demoLeadSheet().bars[0];
  const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 3 };
  const late = { ...bar, meter: parseMeter("3/4"), chords: [c], melody: [{ pitch: 60, onset: 2, duration: 2 }] };
  assert.throws(() => writeLeadSheetAbc(demoLeadSheet({ bars: [late] })), errorMatching(/bar 1: melody notes overlap or leave the bar/));
  const short = { ...bar, meter: parseMeter("3/4"), melody: [] };
  assert.throws(() => writeLeadSheetAbc(demoLeadSheet({ bars: [short] })), errorMatching(/bar 1: the chord segments/));
});

test("a note off the sixteenth-note grid is refused, naming the bar", () => {
  const bar = demoLeadSheet().bars[0];
  const sheet = demoLeadSheet({ bars: [{ ...bar, melody: [{ pitch: 60, onset: 1 / 3, duration: 1 }] }] });
  assert.throws(() => writeLeadSheetAbc(sheet), errorMatching(/bar 1: onset 0\.333.* sixteenth-note grid/));
});

test("overlapping melody notes are refused, naming the bar", () => {
  const bar = demoLeadSheet().bars[0];
  const melody = [
    { pitch: 60, onset: 0, duration: 2 },
    { pitch: 62, onset: 1, duration: 1 },
  ];
  assert.throws(
    () => writeLeadSheetAbc(demoLeadSheet({ bars: [{ ...bar, melody }] })),
    errorMatching(/bar 1: melody notes overlap/),
  );
});

test("chord segments that leave a gap are refused, naming the bar", () => {
  const bar = demoLeadSheet().bars[0];
  const chords = [bar.chords[0]];
  assert.throws(
    () => writeLeadSheetAbc(demoLeadSheet({ bars: [{ ...bar, chords }] })),
    errorMatching(/bar 1: the chord segments/),
  );
});

test("phrases that phrase_length cannot reproduce are refused", () => {
  const bar = demoLeadSheet().bars[0];
  const bars = [0, 1, 2].map((index) => ({ ...bar, index, phrase: 0, phraseEnd: index === 2 }));
  assert.throws(
    () => writeLeadSheetAbc(demoLeadSheet({ bars }), { phraseLength: 2 }),
    errorMatching("phrase_length=2"),
  );
});

test("every lead sheet fixture reads back unchanged from the ABC it is written as", () => {
  const ABCJS = loadAbcjs();
  for (const id of ALL_LEAD_SHEETS) {
    const sheet = fixtureLeadSheet(id);
    const text = writeLeadSheetAbc(sheet, { phraseLength: 4 });
    assertClose(readLeadSheetAbc(ABCJS, text, { phraseLength: 4 }), sheet);
  }
});
