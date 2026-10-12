// @ts-check
// Tests for core/random.js, the seeded generator behind every random choice of the GA.
// The pinned values come from referenceStream below, an independent BigInt version of the
// algorithm (splitmix32 seeding, 12 discarded outputs, sfc32), so the pin is not circular.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createRandom } from "../src/core/random.js";

const MASK = 0xffffffffn;

/**
 * The algorithm written from its description with BigInt and an explicit mask, without the
 * 32-bit tricks of random.js.
 * @param {number} seed
 * @param {number} count
 * @returns {number[]}
 */
function referenceStream(seed, count) {
  let state = BigInt(seed);
  const splitmix32 = () => {
    state = (state + 0x9e3779b9n) & MASK;
    let z = state;
    z = ((z ^ (z >> 16n)) * 0x21f0aaadn) & MASK;
    z = ((z ^ (z >> 15n)) * 0x735a2d97n) & MASK;
    return z ^ (z >> 15n);
  };
  let a = splitmix32();
  let b = splitmix32();
  let c = splitmix32();
  let d = splitmix32();
  const sfc32 = () => {
    const t = (a + b + d) & MASK;
    d = (d + 1n) & MASK;
    a = b ^ (b >> 9n);
    b = (c + (c << 3n)) & MASK;
    c = ((c << 21n) | (c >> 11n)) & MASK;
    c = (c + t) & MASK;
    return t;
  };
  for (let i = 0; i < 12; i++) sfc32();
  return Array.from({ length: count }, () => Number(sfc32()));
}

/** @param {import("../src/core/random.js").Random} rng @param {number} count */
function draws(rng, count) {
  return Array.from({ length: count }, () => rng.uint32());
}

test("the first four outputs of seed 1 are pinned", () => {
  const pinned = [1130556604, 2591592147, 3014952990, 960850752];
  assert.deepEqual(referenceStream(1, 4), pinned);
  assert.deepEqual(draws(createRandom(1), 4), pinned);
});

test("the generator follows the reference algorithm for 1,000 outputs of several seeds", () => {
  for (const seed of [0, 1, 2, 7, 123456789, 4294967295]) {
    assert.deepEqual(draws(createRandom(seed), 1000), referenceStream(seed, 1000), `seed ${seed}`);
  }
});

test("two generators with the same seed give the same 1,000 numbers", () => {
  assert.deepEqual(draws(createRandom(1), 1000), draws(createRandom(1), 1000));
});

test("seeds 1 and 2 give different streams", () => {
  assert.notDeepEqual(draws(createRandom(1), 10), draws(createRandom(2), 10));
});

test("uint32 is an integer from 0 to 2^32 - 1", () => {
  const rng = createRandom(3);
  for (let i = 0; i < 10000; i++) {
    const value = rng.uint32();
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, `${value}`);
  }
});

test("float is uint32 divided by 2^32, so it lies in [0, 1)", () => {
  const expected = referenceStream(5, 1000).map((value) => value / 4294967296);
  const rng = createRandom(5);
  for (const value of expected) {
    const drawn = rng.float();
    assert.equal(drawn, value);
    assert.ok(drawn >= 0 && drawn < 1);
  }
});

test("integer(3, 7) stays in 3..6 and gives each value 20-30% of the time", () => {
  const rng = createRandom(11);
  const counts = new Map([[3, 0], [4, 0], [5, 0], [6, 0]]);
  for (let i = 0; i < 10000; i++) {
    const value = rng.integer(3, 7);
    assert.ok(counts.has(value), `${value} is outside 3..6`);
    counts.set(value, /** @type {number} */ (counts.get(value)) + 1);
  }
  for (const [value, count] of counts) {
    assert.ok(count >= 2000 && count <= 3000, `${value} appeared ${count} times`);
  }
});

test("integer with a range of one value always returns that value", () => {
  const rng = createRandom(1);
  for (let i = 0; i < 100; i++) assert.equal(rng.integer(4, 5), 4);
});

test("integer covers the full 32-bit range without bias toward low values", () => {
  // A range of 3 * 2^30 does not divide 2^32: plain modulo would pick the lowest third of the
  // range twice as often as the rest (half of all draws instead of a third).
  const rng = createRandom(13);
  const range = 3 * 2 ** 30;
  let lowestThird = 0;
  for (let i = 0; i < 30000; i++) {
    const value = rng.integer(0, range);
    assert.ok(Number.isInteger(value) && value >= 0 && value < range);
    if (value < 2 ** 30) lowestThird++;
  }
  assert.ok(lowestThird > 9400 && lowestThird < 10600, `${lowestThird} draws in the lowest third`);
});

test("integer throws RangeError when the range is empty or not made of integers", () => {
  const rng = createRandom(1);
  assert.throws(() => rng.integer(5, 5), RangeError);
  assert.throws(() => rng.integer(5, 2), RangeError);
  assert.throws(() => rng.integer(0, 2.5), RangeError);
  assert.throws(() => rng.integer(0, 2 ** 32 + 1), RangeError);
});

test("pickWeighted never returns an index of weight 0", () => {
  // Weights 0, 1, 0, 2, 0 give the running sums 0, 1, 1, 3, 3.
  const cumulative = Float64Array.of(0, 1, 1, 3, 3);
  const rng = createRandom(17);
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < 9000; i++) counts[rng.pickWeighted(cumulative, 3)]++;
  assert.equal(counts[0] + counts[2] + counts[4], 0);
  assert.ok(counts[1] > 2700 && counts[1] < 3300, `index 1 picked ${counts[1]} times`);
});

test("pickWeighted throws RangeError when the total is not positive", () => {
  const rng = createRandom(1);
  assert.throws(() => rng.pickWeighted(Float64Array.of(0, 0), 0), RangeError);
});

test("a seed outside 0..4,294,967,295 or a non-integer seed throws RangeError", () => {
  for (const seed of [-1, 4294967296, 1.5, NaN, Infinity]) {
    assert.throws(() => createRandom(seed), RangeError, `seed ${seed}`);
  }
  assert.throws(() => createRandom(/** @type {any} */ ("1")), RangeError);
});

test("the JSDoc example of createRandom holds", () => {
  const rng = createRandom(1);
  assert.equal(rng.uint32(), 1130556604);
  assert.ok(rng.integer(0, 5) < 5);
  const pick = rng.pickWeighted(Float64Array.of(0, 1, 1, 3), 3);
  assert.ok(pick === 1 || pick === 3);
});
