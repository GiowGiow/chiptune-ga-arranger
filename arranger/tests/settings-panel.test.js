// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { defaultSettings } from "../src/core/settings.js";
import { FIELDS, defaultNote, settingLabel } from "../src/ui/settings-panel.js";
import { repoRoot } from "./helpers.js";

const defaults = defaultSettings(
  JSON.parse(readFileSync(join(repoRoot, "configs/default.json"), "utf8")),
);

test("a setting has one name: the run card and the run list use the form's label", () => {
  assert.equal(settingLabel("max_generations"), "Max generations");
  assert.equal(settingLabel("stagnation_window"), "Stagnation window");
  // Out of its "Fitness weights" group, a weight says that it is a weight, not a score.
  assert.equal(settingLabel("weights.fidelity"), "Fidelity weight");
  assert.equal(settingLabel("role_map"), "role_map", "a key the form does not show keeps its name");
});

test("every field of the form has a label for the run card", () => {
  for (const { fields } of FIELDS) {
    for (const [key, label] of fields) assert.ok(settingLabel(key).startsWith(label));
  }
});

test("a changed setting names its default, and the tempo's default is the file's tempo", () => {
  assert.equal(defaultNote("max_generations", defaults), `default ${defaults.max_generations}`);
  assert.equal(defaultNote("weights.fidelity", defaults), `default ${defaults.weights.fidelity}`);
  assert.equal(defaultNote("tempo_bpm", defaults), "default: the file's tempo");
});
