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
 */

import { RUN_RECORD_KEYS } from "../core/settings.js";

/** @typedef {import("../core/settings.js").Settings} Settings */

/** Sections whose keys are free part labels, as in `src/config.py`. */
const FREE_KEY_SECTIONS = ["role_map"];

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
