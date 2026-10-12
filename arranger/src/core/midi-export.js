// @ts-check
// Write an arrangement to a MIDI file (the app's .mid download, contracts/files.md).
//
// This is the only place where the arrangement's beats become seconds (seconds = beats × 60 /
// tempo); core/midi-file.js then turns seconds into ticks at 480 per quarter note. Each NES
// channel becomes one MIDI track named after it. General MIDI has no chip sounds, so the tracks
// use the closest General MIDI timbres: program 80 (Lead 1, square wave) for the two pulse
// channels, program 38 (Synth Bass 1) for the triangle bass, and the drum channel (10, index 9)
// for the noise percussion. Port of src/export/midi.py; the CLI's pretty_midi reads the file back
// with the same instrument names and notes (tests/test_web_midi.py).
//
// The file also declares the meter (time signature) of the first bar and each change of meter,
// so a notation program or sequencer draws the same bar lines as the arranger: a waltz shows 3/4
// bars, and a song that moves from 4/4 to 2/4 changes there too. An all-4/4 arrangement writes the
// same bytes as before meters existed, which keeps the app's Korobeiniki pin.

import { FOUR_FOUR, meterText } from "./meter.js";
import { writeMidiFile } from "./midi-file.js";

/** @typedef {import("./meter.js").Meter} Meter */

/** The four NES channels, in track order. */
const CHANNELS = /** @type {const} */ (["P1", "P2", "TR", "NO"]);

/** General MIDI program of each channel, as `GM_PROGRAMS` in src/export/midi.py. */
export const CHANNEL_PROGRAMS = Object.freeze({ P1: 80, P2: 80, TR: 38, NO: 0 });

/** MIDI channel index of each NES channel; 9 is the General MIDI drum channel. */
export const MIDI_CHANNELS = Object.freeze({ P1: 0, P2: 1, TR: 2, NO: 9 });

/** Ticks per quarter note of the written file. */
export const RESOLUTION = 480;

/**
 * A note of one NES channel, in beats from the start of the piece.
 * @typedef {object} ChannelNote
 * @property {number} pitch MIDI pitch (for NO, the General MIDI drum sound).
 * @property {number} onset start, in beats.
 * @property {number} duration length, in beats (> 0).
 * @property {number} velocity loudness (1–127).
 */

/**
 * An arrangement: the notes of the four NES channels (the shape of core/arrangement.js).
 * @typedef {object} Arrangement
 * @property {string} title
 * @property {number} tempoBpm quarter notes per minute.
 * @property {ArrayLike<unknown>} plan the arrangement plan (core/genome.js); not written to the file.
 * @property {{P1: ChannelNote[], P2: ChannelNote[], TR: ChannelNote[], NO: ChannelNote[]}} channels
 * @property {Meter[]} [meters] the meter of each bar; an arrangement without meters (built by
 *   hand) is 4/4 throughout.
 */

/**
 * Build the bytes of a 4-track MIDI file (P1, P2, TR, NO) from an arrangement.
 *
 * @param {Arrangement} arrangement
 * @returns {Uint8Array} a format-1 standard MIDI file at 480 ticks per quarter note, with the
 *   tempo, the first bar's time signature and one at each change of meter in track 0.
 * @example
 * const bytes = arrangementToMidi({ title: "demo", tempoBpm: 120, plan: [[0, 0, 0, 0]], channels: {
 *   P1: [{ pitch: 72, onset: 1, duration: 1, velocity: 100 }],
 *   P2: [{ pitch: 64, onset: 0, duration: 2, velocity: 80 }],
 *   TR: [{ pitch: 48, onset: 0, duration: 4, velocity: 90 }],
 *   NO: [{ pitch: 36, onset: 0, duration: 0.25, velocity: 100 }] } });
 * const midi = readMidiFile(bytes);
 * [midi.instruments.map((i) => i.name), midi.instruments[0].notes[0].start];
 * // [["P1", "P2", "TR", "NO"], 0.5]: at 120 BPM a beat lasts 0.5 s
 * // With meters [3/4, 3/4]: midi.timeSignatures is [{ numerator: 3, denominator: 4, time: 0 }].
 */
export function arrangementToMidi(arrangement) {
  const secondsPerBeat = 60.0 / arrangement.tempoBpm;
  const [first, ...later] = meterChanges(arrangement.meters ?? []);
  const bytes = writeMidiFile({
    resolution: RESOLUTION,
    tempoBpm: arrangement.tempoBpm,
    timeSignature: [first.meter.numerator, first.meter.denominator],
    tracks: CHANNELS.map((channel) => ({
      name: channel,
      channel: MIDI_CHANNELS[channel],
      program: CHANNEL_PROGRAMS[channel],
      notes: (arrangement.channels[channel] ?? []).map((note) => ({
        start: note.onset * secondsPerBeat,
        end: (note.onset + note.duration) * secondsPerBeat,
        pitch: note.pitch,
        velocity: note.velocity,
      })),
    })),
  });
  return later.length > 0 ? withLaterTimeSignatures(bytes, later) : bytes;
}

/**
 * The bars where the meter is declared: the first bar, and each bar whose meter differs from the
 * bar before it (port of `_time_signatures`).
 *
 * @param {readonly Meter[]} meters the meter of each bar; empty for 4/4 throughout.
 * @returns {Array<{beat: number, meter: Meter}>} at least one entry, the first at beat 0.
 */
function meterChanges(meters) {
  if (meters.length === 0) return [{ beat: 0, meter: FOUR_FOUR }];
  /** @type {Array<{beat: number, meter: Meter}>} */
  const changes = [];
  let beat = 0;
  meters.forEach((meter, index) => {
    if (index === 0 || meterText(meter) !== meterText(meters[index - 1])) changes.push({ beat, meter });
    beat += meter.barBeats;
  });
  return changes;
}

/**
 * Add time signatures after the first one to the file `writeMidiFile` wrote.
 *
 * `writeMidiFile` writes one time signature, at tick 0, so the later ones go into its track 0 just
 * before the end-of-track event. A time signature event is FF 58 04 with the numerator, the
 * denominator as a power of two (3/4 is 3, 2), and the metronome fields 24 and 8 that the first
 * one carries too.
 *
 * @param {Uint8Array} bytes a file from `writeMidiFile`, whose track 0 holds only events at tick 0.
 * @param {Array<{beat: number, meter: Meter}>} changes in beat order, all after beat 0.
 * @returns {Uint8Array} the file with the time signatures added.
 */
function withLaterTimeSignatures(bytes, changes) {
  const trackStart = 14 + 8; // the header chunk, then "MTrk" and the track length
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trackEnd = trackStart + view.getUint32(trackStart - 4);
  const endOfTrack = [0, 0xff, 0x2f, 0];
  if (endOfTrack.some((byte, index) => bytes[trackEnd - 4 + index] !== byte)) {
    throw new Error("track 0 does not close with an end-of-track event");
  }
  /** @type {number[]} */
  const events = [];
  let tick = 0;
  for (const { beat, meter } of changes) {
    const at = Math.round(beat * RESOLUTION);
    events.push(...varIntBytes(at - tick), 0xff, 0x58, 4, meter.numerator, Math.log2(meter.denominator), 24, 8);
    tick = at;
  }
  const track = [...bytes.subarray(trackStart, trackEnd - 4), ...events, ...endOfTrack];
  const length = [24, 16, 8, 0].map((shift) => (track.length >>> shift) & 0xff);
  return Uint8Array.from([...bytes.subarray(0, trackStart - 4), ...length, ...track, ...bytes.subarray(trackEnd)]);
}

/**
 * A variable-length quantity, as MIDI writes delta times: 7 bits per byte, the high bit set on
 * all but the last.
 * @param {number} value non-negative integer.
 * @returns {number[]}
 */
function varIntBytes(value) {
  const bytes = [value & 0x7f];
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) {
    bytes.unshift((rest & 0x7f) | 0x80);
  }
  return bytes;
}
