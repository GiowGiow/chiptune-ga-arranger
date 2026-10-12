// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES } from "../src/core/genome.js";
import { defaultSettings } from "../src/core/settings.js";
import { ALLOWED_GROUPS, FIELDS, allowedGroupHtml, defaultNote, settingLabel } from "../src/ui/settings-panel.js";
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

// --- Allowed textures (spec 003, User Story 3) ------------------------------------------------

/**
 * The readable label and the tooltip of each value of one gene.
 *
 * @param {string} gene
 * @returns {Map<string | number, {label: string, tip: string}>}
 */
function valuesOf(gene) {
  const group = ALLOWED_GROUPS.find((entry) => entry.gene === gene);
  assert.ok(group, `no group for ${gene}`);
  return new Map(group.values.map(([value, label, tip]) => [value, { label, tip }]));
}

/**
 * The group's HTML cut into one piece per value: each starts at a value's wrapper.
 *
 * The tests run without a browser, so they read the markup the panel inserts.
 *
 * @returns {string[]}
 */
function valueBlocks() {
  return allowedGroupHtml().split('<div class="allowed-value has-tip"').slice(1);
}

test("the Allowed textures group offers every value of the four genes, one channel per fieldset", () => {
  assert.deepEqual(
    ALLOWED_GROUPS.map(({ gene, legend }) => [gene, legend]),
    [["p2", "P2 harmony"], ["tr", "TR bass"], ["no", "NO drums"], ["p1_octave", "P1 melody octave"]],
  );
  assert.deepEqual(
    ALLOWED_GROUPS.map(({ values }) => values.map(([value]) => value)),
    [P2_TEXTURES, TR_TEXTURES, NO_PATTERNS, P1_OCTAVES].map((values) => [...values]),
    "the boxes follow the gene order",
  );
  const html = allowedGroupHtml();
  assert.match(html, /<legend>Allowed textures<\/legend>/);
  // Each channel's legend may open with its color dot, as in the plan grid.
  for (const { legend } of ALLOWED_GROUPS) assert.ok(html.includes(`${legend}</legend>`), legend);
  assert.equal(html.match(/<fieldset class="allowed-gene"/g)?.length, 4, "one fieldset per channel");
});

test("the group has 17 checkboxes, each with a readable label and an (i) tooltip", () => {
  const blocks = valueBlocks();
  assert.equal(blocks.length, 17);
  assert.equal(allowedGroupHtml().match(/type="checkbox"/g)?.length, 17);
  const values = ALLOWED_GROUPS.flatMap(({ gene, values }) => values.map(([value, label, tip]) => ({ gene, value, label, tip })));
  values.forEach(({ gene, value, label, tip }, index) => {
    const block = blocks[index];
    assert.equal(block.match(/type="checkbox"/g)?.length, 1, `${gene} ${value}`);
    assert.ok(block.includes(`data-allowed="${gene}" value="${value}"`), `${gene} ${value} box`);
    assert.ok(block.includes(label), `${gene} ${value} label`);
    assert.ok(block.includes('<span class="tip-mark" aria-hidden="true">i</span>'), `${gene} ${value} (i) mark`);
    const tipId = block.match(/<p class="tip" id="([^"]+)" role="tooltip">/)?.[1];
    assert.ok(tipId, `${gene} ${value} tooltip`);
    assert.ok(block.includes(`${tip}</p>`), `${gene} ${value} tooltip text`);
    assert.match(block, new RegExp(`aria-describedby="${tipId} `), "the box is described by its tooltip");
  });
  assert.equal(new Set(values.map(({ label }) => label)).size, 17, "no two values share a label");
  assert.equal(new Set(values.map(({ tip }) => tip)).size, 17, "no two values share a tooltip");
});

test("the arpeggios name their note values, and the fast one says 32nd notes in its tooltip", () => {
  const p2 = valuesOf("p2");
  assert.equal(p2.get("arp16")?.label, "arpeggio (16th notes)");
  assert.match(p2.get("arp16")?.tip ?? "", /one per 16th note/);
  assert.equal(p2.get("arp32")?.label, "fast arpeggio (32nd notes)");
  assert.match(p2.get("arp32")?.tip ?? "", /^Cycles the chord tones one per 32nd note/);
});

test("every tooltip says what its value plays, as the realizers do", () => {
  const p2 = valuesOf("p2");
  assert.match(p2.get("hold")?.tip ?? "", /chord root.*sustained|sustain.*chord root/i);
  assert.match(p2.get("echo")?.tip ?? "", /melody.*one eighth note later.*softer/i);
  assert.match(p2.get("third")?.tip ?? "", /chord tone under each melody note/i);
  const tr = valuesOf("tr");
  assert.match(tr.get("root")?.tip ?? "", /root/);
  assert.match(tr.get("octave_pump")?.tip ?? "", /eighth notes.*root.*octave up/i);
  assert.match(tr.get("root_fifth")?.tip ?? "", /root on strong beats.*fifth on weak beats/i);
  assert.match(tr.get("walking")?.tip ?? "", /root, third, fifth.*next bar/i);
  const no = valuesOf("no");
  assert.match(no.get("none")?.tip ?? "", /no drums/i);
  assert.match(no.get("half_time")?.tip ?? "", /kick on beat 1.*snare/i);
  assert.match(no.get("eighth_beat")?.tip ?? "", /hi-hat on the eighth notes/i);
  assert.match(no.get("sixteenth_beat")?.tip ?? "", /hi-hat on every 16th note/i);
  assert.match(no.get("fill")?.tip ?? "", /snare roll.*next bar/i);
  const octave = valuesOf("p1_octave");
  assert.deepEqual([...octave.values()].map(({ label }) => label), ["as written", "octave up", "octave down"]);
  assert.match(octave.get(0)?.tip ?? "", /written octave/);
  assert.match(octave.get(12)?.tip ?? "", /one octave higher/);
  assert.match(octave.get(-12)?.tip ?? "", /one octave lower/);
  for (const { values } of ALLOWED_GROUPS) {
    for (const [value, , tip] of values) assert.match(tip, /^[A-Z].*\.$/, `${value}: one or two full sentences`);
  }
});

test("each channel row shows its validation message and its changed mark, like any other setting", () => {
  const html = allowedGroupHtml();
  for (const { gene } of ALLOWED_GROUPS) {
    // showErrors finds the message slot by "error-<field>"; showChanges marks "[data-setting]" rows.
    assert.ok(html.includes(`data-setting="allowed.${gene}"`), `${gene} row`);
    assert.ok(html.includes(`id="error-allowed.${gene}"`), `${gene} error slot`);
  }
  assert.equal(html.match(/<span data-default><\/span>/g)?.length, 4, "one default note per channel");
  assert.match(html, /data-allowed-warnings/, "the warnings sit under the group");
});

test("a changed channel names its default, and the run card names the channel", () => {
  assert.equal(defaultNote("allowed.p2", defaults), "default: all allowed");
  assert.equal(defaultNote("allowed.p1_octave", defaults), "default: all allowed");
  const narrower = structuredClone(defaults);
  narrower.allowed.p2 = ["hold", "arp16"];
  narrower.allowed.p1_octave = [0];
  assert.equal(defaultNote("allowed.p2", narrower), "default hold, arpeggio (16th notes)");
  assert.equal(defaultNote("allowed.p1_octave", narrower), "default as written");
  assert.equal(settingLabel("allowed.p2"), "Allowed P2 harmony");
  assert.equal(settingLabel("allowed.tr"), "Allowed TR bass");
  assert.equal(settingLabel("allowed.no"), "Allowed NO drums");
  assert.equal(settingLabel("allowed.p1_octave"), "Allowed P1 melody octave");
});
