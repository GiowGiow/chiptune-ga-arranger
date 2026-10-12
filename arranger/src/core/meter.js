// @ts-check
// Meters: how long a bar is, where its beats fall and which beats are strong (port of
// src/leadsheet/meter.py).
//
// A meter (time signature) such as 3/4 says that a bar holds three quarter notes. The listener
// does not hear the bar as an even row of notes but as a few *beats*, the pulse a foot taps, and
// some beats are *strong*: beat 1 always, and in 4/4 also beat 3. Every texture of the arranger
// leans on that pulse: the bass plays the root on a strong beat, the drums kick on strong beats
// and hit the snare on weak ones.
//
// The meters fall into three families:
// - Simple meters (2/2, 2/4, 3/4, 4/4) count beats of the denominator note: 3/4 has three
//   quarter-note beats.
// - Compound meters (6/8, 9/8, 12/8) group their eighth notes in threes, so a beat is a dotted
//   quarter: 6/8 has two beats of 1.5 quarters each, and a jig is felt "in two".
// - Irregular meters group unequal beats: 5/4 is felt 3 + 2 (strong beats 1 and 4), and 7/8 is
//   felt as eighths grouped 2 + 2 + 3, so its three beats last 1, 1 and 1.5 quarters.
//
// A meter's strong beats are the first beat of each group: a quadruple meter (4/4, 12/8) groups
// its four beats 2 + 2, a duple or triple meter is one group. All lengths are in quarter-note
// beats, the unit of the whole method, so a 6/8 bar lasts 3.0 and a 7/8 bar 3.5.
//
// A meter is a frozen object, and there is exactly one object per supported meter, so two bars
// in the same meter hold the same object and compare with ===.

/**
 * A supported time signature, with its beats and strong beats. `String(meter)` gives "3/4".
 * @typedef {object} Meter
 * @property {number} numerator beats (or eighths, in compound and 7/8 meters) per bar, as written.
 * @property {number} denominator the note value of the numerator: 2, 4 or 8.
 * @property {number} barBeats the bar length in quarter notes: numerator × 4 / denominator.
 * @property {readonly number[]} beats the length of each beat in quarter notes; they add up to
 *   barBeats.
 * @property {readonly number[]} strong indices into beats of the strong beats; beat 0 is always
 *   strong.
 * @property {number} steps sixteenth-note steps in one bar, the grid of the drums and of the
 *   score tables.
 * @property {() => string} toString the meter as written, for example "3/4".
 */

/**
 * Anything placed in a meter, such as a lead-sheet bar.
 * @typedef {{meter: Meter}} HasMeter
 */

// [numerator, denominator, beat lengths in quarter notes, indices of the strong beats] of every
// supported meter, in the order of the spec.
/** @type {[number, number, number[], number[]][]} */
const STRUCTURE = [
  [2, 2, [2.0, 2.0], [0]],
  [2, 4, [1.0, 1.0], [0]],
  [3, 4, [1.0, 1.0, 1.0], [0]],
  [4, 4, [1.0, 1.0, 1.0, 1.0], [0, 2]],
  [6, 8, [1.5, 1.5], [0]],
  [9, 8, [1.5, 1.5, 1.5], [0]],
  [12, 8, [1.5, 1.5, 1.5, 1.5], [0, 2]],
  [5, 4, [1.0, 1.0, 1.0, 1.0, 1.0], [0, 3]],
  [7, 8, [1.0, 1.0, 1.5], [0]],
];

// Names that ABC writes for two meters: "C" (common time) and "C|" (cut time).
/** @type {Readonly<Record<string, [number, number]>>} */
const SYMBOLS = Object.freeze({ C: [4, 4], "C|": [2, 2] });

/**
 * The nine supported meters, in the order 2/2, 2/4, 3/4, 4/4, 6/8, 9/8, 12/8, 5/4, 7/8.
 * @type {readonly Meter[]}
 * @example
 * SUPPORTED_METERS.map(String); // → ["2/2", "2/4", "3/4", "4/4", "6/8", "9/8", "12/8", "5/4", "7/8"]
 */
export const SUPPORTED_METERS = Object.freeze(
  STRUCTURE.map(([numerator, denominator, beats, strong]) => {
    const text = `${numerator}/${denominator}`;
    const barBeats = (numerator * 4) / denominator;
    return Object.freeze({
      numerator,
      denominator,
      barBeats,
      beats: Object.freeze([...beats]),
      strong: Object.freeze([...strong]),
      steps: Math.round(4 * barBeats),
      toString: () => text,
    });
  }),
);

/** @type {ReadonlyMap<string, Meter>} */
const BY_TEXT = new Map(SUPPORTED_METERS.map((meter) => [meterText(meter), meter]));

/**
 * The error for a meter outside the supported nine, naming the bar when it is known.
 * @param {string} text the meter as written.
 * @param {number | undefined} barNumber the bar (counted from 1) where it appears.
 * @returns {Error}
 */
function unsupported(text, barNumber) {
  const supported = SUPPORTED_METERS.map(meterText).join(", ");
  const where = barNumber !== undefined ? `bar ${barNumber}: ` : "";
  return new Error(`${where}the meter ${text} is not supported; supported meters: ${supported}`);
}

/**
 * The meter as written: numerator, slash, denominator. `String(meter)` gives the same text.
 *
 * @param {Meter} meter a supported meter.
 * @returns {string} for example "6/8".
 * @example
 * meterText(makeMeter(6, 8)); // → "6/8"
 * String(makeMeter(6, 8)); // → "6/8"
 */
export function meterText(meter) {
  return `${meter.numerator}/${meter.denominator}`;
}

/**
 * The supported meter numerator/denominator, as the one shared object of that meter.
 *
 * @param {number} numerator beats (or eighths) per bar, as written.
 * @param {number} denominator the note value of the numerator: 2, 4 or 8.
 * @returns {Meter} the meter; the same object on every call.
 * @throws {Error} for a meter outside the nine supported ones.
 * @example
 * const waltz = makeMeter(3, 4);
 * [waltz.barBeats, waltz.beats, waltz.strong, waltz.steps]; // → [3, [1, 1, 1], [0], 12]
 * makeMeter(6, 8).beats; // → [1.5, 1.5], two dotted-quarter beats
 * makeMeter(3, 4) === waltz; // → true
 */
export function makeMeter(numerator, denominator) {
  const text = `${numerator}/${denominator}`;
  const meter = BY_TEXT.get(text);
  if (meter === undefined) {
    throw unsupported(text, undefined);
  }
  return meter;
}

/**
 * The 4/4 meter, also written "C" (common time). A bar without a declared meter is in 4/4.
 * @type {Meter}
 * @example
 * FOUR_FOUR === makeMeter(4, 4); // → true
 */
export const FOUR_FOUR = makeMeter(4, 4);

/**
 * Read a meter as ABC or a time signature writes it: "3/4", "6/8", "C" or "C|".
 *
 * @param {string} text the meter text; spaces around it are ignored.
 * @param {number} [barNumber] the bar (counted from 1) where the meter appears, named in the
 *   error.
 * @returns {Meter} the meter.
 * @throws {Error} for a meter outside the nine supported ones.
 * @example
 * parseMeter("C|") === makeMeter(2, 2); // → true
 * parseMeter("11/16", 3);
 * // throws Error: bar 3: the meter 11/16 is not supported; supported meters: 2/2, 2/4, ..., 7/8
 */
export function parseMeter(text, barNumber) {
  const cleaned = text.trim();
  if (Object.hasOwn(SYMBOLS, cleaned)) {
    return makeMeter(...SYMBOLS[cleaned]);
  }
  const fraction = /^(\d+)\/(\d+)$/.exec(cleaned);
  if (fraction !== null) {
    const meter = BY_TEXT.get(`${Number(fraction[1])}/${Number(fraction[2])}`);
    if (meter !== undefined) {
      return meter;
    }
  }
  throw unsupported(cleaned, barNumber);
}

/**
 * The onset of each beat, in quarter notes from the bar start: the running sum of the beats.
 *
 * @param {Meter} meter a supported meter.
 * @returns {number[]} one onset per beat, starting at 0.
 * @example
 * beatOnsets(makeMeter(7, 8)); // → [0, 1, 2]
 */
export function beatOnsets(meter) {
  const onsets = [0.0];
  for (const beat of meter.beats.slice(0, -1)) {
    onsets.push(onsets[onsets.length - 1] + beat);
  }
  return onsets;
}

/**
 * The onsets of the strong beats, in quarter notes from the bar start.
 *
 * @param {Meter} meter a supported meter.
 * @returns {number[]} one onset per strong beat, starting at 0.
 * @example
 * strongOnsets(FOUR_FOUR); // → [0, 2]
 * strongOnsets(makeMeter(5, 4)); // → [0, 3]
 */
export function strongOnsets(meter) {
  const onsets = beatOnsets(meter);
  return meter.strong.map((index) => onsets[index]);
}

/**
 * The [onset, length] spans from each strong beat to the next one or to the bar end.
 *
 * These are the stretches over which the MIDI reader decides one chord: half bars in 4/4,
 * 3 + 2 beats in 5/4, the whole bar in 3/4.
 *
 * @param {Meter} meter a supported meter.
 * @returns {[number, number][]} one [onset, length] pair per strong beat, in quarter notes.
 * @example
 * groups(FOUR_FOUR); // → [[0, 2], [2, 2]]
 * groups(makeMeter(3, 4)); // → [[0, 3]]
 */
export function groups(meter) {
  const starts = strongOnsets(meter);
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : meter.barBeats;
    return [start, end - start];
  });
}

/**
 * The onset of each bar, in quarter notes from the start of the piece.
 *
 * @param {readonly HasMeter[]} bars anything with a meter, such as lead-sheet bars.
 * @returns {number[]} one onset per bar; empty for no bars.
 * @example
 * barStarts([{meter: FOUR_FOUR}, {meter: parseMeter("2/4")}, {meter: parseMeter("3/4")}]);
 * // → [0, 4, 6]
 */
export function barStarts(bars) {
  const starts = [];
  let onset = 0.0;
  for (const bar of bars) {
    starts.push(onset);
    onset += bar.meter.barBeats;
  }
  return starts;
}

/**
 * The length of the piece in quarter notes: the sum of its bar lengths.
 *
 * @param {readonly HasMeter[]} bars anything with a meter, such as lead-sheet bars.
 * @returns {number} the total length; 0 for no bars.
 * @example
 * totalBeats([{meter: parseMeter("6/8")}, {meter: parseMeter("6/8")}]); // → 6
 */
export function totalBeats(bars) {
  return bars.reduce((total, bar) => total + bar.meter.barBeats, 0.0);
}
