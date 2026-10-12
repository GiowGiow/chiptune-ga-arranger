// @ts-check
// Shared helpers for the node:test suites of the browser arranger.
//
// The JavaScript core is a port of the Python command line (`src/`), and most tests compare it
// with reference values that `uv run src/main.py fixtures` (src/export/fixtures.py) writes to
// `arranger/tests/fixtures/`. Those JSON files keep Python's field names and store NaN as
// `null`, because JSON has no NaN. This module gives every test the same way to:
//
// - find the repository (`repoRoot`) and the fixtures (`fixturesDir`, `readFixture`);
// - turn `null` back into NaN where a value means "criterion not applicable" (`nullToNaN`);
// - compare numbers to a number of decimal places, like numpy's `assert_almost_equal`
//   (`assertClose`), since the scores are compared to 6 decimals (SC-010);
// - load the vendored abcjs parser without a browser (`loadAbcjs`, research R3);
// - find a MIDI song in `data/raw/`, which is not committed (`rawMidiPath`), so a test can skip
//   with "run uv run src/main.py fetch" when the file is missing;
// - build a MIDI file whose meter changes (`withTimeSignatures`), such as a song that opens with
//   a 3/4 count-in (`countInSongBytes`), since `writeMidiFile` writes a single time signature.
//
// This file is not a test itself: node --test only runs files named `*.test.js`.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeMidiFile } from "../src/core/midi-file.js";

const testsDir = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the repository root (the folder that holds `arranger/` and `src/`). */
export const repoRoot = resolve(testsDir, "..", "..");

/** Absolute path of `arranger/tests/fixtures/`, written by `uv run src/main.py fixtures`. */
export const fixturesDir = join(testsDir, "fixtures");

/**
 * Turn every `null` inside a JSON value into NaN, keeping everything else.
 *
 * The Python fixtures write NaN (a criterion that does not apply) as `null`.
 *
 * @param {unknown} value a parsed JSON value
 * @returns {unknown} a copy of `value` with NaN in place of each `null`
 * @example
 * nullToNaN([[1, null], null, "x"]); // [[1, NaN], NaN, "x"]
 */
export function nullToNaN(value) {
  if (value === null) return Number.NaN;
  if (Array.isArray(value)) return value.map(nullToNaN);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, nullToNaN(item)]));
  }
  return value;
}

/**
 * @typedef {object} ReadOptions
 * @property {boolean | string[]} [nullAsNaN] `true` turns every `null` into NaN; a list of keys
 *   turns `null` into NaN only inside the values of those keys, at any depth. The default,
 *   `false`, keeps `null` (for example `tempo_bpm: null` means "read the tempo from the file").
 */

/**
 * Read and parse a JSON file, optionally turning `null` back into NaN.
 *
 * @param {string} path absolute path of the JSON file
 * @param {ReadOptions} [options]
 * @returns {any} the parsed value
 * @example
 * // tables/korobeiniki.json holds {"act_p2": [[0.5, null], ...], ...}
 * readJson(path, { nullAsNaN: ["act_p2"] }).act_p2[0]; // [0.5, NaN]
 */
export function readJson(path, options = {}) {
  const { nullAsNaN = false } = options;
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (nullAsNaN === true) return nullToNaN(value);
  if (nullAsNaN === false || nullAsNaN.length === 0) return value;
  return convertKeys(value, new Set(nullAsNaN));
}

/**
 * Walk a JSON value and apply `nullToNaN` to the values of the named keys.
 *
 * @param {unknown} value
 * @param {Set<string>} keys
 * @returns {unknown}
 */
function convertKeys(value, keys) {
  if (Array.isArray(value)) return value.map((item) => convertKeys(item, keys));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, keys.has(key) ? nullToNaN(item) : convertKeys(item, keys)]),
    );
  }
  return value;
}

/**
 * Read a fixture from `arranger/tests/fixtures/`.
 *
 * It throws (with the full path in the message) only when the file is missing, so importing
 * this module works while the fixtures folder is still empty.
 *
 * @param {string} relativePath path inside the fixtures folder, for example `"chords.json"`
 * @param {ReadOptions} [options] see `readJson`
 * @returns {any} the parsed fixture
 * @example
 * readFixture("tables/korobeiniki.json", { nullAsNaN: ["act_p2"] });
 */
export function readFixture(relativePath, options = {}) {
  const path = join(fixturesDir, relativePath);
  if (!existsSync(path)) {
    throw new Error(`missing fixture ${path}; run uv run src/main.py fixtures`);
  }
  return readJson(path, options);
}

/**
 * Assert that two numbers, or two arrays or objects of numbers, agree to `decimals` places.
 *
 * The test is numpy's `assert_almost_equal`: `|actual - expected| < 1.5 * 10^-decimals`.
 * NaN and `null` count as equal to each other (a fixture stores NaN as `null`). Arrays and
 * plain objects are compared element by element; any other value (a string, a boolean) must be
 * strictly equal. The error message names the failing index, for example `at [3][1]`.
 *
 * @param {unknown} actual the value the JavaScript code computed
 * @param {unknown} expected the reference value (usually from a fixture)
 * @param {number} [decimals] number of decimal places that must agree (default 6)
 * @returns {void}
 * @example
 * assertClose(0.1 + 0.2, 0.3); // passes
 * assertClose([[1, NaN]], [[1.0000001, null]]); // passes
 * assertClose(0.922123, 0.922126); // throws
 */
export function assertClose(actual, expected, decimals = 6) {
  compare(actual, expected, 1.5 * 10 ** -decimals, decimals, "");
}

/**
 * @param {unknown} value
 * @returns {value is number | null}
 */
function isNumeric(value) {
  return value === null || typeof value === "number";
}

/**
 * Recursive step of `assertClose`.
 *
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {number} tolerance
 * @param {number} decimals
 * @param {string} where index path of the current value, for the error message
 * @returns {void}
 */
function compare(actual, expected, tolerance, decimals, where) {
  const at = where === "" ? "" : ` at ${where}`;
  if (isNumeric(actual) && isNumeric(expected)) {
    const actualNaN = actual === null || Number.isNaN(actual);
    const expectedNaN = expected === null || Number.isNaN(expected);
    if (actualNaN || expectedNaN) {
      assert.ok(actualNaN && expectedNaN, `expected ${expected}, got ${actual}${at}`);
      return;
    }
    const a = /** @type {number} */ (actual);
    const e = /** @type {number} */ (expected);
    assert.ok(Math.abs(a - e) < tolerance, `${a} is not ${e} to ${decimals} decimal places${at}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `expected an array, got ${typeof actual}${at}`);
    assert.equal(actual.length, expected.length, `array length ${actual.length}, expected ${expected.length}${at}`);
    expected.forEach((item, i) => compare(actual[i], item, tolerance, decimals, `${where}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    assert.ok(actual !== null && typeof actual === "object" && !Array.isArray(actual), `expected an object${at}`);
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    assert.deepEqual(actualKeys, expectedKeys, `object keys differ${at}`);
    for (const key of expectedKeys) {
      compare(
        /** @type {Record<string, unknown>} */ (actual)[key],
        /** @type {Record<string, unknown>} */ (expected)[key],
        tolerance,
        decimals,
        `${where}.${key}`,
      );
    }
    return;
  }
  assert.equal(actual, expected, `values differ${at}`);
}

/**
 * Load the vendored abcjs 6.7.1 parser (`arranger/vendor/abcjs/abcjs-basic-min.js`).
 *
 * The bundle is UMD, so Node loads it with `require` (an ES `import` fails). The
 * `package.json` next to it marks that folder as CommonJS, because `arranger/` itself is
 * `"type": "module"`. The page loads the same file with a classic `<script>` instead.
 *
 * @returns {any} the `ABCJS` object, with `parseOnly(text)`
 * @example
 * loadAbcjs().parseOnly("X:1\nK:C\nCDEF|\n").length; // 1
 */
export function loadAbcjs() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "arranger", "vendor", "abcjs", "abcjs-basic-min.js"));
}

/**
 * Absolute path of `data/raw/<relative>`, or `null` when the file is missing.
 *
 * `data/raw/` holds the MIDI songs fetched by `uv run src/main.py fetch` and is not committed,
 * so a test that needs one skips without it.
 *
 * @param {string} relative path inside `data/raw/`, for example `"mpb/amor_i_love_you.mid"`
 * @returns {string | null}
 * @example
 * const path = rawMidiPath("mpb/amor_i_love_you.mid");
 * if (path === null) t.skip("run uv run src/main.py fetch");
 */
export function rawMidiPath(relative) {
  const path = join(repoRoot, "data", "raw", relative);
  return existsSync(path) ? path : null;
}

/**
 * Give a MIDI file written by `writeMidiFile` other time signatures (it writes one, at tick 0).
 *
 * Track 0 is rebuilt with its tempo and the given time signatures; the other tracks stay as they
 * are.
 *
 * @param {Uint8Array} bytes a file from `writeMidiFile`: its track 0 opens with the tempo
 * @param {Array<[number, number, number]>} timeSignatures [numerator, denominator, tick] in tick
 *   order; each denominator a power of two
 * @param {Array<[number, number]> | null} [tempos] [BPM, tick] pairs that replace the file's
 *   single tempo; null keeps it
 * @returns {Uint8Array} the new file
 * @example
 * // At 120 BPM and 480 ticks per beat: two 3/4 bars of count-in, then 4/4 from 3 s on.
 * readMidiFile(withTimeSignatures(bytes, [[3, 4, 0], [4, 4, 2880]])).timeSignatures;
 * // [{ numerator: 3, denominator: 4, time: 0 }, { numerator: 4, denominator: 4, time: 3 }]
 */
export function withTimeSignatures(bytes, timeSignatures, tempos = null) {
  const trackStart = 14 + 8; // the header chunk, then "MTrk" and the track length
  const tempoEvent = [...bytes.subarray(trackStart, trackStart + 7)]; // delta 0, FF 51 03 and 3 bytes
  if (tempoEvent[1] !== 0xff || tempoEvent[2] !== 0x51) throw new Error("track 0 does not open with the tempo");
  // Meta events in tick order; at the same tick a time signature comes before a tempo.
  /** @type {Array<[number, number[]]>} */
  const metas = timeSignatures.map(([numerator, denominator, at]) => [
    at,
    [0xff, 0x58, 4, numerator, Math.log2(denominator), 24, 8],
  ]);
  if (tempos) {
    for (const [bpm, at] of tempos) {
      const micros = Math.round(60_000_000 / bpm);
      metas.push([at + 0.5, [0xff, 0x51, 3, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff]]);
    }
  }
  metas.sort((a, b) => a[0] - b[0]);
  const events = tempos ? [] : [...tempoEvent];
  let tick = 0;
  for (const [at, event] of metas) {
    const exact = Math.floor(at);
    events.push(...varIntBytes(exact - tick), ...event);
    tick = exact;
  }
  events.push(0, 0xff, 0x2f, 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rest = bytes.subarray(trackStart + view.getUint32(trackStart - 4));
  const length = [24, 16, 8, 0].map((shift) => (events.length >>> shift) & 0xff);
  return Uint8Array.from([...bytes.subarray(0, trackStart - 4), ...length, ...events, ...rest]);
}

/**
 * A variable-length quantity: 7 bits per byte, the high bit set on all but the last.
 * @param {number} value non-negative integer
 * @returns {number[]}
 */
function varIntBytes(value) {
  const bytes = [value & 0x7f];
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}

/**
 * The count-in song of `write_count_in_song` in tests/test_midi_reader.py: at 120 BPM, two 3/4
 * bars of count-in, then four 4/4 bars (C, G, C, G) from 3 s on.
 *
 * The voice (track 0) plays a pickup G4 on the last count-in beat, then C5 or D5 for two beats on
 * each 4/4 downbeat; a guitar plays the triads, a bass their roots, and drums every beat.
 *
 * @param {Array<[number, number, number]>} [timeSignatures] [numerator, denominator, tick] at
 *   480 ticks per beat; default 3/4 at 0 and 4/4 at 2880 (3 s)
 * @returns {Uint8Array} the file's bytes
 * @example
 * readMidiFile(countInSongBytes()).timeSignatures.map((ts) => ts.time); // [0, 3]
 */
export function countInSongBytes(timeSignatures = [[3, 4, 0], [4, 4, 2880]]) {
  const beat = 0.5;
  const leadIn = 2 * 3 * beat;
  const note = (/** @type {number} */ start, /** @type {number} */ end, /** @type {number} */ pitch) => ({ start, end, pitch, velocity: 90 });
  const voice = [note(leadIn - beat, leadIn, 67)];
  /** @type {typeof voice} */
  const guitar = [];
  /** @type {typeof voice} */
  const bass = [];
  const drums = Array.from({ length: 6 + 16 }, (_, b) => note(b * beat, b * beat + 0.1, 36));
  for (let bar = 0; bar < 4; bar += 1) {
    const start = leadIn + bar * 4 * beat;
    const end = start + 4 * beat;
    voice.push(note(start, start + 2 * beat, 72 + (bar % 2) * 2));
    const triad = bar % 2 === 0 ? [60, 64, 67] : [55, 59, 62];
    for (const pitch of triad) guitar.push(note(start, end, pitch));
    bass.push(note(start, end, triad[0] - 24));
  }
  const bytes = writeMidiFile({
    tempoBpm: 120,
    tracks: [
      { name: "Sax", channel: 0, program: 66, notes: voice },
      { name: "Guitar", channel: 1, program: 27, notes: guitar },
      { name: "Bass", channel: 2, program: 33, notes: bass },
      { name: "Drums", channel: 9, program: 0, notes: drums },
    ],
  });
  return withTimeSignatures(bytes, timeSignatures);
}
