// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { defaultSettings, validateSettings } from "../src/core/settings.js";
import {
  allowedFromForm,
  allowedWarnings,
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

// --- Allowed textures (spec 003, User Story 3) ------------------------------------------------

/** Every value of every gene ticked, as checkbox text: the form at the defaults. */
const allTicked = () =>
  Object.fromEntries(
    Object.entries(defaults.allowed).map(([gene, values]) => [gene, values.map(String)]),
  );

const IDIOM_WARNING = "Without arpeggios, the idiom criterion can no longer reward single-chord bars.";
const FIDELITY_WARNING = "Without the written octave, the fidelity criterion scores 0 in every bar.";
const SILENT_WARNING = "The noise channel stays silent.";

test("unticking a texture keeps the other values of its gene, in gene order", () => {
  const ticked = allTicked();
  ticked.p2 = ticked.p2.filter((value) => value !== "arp32");
  const allowed = allowedFromForm(ticked);
  assert.deepEqual(allowed.p2, ["hold", "arp16", "echo", "third"]);
  assert.deepEqual(allowed.tr, defaults.allowed.tr, "the other genes keep every value");
  // The list follows the gene order, whatever order the boxes were ticked in.
  assert.deepEqual(allowedFromForm({ ...allTicked(), p2: ["third", "hold", "arp32"] }).p2, ["hold", "arp32", "third"]);
});

test("ticking every box back restores the default lists, with the octaves as numbers", () => {
  assert.deepEqual(allowedFromForm(allTicked()), defaults.allowed);
  assert.deepEqual(allowedFromForm({ ...allTicked(), p1_octave: ["-12", "0"] }).p1_octave, [0, -12]);
});

test("a gene with every box unticked gets an empty list, which validation refuses", () => {
  const allowed = allowedFromForm({ ...allTicked(), p2: [] });
  assert.deepEqual(allowed.p2, []);
  const messages = validateSettings({ ...structuredClone(defaults), allowed });
  assert.deepEqual(messages, [{ field: "allowed.p2", message: "allowed.p2 must keep at least one value" }]);
});

test("the default textures raise no warning", () => {
  assert.deepEqual(allowedWarnings(defaults.allowed), []);
});

test("without either arpeggio, the idiom warning appears, and goes when one comes back", () => {
  const withoutArpeggios = { ...defaults.allowed, p2: ["hold", "echo", "third"] };
  assert.deepEqual(allowedWarnings(withoutArpeggios), [IDIOM_WARNING]);
  assert.deepEqual(allowedWarnings({ ...withoutArpeggios, p2: ["hold", "arp32"] }), []);
  assert.deepEqual(allowedWarnings({ ...withoutArpeggios, p2: ["arp16"] }), []);
});

test("without the written octave, the fidelity warning appears, and goes when it comes back", () => {
  assert.deepEqual(allowedWarnings({ ...defaults.allowed, p1_octave: [12, -12] }), [FIDELITY_WARNING]);
  assert.deepEqual(allowedWarnings({ ...defaults.allowed, p1_octave: [12, 0] }), []);
});

test("drums limited to none warn that the noise channel stays silent", () => {
  assert.deepEqual(allowedWarnings({ ...defaults.allowed, no: ["none"] }), [SILENT_WARNING]);
  assert.deepEqual(allowedWarnings({ ...defaults.allowed, no: ["none", "fill"] }), []);
  assert.deepEqual(allowedWarnings({ ...defaults.allowed, no: ["fill"] }), [], "a single pattern still plays");
});

test("the warnings follow the order of the channels and can all show at once", () => {
  const allowed = { p2: ["hold"], tr: ["root"], no: ["none"], p1_octave: [12] };
  assert.deepEqual(allowedWarnings(allowed), [IDIOM_WARNING, SILENT_WARNING, FIDELITY_WARNING]);
});

test("a changed allowed list is a changed setting, named by its gene", () => {
  const settings = structuredClone(defaults);
  settings.allowed.p2 = ["hold", "arp16", "echo", "third"];
  settings.allowed.p1_octave = [0];
  assert.deepEqual(changedSettings(settings, defaults), ["allowed.p1_octave", "allowed.p2"]);
  settings.allowed = allowedFromForm(allTicked());
  assert.deepEqual(changedSettings(settings, defaults), [], "ticking every box back is the default again");
});

test("a config.json with allowed lists restores them, and the genes it omits keep their default", () => {
  const settings = importConfig('{"allowed": {"p2": ["hold", "arp16"], "p1_octave": [0]}}', defaults);
  assert.deepEqual(settings.allowed.p2, ["hold", "arp16"]);
  assert.deepEqual(settings.allowed.p1_octave, [0]);
  assert.deepEqual(settings.allowed.tr, defaults.allowed.tr);
  assert.throws(() => importConfig('{"allowed": {"p3": ["hold"]}}', defaults), /unknown configuration key 'allowed.p3'/);
});
