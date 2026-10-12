// @ts-check
// Tests for core/genome.js, the arrangement plan as four integer genes per bar. They port the
// doctests of src/ga/genome.py.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_ALLOWED,
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
  allowedGenes,
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

// Allowed values (spec 003, research R12)

/** Every value of every gene but arp32 (P2 gene value 2). */
const NO_ARP32 = [[0, 1, 3, 4], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2]];

test("by default every value of every gene is allowed, and the list cannot be changed", () => {
  assert.deepEqual(ALL_ALLOWED, [[0, 1, 2, 3, 4], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2]]);
  assert.ok(Object.isFrozen(ALL_ALLOWED));
  for (const values of ALL_ALLOWED) assert.ok(Object.isFrozen(values));
});

test("allowedGenes turns value names into sorted gene values, column by column", () => {
  const allowed = {
    p2: ["hold", "arp16", "echo", "third"],
    tr: ["root", "octave_pump", "root_fifth", "walking"],
    no: ["none", "half_time", "eighth_beat", "sixteenth_beat", "fill"],
    p1_octave: [0, 12, -12],
  };
  assert.deepEqual(allowedGenes(allowed), NO_ARP32);
});

test("allowedGenes ignores the order of each list", () => {
  const allowed = {
    p2: ["third", "hold"],
    tr: ["walking", "root"],
    no: ["fill", "none", "half_time"],
    p1_octave: [-12, 0],
  };
  assert.deepEqual(allowedGenes(allowed), [[0, 4], [0, 3], [0, 1, 4], [0, 2]]);
});

test("allowedGenes rejects a value name that no gene has", () => {
  const allowed = { p2: ["arp64"], tr: ["root"], no: ["none"], p1_octave: [0] };
  assert.throws(() => allowedGenes(allowed), RangeError);
});

test("with every value allowed, randomPopulation makes the same draws as without the setting", () => {
  const omitted = createRandom(1);
  const allAllowed = createRandom(1);
  const plain = randomPopulation(omitted, 5, 7);
  assert.deepEqual(randomPopulation(allAllowed, 5, 7, ALL_ALLOWED), plain);
  assert.equal(allAllowed.uint32(), omitted.uint32(), "the generators end in the same state");
});

test("randomPopulation keeps the population that seed 1 gave before the setting existed", () => {
  const rng = createRandom(1);
  const population = randomPopulation(rng, 2, 2);
  assert.deepEqual(Array.from(population), [4, 3, 0, 0, 2, 1, 4, 2, 2, 2, 1, 2, 3, 0, 3, 2]);
  assert.equal(rng.uint32(), 1197866444);
});

test("with arp32 disallowed, no plan of a large population holds it", () => {
  const population = randomPopulation(createRandom(2), 200, 32, NO_ARP32);
  for (let index = P2; index < population.length; index += GENES_PER_BAR) {
    assert.notEqual(population[index], 2, `gene ${index} is arp32`);
  }
});

test("randomPopulation draws a position among the allowed values, in storage order", () => {
  const allowed = [[1, 4], [3], [0, 2, 4], [0, 2]];
  const reference = createRandom(3);
  const expected = Array.from({ length: 4 * 3 * 4 }, (_, index) => {
    const values = allowed[index % 4];
    return values[reference.integer(0, values.length)];
  });
  const rng = createRandom(3);
  assert.deepEqual(Array.from(randomPopulation(rng, 4, 3, allowed)), expected);
  assert.equal(rng.uint32(), reference.uint32());
});

test("randomPopulation reaches every allowed value and no other", () => {
  const allowed = [[1, 4], [3], [0, 2, 4], [0, 2]];
  const population = randomPopulation(createRandom(4), 100, 4, allowed);
  for (let gene = 0; gene < GENES_PER_BAR; gene++) {
    const seen = new Set();
    for (let index = gene; index < population.length; index += GENES_PER_BAR) {
      seen.add(population[index]);
    }
    assert.deepEqual([...seen].sort(), allowed[gene], `gene ${gene}`);
  }
});

test("the JSDoc examples of allowedGenes and randomPopulation hold", () => {
  const allowed = { p2: ["third", "hold"], tr: ["root"], no: ["fill"], p1_octave: [0] };
  assert.deepEqual(allowedGenes(allowed), [[0, 4], [0], [4], [0]]);
  const noArp32 = randomPopulation(createRandom(1), 3, 2, NO_ARP32);
  assert.equal(noArp32.length, 24);
  assert.equal(noArp32.some((gene, i) => i % 4 === P2 && gene === 2), false);
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
