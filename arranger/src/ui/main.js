// @ts-check
/**
 * Page wiring: input, settings, the GA worker, the evolution display, playback and downloads.
 *
 * A run goes through the states of data-model.md ("Run state"):
 *
 *   idle → evolving → realized → ready (or failed when the arrangement breaks an NES rule)
 *
 * The genetic algorithm runs in a module worker (`../worker.js`), so the page stays responsive
 * (FR-015). The page sends `run` and `stop` messages and draws every `progress` message
 * (contracts/worker-protocol.md). When the worker is `done`, the page realizes the best plan into
 * notes, checks the NES rules, renders the chip sound and offers the downloads. Dropping a new
 * file during a run stops it and discards it.
 */

import { assemble, findViolations } from "../core/arrangement.js";
import { writeLeadSheetAbc } from "../core/abc-writer.js";
import { arrangementToMidi } from "../core/midi-export.js";
import { configRecord, defaultSettings, runId, validateSettings } from "../core/settings.js";
import { renderChip } from "../audio/chip-synth.js";
import { matchLoudness } from "../audio/loudness.js";
import { leadSheetVoices, midiExcerptVoices, renderVoices } from "../audio/plain-synth.js";
import { createPlayer } from "../audio/player.js";
import { createCatalogPanel } from "./catalog-panel.js";
import { createChannelView } from "./channel-view.js";
import { createDownloads } from "./downloads.js";
import { createEvolutionView } from "./evolution-view.js";
import { buildExamples } from "./examples.js";
import { createInputPanel } from "./input-panel.js";
import { createPlanGrid } from "./plan-grid.js";
import { addRun } from "./run-list.js";
import { renderScores } from "./scores-table.js";
import { changedSettings, valueAt } from "./settings-form.js";
import { createRunsView } from "./runs.js";
import { createSettingsPanel, settingLabel } from "./settings-panel.js";

/** @typedef {import("./input-panel.js").LoadedInput} LoadedInput */
/** @typedef {import("../core/settings.js").Settings} Settings */

const $ = (/** @type {string} */ selector) =>
  /** @type {HTMLElement} */ (document.querySelector(selector));

const [version, defaultConfig, sources] = await Promise.all([
  fetchJson("version.json").catch(() => ({ commit: "dev" })),
  fetchJson("../configs/default.json"),
  fetchJson("../data/sources.json"),
]);
$("#app-version").textContent = version.commit === "dev" ? "dev" : version.commit.slice(0, 7);

// Offline use after the first visit (FR-035); the page works without it.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/** The app state: everything the panels show comes from here. */
const state = {
  /** @type {Settings} */
  settings: defaultSettings(defaultConfig),
  /** @type {LoadedInput | null} */
  input: null,
  /** @type {"watch" | "full"} */
  pace: "watch",
  /** @type {"idle" | "evolving" | "realized" | "ready" | "failed"} */
  phase: "idle",
  /** @type {string | null} */
  currentRunId: null,
  /** @type {any[]} */
  runs: [],
  /** @type {any[]} generations of the current run, for the run list */
  log: [],
  /** @type {Record<string, number>} settings an example set, undone when another input loads */
  appliedOverrides: {},
};
const defaults = defaultSettings(defaultConfig);

// --- Panels ---------------------------------------------------------------------------------

setUpTabs($("#song"));
const inputPanel = createInputPanel(
  { root: $("#song"), file: $("#panel-file"), examples: $("#panel-examples"), details: $("[data-song-details]") },
  {
  examples: buildExamples(sources),
  onFileDropped: (name) => catalogPanel.claim(name),
  previewTrack: (index) => previewTrack(index),
  useTempo(bpm) {
    state.settings.tempo_bpm = bpm;
    settingsPanel.show(state.settings, state.phase === "evolving");
    inputPanel.reread();
  },
  readOptions: () => ({
    phraseLength: state.settings.phrase_length,
    roleMap: state.settings.role_map,
    tempoOverride: state.settings.tempo_bpm,
  }),
  onLoaded(loaded) {
    if (state.phase === "evolving") stopRun(true);
    state.input = loaded;
    // An example's own limits (the MIDI songs' 4000/400) last only while it is the input.
    for (const key of Object.keys(state.appliedOverrides)) {
      if (state.settings[key] === state.appliedOverrides[key]) state.settings[key] = defaults[key];
    }
    state.appliedOverrides = { ...loaded.overrides };
    Object.assign(state.settings, loaded.overrides);
    state.settings.midi = { ...state.settings.midi, ...loaded.midi };
    settingsPanel.show(state.settings, false);
    // With no tempo override the lead sheet plays at the file's tempo: the field's placeholder.
    if (state.settings.tempo_bpm === null) settingsPanel.setFileTempo(loaded.leadSheet.tempoBpm);
    planGrid.setBars(loaded.leadSheet.bars);
    $("[data-run-song]").textContent =
      `${loaded.leadSheet.title || loaded.input.name} · ${loaded.leadSheet.bars.length} bars`;
    updateRunButtons();
  },
  },
);

const catalogPanel = createCatalogPanel($("#panel-catalog"), {
  onFile: (file) => inputPanel.readFile(file),
});

const settingsPanel = createSettingsPanel($("#settings"), {
  defaults,
  onChange(settings) {
    // The MIDI options belong to the input panel; the form never edits them.
    state.settings = { ...settings, seed: state.settings.seed, midi: state.settings.midi };
    updateRunButtons();
  },
});
settingsPanel.show(state.settings, false);
const settingsToggle = /** @type {HTMLButtonElement} */ ($("[data-settings-toggle]"));
settingsToggle.addEventListener("click", () => toggleSettings());
$("[data-settings-close]").addEventListener("click", () => toggleSettings(false));
$("#settings").addEventListener("keydown", (event) => {
  if (event.key === "Escape") toggleSettings(false);
});

clearPlaceholder("#evolution");
$("#evolution").insertAdjacentHTML(
  "beforeend",
  `<div class="toolbar evolution-actions">
     <button type="button" class="button" data-stop-evolution disabled>Stop</button>
     <span class="hint">Stop keeps the best plan found so far.</span>
   </div>
   <div data-evolution-view></div>
   <h3 class="subhead">Best plan so far</h3>
   <div data-plan-grid></div>
   <p class="caption">One column per bar. The top row is the chord, named where it changes and
   held until the next tick; a tick without a name is a chord too long for the column. Below it,
   one row per gene: the P2 harmony texture, the TR bass texture, the NO drum pattern and the P1
   melody octave. Brighter cells are busier choices; hover a cell or a chord for its name.</p>`,
);
const evolutionView = createEvolutionView($("[data-evolution-view]"));
const planGrid = createPlanGrid($("[data-plan-grid]"));
const arrangeButton = /** @type {HTMLButtonElement} */ ($("[data-arrange]"));
const stopButton = /** @type {HTMLButtonElement} */ ($("[data-stop]"));
// The Run card scrolls away while the evolution plays, so the Evolution card has its own Stop.
const stopEvolutionButton = /** @type {HTMLButtonElement} */ ($("[data-stop-evolution]"));
stopEvolutionButton.addEventListener("click", () => stopRun(false));
const paceSelect = /** @type {HTMLSelectElement} */ ($("[data-pace]"));
const seedInput = /** @type {HTMLInputElement} */ ($("[data-seed]"));
seedInput.addEventListener("input", () => {
  state.settings.seed = seedInput.value.trim() === "" ? NaN : Number(seedInput.value);
  updateRunButtons();
});

clearPlaceholder("#result");
$("#result").insertAdjacentHTML(
  "beforeend",
  `<div class="transport">
     <button type="button" class="button primary" data-play disabled aria-label="Play">Play</button>
     <div class="versions" role="group" aria-label="Version" data-versions hidden>
       <button type="button" class="button" data-version="original">Original</button>
       <button type="button" class="button" data-version="arrangement" aria-pressed="true">NES chip</button>
     </div>
     <input type="range" min="0" max="1" step="0.01" value="0" data-seek aria-label="Position" disabled>
     <span class="mono time" data-time>0:00 / 0:00</span>
   </div>
   <p class="status" data-result-status role="status" aria-live="polite">No arrangement yet.</p>
   <div data-channel-view></div>
   <p class="caption">Each channel is a line in its color, revealed as it plays: P1 melody (blue),
   P2 harmony (orange), TR bass (gray) and NO drums as ticks at the bottom. Switch to the original
   to see its melody in blue and the other parts as faint dashes. Keys: space plays, A and B
   switch, the arrows move 2 s.</p>
   <div class="scores" data-scores></div>
   <div data-downloads></div>
   <div data-runs></div>`,
);
const player = createPlayer();
const downloads = createDownloads($("[data-downloads]"));
const channelView = createChannelView($("[data-channel-view]"));
/** @type {{arrangement: any, original: any}} */
let scenes = { arrangement: null, original: null };
const runsView = createRunsView($("[data-runs]"), { defaults, onSelect: (id) => showRun(id) });
const playButton = /** @type {HTMLButtonElement} */ ($("[data-play]"));
const seekInput = /** @type {HTMLInputElement} */ ($("[data-seek]"));

// --- Worker ---------------------------------------------------------------------------------

const worker = new Worker(new URL("../worker.js", import.meta.url), { type: "module" });
/** @type {number} */
let runStartedAt = 0;
worker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.runId !== state.currentRunId) return; // a cancelled run still talking
  if (message.type === "progress") {
    evolutionView.append(message.generations);
    state.log.push(...message.generations);
    planGrid.update(message.bestPlan);
  } else if (message.type === "done") {
    finishRun(message);
  } else if (message.type === "error") {
    state.phase = "failed";
    setResultStatus(`The run failed: ${message.message}`, true);
    updateRunButtons();
  }
});

arrangeButton.addEventListener("click", () => startRun());
stopButton.addEventListener("click", () => stopRun(false));
paceSelect.addEventListener("change", () => {
  state.pace = /** @type {"watch" | "full"} */ (paceSelect.value);
  if (state.phase === "evolving") {
    worker.postMessage({ type: "pace", runId: state.currentRunId, pace: state.pace });
  }
});

async function startRun() {
  if (!state.input) return;
  const messages = validateSettings(state.settings);
  if (messages.length) {
    setRunHint(messages.map((message) => message.message).join("; "), true);
    return;
  }
  player.ensureContext(); // inside the click: browsers allow sound only after a gesture
  player.pause();
  const settings = structuredClone(state.settings);
  const id = await runId(state.input.input.name, settings);
  state.currentRunId = id;
  state.phase = "evolving";
  state.log = [];
  settingsPanel.show(state.settings, true);
  runStartedAt = performance.now();
  evolutionView.reset({
    maxGenerations: settings.max_generations,
    stagnationWindow: settings.stagnation_window,
  });
  downloads.clear();
  setResultStatus("Evolving…");
  updateRunButtons();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("#evolution").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  worker.postMessage({
    type: "run",
    runId: id,
    leadSheet: state.input.leadSheet,
    settings,
    pace: state.pace,
  });
}

/** @param {boolean} discard true when a new input replaces the running one */
function stopRun(discard) {
  if (state.phase !== "evolving") return;
  worker.postMessage({ type: "stop", runId: state.currentRunId });
  if (discard) {
    state.currentRunId = null;
    state.phase = "idle";
    setResultStatus("The run was cancelled: a new song was loaded.");
    updateRunButtons();
  }
}

/** @param {any} message the worker's `done` message */
async function finishRun(message) {
  const input = /** @type {LoadedInput} */ (state.input);
  const settings = structuredClone(state.settings);
  const leadSheet = input.leadSheet;
  const arrangement = assemble(leadSheet, message.bestPlan);
  evolutionView.finish({
    stopReason: message.stopReason,
    generations: message.generations,
    durationMs: message.durationMs ?? performance.now() - runStartedAt,
  });
  renderScores($("[data-scores]"), message.scores, message.bestFitness, settings.weights);
  const violations = findViolations(arrangement, leadSheet);
  if (violations.length) {
    state.phase = "failed";
    setResultStatus(`The arrangement breaks NES rules and will not play:\n${violations.join("\n")}`, true);
    updateRunButtons();
    return;
  }
  state.phase = "realized";
  const context = player.ensureContext();
  const durationBeats = leadSheet.bars.length * 4;
  const voices = originalVoices(input, leadSheet);
  const matched = matchLoudness(
    renderChip(arrangement, context.sampleRate),
    renderVoices(voices, leadSheet.tempoBpm, context.sampleRate, durationBeats),
    context.sampleRate,
  );
  const samples = matched.a;
  const originalSamples = matched.b;
  scenes = buildScenes(arrangement, voices, leadSheet.tempoBpm);
  player.load({ arrangement: samples, original: originalSamples }, context.sampleRate);
  const record = configRecord({
    settings,
    inputName: input.input.name,
    inputSha256: input.input.sha256,
    commit: version.commit,
    created: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    runId: /** @type {string} */ (state.currentRunId),
    bestFitness: message.bestFitness,
    stopReason: message.stopReason,
    generations: message.generations,
    app: {
      name: "chiptune-ga-arranger web",
      pace: state.pace,
      ...(input.input.catalogEntry
        ? { catalog_page: /** @type {{u: string}} */ (input.input.catalogEntry).u }
        : {}),
    },
  });
  const id = /** @type {string} */ (state.currentRunId);
  const downloadFiles = [
    {
      name: `${id}.mid`,
      label: "MIDI",
      hint: "The arrangement: four tracks P1, P2, TR and NO",
      blob: new Blob([arrangementToMidi(arrangement)], { type: "audio/midi" }),
    },
    {
      name: `${id}.config.json`,
      label: "Settings",
      hint: "The run record; the command line accepts it with --config",
      blob: new Blob([`${JSON.stringify(record, null, 2)}\n`], { type: "application/json" }),
    },
    {
      name: `${id}.abc`,
      label: "Lead sheet",
      hint: "The lead sheet this run arranged, in ABC",
      blob: new Blob([writeLeadSheetAbc(leadSheet, { phraseLength: settings.phrase_length })], {
        type: "text/plain",
      }),
    },
  ];
  downloads.set(downloadFiles);
  state.runs = addRun(state.runs, {
    id,
    settings,
    bestFitness: message.bestFitness,
    message,
    arrangement,
    leadSheet,
    samples,
    originalSamples,
    scenes,
    sampleRate: context.sampleRate,
    log: state.log,
    files: downloadFiles,
  });
  runsView.render(state.runs, id);
  settingsPanel.show(state.settings, false);
  state.phase = "ready";
  setResultStatus(
    `Best fitness ${message.bestFitness.toFixed(4)} after ${message.generations} generations.`,
  );
  updateRunButtons();
}

/**
 * Bring back a run of the run list: its plan, curve, scores, sound and downloads.
 *
 * @param {string} id
 */
function showRun(id) {
  const run = state.runs.find((entry) => entry.id === id);
  if (!run || state.phase === "evolving") return;
  state.currentRunId = id;
  planGrid.setBars(run.leadSheet.bars);
  planGrid.update(run.message.bestPlan);
  evolutionView.show(run.log, {
    maxGenerations: run.settings.max_generations,
    stagnationWindow: run.settings.stagnation_window,
  });
  evolutionView.finish({
    stopReason: run.message.stopReason,
    generations: run.message.generations,
    durationMs: run.message.durationMs ?? 0,
  });
  renderScores($("[data-scores]"), run.message.scores, run.message.bestFitness, run.settings.weights);
  scenes = run.scenes;
  player.load({ arrangement: run.samples, original: run.originalSamples }, run.sampleRate);
  downloads.set(run.files);
  runsView.render(state.runs, id);
  setResultStatus(`Run ${id}: best fitness ${run.message.bestFitness.toFixed(4)}.`);
}

// --- Result panel ---------------------------------------------------------------------------

playButton.addEventListener("click", () => {
  trackPreview?.stop();
  trackPreview = null;
  player.ensureContext();
  player.toggle();
});
seekInput.addEventListener("input", () => player.seek(Number(seekInput.value)));
for (const button of document.querySelectorAll("[data-version]")) {
  button.addEventListener("click", () =>
    player.switchTo(/** @type {"original" | "arrangement"} */ (/** @type {HTMLElement} */ (button).dataset.version)),
  );
}
player.onChange(() => {
  playButton.disabled = player.duration() === 0;
  playButton.textContent = player.isPlaying() ? "Pause" : "Play";
  playButton.setAttribute("aria-label", playButton.textContent);
  seekInput.disabled = player.duration() === 0;
  seekInput.max = String(player.duration());
  for (const button of document.querySelectorAll("[data-version]")) {
    const element = /** @type {HTMLElement} */ (button);
    element.setAttribute("aria-pressed", String(element.dataset.version === player.active()));
  }
  $("[data-versions]").hidden = !player.has("original");
  channelView.setScene(scenes[player.active()]);
});
(function tick() {
  if (!seekInput.matches(":active")) seekInput.value = String(player.currentTime());
  $("[data-time]").textContent = `${clock(player.currentTime())} / ${clock(player.duration())}`;
  channelView.draw(player.currentTime());
  requestAnimationFrame(tick);
})();
document.addEventListener("keydown", (event) => {
  const target = /** @type {HTMLElement} */ (event.target);
  if (target.closest("input, textarea, select, button, a")) return;
  if (event.key === " ") {
    event.preventDefault();
    player.ensureContext();
    player.toggle();
  } else if (event.key === "a") player.switchTo("original");
  else if (event.key === "b") player.switchTo("arrangement");
  else if (event.key === "ArrowRight") player.seek(player.currentTime() + 2);
  else if (event.key === "ArrowLeft") player.seek(player.currentTime() - 2);
});

/** @type {AudioBufferSourceNode | null} */
let trackPreview = null;

/**
 * Play the first 8 bars of one track of the loaded MIDI song alone, to help choose the melody.
 *
 * @param {number} index track index, as listed in the input panel
 */
function previewTrack(index) {
  const loaded = inputPanel.current();
  if (!loaded?.song || !loaded.leadSheet.sourceGrid) return;
  const context = player.ensureContext();
  player.pause();
  trackPreview?.stop();
  const bars = loaded.midi.bars ?? [0, loaded.leadSheet.bars.length];
  const voices = midiExcerptVoices(loaded.song, {
    melodyTrack: index,
    sourceGrid: /** @type {[number, number]} */ (loaded.leadSheet.sourceGrid),
    bars: /** @type {[number, number]} */ (bars),
  });
  const beats = Math.min(32, (bars[1] - bars[0]) * 4);
  const rendered = renderVoices(
    { melody: voices.melody, others: [], drums: [] },
    loaded.leadSheet.tempoBpm,
    context.sampleRate,
    beats,
  );
  const samples = matchLoudness(rendered, rendered, context.sampleRate).a;
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  trackPreview = source;
}

/**
 * The notes of the input, in beats: the lead sheet played plainly for ABC, or every track of the
 * MIDI excerpt (FR-021).
 *
 * @param {LoadedInput} input
 * @param {import("../core/leadsheet.js").LeadSheet} leadSheet
 */
function originalVoices(input, leadSheet) {
  if (!input.song) return leadSheetVoices(leadSheet);
  const bars = input.midi.bars ?? [0, leadSheet.bars.length];
  return midiExcerptVoices(input.song, {
    melodyTrack: /** @type {number} */ (input.midi.melody_track),
    sourceGrid: /** @type {[number, number]} */ (leadSheet.sourceGrid),
    bars: /** @type {[number, number]} */ (bars),
  });
}

/**
 * What the channel view draws for each version, in seconds.
 *
 * @param {any} arrangement
 * @param {import("../audio/plain-synth.js").Voices} voices
 * @param {number} tempoBpm
 */
function buildScenes(arrangement, voices, tempoBpm) {
  const seconds = 60 / tempoBpm;
  const inSeconds = (/** @type {Array<{pitch: number, onset: number, duration: number}>} */ notes) =>
    notes.map((note) => ({ pitch: note.pitch, onset: note.onset * seconds, duration: note.duration * seconds }));
  return {
    arrangement: {
      label: "The arrangement: P1 melody, P2 harmony and TR bass as lines, NO drums as ticks",
      lines: [
        { color: "--tr", notes: inSeconds(arrangement.channels.TR), monophonic: true },
        { color: "--p2", notes: inSeconds(arrangement.channels.P2), monophonic: true, width: 2 },
        { color: "--p1", notes: inSeconds(arrangement.channels.P1), monophonic: true, width: 3 },
      ],
      drums: arrangement.channels.NO.map((/** @type {{onset: number}} */ hit) => hit.onset * seconds),
    },
    original: {
      label: "The original: the melody as a blue line, the other parts as faint dashes",
      lines: [
        ...voices.others.map((notes) => ({
          color: "--muted",
          notes: inSeconds(notes),
          monophonic: false,
          faint: true,
        })),
        { color: "--p1", notes: inSeconds(voices.melody), monophonic: false, width: 3 },
      ],
      drums: voices.drums.map((hit) => hit.onset * seconds),
    },
  };
}

// --- Helpers --------------------------------------------------------------------------------

function updateRunButtons() {
  const evolving = state.phase === "evolving";
  const valid = validateSettings(state.settings).length === 0;
  if (document.activeElement !== seedInput && Number.isFinite(state.settings.seed)) {
    seedInput.value = String(state.settings.seed);
  }
  showChangedSettings();
  arrangeButton.disabled = !state.input || evolving || !valid;
  stopButton.disabled = !evolving;
  stopEvolutionButton.disabled = !evolving;
  if (!state.input) setRunHint("");
  else if (!valid) setRunHint(validateSettings(state.settings).map((m) => m.message).join("; "), true);
  else if (evolving) setRunHint("Evolving… changes apply to the next run.");
  else setRunHint("Ready to arrange.");
}

/** Show the settings that differ from the defaults as chips on the Run card. */
function showChangedSettings() {
  const box = $("[data-changed]");
  box.innerHTML = "";
  for (const key of changedSettings(state.settings, defaults)) {
    if (key.startsWith("midi.")) continue; // the Song card shows the MIDI options
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "changed mono";
    chip.textContent = `${settingLabel(key)} ${JSON.stringify(valueAt(state.settings, key))}`;
    chip.title = "Open the settings";
    chip.addEventListener("click", () => toggleSettings(true));
    box.append(chip);
  }
}

/**
 * Open (true), close (false) or flip (undefined) the Settings drawer, which slides in over the
 * right side of the page without moving it. Focus moves into the drawer on opening and back to
 * its button on closing.
 *
 * @param {boolean} [open]
 */
function toggleSettings(open) {
  const section = $("#settings");
  const isOpen = section.classList.contains("open");
  const show = open ?? !isOpen;
  if (show === isOpen) return;
  section.classList.toggle("open", show);
  settingsToggle.setAttribute("aria-expanded", String(show));
  settingsToggle.textContent = show ? "Hide settings" : "Settings";
  if (show) $("#settings-title").focus({ preventScroll: true });
  else if (section.contains(document.activeElement)) settingsToggle.focus();
}

/**
 * Tabs of the Song card: arrow keys move between tabs, as in the WAI-ARIA tabs pattern.
 *
 * @param {HTMLElement} card
 */
function setUpTabs(card) {
  const tabs = /** @type {HTMLButtonElement[]} */ ([...card.querySelectorAll('[role="tab"]')]);
  const select = (/** @type {HTMLButtonElement} */ tab) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      const panel = /** @type {HTMLElement} */ (document.getElementById(/** @type {string} */ (other.getAttribute("aria-controls"))));
      panel.hidden = !selected;
    }
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      const next = tabs[(index + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });
}

/**
 * @param {string} text
 * @param {boolean} [isError]
 */
function setRunHint(text, isError = false) {
  const hint = $("[data-run-hint]");
  hint.textContent = text;
  hint.classList.toggle("error", isError);
}

/**
 * @param {string} text
 * @param {boolean} [isError]
 */
function setResultStatus(text, isError = false) {
  const status = $("[data-result-status]");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

/** @param {string} selector */
function clearPlaceholder(selector) {
  document.querySelector(`${selector} .placeholder`)?.remove();
}

/** @param {number} seconds */
function clock(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** @param {string} path */
async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

// Expose the run list for the settings and run-list panels (User Story 2).
export { state, inputPanel, player };
