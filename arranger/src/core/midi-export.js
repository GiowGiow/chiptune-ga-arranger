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

import { writeMidiFile } from "./midi-file.js";

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
 */

/**
 * Build the bytes of a 4-track MIDI file (P1, P2, TR, NO) from an arrangement.
 *
 * @param {Arrangement} arrangement
 * @returns {Uint8Array} a format-1 standard MIDI file at 480 ticks per quarter note, with the
 *   tempo and a 4/4 time signature in track 0.
 * @example
 * const bytes = arrangementToMidi({ title: "demo", tempoBpm: 120, plan: [[0, 0, 0, 0]], channels: {
 *   P1: [{ pitch: 72, onset: 1, duration: 1, velocity: 100 }],
 *   P2: [{ pitch: 64, onset: 0, duration: 2, velocity: 80 }],
 *   TR: [{ pitch: 48, onset: 0, duration: 4, velocity: 90 }],
 *   NO: [{ pitch: 36, onset: 0, duration: 0.25, velocity: 100 }] } });
 * const midi = readMidiFile(bytes);
 * [midi.instruments.map((i) => i.name), midi.instruments[0].notes[0].start];
 * // [["P1", "P2", "TR", "NO"], 0.5]: at 120 BPM a beat lasts 0.5 s
 */
export function arrangementToMidi(arrangement) {
  const secondsPerBeat = 60.0 / arrangement.tempoBpm;
  return writeMidiFile({
    resolution: RESOLUTION,
    tempoBpm: arrangement.tempoBpm,
    timeSignature: [4, 4],
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
}
