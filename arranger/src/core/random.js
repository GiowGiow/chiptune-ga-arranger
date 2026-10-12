// @ts-check
// The seeded random generator behind every random choice of the GA.
//
// A GA run must be reproducible: the same input, seed and settings give the same arrangement.
// The Python command line gets this from numpy's `np.random.default_rng(seed)`, passed to every
// function that draws (see `src/ga/operators.py`). The browser has no seedable generator, so
// this module builds one, and every core function that draws takes it as its first parameter.
//
// - sfc32 ("small fast counting" generator) keeps four 32-bit words of state and mixes them with
//   an add, a shift-xor and a rotation per output. It passes the PractRand statistical tests and
//   uses only 32-bit integer operations, so every JavaScript engine gives the same stream.
// - splitmix32 turns the single 32-bit seed into the four state words. It adds the golden-ratio
//   constant 0x9e3779b9 to a counter and scrambles the counter with two multiply-xorshift
//   rounds, so seeds 1 and 2 already give unrelated states. The first 12 sfc32 outputs are
//   discarded to mix the state further.
// The formulas follow bryc's "PRNGs.md" (github.com/bryc/code, jshash). The stream differs from
// numpy's on purpose: the app need not repeat the command line's arrangement (spec FR-028,
// research R5).

const TWO_TO_32 = 4294967296;
const GOLDEN_RATIO_32 = 0x9e3779b9;
const WARM_UP_OUTPUTS = 12;

/**
 * A seeded stream of random numbers. Each call advances the stream.
 * @typedef {object} Random
 * @property {() => number} uint32 the next 32-bit output, an integer from 0 to 2^32 - 1.
 * @property {() => number} float a number in [0, 1): the next uint32 divided by 2^32.
 * @property {(low: number, high: number) => number} integer an integer from low to high - 1,
 *   each with the same probability. Throws RangeError when high <= low.
 * @property {(cumulative: ArrayLike<number>, total: number) => number} pickWeighted an index i
 *   with probability weight[i] / total, given the running sums of the weights. An index of
 *   weight 0 is never returned.
 */

/**
 * Create a generator from an integer seed.
 *
 * @param {number} seed an integer from 0 to 4,294,967,295.
 * @returns {Random} a fresh stream; two generators with the same seed give the same numbers.
 * @throws {RangeError} when the seed is not an integer in that range.
 * @example
 * const rng = createRandom(1);
 * rng.uint32(); // → 1130556604, the first output of seed 1
 * rng.integer(0, 5); // → one of 0, 1, 2, 3, 4
 * rng.pickWeighted(Float64Array.of(0, 1, 1, 3), 3); // → 1 or 3: weights 0, 1, 0, 2
 */
export function createRandom(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`the seed must be an integer from 0 to 4294967295, got ${seed}`);
  }

  let counter = seed | 0;
  const splitmix32 = () => {
    counter = (counter + GOLDEN_RATIO_32) | 0;
    let z = counter ^ (counter >>> 16);
    z = Math.imul(z, 0x21f0aaad);
    z ^= z >>> 15;
    z = Math.imul(z, 0x735a2d97);
    return z ^ (z >>> 15);
  };

  // The four words of sfc32 state, kept as signed 32-bit integers (`| 0`).
  let a = splitmix32();
  let b = splitmix32();
  let c = splitmix32();
  let d = splitmix32();

  const uint32 = () => {
    const output = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; // the counter that guarantees a period of at least 2^32
    a = b ^ (b >>> 9);
    b = Math.imul(c, 9); // c + 8c, wrapped to 32 bits
    // Rotate c left by 21 bits: c * 2^21 keeps the low 11 bits on top, c >>> 11 brings the high
    // 21 bits down. The two parts share no bit, so xor joins them.
    c = Math.imul(c, 0x200000) ^ (c >>> 11);
    c = (c + output) | 0;
    return output >>> 0;
  };

  for (let i = 0; i < WARM_UP_OUTPUTS; i++) uint32();

  const float = () => uint32() / TWO_TO_32;

  /** @param {number} low @param {number} high */
  const integer = (low, high) => {
    const range = high - low;
    if (!Number.isInteger(low) || !Number.isInteger(high) || range < 1 || range > TWO_TO_32) {
      throw new RangeError(`integer needs integers low < high within 2^32, got ${low}, ${high}`);
    }
    // Rejection: plain uint32 % range would favour small values when range does not divide
    // 2^32. Outputs at or above the largest multiple of range are redrawn.
    const limit = TWO_TO_32 - (TWO_TO_32 % range);
    let value = uint32();
    while (value >= limit) value = uint32();
    return low + (value % range);
  };

  /** @param {ArrayLike<number>} cumulative @param {number} total */
  const pickWeighted = (cumulative, total) => {
    if (!(total > 0)) throw new RangeError(`pickWeighted needs a positive total, got ${total}`);
    // Spin the wheel: r falls in the slice of index i when cumulative[i - 1] <= r < cumulative[i].
    // A zero-weight index has an empty slice, so the first index with cumulative[i] > r never
    // has weight 0.
    const r = float() * total;
    let first = 0;
    let last = cumulative.length - 1;
    while (first < last) {
      const middle = (first + last) >>> 1;
      if (cumulative[middle] > r) last = middle;
      else first = middle + 1;
    }
    return first;
  };

  return { uint32, float, integer, pickWeighted };
}
