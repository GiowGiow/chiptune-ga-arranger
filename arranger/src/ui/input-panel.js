// @ts-check
/**
 * Input panel: from a dropped file, or a picked example, to the lead sheet the GA arranges.
 *
 * The arranger works on a lead sheet: bars of melody, chords and part labels (spec 001). An ABC
 * file is one already. A MIDI song is a whole band, so the visitor helps reduce it: the panel
 * lists its tracks with the likeliest melody track preselected, the bar range to arrange (64 bars
 * by default, 128 at most) and where each section starts. The lead-sheet summary shows what the
 * app understood (title, tempo, bars, parts, the chord of every bar) before any run, so a wrong
 * reading is caught before the GA spends time on it (spec 002, FR-001 to FR-007).
 *
 * Files are read in the browser and never sent anywhere (FR-033). The ABC parser (abcjs) is
 * loaded only the first time an ABC text is read, to keep the first visit light.
 */

import { listTunes, readLeadSheetAbc } from "../core/abc-reader.js";
import { readMidiFile } from "../core/midi-file.js";
import { countBars, describeTracks, readLeadSheetMidi, suggestMelodyTrack } from "../core/midi-song.js";

export const DEFAULT_BAR_LIMIT = 64;
export const MAX_BARS = 128;

/** @typedef {import("../core/leadsheet.js").LeadSheet} LeadSheet */
/**
 * @typedef {{
 *   name: string, kind: "abc" | "midi", sha256: string, bytes: Uint8Array,
 *   catalogEntry: unknown | null
 * }} InputSong
 */
/**
 * @typedef {{
 *   leadSheet: LeadSheet, input: InputSong, song: any | null,
 *   midi: {melody_track: number | null, bars: [number, number] | null,
 *          sections: Array<[number, string]> | null, grid: string},
 *   overrides: Record<string, number>
 * }} LoadedInput
 */
/** @typedef {{phraseLength: number, roleMap: Record<string, string>, tempoOverride: number | null}} ReadOptions */

/**
 * Whether the bytes are a standard MIDI file: every one starts with the chunk name "MThd".
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 * @example
 * isMidi(new TextEncoder().encode("MThd...")) // true
 * isMidi(new TextEncoder().encode("X:1\nT:Tune")) // false
 */
export function isMidi(bytes) {
  return bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "MThd";
}

/**
 * Parse the section editor: one "<bar> <label>" per line, bars counted from the excerpt start.
 *
 * @param {string} text
 * @returns {Array<[number, string]>}
 * @example
 * parseSections("0 A\n8 Chorus") // [[0, "A"], [8, "Chorus"]]
 */
export function parseSections(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) throw new Error(`a section line must look like "8 Chorus", not "${line}"`);
      return /** @type {[number, string]} */ ([Number(match[1]), match[2].trim()]);
    });
}

/**
 * The SHA-256 of a file's bytes, in hex: the run record names the exact input it arranged.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @type {Promise<any> | null} */
let abcjsLoading = null;

/**
 * Load the vendored abcjs once, with a classic script tag (its UMD file sets `globalThis.ABCJS`).
 *
 * @returns {Promise<any>} the ABCJS object
 */
export function loadAbcjs() {
  const global = /** @type {any} */ (globalThis);
  if (global.ABCJS) return Promise.resolve(global.ABCJS);
  abcjsLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "vendor/abcjs/abcjs-basic-min.js";
    script.onload = () => resolve(global.ABCJS);
    script.onerror = () => {
      abcjsLoading = null;
      reject(new Error("the ABC parser could not be loaded"));
    };
    document.head.append(script);
  });
  return abcjsLoading;
}

/**
 * Build the panel inside `container`.
 *
 * @param {HTMLElement} container
 * @param {{
 *   examples: Array<{id: string, title: string, artist: string, path: string, overrides: Record<string, number>}>,
 *   readOptions: () => ReadOptions,
 *   onLoaded: (loaded: LoadedInput) => void,
 *   onFileDropped?: (name: string) => unknown | null,
 * }} options `onFileDropped` lets the catalog panel claim a dropped file (FR-031)
 * @returns {{reread: () => void, current: () => LoadedInput | null}}
 */
export function createInputPanel(container, options) {
  container.insertAdjacentHTML(
    "beforeend",
    `
    <label class="dropzone" data-drop tabindex="-1">
      <input type="file" accept=".abc,.txt,.mid,.midi,.kar" data-file>
      <span class="drop-title">Drop an ABC or MIDI file here</span>
      <span class="drop-hint">or <span class="button small">choose a file</span>. It stays on this device.</span>
    </label>
    <div class="examples" data-examples><span class="label">Examples</span></div>
    <p class="status" data-status role="status" aria-live="polite"></p>
    <div class="field" data-tunes hidden>
      <label>Tune <select data-tune></select></label>
    </div>
    <fieldset class="midi-options" data-midi hidden>
      <legend>MIDI song</legend>
      <div class="table-wrap"><table class="tracks">
        <thead><tr><th>Melody</th><th>#</th><th>Track</th><th>Program</th><th>Notes</th><th>Range</th><th>Chords</th></tr></thead>
        <tbody data-tracks></tbody>
      </table></div>
      <div class="row">
        <label>From bar <input type="number" min="0" step="1" data-first></label>
        <label>to bar <input type="number" min="1" step="1" data-end></label>
        <span class="hint" data-bar-count></span>
      </div>
      <label class="block">Sections (bar and label per line, counted from the first bar)
        <textarea rows="3" spellcheck="false" data-sections placeholder="0 A&#10;8 Chorus"></textarea></label>
      <button type="button" class="button" data-apply>Read again</button>
    </fieldset>
    <div class="summary" data-summary hidden></div>`,
  );
  const $ = (/** @type {string} */ selector) =>
    /** @type {HTMLElement} */ (container.querySelector(selector));
  const fileInput = /** @type {HTMLInputElement} */ ($("[data-file]"));
  const dropZone = $("[data-drop]");
  const status = $("[data-status]");

  /** @type {null | {input: InputSong, text?: string, tuneIndex: number, midi?: any, tracks?: any[], overrides: Record<string, number>}} */
  let source = null;
  /** @type {LoadedInput | null} */
  let loaded = null;

  for (const example of options.examples) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip button-chip";
    button.innerHTML = `<span class="title"></span><span class="artist"></span>`;
    /** @type {HTMLElement} */ (button.querySelector(".title")).textContent = example.title;
    /** @type {HTMLElement} */ (button.querySelector(".artist")).textContent = example.artist;
    button.addEventListener("click", async () => {
      setStatus(`Loading ${example.title}…`);
      try {
        const response = await fetch(example.path);
        if (!response.ok) throw new Error(`${example.path}: HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        await openFile(`${example.id}.abc`, bytes, example.overrides);
      } catch (error) {
        setStatus(String(/** @type {Error} */ (error).message ?? error), true);
      }
    });
    $("[data-examples]").append(button);
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) readDroppedFile(file);
    fileInput.value = "";
  });
  for (const type of ["dragenter", "dragover"]) {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.add("over");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    dropZone.addEventListener(type, () => dropZone.classList.remove("over"));
  }
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = /** @type {DragEvent} */ (event).dataTransfer?.files?.[0];
    if (file) readDroppedFile(file);
  });
  $("[data-tune]").addEventListener("change", () => {
    if (!source) return;
    source.tuneIndex = Number(/** @type {HTMLSelectElement} */ ($("[data-tune]")).value);
    reread();
  });
  $("[data-apply]").addEventListener("click", () => reread());

  /** @param {File} file */
  async function readDroppedFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openFile(file.name, bytes, {}, options.onFileDropped?.(file.name) ?? null);
  }

  /**
   * @param {string} name
   * @param {Uint8Array} bytes
   * @param {Record<string, number>} overrides
   * @param {unknown} [catalogEntry]
   */
  async function openFile(name, bytes, overrides, catalogEntry = null) {
    try {
      const kind = isMidi(bytes) ? "midi" : "abc";
      const input = { name, kind, sha256: await sha256Hex(bytes), bytes, catalogEntry };
      if (kind === "abc") {
        const text = new TextDecoder().decode(bytes);
        const tunes = listTunes(await loadAbcjs(), text);
        if (tunes.length === 0) throw new Error(`${name} holds no ABC tune (no X: line)`);
        showTunes(tunes);
        $("[data-midi]").hidden = true;
        source = { input: /** @type {InputSong} */ (input), text, tuneIndex: 0, overrides };
      } else {
        const midi = readMidiFile(bytes);
        const tracks = describeTracks(midi);
        $("[data-tunes]").hidden = true;
        source = { input: /** @type {InputSong} */ (input), midi, tracks, tuneIndex: 0, overrides };
        showMidiOptions(midi, tracks);
      }
      reread();
    } catch (error) {
      setStatus(`${name}: ${/** @type {Error} */ (error).message ?? error}`, true);
    }
  }

  /** @param {Array<{index: number, title: string}>} tunes */
  function showTunes(tunes) {
    const select = /** @type {HTMLSelectElement} */ ($("[data-tune]"));
    select.innerHTML = "";
    for (const tune of tunes) {
      const option = document.createElement("option");
      option.value = String(tune.index);
      option.textContent = tune.title || `Tune ${tune.index + 1}`;
      select.append(option);
    }
    $("[data-tunes]").hidden = tunes.length < 2;
  }

  /**
   * @param {any} midi
   * @param {any[]} tracks
   */
  function showMidiOptions(midi, tracks) {
    const suggested = suggestMelodyTrack(tracks);
    const body = $("[data-tracks]");
    body.innerHTML = "";
    for (const track of tracks) {
      const row = document.createElement("tr");
      if (track.isDrum) row.className = "drum";
      row.innerHTML = `<td><input type="radio" name="melody-track" value="${track.index}"
        ${track.isDrum ? "disabled" : ""} ${track.index === suggested ? "checked" : ""}
        aria-label="Melody track ${track.index}"></td><td class="mono">${track.index}</td>
        <td class="name"></td><td class="mono">${track.isDrum ? "drums" : track.program}</td>
        <td class="mono">${track.noteCount}</td>
        <td class="mono">${track.isDrum ? "" : `${track.lowest}–${track.highest}`}</td>
        <td class="mono">${Math.round(track.polyphony * 100)}%</td>`;
      /** @type {HTMLElement} */ (row.querySelector(".name")).textContent = track.name || "(no name)";
      body.append(row);
    }
    body.querySelectorAll("input").forEach((radio) => radio.addEventListener("change", () => reread()));
    const barCount = countBars(midi, "auto");
    if (barCount === 0) throw new Error("the file has no pitched notes to arrange");
    const first = /** @type {HTMLInputElement} */ ($("[data-first]"));
    const end = /** @type {HTMLInputElement} */ ($("[data-end]"));
    first.value = "0";
    end.value = String(Math.min(barCount, DEFAULT_BAR_LIMIT));
    first.max = String(barCount - 1);
    end.max = String(barCount);
    $("[data-bar-count]").textContent =
      barCount > DEFAULT_BAR_LIMIT
        ? `${barCount} bars; the first ${DEFAULT_BAR_LIMIT} are selected (at most ${MAX_BARS}).`
        : `${barCount} bars.`;
    /** @type {HTMLTextAreaElement} */ ($("[data-sections]")).value = "0 A";
    $("[data-midi]").hidden = false;
  }

  function reread() {
    if (!source) return;
    const { phraseLength, roleMap, tempoOverride } = options.readOptions();
    try {
      /** @type {LoadedInput["midi"]} */
      let midiSettings = { melody_track: null, bars: null, sections: null, grid: "auto" };
      let leadSheet;
      if (source.input.kind === "abc") {
        leadSheet = readLeadSheetAbc(/** @type {any} */ (globalThis).ABCJS, /** @type {string} */ (source.text), {
          tuneIndex: source.tuneIndex,
          phraseLength,
          roleMap,
          tempoOverride,
        });
      } else {
        const checked = /** @type {HTMLInputElement | null} */ (
          container.querySelector('input[name="melody-track"]:checked')
        );
        if (!checked) throw new Error("choose the track that carries the melody");
        const bars = /** @type {[number, number]} */ ([
          Number(/** @type {HTMLInputElement} */ ($("[data-first]")).value),
          Number(/** @type {HTMLInputElement} */ ($("[data-end]")).value),
        ]);
        const sections = parseSections(/** @type {HTMLTextAreaElement} */ ($("[data-sections]")).value);
        midiSettings = { melody_track: Number(checked.value), bars, sections, grid: "auto" };
        leadSheet = readLeadSheetMidi(source.midi, {
          melodyTrack: midiSettings.melody_track,
          phraseLength,
          roleMap,
          tempoOverride,
          bars,
          sections,
          grid: "auto",
          title: source.input.name.replace(/\.[^.]*$/, ""),
        });
      }
      if (leadSheet.bars.length > MAX_BARS) {
        throw new Error(
          `the tune has ${leadSheet.bars.length} bars; the arranger takes at most ${MAX_BARS}`,
        );
      }
      loaded = {
        leadSheet,
        input: source.input,
        song: source.input.kind === "midi" ? source.midi : null,
        midi: midiSettings,
        overrides: source.overrides,
      };
      showSummary(leadSheet, source.input);
      setStatus(`${source.input.name}: ready to arrange.`);
      options.onLoaded(loaded);
    } catch (error) {
      setStatus(`${source.input.name}: ${/** @type {Error} */ (error).message ?? error}`, true);
    }
  }

  /**
   * @param {LeadSheet} leadSheet
   * @param {InputSong} input
   */
  function showSummary(leadSheet, input) {
    const summary = $("[data-summary]");
    const parts = [];
    leadSheet.bars.forEach((bar, index) => {
      if (index === 0 || bar.label !== leadSheet.bars[index - 1].label) {
        parts.push(`${bar.label} (${bar.role}, bar ${index + 1})`);
      }
    });
    const melody = leadSheet.bars.flatMap((bar) => bar.melody.map((note) => note.pitch));
    summary.innerHTML = `
      <dl class="facts">
        <div><dt>Title</dt><dd data-title></dd></div>
        <div><dt>Tempo</dt><dd class="mono">${round(leadSheet.tempoBpm, 2)} BPM</dd></div>
        <div><dt>Bars</dt><dd class="mono">${leadSheet.bars.length}</dd></div>
        <div><dt>Melody</dt><dd class="mono">${melody.length ? `${Math.min(...melody)}–${Math.max(...melody)}` : "none"}</dd></div>
        <div class="span"><dt>Parts</dt><dd data-parts></dd></div>
      </dl>
      <p class="label">Chord of every bar</p>
      <ol class="chord-strip mono" data-chords></ol>`;
    /** @type {HTMLElement} */ (summary.querySelector("[data-title]")).textContent =
      leadSheet.title || input.name;
    /** @type {HTMLElement} */ (summary.querySelector("[data-parts]")).textContent = parts.join(" · ");
    const strip = /** @type {HTMLElement} */ (summary.querySelector("[data-chords]"));
    leadSheet.bars.forEach((bar, index) => {
      const item = document.createElement("li");
      item.textContent = bar.chords.map((chord) => chord.symbol).join(" ");
      item.title = `Bar ${index + 1}`;
      if (index === 0 || bar.label !== leadSheet.bars[index - 1].label) item.dataset.part = bar.label;
      strip.append(item);
    });
    summary.hidden = false;
  }

  /**
   * @param {string} text
   * @param {boolean} [isError]
   */
  function setStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle("error", isError);
  }

  return { reread, current: () => loaded };
}

/**
 * @param {number} value
 * @param {number} decimals
 */
function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
