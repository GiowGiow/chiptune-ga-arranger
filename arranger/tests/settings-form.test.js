// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { defaultSettings } from "../src/core/settings.js";
import {
  changedSettings,
  exportConfig,
  formToSettings,
  importConfig,
  valueAt,
  weightShares,
} from "../src/ui/settings-form.js";
import { repoRoot } from "./helpers.js";

const defaultConfig = JSON.parse(readFileSync(join(repoRoot, "configs/default.json"), "utf8"));
const defaults = defaultSettings(defaultConfig);

test("form text becomes numbers, and an empty tempo becomes null", () => {
  const settings = formToSettings(
    { seed: "7", population_size: "80", mutation_rate: "0.02", tempo_bpm: "", "weights.fidelity": "0" },
    defaults,
  );
  assert.equal(settings.seed, 7);
  assert.equal(settings.population_size, 80);
  assert.equal(settings.mutation_rate, 0.02);
  assert.equal(settings.tempo_bpm, null);
  assert.equal(settings.weights.fidelity, 0);
  assert.equal(settings.weights.contrast, defaults.weights.contrast, "untouched fields stay");
  assert.equal(defaults.weights.fidelity, 0.5, "the base is not changed");
});

test("text that is not a number stays text, so validation can name the field", () => {
  const settings = formToSettings({ population_size: "many" }, defaults);
  assert.equal(settings.population_size, "many");
});

test("a downloaded config.json restores every setting and the seed, ignoring the run keys", () => {
  const record = {
    ...structuredClone(defaultConfig),
    population_size: 40,
    weights: { ...defaultConfig.weights, contrast: 3 },
    role_map: { Intro: "verse" },
    seed: 12,
    input_path: "song.mid",
    input_sha256: "ab".repeat(32),
    git_commit: "dev",
    git_dirty: null,
    created: "2026-10-12T15:04:05Z",
    run_id: "song-s12-12345678",
    best_fitness: 0.9,
    stop_reason: "stagnation",
    generations: 100,
    audio: false,
    app: { pace: "watch" },
  };
  const settings = importConfig(JSON.stringify(record), defaults);
  assert.equal(settings.seed, 12);
  assert.equal(settings.population_size, 40);
  assert.equal(settings.weights.contrast, 3);
  assert.deepEqual(settings.role_map, { Intro: "verse" });
  assert.ok(!("input_path" in settings) && !("app" in settings));
});

test("a config with an unknown key is refused like the command line does", () => {
  assert.throws(
    () => importConfig('{"populaton_size": 3}', defaults),
    /unknown configuration key 'populaton_size'/,
  );
  assert.throws(
    () => importConfig('{"weights": {"loudness": 1}}', defaults),
    /unknown configuration key 'weights.loudness'/,
  );
  assert.throws(() => importConfig("not json", defaults), /not a JSON settings file/);
});

test("an exported config loads back to the same settings", () => {
  const settings = { ...structuredClone(defaults), seed: 5, elite_count: 4 };
  assert.deepEqual(importConfig(exportConfig(settings), defaults), settings);
  assert.ok(exportConfig(settings).endsWith("\n"));
});

test("changed settings are the dotted keys that differ from the defaults, without the seed", () => {
  const settings = structuredClone(defaults);
  settings.seed = 9;
  settings.weights.fidelity = 0;
  settings.max_generations = 4000;
  assert.deepEqual(changedSettings(settings, defaults), ["max_generations", "weights.fidelity"]);
  assert.deepEqual(changedSettings(defaults, defaults), []);
});

test("a dotted key reads a setting inside a section", () => {
  assert.equal(valueAt(defaults, "weights.fidelity"), defaults.weights.fidelity);
  assert.equal(valueAt(defaults, "max_generations"), defaults.max_generations);
  assert.equal(valueAt(defaults, "weights.loudness"), undefined);
});

test("a weight's share of the fitness is the weight over the sum of all weights", () => {
  const weights = { ...defaults.weights, fidelity: 0.5, contrast: 1, register: 1 };
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const shares = weightShares(weights);
  assert.equal(shares.fidelity, 0.5 / total);
  assert.equal(shares.register, 1 / total);
  assert.ok(Math.abs(Object.values(shares).reduce((sum, share) => sum + share, 0) - 1) < 1e-12);
});

test("weights that sum to zero give every criterion a share of zero", () => {
  const weights = Object.fromEntries(Object.keys(defaults.weights).map((name) => [name, 0]));
  assert.ok(Object.values(weightShares(weights)).every((share) => share === 0));
});
