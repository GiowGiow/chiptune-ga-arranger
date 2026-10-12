// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  RUN_RECORD_KEYS,
  canonicalJson,
  configRecord,
  defaultSettings,
  runId,
  settingsHash,
  validateSettings,
} from "../src/core/settings.js";
import { repoRoot } from "./helpers.js";

const defaultConfig = JSON.parse(readFileSync(join(repoRoot, "configs/default.json"), "utf8"));

test("the defaults are configs/default.json with the seed set to 1", () => {
  const settings = defaultSettings(defaultConfig);
  assert.equal(settings.seed, 1);
  assert.equal(settings.population_size, defaultConfig.population_size);
  assert.deepEqual(settings.weights, defaultConfig.weights);
  settings.weights.fidelity = 9;
  assert.equal(defaultConfig.weights.fidelity, 0.5, "the defaults are copied, not shared");
});

test("valid default settings give no message", () => {
  assert.deepEqual(validateSettings(defaultSettings(defaultConfig)), []);
});

test("each invalid setting gives one message that names the field and its range", () => {
  const cases = [
    [{ population_size: 1 }, "population_size", "at least 2"],
    [{ population_size: 10.5 }, "population_size", "whole number"],
    [{ elite_count: 60 }, "elite_count", "from 0 to 59"],
    [{ mutation_rate: 1.5 }, "mutation_rate", "from 0 to 1"],
    [{ max_generations: 0 }, "max_generations", "at least 1"],
    [{ stagnation_window: 0 }, "stagnation_window", "at least 1"],
    [{ phrase_length: 0 }, "phrase_length", "at least 1"],
    [{ tempo_bpm: 10 }, "tempo_bpm", "empty, or from 20 to 400"],
    [{ seed: -1 }, "seed", "from 0 to 4,294,967,295"],
    [{ seed: 2 ** 32 }, "seed", "from 0 to 4,294,967,295"],
  ];
  for (const [change, field, range] of cases) {
    const settings = { ...defaultSettings(defaultConfig), ...change };
    const messages = validateSettings(settings);
    assert.equal(messages.length, 1, `${field}: ${JSON.stringify(messages)}`);
    assert.equal(messages[0].field, field);
    assert.match(messages[0].message, new RegExp(range.replace(/[()]/g, "\\$&")));
  }
});

test("weights must be finite and at least 0, and not all 0", () => {
  const negative = defaultSettings(defaultConfig);
  negative.weights.contrast = -1;
  assert.deepEqual(
    validateSettings(negative).map((m) => m.field),
    ["weights.contrast"],
  );
  const zero = defaultSettings(defaultConfig);
  for (const name of Object.keys(zero.weights)) zero.weights[name] = 0;
  const messages = validateSettings(zero);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].field, "weights");
  assert.match(messages[0].message, /not all be 0/);
});

test("canonical JSON sorts keys at every level", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }),
    '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
});

test("the settings hash ignores key order and the seed, and follows every other value", async () => {
  const settings = defaultSettings(defaultConfig);
  const reordered = Object.fromEntries(Object.entries(settings).reverse());
  assert.equal(await settingsHash(settings), await settingsHash(reordered));
  assert.equal(await settingsHash(settings), await settingsHash({ ...settings, seed: 9 }));
  assert.notEqual(await settingsHash(settings), await settingsHash({ ...settings, elite_count: 3 }));
  assert.match(await settingsHash(settings), /^[0-9a-f]{8}$/);
});

test("a run id is the input stem, the seed and the settings hash", async () => {
  const settings = defaultSettings(defaultConfig);
  const id = await runId("mulher-de-fases.mid", settings);
  assert.match(id, /^mulher-de-fases-s1-[0-9a-f]{8}$/);
  assert.match(await runId("dir/My Song?.abc", { ...settings, seed: 12 }), /^My Song--s12-/);
});

test("the config record holds the CLI keys, then the run keys, in the CLI's order", () => {
  const settings = defaultSettings(defaultConfig);
  const record = configRecord({
    settings,
    inputName: "korobeiniki.abc",
    inputSha256: "ab".repeat(32),
    commit: "dev",
    created: "2026-10-12T15:04:05Z",
    runId: "korobeiniki-s1-12345678",
    bestFitness: 0.92,
    stopReason: "stagnation",
    generations: 1886,
    app: { name: "chiptune-ga-arranger web", pace: "watch" },
  });
  const configKeys = Object.keys(defaultConfig);
  assert.deepEqual(Object.keys(record), [...configKeys, ...RUN_RECORD_KEYS]);
  assert.equal(record.seed, 1);
  assert.equal(record.git_commit, "dev");
  assert.equal(record.git_dirty, null);
  assert.equal(record.audio, false);
  assert.deepEqual(record.weights, defaultConfig.weights);
});
