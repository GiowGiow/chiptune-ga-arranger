// @ts-check
// Chord symbols as pitch classes, and pitch classes placed in a register.
//
// A chord symbol such as "Am" or "Bbm7" names a root and a chord quality. The arranger needs the
// chord tones: the root, the third, the fifth and, for seventh chords, the seventh. It handles
// them as pitch classes, numbers from 0 (C) to 11 (B) that ignore the octave, because the same
// chord can be played in any register. To play a tone, a channel picks one octave:
// `placeInRegister` turns a pitch class into the one MIDI pitch of that class inside a
// 12-semitone window.
//
// This module ports src/leadsheet/chords.py. The Python code asks music21's ChordSymbol for the
// tones; here a table of chord qualities gives the same answers for the symbols in
// tests/fixtures/chords.json and for the other spellings listed below, quirks included: music21
// keeps only the root, third, fifth and seventh, so "C6" and "Cadd9" are plain triads and "C9"
// is C7, and a suspended chord has no third at all.
//
// Known differences from music21: the root must be an upper-case letter with at most one "#" or
// "b"; "-" is not read as a flat ("C-7"); and spellings missing from the table ("C69", "Cmaj9")
// are rejected even where music21 gives an answer.

/** Pitch class of each natural note letter. */
const LETTER_PITCH_CLASSES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The note letters in scale order, to count letter steps between a root and a bass note. */
const LETTERS = "CDEFGAB";

/**
 * The chord qualities: `[third, fifth, seventh]` in semitones above the root (null when the
 * chord has no such tone), then every spelling of that quality that may follow the root.
 * @type {Array<[[number | null, number | null, number | null], string[]]>}
 */
const CHORD_QUALITIES = [
  [[4, 7, null], ["", "maj", "M", "6", "add9", "add2"]],
  [[3, 7, null], ["m", "min", "m6"]],
  [[4, 7, 10], ["7", "dom7", "9", "11", "13", "7b9", "7#9", "7#11"]],
  [[3, 7, 10], ["m7", "min7", "m9", "m11"]],
  [[4, 7, 11], ["maj7", "M7", "M9"]],
  [[3, 7, 11], ["mM7"]],
  [[4, 8, null], ["aug", "+"]],
  [[4, 8, 10], ["aug7", "+7", "7+", "7#5"]],
  [[3, 6, null], ["dim", "o"]],
  [[3, 6, 9], ["dim7", "o7"]],
  [[3, 6, 10], ["m7b5", "ø7"]],
  [[4, 6, 10], ["7b5"]],
  [[null, 7, null], ["sus", "sus2", "sus4", "5"]],
  [[null, 7, 10], ["7sus", "7sus4"]],
];

/** Spelling of a quality → its `[third, fifth, seventh]` intervals. */
const INTERVALS_BY_QUALITY = new Map(
  CHORD_QUALITIES.flatMap(([intervals, spellings]) => spellings.map((spelling) => [spelling, intervals])),
);

/** A root or bass note: one upper-case letter and an optional sharp or flat. */
const NOTE_NAME = /^([A-G])([#b]?)$/;

/** A chord symbol: root, quality, and an optional "/bass" (the part after the first "/"). */
const CHORD_SYMBOL = /^([A-G][#b]?)([^/]*)(?:\/(.*))?$/;

/**
 * Return the root pitch class and the chord tones of a chord symbol.
 *
 * The tones are ordered root, third, fifth and then the seventh when the chord has one. A
 * lower-case "b" right after a note letter means flat, as in lead sheets ("Eb", "Bbm7"). In a
 * slash chord ("D/F#") the bass note is not a chord tone, unless its letter is the seventh letter
 * above the root: then it is the chord's seventh, as music21 reads it ("C/Bb" is C7).
 *
 * @param {string} symbol chord symbol, for example "C", "Am", "Ebm", "Bbm7", "F#7" or "G/B".
 * @returns {[number, number[]]} `[root, tones]`: the root pitch class and the chord-tone pitch
 *   classes, root first.
 * @throws {Error} naming the symbol when it is not a chord symbol this table knows.
 * @example
 * chordTones("Am"); // [9, [9, 0, 4]]
 * chordTones("Bbm7"); // [10, [10, 1, 5, 8]]
 */
export function chordTones(symbol) {
  const parts = CHORD_SYMBOL.exec(symbol);
  const intervals = parts === null ? undefined : INTERVALS_BY_QUALITY.get(parts[2]);
  const bass = parts?.[3] === undefined ? null : NOTE_NAME.exec(parts[3]);
  if (parts === null || intervals === undefined || (parts[3] !== undefined && bass === null)) {
    throw new Error(`unknown chord symbol '${symbol}'`);
  }

  const rootName = /** @type {RegExpExecArray} */ (NOTE_NAME.exec(parts[1]));
  const root = pitchClass(rootName);
  let [third, fifth, seventh] = intervals;
  if (bass !== null && letterSteps(rootName[1], bass[1]) === 6) {
    seventh = mod12(pitchClass(bass) - root);
  }
  const tones = [0, third, fifth, seventh]
    .filter((interval) => interval !== null)
    .map((interval) => mod12(root + /** @type {number} */ (interval)));
  return [root, tones];
}

/**
 * Return the only MIDI pitch with this pitch class in the range [low, low + 11].
 *
 * @param {number} pitchClass pitch class from 0 (C) to 11 (B).
 * @param {number} low lowest MIDI pitch of the register.
 * @returns {number} a MIDI pitch `p` with `p % 12 === pitchClass` and `low <= p <= low + 11`.
 * @example
 * placeInRegister(0, 48); // 48: C3, the bottom of the register
 * placeInRegister(1, 50); // 61: the register starts on D3, so C# lands on C#4
 */
export function placeInRegister(pitchClass, low) {
  return low + mod12(pitchClass - low);
}

/**
 * @param {RegExpExecArray} noteName a match of NOTE_NAME: letter and accidental.
 * @returns {number} its pitch class.
 */
function pitchClass(noteName) {
  const [, letter, accidental] = noteName;
  const alteration = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return mod12(LETTER_PITCH_CLASSES[/** @type {keyof LETTER_PITCH_CLASSES} */ (letter)] + alteration);
}

/**
 * Letter steps from one note letter up to another, from 0 (same letter) to 6 (a seventh).
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
function letterSteps(from, to) {
  return (LETTERS.indexOf(to) - LETTERS.indexOf(from) + 7) % 7;
}

/**
 * @param {number} value
 * @returns {number} `value` modulo 12, always in [0, 11].
 */
function mod12(value) {
  return ((value % 12) + 12) % 12;
}
