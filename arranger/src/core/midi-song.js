// @ts-check
// Read a lead sheet from a full multi-track MIDI song (melody track + accompaniment).
//
// Many songs exist only as MIDI files made by fans: a whole band, with no chord symbols and no part
// labels. To arrange such a song for the NES, this module reduces it to a lead sheet:
//
// - Melody: the notes of one chosen track. A *skyline* keeps only the highest note at each moment,
//   so the melody is monophonic like a sung line, and onsets snap to a sixteenth-note grid
//   (hand-played files are a few milliseconds early or late).
// - Chords: every half bar (2 beats), the other pitched tracks vote for the 12 pitch classes in
//   proportion to how long each class sounds; bass tracks vote twice. The chord whose tones
//   collect the most votes (major, minor, dominant seventh or minor seventh, on any of the 12
//   roots) wins, with a bonus when its root is the bass note.
// - Form: the visitor marks where each section starts (for example bar 0 is "A" and bar 8 is
//   "B"); sections, roles and phrases then follow the same rules as the ABC reader.
//
// Time is measured in beats on a *beat grid*. A MIDI file made in a sequencer already has one: its
// ticks. A file recorded live may not: "Voa Voa" says 120 BPM but was played at about 110 BPM, so
// its notes drift across the file's bar lines. When the drum onsets do not fit the file's own grid,
// the grid is estimated from the recording: the tempo whose sixteenth-note grid best explains the
// drum onsets, the sixteenth with the most onsets as the beat, and the beat where the bass plays
// its longest notes as the downbeat. The beat grid is in quarter notes, so 4/4 and 2/4 files read
// the same way (research R11); other meters are refused.
//
// This is a port of src/leadsheet/midi_reader.py. It must give the same lead sheet from the same
// song and settings (SC-006), so it copies numpy's and Python's arithmetic where a result depends
// on it: the tempo grid of `np.arange`, `round` with ties to even, `%` with the divisor's sign,
// and `sum` with Neumaier compensation (Python 3.12). It also adds the excerpt and section checks
// of data-model.md "Settings". The track list and suggestion feed the page (research R11).

import { BEATS_PER_BAR, phraseMarks, sectionRole } from "./leadsheet.js";

/** @typedef {import("./leadsheet.js").LeadSheet} LeadSheet */
/** @typedef {import("./leadsheet.js").Bar} Bar */
/** @typedef {import("./leadsheet.js").ChordSegment} ChordSegment */
/** @typedef {import("./leadsheet.js").MelodyNote} MelodyNote */
/** @typedef {import("./leadsheet.js").Role} Role */
/** @typedef {import("./midi-file.js").MidiSong} MidiSong */

/** Sixteenth note, in beats: the melody snaps to this grid. */
export const GRID = 0.25;
/** One chord decision per half bar (beats). */
export const CHORD_SPAN = 2;
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
export const MAX_BARS = 128;
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
 * @property {[number, number] | null} [bars] excerpt [first bar, end bar), 0-based; default the
 *   whole song, which must then have at most 128 bars.
 * @property {Array<[number, string]> | null} [sections] [bar inside the excerpt, label] where each
 *   section starts, strictly increasing; default one section "A".
 * @property {number | null} [tempoOverride] tempo in BPM; by default the beat grid's.
 * @property {"auto" | "file" | [number, number]} [grid] "file" uses the file's ticks; [bpm,
 *   downbeat seconds] gives the grid; "auto" keeps the ticks when the drums fit them.
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
 * with the most onsets, and the downbeat the beat (of 4) on which the bass plays its longest notes.
 *
 * @param {MidiSong} midi
 * @returns {[number, number, number]}
 * @throws {Error} when the song has no notes.
 * @example
 * // Drums on every eighth at 100 BPM from 0.3 s and a bass note on each downbeat, in a file
 * // that says 120 BPM (see midi-song.test.js):
 * const [bpm, downbeat] = estimateBeatGrid(midi);
 * [bpm.toFixed(2), downbeat.toFixed(3)]; // ["100.00", "0.300"]
 */
export function estimateBeatGrid(midi) {
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

  // The downbeat is the beat (of 4) on which the bass plays the longest notes.
  const beat = 4 * step;
  const beatWeights = [0, 0, 0, 0];
  for (const instrument of midi.instruments) {
    if (instrument.isDrum || instrument.notes.length === 0) continue;
    if (meanOf(instrument.notes.map((note) => note.pitch)) >= BASS_TRACK_MAX_MEAN_PITCH) continue;
    for (const note of instrument.notes) {
      beatWeights[floorModulo(roundHalfEven((note.start - firstBeat) / beat), 4)] += note.end - note.start;
    }
  }
  const downbeat = pythonModulo(firstBeat + argmax(beatWeights) * beat, 4 * beat);
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
 * The number of bars that hold pitched notes on the song's beat grid (the excerpt's upper bound).
 *
 * @param {MidiSong} midi
 * @param {"auto" | "file" | [number, number]} [grid] as in `readLeadSheetMidi`.
 * @returns {number} 0 when the song has no pitched note.
 * @example
 * countBars(midi); // 4 for a song whose last pitched note ends on beat 16
 */
export function countBars(midi, grid = "auto") {
  const tracks = pitchedTracks(midi, beatGrid(midi, grid).toBeats);
  return tracks.length === 0 ? 0 : barsHoldingNotes(tracks);
}

/**
 * Reduce a multi-track MIDI song to a lead sheet (port of `read_lead_sheet_midi`).
 *
 * @param {MidiSong} midi the song, from `readMidiFile`.
 * @param {MidiReadOptions} options
 * @returns {LeadSheet} with `key` "" and `sourceGrid` [bpm, downbeat seconds].
 * @throws {Error} for a missing or drum melody track, a meter other than 4/4 or 2/4 (the message
 *   names it), an excerpt outside `0 ≤ first < end ≤ barCount` or longer than 128 bars, or
 *   section starts outside the excerpt or not strictly increasing.
 * @example
 * // A voice note C5 over [0, 1 s] and a bass C2 over [0, 2 s], at 120 BPM:
 * const sheet = readLeadSheetMidi(midi, { melodyTrack: 0, title: "demo" });
 * [sheet.bars.length, sheet.bars[0].melody[0], sheet.bars[0].chords[0].symbol, sheet.tempoBpm];
 * // [1, { pitch: 72, onset: 0, duration: 2 }, "C", 120]
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
  for (const { numerator, denominator } of midi.timeSignatures) {
    const meter = `${numerator}/${denominator}`;
    if (meter !== "4/4" && meter !== "2/4") {
      throw new Error(`only 4/4 and 2/4 MIDI files are supported; this file is in ${meter}`);
    }
  }

  const { sourceGrid, toBeats } = beatGrid(midi, grid);
  const tracks = pitchedTracks(midi, toBeats);
  const [firstBar, endBar] = checkedExcerpt(bars, barsHoldingNotes(tracks));
  const offset = firstBar * BEATS_PER_BAR;
  const barTotal = endBar - firstBar;

  const melodyNotes = tracks.filter((track) => melodyTracks.includes(track.index)).flatMap((track) => track.notes);
  const melody = quantizedMelody(melodyNotes, offset, barTotal);
  const harmony = tracks.filter((track) => !melodyTracks.includes(track.index));
  const chords = chordsPerBar(harmony, offset, barTotal);

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
  }));
  return {
    title,
    key: "",
    tempoBpm: tempoOverride || sourceGrid[0],
    bars: leadBars,
    beatsPerBar: BEATS_PER_BAR,
    sourceGrid,
  };
}

/**
 * The beat grid in use: the file's ticks, the given [bpm, downbeat], or for "auto" the ticks when
 * the drums fit them, else the estimate.
 *
 * @param {MidiSong} midi
 * @param {"auto" | "file" | [number, number]} grid
 * @returns {{sourceGrid: [number, number], toBeats: (seconds: number) => number}}
 */
function beatGrid(midi, grid) {
  let chosen = grid;
  if (grid === "auto") {
    // Measure the fit on the file's own beats (ticks), so tempo changes do not count as misfit.
    const drumBeats = midi.instruments
      .filter((instrument) => instrument.isDrum)
      .flatMap((instrument) => instrument.notes.map((note) => midi.timeToTick(note.start) / midi.resolution));
    const fitsFile = drumBeats.length === 0 || gridStrength(drumBeats, 60.0) >= FILE_GRID_MIN_STRENGTH;
    chosen = fitsFile ? "file" : /** @type {[number, number]} */ (estimateBeatGrid(midi).slice(0, 2));
  }
  if (chosen === "file") {
    return {
      sourceGrid: [midi.tempoChanges[0].bpm, 0.0],
      toBeats: (seconds) => midi.timeToTick(seconds) / midi.resolution,
    };
  }
  if (!Array.isArray(chosen) || chosen.length !== 2 || !chosen.every(Number.isFinite) || !(chosen[0] > 0)) {
    throw new Error(`grid must be "auto", "file" or [bpm, downbeat seconds]; got ${JSON.stringify(grid)}`);
  }
  const [gridBpm, downbeat] = chosen;
  return { sourceGrid: [gridBpm, downbeat], toBeats: (seconds) => ((seconds - downbeat) * gridBpm) / 60.0 };
}

/**
 * The non-drum instruments with notes, on the beat grid.
 *
 * @param {MidiSong} midi
 * @param {(seconds: number) => number} toBeats
 * @returns {Array<{index: number, notes: BeatNote[], isBass: boolean}>}
 */
function pitchedTracks(midi, toBeats) {
  /** @type {Array<{index: number, notes: BeatNote[], isBass: boolean}>} */
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
 * Bars up to the end of the last pitched note; a note that ends a hair after a bar line does not
 * open a new bar.
 *
 * @param {Array<{notes: BeatNote[]}>} tracks
 * @returns {number}
 */
function barsHoldingNotes(tracks) {
  let lastBeat = -Infinity;
  for (const track of tracks) for (const [, end] of track.notes) lastBeat = Math.max(lastBeat, end);
  return Math.ceil(lastBeat / BEATS_PER_BAR - 1e-3);
}

/**
 * The excerpt [first, end) after the checks of data-model.md "Settings".
 *
 * @param {[number, number] | null} bars
 * @param {number} barCount
 * @returns {[number, number]}
 */
function checkedExcerpt(bars, barCount) {
  if (bars == null) {
    if (barCount > MAX_BARS) {
      throw new Error(`the song has ${barCount} bars; choose an excerpt (bars) of at most ${MAX_BARS}`);
    }
    if (barCount < 1) throw new Error("no bar holds a note on this beat grid");
    return [0, barCount];
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
 * Skyline, snap to the grid, keep the excerpt and split notes at the bar lines.
 *
 * @param {BeatNote[]} notes
 * @param {number} offset first beat of the excerpt.
 * @param {number} barTotal
 * @returns {MelodyNote[][]}
 */
function quantizedMelody(notes, offset, barTotal) {
  /** @type {BeatNote[]} */
  const snapped = notes.map(([start, end, pitch]) => [snap(start) - offset, snap(end) - offset, pitch]);
  const endOfPiece = barTotal * BEATS_PER_BAR;
  /** @type {MelodyNote[][]} */
  const perBar = Array.from({ length: barTotal }, () => []);
  for (const [noteStart, noteEnd, pitch] of skyline(snapped.filter(([start, end]) => end > start))) {
    let start = Math.max(noteStart, 0.0);
    const end = Math.min(noteEnd, endOfPiece);
    while (end > start) {
      const bar = Math.floor(start / BEATS_PER_BAR);
      const piece = Math.min(end, (bar + 1) * BEATS_PER_BAR);
      perBar[bar].push({ pitch, onset: start - bar * BEATS_PER_BAR, duration: piece - start });
      start = piece;
    }
  }
  return perBar;
}

/**
 * One chord decision per half bar, merged within each bar; silence keeps the last chord.
 *
 * @param {Array<{notes: BeatNote[], isBass: boolean}>} tracks the accompaniment.
 * @param {number} offset first beat of the excerpt.
 * @param {number} barTotal
 * @returns {ChordSegment[][]}
 */
function chordsPerBar(tracks, offset, barTotal) {
  const spansPerBar = Math.trunc(BEATS_PER_BAR / CHORD_SPAN);
  /** @type {Array<Chord | null>} */
  const decisions = [];
  for (let span = 0; span < barTotal * spansPerBar; span += 1) {
    const low = offset + span * CHORD_SPAN;
    const high = offset + (span + 1) * CHORD_SPAN;
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
    decisions.push(detectChord(weights, bass === null ? null : bass[1]));
  }
  // Silent spans keep the chord before them; leading silence takes the first chord found.
  /** @type {Chord} */
  let previous = decisions.find((decision) => decision !== null) ?? ["C", 0, [0, 4, 7]];
  const filled = decisions.map((decision) => (previous = decision ?? previous));

  return Array.from({ length: barTotal }, (_, bar) => {
    /** @type {ChordSegment[]} */
    const segments = [];
    for (let position = 0; position < spansPerBar; position += 1) {
      const [symbol, root, tones] = filled[bar * spansPerBar + position];
      const last = segments[segments.length - 1];
      if (last !== undefined && last.symbol === symbol) {
        last.duration += CHORD_SPAN;
      } else {
        segments.push({ symbol, root, tones: [...tones], onset: position * CHORD_SPAN, duration: CHORD_SPAN });
      }
    }
    return segments;
  });
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
