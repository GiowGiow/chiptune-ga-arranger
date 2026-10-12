// @ts-check
// From an arrangement plan (genotype) to the notes of the four NES channels (phenotype), and the
// NES rules every arrangement must pass before export (port of src/arrangement/assemble.py and
// src/arrangement/validation.py).
//
// Assembling: for every bar, the plan names one texture per channel. The realizers in
// textures.js write the notes of that bar, with onsets relative to the bar; `assemble` shifts
// them to onsets measured from the start of the piece and collects them per channel.
//
// Validating: the realizers are built to respect the chip, but the exporter does not take that on
// trust. `findViolations` checks the finished arrangement against four rules:
// 1. One note at a time: every NES channel is monophonic, so two notes of the same channel must
//    not overlap.
// 2. Pitch range: the pulse channels (P1, P2) play MIDI 33–108 and the triangle (TR) 21–108. The
//    noise channel (NO) plays drum sounds, which have no pitch range.
// 3. Chord tones on strong beats: a harmony (P2) or bass (TR) note that starts on beat 1 or 3 of a
//    4/4 bar belongs to the chord in effect, so the accompaniment supports the harmony where the
//    ear expects it. Notes off those beats may be passing tones. P2 is exempt in bars where it
//    plays the echo texture, because the echo replays the melody, passing tones included.
// 4. Complete bars: no note starts before the piece or rings past the end of its bar.
// Each violation is a message naming the channel, the bar (counted from 1) and the broken rule,
// for example "TR bar 3: pitch 40 at beat 3 is not a chord tone of Am".

import { GENES_PER_BAR, NO, OCT, P2, P2_TEXTURES, TR } from "./genome.js";
import { chordAt } from "./leadsheet.js";
import { CHANNELS, PITCH_RANGES, realizeNo, realizeP1, realizeP2, realizeTr } from "./textures.js";

/**
 * A channel name: "P1", "P2", "TR" or "NO".
 * @typedef {(typeof CHANNELS)[number]} Channel
 */

/**
 * A finished four-channel arrangement of a lead sheet.
 * @typedef {object} Arrangement
 * @property {string} title tune title.
 * @property {number} tempoBpm tempo in quarter notes per minute.
 * @property {Uint8Array} plan the arrangement plan, nBars × 4 genes (genome.js).
 * @property {Record<Channel, import("./textures.js").ChannelNote[]>} channels notes per channel,
 *   with onsets in beats from the piece start.
 */

/**
 * Realize every bar of `plan` on `leadSheet`.
 *
 * As in Python, a bar's notes start at `beatsPerBar × bar.index`, and TR leads into the bar whose
 * index follows (the walking bass approaches its root).
 *
 * @param {import("./leadsheet.js").LeadSheet} leadSheet the lead sheet the plan arranges.
 * @param {ArrayLike<number>} plan nBars × 4 genes, bar b at indices 4b … 4b + 3.
 * @returns {Arrangement} the notes of every channel, with its own copy of the plan.
 * @throws {RangeError} when the plan does not hold 4 genes per bar of the lead sheet, or a gene
 *   is invalid.
 * @example
 * const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 };
 * const bar = { index: 0, melody: [], chords: [c], label: "A", role: "verse", phrase: 0, phraseEnd: true };
 * const sheet = { title: "Two bars", key: "", tempoBpm: 120, beatsPerBar: 4, sourceGrid: null,
 *   bars: [bar, { ...bar, index: 1 }] };
 * const arrangement = assemble(sheet, Uint8Array.of(0, 0, 1, 0, 0, 0, 1, 0)); // hold, root, half_time
 * arrangement.channels.P2.map((n) => [n.pitch, n.onset]); // [[48, 0], [48, 4]]
 * arrangement.channels.NO.map((n) => n.onset); // [0, 1, 2, 3, 4, 5, 6, 7]
 */
export function assemble(leadSheet, plan) {
  const bars = leadSheet.bars;
  if (plan.length !== bars.length * GENES_PER_BAR) {
    throw new RangeError(`a plan for ${bars.length} bars has ${bars.length * GENES_PER_BAR} genes, got ${plan.length}`);
  }
  /** @type {Record<Channel, import("./textures.js").ChannelNote[]>} */
  const channels = { P1: [], P2: [], TR: [], NO: [] };
  bars.forEach((bar, position) => {
    const genes = position * GENES_PER_BAR;
    const nextBar = bar.index + 1 < bars.length ? bars[bar.index + 1] : null;
    const barStart = leadSheet.beatsPerBar * bar.index;
    const barNotes = {
      P1: realizeP1(bar, plan[genes + OCT]),
      P2: realizeP2(bar, plan[genes + P2]),
      TR: realizeTr(bar, plan[genes + TR], nextBar),
      NO: realizeNo(plan[genes + NO]),
    };
    for (const channel of CHANNELS) {
      for (const note of barNotes[channel]) channels[channel].push({ ...note, onset: note.onset + barStart });
    }
  });
  return { title: leadSheet.title, tempoBpm: leadSheet.tempoBpm, plan: Uint8Array.from(plan), channels };
}

const BEATS_PER_BAR = 4;

// Onsets closer than this are the same instant: it absorbs float noise in sums of durations.
const TOLERANCE = 1e-9;

// Beats 1 and 3, as onsets in beats from the bar start.
const STRONG_BEAT_OFFSETS = Object.freeze([0, 2]);

const ECHO = P2_TEXTURES.indexOf("echo");

/**
 * The bar index (from 0) of a note and its onset in beats from that bar's start.
 * @param {import("./textures.js").ChannelNote} note
 * @returns {[number, number]}
 */
function barPosition(note) {
  const barIndex = Math.floor(note.onset / BEATS_PER_BAR);
  return [barIndex, note.onset - BEATS_PER_BAR * barIndex];
}

/**
 * Python's `format(value, "g")`: 6 significant digits, no trailing zeros, so beat 2.5 prints
 * as "2.5" and beat 1 + 1/3 as "1.33333".
 * @param {number} value
 */
function formatG(value) {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  if (value === 0) return Object.is(value, -0) ? "-0" : "0";
  const [mantissa, exponentText] = value.toExponential(5).split("e");
  const exponent = Number(exponentText);
  if (exponent < -4 || exponent >= 6) {
    const sign = exponent < 0 ? "-" : "+";
    return `${mantissa.replace(/\.?0+$/, "")}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  return String(Number(value.toPrecision(6)));
}

/**
 * The message prefix "TR bar 3" and the beat label "3" (both counted from 1) of a note.
 * @param {Channel} channel
 * @param {import("./textures.js").ChannelNote} note
 * @returns {[string, string]}
 */
function where(channel, note) {
  const [barIndex, offset] = barPosition(note);
  return [`${channel} bar ${barIndex + 1}`, formatG(offset + 1)];
}

/**
 * @param {Channel} channel
 * @param {import("./textures.js").ChannelNote[]} notes sorted by onset.
 */
function overlaps(channel, notes) {
  const violations = [];
  for (let index = 0; index + 1 < notes.length; index++) {
    const note = notes[index];
    if (note.onset + note.duration > notes[index + 1].onset + TOLERANCE) {
      const [prefix, beat] = where(channel, note);
      violations.push(`${prefix}: the note at beat ${beat} overlaps the next note`);
    }
  }
  return violations;
}

/**
 * @param {Channel} channel
 * @param {import("./textures.js").ChannelNote[]} notes
 */
function outOfRange(channel, notes) {
  if (channel === "NO") return [];
  const [low, high] = PITCH_RANGES[channel];
  const violations = [];
  for (const note of notes) {
    if (!(low <= note.pitch && note.pitch <= high)) {
      const [prefix, beat] = where(channel, note);
      violations.push(`${prefix}: pitch ${note.pitch} at beat ${beat} is outside the range ${low}-${high}`);
    }
  }
  return violations;
}

/**
 * @param {Channel} channel
 * @param {import("./textures.js").ChannelNote[]} notes
 * @param {ArrayLike<number>} plan
 * @param {import("./leadsheet.js").LeadSheet} leadSheet
 */
function nonChordTonesOnStrongBeats(channel, notes, plan, leadSheet) {
  if (channel !== "P2" && channel !== "TR") return [];
  const violations = [];
  for (const note of notes) {
    const [barIndex, offset] = barPosition(note);
    if (!(barIndex >= 0 && barIndex < leadSheet.bars.length)) continue; // no chord to compare with
    if (!STRONG_BEAT_OFFSETS.some((strong) => Math.abs(offset - strong) < TOLERANCE)) continue;
    if (channel === "P2" && plan[barIndex * GENES_PER_BAR + P2] === ECHO) continue;
    const chord = chordAt(leadSheet.bars[barIndex], offset);
    if (!chord.tones.includes(((note.pitch % 12) + 12) % 12)) {
      const [prefix, beat] = where(channel, note);
      violations.push(`${prefix}: pitch ${note.pitch} at beat ${beat} is not a chord tone of ${chord.symbol}`);
    }
  }
  return violations;
}

/**
 * @param {Channel} channel
 * @param {import("./textures.js").ChannelNote[]} notes
 */
function incompleteBars(channel, notes) {
  const violations = [];
  for (const note of notes) {
    if (note.onset < 0) {
      violations.push(`${channel} bar 1: the note at onset ${formatG(note.onset)} starts before the piece`);
      continue;
    }
    const [, offset] = barPosition(note);
    if (offset + note.duration > BEATS_PER_BAR + TOLERANCE) {
      const [prefix, beat] = where(channel, note);
      violations.push(`${prefix}: the note at beat ${beat} crosses the bar end`);
    }
  }
  return violations;
}

/**
 * List every NES rule the arrangement breaks; an empty list means it can be exported.
 *
 * Note onsets are in beats from the start of the piece. A missing channel counts as silent.
 * Messages come in channel order (P1, P2, TR, NO), then rule order, then time order.
 *
 * @param {{plan: ArrayLike<number>, channels: Partial<Record<Channel, import("./textures.js").ChannelNote[]>>}} arrangement
 *   the arrangement to check (an `Arrangement`, or any object with its plan and channels).
 * @param {import("./leadsheet.js").LeadSheet} leadSheet the lead sheet it arranges.
 * @returns {string[]} one message per violation.
 * @example
 * const c = { symbol: "C", root: 0, tones: [0, 4, 7], onset: 0, duration: 4 };
 * const sheet = { title: "Tune", key: "C major", tempoBpm: 120, beatsPerBar: 4, sourceGrid: null,
 *   bars: [{ index: 0, melody: [], chords: [c], label: "A", role: "verse", phrase: 0, phraseEnd: true }] };
 * const bass = [{ pitch: 36, onset: 0, duration: 2, velocity: 90 }, { pitch: 38, onset: 2, duration: 2, velocity: 90 }];
 * findViolations({ plan: Uint8Array.of(0, 0, 0, 0), channels: { TR: bass } }, sheet);
 * // ["TR bar 1: pitch 38 at beat 3 is not a chord tone of C"]
 */
export function findViolations(arrangement, leadSheet) {
  /** @type {string[]} */
  const violations = [];
  for (const channel of CHANNELS) {
    // A stable sort, as Python's sorted: notes with the same onset keep their order.
    const notes = [...(arrangement.channels[channel] ?? [])].sort((a, b) => a.onset - b.onset);
    violations.push(
      ...overlaps(channel, notes),
      ...outOfRange(channel, notes),
      ...nonChordTonesOnStrongBeats(channel, notes, arrangement.plan, leadSheet),
      ...incompleteBars(channel, notes),
    );
  }
  return violations;
}
