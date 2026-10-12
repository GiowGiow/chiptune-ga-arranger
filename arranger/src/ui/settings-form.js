// @ts-check
/**
 * Settings form helpers: text fields to settings, and settings files in and out.
 *
 * The settings panel shows every hyperparameter as a text field. These pure functions turn the
 * fields into a Settings object, read a downloaded `config.json` back (the run record the app or
 * the command line wrote), write one, and list which settings differ from the defaults, for the
 * run list's chips. Importing follows the command line's rules (`src/config.py`): run keys are
 * skipped, `role_map` takes any part label, and any other unknown key is refused, so a typo is
 * caught instead of silently ignored.
 *
 * The values each gene may take (`allowed`, spec 003) are checkboxes instead: the ticked boxes
 * become one list per gene, and a few choices earn a warning, because they quietly disable a
 * fitness criterion or a channel without being errors.
 */

import { NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES } from "../core/genome.js";
import { RUN_RECORD_KEYS } from "../core/settings.js";

/** @typedef {import("../core/settings.js").Settings} Settings */

/** Sections whose keys are free part labels, as in `src/config.py`. */
const FREE_KEY_SECTIONS = ["role_map"];

/** The values of each gene under `allowed`, in gene order. */
const GENE_VALUES = Object.freeze({ p2: P2_TEXTURES, tr: TR_TEXTURES, no: NO_PATTERNS, p1_octave: P1_OCTAVES });

/**
 * Apply text field values (dotted keys) to a copy of `base`.
 *
 * Numbers become numbers; an empty `tempo_bpm` becomes null (no override); text that is not a
 * number is kept, so that validation names the field instead of the form guessing.
 *
 * @param {Record<string, string>} fields for example {"weights.fidelity": "0"}
 * @param {Settings} base
 * @returns {Settings}
 * @example
 * formToSettings({"weights.fidelity": "0"}, defaults).weights.fidelity // 0
 */
export function formToSettings(fields, base) {
  const settings = structuredClone(base);
  for (const [key, text] of Object.entries(fields)) {
    const trimmed = text.trim();
    /** @type {unknown} */
    let value = trimmed;
    if (trimmed === "" && key === "tempo_bpm") value = null;
    else if (trimmed !== "" && Number.isFinite(Number(trimmed))) value = Number(trimmed);
    setDotted(settings, key, value);
  }
  return settings;
}

/**
 * Read a settings file (a `config.json` run record or an exported settings file).
 *
 * @param {string} text the file's text
 * @param {Settings} defaults the settings that keys missing from the file keep
 * @returns {Settings}
 * @throws {Error} for a file that is not JSON or holds an unknown key
 * @example
 * importConfig('{"seed": 3, "population_size": 40}', defaults).population_size // 40
 */
export function importConfig(text, defaults) {
  /** @type {Record<string, any>} */
  let loaded;
  try {
    loaded = JSON.parse(text);
  } catch {
    throw new Error("the file is not a JSON settings file");
  }
  if (loaded === null || typeof loaded !== "object" || Array.isArray(loaded)) {
    throw new Error("the file is not a JSON settings file");
  }
  const settings = structuredClone(defaults);
  for (const [key, value] of Object.entries(loaded)) {
    if (key === "seed") settings.seed = value;
    else if (!RUN_RECORD_KEYS.includes(key)) merge(settings, key, value, "");
  }
  return settings;
}

/**
 * Write settings as a file that both the app and the command line (`--config`) read back.
 *
 * @param {Settings} settings
 * @returns {string} pretty JSON ending with a newline
 * @example
 * JSON.parse(exportConfig(defaults)).seed // 1
 */
export function exportConfig(settings) {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * The value of a setting named by its dotted key, as the form and the run list name it.
 *
 * @param {Settings} settings
 * @param {string} key for example "weights.fidelity"
 * @returns {unknown} undefined when no setting has that key
 * @example
 * valueAt(defaults, "weights.fidelity") // 0.5
 */
export function valueAt(settings, key) {
  return key.split(".").reduce((node, part) => node?.[part], /** @type {any} */ (settings));
}

/**
 * Each fitness weight as a share of the sum of the weights.
 *
 * The fitness is the weighted mean of the criterion scores, so a weight acts only relative to
 * the others: with six weights at 1 and fidelity at 0.5, fidelity counts for 0.5 / 6.5 of the
 * fitness. A criterion that does not apply to a song drops out and the others' shares grow.
 *
 * @param {Record<string, number>} weights
 * @returns {Record<string, number>} shares from 0 to 1 that sum to 1, or all 0
 * @example
 * weightShares({register: 1, fidelity: 1}) // {register: 0.5, fidelity: 0.5}
 */
export function weightShares(weights) {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(
    Object.entries(weights).map(([name, weight]) => [name, total > 0 ? weight / total : 0]),
  );
}

/**
 * The allowed values of each gene from the ticked checkboxes of the "Allowed textures" group.
 *
 * Each list keeps the gene order, whatever order the boxes were ticked in, so ticking every box
 * back gives exactly the default lists and the setting no longer shows as changed. A checkbox
 * value is text, so the octaves are matched by their text and come back as numbers.
 *
 * @param {Record<string, string[]>} ticked the ticked values of each gene, as checkbox text
 * @returns {Settings["allowed"]} one list per gene; empty for a gene with no box ticked
 * @example
 * allowedFromForm({p2: ["third", "hold"], tr: ["root"], no: ["none"], p1_octave: ["-12", "0"]})
 * // {p2: ["hold", "third"], tr: ["root"], no: ["none"], p1_octave: [0, -12]}
 */
export function allowedFromForm(ticked) {
  return /** @type {Settings["allowed"]} */ (
    Object.fromEntries(
      Object.entries(GENE_VALUES).map(([gene, values]) => [
        gene,
        values.filter((value) => (ticked[gene] ?? []).includes(String(value))),
      ]),
    )
  );
}

/**
 * Warnings for allowed lists that are valid but switch something off (contracts/config.md).
 *
 * The idiom criterion rewards arpeggios on single-chord bars, the fidelity criterion rewards the
 * written octave, and the drum pattern "none" is silence: without those values, the criterion
 * or the channel has nothing left to do. The warnings follow the channel order.
 *
 * @param {Partial<Settings["allowed"]>} allowed
 * @returns {string[]} the warnings to show under the group; empty when nothing is switched off
 * @example
 * allowedWarnings({...defaults.allowed, no: ["none"]}) // ["The noise channel stays silent."]
 */
export function allowedWarnings(allowed) {
  const listed = (/** @type {unknown} */ values) => (Array.isArray(values) ? values : []);
  const p2 = listed(allowed.p2);
  const no = listed(allowed.no);
  /** @type {string[]} */
  const warnings = [];
  if (!p2.includes("arp16") && !p2.includes("arp32")) {
    warnings.push("Without arpeggios, the idiom criterion can no longer reward single-chord bars.");
  }
  if (no.length === 1 && no[0] === "none") warnings.push("The noise channel stays silent.");
  if (!listed(allowed.p1_octave).includes(0)) {
    warnings.push("Without the written octave, the fidelity criterion scores 0 in every bar.");
  }
  return warnings;
}

/**
 * The dotted keys whose value differs from the defaults, sorted, without the seed.
 *
 * @param {Settings} settings
 * @param {Settings} defaults
 * @returns {string[]}
 * @example
 * changedSettings({...defaults, max_generations: 4000}, defaults) // ["max_generations"]
 */
export function changedSettings(settings, defaults) {
  /** @type {string[]} */
  const changed = [];
  const walk = (/** @type {any} */ value, /** @type {any} */ base, /** @type {string} */ prefix) => {
    const isObject = (/** @type {any} */ item) =>
      item !== null && typeof item === "object" && !Array.isArray(item);
    if (isObject(value) && isObject(base) && !FREE_KEY_SECTIONS.includes(prefix)) {
      for (const key of new Set([...Object.keys(value), ...Object.keys(base)])) {
        if (prefix === "" && key === "seed") continue;
        walk(value[key], base[key], prefix ? `${prefix}.${key}` : key);
      }
    } else if (JSON.stringify(value) !== JSON.stringify(base)) {
      changed.push(prefix);
    }
  };
  walk(settings, defaults, "");
  return changed.sort();
}

/**
 * @param {Record<string, any>} target
 * @param {string} key
 * @param {unknown} value
 * @param {string} prefix
 */
function merge(target, key, value, prefix) {
  const dotted = `${prefix}${key}`;
  const section = prefix.replace(/\.$/, "");
  if (value !== null && typeof value === "object" && !Array.isArray(value) &&
      target[key] !== null && typeof target[key] === "object" && !Array.isArray(target[key])) {
    if (FREE_KEY_SECTIONS.includes(key) && prefix === "") {
      target[key] = { ...target[key], ...structuredClone(value) };
      return;
    }
    for (const [inner, innerValue] of Object.entries(value)) {
      merge(target[key], inner, innerValue, `${dotted}.`);
    }
  } else if (key in target || FREE_KEY_SECTIONS.includes(section)) {
    target[key] = structuredClone(value);
  } else {
    throw new Error(`unknown configuration key '${dotted}'`);
  }
}

/**
 * @param {Record<string, any>} target
 * @param {string} dottedKey
 * @param {unknown} value
 */
function setDotted(target, dottedKey, value) {
  const parts = dottedKey.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[/** @type {string} */ (parts.at(-1))] = value;
}
