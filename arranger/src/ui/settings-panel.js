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
 *
 * The "Allowed textures" group (spec 003, User Story 3) narrows the values each gene may take:
 * one fieldset per channel, one checkbox per value, each with a tooltip that says what the value
 * plays, in the words of the realizers' docstrings (`src/arrangement/textures.py`). A visitor who
 * finds the 32nd-note arpeggio too busy unticks it and the GA never draws it again. Choices that
 * switch off a fitness criterion or a channel are allowed, with a warning under the group.
 */

import { validateSettings } from "../core/settings.js";
import {
  allowedFromForm,
  allowedWarnings,
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

/**
 * The "Allowed textures" group: per gene, its channel, and per value (in gene order) its readable
 * label and what it plays. The labels avoid the settings file's names (`arp32`, `octave_pump`),
 * which the tooltips' sentences explain instead.
 *
 * @type {ReadonlyArray<{gene: string, legend: string, channel: string,
 *   values: ReadonlyArray<[string | number, string, string]>}>}
 */
export const ALLOWED_GROUPS = Object.freeze([
  {
    gene: "p2",
    legend: "P2 harmony",
    channel: "--p2",
    values: [
      ["hold", "hold", "Sustains the chord root for as long as each chord lasts: a calm pad under the melody."],
      ["arp16", "arpeggio (16th notes)", "Cycles the chord tones upward from the root, one per 16th note, so one channel sounds the whole chord."],
      ["arp32", "fast arpeggio (32nd notes)", "Cycles the chord tones one per 32nd note, so fast that they blur into one buzzing chord: the classic NES arpeggio."],
      ["echo", "echo", "Repeats the melody one eighth note later and softer, like a delay."],
      ["third", "third below", "Adds a chord tone under each melody note, at least a minor third below it: a second voice."],
    ],
  },
  {
    gene: "tr",
    legend: "TR bass",
    channel: "--tr",
    values: [
      ["root", "root", "Sustains the chord root in the bass for as long as each chord lasts."],
      ["octave_pump", "octave pump", "Eighth notes that alternate the root and the root one octave up: the bouncing NES bass."],
      ["root_fifth", "root–fifth", "One note per beat, the root on strong beats and the fifth on weak beats: root, fifth, root, fifth in 4/4."],
      ["walking", "walking", "One note per beat climbing root, third, fifth, then a semitone below the next bar's root, leading into it."],
    ],
  },
  {
    gene: "no",
    legend: "NO drums",
    channel: "--no",
    values: [
      ["none", "none", "No drums: the noise channel rests in that bar."],
      ["half_time", "half time", "Kick on beat 1, snare on the next strong beat (beat 3 in 4/4), hi-hat on the other beats: a relaxed groove."],
      ["eighth_beat", "eighth beat", "Kick on the strong beats, snare on the weak beats, hi-hat on the eighth notes between them: the basic rock beat."],
      ["sixteenth_beat", "sixteenth beat", "The eighth beat, busier: hi-hat on every 16th note and a pickup kick on the last 16th note of the last strong beat."],
      ["fill", "fill", "The eighth beat until the last beat, then a snare roll on its 16th notes that leads into the next bar. The idiom criterion wants fills at phrase ends."],
    ],
  },
  {
    gene: "p1_octave",
    legend: "P1 melody octave",
    channel: "--p1",
    values: [
      [0, "as written", "Plays the melody at its written octave, which the fidelity criterion rewards."],
      [12, "octave up", "Plays the melody one octave higher; notes that leave the pulse range fold back by octaves."],
      [-12, "octave down", "Plays the melody one octave lower; notes that leave the pulse range fold back by octaves."],
    ],
  },
]);

/**
 * Form labels by dotted key; a weight's label says "weight", since out of its group it could read
 * as a score, and an allowed list says "Allowed", since out of its group it could read as a part.
 */
const LABELS = new Map([
  ...FIELDS.flatMap(({ fields }) =>
    fields.map(([key, label]) => /** @type {[string, string]} */ ([key, key.startsWith("weights.") ? `${label} weight` : label])),
  ),
  ...ALLOWED_GROUPS.map(({ gene, legend }) => /** @type {[string, string]} */ ([`allowed.${gene}`, `Allowed ${legend}`])),
]);

/**
 * The name of a setting outside the form (Run card, run list), the same as the form's label.
 *
 * @param {string} key dotted key, for example "max_generations"
 * @returns {string} the label, or the key itself for a setting the form does not show
 * @example
 * settingLabel("max_generations") // "Max generations"
 * settingLabel("weights.fidelity") // "Fidelity weight"
 * settingLabel("allowed.p2") // "Allowed P2 harmony"
 */
export function settingLabel(key) {
  return LABELS.get(key) ?? key;
}

/**
 * A setting's value as the Run card and the run list show it: an allowed list by the values it
 * leaves out (a short list, and the point of changing it), any other setting as its JSON.
 *
 * @param {string} key dotted key
 * @param {unknown} value
 * @returns {string}
 * @example
 * settingValueText("allowed.p2", ["hold", "arp16", "echo", "third"]) // "without fast arpeggio (32nd notes)"
 * settingValueText("max_generations", 500) // "500"
 */
export function settingValueText(key, value) {
  const group = ALLOWED_GROUPS.find(({ gene }) => key === `allowed.${gene}`);
  if (group && Array.isArray(value)) {
    const left = group.values.filter(([option]) => !value.includes(option)).map(([, label]) => label);
    return left.length ? `without ${left.join(", ")}` : "all allowed";
  }
  return JSON.stringify(value);
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
 * defaultNote("allowed.p2", defaults) // "default: all allowed"
 */
export function defaultNote(key, defaults) {
  const value = valueAt(defaults, key);
  const group = ALLOWED_GROUPS.find(({ gene }) => key === `allowed.${gene}`);
  if (group && Array.isArray(value)) {
    // The default allows every value, and listing them all would only repeat the checkboxes.
    if (group.values.every(([option]) => value.includes(option))) return "default: all allowed";
    const labels = group.values.filter(([option]) => value.includes(option)).map(([, label]) => label);
    return `default ${labels.join(", ")}`;
  }
  // Only the tempo override has no default value: without it the song keeps its own tempo.
  return value === null || value === undefined ? "default: the file's tempo" : `default ${value}`;
}

/**
 * The markup of the "Allowed textures" group: one fieldset per channel, one checkbox per value.
 *
 * Each channel is a row of the form like any setting (`data-setting="allowed.p2"`), so the
 * panel's usual code marks it as changed, names its default and shows its validation message.
 *
 * @returns {string} HTML for the settings form
 * @example
 * allowedGroupHtml().match(/type="checkbox"/g).length // 17
 */
export function allowedGroupHtml() {
  const channels = ALLOWED_GROUPS.map(({ gene, legend, channel, values }) => {
    const field = `allowed.${gene}`;
    const boxes = values
      .map(([value, label, tip]) => {
        const id = `allowed-${gene}-${value}`;
        return `<div class="allowed-value has-tip">
          <label for="${id}"><input type="checkbox" id="${id}" data-allowed="${gene}" value="${value}"
            aria-describedby="tip-${id} error-${field}"><span>${label}<span class="tip-mark" aria-hidden="true">i</span></span></label>
          <p class="tip" id="tip-${id}" role="tooltip">${tip}</p>
        </div>`;
      })
      .join("");
    return `<fieldset class="allowed-gene" data-setting="${field}">
        <legend><span class="dot" style="--c: var(${channel})" aria-hidden="true"></span>${legend}</legend>
        <div class="allowed-values">${boxes}</div>
        <p class="setting-note"><span data-default></span></p>
        <p class="field-error error" id="error-${field}" role="alert"></p>
      </fieldset>`;
  }).join("");
  return `<fieldset class="settings-group allowed-textures"><legend>Allowed textures</legend>
      <p class="hint">What the GA may choose for each channel. Untick a value to keep it out of every bar.</p>
      ${channels}
      <div class="allowed-warnings" data-allowed-warnings role="status"></div>
    </fieldset>`;
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
    `<form class="settings-form" data-form novalidate>${groups}${allowedGroupHtml()}</form>
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
  const boxes = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll("[data-allowed]")]);
  const warnings = /** @type {HTMLElement} */ (container.querySelector("[data-allowed-warnings]"));

  function readForm() {
    /** @type {Record<string, string>} */
    const fields = {};
    for (const input of inputs) fields[/** @type {string} */ (input.dataset.key)] = input.value;
    /** @type {Record<string, string[]>} */
    const ticked = {};
    for (const box of boxes) {
      if (box.checked) (ticked[/** @type {string} */ (box.dataset.allowed)] ??= []).push(box.value);
    }
    return { ...formToSettings(fields, current), allowed: allowedFromForm(ticked) };
  }

  /** @param {Settings} settings */
  function fill(settings) {
    for (const input of inputs) {
      const value = /** @type {string} */ (input.dataset.key)
        .split(".")
        .reduce((node, part) => node?.[part], /** @type {any} */ (settings));
      input.value = value === null || value === undefined ? "" : String(value);
    }
    for (const box of boxes) {
      const allowed = settings.allowed?.[/** @type {keyof Settings["allowed"]} */ (box.dataset.allowed)];
      box.checked = Array.isArray(allowed) && allowed.map(String).includes(box.value);
    }
  }

  /** @param {Settings} settings */
  function showErrors(settings) {
    const messages = validateSettings(settings);
    for (const element of container.querySelectorAll(".field-error")) element.textContent = "";
    for (const element of container.querySelectorAll("[data-setting]")) element.classList.remove("invalid");
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

  /**
   * Warn under the "Allowed textures" group about values whose absence switches something off.
   *
   * @param {Settings} settings
   */
  function showWarnings(settings) {
    warnings.replaceChildren(
      ...allowedWarnings(settings.allowed ?? {}).map((text) => {
        const line = document.createElement("p");
        line.textContent = text;
        return line;
      }),
    );
  }

  /** @param {Settings} settings */
  function apply(settings) {
    current = settings;
    showErrors(settings);
    showChanges(settings);
    showWarnings(settings);
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
      showWarnings(current);
      if (running) status.textContent = "Changes apply to the next run.";
      else if (status.textContent === "Changes apply to the next run.") status.textContent = "";
    },
    setFileTempo(bpm) {
      const tempo = /** @type {HTMLInputElement} */ (container.querySelector('[data-key="tempo_bpm"]'));
      tempo.placeholder = bpm === null ? "" : String(Math.round(bpm * 10) / 10);
    },
  };
}
