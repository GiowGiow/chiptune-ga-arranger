// @ts-check
// Tests for audio/chip-synth.js, the NES chip synthesizer (port of src/export/chip_audio.py).
//
// They read as the rules of the chip sound: the pulse duty cycles, the 16-level triangle, the
// two periods of the noise register, note lengths with 2 ms fades, the -3 dBFS peak and
// determinism. The last test compares a short render with Python's `synthesize`, whose output
// is committed in fixtures/web/chip-reference.json (a scratch script made it once with uv).

import { test } from "node:test";
import assert from "node:assert/strict";

import { readFixture } from "./helpers.js";
import {
  CHANNEL_GAINS,
  CPU_CLOCK_HZ,
  DRUM_SOUNDS,
  FADE_SECONDS,
  NOISE_PERIODS,
  PEAK_LEVEL,
  PULSE_DUTY,
  SAMPLE_RATE,
  TRIANGLE_STEPS,
  lfsrCycle,
  noiseWave,
  pulseWave,
  renderChip,
  triangleWave,
  velocityToVolume,
} from "../src/audio/chip-synth.js";

/** @typedef {import("../src/audio/chip-synth.js").ChipNote} ChipNote */
/** @typedef {import("../src/audio/chip-synth.js").ChannelName} ChannelName */

/**
 * An arrangement where only `channel` plays, with the given notes.
 * @param {ChannelName} channel
 * @param {ChipNote[]} notes
 * @param {number} [tempoBpm]
 */
function soloArrangement(channel, notes, tempoBpm = 120) {
  /** @type {Record<ChannelName, ChipNote[]>} */
  const channels = { P1: [], P2: [], TR: [], NO: [] };
  channels[channel] = notes;
  return { tempoBpm, channels };
}

/** A short piece with every channel playing, including drum hits. */
const BAND = {
  tempoBpm: 140,
  channels: {
    P1: [
      { pitch: 76, onset: 0, duration: 1, velocity: 100 },
      { pitch: 71, onset: 1, duration: 0.5, velocity: 100 },
      { pitch: 72, onset: 1.5, duration: 2.5, velocity: 100 },
    ],
    P2: [
      { pitch: 64, onset: 0, duration: 2, velocity: 80 },
      { pitch: 60, onset: 2, duration: 2, velocity: 80 },
    ],
    TR: [
      { pitch: 45, onset: 0, duration: 2, velocity: 100 },
      { pitch: 40, onset: 2, duration: 2, velocity: 100 },
    ],
    NO: [
      { pitch: 36, onset: 0, duration: 0.5, velocity: 100 },
      { pitch: 42, onset: 1, duration: 0.5, velocity: 60 },
      { pitch: 38, onset: 2, duration: 0.5, velocity: 90 },
      { pitch: 42, onset: 3, duration: 0.5, velocity: 60 },
    ],
  },
};

/** @param {ArrayLike<number>} samples */
function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

/**
 * The smallest shift p with stream[i] === stream[i + p] for every i.
 * @param {ArrayLike<number>} stream
 */
function shortestPeriod(stream) {
  for (let period = 1; period < stream.length; period++) {
    let repeats = true;
    for (let i = 0; i + period < stream.length && repeats; i++) repeats = stream[i] === stream[i + period];
    if (repeats) return period;
  }
  return stream.length;
}

test("a P1 note is high for 25% of its samples and a P2 note for 12.5%", () => {
  for (const [channel, duty] of /** @type {const} */ ([["P1", 0.25], ["P2", 0.125]])) {
    // Two beats at 120 BPM: a note of 1 s, 44,100 samples.
    const samples = renderChip(soloArrangement(channel, [{ pitch: 69, onset: 0, duration: 2, velocity: 100 }]));
    const note = samples.subarray(0, SAMPLE_RATE);
    const highShare = note.filter((sample) => sample > 0).length / note.length;
    assert.ok(Math.abs(highShare - duty) <= 0.01, `${channel}: ${highShare} of the samples are high`);
  }
});

test("the triangle uses exactly 16 levels from -1 to 1", () => {
  const triangle = triangleWave(110, SAMPLE_RATE, SAMPLE_RATE);
  assert.equal(new Set(triangle).size, 16);
  assert.equal(Math.min(...triangle), -1);
  assert.equal(Math.max(...triangle), 1);
  // A TR note keeps the 16 steps between its fades (mean removal and gain only shift and scale).
  const samples = renderChip(soloArrangement("TR", [{ pitch: 45, onset: 0, duration: 2, velocity: 100 }]));
  assert.equal(new Set(samples.subarray(1000, 40000)).size, 16);
});

test("the long-mode LFSR repeats after 32,767 steps and the short mode after 93", () => {
  assert.equal(lfsrCycle(false).length, 32767);
  assert.equal(lfsrCycle(true).length, 93);
  // At CPU_CLOCK_HZ / 4 samples per second, a period-4 register ticks once per sample, so the
  // noise wave shows the register's own stream; its shortest repeat is the cycle length.
  const oneTickPerSample = CPU_CLOCK_HZ / 4;
  assert.equal(shortestPeriod(noiseWave(2 * 32767, 4, false, oneTickPerSample)), 32767);
  assert.equal(shortestPeriod(noiseWave(2 * 93, 4, true, oneTickPerSample)), 93);
});

test("a note lasts duration × 60 / tempo seconds of samples, with 2 ms fades", () => {
  // One beat at 120 BPM from beat 0.25: 0.5 s from 0.125 s. 0.125 s × 44,100 = 5512.5 samples,
  // and the note starts at sample 5512 because Python's round() sends halves to the even side.
  const samples = renderChip(soloArrangement("P1", [{ pitch: 69, onset: 0.25, duration: 1, velocity: 100 }]));
  const first = 5512;
  const length = 0.5 * SAMPLE_RATE;
  assert.equal(samples.length, Math.ceil((0.625 + 0.15) * SAMPLE_RATE), "the end plus the longest drum hit");
  assert.ok(samples.subarray(0, first).every((sample) => sample === 0), "silence before the note");
  assert.ok(samples.subarray(first + length).every((sample) => sample === 0), "silence after the note");
  assert.equal(samples[first], 0, "the fade-in starts from silence");
  assert.equal(samples[first + length - 1], 0, "the fade-out ends in silence");
  assert.notEqual(samples[first + 1], 0);
  assert.notEqual(samples[first + length - 2], 0);

  // Between the fades the pulse holds two values; each fade is a straight 2 ms ramp to them.
  const fade = Math.round(FADE_SECONDS * SAMPLE_RATE); // 88 samples
  const body = samples.subarray(first + fade, first + length - fade);
  const high = Math.max(...body);
  const low = Math.min(...body);
  assert.equal(new Set(body).size, 2);
  for (let k = 1; k < fade; k++) {
    for (const index of [first + k, first + length - 1 - k]) {
      const full = samples[index] > 0 ? high : low;
      assert.ok(Math.abs(samples[index] / full - k / fade) < 1e-5, `sample ${index} is not at ${k}/${fade}`);
    }
  }
});

test("a drum hit lasts its decay unless the next hit cuts it", () => {
  const kickSamples = Math.round(DRUM_SOUNDS[36].decaySeconds * SAMPLE_RATE); // 5292
  const alone = renderChip(soloArrangement("NO", [{ pitch: 36, onset: 0, duration: 1, velocity: 100 }]));
  assert.notEqual(alone[kickSamples - 2], 0);
  assert.ok(alone.subarray(kickSamples - 1).every((sample) => sample === 0));

  // A hi-hat 0.1 beat later (50 ms at 120 BPM) stops the kick: the noise channel has one voice.
  const cut = renderChip(
    soloArrangement("NO", [
      { pitch: 36, onset: 0, duration: 0.1, velocity: 100 },
      { pitch: 42, onset: 0.1, duration: 0.1, velocity: 60 },
    ]),
  );
  const hiHatStart = 0.05 * SAMPLE_RATE; // sample 2205
  assert.notEqual(alone[hiHatStart - 1], 0);
  assert.equal(cut[hiHatStart - 1], 0, "the kick fades out where the hi-hat starts");
});

test("the mix peaks at -3 dBFS within 0.01 dB", () => {
  const peakDb = 20 * Math.log10(peakOf(renderChip(BAND)));
  assert.ok(Math.abs(peakDb - -3) < 0.01, `peak at ${peakDb} dBFS`);
});

test("the same arrangement renders identical samples twice", () => {
  assert.deepEqual(renderChip(BAND), renderChip(BAND));
  assert.deepEqual(renderChip(BAND, 48000), renderChip(BAND, 48000));
});

test("empty channels give silence", () => {
  // Like Python's synthesize on a MIDI file without notes: 0.15 s (the longest drum hit) of zeros.
  const empty = renderChip({ tempoBpm: 120, channels: { P1: [], P2: [], TR: [], NO: [] } });
  assert.ok(empty instanceof Float32Array);
  assert.equal(empty.length, Math.ceil(0.15 * SAMPLE_RATE));
  assert.ok(empty.every((sample) => sample === 0));
  // A missing channel counts as empty, and a drum note without a chip sound stays silent.
  const unknownDrum = renderChip({ tempoBpm: 120, channels: { NO: [{ pitch: 49, onset: 0, duration: 1, velocity: 100 }] } });
  assert.ok(unknownDrum.every((sample) => sample === 0));
});

test("the documented examples hold", () => {
  assert.deepEqual([127, 100, 60, 1].map(velocityToVolume), [15, 12, 7, 1]);
  assert.deepEqual([...pulseWave(44100 / 8, 8, 0.25, 44100)], [1, 1, -1, -1, -1, -1, -1, -1]);
  const triangle = triangleWave(44100 / 32, 32, 44100);
  assert.deepEqual([0, 8, 15, 16, 31].map((i) => Math.round(triangle[i] * 1e8) / 1e8), [1, -0.06666667, -1, -1, 1]);
  assert.deepEqual([lfsrCycle(false).length, lfsrCycle(true).length], [32767, 93]);
  const ones = (/** @type {Uint8Array} */ bits) => bits.reduce((sum, bit) => sum + bit, 0);
  assert.deepEqual([ones(lfsrCycle(false)), ones(lfsrCycle(true))], [16384, 16]);
  const noise = noiseWave(1000, 16, false, 44100);
  assert.deepEqual([...new Set(noise)].sort(), [-1, 1]);
  assert.deepEqual(noise, noiseWave(1000, 16, false, 44100));

  assert.equal(NOISE_PERIODS.length, 16);
  assert.equal(NOISE_PERIODS[13], 1016);
  assert.deepEqual(PULSE_DUTY, { P1: 0.25, P2: 0.125 });
  assert.equal(Math.round(CHANNEL_GAINS.TR * 1e4) / 1e4, 1.1316);
  assert.equal(Math.round(CHANNEL_GAINS.NO * 1e4) / 1e4, 0.6569);
  assert.deepEqual(DRUM_SOUNDS[42], { period: 8, shortMode: true, decaySeconds: 0.04 });
  assert.equal(Math.round(FADE_SECONDS * 44100), 88);
  assert.deepEqual(TRIANGLE_STEPS.slice(14, 18), [1, 0, 0, 1]);
  assert.equal(Math.round(CPU_CLOCK_HZ / NOISE_PERIODS[0]), 447443);
  assert.equal(Math.round(20 * Math.log10(PEAK_LEVEL) * 1e6) / 1e6, -3);
  assert.equal(SAMPLE_RATE, 44100);

  const samples = renderChip({ tempoBpm: 120, channels: { P1: [{ pitch: 69, onset: 0, duration: 1, velocity: 100 }] } });
  assert.equal(samples.length, 28665);
  assert.ok(Math.abs(peakOf(samples) - PEAK_LEVEL) < 1e-7);
});

test("a short render matches Python's synthesize within 1e-4", () => {
  const reference = readFixture("web/chip-reference.json");
  const samples = renderChip({ tempoBpm: reference.tempo_bpm, channels: reference.channels }, reference.sample_rate);
  assert.equal(samples.length, reference.samples.length);
  let largest = 0;
  for (let i = 0; i < samples.length; i++) largest = Math.max(largest, Math.abs(samples[i] - reference.samples[i]));
  assert.ok(largest < 1e-4, `largest difference ${largest}`);
});
