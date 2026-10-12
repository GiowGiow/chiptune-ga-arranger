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
import { importConfig } from "../src/ui/settings-form.js";
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

// Allowed values (spec 003, contracts/config.md)

const EVERY_VALUE = {
  p2: ["hold", "arp16", "arp32", "echo", "third"],
  tr: ["root", "octave_pump", "root_fifth", "walking"],
  no: ["none", "half_time", "eighth_beat", "sixteenth_beat", "fill"],
  p1_octave: [0, 12, -12],
};

/** A run record of the default settings with `allowed` replaced by the given lists. */
function recordWith(/** @type {Record<string, unknown> | undefined} */ allowed) {
  const settings = defaultSettings(defaultConfig);
  if (allowed === undefined) delete settings.allowed;
  else settings.allowed = allowed;
  return configRecord({
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
}

test("the default settings allow every value of every gene", () => {
  const settings = defaultSettings(defaultConfig);
  assert.deepEqual(settings.allowed, EVERY_VALUE);
  assert.deepEqual(settings.allowed, defaultConfig.allowed);
});

test("an allowed list in any order, with some values left out, is valid", () => {
  const settings = defaultSettings(defaultConfig);
  settings.allowed.p2 = ["third", "hold"];
  settings.allowed.p1_octave = [-12, 0];
  assert.deepEqual(validateSettings(settings), []);
});

test("each invalid allowed list gives the command line's message, named allowed.<gene>", () => {
  const p2Values = "hold, arp16, arp32, echo, third";
  /** @type {[string, unknown, string][]} */
  const cases = [
    ["p2", "hold", "allowed.p2 must be a list of P2 textures"],
    ["tr", null, "allowed.tr must be a list of TR textures"],
    ["no", { none: true }, "allowed.no must be a list of NO patterns"],
    ["p1_octave", 0, "allowed.p1_octave must be a list of P1 octaves"],
    ["no", [], "allowed.no must keep at least one value"],
    ["p2", ["hold", "arp64"], `allowed.p2: unknown value "arp64"; valid values: ${p2Values}`],
    ["p1_octave", [0, 24], 'allowed.p1_octave: unknown value "24"; valid values: 0, 12, -12'],
    ["p1_octave", ["12"], 'allowed.p1_octave: unknown value "12"; valid values: 0, 12, -12'],
    ["tr", ["walking", "root", "walking"], 'allowed.tr: "walking" is listed twice'],
  ];
  for (const [gene, value, message] of cases) {
    const settings = defaultSettings(defaultConfig);
    settings.allowed[gene] = value;
    assert.deepEqual(validateSettings(settings), [{ field: `allowed.${gene}`, message }]);
  }
});

test("allowed lists report their first problem, as the command line does", () => {
  const settings = defaultSettings(defaultConfig);
  settings.allowed.p2 = ["arp64", "hold", "hold"];
  settings.allowed.tr = ["root", "root", "bass"];
  assert.deepEqual(validateSettings(settings).map((m) => m.message), [
    'allowed.p2: unknown value "arp64"; valid values: hold, arp16, arp32, echo, third',
    'allowed.tr: "root" is listed twice',
  ]);
});

test("every gene with an invalid allowed list gets its own message", () => {
  const settings = defaultSettings(defaultConfig);
  settings.allowed.p2 = [];
  settings.allowed.no = [];
  assert.deepEqual(validateSettings(settings).map((m) => m.field), ["allowed.p2", "allowed.no"]);
});

test("the config record carries the allowed values of the run", () => {
  const allowed = { ...EVERY_VALUE, p2: ["hold", "arp16", "echo", "third"] };
  assert.deepEqual(recordWith(allowed).allowed, allowed);
});

test("importing a config record restores its allowed values", () => {
  const allowed = { ...EVERY_VALUE, p2: ["hold", "arp16", "echo", "third"], p1_octave: [0] };
  const imported = importConfig(JSON.stringify(recordWith(allowed)), defaultSettings(defaultConfig));
  assert.deepEqual(imported.allowed, allowed);
});

test("importing a record without allowed (made before the setting) allows every value", () => {
  const record = recordWith(undefined);
  assert.equal("allowed" in record, false);
  const imported = importConfig(JSON.stringify(record), defaultSettings(defaultConfig));
  assert.deepEqual(imported.allowed, EVERY_VALUE);
});

test("importing some allowed genes keeps the others at their defaults", () => {
  const text = JSON.stringify({ allowed: { p2: ["hold", "arp16"] } });
  const imported = importConfig(text, defaultSettings(defaultConfig));
  assert.deepEqual(imported.allowed, { ...EVERY_VALUE, p2: ["hold", "arp16"] });
  assert.throws(
    () => importConfig(JSON.stringify({ allowed: { drums: ["none"] } }), defaultSettings(defaultConfig)),
    { message: "unknown configuration key 'allowed.drums'" },
  );
});
