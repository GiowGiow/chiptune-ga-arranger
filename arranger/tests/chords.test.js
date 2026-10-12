// @ts-check
// Tests for core/chords.js: chord symbols turned into pitch classes, and pitch classes placed in
// a register. The Python code asks music21 for the chord tones (src/leadsheet/chords.py); the
// JavaScript port uses its own table of chord qualities, so these tests check it against the
// roots and tones that music21 gives, stored by the Python code in fixtures/chords.json.

import assert from "node:assert/strict";
import { test } from "node:test";

import { chordTones, placeInRegister } from "../src/core/chords.js";
import { readFixture } from "./helpers.js";

/** @type {{symbols: Record<string, [number, number[]]>, rejected: string[]}} */
const fixture = readFixture("chords.json");

/**
 * @param {string} symbol
 * @returns {(error: unknown) => boolean} a check that the error is an Error naming the symbol
 */
function namesSymbol(symbol) {
  return (error) => error instanceof Error && error.message.includes(`'${symbol}'`);
}

test("the docstring examples: Am is A C E and Bbm7 is Bb Db F Ab", () => {
  assert.deepEqual(chordTones("Am"), [9, [9, 0, 4]]);
  assert.deepEqual(chordTones("Bbm7"), [10, [10, 1, 5, 8]]);
});

test("every chord symbol of the fixture has the root and tones that music21 gives", () => {
  const symbols = Object.keys(fixture.symbols);
  assert.ok(symbols.length > 40, "the fixture lists the lead sheets' symbols and common ones");
  for (const symbol of symbols) {
    assert.deepEqual(chordTones(symbol), fixture.symbols[symbol], `chord ${symbol}`);
  }
});

test("music21's quirks are kept: sus chords have no third, sixths and ninths add nothing beyond the seventh", () => {
  assert.deepEqual(chordTones("Csus4"), [0, [0, 7]]);
  assert.deepEqual(chordTones("Csus2"), [0, [0, 7]]);
  assert.deepEqual(chordTones("C6"), [0, [0, 4, 7]]);
  assert.deepEqual(chordTones("C9"), [0, [0, 4, 7, 10]]);
  assert.deepEqual(chordTones("Cadd9"), [0, [0, 4, 7]]);
});

test("every rejected symbol of the fixture throws an error that names it", () => {
  assert.deepEqual(fixture.rejected, ["Cxyz", "H7"]);
  for (const symbol of fixture.rejected) {
    assert.throws(() => chordTones(symbol), namesSymbol(symbol));
  }
});

test("other spellings that music21 reads give the same tones as music21", () => {
  // Values printed by music21 10.5 through src/leadsheet/chords.py `chord_tones`.
  /** @type {Record<string, [number, number[]]>} */
  const music21 = {
    Cmin: [0, [0, 3, 7]],
    Cmin7: [0, [0, 3, 7, 10]],
    Cmaj: [0, [0, 4, 7]],
    CM: [0, [0, 4, 7]],
    CM7: [0, [0, 4, 7, 11]],
    Cdom7: [0, [0, 4, 7, 10]],
    Co: [0, [0, 3, 6]],
    Co7: [0, [0, 3, 6, 9]],
    "C+": [0, [0, 4, 8]],
    "C+7": [0, [0, 4, 8, 10]],
    Caug7: [0, [0, 4, 8, 10]],
    "C7#5": [0, [0, 4, 8, 10]],
    C7b5: [0, [0, 4, 6, 10]],
    "Cø7": [0, [0, 3, 6, 10]],
    Csus: [0, [0, 7]],
    C7sus4: [0, [0, 7, 10]],
    C5: [0, [0, 7]],
    Cm9: [0, [0, 3, 7, 10]],
    CM9: [0, [0, 4, 7, 11]],
    C11: [0, [0, 4, 7, 10]],
    C13: [0, [0, 4, 7, 10]],
    CmM7: [0, [0, 3, 7, 11]],
    C7b9: [0, [0, 4, 7, 10]],
    "C7#9": [0, [0, 4, 7, 10]],
    Cb: [11, [11, 3, 6]],
    "B#": [0, [0, 4, 7]],
    "E#": [5, [5, 9, 0]],
    Fb: [4, [4, 8, 11]],
    "F#dim": [6, [6, 9, 0]],
    Bbaug: [10, [10, 2, 6]],
  };
  for (const [symbol, expected] of Object.entries(music21)) {
    assert.deepEqual(chordTones(symbol), expected, `chord ${symbol}`);
  }
});

test("a slash chord keeps its chord, and a bass note a seventh above the root becomes the seventh", () => {
  // music21 adds the bass as the seventh when its letter is the seventh letter above the root
  // (C/Bb is C7, C/B is Cmaj7), and otherwise leaves the chord as it is (D/F#, C/G, C/A#).
  /** @type {Record<string, [number, number[]]>} */
  const music21 = {
    "D/F#": [2, [2, 6, 9]],
    "C/G": [0, [0, 4, 7]],
    "G/B": [7, [7, 11, 2]],
    "C/A#": [0, [0, 4, 7]],
    "C/Bb": [0, [0, 4, 7, 10]],
    "C/B": [0, [0, 4, 7, 11]],
    "Am/G": [9, [9, 0, 4, 7]],
    "Am/G#": [9, [9, 0, 4, 8]],
    "C7/B": [0, [0, 4, 7, 11]],
    "Cmaj7/E": [0, [0, 4, 7, 11]],
    "F#maj7/E": [6, [6, 10, 1, 4]],
    "Csus4/Bb": [0, [0, 7, 10]],
    "Cdim7/Bb": [0, [0, 3, 6, 10]],
    "Ebm/Db": [3, [3, 6, 10, 1]],
  };
  for (const [symbol, expected] of Object.entries(music21)) {
    assert.deepEqual(chordTones(symbol), expected, `chord ${symbol}`);
  }
});

test("symbols that music21 does not read either are rejected with their name", () => {
  for (const symbol of ["Cmi", "CMaj7", "Cmaj9", "C6/9", "N.C.", "C/H", "C/", "C/E/G", ""]) {
    assert.throws(() => chordTones(symbol), namesSymbol(symbol));
  }
});

test("each call returns a fresh tones array, so changing it leaves the table intact", () => {
  const [, tones] = chordTones("C");
  tones.push(99);
  assert.deepEqual(chordTones("C"), [0, [0, 4, 7]]);
});

test("placeInRegister: C at the bottom of a register starting on C3 is C3", () => {
  assert.equal(placeInRegister(0, 48), 48);
});

test("placeInRegister: a register starting on D3 puts C# on C#4", () => {
  assert.equal(placeInRegister(1, 50), 61);
});

test("placeInRegister always lands inside [low, low + 11] on the right pitch class", () => {
  for (let low = 30; low < 80; low += 7) {
    for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
      const pitch = placeInRegister(pitchClass, low);
      assert.ok(pitch >= low && pitch <= low + 11, `${pitchClass} from ${low} gave ${pitch}`);
      assert.equal(pitch % 12, pitchClass);
    }
  }
});
