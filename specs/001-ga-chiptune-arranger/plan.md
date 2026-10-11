# Implementation Plan: GA Chiptune Arranger

**Branch**: `001-ga-chiptune-arranger` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-ga-chiptune-arranger/spec.md`

## Summary

A command-line tool reads an ABC lead sheet (melody, chord symbols, part labels) and arranges it
for the four NES channels. A genetic algorithm searches the arrangement plan, which has four
integer genes per bar (P2 texture, TR texture, NO pattern, P1 octave). Deterministic realizers turn
each gene value into the notes of one bar. The fitness is a weighted mean of seven music-theory
criteria. Selection is roulette with windowing and elitism, and the default mutation rate is 0.01
per gene. These choices were checked against `references/tp1/ga-arranjo-nes.md` (literature on GA
arrangement and on the NES idiom). The best plan is validated against the NES rules, exported to MIDI, rendered to MP3, and
saved with a piano roll, the evolution log and figure, the metrics and the configuration record.

Every realization depends only on the bar and on the gene of its own channel. The tool therefore
computes each bar's realization once for every gene value before the GA starts. It also stores
per-bar score tables, so that the fitness of a genotype is a sum of table lookups and the whole
population is scored with numpy indexing.

## Technical Context

**Language/Version**: Python 3.12 (uv)

**Primary Dependencies**: music21 (ABC parsing, chord symbols, reading MIDI back in tests),
pretty_midi (MIDI writing), numpy (GA, random generator, score tables), matplotlib (figures). These
are already in `pyproject.toml`, so no new dependency is needed. External programs: `fluidsynth`
with `/usr/share/sounds/sf2/FluidR3_GM.sf2`, and `ffmpeg` (MP3). Both are optional at run time.

**Storage**: files only: `data/leadsheets/*.abc` (input, versioned), `configs/default.json`,
`outputs/<run-id>/` (not versioned), `samples/<name>/` (versioned) and `paper/figures/` (vector
figures).

**Testing**: pytest with doctests (`--doctest-modules` is already configured), plus one end-to-end
test: arrange, write MIDI, read it back with music21.

**Target Platform**: Linux laptop (the student's). The grader reruns the README commands.

**Project Type**: single-project command-line tool.

**Performance Goals**: a 32-bar lead sheet with the default GA (population 60, up to 1000
generations) finishes in under 2 minutes including audio (SC-001). Target: under 20 s without
audio.

**Constraints**: deterministic for a given seed; audio files under 5 MB; the abstract has at most
3 pages; the deadline is 2026-10-11 23:59.

**Scale/Scope**: 2 input songs of 24 and 32 bars; about 15 source modules; at least 3 curated
samples.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How the plan meets it |
|---|---|---|
| I. Deterministic reproducibility | PASS | `--seed` is required; one `np.random.default_rng(seed)` is created in `main.py` and passed down; `config.json` records the seed, the resolved hyperparameters, the input SHA-256, the git commit and the date; the README lists every sample command. |
| II. Test-first | PASS | Each module starts with failing tests (tasks order tests before code). Core functions carry doctests. One end-to-end test reads the MIDI back with music21. |
| III. Explicit representation and style contract | PASS | The core uses MIDI pitches, quarter-note beats, a 4/4 meter, the key and the tempo. Seconds appear only in `export/`. `arrangement/validation.py` checks the NES rules before export, and tests cover each rule. |
| IV. Learnable code | PASS with deviation | Module docstrings, type hints, domain names and doctests are kept. `docs/glossary.md` and `docs/explanation.md` are deferred (see Complexity Tracking); for now the spec's Context section and the README define the terms. |
| V. Visual explanations | PASS with deviation | Every run has a piano roll and an evolution figure (tableau-colorblind10, PDF copies in `paper/figures/`), and the README has a Mermaid pipeline. The marimo notebook is deferred. |
| VI. Measurable evaluation | PASS | `metrics.json` reports, per channel, note density, pitch-class histogram, pitch entropy and interval distribution, plus each fitness criterion. Each sample has `notes.md` for listening notes. There is no corpus, so the comparison is between seeds and hyperparameters. |
| VII. Simplicity | PASS | Pure functions in the core, I/O only in `main.py` and `export/`, no new dependencies, one JSON config with `--set key=value` overrides. |
| Assignment constraints | PASS | One method (GA) with every element exposed; outputs `piece.mid`, `piece.mp3`, `pianoroll.png` and `config.json` per run (plus logs); FluidSynth with a GM soundfont; small lead sheets versioned with their sources in the README. |

Post-design re-check (after Phase 1): unchanged. The data model and the CLI contract add no
abstraction beyond the modules listed below.

## Project Structure

### Documentation (this feature)

```text
specs/001-ga-chiptune-arranger/
├── plan.md              # this file
├── research.md          # Phase 0 decisions
├── data-model.md        # Phase 1 entities and rules
├── quickstart.md        # Phase 1 validation guide
├── contracts/
│   └── cli.md           # command-line contract
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── main.py                   # argparse entry point: arrange, sample, video (optional)
├── config.py                 # RunConfig: defaults, JSON loading, --set overrides, hashing
├── leadsheet/
│   ├── model.py              # MelodyNote, ChordSegment, Bar, LeadSheet (frozen dataclasses)
│   ├── chords.py             # chord tones, root/third/fifth/seventh, register placement
│   └── abc_reader.py         # ABC text -> LeadSheet (music21 + part labels from the text)
├── arrangement/
│   ├── model.py              # ChannelNote, Arrangement, channel names and ranges
│   ├── textures.py           # realizers: P1 octave, P2 textures, TR textures, NO patterns
│   ├── assemble.py           # genotype + lead sheet -> Arrangement
│   └── validation.py         # NES rules -> list of violations
├── ga/
│   ├── genome.py             # gene layout, random population, decode to names
│   ├── tables.py             # per-bar realizations and score tables (the cache)
│   ├── fitness.py            # criteria C1..C7 and the weighted mean
│   ├── operators.py          # roulette selection, elitism, one-point crossover, mutation
│   └── evolution.py          # generation loop, stopping rules, evolution log
├── analysis/
│   └── metrics.py            # density, pitch-class histogram, entropy, intervals
└── export/
    ├── midi.py               # Arrangement -> pretty_midi (seconds and GM programs live here)
    ├── audio.py              # fluidsynth + ffmpeg, skipped with a message when unavailable
    ├── figures.py            # piano roll and evolution figure (PNG, PDF)
    ├── run_folder.py         # run id, config.json, evolution.csv, metrics.json, sample copy
    ├── experiments.py        # seeds, random-search baseline and weight ablation (FR-029)
    └── video.py              # optional Bach Vision Test animation (US4)

configs/default.json          # default hyperparameters
data/leadsheets/              # ievan_polkka.abc, korobeiniki.abc
samples/<name>/               # curated runs plus notes.md
paper/figures/                # vector figures for the abstract

tests/
├── test_abc_reader.py
├── test_chords.py
├── test_textures.py
├── test_validation.py
├── test_genome_operators.py
├── test_fitness.py
├── test_evolution.py
├── test_config.py
└── test_end_to_end.py
```

**Structure Decision**: a single project with code directly in `src/`, in subfolders by
responsibility, as the constitution requires. Four groups have no dependency on each other once
the dataclasses exist: `leadsheet/`, `arrangement/`, `ga/` and `export/`. They can be built in
parallel, and `main.py` wires them together.

## Complexity Tracking

> Constitution deviations accepted for the 2026-10-11 deadline

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| marimo walkthrough notebook (principle V) deferred | The deadline is the same evening, and the notebook is not a graded deliverable. | Writing it tonight would take time from the graded items (code, samples, abstract). It is planned right after submission. |
| `docs/glossary.md` (principle IV) deferred | Same reason. The spec's Context section and the README define the terms for now. | A partial glossary would be inconsistent. It is planned right after submission. |
| `docs/explanation.md` with its Mermaid diagram (principles IV and V) deferred | Same reason. The README keeps the Mermaid pipeline, and the abstract carries the explanation. | — |
