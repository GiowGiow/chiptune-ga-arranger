---
description: "Task list for the GA Chiptune Arranger"
---

# Tasks: GA Chiptune Arranger

**Input**: `specs/001-ga-chiptune-arranger/` (plan.md, spec.md, data-model.md, contracts/cli.md,
research.md, quickstart.md)

**Tests**: required by the constitution (principle II, test-first). In every group, the test task
comes before its implementation task. Write the test, run it, see it fail for the expected reason,
then implement. Core functions carry a small doctest.

**Conventions**: code in `src/` (imported as top-level packages, since `pythonpath = ["src"]`),
tests in `tests/`. Run the tests with `uv run pytest`. Units: MIDI pitches, quarter-note beats,
4/4 bars of 4 beats. All randomness comes from a `numpy.random.Generator` passed as a parameter.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [X] T001 Create the packages `src/leadsheet/`, `src/arrangement/`, `src/ga/`, `src/analysis/`, `src/export/`, each with an `__init__.py` that holds a one-paragraph module docstring explaining the package's musical or algorithmic role (constitution IV)
- [X] T002 [P] Create `configs/default.json` with exactly: `population_size` 60, `max_generations` 200, `stagnation_window` 40, `mutation_rate` 0.01, `elite_count` 2, `phrase_length` 4, `tempo_bpm` null, `role_map` {}, `weights` {complementarity 1.0, register 1.0, coherence 1.0, contrast 1.0, bass_smoothness 1.0, idiom 1.0, fidelity 0.5}

---

## Phase 2: Foundational (shared types; blocks every story)

- [X] T003 [P] Write `src/leadsheet/model.py` with the frozen dataclasses of data-model.md: `MelodyNote(pitch: int, onset: float, duration: float)`; `ChordSegment(symbol: str, root: int, tones: tuple[int, ...], onset: float, duration: float)` where `tones` are "pitch classes ordered root, third, fifth, seventh when present"; `Bar(index, melody, chords, label, role, phrase, phrase_end)`, where `role` is `"verse"` or `"chorus"`; `LeadSheet(title, key, tempo_bpm, bars, beats_per_bar=4)`. Add a helper `Bar.chord_at(onset) -> ChordSegment`, which returns the segment that covers `onset`, with a doctest
- [X] T004 [P] Write `src/arrangement/model.py` with `ChannelNote(pitch, onset, duration, velocity)`, `Arrangement(title, tempo_bpm, genome, channels)`, and the constants `CHANNELS = ("P1", "P2", "TR", "NO")`, `PITCH_RANGES = {"P1": (33, 108), "P2": (33, 108), "TR": (21, 108)}`, `P2_ROOT_LOW = 48`, `TR_ROOT_LOW = 28`, the velocities (P1 100, P2 80, echo 60, TR 90) and the drums (kick 36 vel 100, snare 38 vel 90, closed hi-hat 42 vel 60)
- [X] T005 [P] Write the constants in `src/ga/genome.py`: `P2_TEXTURES = ("hold", "arp16", "arp32", "echo", "third")`, `TR_TEXTURES = ("root", "octave_pump", "root_fifth", "walking")`, `NO_PATTERNS = ("none", "half_time", "eighth_beat", "sixteenth_beat", "fill")`, `P1_OCTAVES = (0, 12, -12)`, `GENE_SIZES = (5, 4, 5, 3)`, and the column indices `P2, TR, NO, OCT = 0, 1, 2, 3`

**Checkpoint**: the shared types exist. Groups A, B, C and D of US1 can start in parallel.

---

## Phase 3: User Story 1 - Arrange a lead sheet as an NES piece (P1) 🎯 MVP

**Goal**: `uv run src/main.py arrange <abc> --seed N` writes `outputs/<run-id>/` with `piece.mid`, `piece.mp3`, `pianoroll.png` and `config.json`, and the piece passes every NES rule.

**Independent Test**: arrange `data/leadsheets/korobeiniki.abc` with seed 1 and `--no-audio`, read `piece.mid` back with music21, check the 4 channels and the rules, run it again, and compare the notes.

### Group A: lead sheet (parallel)

- [X] T006 [P] [US1] Tests in `tests/test_chords.py`: `chord_tones("Ebm") == (3, (3, 6, 10))`, `chord_tones("Bbm7") == (10, (10, 1, 5, 8))`, `chord_tones("E") == (4, (4, 8, 11))`, `chord_tones("Am")`, `chord_tones("Dm")` and `chord_tones("C")`; an unknown symbol raises `ValueError`; `place_in_register(pc, low)` returns the only pitch with that pitch class in `[low, low + 11]`
- [X] T007 [P] [US1] Implement `src/leadsheet/chords.py` (with music21 `harmony.ChordSymbol` underneath; tones ordered root, third, fifth, seventh) until T006 passes
- [X] T008 [P] [US1] Tests in `tests/test_abc_reader.py`:
  - `data/leadsheets/korobeiniki.abc` gives 32 bars, tempo 150, labels A×16, B×8, A×8, the roles verse/chorus (B is chorus), 4-bar phrases with `phrase_end` on bars 3, 7, 11…, bar 0 with one chord "E" over `[0, 4)`, and a first melody note of pitch 76, onset 0, duration 1.0.
  - `data/leadsheets/ievan_polkka.abc` gives 24 bars, tempo 110, and bar 0 with the chords Ebm `[0, 2)` and Bbm `[2, 4)`.
  - A bar without a chord symbol inherits the previous chord.
  - Each of these raises `ValueError` with the bar number in the message, on small inline ABC strings: a repeat sign `|:`, an incomplete bar, `M:3/4`, a tune with no chord, an unknown chord.
  - `role_map` and `phrase_length` overrides work.
  - Only the first tune of a multi-tune file is read.
- [X] T009 [P] [US1] Implement `src/leadsheet/abc_reader.py` with `read_lead_sheet(path, phrase_length=4, role_map=None, tempo_override=None) -> LeadSheet` and `read_lead_sheet_text(text, ...)`:
  - Notes and chord symbols come from music21. Each measure is located by its index (music21 numbers the first measure 0).
  - The `P:` labels are read from the ABC text: each `|` on a music line closes one bar, and the labelled bar count must equal the measure count.
  - A melody chord keeps its highest note, and grace notes are dropped.
  - The default role rule is: a label that contains "chorus" (any case) or equals "B" is chorus.
  - A section is one `P:` occurrence, and phrases are chunks of `phrase_length` bars from the section start.
  - Implement until T008 passes.

### Group B: arrangement (parallel)

- [X] T010 [P] [US1] Tests in `tests/test_textures.py`, on hand-built `Bar` objects:
  - P1 octave genes 0/1/2 shift by 0/+12/−12 and fold into 33–108.
  - P2 *hold* gives the root in 48–59 for each segment.
  - P2 *arp16* over C major gives 16 notes cycling 48, 52, 55 (the root C3 in 48–59), restarting at a chord change at beat 2.
  - P2 *arp32* gives 32 notes.
  - P2 *echo* is the melody shifted +0.5, clipped at 4, velocity 60, with nothing before 0.5.
  - P2 *third* gives, for each melody note, the highest chord tone at least 3 semitones below it.
  - TR *root* gives the root in 28–39 for each segment.
  - TR *octave_pump* gives 8 eighths alternating root and root + 12.
  - TR *root_fifth* gives 4 quarters: root, fifth, root, fifth.
  - TR *walking* gives root, third, fifth, then the next bar's first root − 1; in the last bar (`next_bar=None`) the fifth.
  - The NO patterns hit exactly the steps of data-model.md ("kick beats snare beats hi-hat").
  - Every realizer output is monophonic, inside `[0, 4]` and inside its channel range.
- [X] T011 [P] [US1] Implement `src/arrangement/textures.py` with `realize_p1(bar, octave_gene)`, `realize_p2(bar, texture_gene)`, `realize_tr(bar, texture_gene, next_bar)` and `realize_no(pattern_gene)`, which return `tuple[ChannelNote, ...]` with onsets relative to the bar, until T010 passes
- [X] T012 [P] [US1] Tests in `tests/test_validation.py`:
  - a valid arrangement gives `[]`;
  - each of these gives one message naming the channel and bar: an overlap in one channel; a pulse pitch at 32; a TR pitch at 109; a non-chord TR note on beat 3; a non-chord P2 note on beat 1 in a *hold* bar; a note crossing a bar end;
  - a non-chord P2 note on beat 1 in an *echo* bar is allowed.
- [X] T013 [P] [US1] Implement `src/arrangement/validation.py` with `find_violations(arrangement, lead_sheet) -> list[str]` (rules 1–4 of data-model.md) until T012 passes
- [X] T014 [US1] Tests in `tests/test_assemble.py`, then implement `src/arrangement/assemble.py` with `assemble(lead_sheet, genome) -> Arrangement`: absolute onsets (`bar.index * 4 + onset`), exactly the 4 channel keys, the genome stored as a tuple of 4-tuples, and an arrangement built from any valid genome on `korobeiniki.abc` passes `find_violations` (depends on T009, T011, T013)

### Group C: genetic algorithm (parallel)

- [X] T015 [P] [US1] Tests in `tests/test_genome_operators.py`:
  - `random_population(rng, m, n_bars)` has shape `(m, n_bars, 4)`, values `< GENE_SIZES`, and is the same for the same seed.
  - `roulette_select(rng, fitness, n)` with windowing never picks the single lowest individual when the others are higher, is uniform when all values are equal, and returns `n` indices.
  - `elite_indices(fitness, k)` returns the k best.
  - `one_point_crossover(rng, a, b)` cuts between bars: child 1 = `a[:c] + b[c:]`, child 2 = `b[:c] + a[c:]`, with `1 <= c < n_bars`, and returns copies when `n_bars == 1`.
  - `mutate(rng, population, rate)` with rate 0 changes nothing, and with rate 1 changes every gene to a different valid value.
- [X] T016 [P] [US1] Implement `random_population` and `decode` (genes to texture names) in `src/ga/genome.py`, and `roulette_select`, `elite_indices`, `one_point_crossover` and `mutate` in `src/ga/operators.py`, until T015 passes
- [X] T017 [P] [US1] Tests in `tests/test_fitness.py`, on hand-built `ScoreTables` with 2–4 bars, one test per criterion formula of data-model.md:
  - complementarity, register (1 when no overlap), coherence (fill equals anything; 1 with no pairs), contrast (NaN without both roles; clipped), bass_smoothness, idiom (nanmean of the two shares) and fidelity;
  - `fitness` = Σ w·s / Σ w over the applicable criteria, 0 when the weights sum to 0;
  - vectorized over a population.
- [X] T018 [P] [US1] Define the `ScoreTables` dataclass (fields and shapes as in data-model.md) in `src/ga/tables.py`, and implement `criterion_scores(tables, population)` and `fitness(tables, population, weights)` in `src/ga/fitness.py` with numpy indexing, until T017 passes
- [X] T019 [US1] Tests in `tests/test_tables.py`, then implement `build_tables(lead_sheet)` in `src/ga/tables.py`. On a 2-bar hand-built lead sheet: the shapes; `act_p2` is 1.0 for arp16 and arp32, and `act_no` is 0 for none and 1.0 for sixteenth_beat; `reg_both`/`reg_ok` counted on the 16-step grid; `bass_smooth` uses the last TR note of bar i and the first TR note of bar i + 1, with 1 at ≤ 5 semitones, 0 at ≥ 12 and linear in between; the `single_chord`, `phrase_end`, `phrase` and `is_chorus` flags (depends on T011)
- [X] T020 [US1] Tests in `tests/test_evolution.py`, then implement `GAParams`, `GenerationStats(generation, best, mean, diversity)`, `EvolutionResult(best_genome, best_fitness, log, stop_reason, initial_best_genome)` and `evolve(rng, tables, n_bars, params, weights)` in `src/ga/evolution.py`:
  - the same seed gives the same result, and the best never decreases;
  - it stops at `max_generations`, or after `stagnation_window` generations without an improvement greater than 1e-12;
  - generation 0 is logged, and diversity = distinct genotypes / m.
  - (depends on T016, T018)

### Group D: configuration and export (parallel)

- [X] T021 [P] [US1] Tests in `tests/test_config.py`, then implement `src/config.py` with `load_config(path=None, overrides=()) -> dict` and `config_hash(cfg) -> str` (8 hex):
  - the defaults come from `configs/default.json`;
  - `--set weights.contrast=3` and `--set mutation_rate=0.05` parse as JSON;
  - an unknown key raises `ValueError`;
  - the hash does not depend on key order.
- [X] T022 [P] [US1] Tests in `tests/test_midi_export.py`, then implement `src/export/midi.py` with `arrangement_to_midi(arrangement) -> pretty_midi.PrettyMIDI` and `write_midi(arrangement, path)`:
  - instruments named P1, P2, TR, NO with programs 80, 80 and 38, and NO with `is_drum=True`;
  - seconds = beats × 60 / tempo;
  - reading the file back with music21 gives P1 pitches equal to the input.
- [X] T023 [P] [US1] Tests in `tests/test_audio.py` (a missing soundfont returns False and prints a notice, with no exception), then implement `src/export/audio.py` with `render_mp3(mid_path, mp3_path, soundfont) -> bool`: fluidsynth `-ni -q -g 0.4 -r 44100 -F`, then ffmpeg libmp3lame `-qscale:a 4`, then the WAV is deleted. It returns False with a notice when fluidsynth, ffmpeg or the soundfont is missing.
- [X] T024 [P] [US1] Implement `plot_pianoroll(arrangement, path)` in `src/export/figures.py`:
  - one `steps-post` line per pitched channel, with NaN at rests;
  - NO hits as markers in a band below;
  - bar lines;
  - the `tableau-colorblind10` style;
  - a title that states what to see;
  - output to PNG or PDF by file suffix.
  - Add a smoke test (file created, non-empty) in `tests/test_figures.py`.
- [X] T025 [P] [US1] Tests in `tests/test_run_folder.py`, then implement `src/export/run_folder.py` with `make_run_id(input_path, seed, cfg)` = `<stem>-s<seed>-<hash8>`, and `write_config_json(folder, cfg, seed, input_path, extra)`. The latter adds `input_sha256`, `git_commit` and `git_dirty` (from `git rev-parse HEAD` and `git status --porcelain`, `null` outside git), `created` (ISO 8601) and `run_id`.

### Integration

- [X] T026 [US1] Tests in `tests/test_end_to_end.py`:
  - `main.main(["arrange", "data/leadsheets/korobeiniki.abc", "--seed", "1", "--no-audio", "--out", tmp])` writes `piece.mid`, `pianoroll.png` and `config.json`;
  - the MIDI read back with music21 has 4 parts and passes `find_violations` once rebuilt;
  - two runs give identical notes;
  - a missing `--seed` raises `SystemExit` with code 2.
- [X] T027 [US1] Implement the `arrange` command in `src/main.py` (contracts/cli.md):
  1. load the config with `--config` and `--set`;
  2. read the lead sheet;
  3. create `rng = np.random.default_rng(seed)`;
  4. run `build_tables`, then `evolve`, then `assemble`, then `find_violations` (exit 1 listing the violations);
  5. write the MIDI, the audio (unless `--no-audio`), the piano roll and `config.json`;
  6. print the folder, the best fitness and the stop reason.

  Errors print `error: <message>` and exit with 1. Implement until T026 passes.
- [X] T028 [US1] Run `arrange` on `data/leadsheets/korobeiniki.abc` and `data/leadsheets/ievan_polkka.abc` with seed 1, with audio. Check the run time (SC-001: under 2 min) and the MP3 peak level (no clipping). Listen to both, and fix the realizers or the defaults if something sounds broken.

**Checkpoint**: MVP done. Both songs arrange end to end.

---

## Phase 4: User Story 2 - Inspect how the arrangement evolved (P2)

**Goal**: every run also writes `evolution.csv`, `evolution.png`, `evolution.pdf` and `metrics.json`.

**Independent Test**: one run; the CSV has one row per generation and its best column never decreases; `metrics.json` holds the seven criteria for the initial best and the final best.

- [X] T029 [P] [US2] Tests in `tests/test_metrics.py`, then implement `src/analysis/metrics.py` with `channel_metrics(notes, total_beats) -> dict`, which returns `note_count`, `density` (notes per beat), `sounding_fraction`, `pitch_class_histogram` (12 values summing to 1, or all 0), `pitch_entropy` (bits, on the pitch-class histogram), and `interval_histogram` (semitone differences between consecutive notes, as a dict). NO has an empty pitch-class histogram, and its entropy is 0.
- [X] T030 [P] [US2] Implement `plot_evolution(log, path)` in `src/export/figures.py`: best and mean fitness against generation in the top panel, diversity in the bottom panel, `tableau-colorblind10`, a caption-like title, and PNG or PDF by suffix. Add a smoke test in `tests/test_figures.py`.
- [X] T031 [US2] Extend `src/export/run_folder.py` with `write_evolution_csv(folder, log)` (columns `generation,best,mean,diversity`) and `write_metrics_json(folder, arrangement, criteria_initial_best, criteria_final)` (per channel metrics + `genome`), with tests in `tests/test_run_folder.py`
- [X] T032 [US2] Wire T029–T031 into the `arrange` command in `src/main.py`. Extend `tests/test_end_to_end.py`: the files exist, the CSV best column is non-decreasing, and `metrics.json` has 7 criteria in each block.

**Checkpoint**: US2 done.

---

## Phase 5: User Story 3 - Explore variations and curate the deliverables (P3)

**Goal**: three or more curated samples covering both songs, the experiment table and figure, the README and the abstract.

**Independent Test**: quickstart.md §4–5; rebuilding a sample from its README command gives identical notes.

- [X] T033 [US3] Tests in `tests/test_end_to_end.py`, then implement the `sample` command in `src/main.py` (`sample RUN_DIR NAME [--samples DIR] [--figures DIR]`). It copies every run file to `samples/NAME/`, creates `notes.md` (a listening-notes template) when it is missing, and writes `paper/figures/NAME-evolution.pdf` (copy) and `paper/figures/NAME-pianoroll.pdf` (re-plotted from `piece.mid` or kept from the run).
- [X] T034 [US3] Tests in `tests/test_experiments.py` (small GA settings for speed), then implement `src/export/experiments.py` and the `experiment` command in `src/main.py` (FR-029):
  - five seeds, with the pairwise Hamming distance between the final genomes;
  - a random-search baseline with the same number of fitness evaluations as the GA run (the generations actually run × m), with its best fitness;
  - an ablation: one run per criterion with that weight set to 0, reporting the final criteria;
  - outputs `results.csv`, `results.md` (the table for the abstract) and `seeds.pdf`.
- [X] T035 [US3] Run the experiments for both songs (`uv run src/main.py experiment data/leadsheets/<song>.abc --seed 1`), then choose and run at least 3 sample runs with audio that cover both songs and vary the seed and one hyperparameter (for example `--set mutation_rate=0.05` or `--set weights.contrast=3`). Promote them with `sample` to `samples/` and check that each MP3 is under 5 MB.
- [X] T036 [US3] Write `README.md`:
  - the method and the NES constraint;
  - a Mermaid pipeline (lead sheet → score tables → GA → best plan → realizers → validation → MIDI → audio and figures);
  - installation (uv and requirements.txt; fluidsynth, fluid-soundfont-gm, ffmpeg);
  - the exact command of each sample;
  - the samples table (song, seed, what varied, files);
  - the experiment commands;
  - the input sources and licenses (flutetunes.com tune 341 for Ievan Polkka, transposed and with chords from its bass; Korobeiniki as a traditional melody in the Tetris arrangement form; the melodies are public domain, and Loituma's arrangement and the lyrics are not used);
  - the AI usage statement (Claude Code: what it was used for);
  - the deferred items (marimo notebook, glossary, explanation).
- [X] T037 [P] [US3] Export the BibTeX with `python3 ../../tools/refs.py bib tuohy2006gabased carpentier2010solving freitas2011melody phonamnuaisuk1999evolving biles1994genjam ozcan2008genetic kaliakatsos2012interactive loughran2020evolutionary fernandez2013ai donahue2018nes driscoll2009endless collins2007loop donahue2019lakhnes cardoso2024nes ferreira2019learning -o paper/references.bib`. Check the citation sentences against the entries in `../../references/entries/`.
- [X] T038 [US3] Write the abstract in `paper/tp1.tex`, using `ismir.sty`, without editing the official template files. At most 3 pages of content:
  - introduction: the 8-bit cover motivation and the NES idiom as the constraint;
  - related work: the kit in `references/tp1/ga-arranjo-nes.md` §5;
  - method:
    - the representation;
    - every GA element: the genotype; the random initial population; the fitness, a weighted sum of C1–C7 with justifications; roulette with windowing and elitism; one-point crossover at bar boundaries; per-gene mutation at 0.01; and the stopping rule;
    - the parameters;
  - results: the evolution figure (mandatory); the experiment table with seeds, random baseline and ablation; what varied between the samples; listening notes;
  - discussion: limitations (weighted sum versus Pareto, GM timbres versus real chip, 4/4 only); future work.

  Build it with `cd paper && latexmk -pdf tp1.tex`.
- [ ] T039 [US3] Run `uv run pytest` and `uv run ruff check src tests`, regenerate `requirements.txt` through pre-commit, and ask the student before committing. The student makes the repository public and submits on Moodle before 23:59.

**Checkpoint**: deliverables done.

---

## Phase 6: User Story 4 - Animated visualization (P4, optional)

- [X] T040 [US4] Implement `src/export/video.py` and the `video` command in `src/main.py`: matplotlib animation of one glowing step line per channel (layered linewidths and alphas, dark background), revealed up to the current time; muxed with `piece.mp3` through ffmpeg into `piece.mp4`. Render it for one sample, only after T039.

---

## Phase 7: Polish (after submission)

- [ ] T041 Write the deferred items: the marimo notebook in `notebooks/`, `docs/glossary.md`, and `docs/explanation.md` with its Mermaid diagram (constitution IV and V)

---

## Phase 8: Extensions after the first submission-ready version (2026-10-11)

- [X] T042 [P] Tests, then the NES chip synthesizer in `src/export/chip_audio.py` (FR-030): pulse 25% and 12.5% duty, 4-bit triangle, LFSR noise per drum, −3 dBFS peak
- [X] T043 Add `--renderer gm|chip|both` to `arrange` in `src/main.py` and write `piece-chip.mp3` (FR-030)
- [X] T044 Amend the constitution to 1.1.0 (chip renderer, `input.mp3`, MIDI inputs in `data/raw/`)
- [X] T045 [P] Tests, then the MIDI-to-lead-sheet reader in `src/leadsheet/midi_reader.py`: skyline melody, grid snapping, half-bar chord detection, excerpt and sections (FR-031)
- [X] T046 Tests, then `src/export/input_preview.py`; write `input.mid` and `input.mp3` in every run (FR-032)
- [X] T047 [P] Tests, then the video renderer in `src/export/video.py`, plus the `video` command (FR-033)
- [X] T048 Arrange "Voa Voa" (bars 8–56, on the re-estimated beat grid) from `data/raw/chiclete/`, curate it as a sample, and write its listening notes ("Chiclete com Banana" was tried and dropped by the student)
- [X] T049 Render the videos of every sample, then add the comparison tables and a GIF preview to `README.md` (FR-034)
- [X] T050 Update the abstract (`paper/tp1.tex`) with the MIDI inputs, the chip renderer and the new samples, then commit and push

## Dependencies and execution order

- Setup (T001–T002), then Foundational (T003–T005), then US1 groups A, B, C and D in parallel.
- Inside US1: T014 needs T009, T011 and T013; T019 needs T011; T020 needs T016 and T018; T026 and T027 need all of A–D.
- US2 needs US1. US3 needs US2 (the samples include the evolution files). US4 needs US3.

## Parallel plan (subagents)

| Worker | Tasks | Files |
|---|---|---|
| Agent A | T006–T009 | `src/leadsheet/chords.py`, `src/leadsheet/abc_reader.py`, `tests/test_chords.py`, `tests/test_abc_reader.py` |
| Agent B | T010–T013 | `src/arrangement/textures.py`, `src/arrangement/validation.py`, `tests/test_textures.py`, `tests/test_validation.py` |
| Agent C | T015–T018, T020 | `src/ga/genome.py`, `src/ga/operators.py`, `src/ga/fitness.py`, `src/ga/tables.py` (dataclass only), `src/ga/evolution.py`, tests |
| Main session | T021–T025, then T014, T019, T026–T028 | `src/config.py`, `src/export/*`, `src/arrangement/assemble.py`, `src/ga/tables.py` (`build_tables`), `src/main.py` |

## Implementation strategy

1. MVP first: finish Phase 3 and listen to both songs (T028) before anything else.
2. Then US2 (the mandatory evolution figure).
3. Then US3. Samples and README come before the experiments if time runs short, and the abstract must start by 21:30 at the latest.
4. US4 only if time remains after submission-ready.
