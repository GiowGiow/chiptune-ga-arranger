# Implementation Plan: Browser Arranger

**Branch**: `002-browser-arranger` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-browser-arranger/spec.md`

## Summary

A static page, `arranger/`, served by GitHub Pages next to `listen/`. It runs the TP1 arranger in
the visitor's browser:

1. It reads an uploaded ABC or MIDI file into a lead sheet.
2. It evolves a plan of 4 genes per bar with the same GA and fitness as the Python command line,
   drawing the evolution live.
3. It plays the arrangement with an NES chip synthesizer next to the original (A/B).
4. It downloads the MIDI, the run's `config.json` and the lead sheet as ABC.

A second input route searches a committed index of the MPB MIDI catalog. The visitor then
downloads the song from the catalog and drops it in.

The method core is plain JavaScript ES modules (JSDoc types, no build step, no runtime
dependency except abcjs 6.7.1, vendored and used only to parse ABC). It is a module-by-module
port of `src/`. The
GA runs in a module Web Worker with a seeded generator passed as a parameter.

The port is fast. A throwaway benchmark of the fitness and GA loop ran 1,905 generations of a
32-bar song in 0.2 s and 2,491 generations of a 56-bar song in 0.6 s (Node 22, student's
laptop); the command line takes 9.5 s and 12.4 s. A run is therefore throttled by default to a
watchable pace (about 400 generations per second) so that the visitor sees it evolve. A "full
speed" switch removes the pause.

Python gains three things:

- a `catalog` command that builds the catalog index with polite crawling;
- a `fixtures` command that exports parity fixtures (chords, lead sheets, score tables, plans
  and scores, realizations, MIDI reductions) for the JavaScript tests;
- a `load_config` that accepts a run's own `config.json`, so the app's download reruns in the
  command line.

A GitHub Actions workflow runs the JavaScript tests. On `main` it also deploys Pages with a
`version.json` that holds the deployed commit.

## Technical Context

**Language/Version**: JavaScript (ES2022 modules) for the app, with `// @ts-check` and JSDoc
types; Python 3.12 (existing CLI) for the catalog crawler and the fixture exporter.

**Primary Dependencies**:
- abcjs 6.7.1 (MIT): ABC parsing only. It is vendored in `arranger/vendor/abcjs/` and loaded on
  demand (research R3).
- There is no npm dependency.
- The browser APIs used are Web Workers, Web Audio (`AudioBuffer` playback), Canvas 2D,
  Web Crypto (SHA-256), the File API and a service worker.
Python side: the standard library only (`urllib`, `html.parser`) for the crawler, and the
existing modules for the fixtures.

**Storage**: none on a server. Inside the browser: in-memory runs (last 5). `localStorage` holds
only UI preferences (speed, audio-only mode). The service-worker cache holds the app's own files.

**Testing**: `node --test` (built into Node 22) for the app's core, audio rendering and worker
protocol, with parity fixtures exported by Python. The existing pytest suite covers the new
Python commands. A manual browser checklist in quickstart.md covers the UI.

**Target Platform**: the last two versions of Chrome, Firefox, Safari and Edge, on desktop and
phone. The app needs module workers (Firefox 114+, Safari 15+).

**Project Type**: static web application plus two new CLI commands.

**Performance Goals**: a run in the default "watch" pace finishes Korobeiniki (1,905
generations) in about 5 s and Amor I Love You in about 6 s. At "full speed", each takes under
1 s. The display updates at least 10 times per second; Stop takes effect within 0.5 s. The page
can take a file within 10 s of a first visit and 3 s of a repeat visit (SC-001).

**Constraints**: no server-side code. Visitor files never leave the device. Same input, seed
and settings give the same arrangement in every browser (FR-026): the GA path uses only integer
operations and IEEE double `+ - * /`, `Math.abs`, `Math.min`, `Math.max` and `Math.floor`, never
`Math.random`, `Math.exp`, `Math.log` or `Math.pow`. Works offline after the first visit
(FR-035). Phone width 375 px.

**Scale/Scope**: inputs up to 128 bars (64 by default). The catalog index has about 3,700
entries (about 0.5 MB raw, about 0.12 MB gzipped, loaded only when the catalog panel opens).
The port covers about 1,900 lines of Python core, plus the UI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution 1.3.0.

| Rule | How the plan meets it | Status |
|---|---|---|
| I. Seed, generator as a parameter | `createRandom(seed)` returns a generator object passed to every function that draws numbers; no `Math.random`, no module state. | Pass |
| I. Same input, seed, settings → same arrangement | Deterministic operations only in the GA path (see Constraints); a test runs a run twice and compares the MIDI bytes. | Pass |
| I. CLI stays reference; fitness and reduction parity | Python `fixtures` command exports the reference values; JavaScript tests compare tables, scores (6 decimals) and lead sheets (SC-006, SC-010). | Pass |
| I. `config.json` per piece | The app downloads a `config.json` with the CLI's keys plus the run record (seed, input SHA-256, app commit, date, run id, fitness, stop reason). | Pass |
| II. Test-first | Every core module starts from a failing `node:test` test; fixtures come first. The UI is checked by quickstart scenarios and by tests of its pure helpers. | Pass |
| III. Explicit units, export separate, validation before export | Core works in beats and MIDI pitches; seconds only in `audio/` and `export.js`; `arrangement.js` validates NES rules before any playback or download (FR-018). | Pass |
| IV. Learnable code | Module header comments, JSDoc with types on every export, worked examples mirrored by tests, domain names copied from `src/`. | Pass |
| V. Visuals | Live fitness curve, plan grid and channel lines in the tableau-colorblind10 channel colors of `listen/`; every visual has a caption. | Pass |
| VI. Measurable evaluation | The app shows the criterion scores of every run, and the run list compares settings. No new experiment for the abstract. | Pass (N/A for the abstract) |
| VII. Simplicity | No framework, no bundler, no npm dependency; one vendored parser (abcjs), justified in research R3. | Pass |
| Web App Constraints: hosting, privacy | Static files; no request carries visitor data (SC-008 check in quickstart). | Pass |
| Web App Constraints: build | No build step. The Pages workflow only writes `version.json`; the committed tree serves as it is. | Pass |
| Web App Constraints: separation | `arranger/src/core/` has no DOM, audio or network access; tests run it in Node. | Pass |
| Web App Constraints: responsiveness | GA in a module worker, in slices of generations, with stop between slices. | Pass |
| Layout | App in one top-level folder `arranger/`, tests in `arranger/tests/`. Python additions in `src/catalog/` and `src/export/fixtures.py`, wired into `src/main.py`. | Pass |
| Data: catalog metadata only | `arranger/data/catalog.json` holds titles, composers, performers and URLs; never MIDI. Credits shown in the app. | Pass |
| Language | All code, comments and docs in English. | Pass |
| Workflow: post-submission work on a feature branch | All work on `002-browser-arranger`; `main` changes only when the student merges. | Pass |

Recorded deviations: none. The deferred marimo notebook, `docs/glossary.md` and
`docs/explanation.md` remain deferred from spec 001. This feature adds the glossary terms it
introduces (seeded generator, Web Worker, skyline) to the README section of the app, until the
glossary exists.

**Post-design re-check (after Phase 1)**: still Pass. The design adds the Pages workflow
(research R9), which is a deployment step, not a build step. It needs one repository setting,
Pages source "GitHub Actions", which the student changes when merging.

## Project Structure

### Documentation (this feature)

```text
specs/002-browser-arranger/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R12
├── data-model.md        # Phase 1: entities, fields, validation, state of a run
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── worker-protocol.md   # messages between the page and the GA worker
│   ├── files.md             # downloaded files, catalog.json, fixtures, version.json
│   └── cli.md               # new and changed CLI commands
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
arranger/                      # the web app, served at /chiptune-ga-arranger/arranger/
├── index.html
├── style.css                  # tokens shared with listen/ (colors, fonts)
├── package.json               # {"type": "module", "private": true}; scripts.test = node --test; no dependencies
├── version.json               # {"commit": "dev"}; the Pages workflow writes the deployed commit
├── sw.js                      # service worker: cache-first for the app's own files (FR-035)
├── vendor/abcjs/              # abcjs-basic-min.js 6.7.1 + LICENSE (MIT), loaded on demand
├── data/catalog.json          # written by `uv run src/main.py catalog`
├── src/
│   ├── core/                  # method core: pure functions, no DOM, audio or network
│   │   ├── random.js          # seeded generator (sfc32 seeded by splitmix32)
│   │   ├── chords.js          # chord symbol -> root and tones; register helpers
│   │   ├── leadsheet.js       # bars, chord segments, phrase marks, section roles
│   │   ├── abc-reader.js      # ABC text -> lead sheet via abcjs parse (ABCJS passed in); repeats, pickup, 2/4
│   │   ├── abc-writer.js      # lead sheet -> ABC (port of src/leadsheet/abc_writer.py)
│   │   ├── midi-file.js       # standard MIDI file bytes <-> tracks of notes (pretty_midi semantics)
│   │   ├── midi-song.js       # MIDI song -> lead sheet (skyline, chords per half bar, beat grid)
│   │   ├── genome.js          # gene names and sizes, random population, decode
│   │   ├── textures.js        # realizers P1, P2, TR, NO
│   │   ├── tables.js          # score tables
│   │   ├── fitness.js         # seven criteria and weighted mean
│   │   ├── operators.js       # roulette with windowing, elitism, crossover, mutation
│   │   ├── evolution.js       # GA loop as a generator of generations, with stop
│   │   ├── arrangement.js     # assemble and validate (NES rules)
│   │   ├── settings.js        # defaults, validation, run id, config.json record
│   │   ├── midi-export.js     # arrangement -> 4-track MIDI bytes (GM programs as the CLI)
│   │   └── catalog.js         # accent-insensitive search over the catalog index
│   ├── audio/
│   │   ├── chip-synth.js      # pure: arrangement -> PCM samples (port of chip_audio.py)
│   │   ├── plain-synth.js     # pure: original input -> PCM samples
│   │   ├── loudness.js        # pure: gain that brings both renders to the same loudness
│   │   └── player.js          # Web Audio edge: A/B buffers, seek, playhead clock
│   ├── worker.js              # GA worker: runs evolution.js in slices, posts snapshots
│   └── ui/                    # page code: panels and canvases
│       ├── main.js
│       ├── input-panel.js     # drop zone, examples, MIDI track/range/sections, lead-sheet summary
│       ├── settings-panel.js
│       ├── evolution-view.js  # fitness curve, counters, stagnation bar
│       ├── plan-grid.js
│       ├── channel-view.js    # channel lines revealed with the playhead
│       ├── catalog-panel.js
│       ├── runs.js            # last 5 runs
│       └── downloads.js
└── tests/
    ├── *.test.js              # one file per core/audio module, plus worker protocol
    └── fixtures/              # JSON written by `uv run src/main.py fixtures`

src/
├── catalog/
│   ├── __init__.py
│   ├── pages.py               # parse catalog index pages and song pages (pure)
│   └── crawl.py               # polite crawl (1 request/s, resumable cache) -> catalog.json
├── export/fixtures.py         # parity fixtures for the JavaScript tests
├── config.py                  # load_config accepts a run's config.json (run-record keys)
└── main.py                    # new commands: catalog, fixtures

tests/
├── test_catalog_pages.py      # synthetic HTML in the catalog's structure
├── test_fixtures.py
└── test_config.py             # extended: a run's config.json loads back

.github/workflows/pages.yml    # node --test on every push; on main: write version.json, deploy Pages
```

**Structure Decision**:
- The app is one top-level folder, `arranger/`, as the constitution's web-app layout rule asks.
  Its URL sits next to `listen/`.
- `arranger/src/core/` mirrors the Python modules one to one (`ga/fitness.py` →
  `core/fitness.js`), so a reader can put the two side by side.
- The examples are the committed lead sheets, read at run time from `../data/leadsheets/`, and
  the defaults come from `../configs/default.json`. The app therefore never duplicates them,
  and both stay at the deployed commit.

## Complexity Tracking

No constitution violation to justify.
