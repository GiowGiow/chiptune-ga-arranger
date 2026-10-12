// @ts-check
// The lead sheet: what the arranger starts from. It holds the melody, the chord in effect at every
// moment and the form, that is, which bars belong to the verse or the chorus and where each phrase
// ends. Times are quarter-note beats from the start of the bar and pitches are MIDI numbers (60 is
// middle C). Each bar carries its meter (core/meter.js), so a 4/4 bar spans the beats [0, 4), a
// 3/4 bar [0, 3) and a 6/8 bar [0, 3); a song may change meter from one bar to the next.
//
// This module ports the data types of src/leadsheet/model.py and the form and chord helpers of
// src/leadsheet/abc_reader.py (`phrase_marks`, `section_role`, `_chord_segments`). It also reads
// the JSON fixtures that the Python code writes, which keep the Python field names.

import { FOUR_FOUR, parseMeter } from "./meter.js";

/**
 * The length of a 4/4 bar in beats, the meter of a bar that declares none.
 * @type {number}
 */
const BEATS_PER_BAR = FOUR_FOUR.barBeats;

/**
 * One melody note inside a bar.
 * @typedef {object} MelodyNote
 * @property {number} pitch MIDI pitch number (0–127).
 * @property {number} onset start, in beats from the start of the bar (0 ≤ onset < the bar
 *   length).
 * @property {number} duration length in beats (> 0, and onset + duration ≤ the bar length).
 */

/**
 * The stretch of a bar during which one chord symbol is in effect.
 * @typedef {object} ChordSegment
 * @property {string} symbol chord symbol as written in the lead sheet, for example "Ebm".
 * @property {number} root pitch class of the chord root (0 = C, 1 = C#/Db, …, 11 = B).
 * @property {number[]} tones pitch classes ordered root, third, fifth and the seventh if any.
 * @property {number} onset start, in beats from the start of the bar.
 * @property {number} duration length in beats.
 */

/**
 * "verse" or "chorus": the part of the form a bar belongs to.
 * @typedef {"verse" | "chorus"} Role
 */

/**
 * One bar of the lead sheet, with its meter and its place in the form.
 * @typedef {object} Bar
 * @property {number} index position of the bar in the piece, starting at 0.
 * @property {MelodyNote[]} melody melody notes of the bar, in time order.
 * @property {ChordSegment[]} chords chord segments that cover [0, meter.barBeats) without gaps.
 * @property {string} label part label from the lead sheet, for example "A" or "B".
 * @property {Role} role derived from the label by `sectionRole`.
 * @property {number} phrase index of the phrase that holds the bar, counted over the piece.
 * @property {boolean} phraseEnd true when the bar is the last bar of its phrase.
 * @property {import("./meter.js").Meter} meter the bar's meter (`FOUR_FOUR` unless the lead
 *   sheet says otherwise); phrases count bars, whatever their length.
 */

/**
 * A whole lead sheet: metadata and the bars in performed order (repeats played out).
 * @typedef {object} LeadSheet
 * @property {string} title tune title.
 * @property {string} key music21-style key name, for example "e- minor"; "" for none.
 * @property {number} tempoBpm tempo in quarter notes per minute.
 * @property {Bar[]} bars the bars, in performed order; each bar has its own meter.
 * @property {[number, number] | null} sourceGrid for a lead sheet reduced from a MIDI song,
 *   [tempo in BPM, seconds of the first downbeat] of the beat grid found in it; null for ABC.
 */

/**
 * Give each bar its phrase index and whether it is the last bar of its phrase.
 *
 * Phrases are chunks of `phraseLength` bars counted from the start of each section, so a section
 * of 6 bars with 4-bar phrases holds one 4-bar phrase and one 2-bar phrase. Phrase indices count
 * over the whole piece. A section is a run of consecutive bars with the same id, so a section
 * that comes back later starts new phrases.
 *
 * @param {number[]} sections section id of each bar, in order.
 * @param {number} phraseLength bars per phrase (≥ 1).
 * @returns {Array<[number, boolean]>} `[phrase, phraseEnd]` for each bar.
 * @example
 * phraseMarks([1, 1, 1, 1, 1, 1, 2, 2], 4);
 * // [[0, false], [0, false], [0, false], [0, true], [1, false], [1, true], [2, false], [2, true]]
 */
export function phraseMarks(sections, phraseLength) {
  /** @type {Array<[number, boolean]>} */
  const marks = [];
  let firstPhrase = 0;
  for (const sectionSize of consecutiveRunLengths(sections)) {
    for (let position = 0; position < sectionSize; position += 1) {
      const phrase = firstPhrase + Math.floor(position / phraseLength);
      const endsPhrase = (position + 1) % phraseLength === 0 || position + 1 === sectionSize;
      marks.push([phrase, endsPhrase]);
    }
    firstPhrase = marks[marks.length - 1][0] + 1;
  }
  return marks;
}

/**
 * Lengths of the runs of equal consecutive values, as Python's `itertools.groupby` groups them.
 * @param {number[]} values
 * @returns {number[]}
 */
function consecutiveRunLengths(values) {
  /** @type {number[]} */
  const lengths = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0 && values[index] === values[index - 1]) {
      lengths[lengths.length - 1] += 1;
    } else {
      lengths.push(1);
    }
  }
  return lengths;
}

/**
 * Return "verse" or "chorus" for a part label.
 *
 * @param {string} label part label, for example "A", "B" or "Chorus 2".
 * @param {Record<string, Role> | null | undefined} roleMap labels whose role the visitor set;
 *   a label it does not name keeps the guessed role.
 * @returns {Role}
 * @example
 * ["B", "Chorus 2", "A"].map((label) => sectionRole(label, null)); // ["chorus", "chorus", "verse"]
 * sectionRole("A", { A: "chorus" }); // "chorus"
 */
export function sectionRole(label, roleMap) {
  if (roleMap != null && Object.hasOwn(roleMap, label)) {
    return roleMap[label];
  }
  // In a two-part tune (A B), the B part usually plays the role of the chorus.
  return label.toLowerCase().includes("chorus") || label === "B" ? "chorus" : "verse";
}

/**
 * Return the chord segment in effect at `onset` (beats from the bar start).
 *
 * @param {Pick<Bar, "chords">} bar a bar, or anything with its chord segments.
 * @param {number} onset beats from the start of the bar.
 * @returns {ChordSegment} the last segment that starts at or before `onset`, or the first
 *   segment when none does.
 * @example
 * const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0.0, duration: 2.0 };
 * const g = { symbol: "G", root: 7, tones: [7, 11, 2], onset: 2.0, duration: 2.0 };
 * const bar = { chords: [c, g] };
 * [chordAt(bar, 0.0).symbol, chordAt(bar, 1.75).symbol, chordAt(bar, 2.0).symbol];
 * // ["C", "C", "G"]
 */
export function chordAt(bar, onset) {
  // Onsets come from float arithmetic (tuplets, tick grids); the tolerance keeps a note that
  // lands a hair before a chord change on the new chord, as the Python code does.
  for (let index = bar.chords.length - 1; index >= 0; index -= 1) {
    if (bar.chords[index].onset <= onset + 1e-9) {
      return bar.chords[index];
    }
  }
  return bar.chords[0];
}

/**
 * Turn the chord changes of each bar into segments that cover the whole bar.
 *
 * A chord stays in effect until the next chord symbol, across bar lines. Before the first chord
 * symbol of the piece no chord is in effect yet, so the first symbol fills that gap.
 * `barLengths` gives each bar's length in beats, where its last segment ends.
 *
 * @param {Array<Array<[number, string]>>} changesPerBar for each bar, the `[onset, symbol]` of
 *   every chord symbol written in it.
 * @param {(symbol: string) => [number, number[]]} chordTones gives `[root, tones]` of a symbol
 *   (core/chords.js `chordTones`; tests pass a stub).
 * @param {readonly number[]} [barLengths] each bar's length in beats (`meter.barBeats`); every
 *   bar lasts 4 beats (4/4) when it is omitted.
 * @returns {ChordSegment[][]} the segments of each bar.
 * @throws {Error} when no bar has a chord symbol.
 * @example
 * const segments = chordSegments([[[2.0, "C"]], [], [[0.0, "F"], [3.0, "G"]]], chordTones);
 * segments.map((bar) => bar.map((s) => [s.symbol, s.onset, s.duration]));
 * // [[["C", 0, 2], ["C", 2, 2]], [["C", 0, 4]], [["F", 0, 3], ["G", 3, 1]]]
 * chordSegments([[[0.0, "C"]], [[1.0, "G"]]], chordTones, [3, 2]) // a 3/4 bar, then a 2/4 bar
 *   .map((bar) => bar.map((s) => [s.symbol, s.onset, s.duration]));
 * // [[["C", 0, 3]], [["C", 0, 1], ["G", 1, 1]]]
 */
export function chordSegments(changesPerBar, chordTones, barLengths = changesPerBar.map(() => BEATS_PER_BAR)) {
  const written = changesPerBar.flatMap((changes) => changes.map(([, symbol]) => symbol));
  if (written.length === 0) {
    throw new Error("the tune has no chord symbol; a lead sheet needs at least one");
  }

  let inEffect = written[0];
  /** @type {ChordSegment[][]} */
  const segmentsPerBar = [];
  changesPerBar.forEach((changes, barIndex) => {
    // The bar starts with the chord carried over; a symbol on beat 0 replaces it.
    const starts = new Map([[0, inEffect], ...changes]);
    const onsets = [...starts.keys()].sort((a, b) => a - b);
    const ends = [...onsets.slice(1), barLengths[barIndex]];
    segmentsPerBar.push(
      onsets.map((onset, index) => {
        const symbol = /** @type {string} */ (starts.get(onset));
        const [root, tones] = chordTones(symbol);
        return { symbol, root, tones, onset, duration: ends[index] - onset };
      }),
    );
    inEffect = /** @type {string} */ (starts.get(onsets[onsets.length - 1]));
  });
  return segmentsPerBar;
}

/**
 * A melody note in a fixture: an object, or an array in field order.
 * @typedef {{pitch: number, onset: number, duration: number} | [number, number, number]} MelodyNoteJson
 */

/**
 * A chord segment in a fixture: an object, or an array in field order.
 * @typedef {{symbol: string, root: number, tones: number[], onset: number, duration: number}
 *   | [string, number, number[], number, number]} ChordSegmentJson
 */

/**
 * A bar as the Python code writes it to JSON.
 * @typedef {object} BarJson
 * @property {number} index
 * @property {string} label
 * @property {Role} role
 * @property {number} phrase
 * @property {boolean} phrase_end
 * @property {string} [meter] the bar's meter as written, for example "3/4"; 4/4 when absent.
 * @property {MelodyNoteJson[]} melody
 * @property {ChordSegmentJson[]} chords
 */

/**
 * A lead sheet as the Python code writes it to JSON (the test fixtures).
 * @typedef {object} LeadSheetJson
 * @property {string} title
 * @property {string} key
 * @property {number} tempo_bpm
 * @property {[number, number] | null} [source_grid] null when absent.
 * @property {BarJson[]} bars
 */

/**
 * Convert a lead sheet with Python field names (a JSON fixture) into a `LeadSheet`.
 *
 * Fields are renamed to camelCase (`tempo_bpm` → `tempoBpm`, `phrase_end` → `phraseEnd`), each
 * bar's meter text becomes its meter object (4/4 when a bar has none), and every array is copied,
 * so changing the result leaves the fixture intact.
 *
 * @param {LeadSheetJson} leadSheetJson the parsed fixture: `{title, key, tempo_bpm,
 *   source_grid, bars: [{index, label, role, phrase, phrase_end, meter,
 *   melody: [{pitch, onset, duration}], chords: [{symbol, root, tones, onset, duration}]}]}`.
 * @returns {LeadSheet}
 * @throws {Error} when a bar's meter is not supported (core/meter.js `parseMeter`).
 * @example
 * const sheet = leadSheetFromJson({ title: "One bar", key: "C major", tempo_bpm: 120, bars: [
 *   { index: 0, label: "A", role: "verse", phrase: 0, phrase_end: true,
 *     melody: [{ pitch: 60, onset: 0, duration: 4 }],
 *     chords: [{ symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 }] }] });
 * [sheet.tempoBpm, sheet.sourceGrid, String(sheet.bars[0].meter), sheet.bars[0].phraseEnd];
 * // [120, null, "4/4", true]
 */
export function leadSheetFromJson(leadSheetJson) {
  const sourceGrid = leadSheetJson.source_grid;
  return {
    title: leadSheetJson.title,
    key: leadSheetJson.key,
    tempoBpm: leadSheetJson.tempo_bpm,
    bars: leadSheetJson.bars.map(barFromJson),
    sourceGrid: sourceGrid == null ? null : [sourceGrid[0], sourceGrid[1]],
  };
}

/**
 * @param {BarJson} barJson
 * @returns {Bar}
 */
function barFromJson(barJson) {
  return {
    index: barJson.index,
    melody: barJson.melody.map((note) =>
      Array.isArray(note)
        ? { pitch: note[0], onset: note[1], duration: note[2] }
        : { pitch: note.pitch, onset: note.onset, duration: note.duration },
    ),
    chords: barJson.chords.map((segment) =>
      Array.isArray(segment)
        ? {
            symbol: segment[0],
            root: segment[1],
            tones: [...segment[2]],
            onset: segment[3],
            duration: segment[4],
          }
        : {
            symbol: segment.symbol,
            root: segment.root,
            tones: [...segment.tones],
            onset: segment.onset,
            duration: segment.duration,
          },
    ),
    label: barJson.label,
    role: barJson.role,
    phrase: barJson.phrase,
    phraseEnd: barJson.phrase_end,
    meter: barJson.meter === undefined ? FOUR_FOUR : parseMeter(barJson.meter, barJson.index + 1),
  };
}
