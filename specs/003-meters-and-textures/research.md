# Research: Meters and Allowed Textures

Phase 0 of the plan. Each decision states what was chosen, why, and what else was weighed. The
facts about the current code come from reading it on 2026-10-12 (commit 6478134):
- Python: `src/leadsheet`, `src/arrangement`, `src/ga`, `src/export`;
- JavaScript: `arranger/src/core`, `arranger/src/audio`, `arranger/src/ui`.

## R1. Where the code assumes 4/4

The code assumes 4/4 in these places. Each is changed by the decision named on its line.

| Place | Assumption | Decision |
|---|---|---|
| `leadsheet/model.py`, `core/leadsheet.js` | bar spans [0, 4); `LeadSheet.beats_per_bar` = 4 | R2 |
| `leadsheet/abc_reader.py` `_check_meter`, `_check_complete_bars`, `_chord_segments` | only 4/4; segments end at 4 | R6 |
| `core/abc-reader.js` `meterOf`, `joinPairs`, `checkSameMeter` | 4/4 and 2/4 joined in pairs; one meter per tune | R7 |
| `leadsheet/midi_reader.py`, `core/midi-song.js` | `meter_offset_beats`, `BEATS_PER_BAR`, `CHORD_SPAN` = 2, 4-beat downbeat search | R8, R9 |
| `arrangement/textures.py`, `core/textures.js` | `BEATS_PER_BAR`, 8 pump eighths, 4 bass quarters, 16-step drum table | R3 |
| `ga/tables.py`, `core/tables.js` | `STEPS_PER_BAR` = 16; `act_no` the same in every bar | R4 |
| `ga/fitness.py`, `core/fitness.js` | `act_no[gene]` without a bar index | R4 |
| `arrangement/validation.py`, `core/arrangement.js` | bar = `onset // 4`; strong beats 0 and 2 | R5 |
| `arrangement/assemble.py`, `core/arrangement.js` `assemble` | bar start = 4 × index | R2 |
| `leadsheet/abc_writer.py`, `core/abc-writer.js` | `M:4/4`, 16 units per bar | R10 |
| `export/midi.py`, `core/midi-export.js` | one 4/4 time signature | R11 |
| `export/input_preview.py`, `audio/plain-synth.js`, `ui/main.js`, `ui/input-panel.js` | 4 beats per bar for bar ranges and durations | R2, R8 |
| `export/figures.py` | grey bar lines every 4 beats | R2 |

The genome (`ga/genome.py`, `core/genome.js`) and the operators do not depend on the meter.

## R2. How a bar carries its meter

**Decision.**
- A new module, `src/leadsheet/meter.py` (`arranger/src/core/meter.js`), defines `Meter`:
  - `numerator`, `denominator`;
  - derived values:
    - `bar_beats`: the bar length in quarter notes, `numerator × 4 / denominator`;
    - `beats`: the beat lengths in quarter notes;
    - `strong`: the indices of the strong beats.
- `Bar` gains a field `meter: Meter`, with 4/4 as its default. The field comes last, so existing
  positional constructors (doctests, tests) still build 4/4 bars.
- `LeadSheet.beats_per_bar` is removed. Helpers `bar_starts(lead_sheet)` and
  `total_beats(lead_sheet)` give each bar's start and the length of the piece in beats. Every use
  of `4 × bar.index` changes to `bar_starts`.

**The supported meters** (spec FR-001, FR-002):

| Meter | `bar_beats` | `beats` (quarters) | `strong` | Family |
|---|---|---|---|---|
| 2/2 (also `C\|`) | 4 | 2, 2 | 0 | simple duple |
| 2/4 | 2 | 1, 1 | 0 | simple duple |
| 3/4 | 3 | 1, 1, 1 | 0 | simple triple |
| 4/4 (also `C`) | 4 | 1, 1, 1, 1 | 0, 2 | simple quadruple |
| 6/8 | 3 | 1.5, 1.5 | 0 | compound duple |
| 9/8 | 4.5 | 1.5, 1.5, 1.5 | 0 | compound triple |
| 12/8 | 6 | 1.5, 1.5, 1.5, 1.5 | 0, 2 | compound quadruple |
| 5/4 | 5 | 1, 1, 1, 1, 1 | 0, 3 | irregular, 3 + 2 |
| 7/8 | 3.5 | 1, 1, 1.5 | 0 | irregular, 2 + 2 + 3 |

The strong beats are the first beat of each group of the meter's grouping:
- A quadruple meter groups its beats 2 + 2, so beats 1 and 3 are strong.
- A duple or triple meter is one group, so only beat 1 is strong.
- 5/4 groups 3 + 2, so beats 1 and 4 are strong.
- In 7/8 each group of eighths is one beat (2 + 2 + 3), so the three beats last 1, 1 and 1.5
  quarters.

Any other meter is refused, naming the meter and the bar (FR-011).

**Rationale.**
- One small value type carries everything the realizers, tables, validation and chord detection
  need.
- The 4/4 entry reproduces the constants used today: 4 beats, strong beats at 0 and 2, 16 steps.
- A default of 4/4 keeps every existing constructor and doctest valid.

**Alternatives considered.**
- *A meter on the lead sheet only.* It cannot hold meter changes (US4).
- *Store a list of beat onsets instead of lengths.* Lengths are what the realizers iterate. The
  onsets are a running sum.
- *Treat 7/8 as seven eighth beats.* The bass and drums would then move on every eighth, which is
  not how 2 + 2 + 3 is felt. Spec US4 asks for one bass note per group.

## R3. How the realizers adapt (FR-005, FR-006)

**Decision.** The four genes keep their values. Each realizer reads the bar's meter.

| Gene value | Rule for any meter | 4/4 result (unchanged) |
|---|---|---|
| P1 octave | the written melody, shifted (no meter use) | same |
| P2 hold, arp16, arp32, third | per chord segment or per melody note (no meter use) | same |
| P2 echo | the melody one eighth later, cut at the end of the bar (`bar_beats`) | cut at 4 |
| TR root | the root, held for each chord segment | same |
| TR octave_pump | `2 × bar_beats` eighths alternating root and octave | 8 eighths |
| TR root_fifth | one note per beat: root on strong beats, fifth on weak beats | root, fifth, root, fifth |
| TR walking | one note per beat: root, third, fifth, root, … (the chord at each beat); the last beat approaches the next bar's root from a semitone below (the fifth again at the end of the piece) | root, third, fifth, approach |
| NO none | silence | same |
| NO half_time | kick on beat 1; snare on the second strong beat, if the meter has one; hi-hat on every beat | kick 0, snare 8, hi-hat 4, 12 |
| NO eighth_beat | kick on the strong beats, snare on the weak beats, hi-hat on every eighth | kick 0, 8; snare 4, 12 |
| NO sixteenth_beat | the eighth beat, plus a kick on the last sixteenth of the last strong beat, with hi-hat on every sixteenth | kick 0, 8, 11 |
| NO fill | the eighth beat on every beat but the last, then snare on every sixteenth of the last beat | snare 4, 12–15; hi-hat to step 12 |

The drum steps are sixteenth steps from the bar start. A beat that starts at quarter `q` is step
`4q`. The noise channel keeps its priority on a shared step: kick, then snare, then hi-hat.

**Examples in other meters.**
- 3/4 eighth beat: kick on 1, snare on 2 and 3, hi-hat on the eighths. This is the waltz of spec
  US1.
- 3/4 root_fifth: root, fifth, fifth ("oom-pah-pah", spec US1 scenario 2).
- 3/4 walking: root, third, then the approach (US1 scenario 3).
- 6/8 eighth beat: kick on eighth 1, snare on eighth 4 (the second dotted-quarter beat).
- 6/8 walking: two dotted quarters, root then the approach (US2).

**Spec corrections made with this plan.**
- US2 scenario 2 and the US2 independent test said "kick on eighths 1 and 4 and the snare on the
  second beat". On one channel those two hits fall on the same step, so the rule above
  (kick 1, snare 4) is the one written into the spec.
- FR-005 said root-fifth "alternates per beat". That conflicts with US1 scenario 2 (root, fifth,
  fifth in 3/4). The rule "root on strong beats, fifth on weak beats" satisfies both, and it
  alternates in 4/4.

**Rationale.**
- Every rule comes from the meter's beats and strong beats, so one rule serves all nine meters.
- Each rule reduces to today's constants in 4/4. A test checks every 4/4 realization against the
  committed realization fixtures (FR-006).

**Alternatives considered.**
- *A hand-written drum table per meter.* This means nine tables to keep in step in two languages,
  and the rule would stay implicit.
- *Arpeggios in eighths for compound meters.* The spec keeps the sixteenth and thirty-second
  subdivisions (US2).

## R4. Score tables and fitness on a per-bar grid (FR-007)

**Decision.**
- Each bar is measured on its own grid of `steps = 4 × bar_beats` sixteenth steps (a whole
  number for every supported meter; 7/8 has 14 steps).
  - Activity is `min(1, onsets / steps)`.
  - The register grids `_sounding_grid` and `soundingGrid` have `steps` cells.
- `act_no` becomes a per-bar table of shape (n, 5), because a drum pattern now depends on the
  bar's meter. The fitness reads `act_no[bar, gene]`, as it reads `act_tr`.
- All other table shapes stay.

**Rationale.**
- In 4/4 every value is the same as today, because `steps` = 16 and every row of `act_no` equals
  today's vector. The fitness of every committed plan is therefore unchanged (FR-017).
- A per-bar `act_no` costs n × 5 numbers, which is negligible.

**Alternatives considered.**
- *Keep `act_no` per pattern and normalise by 16 in every meter.* A 3/4 bar would then always
  look less active than a 4/4 bar with the same rhythm, and the contrast criterion would favour
  4/4 bars in a mixed-meter song.

## R5. Validation per bar (FR-008)

**Decision.**
- `find_violations` and `findViolations` compute the bar starts from the lead sheet (R2) and
  find each note's bar by searching them.
- "Complete bars" checks the note end against the bar's own `bar_beats`.
- "Chord tones on strong beats" uses the bar's strong-beat onsets (R2). In 4/4 these are 0 and 2,
  the same as today.
- Messages keep their format: "TR bar 3: pitch 40 at beat 3 is not a chord tone of Am". The beat
  is the quarter beat counted from 1, as in today's messages.

**Rationale.** These are the same rules, applied to each bar's meter. Every realizer of R3 plays a
chord tone on a strong beat, as today:
- root_fifth plays the root there;
- walking plays the root, third or fifth, and the approach falls on the last beat, which is always
  weak;
- the octave pump plays the root on every even eighth, and every strong beat starts on one.

## R6. Python ABC reader: meters from the text

**Decision.**
- `_scan_body` already reads the part labels from the ABC text. It now also gives each bar its
  meter:
  - the header `M:` field;
  - an inline `[M:x]` field;
  - an `M:` line inside the body.
- `C` reads as 4/4 and `C|` as 2/2.
- `_check_complete_bars` compares each music21 measure's length with its scanned meter's
  `bar_beats`.
- `_chord_segments` ends each bar at its own length.
- An unsupported meter is refused, naming it and the bar.
- Pickups stay refused in the Python reader, as today. The spec edge case "as in 4/4" means each
  reader keeps its own 4/4 behaviour: the command line refuses a pickup and the app pads it.

**Rationale.** Tested on 2026-10-12 with music21:
- music21 applies inline and body meter changes to the bar lengths (a `[M:2/4]` bar has 2 beats).
- It keeps only the first `TimeSignature` object, so the meter of a later bar cannot be read
  from the score.
- The text scan already exists and is tested.

**Alternatives considered.**
- *Read the meter from music21's measures.* The meter changes are lost (see above).
- *Pad pickups in Python too.* This adds behaviour outside the spec and risks the round trip of
  the ABC writer. It is left for later.

## R7. JavaScript ABC reader (abcjs)

**Decision.**
- `meterOf` accepts the supported meters, and a meter element inside the tune (inline or at a line
  start) starts the next bar in the new meter. `checkSameMeter` is removed.
- `joinPairs` is removed: 2/4 is read as 2/4 (FR-004 withdraws spec 002 FR-004).
- The pickup padding pads the first bar to its own meter's length.

**Rationale.** abcjs reports meter elements in the voice, so the reader can follow them bar by bar.

## R8. MIDI reader: the time-signature map (FR-003)

**Decision.**
- `bar_map(midi)` (`barMap` in JS) lists every bar of the file on its own tick grid, as
  `(start beat, meter)`:
  - It starts at beat 0, in 4/4 until the first time signature, as the MIDI standard says.
  - Each time signature starts a new bar at its own tick.
  - A change that falls inside a bar leaves that bar short. A short bar inside the excerpt is
    refused, naming the bar.
  - Bars continue to the end of the last note.
- `meter_offset_beats` is removed. Bar 0 is the file's first bar, so a count-in is part of the
  map.
- **Default excerpt.** With `midi.bars` null, the excerpt starts at the first bar that holds a
  pitched (non-drum) note and ends with the bar where the last pitched note ends. A drum-only
  count-in, or silent bars before the music, are therefore left out by default, as spec 002 left
  out a count-in in another meter. The visitor can still choose any range.
- **Estimated grid.** With `midi.grid` set to an estimated or explicit `[bpm, downbeat]` grid:
  - The song is read in one meter: the meter that lasts longest in the map, or 4/4 when the file
    has no time signature.
  - The downbeat search in `estimate_beat_grid` runs over the bar's quarter beats instead of 4.
    It takes a `beats_per_bar` argument, with 4 as the default, so voa_voa is unchanged.
  - A meter whose bar is not a whole number of quarters (7/8) needs the file grid. The reader
    says so.
- `excerpt_seconds` (Python) and the bar-range code of the app (`input-panel.js`,
  `plain-synth.js`) take their bar starts from the map.

**Check on the committed inputs.** Every MIDI file in `data/raw/` has one 4/4 time signature at
tick 0. Bar 0 and every bar line stay where they are, and all samples use explicit `midi.bars`.
The reductions of the samples are therefore unchanged (FR-017).

**Rationale.**
- The map follows the file's own notation, which is what a sequencer user sees.
- Removing the lead-in special case is simpler than extending it.
- The default excerpt rule covers the case that motivated `meter_offset_beats` (a 3/4 count-in
  before a 4/4 song) in every meter.

**Alternatives considered.**
- *Keep skipping a count-in in another meter.* With 3/4 supported, a 3/4 count-in can no longer
  be told apart from a 3/4 opening.
- *Re-bar the file from the melody.* That is meter detection, which is out of scope.

## R9. Chord detection spans (FR-009)

**Decision.**
- The MIDI reader decides one chord per *strong-beat group*: from one strong beat to the next, or
  to the bar end.
  - 4/4: half bars of 2 beats, exactly as today.
  - 12/8: half bars of 3 quarters (US2 scenario 3).
  - 5/4: groups of 3 and 2 quarters.
  - 2/4, 2/2, 3/4, 6/8, 9/8 and 7/8: one chord per bar.
- Within a bar, equal neighbouring decisions merge, as today.

**Rationale.**
- The rule uses the meter's own grouping, so it needs no list of exceptions.
- It gives today's half bars in 4/4.
- In 2/4 it gives one chord per 2-quarter bar, which is what the app did before by joining 2/4
  bars in pairs and deciding per half of the pair.

The spec's FR-009 said "half bars in duple and quadruple meters, whole bars otherwise". That
would decide a chord on every quarter in 2/4. The rule above is the one written into the spec.

## R10. ABC writer: meters

**Decision.**
- The writer writes `M:` from the first bar's meter, and `[M:x]` at the start of each bar whose
  meter differs from the previous bar.
- The unit stays `L:1/16`. A bar holds `4 × bar_beats` units.
- The round trip (write, then read) gives the same lead sheet in every supported meter. Both
  readers read inline fields (R6, R7).

**Rationale.** Inline fields keep the "one phrase per line" layout, and a 4/4 lead sheet writes
exactly the same text as today.

## R11. MIDI export: time signatures

**Decision.**
- The arrangement carries the meter of each bar.
- `arrangement_to_midi` and `arrangementToMidi` write one time signature at time 0 and one more
  at each bar whose meter changes.
- An all-4/4 arrangement writes the same single 4/4 event as today. The Korobeiniki seed-1 MIDI
  SHA-256 pin of the app does not change.

## R12. Allowed values per gene (FR-012 to FR-017)

**Decision.**
- **Config.** A new key `allowed`, with value names (not indices):

  ```json
  "allowed": {
    "p2": ["hold", "arp16", "arp32", "echo", "third"],
    "tr": ["root", "octave_pump", "root_fifth", "walking"],
    "no": ["none", "half_time", "eighth_beat", "sixteenth_beat", "fill"],
    "p1_octave": [0, 12, -12]
  }
  ```

  - The key is added to `configs/default.json`, with every value allowed.
  - `load_config` rejects an unknown value, a duplicate, and an empty list. The message names the
    gene, for example "allowed.p2 must keep at least one texture".
  - A run record without `allowed` (every committed sample) merges with the default.
  - The list order does not matter. Values are used in gene order.
- **Genome.** `allowed_genes(config["allowed"])` turns the names into one tuple of allowed gene
  values per column, for example `((0, 1, 3, 4), (0, 1, 2, 3), …)`.
- **Initial population.** It draws `rng.integers(0, k_gene)` for each gene, where `k_gene` is the
  number of allowed values, and maps the draw through the gene's tuple. With every value allowed,
  `k_gene` equals today's `GENE_SIZES` and the map is the identity. numpy then draws the same
  stream, and generation 0 is unchanged.
- **Mutation.**
  - It draws `mutating` and `shift` exactly as today, with `high = max(k_gene, 2)` so that a gene
    with one allowed value still has a valid range.
  - The new value is the allowed value `shift` places further along the gene's tuple.
  - A gene with `k_gene = 1` never changes.
  - With every value allowed, the draws and the results are the same as today.
- **JavaScript.**
  - `randomPopulation(rng, m, nBars, allowed)` and `mutate(rng, genes, rate, allowed)` follow the
    same rule. With every value allowed they make the same `rng` calls in the same order, so the
    Korobeiniki SHA pin holds.
  - A gene with one allowed value still draws `rng.float()` but no shift.
- **Plans.** Crossover and elitism only move existing genes, so every plan of every generation
  holds allowed values only (FR-013, SC-004).
- **Validation in the app.** `checkSettings` rejects an empty gene with the same message as the
  command line.
- **Warnings in the app.**
  - P2 without arp16 and arp32: "the idiom criterion can no longer reward arpeggios".
  - P1 octave without 0: "fidelity will score 0".

**Rationale.**
- Names, not indices, make `config.json` readable and stable if a texture is ever added.
- Drawing with the allowed count keeps the default stream byte-identical in both languages. This
  is the only way the 10 samples rerun unchanged (FR-017, SC-002).

**Alternatives considered.**
- *Reject disallowed values by redrawing (rejection sampling).* This changes the draw count and
  breaks the stream even when nothing is disallowed.
- *A fitness penalty for disallowed values.* The GA could still use them, which fails US3
  scenario 1.
- *A weight per texture instead of a yes/no.* This is more control than the complaint needs. It
  is left for later.

**Effect on the run id.** The default configuration gains a key, so `config_hash` of a default
run changes and new run folders get new 8-hex ids. A sample's plan, fitness and MIDI do not
depend on the run id. Its `config.json` keeps the old id until it is remade.

## R13. Test inputs and parity fixtures (SC-001, SC-003)

**Decision.**
- **Test tunes.** The project writes its own short tunes, in `tests/data/meters/`:
  - `waltz.abc` (3/4, 16 bars);
  - `polka.abc` (2/4, 16 bars);
  - `jig.abc` (6/8, 16 bars);
  - `slow_twelve.abc` (12/8, 8 bars);
  - `five.abc` (5/4, 8 bars);
  - `seven.abc` (7/8, 8 bars);
  - `changes.abc` (4/4 → 2/4 → 3/4 → 4/4, with inline fields).

  They are original melodies over simple progressions, so they can be committed.
- **Synthetic MIDI songs.** `uv run src/main.py fixtures` builds small multi-track MIDI files
  with pretty_midi:
  - a 3/4 song with a melody, bass and pad;
  - a 12/8 song;
  - a 4/4 → 2/4 → 4/4 song;
  - a 4/4 song with a drum-only 3/4 count-in.

  It writes them to `arranger/tests/fixtures/midi-songs/synthetic-*.mid`, next to their
  reductions. They are generated by the project, so they can be committed.
- **The fixtures command also writes, for each meter tune:**
  - `leadsheets/<id>.json`;
  - `realizations/<id>.json` (every bar, channel and gene value);
  - `tables/<id>.json`;
  - `plans/meters-<id>.json`: a fixed plan's criterion scores and fitness.

  The JavaScript tests compare all of them, as for spec 002 (SC-003).
- **Format change.** The lead-sheet JSON of every fixture gains each bar's `meter`, and
  `beats_per_bar` disappears. The tables JSON has `act_no` per bar. For the 4/4 fixtures, every
  other value stays byte-identical. Implementation checks this once with a semantic diff of the
  regenerated fixtures against the committed ones, before they are committed (SC-002).

**Rationale.** These are the same parity mechanics as spec 002, extended to the new meters, with
no third-party file committed.

## R14. App interface

**Decision.**
- **Settings panel (FR-015).** A new group "Allowed textures" holds four rows of checkboxes, one
  row per channel:
  - P2: hold, arp16 ("arpeggio in sixteenths"), arp32 ("fast arpeggio in 32nd notes"), echo,
    third;
  - TR: root, octave pump, root–fifth, walking;
  - NO: none, half time, eighth beat, sixteenth beat, fill;
  - P1: as written, octave up, octave down.

  Each value has an (i) tooltip in the existing `.has-tip` style. The warnings of R12 appear under
  the group. The form reads and writes `settings.allowed`, so import and export of `config.json`
  carry it (FR-016).
- **Song card.**
  - The lead-sheet summary shows the meter, or "meters 4/4, 2/4" for a song with changes.
  - The MIDI bar range counts bars from the map.
- **Plan grid and channel view.** These already work per bar and in seconds. The chord row and
  the beat clock take bar starts from the lead sheet.

The examples list stays as it is. A waltz example can be added later.

## R15. Order of work and parallelism

- The meter type (R2) blocks everything else.
- **Allowed values (US3).** These are independent of meters and can land first, as the MVP.
- **Meters (US1, US2, US4).** The work goes model, then realizers, then tables and fitness, then
  validation and assembly, then readers and writers, then export, then the app interface.
- **Two languages.**
  - Python changes first in each layer, because it is the reference.
  - JavaScript follows against the regenerated fixtures.
  - Python and JavaScript tasks of the same layer can run in parallel once the layer's Python test
    names the expected values.
