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
 */

import { validateSettings } from "../core/settings.js";
import { exportConfig, formToSettings, importConfig } from "./settings-form.js";

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

/**
 * Build the panel inside `container`.
 *
 * @param {HTMLElement} container
 * @param {{
 *   defaults: Settings,
 *   onChange: (settings: Settings) => void,
 * }} options
 * @returns {{show: (settings: Settings, running: boolean) => void}}
 */
export function createSettingsPanel(container, options) {
  const groups = FIELDS.map(
    ({ group, fields }) => `<fieldset class="settings-group"><legend>${group}</legend>${fields
      .map(
        ([key, label, help]) => `<div class="setting has-tip" data-setting="${key}">
          <label for="setting-${key}">${label}<span class="tip-mark" aria-hidden="true">i</span></label>
          <input id="setting-${key}" class="mono" inputmode="decimal" data-key="${key}"
            aria-describedby="help-${key} error-${key}">
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

  /** @param {Settings} settings */
  function apply(settings) {
    current = settings;
    showErrors(settings);
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
      if (running) status.textContent = "Changes apply to the next run.";
      else if (status.textContent === "Changes apply to the next run.") status.textContent = "";
    },
  };
}
