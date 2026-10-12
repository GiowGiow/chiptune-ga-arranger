// @ts-check
// Read a lead sheet from a full multi-track MIDI song (melody track + accompaniment).
//
// Many songs exist only as MIDI files made by fans: a whole band, with no chord symbols and no part
// labels. To arrange such a song for the NES, this module reduces it to a lead sheet:
//
// - Melody: the notes of one chosen track. A *skyline* keeps only the highest note at each moment,
//   so the melody is monophonic like a sung line, and onsets and ends snap to a sixteenth-note grid
//   (hand-played files are a few milliseconds early or late). A very short note, whose end snaps
//   onto its start (a staccato sixteenth, half a sixteenth long or less), keeps one sixteenth: a
//   staccato note is still a note of the tune. The skyline then cuts it at the next onset.
// - Chords: over each group of the bar's meter (from one strong beat to the next: half bars in
//   4/4 and 12/8, 3 + 2 beats in 5/4, the whole bar in 3/4 or 6/8), the other pitched tracks vote
//   for the 12 pitch classes in proportion to how long each class sounds; bass tracks vote twice.
//   The chord whose tones collect the most votes (major, minor, dominant seventh or minor
//   seventh, on any of the 12 roots) wins, with a bonus when its root is the bass note.
// - Form: the visitor marks where each section starts (for example bar 0 is "A" and bar 8 is
//   "B"); sections, roles and phrases then follow the same rules as the ABC reader.
//
// Time is measured in beats on a *beat grid*. A MIDI file made in a sequencer already has one: its
// ticks. A file recorded live may not: "Voa Voa" says 120 BPM but was played at about 110 BPM, so
// its notes drift across the file's bar lines. When the drum onsets do not fit the file's own grid,
// the grid is estimated from the recording: the tempo whose sixteenth-note grid best explains the
// drum onsets, the sixteenth with the most onsets as the beat, and the beat where the bass plays
// its longest notes as the downbeat.
//
// Bar lines come from the file's *time-signature map* (spec 003, research R8): bar 0 starts on the
// file's first beat, in 4/4 until the first time signature, as the MIDI standard says, and each
// time signature starts a new bar in its meter (`barMap`). A count-in in another meter is part of
// the map; by default the excerpt runs from the first bar that holds a pitched note to the bar
// where the last one ends, so a drum-only count-in is left out. On an estimated grid the song is
// read in one meter, the one that lasts longest in the map; a meter whose bar is not a whole
// number of quarter notes (7/8) cannot have its downbeat estimated, so it needs the file's grid.
//
// This is a port of src/leadsheet/midi_reader.py. It must give the same lead sheet from the same
// song and settings (SC-006), so it copies numpy's and Python's arithmetic where a result depends
// on it: the tempo grid of `np.arange`, `round` with ties to even, `%` with the divisor's sign,
// and `sum` with Neumaier compensation (Python 3.12). It also adds the excerpt and section checks
// of data-model.md "Settings". The track list and suggestion feed the page (research R11).

import { phraseMarks, sectionRole } from "./leadsheet.js";
import { FOUR_FOUR, groups, parseMeter } from "./meter.js";

/** @typedef {import("./leadsheet.js").LeadSheet} LeadSheet */
/** @typedef {import("./leadsheet.js").Bar} Bar */
/** @typedef {import("./leadsheet.js").ChordSegment} ChordSegment */
/** @typedef {import("./leadsheet.js").MelodyNote} MelodyNote */
/** @typedef {import("./leadsheet.js").Role} Role */
/** @typedef {import("./midi-file.js").MidiSong} MidiSong */
/** @typedef {import("./meter.js").Meter} Meter */
/** @typedef {"auto" | "file" | [number, number]} GridChoice */

/** Sixteenth note, in beats: the melody snaps to this grid. */
export const GRID = 0.25;
/** Pitch-class names, flats except F#, as midi_reader.py writes chord symbols. */
export const PITCH_CLASS_NAMES = Object.freeze(["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]);
/**
 * Chord qualities as intervals from the root (root, third, fifth, seventh), in the order the
 * Python dict lists them; ties keep the first. A list of pairs keeps that order ("7" would come
 * first among an object's keys).
 * @type {ReadonlyArray<readonly [string, readonly number[]]>}
 */
export const QUALITIES = Object.freeze([
  Object.freeze(/** @type {const} */ (["", Object.freeze([0, 4, 7])])),
  Object.freeze(/** @type {const} */ (["m", Object.freeze([0, 3, 7])])),
  Object.freeze(/** @type {const} */ (["7", Object.freeze([0, 4, 7, 10])])),
  Object.freeze(/** @type {const} */ (["m7", Object.freeze([0, 3, 7, 10])])),
]);
/** Tracks lower than this mean pitch are treated as bass (their chord votes count twice). */
export const BASS_TRACK_MAX_MEAN_PITCH = 50;
/** A file whose drum onsets fit its own sixteenth grid this well keeps its ticks as the grid. */
export const FILE_GRID_MIN_STRENGTH = 0.8;
/** The longest lead sheet the arranger takes (data-model.md). */
export const MAX_BARS = 256;
/**
 * Candidate tempos for the beat-grid estimate: numpy's `np.arange(60.0, 200.0, 0.05)`. numpy
 * steps by `(60 + 0.05) - 60` = 0.04999999999999716, so the values carry the same float noise.
 * @type {ReadonlyArray<number>}
 */
export const TEMPO_SEARCH = Object.freeze(
  Array.from({ length: Math.ceil((200.0 - 60.0) / 0.05) }, (_, index) => 60.0 + index * (60.0 + 0.05 - 60.0)),
);

/** Track names that suggest the sung line (research R11). */
const MELODY_NAME = /voc|voz|melod|lead|canto|vocal|melody/i;

/**
 * A note on the beat grid: [start beat, end beat, MIDI pitch].
 * @typedef {[number, number, number]} BeatNote
 */

/**
 * A chord decision: [symbol, root pitch class, tones].
 * @typedef {[string, number, number[]]} Chord
 */

/**
 * One bar of a MIDI file's time-signature map (port of `MapBar`).
 * @typedef {object} MapBar
 * @property {number} start the beat (quarter notes on the beat grid) where the bar starts.
 * @property {number} length the bar's length in beats; shorter than its meter when a time
 *   signature that does not fall on a bar line cuts it.
 * @property {[number, number]} signature [numerator, denominator] of the time signature in
 *   effect, as the file writes it, supported or not.
 */

/**
 * A non-drum instrument with notes, on the beat grid.
 * @typedef {{index: number, notes: BeatNote[], isBass: boolean}} PitchedTrack
 */

/**
 * One instrument of the song, summarized for choosing the melody (data-model.md "Track").
 * @typedef {object} TrackSummary
 * @property {number} index pretty_midi instrument index (the CLI's `melody_track`).
 * @property {string} name track name.
 * @property {number} program General MIDI program.
 * @property {boolean} isDrum
 * @property {number} noteCount
 * @property {number} lowest lowest MIDI pitch.
 * @property {number} highest highest MIDI pitch.
 * @property {number} meanPitch mean MIDI pitch.
 * @property {number} polyphony share of notes that overlap another note of the track (0–1).
 */

/**
 * Settings of the reduction (the CLI config key `midi`, plus the lead sheet's phrase length).
 * @typedef {object} MidiReadOptions
 * @property {number | number[]} melodyTrack index of the melody instrument, or several indices
 *   when the melody moves between instruments (the skyline merges them).
 * @property {number} [phraseLength] bars per phrase (default 4).
 * @property {Record<string, Role> | null} [roleMap] part label to "verse"/"chorus".
 * @property {[number, number] | null} [bars] excerpt [first bar, end bar), 0-based on the bars of
 *   the grid (the file's time-signature map, count-in included); default the bars from the first
 *   to the last that hold a pitched note (`defaultExcerpt`), at most 256 of them.
 * @property {Array<[number, string]> | null} [sections] [bar inside the excerpt, label] where each
 *   section starts, strictly increasing; default one section "A".
 * @property {number | null} [tempoOverride] tempo in BPM; by default the beat grid's.
 * @property {GridChoice} [grid] "file" uses the file's ticks; [bpm, downbeat seconds] gives the
 *   grid; "auto" keeps the ticks when the drums fit them, else estimates the grid.
 * @property {string} [title] the lead sheet title, usually the file name without extension.
 */

/**
 * How well onset times (s) fit a sixteenth-note grid: 1 = perfectly, near 0 = not at all.
 *
 * Each onset becomes a unit vector at its phase on the grid; the result is the length of their
 * mean. The arithmetic follows numpy's complex `exp(2j·π·onset/step)`, which multiplies by
 * 1/step.
 *
 * @param {ArrayLike<number>} onsets onset times, in seconds (or in beats with `bpm` 60).
 * @param {number} bpm tempo of the grid; a sixteenth lasts 60 / bpm / 4 seconds.
 * @returns {number} the fit, from 0 to 1 (NaN without onsets).
 * @example
 * const onsets = Array.from({ length: 16 }, (_, i) => i * 0.125); // sixteenths at 120 BPM
 * Math.round(gridStrength(onsets, 120) * 1000) / 1000; // 1
 * gridStrength(onsets, 97) < 0.5; // true
 */
export function gridStrength(onsets, bpm) {
  const perStep = 1 / (60.0 / bpm / 4);
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < onsets.length; index += 1) {
    const angle = 2 * Math.PI * onsets[index] * perStep;
    real += Math.cos(angle);
    imaginary += Math.sin(angle);
  }
  const perOnset = 1 / onsets.length;
  return Math.hypot(real * perOnset, imaginary * perOnset);
}

/**
 * Estimate the beat grid of a song played off its file's grid: [tempo BPM, first downbeat in
 * seconds, grid strength].
 *
 * The tempo is the slowest one (of `TEMPO_SEARCH`) whose sixteenth grid fits the drum onsets
 * (or, without drums, the note onsets) about as well as the best tempo, refined to the best fit
 * within 1 BPM, since a grid twice as fast fits the same onsets. The beat is the sixteenth (of 4)
 * with the most onsets, and the downbeat the beat (of the bar's `beatsPerBar` quarter beats) on
 * which the bass plays its longest notes.
 *
 * @param {MidiSong} midi
 * @param {number} [beatsPerBar] the bar length in quarter notes, among which the downbeat is
 *   chosen: 4 in 4/4, 3 in 3/4 and 6/8.
 * @returns {[number, number, number]}
 * @throws {Error} when the song has no notes.
 * @example
 * // Drums on every eighth at 100 BPM from 0.3 s and a bass note on each downbeat, in a file
 * // that says 120 BPM (see midi-song.test.js):
 * const [bpm, downbeat] = estimateBeatGrid(midi);
 * [bpm.toFixed(2), downbeat.toFixed(3)]; // ["100.00", "0.300"]
 * // The same drums from 0.3 s and a bass on every 3/4 downbeat from 0.9 s:
 * estimateBeatGrid(waltz, 3)[1].toFixed(3); // "0.900"
 */
export function estimateBeatGrid(midi, beatsPerBar = 4) {
  /** @type {number[]} */
  const drums = [];
  /** @type {number[]} */
  const pitched = [];
  for (const instrument of midi.instruments) {
    for (const note of instrument.notes) (instrument.isDrum ? drums : pitched).push(note.start);
  }
  if (drums.length + pitched.length === 0) throw new Error("the MIDI file has no notes");
  const onsets = uniqueSorted((drums.length > 0 ? drums : pitched).map((time) => roundHalfEven(time * 1000) / 1000));

  const strengths = TEMPO_SEARCH.map((bpm) => gridStrength(onsets, bpm));
  const threshold = 0.9 * Math.max(...strengths);
  const slowestGood = TEMPO_SEARCH[strengths.findIndex((strength) => strength >= threshold)];
  let best = -1;
  TEMPO_SEARCH.forEach((bpm, index) => {
    if (Math.abs(bpm - slowestGood) <= 1.0 && (best < 0 || strengths[index] > strengths[best])) best = index;
  });
  const bpm = TEMPO_SEARCH[best];
  const strength = gridStrength(onsets, bpm);

  const step = 60.0 / bpm / 4;
  const perStep = 1 / step;
  let real = 0;
  let imaginary = 0;
  for (const onset of onsets) {
    const angle = 2 * Math.PI * onset * perStep;
    real += Math.cos(angle);
    imaginary += Math.sin(angle);
  }
  const firstStep = pythonModulo((Math.atan2(imaginary / onsets.length, real / onsets.length) / (2 * Math.PI)) * step, step);

  // The beat is the sixteenth position (of 4) with the most onsets, drums and notes together.
  const positionCounts = [0, 0, 0, 0];
  for (const onset of [...drums, ...pitched]) {
    positionCounts[floorModulo(roundHalfEven((onset - firstStep) / step), 4)] += 1;
  }
  const firstBeat = firstStep + argmax(positionCounts) * step;

  // The downbeat is the beat (of the bar's beats) on which the bass plays the longest notes.
  const beat = 4 * step;
  const beatWeights = new Array(beatsPerBar).fill(0);
  for (const instrument of midi.instruments) {
    if (instrument.isDrum || instrument.notes.length === 0) continue;
    if (meanOf(instrument.notes.map((note) => note.pitch)) >= BASS_TRACK_MAX_MEAN_PITCH) continue;
    for (const note of instrument.notes) {
      beatWeights[floorModulo(roundHalfEven((note.start - firstBeat) / beat), beatsPerBar)] += note.end - note.start;
    }
  }
  const downbeat = pythonModulo(firstBeat + argmax(beatWeights) * beat, beatsPerBar * beat);
  return [bpm, downbeat, strength];
}

/**
 * Keep the highest note at each onset and cut every note at the next onset.
 *
 * @param {BeatNote[]} notes [start, end, pitch] in any order.
 * @returns {BeatNote[]} a monophonic line, sorted by onset.
 * @example
 * skyline([[0.0, 2.0, 60], [0.0, 1.0, 64], [1.0, 2.0, 62]]);
 * // [[0, 1, 64], [1, 2, 62]]
 */
export function skyline(notes) {
  /** @type {Map<number, BeatNote>} */
  const byOnset = new Map();
  for (const [start, end, pitch] of notes) {
    const kept = byOnset.get(start);
    if (kept === undefined || pitch > kept[2]) byOnset.set(start, [start, end, pitch]);
  }
  const ordered = [...byOnset.keys()].sort((a, b) => a - b).map((onset) => /** @type {BeatNote} */ (byOnset.get(onset)));
  /** @type {BeatNote[]} */
  const line = [];
  ordered.forEach(([start, end, pitch], index) => {
    const cut = index + 1 < ordered.length ? Math.min(end, ordered[index + 1][0]) : end;
    if (cut > start) line.push([start, cut, pitch]);
  });
  return line;
}

/**
 * Return [symbol, root, tones] of the chord that best explains 12 pitch-class weights.
 *
 * A chord scores the weight of its tones minus half the weight of the other classes, plus a
 * quarter of the total when its root is the bass note. A seventh chord is considered only when
 * its seventh weighs at least a quarter of the heaviest class.
 *
 * @param {ArrayLike<number>} weights how long each pitch class (0 = C … 11 = B) sounds.
 * @param {number | null} bassPc pitch class of the lowest note, or null.
 * @returns {Chord | null} null when every weight is 0.
 * @example
 * detectChord([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], 0); // ["C", 0, [0, 4, 7]]
 */
export function detectChord(weights, bassPc) {
  const values = Array.from(weights);
  const total = pythonSum(values);
  if (total <= 0) return null;
  const heaviest = Math.max(...values);
  /** @type {Chord | null} */
  let best = null;
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root += 1) {
    for (const [quality, intervals] of QUALITIES) {
      const tones = intervals.map((interval) => (root + interval) % 12);
      if (tones.length === 4 && values[tones[3]] < 0.25 * heaviest) continue;
      const inside = pythonSum(tones.map((pc) => values[pc]));
      let score = inside - 0.5 * (total - inside);
      if (root === bassPc) score += 0.25 * total;
      if (score > bestScore + 1e-9) {
        best = [PITCH_CLASS_NAMES[root] + quality, root, tones];
        bestScore = score;
      }
    }
  }
  return best;
}

/**
 * Summarize each instrument of the song, in pretty_midi order, for choosing the melody.
 *
 * @param {MidiSong} midi
 * @returns {TrackSummary[]}
 * @example
 * // One piano track: C4 [0, 1 s], E4 [0.5, 1 s], G4 [1, 2 s], A4 [2, 3 s].
 * describeTracks(midi);
 * // [{ index: 0, name: "Piano", program: 0, isDrum: false, noteCount: 4, lowest: 60,
 * //    highest: 69, meanPitch: 65, polyphony: 0.5 }]
 */
export function describeTracks(midi) {
  return midi.instruments.map((instrument, index) => {
    const pitches = instrument.notes.map((note) => note.pitch);
    return {
      index,
      name: instrument.name,
      program: instrument.program,
      isDrum: instrument.isDrum,
      noteCount: pitches.length,
      lowest: pitches.reduce((low, pitch) => Math.min(low, pitch), Infinity),
      highest: pitches.reduce((high, pitch) => Math.max(high, pitch), -Infinity),
      meanPitch: meanOf(pitches),
      polyphony: overlapShare(instrument.notes),
    };
  });
}

/**
 * Share of notes that overlap another note of the same list.
 *
 * @param {ReadonlyArray<{start: number, end: number}>} notes
 * @returns {number}
 */
function overlapShare(notes) {
  if (notes.length === 0) return 0;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const overlapping = new Uint8Array(sorted.length);
  for (let index = 0; index < sorted.length; index += 1) {
    for (let next = index + 1; next < sorted.length && sorted[next].start < sorted[index].end; next += 1) {
      if (sorted[next].end > sorted[index].start) {
        overlapping[index] = 1;
        overlapping[next] = 1;
      }
    }
  }
  return overlapping.reduce((count, flag) => count + flag, 0) / sorted.length;
}

/**
 * Melody-likeness of a track (research R11): its single notes, ×1.5 for a vocal name and ×0.2
 * outside the singing range (mean pitch below 55 or above 84).
 *
 * @param {TrackSummary} track
 * @returns {number}
 */
function melodyScore(track) {
  let score = track.noteCount * (1 - track.polyphony);
  if (MELODY_NAME.test(track.name)) score *= 1.5;
  if (track.meanPitch < 55 || track.meanPitch > 84) score *= 0.2;
  return score;
}

/**
 * Non-drum tracks from the most to the least melody-like (research R11); ties keep track order.
 *
 * @param {TrackSummary[]} tracks from `describeTracks`.
 * @returns {number[]} track indices.
 * @example
 * rankMelodyTracks([
 *   { index: 0, name: "Strings", noteCount: 400, meanPitch: 60, polyphony: 0.9, isDrum: false, ... },
 *   { index: 1, name: "Voz", noteCount: 200, meanPitch: 67, polyphony: 0.05, isDrum: false, ... },
 *   { index: 2, name: "Bass", noteCount: 300, meanPitch: 40, polyphony: 0, isDrum: false, ... },
 *   { index: 3, name: "Drums", noteCount: 900, meanPitch: 40, polyphony: 0, isDrum: true, ... }]);
 * // [1, 2, 0]: scores 285, 60 and 40; drums never carry the melody
 */
export function rankMelodyTracks(tracks) {
  return tracks
    .filter((track) => !track.isDrum)
    .map((track) => ({ index: track.index, score: melodyScore(track) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.index);
}

/**
 * The track most likely to carry the melody (research R11); the visitor confirms it.
 *
 * @param {TrackSummary[]} tracks from `describeTracks`.
 * @returns {number | null} its index, or null when every track is a drum track.
 * @example
 * suggestMelodyTrack(tracks); // 1 for the tracks of the rankMelodyTracks example
 */
export function suggestMelodyTrack(tracks) {
  return rankMelodyTracks(tracks)[0] ?? null;
}

/**
 * List every bar of the file on its own tick grid (beats = ticks / resolution); port of `bar_map`.
 *
 * Bar 0 starts on beat 0, in 4/4 until the first time signature, as the MIDI standard says. Each
 * time signature starts a new bar at its tick, and bars follow each other until the end of the
 * last note. A time signature that falls inside a bar cuts that bar short; the map keeps it, and
 * unsupported meters too, because only the bars of the excerpt are read (`readLeadSheetMidi`
 * refuses a short or unsupported bar there, naming it).
 *
 * @param {MidiSong} midi
 * @returns {MapBar[]} at least one bar.
 * @example
 * // At 120 BPM: one 3/4 bar of count-in, 4/4 from 1.5 s (beat 3) on, a note from 1.5 s to 5.5 s.
 * barMap(midi).map((bar) => [bar.start, bar.signature.join("/")]);
 * // [[0, "3/4"], [3, "4/4"], [7, "4/4"]]
 */
export function barMap(midi) {
  /** @type {Map<number, [number, number]>} */
  const changes = new Map();
  for (const change of midi.timeSignatures) {
    // Of two time signatures at one tick, the last one wins.
    changes.set(midi.timeToTick(change.time) / midi.resolution, [change.numerator, change.denominator]);
  }
  let lastEnd = -Infinity;
  for (const instrument of midi.instruments) {
    for (const note of instrument.notes) lastEnd = Math.max(lastEnd, note.end);
  }
  const lastBeat = lastEnd === -Infinity ? 0.0 : midi.timeToTick(lastEnd) / midi.resolution;
  const changeBeats = [...changes.keys()].sort((a, b) => a - b);
  /** @type {[number, number]} */
  let signature = [4, 4];
  let position = 0.0;
  let nextChange = 0;
  /** @type {MapBar[]} */
  const bars = [];
  for (;;) {
    while (nextChange < changeBeats.length && changeBeats[nextChange] <= position + 1e-9) {
      signature = /** @type {[number, number]} */ (changes.get(changeBeats[nextChange]));
      nextChange += 1;
    }
    if (position >= lastBeat - 1e-3 && bars.length > 0) return bars;
    let length = (signature[0] * 4) / signature[1];
    // A damaged file can declare 0 beats per bar; without this the map would never end.
    if (!(length > 0)) throw new Error(`the MIDI file declares the time signature ${signature.join("/")}, which has no beats`);
    if (nextChange < changeBeats.length) length = Math.min(length, changeBeats[nextChange] - position);
    bars.push({ start: position, length, signature: [signature[0], signature[1]] });
    position += length;
  }
}

/**
 * The meter that lasts longest in the file's time-signature map (4/4 without a time signature);
 * port of `main_meter`. An estimated or explicit beat grid reads the whole song in this meter.
 *
 * @param {MidiSong} midi
 * @returns {Meter}
 * @throws {Error} when that meter is not supported (the message names it).
 * @example
 * // Two 3/4 bars of count-in (6 beats), then four 4/4 bars (16 beats):
 * String(mainMeter(countInSong)); // "4/4"
 */
export function mainMeter(midi) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  for (const bar of barMap(midi)) {
    const text = bar.signature.join("/");
    totals.set(text, (totals.get(text) ?? 0.0) + bar.length);
  }
  if (midi.timeSignatures.length === 0 || totals.size === 0) return FOUR_FOUR;
  // Of two meters that last as long, the first one in the file wins, as Python's max.
  let longest = "";
  let longestBeats = -Infinity;
  for (const [text, beats] of totals) {
    if (beats > longestBeats) [longest, longestBeats] = [text, beats];
  }
  return parseMeter(longest);
}

/**
 * The default excerpt [first bar, end bar) on the song's beat grid: from the first bar that holds
 * a pitched (non-drum) note to the bar where the last pitched note ends, so a drum-only count-in
 * and silence before the music are left out.
 *
 * Bars are counted on the map of the grid in use: the file's time-signature map (`barMap`) on the
 * file's grid, bars of the main meter from the downbeat on an estimated or explicit grid.
 *
 * @param {MidiSong} midi
 * @param {GridChoice} [grid] as in `readLeadSheetMidi`.
 * @returns {[number, number]} [0, 0] when the song has no pitched note.
 * @throws {Error} as `readLeadSheetMidi` for an estimated grid it cannot use.
 * @example
 * // Two 3/4 bars of count-in, a pickup on the last count-in beat, then four 4/4 bars:
 * defaultExcerpt(countInSong); // [1, 6]: bar 0 is drums only, bar 1 holds the pickup
 */
export function defaultExcerpt(midi, grid = "auto") {
  const { map, tracks } = songGrid(midi, grid);
  return barsWithNotes(map, tracks) ?? [0, 0];
}

/**
 * The number of bars of the song's map up to the bar where the last pitched note ends: the
 * largest end bar an excerpt may have (the end of `defaultExcerpt`).
 *
 * @param {MidiSong} midi
 * @param {GridChoice} [grid] as in `readLeadSheetMidi`.
 * @returns {number} 0 when the song has no pitched note.
 * @throws {Error} as `readLeadSheetMidi` for an estimated grid it cannot use.
 * @example
 * countBars(midi); // 4 for a 4/4 song whose last pitched note ends on beat 16
 * countBars(countInSong); // 6: two 3/4 count-in bars, then four 4/4 bars
 */
export function countBars(midi, grid = "auto") {
  return defaultExcerpt(midi, grid)[1];
}

/**
 * The bars of a song on the beat grid in use, and the excerpt to read in them (port of
 * `excerpt_bars` and `_grid_excerpt`), after the checks of data-model.md "Settings".
 *
 * This turns bar numbers into beats: the excerpt starts on `map[first].start` and ends on
 * `map[end - 1].start + map[end - 1].length`, in beats of the grid (ticks / resolution on the
 * file's grid; (seconds − downbeat) × bpm / 60 on another).
 *
 * @param {MidiSong} midi
 * @param {[number, number] | null} [bars] the excerpt [first, end), 0-based on the map; null for
 *   the default excerpt (`defaultExcerpt`).
 * @param {GridChoice} [grid] as in `readLeadSheetMidi`; a lead sheet whose `sourceGrid` is
 *   [the file's first tempo, 0] was read on the file's grid, "file".
 * @returns {{map: MapBar[], first: number, end: number}}
 * @throws {Error} as `readLeadSheetMidi` for a bad excerpt or a grid it cannot use.
 * @example
 * const { map, first, end } = excerptBars(countInSong, [3, 6], "file");
 * [map[first].start, map[end - 1].start + map[end - 1].length]; // [10, 22]
 */
export function excerptBars(midi, bars = null, grid = "auto") {
  const { map, tracks } = songGrid(midi, grid);
  const [first, end] = checkedExcerpt(bars, barsWithNotes(map, tracks));
  return { map, first, end };
}

/**
 * Reduce a multi-track MIDI song to a lead sheet (port of `read_lead_sheet_midi`).
 *
 * Bars follow the file's time-signature map on its own grid, so each bar has the meter the file
 * gives it; an estimated or explicit grid has its own downbeat and reads every bar in the song's
 * main meter (`mainMeter`).
 *
 * @param {MidiSong} midi the song, from `readMidiFile`.
 * @param {MidiReadOptions} options
 * @returns {LeadSheet} with `key` "" and `sourceGrid` [bpm, downbeat seconds].
 * @throws {Error} for a missing or drum melody track; for a bar of the excerpt in an unsupported
 *   meter or cut short by a time-signature change (the message names the bar); for an estimated
 *   grid in a meter whose bar is not a whole number of quarters (7/8); for an excerpt outside
 *   `0 ≤ first < end ≤ countBars` or longer than 256 bars; or for section starts outside the
 *   excerpt or not strictly increasing.
 * @example
 * // A voice note C5 over [0, 1 s] and a bass C2 over [0, 2 s], at 120 BPM:
 * const sheet = readLeadSheetMidi(midi, { melodyTrack: 0, title: "demo" });
 * [sheet.bars.length, sheet.bars[0].melody[0], sheet.bars[0].chords[0].symbol, sheet.tempoBpm];
 * // [1, { pitch: 72, onset: 0, duration: 2 }, "C", 120]
 * String(sheet.bars[0].meter); // "4/4"
 */
export function readLeadSheetMidi(midi, options) {
  const {
    melodyTrack,
    phraseLength = 4,
    roleMap = null,
    bars = null,
    sections = null,
    tempoOverride = null,
    grid = "auto",
    title = "",
  } = options;
  const melodyTracks = Array.isArray(melodyTrack) ? [...melodyTrack] : [melodyTrack];
  for (const track of melodyTracks) {
    if (!Number.isInteger(track) || track < 0 || track >= midi.instruments.length) {
      throw new Error(`melody track ${track} does not exist`);
    }
    if (midi.instruments[track].isDrum) {
      throw new Error(`track ${track} is a drum track and cannot be the melody`);
    }
  }

  const { sourceGrid, fileGrid, map, tracks } = songGrid(midi, grid);
  const [firstBar, endBar] = checkedExcerpt(bars, barsWithNotes(map, tracks));
  const excerpt = map.slice(firstBar, endBar);
  const meters = excerpt.map((bar, index) => checkedMeter(bar, firstBar + index, midi));
  const offset = excerpt[0].start;
  const barStarts = excerpt.map((bar) => bar.start - offset);
  const barTotal = excerpt.length;

  const melodyNotes = tracks.filter((track) => melodyTracks.includes(track.index)).flatMap((track) => track.notes);
  const melody = quantizedMelody(melodyNotes, offset, barStarts, meters);
  const harmony = tracks.filter((track) => !melodyTracks.includes(track.index));
  const chords = chordsPerBar(harmony, offset, barStarts, meters);

  const starts = new Map(checkedSections(sections, barTotal));
  const labels = [];
  const sectionIds = [];
  let current = starts.get(0) ?? "A";
  let section = 0;
  for (let bar = 0; bar < barTotal; bar += 1) {
    if (bar > 0 && starts.has(bar)) {
      current = /** @type {string} */ (starts.get(bar));
      section += 1;
    }
    labels.push(current);
    sectionIds.push(section);
  }
  const marks = phraseMarks(sectionIds, phraseLength);

  /** @type {Bar[]} */
  const leadBars = labels.map((label, bar) => ({
    index: bar,
    melody: melody[bar],
    chords: chords[bar],
    label,
    role: sectionRole(label, roleMap),
    phrase: marks[bar][0],
    phraseEnd: marks[bar][1],
    meter: meters[bar],
  }));
  return {
    title,
    key: "",
    // The excerpt plays at the tempo where it starts, not at a count-in's tempo.
    tempoBpm: tempoOverride || (fileGrid ? tempoAtBeat(midi, offset) : sourceGrid[0]),
    bars: leadBars,
    sourceGrid,
  };
}

/**
 * The beat grid in use, its bars and the pitched tracks on it.
 *
 * The grid is the file's ticks, the given [bpm, downbeat], or for "auto" the ticks when the drums
 * fit them, else the estimate (searched over the main meter's quarter beats). On the file's grid
 * the bars are the time-signature map; on another grid, bars of the main meter from the
 * downbeat, up to the end of the last note.
 *
 * @param {MidiSong} midi
 * @param {GridChoice} grid
 * @returns {{sourceGrid: [number, number], toBeats: (seconds: number) => number, fileGrid: boolean,
 *   map: MapBar[], tracks: PitchedTrack[]}}
 */
function songGrid(midi, grid) {
  let chosen = grid;
  if (grid === "auto") {
    // Measure the fit on the file's own beats (ticks), so tempo changes do not count as misfit.
    const drumBeats = midi.instruments
      .filter((instrument) => instrument.isDrum)
      .flatMap((instrument) => instrument.notes.map((note) => midi.timeToTick(note.start) / midi.resolution));
    const fitsFile = drumBeats.length === 0 || gridStrength(drumBeats, 60.0) >= FILE_GRID_MIN_STRENGTH;
    chosen = fitsFile
      ? "file"
      : /** @type {[number, number]} */ (estimateBeatGrid(midi, wholeBeats(mainMeter(midi))).slice(0, 2));
  }
  if (chosen === "file") {
    /** @param {number} seconds */
    const toBeats = (seconds) => midi.timeToTick(seconds) / midi.resolution;
    const sourceGrid = /** @type {[number, number]} */ ([midi.tempoChanges[0].bpm, 0.0]);
    return { sourceGrid, toBeats, fileGrid: true, map: barMap(midi), tracks: pitchedTracks(midi, toBeats) };
  }
  if (!Array.isArray(chosen) || chosen.length !== 2 || !chosen.every(Number.isFinite) || !(chosen[0] > 0)) {
    throw new Error(`grid must be "auto", "file" or [bpm, downbeat seconds]; got ${JSON.stringify(grid)}`);
  }
  const [gridBpm, downbeat] = chosen;
  /** @param {number} seconds */
  const toBeats = (seconds) => ((seconds - downbeat) * gridBpm) / 60.0;
  const meter = mainMeter(midi);
  let lastEnd = -Infinity;
  for (const instrument of midi.instruments) {
    for (const note of instrument.notes) lastEnd = Math.max(lastEnd, toBeats(note.end));
  }
  const count = Math.max(1, Math.ceil(lastEnd / meter.barBeats - 1e-3));
  /** @type {MapBar[]} */
  const map = Array.from({ length: count }, (_, bar) => ({
    start: bar * meter.barBeats,
    length: meter.barBeats,
    signature: [meter.numerator, meter.denominator],
  }));
  return { sourceGrid: [gridBpm, downbeat], toBeats, fileGrid: false, map, tracks: pitchedTracks(midi, toBeats) };
}

/**
 * The bar length of a meter in whole quarter notes, for the downbeat search.
 *
 * @param {Meter} meter
 * @returns {number}
 * @throws {Error} for a meter whose bar is not a whole number of quarter notes (7/8).
 */
function wholeBeats(meter) {
  if (!Number.isInteger(meter.barBeats)) {
    throw new Error(
      `a ${meter} song needs the file's own beat grid (midi.grid = "file"): its bar is not a whole ` +
        "number of quarter notes, so its downbeat cannot be estimated",
    );
  }
  return meter.barBeats;
}

/**
 * The meter of a bar inside the excerpt (port of `_checked_meter`).
 *
 * @param {MapBar} bar
 * @param {number} index the bar's number on the map, for the message.
 * @param {MidiSong} midi
 * @returns {Meter}
 * @throws {Error} naming the bar, for an unsupported meter or a bar cut short.
 */
function checkedMeter(bar, index, midi) {
  let meter;
  try {
    meter = parseMeter(bar.signature.join("/"));
  } catch (error) {
    throw new Error(`bar ${index}: ${/** @type {Error} */ (error).message}`);
  }
  if (Math.abs(bar.length - meter.barBeats) > 1e-6) {
    const seconds = midi.tickToTime(roundHalfEven(bar.start * midi.resolution));
    throw new Error(
      `bar ${index} (${pythonFixed1(seconds)} s) lasts ${pythonG(bar.length)} beats instead of ` +
        `${pythonG(meter.barBeats)}: a time signature cuts it short; leave it out of midi.bars`,
    );
  }
  return meter;
}

/**
 * The tempo (BPM) in effect at a beat of the file's own grid (port of `_tempo_at_beat`).
 *
 * @param {MidiSong} midi
 * @param {number} beat
 * @returns {number}
 */
function tempoAtBeat(midi, beat) {
  const tick = Math.round(beat * midi.resolution);
  let bpm = midi.tempoChanges[0].bpm;
  for (const change of midi.tempoChanges) {
    if (change.tick <= tick) bpm = change.bpm;
  }
  return bpm;
}

/**
 * The non-drum instruments with notes, on the beat grid.
 *
 * @param {MidiSong} midi
 * @param {(seconds: number) => number} toBeats
 * @returns {PitchedTrack[]}
 */
function pitchedTracks(midi, toBeats) {
  /** @type {PitchedTrack[]} */
  const tracks = [];
  midi.instruments.forEach((instrument, index) => {
    if (instrument.isDrum || instrument.notes.length === 0) return;
    /** @type {BeatNote[]} */
    const notes = instrument.notes.map((note) => [toBeats(note.start), toBeats(note.end), note.pitch]);
    const meanPitch = meanOf(notes.map(([, , pitch]) => pitch));
    tracks.push({ index, notes, isBass: meanPitch < BASS_TRACK_MAX_MEAN_PITCH });
  });
  return tracks;
}

/**
 * The default excerpt (port of `_bars_with_notes`): from the bar of the first pitched onset to the
 * bar where the last pitched note ends; a note that ends a hair after a bar line does not reach
 * the next bar.
 *
 * @param {MapBar[]} map
 * @param {PitchedTrack[]} tracks
 * @returns {[number, number] | null} null when no pitched note sounds.
 */
function barsWithNotes(map, tracks) {
  let firstOnset = Infinity;
  let lastEnd = -Infinity;
  for (const track of tracks) {
    for (const [start, end] of track.notes) {
      firstOnset = Math.min(firstOnset, start);
      lastEnd = Math.max(lastEnd, end);
    }
  }
  if (firstOnset === Infinity) return null;
  const starts = map.map((bar) => bar.start);
  const first = Math.max(0, searchSortedRight(starts, firstOnset + 1e-9) - 1);
  const last = Math.max(0, searchSortedRight(starts, lastEnd - 1e-3) - 1);
  return [first, last + 1];
}

/**
 * The excerpt [first, end) after the checks of data-model.md "Settings".
 *
 * @param {[number, number] | null} bars the excerpt asked for; null for the default one.
 * @param {[number, number] | null} noted the default excerpt (`barsWithNotes`); its end bounds
 *   any excerpt.
 * @returns {[number, number]}
 */
function checkedExcerpt(bars, noted) {
  if (noted === null) throw new Error("no bar holds a note on this beat grid");
  const barCount = noted[1];
  if (bars == null) {
    const length = noted[1] - noted[0];
    if (length > MAX_BARS) {
      throw new Error(`the song has ${length} bars; choose an excerpt (bars) of at most ${MAX_BARS}`);
    }
    return noted;
  }
  const [first, end] = bars;
  const valid =
    Number.isInteger(first) && Number.isInteger(end) && first >= 0 && first < end && end <= barCount && end - first <= MAX_BARS;
  if (!valid) {
    throw new Error(`bars [${first}, ${end}] must satisfy 0 ≤ first < end ≤ ${barCount} and end − first ≤ ${MAX_BARS}`);
  }
  return [first, end];
}

/**
 * The section starts as [bar, label] pairs, after the checks of data-model.md "Settings".
 *
 * @param {Array<[number, string]> | null} sections
 * @param {number} barTotal bars in the excerpt.
 * @returns {Array<[number, string]>} one section "A" when none is given.
 */
function checkedSections(sections, barTotal) {
  if (sections == null || sections.length === 0) return [[0, "A"]];
  let previous = -1;
  for (const [bar] of sections) {
    if (!Number.isInteger(bar) || bar <= previous || bar >= barTotal) {
      throw new Error(
        `section starts must be bars inside the excerpt; strictly increasing, from 0 to ${barTotal - 1}; ` +
          `got ${JSON.stringify(sections)}`,
      );
    }
    previous = bar;
  }
  return sections.map(([bar, label]) => [bar, String(label)]);
}

/**
 * Snap to the grid, skyline, keep the excerpt and split notes at the bar lines (port of
 * `_quantized_melody`).
 *
 * A note whose end snaps onto its start (half a sixteenth long or shorter) lasts one sixteenth.
 *
 * @param {BeatNote[]} notes
 * @param {number} offset first beat of the excerpt.
 * @param {number[]} barStarts each bar's start, in beats from `offset`.
 * @param {Meter[]} meters each bar's meter, which gives its length.
 * @returns {MelodyNote[][]}
 * @example
 * // Four staccato sixteenths of 0.1 beat, then 0.3 beats from beat 2 (midi-song.test.js,
 * // "staccato sixteenths"):
 * const staccato = [[0, 0.1, 72], [0.25, 0.35, 74], [0.5, 0.6, 72], [0.75, 0.85, 74], [2, 2.3, 76]];
 * quantizedMelody(staccato, 0, [0], [FOUR_FOUR])[0].map((n) => [n.pitch, n.onset, n.duration]);
 * // [[72, 0, 0.25], [74, 0.25, 0.25], [72, 0.5, 0.25], [74, 0.75, 0.25], [76, 2, 0.25]]
 */
function quantizedMelody(notes, offset, barStarts, meters) {
  /** @type {BeatNote[]} */
  const snapped = notes.map(([noteStart, noteEnd, pitch]) => {
    const start = snap(noteStart) - offset;
    const end = snap(noteEnd) - offset;
    // A staccato note is still a note of the tune: keep one sixteenth rather than drop it.
    return [start, end > start ? end : start + GRID, pitch];
  });
  const lastBar = barStarts.length - 1;
  const endOfPiece = barStarts[lastBar] + meters[lastBar].barBeats;
  /** @type {MelodyNote[][]} */
  const perBar = barStarts.map(() => []);
  for (const [noteStart, noteEnd, pitch] of skyline(snapped)) {
    let start = Math.max(noteStart, 0.0);
    const end = Math.min(noteEnd, endOfPiece);
    while (end > start) {
      const bar = searchSortedRight(barStarts, start) - 1;
      const piece = Math.min(end, barStarts[bar] + meters[bar].barBeats);
      perBar[bar].push({ pitch, onset: start - barStarts[bar], duration: piece - start });
      start = piece;
    }
  }
  return perBar;
}

/**
 * One chord decision per group of each bar's meter (from one strong beat to the next: half bars
 * in 4/4, the whole bar in 3/4), merged within each bar; silence keeps the last chord (port of
 * `_chords`).
 *
 * @param {Array<{notes: BeatNote[], isBass: boolean}>} tracks the accompaniment.
 * @param {number} offset first beat of the excerpt.
 * @param {number[]} barStarts each bar's start, in beats from `offset`.
 * @param {Meter[]} meters each bar's meter.
 * @returns {ChordSegment[][]}
 */
function chordsPerBar(tracks, offset, barStarts, meters) {
  /** @type {Array<[number, number, number]>} [bar, first beat, length] of each group */
  const spans = [];
  barStarts.forEach((start, bar) => {
    for (const [onset, length] of groups(meters[bar])) spans.push([bar, offset + start + onset, length]);
  });
  /** @type {Array<Chord | null>} */
  const decisions = spans.map(([, low, length]) => {
    const high = low + length;
    const weights = new Array(12).fill(0.0);
    /** @type {[number, number] | null} lowest [pitch, pitch class] sounding in the span */
    let bass = null;
    for (const { notes, isBass } of tracks) {
      for (const [start, end, pitch] of notes) {
        const overlap = Math.min(end, high) - Math.max(start, low);
        if (overlap > 0) {
          weights[pitch % 12] += overlap * (isBass ? 2.0 : 1.0);
          if (bass === null || pitch < bass[0]) bass = [pitch, pitch % 12];
        }
      }
    }
    return detectChord(weights, bass === null ? null : bass[1]);
  });
  // Silent spans keep the chord before them; leading silence takes the first chord found.
  /** @type {Chord} */
  let previous = decisions.find((decision) => decision !== null) ?? ["C", 0, [0, 4, 7]];
  const filled = decisions.map((decision) => (previous = decision ?? previous));

  /** @type {ChordSegment[][]} */
  const perBar = barStarts.map(() => []);
  spans.forEach(([bar, low, length], index) => {
    const [symbol, root, tones] = filled[index];
    const segments = perBar[bar];
    const last = segments[segments.length - 1];
    if (last !== undefined && last.symbol === symbol) {
      last.duration = last.duration + length;
    } else {
      segments.push({ symbol, root, tones: [...tones], onset: low - offset - barStarts[bar], duration: length });
    }
  });
  return perBar;
}

/**
 * Snap a beat to the sixteenth grid, rounding ties to even as Python's `round`.
 * @param {number} beat
 * @returns {number}
 */
function snap(beat) {
  return roundHalfEven(beat / GRID) * GRID;
}

/**
 * Python's `round(x)` and numpy's `rint`: nearest integer, ties to the even one; never -0.
 * @param {number} value
 * @returns {number}
 */
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor + 0;
  return floor % 2 === 0 ? floor + 0 : floor + 1;
}

/**
 * Python's float `%`: the remainder takes the sign of the divisor.
 * @param {number} value
 * @param {number} divisor
 * @returns {number}
 */
function pythonModulo(value, divisor) {
  const remainder = value % divisor;
  if (remainder === 0) return divisor < 0 ? -0 : 0;
  return remainder < 0 !== divisor < 0 ? remainder + divisor : remainder;
}

/**
 * Integer `%` as in Python and numpy: the result is in [0, divisor) for a positive divisor.
 * @param {number} value
 * @param {number} divisor
 * @returns {number}
 */
function floorModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Python 3.12's built-in `sum` of floats: Neumaier's compensated summation.
 * @param {number[]} values
 * @returns {number}
 */
function pythonSum(values) {
  if (values.length === 0) return 0;
  let total = 0 + values[0];
  let compensation = 0;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    const sum = total + value;
    compensation += Math.abs(total) >= Math.abs(value) ? total - sum + value : value - sum + total;
    total = sum;
  }
  return compensation !== 0 && Number.isFinite(compensation) ? total + compensation : total;
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function meanOf(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Index of the first largest value, as `numpy.argmax`.
 * @param {number[]} values
 * @returns {number}
 */
function argmax(values) {
  let best = 0;
  values.forEach((value, index) => {
    if (value > values[best]) best = index;
  });
  return best;
}

/**
 * Sorted distinct values, as `numpy.unique`.
 * @param {number[]} values
 * @returns {number[]}
 */
function uniqueSorted(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.filter((value, index) => index === 0 || value !== sorted[index - 1]);
}

/**
 * How many values of an ascending list are at most `value`: numpy's `searchsorted(side="right")`.
 * @param {number[]} sorted ascending.
 * @param {number} value
 * @returns {number}
 */
function searchSortedRight(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Python's `f"{value:.1f}"`: one decimal, a tie (a value ending in .x5 exactly, which in binary is
 * only .25 or .75) rounded to the even digit, where `toFixed` rounds it up.
 * @param {number} value
 * @returns {string}
 */
function pythonFixed1(value) {
  if (Number.isInteger(value * 4) && !Number.isInteger(value * 2)) {
    const tenths = Math.floor(value * 10);
    return ((tenths % 2 === 0 ? tenths : tenths + 1) / 10).toFixed(1);
  }
  return value.toFixed(1);
}

/**
 * Python's `f"{value:g}"` for the bar lengths of a message: 6 significant digits, no trailing
 * zeros ("2", "2.5", "3.33333").
 * @param {number} value
 * @returns {string}
 */
function pythonG(value) {
  return String(Number(value.toPrecision(6)));
}
