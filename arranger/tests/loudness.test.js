// @ts-check
// Tests for audio/loudness.js, which makes the chip render and the plain render equally loud, so
// that A/B compares the music and not the volume (research R7).

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderChip } from "../src/audio/chip-synth.js";
import { BLOCK_SECONDS, GATE_DB, TARGET_DB, gatedRms, matchLoudness } from "../src/audio/loudness.js";
import { leadSheetVoices, renderLeadSheet } from "../src/audio/plain-synth.js";
import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { readFixture } from "./helpers.js";

const RATE = 44100;

/** @param {number} level linear amplitude */
const toDb = (level) => 20 * Math.log10(level);

/** @param {ArrayLike<number>} samples */
function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

/**
 * `seconds` of a sine at `hz` with the given amplitude.
 * @param {number} seconds
 * @param {number} hz
 * @param {number} amplitude
 */
function sine(seconds, hz, amplitude) {
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE));
}

/** The chip and plain renders of Korobeiniki: melody on P1, chord roots on TR. */
function korobeinikiRenders() {
  const sheet = leadSheetFromJson(readFixture("leadsheets/korobeiniki.json"));
  const voices = leadSheetVoices(sheet);
  const toNotes = (/** @type {Array<{pitch: number, onset: number, duration: number}>} */ notes, shift = 0) =>
    notes.map((note) => ({ ...note, pitch: note.pitch + shift, velocity: 100 }));
  const chip = renderChip({ tempoBpm: sheet.tempoBpm, channels: { P1: toNotes(voices.melody), TR: toNotes(voices.others[0], -12) } }, RATE);
  return { plain: renderLeadSheet(sheet, RATE), chip };
}

test("gated RMS measures 400 ms blocks and leaves out blocks below -70 dBFS", () => {
  assert.equal(BLOCK_SECONDS, 0.4);
  assert.equal(GATE_DB, -70);
  assert.equal(gatedRms(new Float32Array(RATE).fill(0.5), RATE), 0.5);
  assert.ok(Math.abs(gatedRms(sine(1, 1000, 1), RATE) - Math.SQRT1_2) < 1e-3);

  // Silence after the music does not lower the level: its blocks are below the gate.
  const withSilence = new Float32Array(3 * RATE);
  withSilence.set(sine(1.2, 1000, 1));
  assert.ok(Math.abs(gatedRms(withSilence, RATE) - Math.SQRT1_2) < 1e-3);

  // Only the first 400 ms block is loud; the rest sits at -100 dBFS and is left out.
  const oneLoudBlock = new Float32Array(RATE).fill(1e-5);
  oneLoudBlock.fill(0.5, 0, BLOCK_SECONDS * RATE);
  assert.ok(Math.abs(gatedRms(oneLoudBlock, RATE) - 0.5) < 1e-6);

  // A whole signal under the gate counts as silence; just above it, it counts.
  assert.equal(gatedRms(new Float32Array(RATE).fill(10 ** (-75 / 20)), RATE), 0);
  assert.ok(Math.abs(toDb(gatedRms(new Float32Array(RATE).fill(10 ** (-65 / 20)), RATE)) - -65) < 1e-3);
  assert.equal(gatedRms(new Float32Array(0), RATE), 0);
});

test("matchLoudness brings two renders 12 dB apart to within 0.5 dB of each other", () => {
  const { plain, chip } = korobeinikiRenders();
  // Make the chip render 12 dB quieter than the plain one.
  const gain = 10 ** (-12 / 20) * (gatedRms(plain, RATE) / gatedRms(chip, RATE));
  const quietChip = chip.map((sample) => sample * gain);
  assert.ok(Math.abs(toDb(gatedRms(plain, RATE) / gatedRms(quietChip, RATE)) - 12) < 0.01);

  const matched = matchLoudness(plain, quietChip, RATE);
  const difference = toDb(gatedRms(matched.a, RATE) / gatedRms(matched.b, RATE));
  assert.ok(Math.abs(difference) < 0.5, `still ${difference} dB apart`);
  assert.equal(matched.a.length, plain.length);
  assert.equal(matched.b.length, chip.length);
});

test("neither render peaks above -1 dBFS", () => {
  const { plain, chip } = korobeinikiRenders();
  for (const [a, b] of [[plain, chip], [chip, plain]]) {
    const matched = matchLoudness(a, b, RATE);
    assert.ok(toDb(peakOf(matched.a)) <= -1 + 1e-6);
    assert.ok(toDb(peakOf(matched.b)) <= -1 + 1e-6);
  }
  // A quiet signal with one loud click would pass the ceiling at the target level: both renders
  // go down together, so they stay equally loud and the louder peak sits at the ceiling.
  const clicky = sine(2, 440, 0.01);
  clicky[RATE] = 0.9;
  const matched = matchLoudness(clicky, sine(2, 440, 0.2), RATE, { peakCeilingDb: -6 });
  assert.ok(Math.abs(toDb(peakOf(matched.a)) - -6) < 1e-4);
  assert.ok(Math.abs(toDb(gatedRms(matched.a, RATE) / gatedRms(matched.b, RATE))) < 0.5);
});

test("silence stays silence and the inputs are not changed", () => {
  const silence = new Float32Array(RATE);
  const tone = sine(1, 440, 0.5);
  const toneCopy = tone.slice();
  const matched = matchLoudness(silence, tone, RATE);
  assert.ok(matched.a.every((sample) => sample === 0));
  assert.ok(Math.abs(toDb(gatedRms(matched.b, RATE)) - TARGET_DB) < 1e-3, "the other render still reaches the target");
  assert.deepEqual(tone, toneCopy);
  assert.notEqual(matched.b, tone);
});

test("the documented examples hold", () => {
  assert.equal(TARGET_DB, -16);
  assert.equal(gatedRms(Float32Array.of(0.5, -0.5, 0.5, -0.5), 4), 0.5);
  assert.equal(gatedRms(new Float32Array(10), 4), 0);
  const { a, b } = matchLoudness(new Float32Array(100).fill(0.5), new Float32Array(100).fill(0.05), 100);
  assert.ok(Math.abs(toDb(a[0]) - -16) < 1e-4 && Math.abs(toDb(b[0]) - -16) < 1e-4);
});
