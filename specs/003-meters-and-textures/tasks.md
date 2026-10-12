---
description: "Task list for spec 003, meters and allowed textures"
---

# Tasks: Meters and Allowed Textures

**Input**: Design documents from `specs/003-meters-and-textures/`: [plan.md](plan.md),
[spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md).

**Tests**: The tests are required. Constitution 1.3.0, principle II, is test-first. Each test task
comes before the code it covers, and the test must fail first for the expected reason.

**Order inside a layer**:
1. The Python reference.
2. `uv run src/main.py fixtures`, when parity fixtures change.
3. The JavaScript port.

**Branch**: `002-browser-arranger`. `main` is never touched.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (a different file, and no dependency on an unfinished task).
- **[Story]**: US1 is simple meters, US2 compound meters, US3 allowed textures and US4 irregular
  meters and meter changes.
- Paths are relative to the repository root. `core/` means `arranger/src/core/`, and JS tests are
  in `arranger/tests/`.

---

## Phase 1: Setup

**Purpose**: The test tunes that every meter story uses. These are the project's own tunes,
which may be committed (research R13).

- [X] T001 [P] Write seven original ABC test tunes in `tests/data/meters/`. Each has chord
  symbols on its strong beats, a `T:`, a tempo in quarter notes (`Q:1/4=…`, also for 6/8,
  9/8 and 12/8), `K:` and complete bars, with no pickup, no repeats, and every note on
  the sixteenth grid:
  - `waltz.abc`: M:3/4, 16 bars, parts `P:A` (8 bars) and `P:B` (8 bars), I–IV–V7–I;
  - `polka.abc`: M:2/4, 16 bars;
  - `jig.abc`: M:6/8, 16 bars, eighth-note runs;
  - `slow_twelve.abc`: M:12/8, 8 bars, with a chord change on the 3rd dotted-quarter beat of some
    bars;
  - `five.abc`: M:5/4, 8 bars, chords changing on beat 4;
  - `seven.abc`: M:7/8, 8 bars;
  - `changes.abc`: M:4/4 with inline `[M:2/4]`, `[M:3/4]` and back to `[M:4/4]`, 8 bars.

  Add a header comment `% Written for the chiptune-ga-arranger tests (spec 003).`
- [ ] T002 [P] Add the meter terms to the README (the repository has no `docs/` folder; spec 002 defined
  its terms in a "Terms used here" paragraph of the README, so this follows it): meter, simple meter, compound meter,
  irregular meter, beat grouping, strong beat, time-signature map and allowed values. Each needs
  a one-sentence definition and a 3/4 or 6/8 example.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The `Meter` value type in both languages (data-model "Meter"). It blocks every meter
story. US3 does not need it.

- [X] T003 [P] Write the failing tests in `tests/test_meter.py`:
  - the 9-row table of data-model "Meter" (`bar_beats`, `beats`, `strong`, `steps`);
  - `parse_meter("C") == parse_meter("4/4")`, and `"C|"` is 2/2;
  - the exact error text for `"11/16"` and `"3/8"`, with the bar number;
  - `str(meter)`;
  - `beat_onsets` and `strong_onsets` for 4/4 (`(0, 1, 2, 3)`, `(0, 2)`) and 7/8 (`(0, 1, 2)`,
    `(0,)`);
  - `groups` for 4/4 `((0, 2), (2, 2))`, 5/4 `((0, 3), (3, 2))` and 3/4 `((0, 3),)`;
  - `bar_starts` and `total_beats` for bars of 4/4, 2/4 and 3/4 (`[0, 4, 6]`, 9).
- [X] T004 Implement `src/leadsheet/meter.py`:
  - `Meter` (a frozen dataclass with `numerator` and `denominator`, plus the derived properties
    `bar_beats`, `beats`, `strong` and `steps`);
  - `SUPPORTED_METERS`, `FOUR_FOUR`, `parse_meter(text, bar_number=None)`, `beat_onsets`,
    `strong_onsets`, `groups`, `bar_starts(bars)` and `total_beats(bars)`.

  The module docstring explains beats, strong beats, and simple, compound and irregular meters.
  Add doctests. T003 must pass.
- [X] T005 [P] Write the failing tests in `arranger/tests/meter.test.js`, mirroring T003.
  `parseMeter` throws an `Error` with the same text.
- [X] T006 Implement `core/meter.js`, a port of `meter.py` with frozen objects
  (`{numerator, denominator, barBeats, beats, strong, steps}`) and the same helper names in
  camelCase. Add the module header comment and JSDoc examples. T005 must pass.

**Checkpoint**: meters exist in both languages. No other module uses them yet.

---

## Phase 3: User Story 3 - Keep the fast arpeggios out (Priority: P1) 🎯 MVP

**Goal**: The `allowed` setting limits the values each gene may take, in the command line and in
the app, with checkboxes and tooltips. Defaults give identical results.

**Independent test**:
- Korobeiniki with arp32 disallowed has no arp32 bar.
- With the defaults, the samples and the app's SHA pin are unchanged.

### Tests for User Story 3

- [X] T007 [P] [US3] Write the failing config tests in `tests/test_config.py`:
  - `load_config()["allowed"]` equals the full default of contracts/config.md;
  - `--set 'allowed.p2=["hold","arp16"]'` replaces only `p2`;
  - a run record without `allowed` loads the default;
  - each error message of contracts/config.md (not a list, empty, unknown value, duplicate,
    unknown sub-key).
- [X] T008 [P] [US3] Write the failing GA tests in `tests/test_genome_operators.py`:
  - `allowed_genes(default)` equals `tuple(tuple(range(s)) for s in GENE_SIZES)`;
  - with the default, `random_population(rng, m, n, allowed)` equals today's draw for seed 0;
  - `mutate(..., allowed=default)` equals today's result for a fixed seed and rate 0.3;
  - with arp32 disallowed, no value 2 appears in column P2 over 200 plans and 50 mutation rounds
    at rate 1;
  - a gene with one allowed value never changes at rate 1;
  - mutation stays inside the allowed tuple.
- [X] T009 [P] [US3] Write the failing evolution test in `tests/test_evolution.py`:
  - `evolve` with `GAParams(..., allowed=…)` that disallows arp32 never logs a best plan with
    arp32 (check `best_genome` and `initial_best_genome`) on Korobeiniki, with 30 generations;
  - `GAParams` with the default `allowed` reproduces the committed `samples/korobeiniki-s1`
    best fitness (this test already exists; keep it).
- [X] T010 [P] [US3] Write the failing JS tests in `arranger/tests/genome.test.js`,
  `arranger/tests/operators.test.js` and `arranger/tests/evolution.test.js`:
  - `randomPopulation` and `mutate` with `allowed` omitted, or equal to all values, make the same
    `rng` calls as today (compare against a recorded population for seed 1);
  - a disallowed value never appears;
  - a one-value gene never changes and draws no shift;
  - `createGAParams` rejects an empty allowed list.
- [X] T011 [P] [US3] Write the failing settings tests in `arranger/tests/settings.test.js`:
  - `checkSettings` reports the contracts/config.md messages;
  - the default settings hold `allowed`;
  - the exported run record carries `allowed`, and importing it restores it.

### Implementation for User Story 3

- [X] T012 [US3] Add `allowed` to `configs/default.json` (the contracts/config.md shape) and
  validate it in `src/config.py` (`_check_allowed`, called from `load_config`) with the exact
  messages. T007 must pass.
- [X] T013 [US3] Implement the allowed draws:
  - in `src/ga/genome.py`: `ALL_ALLOWED`, `allowed_genes(allowed)`, and
    `random_population(rng, m, n_bars, allowed=ALL_ALLOWED)`, which draws `rng.integers(0, k)`
    per column and maps it through the tuple;
  - in `src/ga/operators.py`: `mutate(..., allowed=ALL_ALLOWED)`, which draws the shift with
    `high = max(k, 2)`, keeps genes with `k = 1`, and maps positions through the tuple (research
    R12).

  Write the docstrings with doctests. T008 must pass.
- [X] T014 [US3] Add `allowed: tuple[tuple[int, ...], ...] = ALL_ALLOWED` to `GAParams` in
  `src/ga/evolution.py` and pass it to `random_population` and `mutate`. Then pass it on from the
  callers:
  - in `src/main.py`: `allowed_genes(config["allowed"])`;
  - in `src/export/fixtures.py` (`plan_json`);
  - in `src/export/experiments.py`, so the random-search baseline draws allowed values.

  T009 must pass, and so must the whole `uv run pytest`.
- [X] T015 [US3] Port the allowed draws:
  - in `core/genome.js`: `ALL_ALLOWED`, `allowedGenes(allowed)` from value names, and
    `randomPopulation(rng, m, nBars, allowed = ALL_ALLOWED)`;
  - in `core/operators.js`: `mutate(rng, genes, rate, allowed = ALL_ALLOWED)`;
  - in `core/evolution.js`: `createGAParams` accepts and freezes `allowed` and passes it to both.

  T010 must pass, and so must `determinism.test.js`, which holds the Korobeiniki SHA pin.
- [X] T016 [US3] Add `allowed` to `core/settings.js`: defaults from `configs/default.json`,
  validation in `checkSettings` with the same messages, the run record, and import. Pass it from
  `src/runner.js` and `src/worker.js` into `createGAParams`. T011 must pass.
- [X] T017 [US3] Write the failing UI tests in `arranger/tests/settings-panel.test.js` and
  `arranger/tests/settings-form.test.js`:
  - an "Allowed textures" group with 17 checkboxes (5 + 4 + 5 + 3), each with a `.tip`;
  - the arp32 tooltip contains "32nd";
  - unticking writes `settings.allowed`;
  - the three warnings of contracts/config.md appear and disappear;
  - an all-unticked gene shows the validation error.
- [X] T018 [US3] Implement the group in `arranger/src/ui/settings-panel.js` and
  `arranger/src/ui/settings-form.js`. Use one fieldset per channel (P2 harmony, TR bass, NO drums,
  P1 melody octave), labels with readable names, (i) tooltips in the existing `.has-tip`/`.tip`
  style, and the warnings under the group. Add only the minimal styles needed to
  `arranger/style.css`. The "changed setting" marks of the drawer must cover `allowed`.
  T017 must pass.
- [X] T019 [US3] Add an SC-004 test in `tests/test_evolution.py`: for each of the 8 committed
  lead sheets and seeds 1–3, with `max_generations=40` and arp32 disallowed, no plan of the
  final population has arp32. Run it, and mark it `slow` if it takes more than 20 s.

**Checkpoint**: US3 works on its own. Commit, and push the branch.

---

## Phase 4: User Story 1 - Arrange a waltz and other simple meters (Priority: P1)

**Goal**: 2/2, 2/4 (native), 3/4 and 4/4 bars, from ABC and MIDI, are arranged, validated and
exported in their own meter. 4/4 stays byte-identical.

**Independent test**:
- `waltz.abc` and `polka.abc` arrange with no violation, with bars of 3 and 2 beats.
- The 4/4 fixtures keep every value.

### Model, realizers, tables and fitness (Python first)

- [X] T020 [US1] Write the failing tests in `tests/test_textures.py`:
  - every 4/4 realization equals the committed `arranger/tests/fixtures/realizations/korobeiniki.json`;
  - a 3/4 bar with one C chord gives:
    - TR root_fifth (36, 0, 1), (43, 1, 1), (43, 2, 1);
    - TR walking root, third, approach;
    - the octave pump with 6 eighths;
    - NO eighth_beat with kick at 0, snare at 1 and 2, and hi-hats on the other eighths;
    - NO fill with a snare roll at steps 8–11;
    - P2 echo cut at 3;
  - a 2/4 bar gives eighth_beat with kick 0, snare 1;
  - a 2/2 bar gives half_time with kick 0 and hi-hat at 2.

  Use the research R3 table.
- [X] T021 [US1] Add `meter: Meter = FOUR_FOUR` (the last field) to `Bar` in
  `src/leadsheet/model.py`, remove `LeadSheet.beats_per_bar`, and update the docstrings (a bar
  spans `[0, meter.bar_beats)`). Fix every user of `beats_per_bar`:
  - `src/arrangement/assemble.py`, via `bar_starts`;
  - `src/export/input_preview.py`;
  - `src/leadsheet/abc_writer.py`, temporarily: refuse a non-4/4 bar until T031.
- [X] T022 [US1] Make the realizers in `src/arrangement/textures.py` read `bar.meter`, following
  research R3:
  - the echo cut at `bar_beats`;
  - the pump with `2 × bar_beats` eighths;
  - root_fifth on strong and weak beats;
  - walking with the cycle root, third, fifth and then the approach;
  - `realize_no(pattern_gene, meter=FOUR_FOUR)`, which builds the drum steps from the beats and
    the strong beats instead of the `_DRUM_STEPS` table.

  Keep the module docstring's explanation and update its doctests. T020 must pass.
- [X] T023 [US1] Write the failing tests in `tests/test_tables.py` and `tests/test_fitness.py`:
  - `act_no` has shape (n, 5), and every row equals today's vector on Korobeiniki;
  - a 3/4 bar's activity is computed over 12 steps;
  - `fitness` and `criterion_scores` of every committed `plans/*.json` fixture plan are unchanged.
- [X] T024 [US1] Update the tables and the fitness:
  - in `src/ga/tables.py`: per-bar `steps`, `_activity(notes, steps)` and
    `_sounding_grid(notes, steps)`, `act_no` per bar with `realize_no(pattern, bar.meter)`, and
    docstrings;
  - in `src/ga/fitness.py`: `_contrast` reads `tables.act_no[bars, population[:, :, NO]]`; update
    the doctest tables to `act_no=np.zeros((1, 5))`.

  T023 must pass.
- [X] T025 [US1] Write the failing tests in `tests/test_validation.py` and
  `tests/test_assemble.py`:
  - assembling a 4/4, 2/4 and 3/4 lead sheet puts the bars at 0, 4 and 6;
  - `Arrangement.meters` is copied from the bars;
  - a 3/4 TR note at beat 2 that is not a chord tone is allowed, but one at beat 1 is not;
  - a note crossing a 3/4 bar end is reported as "crosses the bar end";
  - every message format is unchanged in 4/4.
- [X] T026 [US1] Implement the per-bar validation and assembly:
  - in `src/arrangement/model.py`: add `meters: tuple[Meter, ...] = ()` to `Arrangement`;
  - in `src/arrangement/assemble.py`: fill `meters` and pass `bar.meter` to `realize_no`;
  - in `src/arrangement/validation.py`: bar starts from the lead sheet, per-bar length, and
    `strong_onsets`.

  T025 must pass.

### Readers and writers (Python)

- [X] T027 [US1] Write the failing tests in `tests/test_abc_reader.py`:
  - `waltz.abc` reads 16 bars of 3/4 with phrase marks as in 4/4;
  - `polka.abc` reads 16 bars of 2/4 (not 8), and a 4-bar phrase lasts 8 beats;
  - `M:C|` reads 2/2;
  - `M:11/16` fails with the contracts/files.md message;
  - a 3/4 bar with 4 beats fails, naming the bar;
  - a pickup still fails;
  - every committed `data/leadsheets/*.abc` reads exactly as its `arranger/tests/fixtures/leadsheets/<id>.json`, plus `meter` 4/4.
- [X] T028 [US1] Implement meters in `src/leadsheet/abc_reader.py`:
  - `_scan_body` records each bar's meter (header `M:`, inline `[M:x]`, body `M:` line; research
    R6);
  - `_check_meter` uses `parse_meter`;
  - `_check_complete_bars` compares each bar with its own `bar_beats`;
  - `_chord_segments` takes each bar's length;
  - `Bar(meter=…)`;
  - update the module docstring (4/4 only → the supported meters).

  T027 must pass.
- [X] T029 [US1] Write the failing tests in `tests/test_midi_reader.py`. Build the files in the
  tests with pretty_midi:
  - `bar_map` on a file with a 3/4 time signature at 0 lists bars every 3 beats;
  - a file without time signatures is 4/4;
  - a 3/4 song reduces to 3-beat bars with one chord per bar (FR-009);
  - a 2/4 song gives 2-beat bars;
  - the default excerpt skips a drum-only count-in (the old `meter_offset_beats` doctest
    scenario: 3/4 count-in, then 4/4);
  - `midi.bars` counts from the file's first bar;
  - `estimate_beat_grid(midi, beats_per_bar=4)` keeps its result on `voa_voa.mid`, if present
    (skip when `data/raw` is missing);
  - the reductions in `arranger/tests/fixtures/midi-songs/*.json` are unchanged, apart from
    `meter`.
- [X] T030 [US1] Implement the time-signature map in `src/leadsheet/midi_reader.py`:
  - `bar_map(midi)` replaces `meter_offset_beats`;
  - the default excerpt runs from the first to the last pitched bar;
  - per-bar offsets in `_quantized_melody`;
  - `_chords` spans from `groups(meter)` (research R9);
  - one dominant meter on an estimated or explicit grid, with a 7/8 refusal;
  - `estimate_beat_grid(..., beats_per_bar=4)`;
  - update the module docstring.

  Update `excerpt_seconds` in `src/export/input_preview.py` to use `bar_map`. Update every
  importer of `meter_offset_beats` (grep `src/` and `tests/`). T029 and `tests/test_input_preview.py`
  must pass.
- [X] T031 [US1] Write the failing round-trip tests in `tests/test_abc_writer.py`:
  - writing then reading `waltz`, `polka` and `changes` gives the same lead sheet;
  - every committed 4/4 lead sheet writes the same text as `arranger/tests/fixtures/abc/*.abc`.

  Then implement `M:` from the first bar and `[M:x]` on changes, with units per bar from the
  meter, in `src/leadsheet/abc_writer.py` (research R10).
- [ ] T032 [US1] Write the failing test in `tests/test_midi_export.py`: a 3/4 arrangement writes
  one 3/4 time signature, and an all-4/4 one writes the same bytes as before (compare
  `samples/korobeiniki-s1/piece.mid` after rerunning its plan). Then write the time signatures
  in `src/export/midi.py` (research R11).
- [ ] T033 [P] [US1] Draw the grey bar lines at `bar_starts` in `src/export/figures.py`:
  `plot_pianoroll` takes the arrangement's `meters`. Add a test in `tests/test_figures.py` that
  checks the line positions for a 3/4 arrangement.
- [ ] T034 [US1] Write the fixtures for the meter tunes in `src/export/fixtures.py` (research
  R13):
  - lead sheets with `"meter": "3/4"` (a string), and no `beats_per_bar`;
  - realizations, tables, `plans/meters-<id>.json` (plan gene `b % size` per column) and the
    `abc/` round trip, for the tunes of `tests/data/meters/`;
  - `act_no` per bar.

  Extend `tests/test_fixtures.py`, then run `uv run src/main.py fixtures`.

### JavaScript port

- [ ] T035 [US1] Write the failing tests in `arranger/tests/leadsheet.test.js` and
  `arranger/tests/textures.test.js`:
  - `leadSheetFromJson` reads `meter` (4/4 when absent);
  - `chordSegments` takes bar lengths;
  - every realization in `fixtures/realizations/*.json`, including the meter tunes, matches.
- [ ] T036 [US1] Port the model and the realizers:
  - in `core/leadsheet.js`: `Bar.meter`, no `beatsPerBar`, `chordSegments(changes, chordTones,
    barBeats)`, and `leadSheetFromJson` with `parseMeter`;
  - in `core/textures.js`: the realizers read `bar.meter`, and `realizeNo(pattern, meter)`.

  T035 must pass.
- [ ] T037 [US1] Write the failing tests in `arranger/tests/tables.test.js`,
  `arranger/tests/fitness.test.js` and `arranger/tests/arrangement.test.js`:
  - the tables match `fixtures/tables/*.json`, with `actNo` as n × 5;
  - the fitness matches every `fixtures/plans/*.json`, including `meters-*`, to 1e-12;
  - validation and assembly follow T025's cases.

  Then port `core/tables.js`, `core/fitness.js` and `core/arrangement.js` (`assemble` fills
  `meters`, and `findViolations` works per bar). Update the hand-built tables in
  `fitness.test.js` and `evolution.test.js` (`actNo` of n × 5).
- [ ] T038 [US1] Write the failing tests in `arranger/tests/abc-reader.test.js` and
  `arranger/tests/abc-writer.test.js`:
  - `waltz` and `polka` read as in the Python fixtures (2/4 is native, not paired);
  - an inline change is read;
  - an unsupported meter gives the shared message;
  - a 3/4 pickup is padded to 3 beats;
  - the writer round trip matches `fixtures/abc/<id>.abc`.

  Then implement them in `core/abc-reader.js` (remove `joinPairs` and `checkSameMeter`; each bar
  gets a meter from abcjs meter elements) and `core/abc-writer.js`.
- [ ] T039 [US1] Write the failing tests in `arranger/tests/midi-song.test.js`:
  - `barMap`;
  - the default excerpt;
  - a 3/4 and a 2/4 synthetic song (build them with `core/midi-file.js` in the test);
  - `countBars` counts the map;
  - the reductions of `fixtures/midi-songs/*.json` still match.

  Then port the map, the excerpt, the chord groups and the estimated-grid meter into
  `core/midi-song.js` (`meterOffsetBeats` removed).
- [ ] T040 [US1] Write the failing test in `arranger/tests/midi-export.test.js` (3/4 time
  signature, 4/4 unchanged; `determinism.test.js` SHA pin unchanged). Then write the time
  signatures in `core/midi-export.js`.
- [ ] T041 [US1] Update the app edges and add tests in `arranger/tests/plain-synth.test.js` and
  `arranger/tests/input-panel.test.js`:
  - `arranger/src/audio/plain-synth.js`: `leadSheetVoices` uses `barStarts`; `beatClock` and
    `midiExcerptVoices` use `barMap`; the duration uses `totalBeats`;
  - `arranger/src/ui/input-panel.js`: the bar range and `excerptTempos` use `barMap`; the
    summary shows the meter(s), for example "3/4" or "4/4, 2/4";
  - `arranger/src/ui/main.js`: `durationBeats` and the preview length use `totalBeats` and the
    map;
  - `arranger/src/ui/plan-grid.js`: the chord row uses bar lengths, if it assumes 4.

**Checkpoint**: US1 is done.
- Run `uv run pytest` and `npm test`.
- Arrange `waltz.abc` from the command line (quickstart §3) with no violation.
- Commit and push.

---

## Phase 5: User Story 2 - Arrange compound meters (Priority: P2)

**Goal**: 6/8, 9/8 and 12/8 work with a dotted-quarter beat.

**Independent test**: `jig.abc` arranges with the kick on eighth 1 and the snare on eighth 4, and
the walking bass plays two dotted quarters.

- [ ] T042 [P] [US2] Write the tests in `tests/test_textures.py`:
  - 6/8 root_fifth gives root at 0 and fifth at 1.5;
  - 6/8 eighth_beat gives kick at step 0, snare at step 6, and hi-hats at 2, 4, 8 and 10;
  - 6/8 walking gives two notes of 1.5;
  - the 12/8 pump has 12 eighths;
  - the 9/8 fill rolls on steps 12–17.

  Fix any rule in `src/arrangement/textures.py` that fails.
- [ ] T043 [P] [US2] Write the tests in `tests/test_abc_reader.py` and `tests/test_midi_reader.py`:
  - `jig.abc` reads 16 bars of 6/8, each 3 quarters;
  - `slow_twelve.abc` reads 8 bars of 12/8;
  - a synthetic 12/8 MIDI song has 6-beat bars and chords on half bars (US2 scenario 3).
- [ ] T044 [US2] Add the synthetic MIDI songs `synthetic-waltz` and `synthetic-twelve-eight` to
  `src/export/fixtures.py`. Build them with pretty_midi from fixed note lists, write them to
  `arranger/tests/fixtures/midi-songs/` (`.mid` and the reduction `.json`), and rerun
  `uv run src/main.py fixtures`.
- [ ] T045 [US2] Write the JS parity tests in `arranger/tests/midi-song.test.js`: the
  synthetic-waltz and synthetic-twelve-eight reductions match the Python JSON. Then fix
  `core/midi-song.js` until they pass. The jig and slow_twelve tables and plan fitness
  already run in T037's loop; confirm that they pass.

**Checkpoint**: US2 is done. Commit.

---

## Phase 6: User Story 4 - Irregular meters and meter changes (Priority: P3)

**Goal**: 5/4 (3 + 2), 7/8 (2 + 2 + 3), and songs whose meter changes.

**Independent test**: `five.abc`, `seven.abc` and `changes.abc`, and a 4/4 → 2/4 → 4/4 MIDI song,
arrange bar by bar with no violation.

- [ ] T046 [P] [US4] Write the tests in `tests/test_textures.py` and `tests/test_validation.py`:
  - 5/4 eighth_beat gives kick at beats 1 and 4, and snare at 2, 3 and 5;
  - 5/4 half_time gives a snare on beat 4;
  - 7/8 root_fifth gives root, fifth, fifth with durations 1, 1 and 1.5;
  - 7/8 walking changes on each group;
  - the arrangement of `changes.abc` validates with bar starts 0, 4, 6, 9 …
- [ ] T047 [P] [US4] Write the tests in `tests/test_midi_reader.py`:
  - a file with 4/4 → 2/4 → 4/4 gives bars of 4, 2, 4 beats;
  - a time signature in mid-bar leaves a short bar, which fails inside the excerpt, naming the
    bar;
  - an estimated grid on a 7/8 file is refused with the file-grid hint.

  Implement any missing case in `src/leadsheet/midi_reader.py`.
- [ ] T048 [US4] Add `synthetic-changes` (4/4 → 2/4 → 4/4) and `synthetic-count-in` (drum-only
  3/4 count-in, then 4/4) to `src/export/fixtures.py`. Then run `uv run src/main.py fixtures`.
- [ ] T049 [US4] Write the JS tests in `arranger/tests/midi-song.test.js`,
  `arranger/tests/abc-reader.test.js` and `arranger/tests/arrangement.test.js`:
  - the synthetic-changes and synthetic-count-in reductions match;
  - `five`, `seven` and `changes` read as in Python;
  - the `changes` arrangement validates.

  Fix the JS core until they pass.

**Checkpoint**: every story is done. Commit and push.

---

## Phase 7: Polish and cross-cutting concerns

- [ ] T050 [P] Update the README's "Method" section (there is no `docs/explanation.md`): a part "Meters" (beats, strong beats, how each
  texture adapts, chord spans) and "Allowed textures" (why arp16 and arp32 tie, and how the GA
  draws only allowed values).
- [ ] T051 [P] Update `README.md`:
  - the app section names the supported meters and the "Allowed textures" setting;
  - the configuration section documents `allowed` with the `--set` example of
    contracts/config.md.
- [ ] T052 [P] Add a short note to `specs/002-browser-arranger/spec.md` under FR-004: "Replaced by
  spec 003 FR-004: 2/4 is read natively." Add a note in its research R11 too.
- [ ] T053 Run a semantic fixture check: a script in the scratchpad loads every
  `arranger/tests/fixtures/**/*.json` at the commit before T034 and now, and compares every
  shared value. The only allowed differences are `meter` (added), `beats_per_bar` (removed) and
  `act_no` (a 1D vector becomes n equal rows). Report the result in the commit message.
- [ ] T054 Rerun `samples/korobeiniki-s1` and `samples/por-voce-s1` from their `config.json`
  with `--no-audio`, and `cmp` their `piece.mid` with the committed ones (quickstart §2). Both
  must be identical.
- [ ] T055 Run quickstart §3 (every meter tune from the command line, no violation) and §4
  (arp32 disallowed). Run the full suites: `uv run pytest`, `npm test`, and
  `uv run ruff check src tests`.
- [ ] T056 Check the app in the built-in browser (quickstart §5): the waltz, the allowed
  textures and their warnings, the downloaded config, and the count-in song. Fix what fails.

---

## Dependencies & Execution Order

- **Setup (T001–T002)**: no dependencies.
- **Foundational (T003–T006)**: blocks US1, US2 and US4. US3 does not need it.
- **US3 (T007–T019)**: independent of the meters. It can start at once and is the MVP.
- **US1 (T020–T041)**: needs Phase 2. Python leads:
  - T020–T026 (core);
  - T027–T033 (readers, writers, export);
  - T034 (fixtures);
  - then the JS tasks T035–T041.
- **US2 (T042–T045)**: needs US1's rules and fixtures command (T022, T034, T039).
- **US4 (T046–T049)**: needs US1 (T026, T030, T034, T039).
- **Polish (T050–T056)**: needs every story.

Inside a phase:
- a test task comes before its implementation;
- Python comes before JavaScript;
- the fixtures come before the JS parity tests.

## Parallel plan (subagents)

| Worker | Tasks | Files |
|---|---|---|
| Main session | T001–T002, T012–T014, T019, then US1 Python core T020–T034 | `tests/data/meters/`, `docs/glossary.md`, `src/**`, `tests/**`, `configs/default.json` |
| Agent A (meter, JS) | T005–T006 after T004 | `core/meter.js`, `tests/meter.test.js` |
| Agent B (allowed, JS core) | T010, T011, T015, T016 after T012 | `core/genome.js`, `core/operators.js`, `core/evolution.js`, `core/settings.js`, `src/runner.js`, `src/worker.js`, tests |
| Agent C (allowed, UI) | T017–T018 after T016 | `ui/settings-panel.js`, `ui/settings-form.js`, `style.css`, tests |
| Agent D (JS core port) | T035–T037 after T034 | `core/leadsheet.js`, `core/textures.js`, `core/tables.js`, `core/fitness.js`, `core/arrangement.js`, tests |
| Agent E (JS readers) | T038–T040 after T034 | `core/abc-reader.js`, `core/abc-writer.js`, `core/midi-song.js`, `core/midi-export.js`, tests |
| Main session (late) | T041, US2, US4, Polish | `audio/plain-synth.js`, `ui/input-panel.js`, `ui/main.js`, `ui/plan-grid.js`, docs |

Rules for parallel agents:
- Each agent owns its files and never commits.
- The main session commits only when no agent is writing, because the pre-commit stash can
  corrupt files that are being written.
- The fixtures (T034) are regenerated and committed before Agents D and E start.
- Another Claude session ("Regras de visualização de dados e avaliação de UI") has committed UI
  work on this branch. Before every commit, check `git status` and `git log`, and stage only the
  files this work changed.

## Implementation strategy

1. **MVP.**
   - Do Phase 1, Phase 2 and US3 (through T019).
   - Commit and push.
   - The student's complaint about the arpeggios is then answered, even if the meter work were
     to stop.
2. **US1.** This is the largest slice. Python first, then the fixtures, then two JS agents in
   parallel.
3. **US2 and US4.** These are small extensions of US1's rules, mostly new tests and synthetic
   files.
4. **Polish.** Check that the samples stay byte-identical (T053, T054), then the docs and the
   browser check.
