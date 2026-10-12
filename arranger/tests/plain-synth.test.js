// @ts-check
// Tests for audio/plain-synth.js, which makes the input audible for the A/B comparison.
//
// The input is played plainly on the same beat timeline as the arrangement: a lead sheet as its
// melody over a quiet chord pad, a MIDI song as its own tracks cut to the excerpt. The tests check
// the notes in beats (what the channel view draws) and the sound: duration, energy in the melody
// and chord bands, drums as noise, and determinism.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { readMidiFile, writeMidiFile } from "../src/core/midi-file.js";
import {
  PAD_LOWEST_PITCH,
  beatClock,
  leadSheetVoices,
  midiExcerptVoices,
  renderLeadSheet,
  renderMidiExcerpt,
  renderVoices,
} from "../src/audio/plain-synth.js";
import { assertClose, countInSongBytes, readFixture } from "./helpers.js";

const RATE = 44100;
const korobeiniki = leadSheetFromJson(readFixture("leadsheets/korobeiniki.json"));

/**
 * A small 120 BPM song: a melody, a bass and drums. Bar 1 starts at 2 s.
 * @returns {import("../src/core/midi-file.js").MidiSong}
 */
function smallSong() {
  const note = (/** @type {number} */ start, /** @type {number} */ end, /** @type {number} */ pitch) => ({ start, end, pitch, velocity: 100 });
  const bytes = writeMidiFile({
    tempoBpm: 120,
    tracks: [
      { name: "melody", channel: 0, program: 0, notes: [note(0, 0.5, 72), note(2, 2.5, 74), note(3.75, 4.25, 76), note(4.5, 5, 77)] },
      { name: "bass", channel: 1, program: 33, notes: [note(2, 4, 40)] },
      { name: "drums", channel: 9, program: 0, notes: [note(2, 2.1, 36), note(2.25, 2.35, 42), note(4, 4.1, 36)] },
    ],
  });
  return readMidiFile(bytes);
}

/**
 * Index of the instrument named `name` (readMidiFile lists them in pretty_midi's order).
 * @param {import("../src/core/midi-file.js").MidiSong} midi
 * @param {string} name
 */
function trackIndex(midi, name) {
  return midi.instruments.findIndex((instrument) => instrument.name === name);
}

/**
 * Share of the power of a Hann-windowed block that falls in each frequency band.
 * @param {Float32Array} samples
 * @param {number} start first sample of the block
 * @param {number} size block length (a DFT of this size)
 * @param {Array<[number, number]>} bands [low Hz, high Hz] pairs
 */
function bandShares(samples, start, size, bands) {
  const block = Float64Array.from({ length: size }, (_, n) => samples[start + n] * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size)));
  const cosTable = Float64Array.from({ length: size }, (_, n) => Math.cos((2 * Math.PI * n) / size));
  const sinTable = Float64Array.from({ length: size }, (_, n) => Math.sin((2 * Math.PI * n) / size));
  const shares = bands.map(() => 0);
  let total = 0;
  for (let k = 1; k < size / 2; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < size; n++) {
      const angle = (k * n) % size;
      re += block[n] * cosTable[angle];
      im -= block[n] * sinTable[angle];
    }
    const power = re * re + im * im;
    const hz = (k * RATE) / size;
    total += power;
    bands.forEach(([low, high], i) => {
      if (hz >= low && hz <= high) shares[i] += power;
    });
  }
  return shares.map((share) => share / total);
}

/**
 * The largest normalized autocorrelation of a block over lags from `minLag` to `maxLag`.
 * A pitched tone repeats (near 1 at its period); noise does not (near 0).
 * @param {Float32Array} block
 * @param {number} minLag
 * @param {number} maxLag
 */
function periodicity(block, minLag, maxLag) {
  let energy = 0;
  for (const sample of block) energy += sample * sample;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < block.length; i++) sum += block[i] * block[i + lag];
    best = Math.max(best, sum / energy);
  }
  return best;
}

/** @param {Float32Array} block */
function zeroCrossingRate(block) {
  let crossings = 0;
  for (let i = 1; i < block.length; i++) if ((block[i - 1] < 0) !== (block[i] < 0)) crossings++;
  return crossings / block.length;
}

test("a lead sheet gives its melody on the beat timeline and its chords as a three-note pad", () => {
  const voices = leadSheetVoices(korobeiniki);
  const melodyCount = korobeiniki.bars.reduce((count, bar) => count + bar.melody.length, 0);
  assert.equal(voices.melody.length, melodyCount);
  assert.deepEqual(voices.melody[0], { pitch: 76, onset: 0, duration: 1 });
  // The first note of bar 1 sits 4 beats later.
  const bar1 = korobeiniki.bars[1].melody[0];
  assert.deepEqual(voices.melody[korobeiniki.bars[0].melody.length], { ...bar1, onset: 4 + bar1.onset });

  // Root, third and fifth, one voice each, from C3 up: E major is E3, G#3, B3.
  assert.equal(voices.others.length, 3);
  assert.deepEqual(voices.others.map((voice) => voice[0]), [
    { pitch: 52, onset: 0, duration: 4 },
    { pitch: 56, onset: 0, duration: 4 },
    { pitch: 59, onset: 0, duration: 4 },
  ]);
  const segments = korobeiniki.bars.reduce((count, bar) => count + bar.chords.length, 0);
  for (const voice of voices.others) {
    assert.equal(voice.length, segments, "each chord segment is one held note");
    assert.ok(voice.every((note) => note.pitch >= PAD_LOWEST_PITCH && note.pitch < PAD_LOWEST_PITCH + 12));
  }
  assert.deepEqual(voices.drums, []);
});

test("a lead sheet render lasts bars × 4 × 60 / tempo seconds", () => {
  const samples = renderLeadSheet(korobeiniki, RATE);
  const seconds = (korobeiniki.bars.length * 4 * 60) / korobeiniki.tempoBpm;
  assert.equal(samples.length, Math.round(seconds * RATE));
  assert.ok(samples instanceof Float32Array);
});

test("a lead sheet render has energy in the melody band and in the chord band", () => {
  // First beat of Korobeiniki: the melody plays E5 (659 Hz) over an E major pad (165-247 Hz).
  const bands = /** @type {Array<[number, number]>} */ ([[120, 270], [280, 4000]]);
  const voices = leadSheetVoices(korobeiniki);
  const full = renderVoices(voices, korobeiniki.tempoBpm, RATE, 4);
  const [chordShare, melodyShare] = bandShares(full, 2000, 4096, bands);
  assert.ok(chordShare > 0.05, `chord band holds ${chordShare} of the power`);
  assert.ok(melodyShare > 0.05, `melody band holds ${melodyShare} of the power`);
  // Without the pad, the chord band is empty: its energy came from the chords.
  const melodyOnly = renderVoices({ ...voices, others: [] }, korobeiniki.tempoBpm, RATE, 4);
  assert.ok(bandShares(melodyOnly, 2000, 4096, bands)[0] < 0.01);
});

test("a MIDI excerpt is read on the lead sheet's grid, shifted to its first bar and cut to it", () => {
  const midi = smallSong();
  // File grid ([file tempo, 0]): beats are ticks / resolution. Bar 1 is the excerpt.
  const voices = midiExcerptVoices(midi, { melodyTrack: trackIndex(midi, "melody"), sourceGrid: [120, 0], bars: [1, 2] });
  assertClose(voices.melody, [
    { pitch: 74, onset: 0, duration: 1 },
    { pitch: 76, onset: 3.5, duration: 0.5 }, // cut at the end of the excerpt
  ]);
  assertClose(voices.others, [[{ pitch: 40, onset: 0, duration: 4 }]]);
  assertClose(voices.drums, [
    { pitch: 36, onset: 0 },
    { pitch: 42, onset: 0.5 },
  ]);

  // An estimated grid [bpm, downbeat]: beats are (seconds − downbeat) × bpm / 60.
  const estimated = midiExcerptVoices(midi, { melodyTrack: trackIndex(midi, "melody"), sourceGrid: [100, 0.3], bars: [0, 2] });
  assertClose(estimated.melody[0], { pitch: 72, onset: 0, duration: (0.5 - 0.3) * (100 / 60) }, 9);
  assertClose(estimated.melody[1], { pitch: 74, onset: (2 - 0.3) * (100 / 60), duration: 0.5 * (100 / 60) }, 9);
});

test("the original of a song with a count-in counts bars on the file's time-signature map", () => {
  // Two 3/4 bars (3 s, 6 beats), then 4/4: bar 2 is the first 4/4 bar and starts at 3 s.
  const midi = readMidiFile(countInSongBytes());
  assert.equal(beatClock(midi, [120, 0])(3), 6);
  assert.equal(beatClock(midi, [120, 0])(5), 10);
  const voices = midiExcerptVoices(midi, { melodyTrack: 0, sourceGrid: [120, 0], bars: [2, 3] });
  // The pickup G4 at 2.5 s is in bar 1, before the excerpt.
  assert.deepEqual(voices.melody, [{ pitch: 72, onset: 0, duration: 2 }]);
  assert.deepEqual(voices.drums.map((hit) => hit.onset), [0, 1, 2, 3]);
  // An estimated grid has its own downbeat: the count-in does not move it.
  assert.equal(beatClock(midi, [100, 0.3])(1.5), 2);
});

test("a MIDI excerpt render lasts the excerpt's beats at the run tempo", () => {
  const midi = smallSong();
  const excerpt = { melodyTrack: trackIndex(midi, "melody"), sourceGrid: /** @type {[number, number]} */ ([120, 0]), bars: /** @type {[number, number]} */ ([1, 3]) };
  assert.equal(renderMidiExcerpt(midi, excerpt, 150, RATE).length, Math.round(((8 * 60) / 150) * RATE));
});

test("drum notes become noise bursts", () => {
  const drumsOnly = (/** @type {number} */ pitch) => renderVoices({ melody: [], others: [], drums: [{ pitch, onset: 0 }] }, 120, RATE, 1);
  const hiHat = drumsOnly(42);
  const kick = drumsOnly(36);
  const burst = Math.round(0.03 * RATE);
  // Noise does not repeat, unlike a pitched note.
  assert.ok(periodicity(hiHat.subarray(0, burst), 20, 400) < 0.5);
  const tone = renderVoices({ melody: [{ pitch: 69, onset: 0, duration: 1 }], others: [], drums: [] }, 120, RATE, 1);
  assert.ok(periodicity(tone.subarray(2000, 2000 + RATE / 10), 20, 400) > 0.9);
  // A burst is short: half a beat later both drums are silent.
  assert.ok(hiHat.subarray(RATE / 4).every((sample) => sample === 0));
  assert.ok(kick.subarray(RATE / 4).every((sample) => sample === 0));
  // The kick is darker than the hi-hat.
  assert.ok(zeroCrossingRate(kick.subarray(0, burst)) < zeroCrossingRate(hiHat.subarray(0, burst)) / 4);
});

test("both renders are deterministic", () => {
  assert.deepEqual(renderLeadSheet(korobeiniki, 22050), renderLeadSheet(korobeiniki, 22050));
  const midi = smallSong();
  const excerpt = { melodyTrack: trackIndex(midi, "melody"), sourceGrid: /** @type {[number, number]} */ ([120, 0]), bars: /** @type {[number, number]} */ ([0, 3]) };
  assert.deepEqual(renderMidiExcerpt(midi, excerpt, 120, RATE), renderMidiExcerpt(midi, excerpt, 120, RATE));
});

test("the documented examples hold", () => {
  assert.equal(PAD_LOWEST_PITCH, 48);
  const midi = smallSong();
  assert.equal(beatClock(midi, [120, 0])(2.25), 4.5);
  assert.equal(beatClock(midi, [100, 0.3])(1.5), 2);

  const sheet = leadSheetFromJson({
    title: "One bar",
    key: "C major",
    tempo_bpm: 120,
    bars: [
      {
        index: 0, label: "A", role: "verse", phrase: 0, phrase_end: true,
        melody: [{ pitch: 72, onset: 0, duration: 4 }],
        chords: [{ symbol: "Am", root: 9, tones: [9, 0, 4], onset: 0, duration: 4 }],
      },
    ],
  });
  const voices = leadSheetVoices(sheet);
  assert.deepEqual(voices.melody, [{ pitch: 72, onset: 0, duration: 4 }]);
  assert.deepEqual(voices.others.map((voice) => voice[0].pitch), [57, 48, 52]);
  assert.equal(renderVoices(voices, 120, 44100, 4).length, 88200);
  assert.equal(renderLeadSheet(sheet, 44100).length, 88200);

  const excerpt = { melodyTrack: trackIndex(midi, "melody"), sourceGrid: /** @type {[number, number]} */ ([120, 0]), bars: /** @type {[number, number]} */ ([1, 2]) };
  assert.equal(midiExcerptVoices(midi, excerpt).melody[0].pitch, 74);
  assert.equal(renderMidiExcerpt(midi, excerpt, 120, 44100).length, 88200);
});

test("a waltz lead sheet plays its bars of three beats one after the other", () => {
  const waltz = leadSheetFromJson(readFixture("leadsheets/waltz.json"));

  const voices = leadSheetVoices(waltz);

  // Bar 2 (index 1) starts on beat 3: its first melody note, E5, sounds there.
  assert.deepEqual(voices.melody.find((note) => note.onset >= 3), { pitch: 76, onset: 3, duration: 2 });
  // 16 bars × 3 beats at 150 BPM last 19.2 s.
  assert.equal(renderLeadSheet(waltz, 1000).length, 19200);
});

test("the original of a waltz excerpt lasts its bars of three beats", () => {
  const midi = readMidiFile(new Uint8Array(readFileSync(new URL("./fixtures/midi-songs/synthetic-waltz.mid", import.meta.url))));
  const excerpt = { melodyTrack: 0, sourceGrid: /** @type {[number, number]} */ ([120, 0]), bars: /** @type {[number, number]} */ ([1, 3]) };

  const voices = midiExcerptVoices(midi, excerpt);

  // Bar 1 starts on beat 3 (1.5 s): its three melody notes fall on beats 0, 1 and 2 of the excerpt.
  assert.deepEqual(voices.melody.slice(0, 3).map((note) => note.onset), [0, 1, 2]);
  assert.equal(renderMidiExcerpt(midi, excerpt, 120, 1000).length, 3000); // 6 beats at 120 BPM
});
