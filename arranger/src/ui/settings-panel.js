// @ts-check
/**
 * Settings panel: every hyperparameter of the GA, with what it changes in the music.
 *
 * The fields are the command line's configuration (spec 002, FR-008), with its defaults (FR-009)
 * and its valid ranges (FR-010). Each field carries one or two sentences from the README's table
 * "Hyperparameters and what the samples change" and from the fitness criteria of
 * `src/ga/fitness.py`, so a visitor knows what to expect before changing a value (FR-011).
 * Settings can be exported as a file that the command line reads with `--config`, and a
 * downloaded `config.json` can be loaded back (FR-012).
 *
 * The panel is a drawer that slides in over the right side of the page without moving it, so the
 * evolution and the result keep their place while the values change. A setting that differs from
 * its default is the one bold name, with the default below it, so the changes stand out from the
 * rest without a color of their own. Each fitness weight shows its share of the fitness, because
 * the fitness is a weighted mean and a weight only acts relative to the others.
 */

import { validateSettings } from "../core/settings.js";
import {
  changedSettings,
  exportConfig,
  formToSettings,
  importConfig,
  valueAt,
  weightShares,
} from "./settings-form.js";

/** @typedef {import("../core/settings.js").Settings} Settings */

/** Field groups: key, label and explanation. */
export const FIELDS = Object.freeze([
  {
    group: "Search",
    fields: [
      ["population_size", "Population", "Plans per generation. More plans explore more choices per generation and take longer."],
      ["max_generations", "Max generations", "Upper limit on the number of generations."],
      ["stagnation_window", "Stagnation window", "Stop after this many generations without a better plan."],
      ["mutation_rate", "Mutation rate", "Chance that each gene of a child changes to another value; 0.01 changes about one gene per child."],
      ["elite_count", "Elite plans", "Best plans copied unchanged into the next generation, so the best fitness never goes down."],
    ],
  },
  {
    group: "Form",
    fields: [
      ["phrase_length", "Phrase length", "Bars per phrase. Coherence keeps choices inside a phrase, and drum fills go at phrase ends."],
      ["tempo_bpm", "Tempo override", "Quarter notes per minute. Empty keeps the tempo of the file."],
    ],
  },
  {
    group: "Fitness weights",
    fields: [
      ["weights.complementarity", "Complementarity", "P2 is calm when the melody is busy, and active when the melody rests or holds."],
      ["weights.register", "Register", "P2 sounds below the melody, so the melody stays on top."],
      ["weights.coherence", "Coherence", "Bars inside a phrase keep the same textures; a drum fill may close the phrase."],
      ["weights.contrast", "Contrast", "The chorus is denser than the verse. Needs parts labeled as verse and chorus."],
      ["weights.bass_smoothness", "Bass smoothness", "The bass line moves by small leaps, inside bars and across bar lines."],
      ["weights.idiom", "NES idiom", "Fast arpeggios on bars with one chord, drum fills exactly at phrase ends."],
      ["weights.fidelity", "Fidelity", "The melody stays at its written octave. At 0 the GA may move it up or down an octave."],
    ],
  },
]);

/** Form labels by dotted key; a weight's label says "weight", since out of its group it could read as a score. */
const LABELS = new Map(
  FIELDS.flatMap(({ fields }) =>
    fields.map(([key, label]) => [key, key.startsWith("weights.") ? `${label} weight` : label]),
  ),
);

/**
 * The name of a setting outside the form (Run card, run list), the same as the form's label.
 *
 * @param {string} key dotted key, for example "max_generations"
 * @returns {string} the label, or the key itself for a setting the form does not show
 * @example
 * settingLabel("max_generations") // "Max generations"
 * settingLabel("weights.fidelity") // "Fidelity weight"
 */
export function settingLabel(key) {
  return LABELS.get(key) ?? key;
}

/**
 * The note under a changed setting that names its default value.
 *
 * @param {string} key dotted key
 * @param {Settings} defaults
 * @returns {string}
 * @example
 * defaultNote("max_generations", defaults) // "default 3000"
 * defaultNote("tempo_bpm", defaults) // "default: the file's tempo"
 */
export function defaultNote(key, defaults) {
  const value = valueAt(defaults, key);
  // Only the tempo override has no default value: without it the song keeps its own tempo.
  return value === null || value === undefined ? "default: the file's tempo" : `default ${value}`;
}

/**
 * Build the panel inside `container`.
 *
 * @param {HTMLElement} container
 * @param {{
 *   defaults: Settings,
 *   onChange: (settings: Settings) => void,
 * }} options
 * @returns {{
 *   show: (settings: Settings, running: boolean) => void,
 *   setFileTempo: (bpm: number | null) => void,
 * }}
 */
export function createSettingsPanel(container, options) {
  const groups = FIELDS.map(
    ({ group, fields }) => `<fieldset class="settings-group"><legend>${group}</legend>${fields
      .map(
        ([key, label, help]) => `<div class="setting has-tip" data-setting="${key}">
          <label for="setting-${key}">${label}<span class="tip-mark" aria-hidden="true">i</span></label>
          <input id="setting-${key}" class="mono" inputmode="decimal" data-key="${key}"
            aria-describedby="note-${key} help-${key} error-${key}">
          <p class="setting-note" id="note-${key}">${
            key.startsWith("weights.")
              ? `<span class="share" data-share><span class="share-bar"><span></span></span><span class="mono" data-share-text></span></span>`
              : ""
          }<span data-default></span></p>
          <p class="tip" id="help-${key}" role="tooltip">${help}</p>
          <p class="field-error error" id="error-${key}" role="alert"></p>
        </div>`,
      )
      .join("")}</fieldset>`,
  ).join("");
  container.insertAdjacentHTML(
    "beforeend",
    `<form class="settings-form" data-form novalidate>${groups}</form>
     <p class="field-error error" data-weights-error role="alert"></p>
     <div class="toolbar">
       <button type="button" class="button" data-reset>Reset to defaults</button>
       <button type="button" class="button" data-export>Export settings</button>
       <button type="button" class="button" data-import-button>Import settings</button>
       <input type="file" accept=".json,application/json" data-import hidden>
     </div>
     <p class="status" data-settings-status role="status" aria-live="polite"></p>`,
  );
  const form = /** @type {HTMLFormElement} */ (container.querySelector("[data-form]"));
  const status = /** @type {HTMLElement} */ (container.querySelector("[data-settings-status]"));
  /** @type {Settings} */
  let current = structuredClone(options.defaults);
  let running = false;

  const inputs = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll("[data-key]")]);

  function readForm() {
    /** @type {Record<string, string>} */
    const fields = {};
    for (const input of inputs) fields[/** @type {string} */ (input.dataset.key)] = input.value;
    return formToSettings(fields, current);
  }

  /** @param {Settings} settings */
  function fill(settings) {
    for (const input of inputs) {
      const value = /** @type {string} */ (input.dataset.key)
        .split(".")
        .reduce((node, part) => node?.[part], /** @type {any} */ (settings));
      input.value = value === null || value === undefined ? "" : String(value);
    }
  }

  /** @param {Settings} settings */
  function showErrors(settings) {
    const messages = validateSettings(settings);
    for (const element of container.querySelectorAll(".field-error")) element.textContent = "";
    for (const element of container.querySelectorAll(".setting")) element.classList.remove("invalid");
    for (const { field, message } of messages) {
      const target =
        field === "weights"
          ? container.querySelector("[data-weights-error]")
          : container.querySelector(`#error-${CSS.escape(field)}`);
      if (target) target.textContent = message;
      container.querySelector(`[data-setting="${CSS.escape(field)}"]`)?.classList.add("invalid");
    }
  }

  /**
   * Mark the settings that differ from the defaults and show each weight's share of the fitness.
   *
   * @param {Settings} settings
   */
  function showChanges(settings) {
    const changed = new Set(changedSettings(settings, options.defaults));
    const shares = weightShares(settings.weights);
    for (const row of /** @type {NodeListOf<HTMLElement>} */ (container.querySelectorAll("[data-setting]"))) {
      const key = /** @type {string} */ (row.dataset.setting);
      row.classList.toggle("changed", changed.has(key));
      // An empty tempo is not a missing value: it keeps the file's tempo, the field's placeholder.
      const unchangedNote = key === "tempo_bpm" ? "empty: the file's tempo" : "";
      /** @type {HTMLElement} */ (row.querySelector("[data-default]")).textContent = changed.has(key)
        ? defaultNote(key, options.defaults)
        : unchangedNote;
      const share = row.querySelector("[data-share]");
      if (!share) continue;
      const value = shares[key.slice("weights.".length)];
      const valid = Number.isFinite(value);
      /** @type {HTMLElement} */ (share.querySelector(".share-bar span")).style.width = `${valid ? value * 100 : 0}%`;
      /** @type {HTMLElement} */ (share.querySelector("[data-share-text]")).textContent = valid
        ? `${Math.round(value * 100)}% of the fitness`
        : "";
    }
  }

  /** @param {Settings} settings */
  function apply(settings) {
    current = settings;
    showErrors(settings);
    showChanges(settings);
    status.textContent = running ? "Changes apply to the next run." : "";
    options.onChange(settings);
  }

  form.addEventListener("input", () => apply(readForm()));
  container.querySelector("[data-reset]")?.addEventListener("click", () => {
    const settings = structuredClone(options.defaults);
    fill(settings);
    apply(settings);
    status.textContent = "Back to the command line's defaults.";
  });
  container.querySelector("[data-export]")?.addEventListener("click", () => {
    const blob = new Blob([exportConfig(current)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `settings-s${current.seed}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  const importInput = /** @type {HTMLInputElement} */ (container.querySelector("[data-import]"));
  container.querySelector("[data-import-button]")?.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    try {
      const settings = importConfig(await file.text(), options.defaults);
      fill(settings);
      apply(settings);
      status.textContent = `Loaded ${file.name}.`;
    } catch (error) {
      status.textContent = `${file.name}: ${/** @type {Error} */ (error).message}`;
    }
  });

  return {
    show(settings, isRunning) {
      running = isRunning;
      current = structuredClone(settings);
      if (!container.contains(document.activeElement)) fill(current);
      showErrors(current);
      showChanges(current);
      if (running) status.textContent = "Changes apply to the next run.";
      else if (status.textContent === "Changes apply to the next run.") status.textContent = "";
    },
    setFileTempo(bpm) {
      const tempo = /** @type {HTMLInputElement} */ (container.querySelector('[data-key="tempo_bpm"]'));
      tempo.placeholder = bpm === null ? "" : String(Math.round(bpm * 10) / 10);
    },
  };
}
