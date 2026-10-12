// @ts-check
// Tests for core/genome.js, the arrangement plan as four integer genes per bar. They port the
// doctests of src/ga/genome.py.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GENE_SIZES,
  GENES_PER_BAR,
  NO,
  NO_PATTERNS,
  OCT,
  P1_OCTAVES,
  P2,
  P2_TEXTURES,
  TR,
  TR_TEXTURES,
  decode,
  randomPopulation,
} from "../src/core/genome.js";
import { createRandom } from "../src/core/random.js";

test("each gene has as many values as its list of choices", () => {
  assert.deepEqual(GENE_SIZES, [5, 4, 5, 3]);
  assert.equal(GENES_PER_BAR, 4);
});

test("the gene choices are named as in the Python genome", () => {
  assert.deepEqual(P2_TEXTURES, ["hold", "arp16", "arp32", "echo", "third"]);
  assert.deepEqual(TR_TEXTURES, ["root", "octave_pump", "root_fifth", "walking"]);
  assert.deepEqual(NO_PATTERNS, ["none", "half_time", "eighth_beat", "sixteenth_beat", "fill"]);
  assert.deepEqual(P1_OCTAVES, [0, 12, -12]);
  assert.deepEqual([P2, TR, NO, OCT], [0, 1, 2, 3]);
});

test("the lists of choices cannot be changed", () => {
  for (const choices of [P2_TEXTURES, TR_TEXTURES, NO_PATTERNS, P1_OCTAVES, GENE_SIZES]) {
    assert.ok(Object.isFrozen(choices));
  }
});

test("randomPopulation(rng, 3, 2) gives 24 genes, each below its gene size", () => {
  const population = randomPopulation(createRandom(1), 3, 2);
  assert.ok(population instanceof Uint8Array);
  assert.equal(population.length, 24);
  population.forEach((gene, index) => {
    assert.ok(gene < GENE_SIZES[index % GENES_PER_BAR], `gene ${index} = ${gene}`);
  });
});

test("randomPopulation draws each gene with rng.integer, plan by plan, bar by bar", () => {
  const rng = createRandom(9);
  const expected = Array.from({ length: 2 * 3 * 4 }, (_, index) =>
    rng.integer(0, GENE_SIZES[index % 4]),
  );
  assert.deepEqual(Array.from(randomPopulation(createRandom(9), 2, 3)), expected);
});

test("randomPopulation reaches every value of every gene", () => {
  const population = randomPopulation(createRandom(4), 50, 4);
  for (let gene = 0; gene < GENES_PER_BAR; gene++) {
    const seen = new Set();
    for (let index = gene; index < population.length; index += GENES_PER_BAR) {
      seen.add(population[index]);
    }
    assert.equal(seen.size, GENE_SIZES[gene], `gene ${gene}`);
  }
});

test("randomPopulation rejects a size that is not a positive integer", () => {
  const rng = createRandom(1);
  assert.throws(() => randomPopulation(rng, 0, 2), RangeError);
  assert.throws(() => randomPopulation(rng, 3, 2.5), RangeError);
});

test("decode turns the genes 1, 3, 4, 2 into readable choices", () => {
  assert.deepEqual(decode(Uint8Array.of(1, 3, 4, 2)), [
    { p2: "arp16", tr: "walking", no: "fill", p1Octave: -12 },
  ]);
});

test("decode gives one entry per bar, in bar order", () => {
  assert.deepEqual(decode(Uint8Array.of(0, 0, 0, 0, 4, 1, 2, 1)), [
    { p2: "hold", tr: "root", no: "none", p1Octave: 0 },
    { p2: "third", tr: "octave_pump", no: "eighth_beat", p1Octave: 12 },
  ]);
});

test("decode rejects a plan that is not whole bars or has an invalid gene", () => {
  assert.throws(() => decode(Uint8Array.of(1, 3, 4)), RangeError);
  assert.throws(() => decode(Uint8Array.of(5, 0, 0, 0)), RangeError);
  assert.throws(() => decode(Uint8Array.of(0, 0, 0, 3)), RangeError);
});
