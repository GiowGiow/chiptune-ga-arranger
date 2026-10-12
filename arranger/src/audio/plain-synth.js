// @ts-check
// The input, made audible, for the A/B comparison with the chip arrangement (research R7).
//
// The visitor switches between the arrangement and what the genetic algorithm started from, so
// the input is played plainly on the same beat timeline as the arrangement: beat b sounds at
// b × 60 / tempo seconds in both renders, and the two buffers have the same length.
//
// - A lead sheet is played as its melody, a soft triangle wave, over a quiet held pad of three
//   notes per chord: root, third and fifth, from C3 up, one voice each. (The command line plays
//   the same notes with a piano in `src/export/input_preview.py`: block chords from C4 and the
//   root in the bass. Here the pad sits an octave lower, under the melody, and there is no bass.)
// - A MIDI song is played as its own tracks cut to the excerpt: the melody track, every other
//   pitched track (a triangle below MIDI 48, where it is a bass, and a softened square above)
//   and the drums as short noise bursts shaped by drum type (kick, snare, hi-hat, ...). The notes
//   keep their performed timing; only their times are converted to beats, on the beat grid that
//   the lead-sheet reduction used (`sourceGrid`), as `excerpt_seconds` does in the same Python
//   module.
//
// The module works in two steps so that the page can draw exactly what it plays: the voices, a
// list of notes in beats (`leadSheetVoices`, `midiExcerptVoices`), then the samples
// (`renderVoices`). It is pure and deterministic: the drum noise comes from the seeded generator
// of `core/random.js`, and the result does not depend on Web Audio.

import { barStarts, totalBeats } from "../core/meter.js";
import { excerptBars } from "../core/midi-song.js";
import { createRandom } from "../core/random.js";
import { PEAK_LEVEL, SAMPLE_RATE } from "./chip-synth.js";

/**
 * A note of a voice, in beats from the start of the piece (or of the excerpt).
 * @typedef {object} VoiceNote
 * @property {number} pitch MIDI pitch number
 * @property {number} onset start, in beats
 * @property {number} duration length in beats, greater than 0
 */

/**
 * A drum hit: a General MIDI drum note (36 kick, 38 snare, 42 closed hi-hat, ...) at a beat.
 * @typedef {object} DrumHit
 * @property {number} pitch General MIDI drum note
 * @property {number} onset start, in beats
 */

/**
 * The notes to play, in beats, grouped by how they sound.
 * @typedef {object} Voices
 * @property {VoiceNote[]} melody played as a soft triangle wave
 * @property {VoiceNote[][]} others one list per accompanying voice (a chord-pad voice or a track)
 * @property {DrumHit[]} drums played as noise bursts
 */

/**
 * Where a MIDI excerpt lies and how to read it, as the lead-sheet reduction read it.
 * @typedef {object} MidiExcerpt
 * @property {number | number[]} melodyTrack index (or indices) of the melody in `midi.instruments`
 * @property {[number, number]} sourceGrid the lead sheet's `sourceGrid`: [tempo BPM, first
 *   downbeat in seconds]; [the file's tempo, 0] means the file's own tick grid
 * @property {[number, number]} bars the excerpt [first, end) in bars of that grid; for a whole
 *   song, [0, number of bars of the lead sheet]
 */

/** Lowest pitch of the chord pad, C3: each pad tone is this plus its pitch class (C3 to B3). */
export const PAD_LOWEST_PITCH = 48;


// Loudness of each kind of voice before the mix is scaled to its peak: the melody leads, each
// accompanying voice stays well under it.
const MELODY_GAIN = 0.5;
const ACCOMPANIMENT_GAIN = 0.1;
const DRUM_GAIN = 0.3;

// Accompanying voices below this pitch are basses and play a triangle, which stays round there.
const BASS_BELOW_PITCH = 48;

// The corner frequency of the one-pole low-pass filter that softens the square wave.
const SQUARE_CUTOFF_HZ = 2000;

// Short linear ramps at both ends of a note, so that no note starts or stops with a click.
const ATTACK_SECONDS = 0.005;
const RELEASE_SECONDS = 0.03;
const DRUM_ATTACK_SECONDS = 0.001;
const DRUM_RELEASE_SECONDS = 0.005;

// The drum noise: a table of white noise drawn once per render from a seeded generator; each
// hit reads it from a random offset. One draw per hit instead of one per sample.
const NOISE_SEED = 1;
const NOISE_TABLE_SIZE = 1 << 16; // 1.5 s at 44.1 kHz, far longer than any burst

/**
 * How one kind of drum sounds: a noise burst that decays by 40 dB over `decaySeconds`, through
 * a low-pass filter at `cutoffHz` (Infinity keeps the noise bright).
 * @typedef {{decaySeconds: number, cutoffHz: number}} DrumSound
 */

/** @type {Readonly<Record<string, Readonly<DrumSound>>>} */
const DRUM_SOUNDS = Object.freeze({
  kick: Object.freeze({ decaySeconds: 0.15, cutoffHz: 80 }),
  snare: Object.freeze({ decaySeconds: 0.12, cutoffHz: 4000 }),
  tom: Object.freeze({ decaySeconds: 0.15, cutoffHz: 300 }),
  closedHat: Object.freeze({ decaySeconds: 0.04, cutoffHz: Infinity }),
  openHat: Object.freeze({ decaySeconds: 0.2, cutoffHz: Infinity }),
  cymbal: Object.freeze({ decaySeconds: 0.4, cutoffHz: Infinity }),
  percussion: Object.freeze({ decaySeconds: 0.06, cutoffHz: 3000 }),
});

/**
 * The kind of a General MIDI drum note (percussion key map, notes 35 to 81).
 * @param {number} pitch
 * @returns {DrumSound}
 */
function drumSound(pitch) {
  if (pitch === 35 || pitch === 36) return DRUM_SOUNDS.kick;
  if (pitch >= 37 && pitch <= 40) return DRUM_SOUNDS.snare; // side stick, snares, hand clap
  if (pitch === 42 || pitch === 44) return DRUM_SOUNDS.closedHat;
  if (pitch === 46) return DRUM_SOUNDS.openHat;
  if ([41, 43, 45, 47, 48, 50].includes(pitch)) return DRUM_SOUNDS.tom;
  if ([49, 51, 52, 53, 55, 57, 59].includes(pitch)) return DRUM_SOUNDS.cymbal; // crashes, rides
  return DRUM_SOUNDS.percussion;
}

/**
 * The melody and the chord pad of a lead sheet, in beats from the start of the piece.
 * @param {import("../core/leadsheet.js").LeadSheet} leadSheet
 * @returns {Voices} the melody; three pad voices (root, third, fifth, each one note per chord
 *   segment, from C3 up); no drums
 * @example
 * // One bar of C5 over A minor:
 * const voices = leadSheetVoices(oneBarSheet);
 * voices.melody; // [{ pitch: 72, onset: 0, duration: 4 }]
 * voices.others.map((voice) => voice[0].pitch); // [57, 48, 52]: A3, C3, E3
 */
export function leadSheetVoices(leadSheet) {
  /** @type {VoiceNote[]} */
  const melody = [];
  /** @type {VoiceNote[][]} */
  const pad = [[], [], []];
  const starts = barStarts(leadSheet.bars);
  leadSheet.bars.forEach((bar, index) => {
    const barStart = starts[index];
    for (const note of bar.melody) {
      melody.push({ pitch: note.pitch, onset: barStart + note.onset, duration: note.duration });
    }
    for (const segment of bar.chords) {
      segment.tones.slice(0, 3).forEach((tone, voice) => {
        pad[voice].push({ pitch: PAD_LOWEST_PITCH + tone, onset: barStart + segment.onset, duration: segment.duration });
      });
    }
  });
  return { melody, others: pad, drums: [] };
}

/**
 * The function that turns a time of a MIDI file, in seconds, into beats on a lead sheet's grid.
 *
 * Like `excerpt_seconds` in `src/export/input_preview.py`: a grid of [the file's first tempo, 0]
 * is the file's own tick grid (it follows the file's tempo changes), whose beat 0 is the file's
 * first beat, where its time-signature map starts; any other grid is the steady one that the
 * reduction estimated, starting at its first downbeat.
 * @param {import("../core/midi-file.js").MidiSong} midi
 * @param {[number, number]} sourceGrid [tempo BPM, first downbeat in seconds]
 * @returns {(seconds: number) => number} beats of a time
 * @example
 * beatClock(midi120, [120, 0])(2.25); // 4.5: ticks / resolution
 * beatClock(midi120, [100, 0.3])(1.5); // 2: (1.5 − 0.3) × 100 / 60
 * beatClock(countInSong, [120, 0])(3); // 6: two 3/4 bars of count-in before 3 s
 */
export function beatClock(midi, sourceGrid) {
  const [bpm, downbeat] = sourceGrid;
  if (onFileGrid(midi, sourceGrid)) {
    return (seconds) => midi.timeToTick(seconds) / midi.resolution;
  }
  return (seconds) => ((seconds - downbeat) * bpm) / 60;
}

/**
 * Whether a lead sheet's grid is the file's own tick grid: [the file's first tempo, 0].
 * @param {import("../core/midi-file.js").MidiSong} midi
 * @param {[number, number]} sourceGrid
 * @returns {boolean}
 */
function onFileGrid(midi, sourceGrid) {
  return sourceGrid[1] === 0 && sourceGrid[0] === midi.tempoChanges[0].bpm;
}

/**
 * The notes of a MIDI song inside an excerpt, in beats from the excerpt's first bar.
 *
 * Every note of the melody track is kept (no skyline: this is the original, not the lead
 * sheet). A note that crosses an edge of the excerpt keeps only its part inside.
 * @param {import("../core/midi-file.js").MidiSong} midi the song, as `readMidiFile` gives it
 * @param {MidiExcerpt} excerpt the melody track, the grid and the bars of the lead sheet
 * @returns {Voices} the melody track's notes; one voice per other pitched track that plays in
 *   the excerpt; the drum hits that start in it
 * @example
 * // Bar 1 (2 s to 4 s) of a 120 BPM song whose melody plays D5 from 2 s to 2.5 s:
 * midiExcerptVoices(midi120, { melodyTrack: 0, sourceGrid: [120, 0], bars: [1, 2] }).melody[0];
 * // { pitch: 74, onset: 0, duration: 1 }
 */
export function midiExcerptVoices(midi, excerpt) {
  const beatsOf = beatClock(midi, excerpt.sourceGrid);
  const [offset, length] = excerptSpan(midi, excerpt);
  const melodyTracks = new Set(Array.isArray(excerpt.melodyTrack) ? excerpt.melodyTrack : [excerpt.melodyTrack]);

  /** @type {VoiceNote[]} */
  const melody = [];
  /** @type {VoiceNote[][]} */
  const others = [];
  /** @type {DrumHit[]} */
  const drums = [];
  midi.instruments.forEach((instrument, index) => {
    if (instrument.isDrum) {
      for (const note of instrument.notes) {
        const onset = beatsOf(note.start) - offset;
        if (onset >= 0 && onset < length) drums.push({ pitch: note.pitch, onset });
      }
      return;
    }
    /** @type {VoiceNote[]} */
    const notes = [];
    for (const note of instrument.notes) {
      const onset = Math.max(beatsOf(note.start) - offset, 0);
      const end = Math.min(beatsOf(note.end) - offset, length);
      if (end > onset) notes.push({ pitch: note.pitch, onset, duration: end - onset });
    }
    if (melodyTracks.has(index)) melody.push(...notes);
    else if (notes.length > 0) others.push(notes);
  });
  // pretty_midi lists notes in the order they end; play and draw them in the order they start.
  const byOnset = (/** @type {{onset: number}} */ a, /** @type {{onset: number}} */ b) => a.onset - b.onset;
  melody.sort(byOnset);
  for (const voice of others) voice.sort(byOnset);
  drums.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
  return { melody, others, drums };
}

/**
 * Ramp the first `attack` and the last `release` samples of a note from and to silence, in
 * place. On a note too short for both, each ramp takes at most half of it.
 * @param {Float64Array} tone
 * @param {number} attack samples
 * @param {number} release samples
 * @returns {void}
 */
function rampEdges(tone, attack, release) {
  const half = Math.floor(tone.length / 2);
  const rampIn = Math.min(attack, half);
  const rampOut = Math.min(release, half);
  for (let k = 0; k < rampIn; k++) tone[k] *= k / rampIn;
  for (let k = 0; k < rampOut; k++) tone[tone.length - 1 - k] *= k / rampOut;
}

/**
 * Write a pitched note into `tone`: a triangle wave or a square wave softened by a low-pass
 * filter, starting at the beginning of a cycle.
 * @param {Float64Array} tone the note's samples, overwritten
 * @param {number} pitch
 * @param {"triangle" | "square"} shape
 * @param {number} sampleRate
 * @returns {void}
 */
function writePitchedTone(tone, pitch, shape, sampleRate) {
  const cyclesPerSample = (440 * 2 ** ((pitch - 69) / 12)) / sampleRate;
  if (shape === "triangle") {
    for (let i = 0; i < tone.length; i++) {
      // A quarter cycle ahead, so the wave starts at 0 and rises: 0, 1, 0, -1, 0.
      const cycles = i * cyclesPerSample + 0.25;
      tone[i] = 1 - 4 * Math.abs(cycles - Math.floor(cycles) - 0.5);
    }
    return;
  }
  const smoothing = 1 - Math.exp((-2 * Math.PI * SQUARE_CUTOFF_HZ) / sampleRate);
  let filtered = 0;
  for (let i = 0; i < tone.length; i++) {
    const cycles = i * cyclesPerSample;
    filtered += smoothing * (cycles - Math.floor(cycles) < 0.5 ? 1 - filtered : -1 - filtered);
    tone[i] = filtered;
  }
}

/**
 * Write a drum hit into `tone`: low-passed noise that falls by 40 dB over the drum's decay.
 * @param {Float64Array} tone the hit's samples, overwritten
 * @param {DrumSound} drum
 * @param {Float64Array} noise white noise in [-1, 1), NOISE_TABLE_SIZE samples
 * @param {number} offset where the hit starts reading the noise
 * @param {number} sampleRate
 * @returns {void}
 */
function writeDrumHit(tone, drum, noise, offset, sampleRate) {
  const smoothing = Number.isFinite(drum.cutoffHz) ? 1 - Math.exp((-2 * Math.PI * drum.cutoffHz) / sampleRate) : 1;
  // A low-pass keeps only part of the noise's power (smoothing / (2 − smoothing) for white
  // noise); scaling back by its square root keeps a kick as loud as a hi-hat.
  const makeUp = Math.sqrt((2 - smoothing) / smoothing);
  const decayPerSample = 0.01 ** (1 / (drum.decaySeconds * sampleRate));
  let filtered = 0;
  let envelope = 1;
  for (let i = 0; i < tone.length; i++) {
    filtered += smoothing * (noise[(offset + i) & (NOISE_TABLE_SIZE - 1)] - filtered);
    tone[i] = filtered * makeUp * envelope;
    envelope *= decayPerSample;
  }
}

/**
 * Add `gain × tone` into `mix` from `firstSample` on.
 * @param {Float64Array} mix
 * @param {Float64Array} tone
 * @param {number} firstSample
 * @param {number} gain
 * @returns {void}
 */
function addTone(mix, tone, firstSample, gain) {
  for (let i = 0; i < tone.length; i++) mix[firstSample + i] += gain * tone[i];
}

/**
 * Synthesize voices on the beat timeline (mono): the melody as a soft triangle, the other
 * voices as a softened square (a triangle below MIDI 48) and the drums as noise bursts.
 *
 * Every note has a 5 ms attack and a 30 ms release. Notes past the end are cut, and the mix is
 * scaled to peak at -3 dBFS, like the chip render; silence stays all zeros.
 * @param {Voices} voices notes in beats
 * @param {number} tempoBpm beats per minute of the timeline (the run's tempo)
 * @param {number} sampleRate samples per second
 * @param {number} durationBeats length of the render in beats (the arrangement's length)
 * @returns {Float32Array} round(durationBeats × 60 / tempoBpm × sampleRate) samples
 * @example
 * renderVoices(leadSheetVoices(oneBarSheet), 120, 44100, 4).length; // 88200: 2 s
 */
export function renderVoices(voices, tempoBpm, sampleRate, durationBeats) {
  const secondsPerBeat = 60 / tempoBpm;
  const mix = new Float64Array(Math.round(((durationBeats * 60) / tempoBpm) * sampleRate));
  const toSample = (/** @type {number} */ beat) => Math.min(Math.round(beat * secondsPerBeat * sampleRate), mix.length);
  const attack = Math.round(ATTACK_SECONDS * sampleRate);
  const release = Math.round(RELEASE_SECONDS * sampleRate);

  // Where each note sounds, in samples; then every note is written in turn into one buffer as
  // long as the longest note, instead of a new array per note (tens of megabytes for a song).
  /** @type {Array<{pitch: number, shape: "triangle" | "square", gain: number, firstSample: number, nSamples: number}>} */
  const pitched = [];
  /** @param {VoiceNote} note @param {"triangle" | "square"} shape @param {number} gain */
  const schedule = (note, shape, gain) => {
    const firstSample = toSample(note.onset);
    pitched.push({ pitch: note.pitch, shape, gain, firstSample, nSamples: toSample(note.onset + note.duration) - firstSample });
  };
  for (const note of voices.melody) schedule(note, "triangle", MELODY_GAIN);
  for (const note of voices.others.flat()) {
    schedule(note, note.pitch < BASS_BELOW_PITCH ? "triangle" : "square", ACCOMPANIMENT_GAIN);
  }
  const hits = voices.drums.map((hit) => {
    const drum = drumSound(hit.pitch);
    const firstSample = toSample(hit.onset);
    return { drum, firstSample, nSamples: Math.min(Math.round(drum.decaySeconds * sampleRate), mix.length - firstSample) };
  });
  const longest = [...pitched, ...hits].reduce((most, { nSamples }) => Math.max(most, nSamples), 0);
  const scratch = new Float64Array(longest);

  for (const { pitch, shape, gain, firstSample, nSamples } of pitched) {
    if (nSamples <= 0) continue;
    const tone = scratch.subarray(0, nSamples);
    writePitchedTone(tone, pitch, shape, sampleRate);
    rampEdges(tone, attack, release);
    addTone(mix, tone, firstSample, gain);
  }

  if (hits.length > 0) {
    const random = createRandom(NOISE_SEED);
    const noise = new Float64Array(NOISE_TABLE_SIZE);
    for (let i = 0; i < NOISE_TABLE_SIZE; i++) noise[i] = 2 * random.float() - 1;
    for (const { drum, firstSample, nSamples } of hits) {
      const offset = random.integer(0, NOISE_TABLE_SIZE);
      if (nSamples <= 0) continue;
      const tone = scratch.subarray(0, nSamples);
      writeDrumHit(tone, drum, noise, offset, sampleRate);
      rampEdges(tone, Math.round(DRUM_ATTACK_SECONDS * sampleRate), Math.round(DRUM_RELEASE_SECONDS * sampleRate));
      addTone(mix, tone, firstSample, DRUM_GAIN);
    }
  }

  let peak = 0;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const samples = new Float32Array(mix.length);
  if (peak > 0) {
    const scale = PEAK_LEVEL / peak;
    for (let i = 0; i < mix.length; i++) samples[i] = mix[i] * scale;
  }
  return samples;
}

/**
 * Play a lead sheet plainly at its own tempo: `renderVoices(leadSheetVoices(leadSheet), ...)`
 * over all its bars.
 * @param {import("../core/leadsheet.js").LeadSheet} leadSheet
 * @param {number} [sampleRate] samples per second (default 44,100)
 * @returns {Float32Array} the samples of every bar, each as long as its meter says
 * @example
 * renderLeadSheet(oneBarSheet, 44100).length; // 88200: one 4/4 bar at 120 BPM
 */
export function renderLeadSheet(leadSheet, sampleRate = SAMPLE_RATE) {
  const durationBeats = totalBeats(leadSheet.bars);
  return renderVoices(leadSheetVoices(leadSheet), leadSheet.tempoBpm, sampleRate, durationBeats);
}

/**
 * Play the excerpt of a MIDI song at the run's tempo: `renderVoices(midiExcerptVoices(...))`.
 * @param {import("../core/midi-file.js").MidiSong} midi the song, as `readMidiFile` gives it
 * @param {MidiExcerpt} excerpt the melody track, the grid and the bars of the lead sheet
 * @param {number} tempoBpm the run's tempo, so that beat b sounds when it does in the arrangement
 * @param {number} [sampleRate] samples per second (default 44,100)
 * @returns {Float32Array} the excerpt's beats (its bars, each as long as its meter) of samples
 * @example
 * renderMidiExcerpt(midi120, { melodyTrack: 0, sourceGrid: [120, 0], bars: [1, 2] }, 120, 44100).length;
 * // 88200: one bar at 120 BPM
 */
export function renderMidiExcerpt(midi, excerpt, tempoBpm, sampleRate = SAMPLE_RATE) {
  const durationBeats = excerptSpan(midi, excerpt)[1];
  return renderVoices(midiExcerptVoices(midi, excerpt), tempoBpm, sampleRate, durationBeats);
}

/**
 * Where an excerpt starts and how long it lasts, in beats of the lead sheet's grid: its bars on
 * the file's time-signature map, or bars of the song's main meter on an estimated grid.
 * @param {import("../core/midi-file.js").MidiSong} midi
 * @param {MidiExcerpt} excerpt
 * @returns {[number, number]} [first beat, length in beats]
 */
function excerptSpan(midi, excerpt) {
  const grid = onFileGrid(midi, excerpt.sourceGrid) ? "file" : excerpt.sourceGrid;
  const { map, first, end } = excerptBars(midi, excerpt.bars, grid);
  const last = map[end - 1];
  return [map[first].start, last.start + last.length - map[first].start];
}
