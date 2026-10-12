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
// - NO plays a drum pattern on the bar's grid of sixteenth-note steps.
//
// The NES sound chip (2A03) has four channels that each play one note at a time, so every
// realizer returns a monophonic line: notes sorted by onset that never overlap and stay inside
// the bar. Onsets are in beats from the bar start. Realizers are pure functions, so the same bar
// and gene always give the same notes.
//
// The bar's meter (core/meter.js) shapes the bass and the drums: the bass plays one note per beat
// and the root on strong beats, and the drums kick on strong beats and hit the snare on weak
// ones. A waltz bar (3/4) thus gets "oom-pah-pah" and a 6/8 bar a kick on its first eighth and a
// snare on its fourth. In 4/4 these rules give exactly the patterns of a four-beat bar: root,
// fifth, root, fifth; kick on beats 1 and 3, snare on 2 and 4.
//
// The pitch ranges follow the hardware limits reported for the NES Music Database (pulse 32-108,
// triangle 21-108, Donahue et al., 2018); the pulse range starts one semitone higher to be safe.

import { NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES } from "./genome.js";
import { chordAt } from "./leadsheet.js";
import { FOUR_FOUR, beatOnsets } from "./meter.js";

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

// Note lengths in beats (a beat is a quarter note).
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
 * const bar = { index: 0, melody, chords: [c], label: "A", role: "verse", phrase: 0, phraseEnd: false,
 *   meter: FOUR_FOUR };
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
  const barEnd = bar.meter.barBeats;
  /** @type {ChannelNote[]} */
  const notes = [];
  for (const note of bar.melody) {
    const onset = note.onset + EIGHTH;
    if (onset >= barEnd) continue; // the echo of the bar's last eighth would fall into the next bar
    const duration = Math.min(note.duration, barEnd - onset);
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
 * - echo: the written melody one eighth note later, softer, cut at the end of the bar (its
 *   meter's length);
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
 * const bar = { index: 0, melody: [], chords: [c, g], label: "A", role: "verse", phrase: 0, phraseEnd: false,
 *   meter: FOUR_FOUR };
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
 * One bass note per beat of the bar's meter, each lasting the whole beat.
 * @param {import("./leadsheet.js").Bar} bar
 * @param {number[]} pitches one pitch per beat.
 * @returns {ChannelNote[]}
 */
function onePerBeat(bar, pitches) {
  const onsets = beatOnsets(bar.meter);
  return pitches.map((pitch, beat) => ({
    pitch,
    onset: onsets[beat],
    duration: bar.meter.beats[beat],
    velocity: VELOCITY_TR,
  }));
}

/**
 * The chord in effect at the start of each beat.
 * @param {import("./leadsheet.js").Bar} bar
 */
function chordsOnBeats(bar) {
  return beatOnsets(bar.meter).map((onset) => chordAt(bar, onset));
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
  const eighths = Math.round(bar.meter.barBeats / EIGHTH);
  for (let eighth = 0; eighth < eighths; eighth++) {
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
  // The root anchors the strong beats and the fifth fills the weak ones: root, fifth, root,
  // fifth in 4/4, and the waltz's "oom-pah-pah" (root, fifth, fifth) in 3/4.
  const strong = bar.meter.strong;
  return onePerBeat(
    bar,
    chordsOnBeats(bar).map((chord, beat) => (strong.includes(beat) ? bassRoot(chord) : bassFifth(chord))),
  );
}

// The chord tones a walking line climbs through, one per beat, before its last beat.
const WALKING_STEPS = Object.freeze([bassRoot, bassThird, bassFifth]);

/**
 * @param {import("./leadsheet.js").Bar} bar
 * @param {import("./leadsheet.js").Bar | null} nextBar
 * @returns {ChannelNote[]}
 */
function trWalking(bar, nextBar) {
  const chords = chordsOnBeats(bar);
  const climb = chords.slice(0, -1).map((chord, beat) => WALKING_STEPS[beat % WALKING_STEPS.length](chord));
  // The last beat is a chromatic approach: one semitone below the root that the next bar starts
  // on. The last bar of the piece has no next root to lead to, so it repeats the fifth.
  const approach = nextBar === null ? bassFifth(chords[chords.length - 1]) : bassRoot(nextBar.chords[0]) - 1;
  return onePerBeat(bar, [...climb, approach]);
}

/**
 * Play the TR bass texture the gene selects (an index into `TR_TEXTURES`).
 *
 * Roots are placed in the bass register 28–39, and each note uses the chord in effect at its
 * onset. The triangle has no volume control, so every note has the same velocity. "Beat" means
 * a beat of the bar's meter: a quarter note in 4/4, a dotted quarter in 6/8.
 *
 * - root: the root, sustained for each chord segment;
 * - octave_pump: eighth notes alternating the root and the root one octave up;
 * - root_fifth: one note per beat, the root on strong beats and the fifth on weak beats
 *   (root, fifth, root, fifth in 4/4);
 * - walking: one note per beat climbing root, third, fifth (and again), then on the last beat
 *   one semitone below the root of `nextBar` (the fifth again when `nextBar` is null, at the end
 *   of the piece).
 *
 * @param {import("./leadsheet.js").Bar} bar the lead-sheet bar.
 * @param {number} textureGene index into `TR_TEXTURES`.
 * @param {import("./leadsheet.js").Bar | null} nextBar the following bar, or null for the last.
 * @returns {ChannelNote[]} a monophonic line, onsets from the bar start.
 * @throws {RangeError} when the gene is not a valid TR gene.
 * @example
 * const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 };
 * const g = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 0, duration: 4 };
 * const cBar = { index: 0, melody: [], chords: [c], label: "A", role: "verse", phrase: 0, phraseEnd: false,
 *   meter: FOUR_FOUR };
 * const gBar = { ...cBar, index: 1, chords: [g] };
 * realizeTr(cBar, TR_TEXTURES.indexOf("walking"), gBar).map((n) => n.pitch); // [36, 40, 43, 30]
 * // In 3/4, root_fifth is the waltz's oom-pah-pah:
 * const waltzBar = { ...cBar, chords: [{ ...c, duration: 3 }], meter: parseMeter("3/4") };
 * realizeTr(waltzBar, TR_TEXTURES.indexOf("root_fifth"), null).map((n) => n.pitch); // [36, 43, 43]
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

// Sixteenth-note steps in a quarter note: a beat that starts at quarter q is step 4q.
const STEPS_PER_BEAT = 4;

/**
 * The sixteenth-note steps of each drum in a pattern, built from the meter's beats.
 *
 * A drummer thinks of the patterns in beats: the kick marks the strong beats, the snare the weak
 * ones and the hi-hat keeps time. Steps count sixteenth notes from the bar start. Where drums
 * share a step, `DRUM_PRIORITY` decides which one `realizeNo` plays.
 *
 * @param {string} pattern a name from `NO_PATTERNS`.
 * @param {import("./meter.js").Meter} [meter] the bar's meter; 4/4 when omitted.
 * @returns {Record<number, Set<number>>} the steps of each drum (KICK, SNARE, HIHAT) that plays;
 *   empty for "none".
 * @example
 * drumSteps("eighth_beat"); // kick {0, 8}, snare {4, 12}, hi-hat {0, 2, 4, …, 14}
 * drumSteps("eighth_beat", parseMeter("6/8")); // kick {0}, snare {6}, hi-hat {0, 2, 4, 6, 8, 10}
 */
export function drumSteps(pattern, meter = FOUR_FOUR) {
  const beatSteps = beatOnsets(meter).map((onset) => Math.round(onset * STEPS_PER_BEAT));
  const strong = meter.strong.map((beat) => beatSteps[beat]);
  const weak = beatSteps.filter((_, beat) => !meter.strong.includes(beat));
  const eighths = stepRange(0, meter.steps, 2);
  if (pattern === "none") return {};
  if (pattern === "half_time") {
    // Kick on beat 1 and snare on the next strong beat (beat 3 in 4/4), if the bar has one.
    return { [KICK]: new Set([0]), [SNARE]: new Set(strong.slice(1, 2)), [HIHAT]: new Set(beatSteps) };
  }
  if (pattern === "eighth_beat") {
    return { [KICK]: new Set(strong), [SNARE]: new Set(weak), [HIHAT]: new Set(eighths) };
  }
  if (pattern === "sixteenth_beat") {
    // A pickup kick on the last sixteenth of the last strong beat pushes into the next beat.
    const lastStrong = meter.strong[meter.strong.length - 1];
    const pickup = beatSteps[lastStrong] + Math.round(meter.beats[lastStrong] * STEPS_PER_BEAT) - 1;
    return { [KICK]: new Set([...strong, pickup]), [SNARE]: new Set(weak), [HIHAT]: new Set(stepRange(0, meter.steps, 1)) };
  }
  // "fill": the eighth beat until the last beat, then a snare roll on every sixteenth of it
  // leads into the next bar. The last beat is always weak, so the roll replaces its snare.
  const roll = beatSteps[beatSteps.length - 1];
  return {
    [KICK]: new Set(strong.filter((step) => step < roll)),
    [SNARE]: new Set([...weak.filter((step) => step < roll), ...stepRange(roll, meter.steps, 1)]),
    [HIHAT]: new Set(eighths.filter((step) => step < roll)),
  };
}

/**
 * Steps start, start + every, … below end.
 * @param {number} start
 * @param {number} end
 * @param {number} every
 */
function stepRange(start, end, every) {
  return Array.from({ length: Math.max(0, Math.ceil((end - start) / every)) }, (_, index) => start + index * every);
}

/**
 * Play the NO drum pattern the gene selects (an index into `NO_PATTERNS`).
 *
 * The bar is a grid of sixteenth-note steps (16 in 4/4, 12 in 3/4); each hit lasts one step.
 * "Strong" and "weak" beats are those of the meter (see `drumSteps`).
 *
 * - none: silence;
 * - half_time: kick on beat 1, snare on the second strong beat if the meter has one (beat 3 in
 *   4/4), hi-hat on every beat;
 * - eighth_beat: kick on the strong beats, snare on the weak beats, hi-hat on the off-beat
 *   eighths (in 4/4: kick on 1 and 3, snare on 2 and 4);
 * - sixteenth_beat: the eighth beat plus a kick on the last sixteenth of the last strong beat,
 *   hi-hat on the other sixteenths;
 * - fill: the eighth beat until the last beat, then a snare on each of its sixteenths.
 *
 * @param {number} patternGene index into `NO_PATTERNS`.
 * @param {import("./meter.js").Meter} [meter] the bar's meter; 4/4 when omitted.
 * @returns {ChannelNote[]} the hits, onsets from the bar start.
 * @throws {RangeError} when the gene is not a valid NO gene.
 * @example
 * realizeNo(NO_PATTERNS.indexOf("half_time")).map((n) => [n.onset, n.pitch]);
 * // [[0, 36], [1, 42], [2, 38], [3, 42]]
 * realizeNo(NO_PATTERNS.indexOf("eighth_beat"), parseMeter("3/4")).map((n) => [n.onset, n.pitch]);
 * // [[0, 36], [0.5, 42], [1, 38], [1.5, 42], [2, 38], [2.5, 42]]: the waltz
 */
export function realizeNo(patternGene, meter = FOUR_FOUR) {
  checkGene(patternGene, NO_PATTERNS, "NO pattern");
  const steps = drumSteps(NO_PATTERNS[patternGene], meter);
  /** @type {ChannelNote[]} */
  const notes = [];
  for (let step = 0; step < meter.steps; step++) {
    const drum = DRUM_PRIORITY.find((candidate) => steps[candidate]?.has(step));
    if (drum !== undefined) {
      notes.push({ pitch: drum, onset: step * SIXTEENTH, duration: SIXTEENTH, velocity: DRUM_VELOCITY[drum] });
    }
  }
  return notes;
}
