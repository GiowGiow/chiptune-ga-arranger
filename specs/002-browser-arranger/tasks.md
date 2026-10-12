---

description: "Task list for spec 002, the browser arranger"
---

# Tasks: Browser Arranger

**Input**: design documents in `specs/002-browser-arranger/`:
- [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
  [data-model.md](data-model.md), [quickstart.md](quickstart.md);
- [contracts/worker-protocol.md](contracts/worker-protocol.md),
  [contracts/files.md](contracts/files.md), [contracts/cli.md](contracts/cli.md).

**Tests**: required. Constitution 1.3.0, principle II:
- Every implementation task follows a test task that must fail first, for the expected reason.
- JavaScript tests use `node:test` and run with `cd arranger && node --test`.
- Python tests use pytest and run with `uv run pytest`.
- The parity fixtures come before the JavaScript modules that compare against them.

**Branch**: `002-browser-arranger`. Never commit to `main`; the student merges.

## Conventions for every JavaScript task

Every JavaScript task follows these rules (constitution IV and "Web App Constraints"):

- **File header**: each module opens with `// @ts-check` and a comment that explains its musical
  or algorithmic idea in plain language. That comment cites the Python module it ports, for
  example `src/ga/fitness.py`.
- **Exports**: every export has a JSDoc comment with `@param` and `@returns` types. A core
  function also shows a small worked example (`@example`), and a test checks the same example.
- **Names**: domain names come from the Python code in camelCase (`phrase_end` → `phraseEnd`,
  `build_tables` → `buildTables`). JSON fixtures keep the Python names.
- **Core purity**: `arranger/src/core/` uses no DOM, Web Audio or `fetch`. Functions that draw
  random numbers take the generator from `core/random.js` as their first parameter.
- **Forbidden in the GA path**: `Math.random`, `Math.exp`, `Math.log`, `Math.pow`,
  `Math.sin`/`Math.cos` and module-level mutable state.
- **Test names** state the behavior in plain language, for example
  `test("roulette never picks the worst plan", …)`.
- **Units**: beats and MIDI pitches in the core. Seconds appear only in `audio/`,
  `core/midi-file.js` and `core/midi-export.js`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task).
- **[Story]**: US1 to US4 (spec.md).

---

## Phase 1: Setup (shared infrastructure)

**Purpose**: the `arranger/` skeleton, the vendored parser, CI and the pre-push hook.

- [X] T001 Create the `arranger/` skeleton.
  - Write `arranger/package.json` with exactly this content:
    `{"name": "chiptune-ga-arranger-web", "private": true, "type": "module", "scripts": {"test": "node --test"}}`.
    It has no dependencies.
  - Write `arranger/version.json` as `{"commit": "dev", "date": null}`.
  - Create empty folders, each holding a `.gitkeep`: `arranger/src/core/`,
    `arranger/src/audio/`, `arranger/src/ui/`, `arranger/tests/fixtures/`, `arranger/data/`.
- [X] T002 [P] Vendor abcjs 6.7.1 into `arranger/vendor/abcjs/`.
  - Run `npm pack abcjs@6.7.1` in the scratchpad.
  - Copy `package/dist/abcjs-basic-min.js` and `package/LICENSE.md` into the folder.
  - Write `arranger/vendor/abcjs/README.md` with the version, the npm tarball URL, the file's
    SHA-256 and the note "MIT; used only for ABC parsing (research R3)".
  - Check that the file passes the 5 MB `check-added-large-files` hook.
- [X] T003 [P] Create `arranger/tests/helpers.js`, exporting:
  - `repoRoot`, the absolute path of the repository;
  - `readFixture(relativePath)`, which parses JSON from `arranger/tests/fixtures/` and turns
    `null` back into `NaN` where a caller asks for it;
  - `assertClose(actual, expected, decimals = 6)`;
  - `loadAbcjs()`, which loads `arranger/vendor/abcjs/abcjs-basic-min.js` through
    `createRequire(import.meta.url)`;
  - `rawMidiPath(relative)`, which returns `null` when `data/raw/<relative>` is missing, so a
    test can call `t.skip("run uv run src/main.py fetch")`.
- [X] T004 [P] Create the page shell `arranger/index.html` and `arranger/style.css`.
  - Copy the `:root` tokens of `listen/index.html`: `--bg #0B0E17`, `--glass`, `--line`,
    `--text`, `--muted`, `--p1 #5F9ED1`, `--p2 #FF800E`, `--tr #CFCFCF`, `--no #FFBC79`,
    `--mono`.
  - Fonts: Inter for text and JetBrains Mono for numbers (Google Fonts, as `listen/`).
  - Sections with ids `input`, `settings`, `evolution`, `result`, `catalog`, `about`.
  - Load `<script type="module" src="src/ui/main.js">`.
  - Footer: the commit from `version.json`, plus links to `../listen/` and the repository.
  - No horizontal scroll at 375 px.
- [X] T005 [P] Create `.github/workflows/pages.yml` (research R9).
  - Job `test`: runs on push and pull_request; `actions/checkout@v4`,
    `actions/setup-node@v4` with node 22, then `cd arranger && node --test`.
  - Job `deploy`: runs only on `main`, needs `test`, has `permissions: pages: write,
    id-token: write`. It writes `arranger/version.json` as
    `{"commit": "${{ github.sha }}", "date": "<UTC ISO time>"}`, then runs
    `actions/upload-pages-artifact@v3` with `path: .` and `actions/deploy-pages@v4`.
  - Add a comment at the top: Pages source must be "GitHub Actions" (quickstart step 7).
- [X] T006 [P] Add a local pre-push hook in `.pre-commit-config.yaml` (constitution workflow).
  - Fields: `id: node-test`, `name: node --test (arranger)`,
    `entry: bash -c 'cd arranger && node --test'`, `language: system`,
    `pass_filenames: false`, `always_run: true`, `stages: [pre-push]`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the Python reference fixtures, `load_config` for run records, and the shared core
modules (random, genome, chords, lead sheet) that every story uses.

**⚠️ No user-story task starts before this phase is done.**

### Python: run records and parity fixtures

- [X] T007 [P] Write failing tests in `tests/test_config.py`.
  - `test_load_config_accepts_a_run_record_and_ignores_its_run_keys`: load
    `samples/korobeiniki-s1/config.json` with `load_config`, and check that the result has no
    `seed` key and that `weights` equals the record's.
  - `test_load_config_accepts_the_web_app_record_with_an_app_section`: build a record in
    `tmp_path` with every run key plus `"app": {"pace": "watch"}`, then load it.
  - `test_load_config_still_rejects_an_unknown_key`: `{"populaton_size": 3}` raises
    `ValueError`.
  - The run keys are: `seed`, `input_path`, `input_sha256`, `git_commit`, `git_dirty`,
    `created`, `run_id`, `best_fitness`, `stop_reason`, `generations`, `audio`, `app`.
- [X] T008 Implement `RUN_RECORD_KEYS` in `src/config.py`.
  - `load_config` drops these keys at the top level of the loaded file before `_merge`.
  - Update the module docstring and the `load_config` docstring.
  - Make T007 pass (contracts/cli.md).
- [X] T009 [P] Write failing tests in `tests/test_fixtures.py` for
  `export.fixtures.write_fixtures(out, samples_dir, sources_path, leadsheets_dir)`. Use a
  `tmp_path` and only 1 sample (`korobeiniki-s1`) and 1 lead sheet, to keep the test fast.
  - `chords.json` maps `"Am"` to `[9, [9, 0, 4]]` and `"Bbm7"` to `[10, [10, 1, 5, 8]]`.
  - `leadsheets/korobeiniki.json` has 32 bars with Python field names (`phrase_end`, `role`,
    `chords[].tones`).
  - `tables/korobeiniki.json` has `act_p2` with shape (32, 5), with NaN written as `null`.
  - `realizations/korobeiniki.json` has, for each bar, every gene value of P1, P2, TR and NO,
    with notes `[pitch, onset, duration, velocity]`.
  - `plans/korobeiniki-s1.json` has `best_plan` (32 × 4), the `scores` of the 7 criteria,
    `fitness` equal to the sample's `best_fitness` within 1e-9, and `arrangement` notes per
    channel.
  - A missing raw MIDI prints a notice and writes no `midi-songs/<id>.json`.
- [X] T010 Implement `src/export/fixtures.py` and the `fixtures` command in `src/main.py`.
  - Defaults: `--out arranger/tests/fixtures`, `--samples samples`,
    `--sources data/sources.json`.
  - Write every file of contracts/files.md "Parity fixtures".
  - The chord list is every symbol in `data/leadsheets/*.abc` plus `Cmaj7`, `Cdim`, `Cdim7`,
    `Cm7b5`, `Caug`, `Csus2`, `Csus4`, `C6`, `Cm6`, `C9`, `Cadd9`, `F#m7`, `Ebmaj7`. Symbols
    that music21 rejects go under `"rejected"`.
  - The plans are recovered by rerunning `evolve` with each sample's `config.json` and seed. The
    command must fail if the fitness differs from `best_fitness`.
  - `midi-songs/<id>.json` holds the pretty_midi instrument summary (index, name, program,
    is_drum, note count, first and last note as `[start, end, pitch, velocity]`) and the reduced
    lead sheet, using the `midi` settings in `data/sources.json`.
  - `abc/<id>.abc` is the `abc_writer` output for each MIDI song.
  - Module docstring and doctests as in the constitution. Make T009 pass.
- [X] T011 Run `uv run src/main.py fetch`, then `uv run src/main.py fixtures`.
  - Check that `du -sh arranger/tests/fixtures` stays under 3 MB.
  - Commit the fixtures. No render may be running (memory: no commit during renders).

### JavaScript: shared core

- [X] T012 [P] Write a failing test, `arranger/tests/random.test.js`.
  - `createRandom(1)` and a second `createRandom(1)` give the same 1,000 `uint32()`.
  - Seeds 1 and 2 differ.
  - `float()` is in [0, 1).
  - `integer(3, 7)` stays in 3..6, and each value appears 20–30% of the time over 10,000 draws.
  - `pickWeighted` never returns an index of weight 0.
  - A seed outside 0..4,294,967,295 or a non-integer seed throws `RangeError`.
  - The first 4 `uint32()` of seed 1 are pinned. Compute the values once from the reference
    algorithm (splitmix32 seeding, 12 discarded outputs, sfc32) and write them into the test.
- [X] T013 Implement `arranger/src/core/random.js` (research R5).
  - Export `createRandom(seed)`, which returns `{uint32, float, integer, pickWeighted}`.
  - Use only `| 0`, `>>>`, `^`, `+` and `Math.imul`.
  - Make T012 pass.
- [X] T014 [P] Write a failing test, `arranger/tests/genome.test.js`, porting the doctests of
  `src/ga/genome.py`:
  - `GENE_SIZES` is `[5, 4, 5, 3]`;
  - the names are `P2_TEXTURES`, `TR_TEXTURES`, `NO_PATTERNS` and `P1_OCTAVES = [0, 12, -12]`;
  - `randomPopulation(rng, 3, 2)` returns a `Uint8Array` of 24 values, each below its gene size;
  - `decode(Uint8Array.of(1, 3, 4, 2))` gives
    `[{p2: "arp16", tr: "walking", no: "fill", p1Octave: -12}]`.
- [X] T015 Implement `arranger/src/core/genome.js`. The plan layout is data-model.md "Plan":
  bar `b` holds genes `4b … 4b+3`. Make T014 pass.
- [ ] T016 [P] Write a failing test, `arranger/tests/chords.test.js`.
  - For every symbol in `fixtures/chords.json`, `chordTones(symbol)` equals the fixture.
  - Every symbol under `"rejected"` throws an `Error` whose message names the symbol.
  - The `placeInRegister` doctests: `(0, 48)` gives 48 and `(1, 50)` gives 61.
- [ ] T017 Implement `arranger/src/core/chords.js`.
  - It parses a root (letter plus `#` or `b`) and a quality table in the order root, third,
    fifth, seventh, matching music21 on the fixtures.
  - Export `chordTones` and `placeInRegister`.
  - Make T016 pass.
- [X] T018 [P] Write a failing test, `arranger/tests/leadsheet.test.js`, porting the doctests:
  - `phraseMarks([1, 1, 1, 1, 1, 1, 2, 2], 4)`;
  - `sectionRole` on `"B"`, `"Chorus 2"` and `"A"`, and with `{A: "chorus"}`;
  - `chordAt`: a C/G bar gives C at 0 and at 1.75, and G at 2.0;
  - `chordSegments([[[2.0, "C"]], [], [[0.0, "F"], [3.0, "G"]]])`, as `_chord_segments` in
    `src/leadsheet/abc_reader.py`;
  - `chordSegments` of bars with no chord at all throws "the tune has no chord symbol".
- [X] T019 Implement `arranger/src/core/leadsheet.js` with `phraseMarks`, `sectionRole`,
  `chordAt`, `chordSegments` and the JSDoc typedefs `MelodyNote`, `ChordSegment`, `Bar` and
  `LeadSheet` (data-model.md). Make T018 pass.

**Checkpoint**: `uv run pytest` and `cd arranger && node --test` are green, and the fixtures are
committed.

---

## Phase 3: User Story 1 - Arrange my own file and hear it as an NES piece (Priority: P1) 🎯 MVP

**Goal**:
1. Drop or pick a file.
2. See the lead sheet.
3. Arrange with the evolution drawn live in a worker.
4. Play the chip render.
5. Download `.mid`, `.config.json` and `.abc`.

**Independent Test**:
1. Open `arranger/` served from the repository root.
2. Drop `data/leadsheets/korobeiniki.abc` and press Arrange. The curve, counters and plan grid
   move, and the run ends by stagnation in about 5 s.
3. Press Play to hear the chip sound.
4. Download the `.mid`. It opens with tracks P1, P2, TR and NO.
5. Repeat with `data/raw/mpb/mulher_de_fases.mid` (track 6, bars 8–40).

### Tests and core for User Story 1

- [ ] T020 [P] [US1] Write a failing test, `arranger/tests/textures.test.js`.
  - For each bar of `fixtures/realizations/korobeiniki.json` and `mulher_de_fases.json`,
    `realizeP1`, `realizeP2`, `realizeTr` (with the next bar) and `realizeNo` give exactly the
    fixture notes.
  - Port the doctests of `src/arrangement/textures.py`:
    - P1 up 12 folds 112 back to 100;
    - hold on C/G gives `[(48, 0), (55, 2)]`;
    - arp16 starts 48, 52, 55, 48;
    - walking C to G gives `[36, 40, 43, 30]`;
    - half_time gives `[(0, 36), (1, 42), (2, 38), (3, 42)]`.
- [ ] T021 [US1] Implement `arranger/src/core/textures.js`, porting `src/arrangement/textures.py`
  and the constants of `src/arrangement/model.py`:
  - `PITCH_RANGES` P1/P2 33–108 and TR 21–108;
  - `P2_ROOT_LOW = 48` and `TR_ROOT_LOW = 28`;
  - velocities 100/80/60/90;
  - drums 36/38/42 with velocities 100/90/60, and the drum priority kick > snare > hi-hat.

  Make T020 pass.
- [ ] T022 [P] [US1] Write a failing test, `arranger/tests/tables.test.js`.
  - For each of the 8 lead sheets in `fixtures/leadsheets/`, `buildTables(leadSheet)` equals
    `fixtures/tables/<id>.json` array by array (6 decimals, `null` as NaN).
  - Port the `bass_line` doctests: the octave pump keeps `[36, 36, 43, 43]`, walking keeps
    every note.
- [ ] T023 [US1] Implement `arranger/src/core/tables.js` (port of `src/ga/tables.py`).
  - Flat typed arrays, with the shapes listed in the header comment.
  - Activity is `min(1, onsets / 16)`; the leap score is `clip((12 − leap) / 7, 0, 1)`.
  - Make T022 pass.
- [ ] T024 [P] [US1] Write a failing test, `arranger/tests/fitness.test.js`.
  - For each of the 10 `fixtures/plans/*.json`, `criterionScores` and `fitness` of the
    sample's `best_plan` (one-plan population, weights from its settings) match the fixture to
    6 decimal places. Use `null` where Python had NaN. This is SC-010.
  - Port the one-bar doctests of `src/ga/fitness.py`:
    - complementarity `[1, 0]`, idiom `[0.5, 1]`, coherence `[NaN, NaN]`;
    - fitness `[0.875, 0.5]`.
- [ ] T025 [US1] Implement `arranger/src/core/fitness.js` (port of `src/ga/fitness.py`).
  - `CRITERIA`, `criterionScores(tables, population, nBars)` and
    `fitness(tables, population, nBars, weights)`, over a flat `Uint8Array` population.
  - Counts are pooled as in Python; NaN marks a criterion that does not apply.
  - Make T024 pass.
- [X] T026 [P] [US1] Write a failing test, `arranger/tests/operators.test.js`.
  - `rouletteSelect` never picks the worst plan of `[0.2, 0.9, 0.9]` in 1,000 draws.
  - With every fitness within 1e-12, it picks each index with similar frequency.
  - `eliteIndices([0.3, 0.9, 0.1, 0.9], 2)` gives `[1, 3]`.
  - `onePointCrossover` keeps the length, cuts between 1 and n − 1, and copies parents of 1 bar.
  - `mutate` at rate 0 changes nothing; at rate 1 it changes every gene to a different valid
    value.
- [X] T027 [US1] Implement `arranger/src/core/operators.js` (port of `src/ga/operators.py`).
  - `TIE_TOLERANCE = 1e-12`.
  - Roulette uses windowing over a cumulative sum and `rng.pickWeighted`.
  - The elite sort is stable.
  - Mutation adds a shift from 1 to size − 1, modulo the size.
  - Make T026 pass.
- [ ] T028 [P] [US1] Write a failing test, `arranger/tests/evolution.test.js`.
  - Port the doctest: two bars with fidelity-only weights give `bestFitness` 1 and octave genes
    `[0, 0]`.
  - `evolve` is a generator that yields one stats object per generation:
    `{generation, best, mean, diversity, stagnation}`.
  - It stops with `"stagnation"` when `stagnation` reaches the window, and with
    `"max_generations"` at the limit.
  - `best` never decreases.
  - Two runs with seed 7 give identical logs and best plans.
  - Calling `.return()` mid-run leaves a result holding the best plan so far.
  - `GAParams` validation: `elite_count` must be in 0..`population_size` − 1.
- [ ] T029 [US1] Implement `arranger/src/core/evolution.js` (port of `src/ga/evolution.py`).
  - `IMPROVEMENT_TOLERANCE = 1e-12`.
  - When the number of free places is odd, drop the second child of the last pair.
  - `diversity` is the share of distinct plans.
  - The result object is `{bestPlan, bestFitness, log, stopReason, initialBestPlan}`.
  - Make T028 pass.
- [ ] T030 [P] [US1] Write a failing test, `arranger/tests/arrangement.test.js`.
  - `assemble(leadSheet, plan)` of each `fixtures/plans/*.json` equals the fixture
    `arrangement` note for note.
  - `findViolations` returns `[]` for those arrangements.
  - It reports an overlap, a P1 pitch of 110 and a bar with an incomplete NO grid. Messages
    name channel and bar, as `src/arrangement/validation.py` does.
- [ ] T031 [US1] Implement `arranger/src/core/arrangement.js`.
  - Port `src/arrangement/assemble.py` and `src/arrangement/validation.py`, including the
    strong-beat chord-tone rule with the echo exception.
  - Make T030 pass.
- [ ] T032 [P] [US1] Write a failing test, `arranger/tests/abc-reader.test.js`, using
  `loadAbcjs()` from `helpers.js`. Cases (research R3):
  - Committed lead sheets: each of the 8 `data/leadsheets/*.abc` read with `phrase_length` 4
    equals `fixtures/leadsheets/<id>.json` bar for bar (melody, chords, label, role, phrase,
    phrase_end, title, key, tempo).
  - Repeats: an inline tune with `|: … :|` and `[1 … :|[2 …` plays out to the same bar order
    as abcjs's `setUpAudio({chordsOff: true})` note sequence.
  - Pickup: a one-quarter pickup gives a first bar with a 3-beat leading rest.
  - 2/4: an `M:2/4` tune of 8 bars gives 4 bars of 4/4.
  - Meter refusal: `M:3/4` throws an error whose message contains "3/4".
  - Missing chords: a tune without chord symbols throws "the tune has no chord symbol".
  - Several tunes: `listTunes(text)` of a two-tune file gives 2 titles.
  - Notes:
    - a tie gives one merged note;
    - a triplet `(3abc` in an eighth-note tune gives onsets in thirds of a beat with no
      float noise;
    - `[CEG]` keeps G.
  - Tempo: `Q:1/4=132.500055` gives tempo 132.500055.
  - Chord names: chord symbols stay ASCII (`F#m`, `Bb`).
- [ ] T033 [US1] Implement `arranger/src/core/abc-reader.js`.
  - Export `listTunes(ABCJS, text)` and
    `readLeadSheetAbc(ABCJS, text, {tuneIndex, phraseLength, roleMap, tempoOverride})`.
  - Follow research R3 steps 1–9:
    - prepend `%%freegchord true`;
    - call `setUpAudio` only to fill `midiPitches`;
    - walk the first voice;
    - work in integer ticks at 480 per quarter;
    - merge ties, keep the top note of a chord, give grace notes no time;
    - expand repeats and endings;
    - read a decimal `Q:` from the text;
    - pad the pickup, join 2/4 in pairs.
  - Errors are `Error` objects whose message names the bar when it can.
  - The header comment states the known limits of R3.
  - Make T032 pass.
- [ ] T034 [P] [US1] Write a failing test, `arranger/tests/midi-file.test.js`.
  - Writing then reading a 2-track file gives back the same notes, names, programs, tempo and
    480 ticks per quarter.
  - pretty_midi semantics, on hand-built byte arrays:
    - notes before a program change go to a straggler instrument;
    - a note-off closes every open note of that pitch and channel except zero-length ones;
    - running status is read;
    - a tempo change mid-file maps ticks to the right seconds;
    - `timeToTick` inverts `tickToTime`.
  - For each `fixtures/midi-songs/<id>.json`, reading `data/raw/<path>` gives the same
    instrument summary. Skip when the raw file is missing.
- [ ] T035 [US1] Implement `arranger/src/core/midi-file.js`.
  - Export `readMidiFile(bytes)`, which returns
    `{resolution, tempoChanges, timeSignatures, instruments: [{name, program, isDrum, notes: [{start, end, pitch, velocity}]}], timeToTick, tickToTime}`.
  - Export `writeMidiFile({resolution, tempoBpm, timeSignature, tracks})`.
  - Follow research R4. Make T034 pass.
- [ ] T036 [P] [US1] Write a failing test, `arranger/tests/midi-song.test.js`.
  - Port the doctests of `src/leadsheet/midi_reader.py`:
    - `skyline([[0, 2, 60], [0, 1, 64], [1, 2, 62]])`;
    - `detectChord` of C-E-G weights with bass 0 gives `"C"`;
    - `gridStrength` at 120 BPM rounds to 1.0 and at 97 BPM is below 0.5.
  - For each of the 5 public MIDI songs, `readLeadSheetMidi` with the `midi` settings of
    `data/sources.json` equals `fixtures/midi-songs/<id>.json`'s lead sheet bar for bar (SC-006).
    Skip without the raw file.
  - `suggestMelodyTrack` ranks the recorded `melody_track` first or second for each of those
    songs (research R11).
  - A file with a 3/4 time signature throws an error that names "3/4"; 2/4 is accepted.
- [ ] T037 [US1] Implement `arranger/src/core/midi-song.js` (port of
  `src/leadsheet/midi_reader.py`).
  - Constants: `GRID = 0.25`, `CHORD_SPAN = 2`, the `QUALITIES` table,
    `BASS_TRACK_MAX_MEAN_PITCH = 50`, `FILE_GRID_MIN_STRENGTH = 0.8`, and `TEMPO_SEARCH` from
    60 to 200 BPM by 0.05.
  - Export `describeTracks(midi)`, `suggestMelodyTrack(tracks)` and
    `readLeadSheetMidi(midi, {melodyTrack, phraseLength, roleMap, bars, sections, tempoOverride, grid})`.
  - Validate as in data-model.md "Settings":
    - `midi.bars`: "0 ≤ first < end ≤ barCount and end − first ≤ 128";
    - `midi.sections`: "bars inside the excerpt; strictly increasing".
  - Make T036 pass.
- [ ] T038 [P] [US1] Write a failing test, `arranger/tests/settings.test.js`.
  - `defaultSettings(defaultConfigJson)` adds `seed: 1`.
  - `validateSettings` returns one message per invalid field, naming the field and its range as
    in data-model.md "Settings":
    - `population_size` "≥ 2";
    - `elite_count` "0 to population_size − 1";
    - `mutation_rate` "0 to 1";
    - `max_generations`, `stagnation_window` and `phrase_length` "≥ 1";
    - `tempo_bpm` "null, or 20 to 400";
    - weights "finite, ≥ 0; at least one > 0";
    - `seed` "0 to 4,294,967,295".
  - `runId("mulher-de-fases.mid", settings)` matches `/^mulher-de-fases-s1-[0-9a-f]{8}$/`, and it
    does not change when the key order changes.
  - `configRecord(...)` has exactly the keys of contracts/files.md `<run id>.config.json`.
- [ ] T039 [US1] Implement `arranger/src/core/settings.js`.
  - Canonical JSON uses sorted keys. The hash uses `crypto.subtle.digest("SHA-256")`, which is
    async in both browser and Node.
  - Make T038 pass.
- [ ] T040 [P] [US1] Write a failing test, `arranger/tests/midi-export.test.js`.
  - `arrangementToMidi(arrangement)` writes format 1 at 480 ticks per quarter, with tempo and a
    4/4 time signature.
  - The tracks are P1, P2, TR and NO, on channels 0, 1, 2 and 9, with programs 80, 80, 38 and 0.
  - Reading the file back with `readMidiFile` gives the arrangement's notes in seconds.
  - Write `arranger/tests/fixtures/web/korobeiniki-s1.mid` from the plan fixture when
    `process.env.WRITE_WEB_FIXTURES` is set.
- [ ] T041 [US1] Implement `arranger/src/core/midi-export.js` (contracts/files.md `.mid`).
  - Make T040 pass.
  - Then run `WRITE_WEB_FIXTURES=1 node --test tests/midi-export.test.js` and commit
    `fixtures/web/korobeiniki-s1.mid`.
- [ ] T042 [P] [US1] Write a failing pytest, `tests/test_web_midi.py`. pretty_midi reads
  `arranger/tests/fixtures/web/korobeiniki-s1.mid`, and its instrument names and notes equal
  `arrangement_to_midi(assemble(lead_sheet, plan))` of the same plan (contracts/files.md: "The
  CLI's pretty_midi reads the file back").
- [ ] T043 [P] [US1] Write a failing test, `arranger/tests/abc-writer.test.js`. For each
  `fixtures/abc/<id>.abc`, `writeLeadSheetAbc(fixtureLeadSheet, meta)` gives the same text after
  the header comment lines.
- [ ] T044 [US1] Implement `arranger/src/core/abc-writer.js` (port of
  `src/leadsheet/abc_writer.py`). Make T043 pass.
- [ ] T045 [P] [US1] Write a failing test, `arranger/tests/chip-synth.test.js`.
  - A P1 note of 1 s at 44,100 Hz is high for 25% ±1% of its samples, and a P2 note for 12.5%.
  - The triangle uses exactly 16 levels.
  - The long-mode LFSR repeats after 32,767 steps and the short mode after 93.
  - A note lasts `duration × 60 / tempo` seconds of samples, with 2 ms fades.
  - The mix peaks at -3 dBFS within 0.01 dB.
  - The same arrangement renders identical samples twice.
  - Empty channels give silence.
- [ ] T046 [US1] Implement `arranger/src/audio/chip-synth.js` (port of
  `src/export/chip_audio.py`, research R7).
  - Export `renderChip(arrangement, sampleRate)`, which returns a `Float32Array`.
  - Same constants: `NOISE_PERIODS`, `PULSE_DUTY`, `CHANNEL_GAINS`, `DRUM_SOUNDS`,
    `FADE_SECONDS` and `TRIANGLE_STEPS`.
  - Make T045 pass.
- [ ] T047 [P] [US1] Write a failing test, `arranger/tests/runner.test.js`, for
  `createRunner({post, now, sleep})` (contracts/worker-protocol.md):
  - a `run` message produces `started`, then one or more `progress` messages, then `done`;
  - the union of `progress.generations` covers every generation once, in order;
  - with a fake clock, `pace: "watch"` reaches generation g no earlier than g / 400 s;
  - `"watch"` and `"full"` give the same `bestPlan` and log;
  - `stop` gives `done` with `stopReason: "stopped"` before the next slice ends;
  - invalid settings give `error`;
  - a second `run` cancels the first, which never sends `done`.
- [ ] T048 [US1] Implement `arranger/src/runner.js` and the thin adapter
  `arranger/src/worker.js`.
  - `runner.js` builds tables, drives the `evolve` generator in slices of at most 8 ms, batches
    `progress` at most every 50 ms and handles stop, pace and cancel.
  - `worker.js` wires `self.onmessage` and `self.postMessage` to `createRunner`.
  - Make T047 pass.
- [ ] T049 [US1] Write an end-to-end test, `arranger/tests/determinism.test.js` (SC-005).
  - Run `readLeadSheetAbc(korobeiniki)`, then the runner at `"full"` pace with seed 1, then
    `assemble`, then `arrangementToMidi`, twice. The bytes must be equal.
  - Pin the SHA-256 of these bytes in the test, so an engine or code change shows up. Update the
    pin only on purpose.

### Page for User Story 1

- [ ] T050 [P] [US1] Write a failing test, `arranger/tests/examples.test.js`, for
  `arranger/src/ui/examples.js`.
  - It lists the 8 files of `data/leadsheets/`, with title and artist from `data/sources.json`,
    or "Traditional" for `korobeiniki` and `ievan_polkka`.
  - The MIDI-song examples carry the README's settings
    `{max_generations: 4000, stagnation_window: 400}`.
  - Every listed path exists in the repository.

  Then implement `examples.js`.
- [ ] T051 [US1] Implement `arranger/src/ui/input-panel.js` (FR-001 to FR-007).
  - A drop zone and a file picker. The kind comes from the `MThd` magic bytes.
  - SHA-256 through Web Crypto.
  - `loadAbcjs()`, which injects `<script src="vendor/abcjs/abcjs-basic-min.js">` once and
    resolves `globalThis.ABCJS`.
  - A tune picker for files with several tunes, and the examples list.
  - For MIDI: a track table (name, program, notes, range, polyphony) with the suggested melody
    track preselected, a bar range of 64 bars by default (128 maximum), and a section editor of
    rows "bar, label".
  - A lead-sheet summary: title, tempo, bar count, parts and the chord of every bar.
  - Errors keep the previous input and show the message.
- [ ] T052 [P] [US1] Implement `arranger/src/ui/evolution-view.js` (FR-014).
  - A canvas line chart: best in `--p1` and mean in `--muted`, generation on x and fitness on y.
  - Counters "generation g / max" and "stagnation s / window", as text and a bar.
  - A caption that states what to see.
  - It redraws on `progress` messages, throttled with `requestAnimationFrame`.
- [ ] T053 [P] [US1] Implement `arranger/src/ui/plan-grid.js`.
  - 4 rows (P2, TR, NO, P1 octave) by n bars, each cell colored by its channel color with the
    gene value as lightness.
  - It updates from `bestPlan` on every `progress`.
- [ ] T054 [P] [US1] Implement `arranger/src/audio/player.js`, single-buffer version.
  - Create the `AudioContext` on the first Play tap.
  - Play, pause and seek with an `AudioBufferSourceNode`.
  - A playhead clock function `currentTime()`.
  - Keyboard: space plays and pauses.
- [ ] T055 [P] [US1] Implement `arranger/src/ui/downloads.js` (FR-024, FR-025, FR-027).
  - Three buttons make Blob downloads named `<run id>.mid`, `<run id>.config.json` and
    `<run id>.abc`.
  - The config record gets `git_commit` from `version.json`.
- [ ] T056 [US1] Implement `arranger/src/ui/main.js`, which wires everything.
  - Load `version.json` and `../configs/default.json`.
  - Create the module worker with `new Worker("src/worker.js", {type: "module"})`.
  - The run state machine of data-model.md "Run state": a new file during a run cancels it.
  - Arrange and Stop buttons, and a default pace of "watch".
  - On `done`:
    1. `assemble` the plan;
    2. run `findViolations`, and on any violation show it and do not play (FR-018);
    3. render with `renderChip` at the context sample rate;
    4. show the best fitness, the criterion scores (with "not applicable" for `null`) and the
       stop reason (FR-016, FR-017).
- [ ] T057 [US1] Check it by hand: serve the repository root, then run quickstart.md rows 1, 2,
  3, 5, 6, 9 and 10. Fix what fails.

**Checkpoint**: User Story 1 works end to end. This is the MVP.

---

## Phase 4: User Story 2 - Tune the settings and reproduce a run (Priority: P2)

**Goal**: every hyperparameter is editable and explained, validation names the problem, the
settings import and export, and the last 5 runs can be compared.

**Independent Test**:
1. Arrange Ievan Polkka with seed 1 and note the plan.
2. Reload, arrange again, and see the same plan.
3. Set fidelity to 0 and see P1 octave changes in the grid.
4. Set the population to 1 and see the message.
5. Export the settings, change some, and import them back.

- [ ] T058 [P] [US2] Write a failing test, `arranger/tests/settings-form.test.js`, for the pure
  helpers in `arranger/src/ui/settings-form.js`.
  - `formToSettings(fields)` parses text inputs to numbers or `null` and keeps the other fields.
  - `importConfig(json, defaults)` restores every setting and the seed from a downloaded
    `config.json`. It ignores the run keys and rejects an unknown key with "unknown
    configuration key <name>", as `src/config.py` does.
  - `changedSettings(settings, defaults)` lists the dotted keys that differ.
- [ ] T059 [US2] Implement `arranger/src/ui/settings-form.js`. Make T058 pass.
- [ ] T060 [US2] Implement `arranger/src/ui/settings-panel.js` (FR-008 to FR-012).
  - One field for each Settings row of data-model.md.
  - Each field has a one- or two-sentence explanation. Take the texts from README section
    "Hyperparameters and what the samples change" and from the "Reading the settings" panel of
    `listen/index.html`.
  - Inline validation messages from `validateSettings`, and the Arrange button disabled while
    any is shown.
  - Buttons: "Reset to defaults", "Export settings" (a config without run keys) and
    "Import settings".
  - A pace switch, watch or full speed (FR-014).
  - During a run: "changes apply to the next run".
- [ ] T061 [P] [US2] Write a failing test, `arranger/tests/runs.test.js`, for
  `arranger/src/ui/run-list.js`. The list keeps the last 5 runs, newest first, drops the
  oldest, and gives each run its changed settings and best fitness.
- [ ] T062 [US2] Implement `arranger/src/ui/run-list.js` and its view `arranger/src/ui/runs.js`
  (FR-019).
  - Changed settings appear as orange chips, as on `listen/`.
  - A click on a run restores its arrangement, plan grid and curve for playback.
  - Make T061 pass.
- [ ] T063 [US2] Check it by hand: quickstart.md rows 7, 8 and 13.

**Checkpoint**: US1 and US2 work on their own.

---

## Phase 5: User Story 3 - Compare with the original and see the channels (Priority: P2)

**Goal**: A/B between the original and the arrangement at the same position, channel lines
revealed with the playhead, and plan-grid labels.

**Independent Test**: arrange Mulher de Fases, play, and switch A/B three times. The position
never jumps and the drawing matches the sound.

- [ ] T064 [P] [US3] Write a failing test, `arranger/tests/plain-synth.test.js`.
  - `renderLeadSheet(leadSheet, sampleRate)` lasts `bars × 4 × 60 / tempo` seconds.
  - It has energy in the melody band and in the chord band.
  - `renderMidiExcerpt(midi, grid, bars, tempo, sampleRate)` lasts the excerpt's beats at the
    run tempo.
  - Drum notes become noise bursts.
  - Both renders are deterministic.
- [ ] T065 [US3] Implement `arranger/src/audio/plain-synth.js` (research R7).
  - Melody as a soft triangle, chords as a quiet three-note pad.
  - MIDI tracks: a triangle below MIDI 48 and a softened square above.
  - Drums as noise bursts.
  - Everything on the beat timeline.
  - Make T064 pass.
- [ ] T066 [P] [US3] Write a failing test, `arranger/tests/loudness.test.js`.
  - Gated RMS over 400 ms blocks with an absolute gate at -70 dBFS.
  - `matchLoudness(a, b)` brings two renders 12 dB apart to within 0.5 dB of each other.
  - Neither peaks above -1 dBFS.
- [ ] T067 [US3] Implement `arranger/src/audio/loudness.js`. Make T066 pass.
- [ ] T068 [US3] Extend `arranger/src/audio/player.js` to A/B (FR-022).
  - Two sources started at the same `when`, each through its own gain node.
  - `switchTo("original" | "arrangement")` ramps the gains in 10 ms.
  - A seek restarts both at the same offset.
  - Keys: "a" and "b" switch, the arrows seek ±2 s.
- [ ] T069 [P] [US3] Write a failing test, `arranger/tests/channel-paths.test.js`. Port the
  tests of `tests/test_video.py`:
  - `channelPaths` gives step lines with gaps at rests;
  - `visibleUntil` reveals up to the playhead and keeps the note that enters from the left;
  - `soundingPitch` is `null` in rests.
- [ ] T070 [US3] Implement `arranger/src/ui/channel-paths.js` (pure) and
  `arranger/src/ui/channel-view.js` (canvas, FR-023).
  - A scrolling window of 8 s.
  - Arrangement: one line per channel in `--p1`, `--p2`, `--tr` and `--no` (NO as ticks).
  - Original: the melody in `--p1` and the other tracks as faint lines.
  - Drawing is driven by `player.currentTime()`.
  - Make T069 pass.
- [ ] T071 [US3] Add labels to `arranger/src/ui/plan-grid.js` (US3, acceptance 3).
  - Gene names "hold", "arp16", "arp32", "echo", "third", "root", "octave pump",
    "root-fifth", "walking", "none", "half time", "8th beat", "16th beat", "fill", "0", "+12"
    and "−12", shown on hover or focus and in a legend.
  - Part labels above the bars where a part starts.
- [ ] T072 [US3] Check it by hand: quickstart.md row 4.

**Checkpoint**: US1, US2 and US3 work on their own.

---

## Phase 6: User Story 4 - Find a song in the MPB MIDI catalog (Priority: P3)

**Goal**: search 3,671 catalog songs by title, composer or performer, then download from the
catalog and drop the file in, with the credit kept (FR-029 to FR-032).

**Independent Test**:
1. Search "fases" and pick "Mulher de Fases".
2. Follow the two steps and drop the saved file.
3. The credit and the page link appear.
4. Arrange with track 6.

- [X] T073 [P] [US4] Write a failing test, `tests/test_catalog_pages.py`, on synthetic HTML in
  the structure of research R8. Do not copy the site's pages.
  - `parse_index(html, base_url)` reads a row
    `<a href="mpb_m/mulher-de-fases.html" class="BB"><b>MULHER DE FASES</b></a> &nbsp;Dig&atilde;o e Rodolfo`
    into title "MULHER DE FASES", composers "Digão e Rodolfo" and an absolute page URL.
  - A medley joined by `&bull;` reads as "MULHER BOA ERA A MARIA • MADRUGADEIRO".
  - `parse_song_page(html, page_url)` reads the performer "Raimundos" from
    `<title>MULHER DE FASES - Raimundos - MIDI e Letra da M&uacute;sica - Lyric`, and the MIDI
    link `som/mulher-de-fases.mid` as an absolute URL.
  - A page with no `.mid` link gives an empty list.
- [X] T074 [US4] Implement `src/catalog/__init__.py` and `src/catalog/pages.py`.
  - Standard library only: `html.parser` and `html.unescape`.
  - The module docstring explains the catalog and its credit.
  - Make T073 pass.
- [X] T075 [P] [US4] Write a failing test, `tests/test_catalog_crawl.py`, with an injected fake
  `fetch(url)` and `sleep(seconds)`.
  - `crawl(letters, cache_dir, delay, fetch, sleep)` sleeps `delay` between real fetches, and
    never fetches a cached page twice.
  - A failing page is skipped and counted.
  - An entry without MIDI is dropped and counted.
  - `delay < 1.0` raises `ValueError`.
  - `write_catalog(entries, path)` writes the JSON of contracts/files.md, sorted by title
    ignoring accents and letter case.
- [X] T076 [US4] Implement `src/catalog/crawl.py` and the `catalog` command in `src/main.py`
  (contracts/cli.md).
  - Use `urllib.request` with the `USER_AGENT` from `src/leadsheet/sources.py`.
  - Cache in `data/raw/catalog/`.
  - Print progress every 100 pages.
  - Make T075 pass.
- [ ] T077 [US4] Build the catalog.
  1. Run `uv run src/main.py catalog --letters "0-9"` and check the 12 entries by eye.
  2. Run `uv run src/main.py catalog` in the background (about 3,700 requests, about 62
     minutes at 1 request per second).
  3. Commit `arranger/data/catalog.json` and check that it stays under 1 MB.
- [ ] T078 [P] [US4] Write a failing test, `arranger/tests/catalog.test.js`, for
  `arranger/src/core/catalog.js`.
  - `searchKey` gives "mulher de fases digao e rodolfo raimundos".
  - `search(index, "voce")` finds "Você".
  - The ranking is title prefix, then title substring, then composer or performer, then
    alphabetical.
  - At most 50 results, and nothing below 2 characters.
  - `matchDroppedFile("mulher-de-fases.mid", entry)` is true, and `"other.mid"` is false.
- [ ] T079 [US4] Implement `arranger/src/core/catalog.js`. Make T078 pass.
- [ ] T080 [US4] Implement `arranger/src/ui/catalog-panel.js` (FR-029 to FR-032).
  - Fetch `data/catalog.json` the first time the panel opens.
  - A search box that shows results while typing, each with title, composers and performer.
  - When an entry is picked, show the two steps:
    1. a link to the MIDI with `target="_blank" rel="noopener"`, labeled "Open the MIDI on
       the catalog site";
    2. "Drop the saved file here".
  - On a matching drop, the input shows "From Beatriz Kauffmann's Web Site" and the song page
    link, and `config.json` records `app.catalog_page`.
  - If the catalog file is missing, show an error and keep the rest of the app working.
- [ ] T081 [US4] Check it by hand: quickstart.md rows 11 and 12.

**Checkpoint**: all four stories work.

---

## Phase 7: Polish and cross-cutting concerns

- [ ] T082 [P] Implement `arranger/sw.js` and its registration in `arranger/src/ui/main.js`
  (FR-035, research R10).
  - Precache the app shell, `vendor/`, `../configs/default.json` and the 8 examples.
  - Serve cache-first, and cache `data/catalog.json` at run time.
  - The cache name holds the commit from `version.json`, and `activate` deletes old caches.
  - Check: quickstart.md row 14.
- [ ] T083 [P] Make a phone-width and keyboard pass in `arranger/style.css` and `arranger/src/ui/*`
  (FR-036, FR-037).
  - No horizontal scroll at 375 px.
  - Visible focus rings, and every control reachable with Tab.
  - `aria-label` on the canvases, with a text summary next to each.
  - `prefers-reduced-motion` stops the animated background.
  - Check: quickstart.md row 15.
- [ ] T084 [P] Write the About section in `arranger/index.html` (FR-028, FR-032, FR-033).
  - The app has its own random generator: the same seed in the CLI gives a different, equally
    valid arrangement.
  - Files never leave the device.
  - Credit for the catalog, and the abcjs license line.
- [ ] T085 [P] Add the link to the app on `listen/index.html`: a hero pill "Arrange your own song"
  pointing to `../arranger/`.
- [ ] T086 Write the README section "Arrange your own song in the browser" in `README.md`.
  - What the app does, and the link.
  - How to run it locally.
  - `cd arranger && node --test` and `uv run src/main.py fixtures`.
  - The catalog command and its credit.
  - The FR-028 difference.
  - A short glossary of the terms this feature introduces: seeded generator (sfc32), Web
    Worker, skyline, beat grid, A/B.
- [ ] T087 Run quickstart.md sections 1–5 in full, and the privacy check of section 5 in
  Chrome, Firefox and Safari or Edge.
  - Record the outcome and the three MIDI hashes of section 2 in
    `specs/002-browser-arranger/quickstart.md`, under a new "Results" heading.
  - Fix what fails.
- [ ] T088 Mark every finished task here as `[X]`.
  - Run `uv run pytest` and `cd arranger && node --test`.
  - Push the branch.
  - Ask the student to review and merge, which includes switching Pages to "GitHub Actions".

---

## Dependencies and execution order

### Phase dependencies

- Setup (T001–T006): no dependencies. T002–T006 run in parallel after T001.
- Foundational (T007–T019):
  - T007→T008 and T009→T010→T011 can run while the JavaScript tasks T012–T019 run.
  - T011 must finish before any test that reads fixtures (T016 needs `chords.json`).
  - T012→T013, T014→T015, T016→T017 and T018→T019 are independent pairs.
- US1 (T020–T057) depends on Foundational.
- US2 (T058–T063) depends on the US1 core and page (T039, T056).
- US3 (T064–T072) depends on the US1 core and player (T037, T054, T056).
- US4 (T073–T081):
  - the Python side (T073–T077) depends only on Setup and can start at any time;
  - the app side (T078–T080) needs T051 for the drop.
- Polish (T082–T088) runs after the stories it touches.

### Inside User Story 1

- Tests come before implementation in each pair: T020→T021, T022→T023, … T047→T048.
- `textures.js` (T021) comes before `tables.js` (T023) and `arrangement.js` (T031).
  `abc-writer.js` (T044) needs only `leadsheet.js`.
- `tables.js` comes before `fitness.js` (T025), then `evolution.js` (T029), then `runner.js`
  (T048).
- `midi-file.js` (T035) comes before `midi-song.js` (T037) and `midi-export.js` (T041), and
  T041 comes before T042.
- `abc-reader.js` (T033), `runner.js` (T048), `arrangement.js` (T031) and `midi-export.js`
  (T041) come before T049.
- The page tasks T050–T055 can run in parallel once the core is done. T056 wires them, and
  T057 checks them.

## Parallel plan (subagents)

| Worker | Tasks | Files |
|---|---|---|
| Main session | T001, then T007–T011 (Python fixtures), then T050–T057 (page) | `arranger/package.json`, `src/config.py`, `src/export/fixtures.py`, `src/main.py`, `arranger/src/ui/*` |
| Agent A (setup) | T002–T006 | `arranger/vendor/abcjs/`, `arranger/tests/helpers.js`, `arranger/index.html`, `arranger/style.css`, `.github/workflows/pages.yml`, `.pre-commit-config.yaml` |
| Agent B (GA engine) | T012–T015, then T026–T029, T047–T048 | `core/random.js`, `core/genome.js`, `core/operators.js`, `core/evolution.js`, `src/runner.js`, `src/worker.js`, tests |
| Agent C (lead sheets) | T016–T019, then T032–T033, T043–T044 | `core/chords.js`, `core/leadsheet.js`, `core/abc-reader.js`, `core/abc-writer.js`, tests |
| Agent D (arrangement and fitness) | after T011, T015, T017 and T019: T020–T025, T030–T031 | `core/textures.js`, `core/tables.js`, `core/fitness.js`, `core/arrangement.js`, tests |
| Agent E (MIDI) | after T019: T034–T037, T040–T042 | `core/midi-file.js`, `core/midi-song.js`, `core/midi-export.js`, `tests/test_web_midi.py`, tests |
| Agent F (audio) | T045–T046, later T064–T067 | `audio/chip-synth.js`, `audio/plain-synth.js`, `audio/loudness.js`, tests |
| Agent G (catalog, Python) | T073–T077, at any time after Setup | `src/catalog/*`, `tests/test_catalog_*.py`, `arranger/data/catalog.json` |
| Main session (late) | T038–T039, T049, then US2, US3 views, T078–T088 | `core/settings.js`, `arranger/src/ui/*`, `README.md`, `listen/index.html` |

Rules for parallel agents:
- Each agent owns its files and commits only those.
- No agent commits while another agent's pre-commit hook may stash its work. Commit from the
  main session after the agents finish (memory: pre-commit stash).
- The fixtures (T011) are committed before Agents C, D and E start their parity tests.

## Implementation strategy

1. MVP first: Setup, Foundational and US1 (through T057). Stop and check by hand in a browser.
   This is the first point worth showing to the student.
2. Then US2 and US3, which can run in parallel (different UI files, shared `player.js` only
   in T068).
3. Start US4's Python crawl (T077) early in the background, because it takes about an hour.
   Its UI comes last.
4. Polish, then ask the student to review and merge. Nothing reaches `main` or the public site
   before that.
