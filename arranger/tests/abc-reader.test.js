// @ts-check
// Tests for core/abc-reader.js: an ABC tune read into a lead sheet with the abcjs parser.
//
// The committed lead sheets must come out exactly as the Python reader (src/leadsheet/
// abc_reader.py) reads them, stored in fixtures/leadsheets/. The reader also accepts what the
// Python one refuses (research R3): repeats and endings, a pickup bar and 2/4 meter. Repeats are
// checked against the order in which abcjs itself plays the tune.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { listTunes, readLeadSheetAbc } from "../src/core/abc-reader.js";
import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { assertClose, loadAbcjs, readFixture, repoRoot } from "./helpers.js";

const ABCJS = loadAbcjs();

const COMMITTED_LEAD_SHEETS = [
  "amor_i_love_you",
  "aquarela",
  "fico_assim_sem_voce",
  "ievan_polkka",
  "korobeiniki",
  "mulher_de_fases",
  "por_voce",
  "voa_voa",
];

/**
 * A one-tune ABC text with the usual header and the given body lines.
 * @param {string} body tune body (after K:).
 * @param {{meter?: string, unit?: string, key?: string, extra?: string}} [header]
 * @returns {string}
 */
function tune(body, { meter = "4/4", unit = "1/8", key = "C", extra = "" } = {}) {
  return `X:1\nT:Test\nM:${meter}\nL:${unit}\n${extra}K:${key}\n${body}\n`;
}

/**
 * @param {import("../src/core/leadsheet.js").LeadSheet} sheet
 * @returns {number[]} the melody pitches of the whole lead sheet, in order.
 */
function melodyPitches(sheet) {
  return sheet.bars.flatMap((bar) => bar.melody.map((note) => note.pitch));
}

/**
 * The pitches that abcjs plays for a tune, in order, from its own audio sequence.
 * @param {string} text
 * @returns {number[]}
 */
function abcjsPlayedPitches(text) {
  const [parsed] = ABCJS.parseOnly(text);
  const audio = parsed.setUpAudio({ chordsOff: true });
  return audio.tracks[0].filter((event) => event.cmd === "note").map((event) => event.pitch);
}

/**
 * @param {string | RegExp} pattern text or pattern the error message must hold
 * @returns {(error: unknown) => boolean}
 */
function errorMatching(pattern) {
  return (error) =>
    error instanceof Error &&
    (typeof pattern === "string" ? error.message.includes(pattern) : pattern.test(error.message));
}

for (const id of COMMITTED_LEAD_SHEETS) {
  test(`the committed lead sheet ${id}.abc reads as the Python reader reads it`, () => {
    const text = readFileSync(join(repoRoot, "data", "leadsheets", `${id}.abc`), "utf8");
    const expected = leadSheetFromJson(readFixture(`leadsheets/${id}.json`));
    const sheet = readLeadSheetAbc(ABCJS, text, { phraseLength: 4 });
    assert.equal(sheet.bars.length, expected.bars.length);
    assertClose(sheet, expected);
  });
}

test("the docstring example: a two-bar scale with C and G7", () => {
  const sheet = readLeadSheetAbc(ABCJS, 'X:1\nT:Scale\nM:4/4\nL:1/4\nK:C\n"C"CDEF|"G7"GABc|');
  assert.deepEqual(
    sheet.bars.map((bar) => bar.chords[0].symbol),
    ["C", "G7"],
  );
  assert.equal(sheet.bars[1].melody[0].pitch, 67);
  assert.equal(sheet.title, "Scale");
  assert.equal(sheet.key, "C major");
  assert.equal(sheet.tempoBpm, 140);
  assert.equal(sheet.beatsPerBar, 4);
  assert.equal(sheet.sourceGrid, null);
});

test("listTunes lists every tune of a file by its title", () => {
  const text = 'X:1\nT:One\nK:C\n"C"C8|\n\nX:2\nT:Two\nK:G\n"G"G8|\n';
  assert.deepEqual(listTunes(ABCJS, text), [
    { index: 0, title: "One" },
    { index: 1, title: "Two" },
  ]);
});

test("listTunes finds no tune in an empty text", () => {
  assert.deepEqual(listTunes(ABCJS, ""), []);
});

test("tuneIndex picks the tune to read", () => {
  const text = 'X:1\nT:One\nM:4/4\nK:C\n"C"C8|\n\nX:2\nT:Two\nM:4/4\nK:G\n"G"G8|\n';
  const sheet = readLeadSheetAbc(ABCJS, text, { tuneIndex: 1 });
  assert.equal(sheet.title, "Two");
  assert.equal(sheet.bars[0].melody[0].pitch, 67);
  assert.throws(() => readLeadSheetAbc(ABCJS, text, { tuneIndex: 2 }), errorMatching("tune"));
});

test("repeats and endings play out in the same bar order as abcjs plays them", () => {
  // One whole note per bar, each bar on its own pitch, so the melody shows the bar order.
  const bodies = [
    '|:"C"C8|1D8:|2E8|F8|]',
    '|:"C"C8|D8:|E8|]',
    '"C"C8|:D8|E8:|F8|]',
    '|:"C"C8|D8::E8|F8:|G8|]',
    '"C"C8|D8:|E8:|F8|]',
    '|:"C"C8|1,3D8:|2E8:|4F8|]',
    '|:"C"C8[1D8:|[2E8|]F8|]',
    '[|:"C"C8|D8:|]E8|',
    '|:"C"C8|D8:|1E8:|2F8|]',
    '|:"C"C8|1D8:|2E8:|F8|:G8:|',
    '|:"C"C8|1D8:|2E8|F8|:G8:|',
  ];
  for (const body of bodies) {
    const text = tune(body);
    const sheet = readLeadSheetAbc(ABCJS, text);
    assert.deepEqual(melodyPitches(sheet), abcjsPlayedPitches(text), body);
    assert.ok(
      sheet.bars.every((bar) => bar.melody.length === 1),
      body,
    );
  }
});

test("a first and second ending play the common bars twice, then each ending once", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('|:"C"C8|1"F"F8:|2"G"G8|c8|]'));
  assert.deepEqual(melodyPitches(sheet), [60, 65, 60, 67, 72]);
  assert.deepEqual(
    sheet.bars.map((bar) => bar.chords[0].symbol),
    ["C", "F", "C", "G", "G"],
  );
  assert.deepEqual(
    sheet.bars.map((bar) => bar.index),
    [0, 1, 2, 3, 4],
  );
});

test("a repeated passage starts its phrases again", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('P:A\n|:"C"C8|D8|E8:|'));
  assert.deepEqual(
    sheet.bars.map((bar) => [bar.phrase, bar.phraseEnd]),
    [
      [0, false],
      [0, false],
      [0, true],
      [1, false],
      [1, false],
      [1, true],
    ],
  );
});

test("a one-quarter pickup gives a first bar with a 3-beat leading rest", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"G2|c4 e4|g8|'));
  assert.equal(sheet.bars.length, 3);
  assert.deepEqual(sheet.bars[0].melody, [{ pitch: 67, onset: 3, duration: 1 }]);
  assert.deepEqual(sheet.bars[0].chords, [{ symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 }]);
  assert.deepEqual(sheet.bars[1].melody[0], { pitch: 72, onset: 0, duration: 2 });
});

test("an M:2/4 tune of 8 bars gives 4 bars of 4/4", () => {
  const body = '"C"CDEF|GABc|"F"cBAG|FEDC|"G"DEFG|ABcd|"C"cBAG|FEDC|';
  const sheet = readLeadSheetAbc(ABCJS, tune(body, { meter: "2/4" }));
  assert.equal(sheet.bars.length, 4);
  assert.deepEqual(
    sheet.bars[0].melody.map((note) => [note.pitch, note.onset]),
    [
      [60, 0],
      [62, 0.5],
      [64, 1],
      [65, 1.5],
      [67, 2],
      [69, 2.5],
      [71, 3],
      [72, 3.5],
    ],
  );
  assert.deepEqual(
    sheet.bars.map((bar) => bar.chords.map((segment) => segment.symbol)),
    [["C"], ["F"], ["G"], ["C"]],
  );
});

test("in 2/4 a pickup counts in the pair and an odd last bar is padded with a rest", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"G|c2 e2|"G"g4|', { meter: "2/4" }));
  assert.equal(sheet.bars.length, 2);
  assert.deepEqual(sheet.bars[0].melody, [
    { pitch: 67, onset: 1.5, duration: 0.5 },
    { pitch: 72, onset: 2, duration: 1 },
    { pitch: 76, onset: 3, duration: 1 },
  ]);
  assert.deepEqual(sheet.bars[1].melody, [{ pitch: 79, onset: 0, duration: 2 }]);
  assert.deepEqual(
    sheet.bars[1].chords.map((segment) => [segment.symbol, segment.onset, segment.duration]),
    [["G", 0, 4]],
  );
});

test("M:C reads as 4/4", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"C8|', { meter: "C" }));
  assert.equal(sheet.bars.length, 1);
});

test("a meter other than 4/4 or 2/4 is refused with its name", () => {
  assert.throws(() => readLeadSheetAbc(ABCJS, tune('"C"C2D2E2|', { meter: "3/4" })), errorMatching("3/4"));
  assert.throws(() => readLeadSheetAbc(ABCJS, tune('"C"C3D3|', { meter: "6/8" })), errorMatching("6/8"));
  assert.throws(() => readLeadSheetAbc(ABCJS, tune('"C"C4D4|', { meter: "C|" })), errorMatching("C|"));
});

test("a tune without an M: field is refused", () => {
  assert.throws(() => readLeadSheetAbc(ABCJS, 'X:1\nT:Free\nL:1/8\nK:C\n"C"C8|\n'), errorMatching("M:"));
});

test("a meter change inside the tune is refused, naming the bar", () => {
  assert.throws(
    () => readLeadSheetAbc(ABCJS, tune('"C"C8|D8|[M:3/4]E6|')),
    errorMatching(/bar 3.*3\/4/),
  );
  assert.throws(() => readLeadSheetAbc(ABCJS, tune('"C"C8|D8|\nM:3/4\nE6|')), errorMatching(/bar 3.*3\/4/));
});

test("restating the meter inside the tune is not a change, and C is the same meter as 4/4", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"C8|[M:4/4]D8|\nM:C\nE8|', { meter: "C" }));
  assert.equal(sheet.bars.length, 3);
});

test("a tune without chord symbols is refused", () => {
  assert.throws(() => readLeadSheetAbc(ABCJS, tune("C8|D8|")), errorMatching("the tune has no chord symbol"));
});

test("an unknown chord symbol is refused, naming the bar and the symbol", () => {
  assert.throws(
    () => readLeadSheetAbc(ABCJS, tune('"C"C8|"Xyz"D8|')),
    errorMatching(/bar 2.*'Xyz'/),
  );
});

test("an incomplete bar after the first is refused, naming the bar", () => {
  assert.throws(() => readLeadSheetAbc(ABCJS, tune('"C"C8|D6|E8|')), errorMatching(/bar 2 lasts 3 beats/));
  assert.throws(() => readLeadSheetAbc(ABCJS, tune('"C"C8|D8 E2|')), errorMatching(/bar 2 lasts 5 beats/));
});

test("a tie inside a bar gives one merged note", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"C4- C2 D2|'));
  assert.deepEqual(sheet.bars[0].melody, [
    { pitch: 60, onset: 0, duration: 3 },
    { pitch: 62, onset: 3, duration: 1 },
  ]);
});

test("a note tied across a bar line gives one note in each bar", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"C4 ^F4-|F4 E4|'));
  assert.deepEqual(sheet.bars[0].melody[1], { pitch: 66, onset: 2, duration: 2 });
  assert.deepEqual(sheet.bars[1].melody[0], { pitch: 66, onset: 0, duration: 2 });
});

test("a triplet in an eighth-note tune gives onsets in thirds of a beat with no float noise", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"(3CDE F2 G4|'));
  assert.deepEqual(
    sheet.bars[0].melody.map((note) => note.onset),
    [0, 1 / 3, 2 / 3, 1, 2],
  );
  assert.deepEqual(
    sheet.bars[0].melody.map((note) => note.duration),
    [1 / 3, 1 / 3, 1 / 3, 1, 2],
  );
});

test("a chord of notes [CEG] keeps its top note G as the melody", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"[CEG]4 c4|'));
  assert.deepEqual(sheet.bars[0].melody[0], { pitch: 67, onset: 0, duration: 2 });
});

test("grace notes and spacers take no time; an invisible rest x does", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"{d}C2 y E2 x2 "G"G2|'));
  assert.deepEqual(sheet.bars[0].melody, [
    { pitch: 60, onset: 0, duration: 1 },
    { pitch: 64, onset: 1, duration: 1 },
    { pitch: 67, onset: 3, duration: 1 },
  ]);
  assert.deepEqual(
    sheet.bars[0].chords.map((segment) => [segment.symbol, segment.onset]),
    [
      ["C", 0],
      ["G", 3],
    ],
  );
});

test("a multi-measure rest Z2 gives two silent bars that keep the chord", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"C8|Z2|"G"G8|'));
  assert.equal(sheet.bars.length, 4);
  assert.deepEqual(sheet.bars[1].melody, []);
  assert.deepEqual(sheet.bars[2].melody, []);
  assert.equal(sheet.bars[2].chords[0].symbol, "C");
});

test("the key signature and in-bar accidentals give the pitches", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"Em"F2 ^G2 G2 =F2|', { key: "G" }));
  assert.deepEqual(melodyPitches(sheet), [66, 68, 68, 65]);
});

test("the first voice is the melody", () => {
  const text = 'X:1\nT:Two voices\nM:4/4\nL:1/8\nK:C\nV:1\n"C"c8|\nV:2\nC,8|\n';
  assert.deepEqual(melodyPitches(readLeadSheetAbc(ABCJS, text)), [72]);
});

test("chord symbols stay ASCII, such as F#m and Bb", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"F#m"A4 "Bb"B4|'));
  assert.deepEqual(
    sheet.bars[0].chords.map((segment) => [segment.symbol, segment.root]),
    [
      ["F#m", 6],
      ["Bb", 10],
    ],
  );
});

test("a chord symbol written just before a bar line starts with the next bar", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"C8 "G"|G8|'));
  assert.deepEqual(
    sheet.bars.map((bar) => bar.chords.map((segment) => segment.symbol)),
    [["C"], ["G"]],
  );
});

test("of two chord symbols on one note, the second is in effect, as in the Python reader", () => {
  // abcjs joins them into one name, "C\nG".
  const sheet = readLeadSheetAbc(ABCJS, tune('"C""G"C8|'));
  assert.deepEqual(
    sheet.bars[0].chords.map((segment) => segment.symbol),
    ["G"],
  );
});

test("annotations above or below the staff are not chord symbols", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C""^Intro"C8|"_slower"D8|'));
  assert.deepEqual(
    sheet.bars.map((bar) => bar.chords.map((segment) => segment.symbol)),
    [["C"], ["C"]],
  );
});

test("a decimal tempo Q:1/4=132.500055 keeps its decimals", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"C8|', { extra: "Q:1/4=132.500055\n" }));
  assert.equal(sheet.tempoBpm, 132.500055);
});

test("a file with Windows line endings reads the same, decimal tempo included", () => {
  const text = readFileSync(join(repoRoot, "data", "leadsheets", "mulher_de_fases.abc"), "utf8");
  const sheet = readLeadSheetAbc(ABCJS, text.replace(/\n/g, "\r\n"));
  assert.deepEqual(sheet, readLeadSheetAbc(ABCJS, text));
  assert.equal(sheet.tempoBpm, 132.500055);
});

test("the tempo is counted in quarter notes, and an override replaces it", () => {
  const text = tune('"C"C8|', { extra: "Q:3/8=80\n" });
  assert.equal(readLeadSheetAbc(ABCJS, text).tempoBpm, 120);
  assert.equal(readLeadSheetAbc(ABCJS, text, { tempoOverride: 97.5 }).tempoBpm, 97.5);
});

test("the key is named as music21 names it, and K:none gives no key", () => {
  /** @type {Record<string, string>} */
  const names = {
    C: "C major",
    Am: "a minor",
    Ebm: "e- minor",
    "F#m": "f# minor",
    Bb: "B- major",
    Ddor: "D dorian",
    Bbmix: "B- mixolydian",
    none: "",
  };
  for (const [key, name] of Object.entries(names)) {
    assert.equal(readLeadSheetAbc(ABCJS, tune('"C"C8|', { key })).key, name, `K:${key}`);
  }
});

test("part labels mark sections; phrases restart at each part and the role map sets roles", () => {
  const body = 'P:A\n"C"C8|D8|E8|\nP:B\n"G"G8|A8|';
  const sheet = readLeadSheetAbc(ABCJS, tune(body), { phraseLength: 2, roleMap: { A: "chorus" } });
  assert.deepEqual(
    sheet.bars.map((bar) => [bar.label, bar.role, bar.phrase, bar.phraseEnd]),
    [
      ["A", "chorus", 0, false],
      ["A", "chorus", 0, true],
      ["A", "chorus", 1, true],
      ["B", "chorus", 2, false],
      ["B", "chorus", 2, true],
    ],
  );
});

test("bars before the first part label have the empty label and are a verse", () => {
  const sheet = readLeadSheetAbc(ABCJS, tune('"C"C8|\nP:B\nD8|'));
  assert.deepEqual(
    sheet.bars.map((bar) => [bar.label, bar.role]),
    [
      ["", "verse"],
      ["B", "chorus"],
    ],
  );
});

test("a phrase length below 1 is refused", () => {
  assert.throws(() => readLeadSheetAbc(ABCJS, tune('"C"C8|'), { phraseLength: 0 }), errorMatching("phrase"));
});
