// @ts-check
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { TRADITIONAL_EXAMPLES, buildExamples } from "../src/ui/examples.js";
import { repoRoot } from "./helpers.js";

const sources = JSON.parse(readFileSync(join(repoRoot, "data/sources.json"), "utf8"));
const appDir = join(repoRoot, "arranger");

test("the examples are the 8 committed lead sheets, traditional tunes first", () => {
  const examples = buildExamples(sources);
  assert.equal(examples.length, 8);
  assert.deepEqual(
    examples.slice(0, 2).map((example) => example.id),
    TRADITIONAL_EXAMPLES.map((example) => example.id),
  );
  const mulher = examples.find((example) => example.id === "mulher_de_fases");
  assert.deepEqual(
    { title: mulher?.title, artist: mulher?.artist },
    { title: "Mulher de Fases", artist: "Raimundos" },
  );
  assert.equal(examples[0].artist, "Traditional (Russia)");
});

test("every example path, read from the app folder, is a committed lead sheet", () => {
  for (const example of buildExamples(sources)) {
    assert.ok(example.path.startsWith("../data/leadsheets/"), example.path);
    assert.ok(existsSync(resolve(appDir, example.path)), example.path);
  }
});

test("MIDI-song examples carry the README's longer stopping limits; traditional tunes none", () => {
  for (const example of buildExamples(sources)) {
    const expected = TRADITIONAL_EXAMPLES.some((tune) => tune.id === example.id)
      ? {}
      : { max_generations: 4000, stagnation_window: 400 };
    assert.deepEqual(example.overrides, expected, example.id);
  }
});
