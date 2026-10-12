// @ts-check
// Write a lead sheet in ABC notation, so that the ABC reader reads back the same lead sheet.
//
// A MIDI song reduced to a lead sheet exists only in memory, and the MIDI file it comes from
// belongs to someone else. Written as ABC, the reduction becomes a small text file that a person
// can read and correct, and that the reader (core/abc-reader.js, or the command line's
// src/leadsheet/abc_reader.py) turns back into the very same lead sheet. Each choice below keeps
// that round trip exact:
//
// - Lengths: the unit note length is a sixteenth (`L:1/16`), so "C4" is a quarter note and every
//   onset and duration on the sixteenth-note grid is a whole number of units. Rests (`z`) fill
//   the silence between notes.
// - Chords: a chord symbol is written just before the note or rest that starts with the chord.
//   When the chord changes while a note sounds, the note is written as two tied pieces
//   (`G4- "G"G4`), which the reader joins back into one note.
// - Accidentals: the key signature (`K:`) sharpens or flattens some letters. ABC 2.1 says that an
//   accidental lasts until the bar line; older ABC applies it to one note only. The writer marks
//   a note whenever the key signature does not give its pitch, and marks again every later note
//   of the same letter in the bar, so both readings give the same pitches.
// - Key: a MIDI song has no key (""), so its lead sheet is written with `K:none`.
// - Tempo: `Q:` keeps 6 decimals, the precision the reader keeps.
// - Form: a `P:` line starts a part, and phrases restart at each part. The writer writes a `P:`
//   line where the label changes and where a phrase starts that counting `phraseLength` bars from
//   the part start would not start. Each phrase goes on its own line.
//
// This module ports src/leadsheet/abc_writer.py and gives the same text, byte for byte. The
// Python code asks music21 for the key signature of a key; here it comes from the circle of
// fifths, which gives the same signature for the major and minor keys and the church modes that
// the writer accepts (keys past 7 sharps or flats get double accidentals, as in music21).

import { BEATS_PER_BAR, phraseMarks } from "./leadsheet.js";

const UNITS_PER_BEAT = 4; // L:1/16: a sixteenth note is the unit, four to a beat
const UNITS_PER_BAR = BEATS_PER_BAR * UNITS_PER_BEAT;
const TEMPO_DECIMALS = 6;

/** Pitch class of each natural note letter, in the order C D E F G A B. */
const LETTER_PITCH_CLASSES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** @type {Record<number, string>} */
const ACCIDENTAL_SIGNS = { [-2]: "__", [-1]: "_", 0: "=", 1: "^", 2: "^^" };

/**
 * With no sharps or flats in the key, black keys are spelled as in chord symbols: Db Eb F# Ab Bb.
 * @type {Record<number, [Letter, number]>}
 */
const PLAIN_KEY_SPELLING = { 1: ["D", -1], 3: ["E", -1], 6: ["F", 1], 8: ["A", -1], 10: ["B", -1] };

/** How ABC writes, after the tonic, each mode that a key name may hold (K:Ebm, K:DDor). */
const ABC_MODES = {
  major: "",
  minor: "m",
  ionian: "Ion",
  aeolian: "Aeo",
  dorian: "Dor",
  phrygian: "Phr",
  lydian: "Lyd",
  mixolydian: "Mix",
  locrian: "Loc",
};

/** Steps around the circle of fifths from the major key on each letter to the mode's key. */
const MODE_FIFTHS = {
  major: 0,
  ionian: 0,
  lydian: 1,
  mixolydian: -1,
  dorian: -2,
  minor: -3,
  aeolian: -3,
  phrygian: -4,
  locrian: -5,
};

/** Sharps of the major key on each natural letter (negative: flats), on the circle of fifths. */
const LETTER_FIFTHS = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };

/** The order in which a key signature adds sharps, and flats. */
const SHARP_ORDER = "FCGDAEB";
const FLAT_ORDER = "BEADGCF";

/** @typedef {keyof typeof LETTER_PITCH_CLASSES} Letter */

/**
 * Options of `writeLeadSheetAbc`.
 * @typedef {object} WriteOptions
 * @property {number} [phraseLength] bars per phrase that the reader will use (default 4).
 * @property {string[]} [comments] lines written as `%` comments at the top of the file.
 */

/**
 * Return the lead sheet as an ABC tune that the ABC reader reads back unchanged.
 *
 * The reader gives back the same bars, melody, chords, labels, phrases and roles when it is
 * called with the same `phraseLength` and role map; the tempo comes back rounded to 6 decimals and
 * `sourceGrid` comes back as null.
 *
 * @param {import("./leadsheet.js").LeadSheet} leadSheet the lead sheet to write (4/4, melody and
 *   chords on the sixteenth-note grid).
 * @param {WriteOptions} [options]
 * @returns {string} the ABC text, ending with a newline.
 * @throws {Error} for a lead sheet ABC cannot hold: a meter other than 4/4, a note off the
 *   sixteenth-note grid, overlapping melody notes, chords that leave a gap, or phrases that
 *   `phraseLength` cannot reproduce. The message names the bar when it can.
 * @example
 * const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 2 };
 * const g = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 2, duration: 2 };
 * const melody = [{ pitch: 60, onset: 0, duration: 1 }, { pitch: 66, onset: 1, duration: 3 }];
 * const bar = { index: 0, melody, chords: [c, g], label: "A", role: "verse", phrase: 0, phraseEnd: true };
 * writeLeadSheetAbc({ title: "Demo", key: "C major", tempoBpm: 120, bars: [bar], beatsPerBar: 4,
 *   sourceGrid: null });
 * // "%abc-2.1\nX:1\nT:Demo\nM:4/4\nL:1/16\nQ:1/4=120\nK:C\nP:A\n\"C\"C4 ^F4- \"G\"^F8 |\n"
 */
export function writeLeadSheetAbc(leadSheet, options = {}) {
  const { phraseLength = 4, comments = [] } = options;
  if (leadSheet.beatsPerBar !== BEATS_PER_BAR) {
    throw new Error(`only 4/4 can be written, not ${leadSheet.beatsPerBar} beats per bar`);
  }
  const { field, signature, sharps } = keySignature(leadSheet.key);
  const lines = ["%abc-2.1", ...comments.map((line) => `% ${line}`.trimEnd())];
  lines.push("X:1", `T:${leadSheet.title}`, "M:4/4", "L:1/16");
  lines.push(`Q:1/4=${tempoText(leadSheet.tempoBpm)}`);
  if (Number(leadSheet.tempoBpm.toFixed(TEMPO_DECIMALS)) !== leadSheet.tempoBpm) {
    lines.push(
      `% Exact tempo ${leadSheet.tempoBpm} quarter notes per minute; Q: keeps ${TEMPO_DECIMALS} decimals.`,
    );
  }
  lines.push(`K:${field}`);

  const bars = leadSheet.bars;
  /** @type {string[]} */
  let phraseLine = [];
  partStarts(bars, phraseLength).forEach((startsPart, index) => {
    const newPhrase = index === 0 || startsPart || bars[index].phrase !== bars[index - 1].phrase;
    if (newPhrase && phraseLine.length > 0) {
      lines.push(`${phraseLine.join(" | ")} |`);
      phraseLine = [];
    }
    // Bars before the first P: line have the empty label, so they need no P: line.
    if (startsPart && (index > 0 || bars[index].label)) {
      lines.push(`P:${bars[index].label}`);
    }
    phraseLine.push(barText(bars[index], signature, sharps));
  });
  if (phraseLine.length > 0) {
    lines.push(`${phraseLine.join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The key signature of a key named as music21 names it.
 * @typedef {object} KeySignature
 * @property {string} field the K: value, for example "Ebm" or "none".
 * @property {Partial<Record<Letter, number>>} signature letter → alteration (+1 sharp, -1 flat).
 * @property {number} sharps number of sharps (negative: flats).
 */

/**
 * Return the K: value, the key signature and the number of sharps of a key name.
 * @param {string} keyName for example "e- minor", "D dorian" or "" (no key).
 * @returns {KeySignature}
 */
function keySignature(keyName) {
  if (!keyName) {
    return { field: "none", signature: {}, sharps: 0 };
  }
  const space = keyName.indexOf(" ");
  const tonic = space < 0 ? keyName : keyName.slice(0, space);
  const mode = space < 0 ? "" : keyName.slice(space + 1);
  const tonicParts = /^([A-Ga-g])([#-]*)$/.exec(tonic);
  if (!Object.hasOwn(ABC_MODES, mode) || tonicParts === null) {
    throw new Error(`cannot write the key '${keyName}' in ABC`);
  }
  const modeName = /** @type {keyof typeof ABC_MODES} */ (mode);
  const letter = /** @type {Letter} */ (tonicParts[1].toUpperCase());
  const alteration = [...tonicParts[2]].reduce((sum, sign) => sum + (sign === "#" ? 1 : -1), 0);
  const sharps = LETTER_FIFTHS[letter] + 7 * alteration + MODE_FIFTHS[modeName];

  /** @type {Partial<Record<Letter, number>>} */
  const signature = {};
  const order = sharps > 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let count = 0; count < Math.abs(sharps); count += 1) {
    // Past 7 sharps (or flats) the signature starts again with double sharps (or flats).
    const altered = /** @type {Letter} */ (order[count % 7]);
    signature[altered] = (signature[altered] ?? 0) + Math.sign(sharps);
  }
  const abcTonic = letter + tonicParts[2].replaceAll("-", "b");
  return { field: abcTonic + ABC_MODES[modeName], signature, sharps };
}

/**
 * Write a tempo with at most 6 decimals and no trailing zeros ("120", "110.1", "132.500055").
 * @param {number} tempoBpm
 * @returns {string}
 */
function tempoText(tempoBpm) {
  return tempoBpm.toFixed(TEMPO_DECIMALS).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Mark the bars where a `P:` line must start a part so the reader finds the same phrases.
 * @param {import("./leadsheet.js").Bar[]} bars
 * @param {number} phraseLength
 * @returns {boolean[]}
 */
function partStarts(bars, phraseLength) {
  /** @type {boolean[]} */
  const starts = [];
  let position = 0;
  bars.forEach((bar, index) => {
    let startsPart = true;
    if (index > 0) {
      position += 1;
      const previous = bars[index - 1];
      // Counting from the part start, the reader begins a phrase every phraseLength bars; a
      // phrase that starts anywhere else needs a part of its own.
      const unexpectedPhrase = bar.phrase !== previous.phrase && position % phraseLength !== 0;
      startsPart = bar.label !== previous.label || unexpectedPhrase;
    }
    if (startsPart) position = 0;
    starts.push(startsPart);
  });
  let section = 0;
  const sections = starts.map((startsPart) => (section += startsPart ? 1 : 0));
  const marks = phraseMarks(sections, phraseLength);
  const matches = marks.every(
    ([phrase, phraseEnd], index) => phrase === bars[index].phrase && phraseEnd === bars[index].phraseEnd,
  );
  if (!matches) {
    throw new Error(
      `the phrases of this lead sheet cannot be written for phrase_length=${phraseLength}: ` +
        "a phrase is longer than phrase_length bars or a phrase end does not match",
    );
  }
  return starts;
}

/**
 * Convert beats to sixteenth-note units, refusing values off the sixteenth-note grid.
 * @param {number} beats
 * @param {import("./leadsheet.js").Bar} bar the bar, to name it in the error.
 * @param {string} what what the value is, for the error.
 * @returns {number}
 */
function units(beats, bar, what) {
  const exact = beats * UNITS_PER_BEAT;
  const rounded = Math.round(exact);
  if (Math.abs(exact - rounded) > 1e-6) {
    throw new Error(`bar ${bar.index + 1}: ${what} ${beats} is off the sixteenth-note grid`);
  }
  return rounded;
}

/**
 * Write one bar: chord symbols, notes, tied pieces and rests, separated by spaces.
 * @param {import("./leadsheet.js").Bar} bar
 * @param {Partial<Record<Letter, number>>} signature
 * @param {number} sharps
 * @returns {string}
 */
function barText(bar, signature, sharps) {
  const chordStarts = chordStartsOf(bar);
  // Pieces of time in sixteenth units: [start, end, MIDI pitch or null for a rest].
  /** @type {Array<[number, number, number | null]>} */
  const pieces = [];
  let position = 0;
  for (const note of bar.melody) {
    const start = units(note.onset, bar, "onset");
    const end = units(note.onset + note.duration, bar, "note end");
    if (start < position || end <= start || end > UNITS_PER_BAR) {
      throw new Error(
        `bar ${bar.index + 1}: melody notes overlap or leave the bar; an ABC lead sheet holds one ` +
          "note at a time, inside its bar",
      );
    }
    if (start > position) pieces.push([position, start, null]);
    pieces.push([start, end, note.pitch]);
    position = end;
  }
  if (position < UNITS_PER_BAR) pieces.push([position, UNITS_PER_BAR, null]);

  /** @type {string[]} */
  const tokens = [];
  /** @type {Set<Letter>} */
  const markedLetters = new Set();
  const changes = [...chordStarts.keys()].sort((a, b) => a - b);
  for (const [start, end, pitch] of pieces) {
    const cuts = [start, ...changes.filter((change) => start < change && change < end), end];
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const [pieceStart, pieceEnd] = [cuts[index], cuts[index + 1]];
      const chordText = chordStarts.has(pieceStart) ? `"${chordStarts.get(pieceStart)}"` : "";
      let name = "z";
      if (pitch !== null) {
        const [letter, alteration, octave] = spell(pitch, signature, sharps);
        // Once a letter is marked in this bar, every later note of it is marked too.
        const marked = markedLetters.has(letter) || alteration !== (signature[letter] ?? 0);
        if (marked) markedLetters.add(letter);
        name = noteName(letter, alteration, octave, marked);
      }
      const length = pieceEnd - pieceStart;
      const tie = pitch !== null && pieceEnd < end ? "-" : "";
      tokens.push(`${chordText}${name}${length > 1 ? length : ""}${tie}`);
    }
  }
  return tokens.join(" ");
}

/**
 * Return {start in sixteenth units → chord symbol}, checking that the chords cover the bar.
 * @param {import("./leadsheet.js").Bar} bar
 * @returns {Map<number, string>}
 */
function chordStartsOf(bar) {
  /** @type {Map<number, string>} */
  const starts = new Map();
  let position = 0;
  for (const segment of bar.chords) {
    const start = units(segment.onset, bar, "chord onset");
    if (start !== position) break;
    starts.set(start, segment.symbol);
    position = units(segment.onset + segment.duration, bar, "chord end");
  }
  if (position !== UNITS_PER_BAR || starts.size !== bar.chords.length) {
    throw new Error(
      `bar ${bar.index + 1}: the chord segments must cover the bar from beat 0 to beat 4 without ` +
        "gaps or overlaps",
    );
  }
  return starts;
}

/**
 * Spell a MIDI pitch as [letter, alteration, octave] in a key.
 *
 * A pitch of the key's scale takes the letter the key signature gives it; another white key is
 * a natural; another black key is a sharp in a sharp key and a flat in a flat key.
 *
 * @param {number} pitch MIDI pitch.
 * @param {Partial<Record<Letter, number>>} signature
 * @param {number} sharps
 * @returns {[Letter, number, number]}
 */
function spell(pitch, signature, sharps) {
  const pitchClass = mod12(pitch);
  const letters = /** @type {Letter[]} */ (Object.keys(LETTER_PITCH_CLASSES));
  const inKey = letters.find(
    (letter) => mod12(LETTER_PITCH_CLASSES[letter] + (signature[letter] ?? 0)) === pitchClass,
  );
  /** @type {[Letter, number]} */
  let spelling;
  if (inKey !== undefined) {
    spelling = [inKey, signature[inKey] ?? 0];
  } else {
    /** @param {number} natural */
    const letterOf = (natural) =>
      /** @type {Letter} */ (letters.find((letter) => LETTER_PITCH_CLASSES[letter] === natural));
    if (letters.some((letter) => LETTER_PITCH_CLASSES[letter] === pitchClass)) {
      spelling = [letterOf(pitchClass), 0];
    } else if (sharps > 0) {
      spelling = [letterOf(pitchClass - 1), 1];
    } else if (sharps < 0) {
      spelling = [letterOf(mod12(pitchClass + 1)), -1];
    } else {
      spelling = PLAIN_KEY_SPELLING[pitchClass];
    }
  }
  const [letter, alteration] = spelling;
  // The octave belongs to the letter: C-flat 5 sounds as B 4 (MIDI 71).
  const octave = Math.floor((pitch - alteration - LETTER_PITCH_CLASSES[letter]) / 12) - 1;
  return [letter, alteration, octave];
}

/**
 * Write a note name in ABC: C is middle C (octave 4), c the octave above, C, and c' beyond.
 * @param {Letter} letter
 * @param {number} alteration
 * @param {number} octave
 * @param {boolean} marked whether to write the accidental.
 * @returns {string}
 */
function noteName(letter, alteration, octave, marked) {
  const sign = marked ? ACCIDENTAL_SIGNS[alteration] : "";
  if (octave >= 5) return sign + letter.toLowerCase() + "'".repeat(octave - 5);
  return sign + letter + ",".repeat(4 - octave);
}

/**
 * @param {number} value
 * @returns {number} `value` modulo 12, always in [0, 11].
 */
function mod12(value) {
  return ((value % 12) + 12) % 12;
}
