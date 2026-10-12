// @ts-check
/**
 * Settings: the hyperparameters of one run, their valid ranges, and the record that reproduces it.
 *
 * The browser arranger uses the same settings as the command line (`configs/default.json`, read
 * by `src/config.py`): population size, stopping limits, mutation rate, elite count, phrase
 * length, tempo override, the seven fitness weights and, for a MIDI song, the lead-sheet options.
 * The seed is a setting too, because the same input, seed and settings give the same arrangement
 * (constitution, principle I).
 *
 * A run is named like a command-line run folder, `<input stem>-s<seed>-<hash>`, where the hash is
 * the first 8 hex digits of the SHA-256 of the settings without the seed, written as JSON with
 * sorted keys. JavaScript writes the number 1.0 as `1` where Python writes `1.0`, so the same
 * settings hash differently here and in the command line (research R12).
 *
 * The downloaded `config.json` is a run record in the command line's format: every configuration
 * key, then the run keys. `uv run src/main.py arrange <input> --config <file> --seed <seed>`
 * accepts it, because the command line skips the run keys (contracts/cli.md).
 */

/** Largest seed: the generator is seeded with one unsigned 32-bit integer. */
export const MAX_SEED = 4294967295;

/** Run keys of a record, in the order the command line writes them, plus "app". */
export const RUN_RECORD_KEYS = Object.freeze([
  "seed",
  "input_path",
  "input_sha256",
  "git_commit",
  "git_dirty",
  "created",
  "run_id",
  "best_fitness",
  "stop_reason",
  "generations",
  "audio",
  "app",
]);

/**
 * @typedef {Record<string, any> & {
 *   seed: number, population_size: number, max_generations: number, stagnation_window: number,
 *   mutation_rate: number, elite_count: number, phrase_length: number, tempo_bpm: number | null,
 *   role_map: Record<string, string>, weights: Record<string, number>, midi: Record<string, any>
 * }} Settings
 */

/** @typedef {{field: string, message: string}} SettingMessage */

/**
 * The settings a first run uses: the command line's defaults and seed 1.
 *
 * @param {Record<string, any>} defaultConfig the parsed `configs/default.json`
 * @returns {Settings} a deep copy, safe to edit
 * @example
 * defaultSettings({population_size: 60, weights: {fidelity: 0.5}}).seed // 1
 */
export function defaultSettings(defaultConfig) {
  return { ...structuredClone(defaultConfig), seed: 1 };
}

/**
 * Check every setting against its valid range (data-model.md, Settings).
 *
 * The rules are those of the command line: at least one place in the population must be left
 * for children (elite count below the population size), and the fitness is a weighted mean, so
 * the weights must be finite, at least 0 and not all 0.
 *
 * @param {Settings} settings
 * @returns {SettingMessage[]} one message per invalid field; empty when all are valid
 * @example
 * validateSettings({...defaults, population_size: 1})
 * // [{field: "population_size", message: "population_size must be a whole number of at least 2"}]
 */
export function validateSettings(settings) {
  /** @type {SettingMessage[]} */
  const messages = [];
  const add = (/** @type {string} */ field, /** @type {string} */ message) =>
    messages.push({ field, message });
  const atLeast = (/** @type {string} */ field, /** @type {number} */ low) => {
    if (!isWholeNumber(settings[field]) || settings[field] < low) {
      add(field, `${field} must be a whole number of at least ${low}`);
    }
  };

  if (!isWholeNumber(settings.seed) || settings.seed < 0 || settings.seed > MAX_SEED) {
    add("seed", "seed must be a whole number from 0 to 4,294,967,295");
  }
  atLeast("population_size", 2);
  atLeast("max_generations", 1);
  atLeast("stagnation_window", 1);
  atLeast("phrase_length", 1);
  const population = settings.population_size;
  const eliteMax = isWholeNumber(population) && population >= 2 ? population - 1 : null;
  const elite = settings.elite_count;
  if (!isWholeNumber(elite) || elite < 0 || (eliteMax !== null && elite > eliteMax)) {
    const range = eliteMax === null ? "0 to population_size − 1" : `0 to ${eliteMax}`;
    add("elite_count", `elite_count must be a whole number from ${range}`);
  }
  const rate = settings.mutation_rate;
  if (typeof rate !== "number" || !(rate >= 0 && rate <= 1)) {
    add("mutation_rate", "mutation_rate must be a number from 0 to 1");
  }
  const tempo = settings.tempo_bpm;
  if (tempo !== null && (typeof tempo !== "number" || !(tempo >= 20 && tempo <= 400))) {
    add("tempo_bpm", "tempo_bpm must be empty, or from 20 to 400");
  }
  let weightSum = 0;
  let weightsValid = true;
  for (const [name, weight] of Object.entries(settings.weights ?? {})) {
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      add(`weights.${name}`, `weights.${name} must be a finite number of at least 0`);
      weightsValid = false;
    } else {
      weightSum += weight;
    }
  }
  if (weightsValid && weightSum === 0) {
    add("weights", "the weights must not all be 0: the fitness would have nothing to score");
  }
  return messages;
}

/**
 * JSON with the keys of every object sorted, so that equal settings give equal text.
 *
 * @param {unknown} value
 * @returns {string}
 * @example
 * canonicalJson({b: 1, a: 2}) // '{"a":2,"b":1}'
 */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

/**
 * The 8 hex digits that name the settings of a run, independent of key order and of the seed.
 *
 * @param {Settings} settings
 * @returns {Promise<string>}
 * @example
 * await settingsHash(defaultSettings(config)) // e.g. "3fa2c901"
 */
export async function settingsHash(settings) {
  const { seed: _seed, ...withoutSeed } = settings;
  const bytes = new TextEncoder().encode(canonicalJson(withoutSeed));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.subarray(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The name of a run and of its downloads: `<input stem>-s<seed>-<settings hash>`.
 *
 * The stem drops the folder and the last extension, as `pathlib.Path.stem` does, and characters
 * that file systems refuse become "-".
 *
 * @param {string} inputName name of the input file, for example "mulher-de-fases.mid"
 * @param {Settings} settings
 * @returns {Promise<string>}
 * @example
 * await runId("mulher-de-fases.mid", settings) // "mulher-de-fases-s1-3fa2c901"
 */
export async function runId(inputName, settings) {
  const base = inputName.split(/[\\/]/).pop() ?? inputName;
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[\\/:*?"<>|]/g, "-");
  return `${stem}-s${settings.seed}-${await settingsHash(settings)}`;
}

/**
 * The run record downloaded as `<run id>.config.json` (contracts/files.md).
 *
 * The configuration keys come first, without the seed and in the defaults' order, then the run
 * keys in RUN_RECORD_KEYS order. `git_dirty` is null for a local copy ("dev"), whose commit is
 * unknown, and false for a deployed one. `audio` is false: the app renders sound but writes no
 * audio file.
 *
 * @param {{
 *   settings: Settings, inputName: string, inputSha256: string, commit: string, created: string,
 *   runId: string, bestFitness: number, stopReason: string, generations: number,
 *   app: Record<string, unknown>
 * }} run
 * @returns {Record<string, unknown>}
 * @example
 * Object.keys(configRecord(run)).at(-1) // "app"
 */
export function configRecord(run) {
  const { seed, ...config } = structuredClone(run.settings);
  return {
    ...config,
    seed,
    input_path: run.inputName,
    input_sha256: run.inputSha256,
    git_commit: run.commit,
    git_dirty: run.commit === "dev" ? null : false,
    created: run.created,
    run_id: run.runId,
    best_fitness: run.bestFitness,
    stop_reason: run.stopReason,
    generations: run.generations,
    audio: false,
    app: run.app,
  };
}

/** @param {unknown} value */
function isWholeNumber(value) {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(/** @type {Record<string, unknown>} */ (value)[key])]),
    );
  }
  return value;
}
