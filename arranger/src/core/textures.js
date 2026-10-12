// @ts-check
// Texture realizers: from one gene value to the notes of one channel in one bar (port of
// src/arrangement/textures.py, with the chip constants of src/arrangement/model.py).
//
// An arrangement plan only says *which* texture each channel plays in each bar ("P2 arpeggiates
// in sixteenths", "TR walks"). A realizer is the arranger's craft that turns such a choice into
// concrete notes, reading the bar's melody and chords from the lead sheet:
// - P1 plays the melody, possibly one octave up or down.
// - P2 adds a harmony texture: a held root, a fast arpeggio (the chip-music way of sounding a
//   whole chord on a channel that plays one note at a time), an echo of the melody, or a line
//   under it.
// - TR plays a bass line: held roots, an octave "pump", root-fifth, or a walking line.
// - NO plays a drum pattern on a grid of sixteen sixteenth-note steps.
//
// The NES sound chip (2A03) has four channels that each play one note at a time, so every
// realizer returns a monophonic line: notes sorted by onset that never overlap and stay inside
// the bar [0, 4]. Onsets are in beats from the bar start. Realizers are pure functions, so the
// same bar and gene always give the same notes.
//
// The pitch ranges follow the hardware limits reported for the NES Music Database (pulse 32-108,
// triangle 21-108, Donahue et al., 2018); the pulse range starts one semitone higher to be safe.

import { NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES } from "./genome.js";
import { chordAt } from "./leadsheet.js";

/**
 * One note of one channel. Realizers give onsets from the bar start; an arrangement stores
 * onsets in beats from the start of the piece.
 * @typedef {object} ChannelNote
 * @property {number} pitch MIDI pitch (for NO, a General MIDI percussion note).
 * @property {number} onset start in beats.
 * @property {number} duration length in beats (> 0).
 * @property {number} velocity MIDI velocity (1–127).
 */

/**
 * The NES channels, in the order of the chip and of every arrangement.
 * @type {readonly ["P1", "P2", "TR", "NO"]}
 */
export const CHANNELS = Object.freeze(/** @type {const} */ (["P1", "P2", "TR", "NO"]));

/**
 * Inclusive MIDI pitch ranges of the pitched channels (NO has no pitch range).
 * @type {Readonly<{P1: readonly [number, number], P2: readonly [number, number], TR: readonly [number, number]}>}
 */
export const PITCH_RANGES = Object.freeze({
  P1: Object.freeze(/** @type {const} */ ([33, 108])),
  P2: Object.freeze(/** @type {const} */ ([33, 108])),
  TR: Object.freeze(/** @type {const} */ ([21, 108])),
});

/**
 * Lowest pitch of the octave where P2 places chord roots: 48–59 (C3–B3), below both melodies.
 * @type {number}
 */
export const P2_ROOT_LOW = 48;

/**
 * Lowest pitch of the octave where TR places chord roots: 28–39 (E1–D#2), a bass register.
 * @type {number}
 */
export const TR_ROOT_LOW = 28;

/** MIDI velocity of the melody on P1. @type {number} */
export const VELOCITY_P1 = 100;
/** MIDI velocity of the P2 harmony textures. @type {number} */
export const VELOCITY_P2 = 80;
/** MIDI velocity of the P2 echo: 60% of the melody's loudness. @type {number} */
export const VELOCITY_ECHO = 60;
/** MIDI velocity of the triangle, which has no volume control. @type {number} */
export const VELOCITY_TR = 90;

/** General MIDI kick drum, played on the noise channel. @type {number} */
export const KICK = 36;
/** General MIDI snare drum. @type {number} */
export const SNARE = 38;
/** General MIDI closed hi-hat. @type {number} */
export const HIHAT = 42;

/**
 * MIDI velocity of each drum.
 * @type {Readonly<Record<number, number>>}
 */
export const DRUM_VELOCITY = Object.freeze({ [KICK]: 100, [SNARE]: 90, [HIHAT]: 60 });

/**
 * The noise channel sounds one hit at a time: the kick wins over the snare, the snare over the
 * hi-hat, as a drummer drops the hi-hat to play the accented drum.
 * @type {readonly number[]}
 */
export const DRUM_PRIORITY = Object.freeze([KICK, SNARE, HIHAT]);

const BEATS_PER_BAR = 4;

// Note lengths in beats (a beat is a quarter note).
const QUARTER = 1;
const EIGHTH = 0.5;
const SIXTEENTH = 0.25;
const THIRTY_SECOND = 0.125;

// Interval sizes in semitones.
const OCTAVE = 12;
const PERFECT_FIFTH = 7;
const MAJOR_THIRD = 4;
const MINOR_THIRD = 3;

// --- Pitch helpers ------------------------------------------------------------------------------

/**
 * Python's `%`: the remainder takes the sign of the divisor, so pitch classes stay in 0..11.
 * @param {number} value
 * @param {number} divisor
 */
function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * The only pitch with this pitch class in the octave [low, low + 11].
 * @param {number} pitchClass
 * @param {number} low
 */
function placeInRegister(pitchClass, low) {
  return low + modulo(pitchClass - low, OCTAVE);
}

/**
 * Move a pitch by whole octaves until it lies in [low, high]; its pitch class is kept.
 * @param {number} pitch
 * @param {readonly [number, number]} range
 */
function foldIntoRange(pitch, [low, high]) {
  while (pitch < low) pitch += OCTAVE;
  while (pitch > high) pitch -= OCTAVE;
  return pitch;
}

/**
 * The chord tone at `position` (1 = third, 2 = fifth) in the octave just above the root. A chord
 * written with fewer tones (for example a bare root) gets the `fallback` interval.
 * @param {number} rootPitch
 * @param {import("./leadsheet.js").ChordSegment} chord
 * @param {number} position
 * @param {number} fallback
 */
function chordToneAbove(rootPitch, chord, position, fallback) {
  if (position < chord.tones.length) {
    return rootPitch + modulo(chord.tones[position] - chord.root, OCTAVE);
  }
  return rootPitch + fallback;
}

/**
 * @param {number} gene
 * @param {readonly unknown[]} choices
 * @param {string} name
 */
function checkGene(gene, choices, name) {
  if (!(Number.isInteger(gene) && gene >= 0 && gene < choices.length)) {
    throw new RangeError(`${name} gene is ${gene}, outside 0..${choices.length - 1}`);
  }
}

// --- P1: the melody ----------------------------------------------------------------------------

/**
 * Play the bar's melody on P1, shifted by the octave the gene selects (an index into
 * `P1_OCTAVES`).
 *
 * Notes that the shift pushes out of the pulse range fold back by whole octaves, so the melody
 * keeps its rhythm and its pitch classes.
 *
 * @param {import("./leadsheet.js").Bar} bar the lead-sheet bar.
 * @param {number} octaveGene 0 (written octave), 1 (+12) or 2 (−12).
 * @returns {ChannelNote[]} one note per melody note, onsets from the bar start.
 * @throws {RangeError} when the gene is not a valid octave gene.
 * @example
 * const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 };
 * const melody = [{ pitch: 60, onset: 0, duration: 2 }, { pitch: 100, onset: 2, duration: 2 }];
 * const bar = { index: 0, melody, chords: [c], label: "A", role: "verse", phrase: 0, phraseEnd: false };
 * realizeP1(bar, 1).map((note) => note.pitch); // [72, 100]: up 12, 112 folds back to 100
 */
export function realizeP1(bar, octaveGene) {
  checkGene(octaveGene, P1_OCTAVES, "P1 octave");
  const shift = P1_OCTAVES[octaveGene];
  return bar.melody.map((note) => ({
    pitch: foldIntoRange(note.pitch + shift, PITCH_RANGES.P1),
    onset: note.onset,
    duration: note.duration,
    velocity: VELOCITY_P1,
  }));
}

// --- P2: the harmony texture -------------------------------------------------------------------

/**
 * @param {import("./leadsheet.js").Bar} bar
 * @returns {ChannelNote[]}
 */
function p2Hold(bar) {
  return bar.chords.map((chord) => ({
    pitch: placeInRegister(chord.root, P2_ROOT_LOW),
    onset: chord.onset,
    duration: chord.duration,
    velocity: VELOCITY_P2,
  }));
}

/**
 * The chord tones stacked upward from the root, inside one octave: C-E-G is 48, 52, 55.
 * @param {import("./leadsheet.js").ChordSegment} chord
 */
function arpeggioCycle(chord) {
  const rootPitch = placeInRegister(chord.root, P2_ROOT_LOW);
  return [rootPitch, ...chord.tones.slice(1).map((tone) => rootPitch + modulo(tone - chord.root, OCTAVE))];
}

/**
 * @param {import("./leadsheet.js").Bar} bar
 * @param {number} step
 * @returns {ChannelNote[]}
 */
function p2Arpeggio(bar, step) {
  /** @type {ChannelNote[]} */
  const notes = [];
  for (const chord of bar.chords) {
    const cycle = arpeggioCycle(chord);
    const chordEnd = chord.onset + chord.duration;
    // The small tolerance keeps float noise from adding a tiny note at the chord end.
    const noteCount = Math.ceil(chord.duration / step - 1e-9);
    for (let noteIndex = 0; noteIndex < noteCount; noteIndex++) {
      const onset = chord.onset + noteIndex * step;
      const duration = Math.min(step, chordEnd - onset);
      notes.push({ pitch: cycle[noteIndex % cycle.length], onset, duration, velocity: VELOCITY_P2 });
    }
  }
  return notes;
}

/**
 * @param {import("./leadsheet.js").Bar} bar
 * @returns {ChannelNote[]}
 */
function p2Echo(bar) {
  /** @type {ChannelNote[]} */
  const notes = [];
  for (const note of bar.melody) {
    const onset = note.onset + EIGHTH;
    if (onset >= BEATS_PER_BAR) continue; // the echo of the bar's last eighth would fall into the next bar
    const duration = Math.min(note.duration, BEATS_PER_BAR - onset);
    notes.push({ pitch: note.pitch, onset, duration, velocity: VELOCITY_ECHO });
  }
  return notes;
}

/**
 * @param {import("./leadsheet.js").Bar} bar
 * @returns {ChannelNote[]}
 */
function p2Third(bar) {
  return bar.melody.map((note) => {
    const chord = chordAt(bar, note.onset);
    // Start a minor third below the melody, so the two voices never clash on a semitone or a
    // whole tone, and walk down to the first chord tone.
    let pitch = note.pitch - MINOR_THIRD;
    while (!chord.tones.includes(modulo(pitch, OCTAVE))) pitch -= 1;
    return { pitch, onset: note.onset, duration: note.duration, velocity: VELOCITY_P2 };
  });
}

/**
 * Play the P2 harmony texture the gene selects (an index into `P2_TEXTURES`).
 *
 * - hold: the chord root (placed in 48–59), sustained for each chord segment;
 * - arp16 / arp32: the chord tones cycled upward from the root, one per sixteenth /
 *   thirty-second note, restarting at each chord change;
 * - echo: the written melody one eighth note later, softer, cut at the bar end;
 * - third: under each melody note, the highest chord tone at least 3 semitones below it.
 *
 * Every note is then folded by octaves into the pulse range.
 *
 * @param {import("./leadsheet.js").Bar} bar the lead-sheet bar.
 * @param {number} textureGene index into `P2_TEXTURES`.
 * @returns {ChannelNote[]} a monophonic line, onsets from the bar start.
 * @throws {RangeError} when the gene is not a valid P2 gene.
 * @example
 * const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 2 };
 * const g = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 2, duration: 2 };
 * const bar = { index: 0, melody: [], chords: [c, g], label: "A", role: "verse", phrase: 0, phraseEnd: false };
 * realizeP2(bar, P2_TEXTURES.indexOf("hold")).map((n) => [n.pitch, n.onset]); // [[48, 0], [55, 2]]
 * realizeP2(bar, P2_TEXTURES.indexOf("arp16")).slice(0, 4).map((n) => n.pitch); // [48, 52, 55, 48]
 */
export function realizeP2(bar, textureGene) {
  checkGene(textureGene, P2_TEXTURES, "P2 texture");
  const texture = P2_TEXTURES[textureGene];
  let notes;
  if (texture === "hold") notes = p2Hold(bar);
  else if (texture === "arp16") notes = p2Arpeggio(bar, SIXTEENTH);
  else if (texture === "arp32") notes = p2Arpeggio(bar, THIRTY_SECOND);
  else if (texture === "echo") notes = p2Echo(bar);
  else notes = p2Third(bar);
  for (const note of notes) note.pitch = foldIntoRange(note.pitch, PITCH_RANGES.P2);
  return notes;
}

// --- TR: the bass texture ----------------------------------------------------------------------

/** @param {import("./leadsheet.js").ChordSegment} chord */
function bassRoot(chord) {
  return placeInRegister(chord.root, TR_ROOT_LOW);
}

/** @param {import("./leadsheet.js").ChordSegment} chord */
function bassThird(chord) {
  return chordToneAbove(bassRoot(chord), chord, 1, MAJOR_THIRD);
}

/** @param {import("./leadsheet.js").ChordSegment} chord */
function bassFifth(chord) {
  return chordToneAbove(bassRoot(chord), chord, 2, PERFECT_FIFTH);
}

/**
 * @param {number[]} pitches
 * @returns {ChannelNote[]}
 */
function quarterNotes(pitches) {
  return pitches.map((pitch, beat) => ({ pitch, onset: beat * QUARTER, duration: QUARTER, velocity: VELOCITY_TR }));
}

/**
 * The chord in effect on each of the four beats.
 * @param {import("./leadsheet.js").Bar} bar
 */
function chordsOnBeats(bar) {
  return [0, 1, 2, 3].map((beat) => chordAt(bar, beat * QUARTER));
}

/**
 * @param {import("./leadsheet.js").Bar} bar
 * @returns {ChannelNote[]}
 */
function trRoot(bar) {
  return bar.chords.map((chord) => ({
    pitch: bassRoot(chord),
    onset: chord.onset,
    duration: chord.duration,
    velocity: VELOCITY_TR,
  }));
}

/**
 * @param {import("./leadsheet.js").Bar} bar
 * @returns {ChannelNote[]}
 */
function trOctavePump(bar) {
  /** @type {ChannelNote[]} */
  const notes = [];
  for (let eighth = 0; eighth < 8; eighth++) {
    const onset = eighth * EIGHTH;
    // Even eighths play the root and odd eighths jump an octave up: the bouncing NES bass.
    const pitch = bassRoot(chordAt(bar, onset)) + (eighth % 2 ? OCTAVE : 0);
    notes.push({ pitch, onset, duration: EIGHTH, velocity: VELOCITY_TR });
  }
  return notes;
}

/**
 * @param {import("./leadsheet.js").Bar} bar
 * @returns {ChannelNote[]}
 */
function trRootFifth(bar) {
  const chords = chordsOnBeats(bar);
  return quarterNotes([bassRoot(chords[0]), bassFifth(chords[1]), bassRoot(chords[2]), bassFifth(chords[3])]);
}

/**
 * @param {import("./leadsheet.js").Bar} bar
 * @param {import("./leadsheet.js").Bar | null} nextBar
 * @returns {ChannelNote[]}
 */
function trWalking(bar, nextBar) {
  const chords = chordsOnBeats(bar);
  // Beat 4 is a chromatic approach: one semitone below the root that the next bar starts on.
  // The last bar of the piece has no next root to lead to, so it repeats the fifth.
  const approach = nextBar === null ? bassFifth(chords[3]) : bassRoot(nextBar.chords[0]) - 1;
  return quarterNotes([bassRoot(chords[0]), bassThird(chords[1]), bassFifth(chords[2]), approach]);
}

/**
 * Play the TR bass texture the gene selects (an index into `TR_TEXTURES`).
 *
 * Roots are placed in the bass register 28–39, and each note uses the chord in effect at its
 * onset. The triangle has no volume control, so every note has the same velocity.
 *
 * - root: the root, sustained for each chord segment;
 * - octave_pump: eighth notes alternating the root and the root one octave up;
 * - root_fifth: quarter notes root, fifth, root, fifth;
 * - walking: quarter notes root, third, fifth, then one semitone below the root of `nextBar`
 *   (the fifth again when `nextBar` is null, at the end of the piece).
 *
 * @param {import("./leadsheet.js").Bar} bar the lead-sheet bar.
 * @param {number} textureGene index into `TR_TEXTURES`.
 * @param {import("./leadsheet.js").Bar | null} nextBar the following bar, or null for the last.
 * @returns {ChannelNote[]} a monophonic line, onsets from the bar start.
 * @throws {RangeError} when the gene is not a valid TR gene.
 * @example
 * const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 };
 * const g = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 0, duration: 4 };
 * const cBar = { index: 0, melody: [], chords: [c], label: "A", role: "verse", phrase: 0, phraseEnd: false };
 * const gBar = { ...cBar, index: 1, chords: [g] };
 * realizeTr(cBar, TR_TEXTURES.indexOf("walking"), gBar).map((n) => n.pitch); // [36, 40, 43, 30]
 */
export function realizeTr(bar, textureGene, nextBar) {
  checkGene(textureGene, TR_TEXTURES, "TR texture");
  const texture = TR_TEXTURES[textureGene];
  if (texture === "root") return trRoot(bar);
  if (texture === "octave_pump") return trOctavePump(bar);
  if (texture === "root_fifth") return trRootFifth(bar);
  return trWalking(bar, nextBar);
}

// --- NO: the drum pattern ----------------------------------------------------------------------

const STEPS_PER_BAR = 16;

/**
 * Steps 0, every, 2 × every, … below `end`.
 * @param {number} every
 * @param {number} [end]
 */
function everyStep(every, end = STEPS_PER_BAR) {
  return Object.freeze(Array.from({ length: Math.ceil(end / every) }, (_, index) => index * every));
}

/**
 * A frozen list of steps, so the pattern table cannot change at run time.
 * @param {...number} stepList
 */
function steps(...stepList) {
  return Object.freeze(stepList);
}

// The sixteenth-note steps of each drum in each pattern, written as a drummer thinks of them
// ("hi-hat on every eighth"). Where drums share a step, DRUM_PRIORITY decides who plays.
/** @type {Readonly<Record<string, Readonly<Record<number, readonly number[]>>>>} */
const DRUM_STEPS = Object.freeze({
  none: Object.freeze({}),
  half_time: Object.freeze({ [KICK]: steps(0), [SNARE]: steps(8), [HIHAT]: everyStep(4) }),
  eighth_beat: Object.freeze({ [KICK]: steps(0, 8), [SNARE]: steps(4, 12), [HIHAT]: everyStep(2) }),
  sixteenth_beat: Object.freeze({ [KICK]: steps(0, 8, 11), [SNARE]: steps(4, 12), [HIHAT]: everyStep(1) }),
  // The eighth beat for three beats, then a snare roll on the fourth beat leads into the next bar.
  fill: Object.freeze({ [KICK]: steps(0, 8), [SNARE]: steps(4, 12, 13, 14, 15), [HIHAT]: everyStep(2, 12) }),
});

/**
 * Play the NO drum pattern the gene selects (an index into `NO_PATTERNS`).
 *
 * The bar is a grid of 16 sixteenth-note steps; each hit lasts one step.
 *
 * - none: silence;
 * - half_time: kick on beat 1, snare on beat 3, hi-hat on beats 2 and 4;
 * - eighth_beat: kick on beats 1 and 3, snare on 2 and 4, hi-hat on the off-beat eighths;
 * - sixteenth_beat: kick on beats 1 and 3 and the last sixteenth of beat 3, snare on 2 and 4,
 *   hi-hat on every other sixteenth;
 * - fill: the eighth beat for three beats, then four snare sixteenths.
 *
 * @param {number} patternGene index into `NO_PATTERNS`.
 * @returns {ChannelNote[]} the hits, onsets from the bar start.
 * @throws {RangeError} when the gene is not a valid NO gene.
 * @example
 * realizeNo(NO_PATTERNS.indexOf("half_time")).map((n) => [n.onset, n.pitch]);
 * // [[0, 36], [1, 42], [2, 38], [3, 42]]
 */
export function realizeNo(patternGene) {
  checkGene(patternGene, NO_PATTERNS, "NO pattern");
  const drumSteps = DRUM_STEPS[NO_PATTERNS[patternGene]];
  /** @type {ChannelNote[]} */
  const notes = [];
  for (let step = 0; step < STEPS_PER_BAR; step++) {
    const drum = DRUM_PRIORITY.find((candidate) => drumSteps[candidate]?.includes(step));
    if (drum !== undefined) {
      notes.push({ pitch: drum, onset: step * SIXTEENTH, duration: SIXTEENTH, velocity: DRUM_VELOCITY[drum] });
    }
  }
  return notes;
}
