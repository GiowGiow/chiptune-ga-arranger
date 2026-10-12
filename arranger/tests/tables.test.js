// @ts-check
// Tests for core/tables.js, the score tables that measure every (bar, gene value) choice once
// before the GA starts. They port the doctests and the meter cases of src/ga/tables.py
// (tests/test_tables.py) and compare every table of the 8 committed lead sheets and the 7 meter
// test tunes with fixtures/tables/<id>.json, written by the Python code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { NO_PATTERNS, P2_TEXTURES, TR_TEXTURES } from "../src/core/genome.js";
import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { FOUR_FOUR, parseMeter } from "../src/core/meter.js";
import { TABLE_FIELDS, bassLine, buildTables } from "../src/core/tables.js";
import { assertClose, fixturesDir, readFixture } from "./helpers.js";

const LEAD_SHEET_IDS = readdirSync(join(fixturesDir, "tables"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(".json", ""));

// Python field name of each JavaScript table.
const PYTHON_NAMES = {
  actP1: "act_p1",
  actP2: "act_p2",
  actTr: "act_tr",
  actNo: "act_no",
  regBoth: "reg_both",
  regOk: "reg_ok",
  bassInner: "bass_inner",
  bassInnerLeaps: "bass_inner_leaps",
  bassAcross: "bass_across",
  singleChord: "single_chord",
  phraseEnd: "phrase_end",
  phrase: "phrase",
  isChorus: "is_chorus",
};

const BOOLEAN_FIELDS = new Set(["singleChord", "phraseEnd", "isChorus"]);

/**
 * Nest a flat row-major array into lists of the given shape, as numpy's tolist() does.
 * @param {ArrayLike<number>} flat
 * @param {number[]} shape
 * @param {(value: number) => unknown} convert
 * @returns {unknown[]}
 */
function nest(flat, shape, convert, offset = 0) {
  const [size, ...rest] = shape;
  const stride = rest.reduce((product, length) => product * length, 1);
  return Array.from({ length: size }, (_, index) =>
    rest.length === 0 ? convert(flat[offset + index]) : nest(flat, rest, convert, offset + index * stride),
  );
}

/** @param {string} id */
function oneBarSheet(id) {
  return leadSheetFromJson({
    title: id,
    key: "c major",
    tempo_bpm: 120,
    bars: [
      {
        index: 0,
        label: "A",
        role: "verse",
        phrase: 0,
        phrase_end: true,
        melody: [{ pitch: 72, onset: 0, duration: 4 }],
        chords: [{ symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 }],
      },
    ],
  });
}

test("the table fixtures cover the 8 committed lead sheets and the 7 meter tunes", () => {
  assert.deepEqual([...LEAD_SHEET_IDS].sort(), [
    "amor_i_love_you",
    "aquarela",
    "changes",
    "fico_assim_sem_voce",
    "five",
    "ievan_polkka",
    "jig",
    "korobeiniki",
    "mulher_de_fases",
    "polka",
    "por_voce",
    "seven",
    "slow_twelve",
    "voa_voa",
    "waltz",
  ]);
});

test("the tables are the 13 fields of the Python ScoreTables", () => {
  assert.deepEqual([...TABLE_FIELDS], Object.keys(PYTHON_NAMES));
});

test("one bar of C under a whole-note melody: arp16 is fully active and no bar line is crossed", () => {
  const tables = buildTables(oneBarSheet("one bar"));
  assert.equal(tables.nBars, 1);
  assert.equal(tables.actP2[0 * 5 + 1], 1);
  assert.deepEqual(tables.shape.bassAcross, [0, 4, 4]);
  assert.equal(tables.bassAcross.length, 0);
  // root, octave_pump, root_fifth, walking
  assert.deepEqual([...tables.bassInnerLeaps], [0, 3, 3, 3]);
});

test("each table has the typed array and the length its shape says", () => {
  const tables = buildTables(leadSheetFromJson(readFixture("leadsheets/korobeiniki.json")));
  const n = 32;
  assert.deepEqual(tables.shape, {
    actP1: [n, 3],
    actP2: [n, 5],
    actTr: [n, 4],
    actNo: [n, 5],
    regBoth: [n, 3, 5],
    regOk: [n, 3, 5],
    bassInner: [n, 4],
    bassInnerLeaps: [n, 4],
    bassAcross: [n - 1, 4, 4],
    singleChord: [n],
    phraseEnd: [n],
    phrase: [n],
    isChorus: [n],
  });
  for (const field of TABLE_FIELDS) {
    const size = tables.shape[field].reduce((product, length) => product * length, 1);
    assert.equal(tables[field].length, size, field);
  }
  for (const field of ["actP1", "actP2", "actTr", "actNo", "bassInner", "bassAcross"]) {
    assert.ok(tables[field] instanceof Float64Array, field);
  }
  for (const field of ["regBoth", "regOk", "bassInnerLeaps", "phrase"]) {
    assert.ok(tables[field] instanceof Int32Array, field);
  }
  for (const field of BOOLEAN_FIELDS) assert.ok(tables[field] instanceof Uint8Array, field);
});

test("a 3/4 bar is measured on its twelve sixteenth steps", () => {
  const waltz = parseMeter("3/4");
  const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 3 };
  const quarters = [0, 1, 2].map((beat) => ({ pitch: 72, onset: beat, duration: 1 }));
  const bar = { index: 0, melody: quarters, chords: [c], label: "A", role: /** @type {const} */ ("verse"),
    phrase: 0, phraseEnd: true, meter: waltz };
  const tables = buildTables({ title: "waltz", key: "c major", tempoBpm: 120, bars: [bar], sourceGrid: null });
  assert.equal(tables.actP1[0], 3 / 12);
  assert.equal(tables.actTr[TR_TEXTURES.indexOf("octave_pump")], 6 / 12);
  assert.equal(tables.actNo[NO_PATTERNS.indexOf("eighth_beat")], 6 / 12);
  assert.equal(tables.actNo[NO_PATTERNS.indexOf("sixteenth_beat")], 1);
  // P2 holds C3 under the melody C5 on all 12 steps.
  const hold = P2_TEXTURES.indexOf("hold");
  assert.equal(tables.regBoth[hold], 12);
  assert.equal(tables.regOk[hold], 12);
});

test("the drum activity of a bar follows its meter: one row of 5 patterns per bar", () => {
  const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 };
  const four = { index: 0, melody: [], chords: [c], label: "A", role: /** @type {const} */ ("verse"),
    phrase: 0, phraseEnd: false, meter: FOUR_FOUR };
  const three = { ...four, index: 1, chords: [{ ...c, duration: 3 }], phraseEnd: true, meter: parseMeter("3/4") };
  const tables = buildTables({ title: "mixed", key: "", tempoBpm: 120, bars: [four, three], sourceGrid: null });
  const fill = NO_PATTERNS.indexOf("fill");
  assert.equal(tables.actNo.length, 2 * 5);
  assert.equal(tables.actNo[0 * 5 + fill], 10 / 16); // 6 hits before beat 4, then 4 snare sixteenths
  assert.equal(tables.actNo[1 * 5 + fill], 8 / 12); // 4 hits before beat 3, then 4 snare sixteenths
});

test("the octave pump's bass line is its roots on the beats", () => {
  assert.deepEqual(
    bassLine(TR_TEXTURES.indexOf("octave_pump"), [36, 48, 36, 48, 43, 55, 43, 55]),
    [36, 36, 43, 43],
  );
});

test("a walking bass line keeps every note", () => {
  assert.deepEqual(bassLine(TR_TEXTURES.indexOf("walking"), [36, 40, 43, 42]), [36, 40, 43, 42]);
});

for (const id of LEAD_SHEET_IDS) {
  test(`every score table of ${id} matches the Python tables to 6 decimals`, () => {
    const tables = buildTables(leadSheetFromJson(readFixture(`leadsheets/${id}.json`)));
    const expected = readFixture(`tables/${id}.json`);
    assert.deepEqual(Object.keys(expected).sort(), Object.values(PYTHON_NAMES).sort());
    for (const field of TABLE_FIELDS) {
      const convert = BOOLEAN_FIELDS.has(field) ? (/** @type {number} */ value) => value === 1 : Number;
      const actual = nest(tables[field], tables.shape[field], convert);
      assertClose(actual, expected[PYTHON_NAMES[field]]);
    }
  });
}
