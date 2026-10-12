// @ts-check
// Score tables: every musical fact the fitness function needs, computed once per lead sheet
// (port of src/ga/tables.py).
//
// The genes of one bar take few values (5 P2 textures, 4 TR textures, 5 drum patterns, 3 melody
// octaves), so every (bar, gene value) choice can be realized into notes and measured once,
// before the GA starts. The fitness of a plan then only looks values up in these tables, which
// keeps the thousands of fitness evaluations of a run fast and keeps the notes out of the GA loop.
//
// Activity measures how busy a channel is in a bar: min(1, onsets / 16), so one onset on every
// sixteenth note (or more) counts as fully active, and silence as 0.
//
// The bass is measured as a *line*: the notes a listener follows as the bass melody. For most TR
// textures that is every note. For the octave pump it is only the roots on the beats: the upper
// octave between them colors the line, it is not a step of it. Every leap of the line is scored,
// inside a bar (bassInner) and across a bar line (bassAcross), with the leap score
// clip((12 − leap) / 7, 0, 1): 1 up to a fourth (5 semitones), 0 from an octave (12).
//
// Layout. Python keeps numpy arrays; here every table is a flat typed array in row-major order
// (the last index varies fastest), and `tables.shape[field]` holds its Python shape. With
// n = number of bars:
//
// | field          | typed array  | shape      | entry                                         |
// |----------------|--------------|------------|-----------------------------------------------|
// | actP1          | Float64Array | (n, 3)     | [3b + octave]                                 |
// | actP2          | Float64Array | (n, 5)     | [5b + p2]                                     |
// | actTr          | Float64Array | (n, 4)     | [4b + tr]                                     |
// | actNo          | Float64Array | (5)        | [no] (the same in every bar)                  |
// | regBoth        | Int32Array   | (n, 3, 5)  | [15b + 5·octave + p2]                         |
// | regOk          | Int32Array   | (n, 3, 5)  | [15b + 5·octave + p2]                         |
// | bassInner      | Float64Array | (n, 4)     | [4b + tr]; NaN when the line has one note     |
// | bassInnerLeaps | Int32Array   | (n, 4)     | [4b + tr]                                     |
// | bassAcross     | Float64Array | (n − 1, 4, 4) | [16b + 4·tr(b) + tr(b + 1)]                |
// | singleChord    | Uint8Array   | (n)        | 1 when one chord lasts the whole bar          |
// | phraseEnd      | Uint8Array   | (n)        | 1 when the bar ends its phrase                |
// | phrase         | Int32Array   | (n)        | phrase id of the bar                          |
// | isChorus       | Uint8Array   | (n)        | 1 for chorus bars, 0 for verse bars           |

import { NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES } from "./genome.js";
import { realizeNo, realizeP1, realizeP2, realizeTr } from "./textures.js";

/**
 * Precomputed per-bar measurements, indexed by bar and by gene value (layout in the module
 * header).
 * @typedef {object} ScoreTables
 * @property {number} nBars number of bars n.
 * @property {Float64Array} actP1 (n, 3) melody activity for each octave gene.
 * @property {Float64Array} actP2 (n, 5) P2 activity for each P2 texture.
 * @property {Float64Array} actTr (n, 4) TR activity for each TR texture.
 * @property {Float64Array} actNo (5) NO activity for each drum pattern.
 * @property {Int32Array} regBoth (n, 3, 5) sixteenth steps where P1 (octave gene) and P2
 *   (texture) both sound.
 * @property {Int32Array} regOk (n, 3, 5) sixteenth steps where both sound and P2 is lower.
 * @property {Float64Array} bassInner (n, 4) mean leap score over consecutive notes of the bass
 *   line inside the bar for each TR texture; NaN when the line has a single note in the bar.
 * @property {Int32Array} bassInnerLeaps (n, 4) number of those leaps.
 * @property {Float64Array} bassAcross (n − 1, 4, 4) leap score from the last note of the line of
 *   TR texture i in bar b to the first note of TR texture j in bar b + 1.
 * @property {Uint8Array} singleChord (n) 1 when one chord lasts the whole bar.
 * @property {Uint8Array} phraseEnd (n) 1 when the bar ends its phrase.
 * @property {Int32Array} phrase (n) phrase id of each bar.
 * @property {Uint8Array} isChorus (n) 1 for chorus bars, 0 for verse bars.
 * @property {Record<TableField, number[]>} shape the Python shape of each table.
 */

/**
 * @typedef {"actP1" | "actP2" | "actTr" | "actNo" | "regBoth" | "regOk" | "bassInner"
 *   | "bassInnerLeaps" | "bassAcross" | "singleChord" | "phraseEnd" | "phrase" | "isChorus"} TableField
 */

/**
 * The tables, in the field order of the Python `ScoreTables`.
 * @type {readonly TableField[]}
 */
export const TABLE_FIELDS = Object.freeze(
  /** @type {TableField[]} */ ([
    "actP1",
    "actP2",
    "actTr",
    "actNo",
    "regBoth",
    "regOk",
    "bassInner",
    "bassInnerLeaps",
    "bassAcross",
    "singleChord",
    "phraseEnd",
    "phrase",
    "isChorus",
  ]),
);

// Sixteenth-note steps of a 4/4 bar: the grid on which register overlaps are counted.
const STEPS_PER_BAR = 16;
const STEP = 0.25;

const OCTAVE_PUMP = TR_TEXTURES.indexOf("octave_pump");

/**
 * Realize every (bar, channel, gene value) choice once and measure it.
 *
 * @param {import("./leadsheet.js").LeadSheet} leadSheet the lead sheet to arrange (≥ 1 bar).
 * @returns {ScoreTables} flat typed arrays with their shapes (module header).
 * @example
 * const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 };
 * const bar = { index: 0, melody: [{ pitch: 72, onset: 0, duration: 4 }], chords: [c],
 *   label: "A", role: "verse", phrase: 0, phraseEnd: true };
 * const tables = buildTables({ title: "one bar", key: "c major", tempoBpm: 120, bars: [bar],
 *   beatsPerBar: 4, sourceGrid: null });
 * [tables.actP2[1], tables.shape.bassAcross]; // [1, [0, 4, 4]]
 * [...tables.bassInnerLeaps]; // [0, 3, 3, 3]: root, octave_pump, root_fifth, walking
 */
export function buildTables(leadSheet) {
  const bars = leadSheet.bars;
  const n = bars.length;
  const nOctaves = P1_OCTAVES.length;
  const nP2 = P2_TEXTURES.length;
  const nTr = TR_TEXTURES.length;
  const nNo = NO_PATTERNS.length;
  const nAcross = Math.max(n - 1, 0);

  const actP1 = new Float64Array(n * nOctaves);
  const actP2 = new Float64Array(n * nP2);
  const actTr = new Float64Array(n * nTr);
  const regBoth = new Int32Array(n * nOctaves * nP2);
  const regOk = new Int32Array(n * nOctaves * nP2);
  const bassInner = new Float64Array(n * nTr).fill(Number.NaN);
  const bassInnerLeaps = new Int32Array(n * nTr);
  const bassFirst = new Float64Array(n * nTr);
  const bassLast = new Float64Array(n * nTr);

  for (let b = 0; b < n; b++) {
    const bar = bars[b];
    const nextBar = b + 1 < n ? bars[b + 1] : null;
    const melodyGrids = [];
    for (let octave = 0; octave < nOctaves; octave++) {
      const notes = realizeP1(bar, octave);
      actP1[b * nOctaves + octave] = activity(notes);
      melodyGrids.push(soundingGrid(notes));
    }
    for (let texture = 0; texture < nP2; texture++) {
      const notes = realizeP2(bar, texture);
      actP2[b * nP2 + texture] = activity(notes);
      const harmony = soundingGrid(notes);
      melodyGrids.forEach((melody, octave) => {
        let both = 0;
        let p2Below = 0;
        for (let step = 0; step < STEPS_PER_BAR; step++) {
          if (melody[step] >= 0 && harmony[step] >= 0) {
            both++;
            if (harmony[step] < melody[step]) p2Below++;
          }
        }
        regBoth[(b * nOctaves + octave) * nP2 + texture] = both;
        regOk[(b * nOctaves + octave) * nP2 + texture] = p2Below;
      });
    }
    for (let texture = 0; texture < nTr; texture++) {
      const notes = realizeTr(bar, texture, nextBar);
      const cell = b * nTr + texture;
      actTr[cell] = activity(notes);
      const line = bassLine(
        texture,
        notes.map((note) => note.pitch),
      );
      bassFirst[cell] = line[0];
      bassLast[cell] = line[line.length - 1];
      bassInnerLeaps[cell] = line.length - 1;
      if (line.length > 1) {
        let scoreSum = 0;
        for (let k = 1; k < line.length; k++) scoreSum += leapScore(Math.abs(line[k] - line[k - 1]));
        bassInner[cell] = scoreSum / (line.length - 1);
      }
    }
  }

  const actNo = new Float64Array(nNo);
  for (let pattern = 0; pattern < nNo; pattern++) actNo[pattern] = activity(realizeNo(pattern));

  // Leap from the line's last note in bar b (texture i) to its first in bar b + 1 (texture j).
  const bassAcross = new Float64Array(nAcross * nTr * nTr);
  for (let b = 0; b < nAcross; b++) {
    for (let i = 0; i < nTr; i++) {
      for (let j = 0; j < nTr; j++) {
        const leap = Math.abs(bassLast[b * nTr + i] - bassFirst[(b + 1) * nTr + j]);
        bassAcross[(b * nTr + i) * nTr + j] = leapScore(leap);
      }
    }
  }

  return {
    nBars: n,
    actP1,
    actP2,
    actTr,
    actNo,
    regBoth,
    regOk,
    bassInner,
    bassInnerLeaps,
    bassAcross,
    singleChord: Uint8Array.from(bars, (bar) => (bar.chords.length === 1 ? 1 : 0)),
    phraseEnd: Uint8Array.from(bars, (bar) => (bar.phraseEnd ? 1 : 0)),
    phrase: Int32Array.from(bars, (bar) => bar.phrase),
    isChorus: Uint8Array.from(bars, (bar) => (bar.role === "chorus" ? 1 : 0)),
    shape: {
      actP1: [n, nOctaves],
      actP2: [n, nP2],
      actTr: [n, nTr],
      actNo: [nNo],
      regBoth: [n, nOctaves, nP2],
      regOk: [n, nOctaves, nP2],
      bassInner: [n, nTr],
      bassInnerLeaps: [n, nTr],
      bassAcross: [nAcross, nTr, nTr],
      singleChord: [n],
      phraseEnd: [n],
      phrase: [n],
      isChorus: [n],
    },
  };
}

/**
 * The pitches of a TR bar that form the bass line: all of them, except in the octave pump.
 *
 * The pump alternates root and upper octave on the eighths; its line is the roots alone.
 *
 * @param {number} trTexture index into `TR_TEXTURES`.
 * @param {number[]} pitches the pitches of the bar's TR notes, in time order.
 * @returns {number[]} the pitches of the bass line (a new array).
 * @example
 * bassLine(TR_TEXTURES.indexOf("octave_pump"), [36, 48, 36, 48, 43, 55, 43, 55]); // [36, 36, 43, 43]
 * bassLine(TR_TEXTURES.indexOf("walking"), [36, 40, 43, 42]); // [36, 40, 43, 42]
 */
export function bassLine(trTexture, pitches) {
  return trTexture === OCTAVE_PUMP ? pitches.filter((_, index) => index % 2 === 0) : [...pitches];
}

/**
 * How busy a channel is in a bar: one onset per sixteenth note or more is fully active.
 * @param {readonly unknown[]} notes
 */
function activity(notes) {
  return Math.min(1, notes.length / STEPS_PER_BAR);
}

/**
 * Pitch sounding at the start of each sixteenth step, or −1 when the channel rests.
 * @param {import("./textures.js").ChannelNote[]} notes
 */
function soundingGrid(notes) {
  const grid = new Int32Array(STEPS_PER_BAR).fill(-1);
  for (const note of notes) {
    for (let step = 0; step < STEPS_PER_BAR; step++) {
      const time = step * STEP + 1e-9;
      if (note.onset <= time && time < note.onset + note.duration) grid[step] = note.pitch;
    }
  }
  return grid;
}

/**
 * 1 for a leap up to a fourth (5 semitones), 0 from an octave (12), linear in between.
 * @param {number} leap
 */
function leapScore(leap) {
  return Math.min(1, Math.max(0, (12 - leap) / 7));
}
