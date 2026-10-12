// @ts-check
// Tests for core/leadsheet.js: the form of a lead sheet (phrases, verse or chorus) and the chord
// in effect at each moment. They port the doctests of src/leadsheet/abc_reader.py and
// src/leadsheet/model.py, so both implementations answer the same worked examples.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BEATS_PER_BAR,
  chordAt,
  chordSegments,
  leadSheetFromJson,
  phraseMarks,
  sectionRole,
} from "../src/core/leadsheet.js";

/**
 * Root and tones of the three chords the tests use, so they do not depend on core/chords.js.
 * @type {Record<string, [number, number[]]>}
 */
const STUB_CHORDS = {
  C: [0, [0, 4, 7]],
  F: [5, [5, 9, 0]],
  G: [7, [7, 11, 2]],
};

/**
 * @param {string} symbol
 * @returns {[number, number[]]}
 */
function stubChordTones(symbol) {
  const [root, tones] = STUB_CHORDS[symbol];
  return [root, [...tones]];
}

test("a bar of 4/4 lasts four beats", () => {
  assert.equal(BEATS_PER_BAR, 4);
});

test("phrases are counted from the start of each section, and a short section ends its phrase early", () => {
  assert.deepEqual(phraseMarks([1, 1, 1, 1, 1, 1, 2, 2], 4), [
    [0, false],
    [0, false],
    [0, false],
    [0, true],
    [1, false],
    [1, true],
    [2, false],
    [2, true],
  ]);
});

test("a section that comes back later starts a new phrase", () => {
  // Like itertools.groupby, only consecutive bars of the same section form one group.
  assert.deepEqual(phraseMarks([1, 1, 2, 1], 4), [
    [0, false],
    [0, true],
    [1, true],
    [2, true],
  ]);
});

test("a piece with no bars has no phrase marks", () => {
  assert.deepEqual(phraseMarks([], 4), []);
});

test("the B part and any label with 'chorus' are a chorus; other labels are a verse", () => {
  assert.deepEqual(
    ["B", "Chorus 2", "A"].map((label) => sectionRole(label, null)),
    ["chorus", "chorus", "verse"],
  );
});

test("a role map overrides the role guessed from the label", () => {
  assert.equal(sectionRole("A", { A: "chorus" }), "chorus");
});

test("a role map that does not name the label leaves the guess in place", () => {
  assert.equal(sectionRole("B", { A: "chorus" }), "chorus");
  assert.equal(sectionRole("Verse", undefined), "verse");
});

test("the chord in effect is the last one that started at or before the onset", () => {
  const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0.0, duration: 2.0 };
  const g = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 2.0, duration: 2.0 };
  const bar = { chords: [c, g] };
  assert.deepEqual(
    [chordAt(bar, 0.0).symbol, chordAt(bar, 1.75).symbol, chordAt(bar, 2.0).symbol],
    ["C", "C", "G"],
  );
});

test("an onset a hair before a chord change already hears the new chord", () => {
  // Float onsets such as 1.9999999999 come from tuplets; the 1e-9 tolerance absorbs them.
  const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0.0, duration: 2.0 };
  const g = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 2.0, duration: 2.0 };
  assert.equal(chordAt({ chords: [c, g] }, 2.0 - 1e-10).symbol, "G");
});

test("an onset before every chord falls back to the first chord of the bar", () => {
  const g = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 1.0, duration: 3.0 };
  assert.equal(chordAt({ chords: [g] }, 0.5).symbol, "G");
});

test("a chord stays in effect across bar lines, and the first symbol fills the gap before it", () => {
  const segments = chordSegments([[[2.0, "C"]], [], [[0.0, "F"], [3.0, "G"]]], stubChordTones);
  assert.deepEqual(
    segments.map((bar) => bar.map((s) => [s.symbol, s.onset, s.duration])),
    [
      [
        ["C", 0.0, 2.0],
        ["C", 2.0, 2.0],
      ],
      [["C", 0.0, 4.0]],
      [
        ["F", 0.0, 3.0],
        ["G", 3.0, 1.0],
      ],
    ],
  );
});

test("each chord segment carries the root and tones of its symbol", () => {
  const [[only]] = chordSegments([[[0.0, "G"]]], stubChordTones);
  assert.deepEqual(only, { symbol: "G", root: 7, tones: [7, 11, 2], onset: 0.0, duration: 4.0 });
});

test("chord segments of every bar cover the whole bar without gaps", () => {
  const segments = chordSegments([[[1.0, "F"], [2.5, "G"]], [[3.0, "C"]]], stubChordTones);
  for (const bar of segments) {
    assert.equal(bar[0].onset, 0);
    const total = bar.reduce((sum, s) => sum + s.duration, 0);
    assert.equal(total, BEATS_PER_BAR);
  }
});

test("a tune with no chord symbol cannot become a lead sheet", () => {
  assert.throws(() => chordSegments([[], []], stubChordTones), {
    message: "the tune has no chord symbol; a lead sheet needs at least one",
  });
});

/** A two-bar lead sheet in the Python field names that the JSON fixtures use. */
const PYTHON_LEAD_SHEET = {
  title: "Tiny tune",
  key: "C major",
  tempo_bpm: 120,
  beats_per_bar: 4,
  source_grid: [120.5, 0.25],
  bars: [
    {
      index: 0,
      label: "A",
      role: "verse",
      phrase: 0,
      phrase_end: false,
      melody: [
        { pitch: 60, onset: 0.0, duration: 2.0 },
        { pitch: 64, onset: 2.0, duration: 2.0 },
      ],
      chords: [{ symbol: "C", root: 0, tones: [0, 4, 7], onset: 0.0, duration: 4.0 }],
    },
    {
      index: 1,
      label: "B",
      role: "chorus",
      phrase: 0,
      phrase_end: true,
      melody: [{ pitch: 67, onset: 0.0, duration: 4.0 }],
      chords: [
        { symbol: "F", root: 5, tones: [5, 9, 0], onset: 0.0, duration: 2.0 },
        { symbol: "G", root: 7, tones: [7, 11, 2], onset: 2.0, duration: 2.0 },
      ],
    },
  ],
};

test("a lead sheet read from a Python-shaped fixture uses camelCase field names", () => {
  const sheet = leadSheetFromJson(PYTHON_LEAD_SHEET);
  assert.equal(sheet.title, "Tiny tune");
  assert.equal(sheet.key, "C major");
  assert.equal(sheet.tempoBpm, 120);
  assert.equal(sheet.beatsPerBar, 4);
  assert.deepEqual(sheet.sourceGrid, [120.5, 0.25]);
  assert.equal(sheet.bars.length, 2);
  assert.deepEqual(sheet.bars[1], {
    index: 1,
    melody: [{ pitch: 67, onset: 0.0, duration: 4.0 }],
    chords: [
      { symbol: "F", root: 5, tones: [5, 9, 0], onset: 0.0, duration: 2.0 },
      { symbol: "G", root: 7, tones: [7, 11, 2], onset: 2.0, duration: 2.0 },
    ],
    label: "B",
    role: "chorus",
    phrase: 0,
    phraseEnd: true,
  });
});

test("a one-bar ABC fixture becomes a lead sheet with camelCase fields", () => {
  const sheet = leadSheetFromJson({
    title: "One bar",
    key: "C major",
    tempo_bpm: 120,
    bars: [
      {
        index: 0,
        label: "A",
        role: "verse",
        phrase: 0,
        phrase_end: true,
        melody: [{ pitch: 60, onset: 0, duration: 4 }],
        chords: [{ symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 }],
      },
    ],
  });
  assert.deepEqual(
    [sheet.tempoBpm, sheet.beatsPerBar, sheet.sourceGrid, sheet.bars[0].phraseEnd],
    [120, 4, null, true],
  );
});

test("a fixture lead sheet without a source grid or meter gets null and four beats", () => {
  const { source_grid, beats_per_bar, ...abcShaped } = PYTHON_LEAD_SHEET;
  const sheet = leadSheetFromJson(abcShaped);
  assert.equal(sheet.sourceGrid, null);
  assert.equal(sheet.beatsPerBar, BEATS_PER_BAR);
});

test("a fixture may write notes and chord segments as arrays in field order", () => {
  const sheet = leadSheetFromJson({
    ...PYTHON_LEAD_SHEET,
    bars: [
      {
        index: 0,
        label: "A",
        role: "verse",
        phrase: 0,
        phrase_end: true,
        melody: [[60, 0.0, 4.0]],
        chords: [["C", 0, [0, 4, 7], 0.0, 4.0]],
      },
    ],
  });
  assert.deepEqual(sheet.bars[0].melody, [{ pitch: 60, onset: 0.0, duration: 4.0 }]);
  assert.deepEqual(sheet.bars[0].chords, [
    { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0.0, duration: 4.0 },
  ]);
});

test("reading a fixture copies its arrays, so changing the result leaves the fixture intact", () => {
  const sheet = leadSheetFromJson(PYTHON_LEAD_SHEET);
  sheet.bars[0].chords[0].tones.push(11);
  assert.deepEqual(PYTHON_LEAD_SHEET.bars[0].chords[0].tones, [0, 4, 7]);
});
