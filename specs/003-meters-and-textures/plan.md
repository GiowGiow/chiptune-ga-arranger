# Implementation Plan: Meters and Allowed Textures

**Branch**: `002-browser-arranger` (post-submission work; `main` stays at the submitted state) |
**Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-meters-and-textures/spec.md`

## Summary

The arranger learns meters other than 4/4, and a new setting limits the values each gene may
take. Both the Python command line (the reference) and the browser app change, kept in step by
the parity fixtures.

**Meters.**
- Each bar carries a `Meter` (numerator, denominator, beat lengths, strong beats). Nine meters
  are supported: 2/2, 2/4, 3/4, 4/4, 6/8, 9/8, 12/8, 5/4 and 7/8.
- The readers give each bar its meter:
  - ABC: the `M:` field and inline `[M:]` changes;
  - MIDI: the time-signature map, with bar 0 at the file's first bar.
- The realizers, score tables, validation, chord detection, ABC writer and MIDI export work bar
  by bar from that meter.
- In 4/4 each rule reduces to today's constants, so the 10 samples and every parity value stay
  the same.

**Allowed values.**
- A config key `allowed` lists, per gene, the values the GA may draw.
- The initial population draws an index among the allowed values, and mutation shifts within
  them. With everything allowed, the random draws are exactly today's in numpy and in the app's
  generator.
- The app shows the setting as checkboxes with tooltips.

The decisions are in [research.md](research.md), R1–R15.

## Technical Context

**Language/Version**: Python 3.12 (command line, reference); JavaScript ES2022 modules with
JSDoc types and `// @ts-check`, no build step (browser app).

**Primary Dependencies**: music21 and pretty_midi (Python readers and export), numpy, abcjs
6.7.1 (vendored in `arranger/vendor/`). No new dependency.

**Storage**: Files only:
- `configs/default.json` gains `allowed`;
- the test tunes in `tests/data/meters/`;
- the regenerated fixtures in `arranger/tests/fixtures/`.

**Testing**: pytest with doctests (`uv run pytest`); `node --test` in `arranger/` (`npm test`).
Parity fixtures come from `uv run src/main.py fixtures`.

**Target Platform**: Linux or macOS command line; current desktop and mobile browsers (GitHub
Pages).

**Project Type**: Command-line tool plus a static web app, in one repository.

**Performance Goals**:
- Score tables and fitness keep their cost: one lookup per bar, with per-bar grids of at most 24
  steps (12/8).
- The app's speed target of spec 002 (SC-002) still holds.

**Constraints**:
- The default configuration on 4/4 inputs gives byte-identical results:
  - the samples' plans, fitness and `piece.mid` (spec FR-017, SC-002);
  - the app's Korobeiniki seed-1 MIDI SHA-256 `766657a7…d8ff`.
- The RNG draw order must not change when every value is allowed.

**Scale/Scope**:
- 9 meters and 4 genes;
- about 20 modules touched (10 Python, 10 JavaScript), plus the settings panel;
- 7 new test tunes and 4 synthetic MIDI songs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Deterministic reproducibility | The seeded generators are still passed as parameters. `allowed` is recorded in every run's `config.json` (CLI and app). The default draw stream is unchanged (R12), so the samples rerun byte-identically. Parity: the fixtures extend to the meter tunes and to synthetic MIDI songs (R13). | Pass |
| II. Test-first | Each layer starts with failing tests in pytest and node:test: the Meter table, 4/4 identity against the committed realization fixtures, 3/4 and 6/8 realizations, per-bar tables, validation, readers, writer round trip, allowed draws. | Pass |
| III. Explicit representation and style contract | The meter becomes explicit per bar, in quarter-note beats. Validation checks complete bars of each bar's declared meter, which is what the principle already asks for. Export stays in its own module. | Pass |
| IV. Learnable code | `meter.py` and `meter.js` open with the idea: beats, strong beats, simple, compound and irregular meters. Doctests and JSDoc examples cover the meter table, the realizers in 3/4 and the allowed draws. New glossary terms: meter, simple, compound and irregular meter, strong beat, beat grouping, allowed values. | Pass |
| V. Visual and explorable | The piano roll draws bar lines at each bar's real start (`figures.py`). The app's plan grid and chord row follow bar starts. No new figure is needed. | Pass |
| VI. Measurable evaluation | SC-004 measures arp32 usage per run. SC-001 and SC-003 are automated tests. | Pass |
| VII. Simplicity | One value type (`Meter`), one rule per gene value, no per-meter tables. No plugin or config layer beyond one key. | Pass |
| Tech constraints | No new dependency. Code stays in `src/` and `arranger/`. Repository text is in English. Test tunes are the project's own. Synthetic MIDI is generated, not third-party. | Pass |
| Web App Constraints | The method core stays pure (meter, realizers and tables have no DOM). Privacy is unchanged. No build step. | Pass |

No violation, so the Complexity Tracking table stays empty.

**Re-check after Phase 1:** the data model and contracts add one field per bar, one config key
and one per-bar table. No principle is affected. Pass.

## Project Structure

### Documentation (this feature)

```text
specs/003-meters-and-textures/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R15
├── data-model.md        # Meter, Bar.meter, bar map, allowed values, tables
├── quickstart.md        # validation scenarios
├── contracts/
│   ├── config.md        # the `allowed` key and its validation
│   └── files.md         # ABC meters, lead-sheet JSON, fixtures, MIDI export
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
configs/default.json                 # + "allowed"
src/
├── config.py                        # validate "allowed"
├── leadsheet/
│   ├── meter.py                     # NEW: Meter, SUPPORTED_METERS, parse_meter, bar_starts
│   ├── model.py                     # Bar.meter; LeadSheet without beats_per_bar
│   ├── abc_reader.py                # meters from the text scan; per-bar lengths
│   ├── abc_writer.py                # M: and inline [M:]
│   └── midi_reader.py               # bar_map, default excerpt, chord groups, estimated grid meter
├── arrangement/
│   ├── model.py                     # Arrangement.meters
│   ├── textures.py                  # realizers read bar.meter
│   ├── assemble.py                  # bar starts
│   └── validation.py                # per-bar starts, lengths, strong beats
├── ga/
│   ├── genome.py                    # allowed_genes, random_population(allowed)
│   ├── operators.py                 # mutate(allowed)
│   ├── evolution.py                 # GAParams.allowed
│   ├── tables.py                    # per-bar steps, act_no (n, 5)
│   └── fitness.py                   # act_no[bar, gene]
├── export/
│   ├── midi.py                      # time signatures
│   ├── input_preview.py             # bar starts, excerpt from the bar map
│   ├── figures.py                   # bar lines at bar starts
│   ├── experiments.py               # random search with allowed
│   └── fixtures.py                  # meter tunes, synthetic MIDI songs
└── main.py                          # pass allowed to GAParams
tests/
├── data/meters/*.abc                # NEW: project-written test tunes
├── test_meter.py                    # NEW
└── test_*.py                        # extended per module

arranger/
├── src/core/
│   ├── meter.js                     # NEW (port of meter.py)
│   ├── leadsheet.js, abc-reader.js, abc-writer.js, midi-song.js
│   ├── textures.js, arrangement.js, tables.js, fitness.js
│   ├── genome.js, operators.js, evolution.js, settings.js, midi-export.js
├── src/audio/plain-synth.js         # bar starts
├── src/ui/settings-panel.js         # "Allowed textures" checkboxes, warnings
├── src/ui/settings-form.js, input-panel.js, main.js, plan-grid.js
└── tests/
    ├── meter.test.js                # NEW
    ├── *.test.js                    # extended
    └── fixtures/                    # regenerated (+ meter tunes, synthetic MIDI songs)
docs/glossary.md, docs/explanation.md, README.md   # meters, allowed textures
```

**Structure Decision**: The existing two-stack layout of spec 002. One new module per language
(`meter.py`, `meter.js`). Test tunes go in `tests/data/meters/` and are read by the Python tests,
the fixtures command and the JavaScript tests (by repository path).

## Phases after this plan

`/speckit-tasks` orders the work by user story:

1. **Setup.** The meter type and the test tunes.
2. **US3 (allowed textures, P1).** The smallest independent slice, and the MVP.
3. **US1 (simple meters, P1).**
4. **US2 (compound, P2).**
5. **US4 (irregular and changing meters, P3).**
6. **Polish.** Docs, the README, a semantic diff of the fixtures, and a rerun of the samples to
   check SC-002.

Python leads in each layer. JavaScript follows against the regenerated fixtures.

## Complexity Tracking

No constitution violation to justify.
