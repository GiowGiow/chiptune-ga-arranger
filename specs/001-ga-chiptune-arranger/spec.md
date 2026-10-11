# Feature Specification: GA Chiptune Arranger

**Feature Branch**: `001-ga-chiptune-arranger`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "NES chiptune arranger driven by a genetic algorithm (DCC831 TP1, deadline 2026-10-11 23:59). Input: a lead sheet in ABC notation with melody, chord symbols and part labels (verse/chorus), for example a hand-written lead sheet of "Bloody Stream" (showcase) and the two Nottingham tunes bundled with music21 as extra inputs. Output: a 4-track MIDI file in the NES 2A03 four-voice idiom (the stylistic constraint). Method (exactly one): a genetic algorithm searches the arrangement plan (4 integer genes per bar; deterministic realizers; fitness as a weighted sum of music-theory heuristics; roulette selection with elitism, one-point crossover at bar boundaries, per-gene mutation, stop by generations or stagnation). Explicit seeds, configurable hyperparameters, fitness log and plot, one output folder per run, curated samples, README, ISMIR abstract. Optional: Bach Vision Test style animation. Deferred: marimo notebook, glossary, explanation document."

**Update (2026-10-11)**: the inputs are two well-known tunes with famous 8-bit versions, so that no
time goes into transcribing a song and the results can be compared by ear: "Ievan Polkka" (melody as
sung by Loituma) and "Korobeiniki" (the Tetris theme). They replace "Bloody Stream" and the
Nottingham tunes.

## Context

The assignment (TP1) asks for an end-to-end algorithmic composition system built on exactly one
classic method, with an explicit stylistic constraint, at least three synthesized pieces and a
short ISMIR-format abstract. This feature re-composes an existing song for the sound chip of the
Nintendo Entertainment System (NES). The chip offers four voices, and each voice plays one note at
a time. These limits force new composition decisions: chords become arpeggios, a new bass line and
a new drum part are needed, and the melody may move by octaves. A genetic algorithm (GA) searches
for the arrangement plan that best satisfies a set of musical heuristics.

Vocabulary used in this document:

- **Lead sheet**: a melody with chord symbols and part labels, written in ABC notation.
- **Channel**: one of the four NES voices: **P1** and **P2** (pulse waves), **TR** (triangle wave)
  and **NO** (noise, used for percussion).
- **Texture**: the musical role that a channel plays in one bar (for example, a sixteenth-note
  arpeggio on P2).
- **Arrangement plan (genotype)**: the list of texture choices, four integers per bar.
- **Arrangement (phenotype)**: the four channels of notes that the realizers produce from a plan.
- **Section role**: *verse* or *chorus*, derived from the part label of each bar.
- **Phrase**: a group of consecutive bars inside a section (4 bars by default).
- **Strong beats**: beats 1 and 3 of a 4/4 bar.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Arrange a lead sheet as an NES piece (Priority: P1)

The student runs one command with a lead sheet file, the tune to use, an explicit seed and a
configuration. The system evolves an arrangement plan with the GA and writes a four-channel
symbolic piece that obeys the NES rules. It also writes the audio rendering, a piano roll and a
record of the configuration.

**Why this priority**: this is the method required by the assignment and the core of every other
deliverable. Without it there is no piece to hear, plot or report.

**Independent Test**: run the command on the Korobeiniki lead sheet, with seed 1 and the default
configuration. Read the symbolic file back and check the four channels
and every NES rule. Run the same command again and compare the notes.

**Acceptance Scenarios**:

1. **Given** the Ievan Polkka lead sheet and seed 1, **When** the student runs the arranger,
   **Then** a new run folder holds the symbolic piece, the audio, the piano roll and the
   configuration record, and the symbolic piece has exactly the channels P1, P2, TR and NO.
2. **Given** a finished run, **When** the symbolic piece is read back, **Then** P1 has the lead
   sheet melody (same rhythm and pitch classes) and every channel passes the NES rules
   (FR-011).
3. **Given** the same lead sheet, tune, configuration and seed, **When** the arranger runs twice,
   **Then** both runs produce identical notes in every channel.
4. **Given** a command without a seed, **When** the student runs it, **Then** the system refuses to
   run and says that a seed is required.

---

### User Story 2 - Inspect how the arrangement evolved (Priority: P2)

The student opens the run folder and sees how the fitness changed over the generations, and how
the final arrangement scores on each musical criterion. The evolution figure goes into the
abstract, where it is mandatory.

**Why this priority**: the assignment requires the fitness-per-generation figure, and the
per-criterion scores explain why the GA chose each texture.

**Independent Test**: run the arranger once and check the evolution log, the evolution figure and
the metrics file in the run folder.

**Acceptance Scenarios**:

1. **Given** a finished run, **When** the student opens the evolution log, **Then** it has one row
   per generation with the best and the mean fitness.
2. **Given** a finished run, **When** the student opens the evolution figure, **Then** it shows the
   best and the mean fitness per generation, with a caption that states what to look for, and a
   vector copy exists for the abstract.
3. **Given** a run with elitism enabled, **When** the evolution log is read, **Then** the best
   fitness never decreases from one generation to the next.
4. **Given** a finished run, **When** the student opens the metrics file, **Then** it lists the
   score of each fitness criterion for the final arrangement and the objective metrics of each
   channel.

---

### User Story 3 - Explore variations and curate the deliverables (Priority: P3)

The student generates several arrangements of the same song with different seeds and different
hyperparameters, listens to them, copies the chosen runs to the curated samples, and documents how
to reproduce each one. The grader can rebuild every sample from the README.

**Why this priority**: the assignment requires several different pieces from the same
configuration, a variation of at least one hyperparameter, at least three synthesized pieces in
the repository and reproducible results.

**Independent Test**: run the arranger with five seeds and with two values of one fitness weight,
copy three runs to the samples, then follow the README commands from a clean checkout and compare
the rebuilt notes with the samples.

**Acceptance Scenarios**:

1. **Given** one lead sheet and one configuration, **When** the student runs five different
   seeds, **Then** at least three of the resulting arrangement plans differ from each other.
2. **Given** one lead sheet and seed, **When** the student raises the contrast weight from 0 to 3,
   **Then** the arrangement changes and the chorus becomes denser relative to the verse.
3. **Given** a finished run, **When** the student runs the documented copy command with a sample
   name, **Then** the sample folder holds every file of the run plus a listening-notes file.
4. **Given** the README, **When** the grader runs the documented command of a sample, **Then** the
   rebuilt piece has the same notes as the sample.

---

### User Story 4 - Watch the piece as an animated four-line visualization (Priority: P4, optional)

The student renders a video of a curated sample in the style of the "Bach Vision Test": each
channel is one glowing step line on a dark background, revealed in sync with the audio.

**Why this priority**: it is not required by the assignment. It helps the presentation and the
README, and it starts only after User Stories 1 to 3 and the abstract are done.

**Independent Test**: render the video of one sample and check that its length matches the audio
and that each channel appears as its own line.

**Acceptance Scenarios**:

1. **Given** a curated sample, **When** the student runs the video command, **Then** a video file
   with the sample's audio appears next to the sample, and the drawn position matches the sound
   at every moment.

---

### Edge Cases

- **No chord symbols**: a tune without any chord symbol is rejected with a message that names the
  tune.
- **Bar without a chord symbol**: the bar uses the chord in effect at the end of the previous bar.
- **Several chords in one bar**: every texture follows the chord in effect at each moment of the
  bar.
- **Unrecognized chord symbol**: the run stops with a message that names the symbol and its bar.
- **Meter other than 4/4**: the run stops with a message that says only 4/4 is supported.
- **Pickup bar (anacrusis), incomplete bar or repeat sign**: the run stops with a message that names
  the bar. Lead sheets are written out in full, in the performed order.
- **Chords inside the melody line**: P1 keeps the highest note of the chord.
- **Grace notes**: they are dropped.
- **Notes outside a channel range**: the realizers move them by whole octaves into the range.
- **Only one section role in the tune**: the contrast criterion does not apply and is left out of
  the fitness.
- **Tune with a single bar**: crossover is skipped and only mutation changes the population.
- **Audio rendering unavailable**: the run still writes the symbolic piece, the piano roll, the
  logs and the configuration record, and it reports that the audio was skipped.
- **Several tunes in one file**: only the first tune is read.

## Requirements *(mandatory)*

### Functional Requirements

#### Input

- **FR-001**: The system MUST read the first tune of a lead sheet in ABC notation, with melody, chord
  symbols, meter, key, optional tempo and part labels.
- **FR-002**: The system MUST reject a lead sheet with a repeat sign, a pickup or any incomplete bar,
  with a message that names the bar.
- **FR-003**: The system MUST resolve the chord in effect at every moment, carry the previous chord
  into bars without a chord symbol, support several chords per bar, and reject a tune that has no
  chord symbol or an unrecognized chord symbol, with a message that names the bar.
- **FR-004**: The system MUST reject meters other than 4/4 with a clear message.
- **FR-005**: The system MUST give every bar a section role (verse or chorus) from its part label
  through a role map in the configuration, and a phrase index (groups of N bars inside a section,
  N from the configuration, default 4). By default, a label that contains "chorus" (any case) or
  that equals "B" maps to chorus, and every other label maps to verse.

#### Style contract (NES idiom)

- **FR-006**: The arrangement MUST have exactly four channels: P1 (melody), P2 (harmony texture),
  TR (bass texture) and NO (percussion).
- **FR-007**: P1 MUST play the lead sheet melody with the same rhythm and pitch classes. Its only
  change is the per-bar octave shift from the plan: as written, one octave up, or one octave down.
- **FR-008**: P2 MUST offer five textures. The P2 register places the chord root between MIDI 48
  and 59 (C3 to B3), below the melodies of both inputs.
  - *hold*: the chord root, sustained for the duration of each chord;
  - *arp16*: the chord tones (root, third, fifth and the seventh when present) cycled upward from
    the root, one per sixteenth note, restarting at each chord change;
  - *arp32*: the same cycle, one note per thirty-second note;
  - *echo*: the P1 melody one eighth note later at 60% of P1's loudness, cut at the bar end, with a
    rest on the first eighth note;
  - *third*: for each melody note, the nearest chord tone at least three semitones below it, with
    the melody's rhythm, and a rest wherever the melody rests.
- **FR-009**: TR MUST offer four textures. The TR register places the chord root between MIDI 28
  and 39 (E1 to D#2).
  - *root*: the chord root, sustained for the duration of each chord;
  - *octave pump*: eighth notes that alternate the root and the root one octave higher;
  - *root-fifth*: quarter notes that alternate the root and the fifth;
  - *walking*: quarter notes with the root on beat 1, the third on beat 2, the fifth on beat 3 and,
    on beat 4, an approach note one semitone below the next bar's first root (the fifth again in
    the last bar of the piece).
- **FR-010**: NO MUST offer five patterns on a sixteenth-note grid, using only kick, snare and
  closed hi-hat:
  - *none*: silence;
  - *half-time*: kick on beat 1, snare on beat 3, hi-hat on every beat;
  - *eighth beat*: kick on beats 1 and 3, snare on beats 2 and 4, hi-hat on every eighth note;
  - *sixteenth beat*: kick on beats 1 and 3 and on the last sixteenth of beat 3, snare on beats 2
    and 4, hi-hat on every sixteenth note;
  - *fill*: the eighth beat for the first three beats, then four snare sixteenths on beat 4.

  When a kick or a snare falls on a hi-hat position, it replaces the hi-hat, so that one hit sounds
  at a time.
- **FR-011**: Before export, the system MUST validate these NES rules and MUST refuse to export an
  arrangement that breaks any of them, listing each violation:
  - one note at a time in every channel;
  - pulse channels (P1, P2) within MIDI pitches 33 to 108 (A1 to C8), triangle (TR) within 21 to
    108 (A0 to C8), inside the hardware limits reported for the NES-MDB corpus (pulse 32-108,
    triangle 21-108);
  - P2 in the hold, arp16, arp32 and third textures, and TR in every texture, play only chord tones
    at notes that start on strong beats;
  - every bar of every channel fills exactly the bar length with notes and rests.

#### Genetic algorithm

- **FR-012**: The genotype MUST be four integer genes per bar: P2 texture (0 to 4), TR texture
  (0 to 3), NO pattern (0 to 4) and P1 octave shift (0 = as written, 1 = up, 2 = down).
- **FR-013**: The initial population MUST be a configurable number of random genotypes with
  uniformly drawn valid gene values.
- **FR-014**: Fitness MUST be the weighted mean of the following criteria, each scored from 0 to 1,
  with weights from the configuration. A criterion that does not apply to the tune is left out of
  the mean.
  - **C1 Complementarity**: P2 is calm when the melody is busy and active when the melody rests or
    sustains. Activity is onsets per beat divided by 4, capped at 1. The bar score is
    1 − |activity(P2) − (1 − activity(P1))|.
  - **C2 Register**: P2 sounds below P1. The score is the share of sixteenth-note positions where
    both sound and P2 is lower; it is 1 when they never sound together.
  - **C3 Coherence**: bars inside a phrase keep the same choices. The score is the share of
    adjacent bar pairs, inside each phrase, with equal P2, TR, P1-octave and NO genes; a fill
    counts as equal to any NO pattern.
  - **C4 Contrast**: the chorus is denser than the verse. Density is the mean activity of P2, TR
    and NO. The score is 0.5 + mean density(chorus) − mean density(verse), clipped to 0 to 1. It
    applies only when both roles exist.
  - **C5 Bass smoothness**: small leaps between the last TR note of a bar and the first TR note of
    the next bar. A pair scores 1 up to 5 semitones and 0 from 12 semitones, linear in between.
  - **C6 Idiom**: the mean of two shares: among bars with one chord for the whole bar, the share
    that uses arp16 or arp32 on P2 (left out when no such bar exists); and among all bars, the
    share where "NO is a fill" matches "the bar ends a phrase".
  - **C7 Fidelity**: the share of bars where P1 plays the melody at its written octave. It keeps
    octave shifts for bars where another criterion gains more, and stops the degenerate plan that
    moves the whole melody up an octave to win C2 (warning in `references/tp1/ga-arranjo-nes.md`
    §3.1).
- **FR-015**: Selection MUST be roulette selection with windowing: the probability is proportional
  to the fitness minus the lowest fitness of the generation (uniform when all fitness values are
  equal). Windowing keeps the selection pressure when a weighted mean of criteria gives close
  fitness values. Elitism MUST copy a configurable number of the best genotypes unchanged into the
  next generation.
- **FR-016**: Crossover MUST be one-point, with the cut only between bars, and MUST produce two
  children from two parents.
- **FR-017**: Mutation MUST replace each gene, with a configurable probability (default 0.01,
  close to 1/L for L = 4 genes × the number of bars), by a different valid value drawn uniformly.
- **FR-018**: The GA MUST stop after a configurable maximum number of generations or after a
  configurable number of generations without improvement of the best fitness, whichever comes
  first.
- **FR-019**: All randomness MUST come from one generator seeded with the run's explicit seed. A run
  without a seed MUST be refused. The same lead sheet, tune, configuration and seed MUST give
  identical notes.
- **FR-020**: Every hyperparameter (population size, maximum generations, stagnation window,
  mutation probability, elite count, fitness weights, phrase length, role map, tempo override)
  MUST come from the command line or a configuration file, never from values hidden in the code.

#### Outputs

- **FR-021**: Every run MUST write its own folder with: the symbolic piece; the audio rendering,
  made only from the symbolic piece with a General MIDI sound set (square lead for P1 and P2,
  synth bass for TR, drum kit for NO), under 5 MB; a piano roll with one step line per channel in
  a colorblind-safe palette; the configuration record (seed, every hyperparameter, input file and
  its content hash, code commit and creation date); the evolution log (per generation: best and
  mean fitness and the share of distinct genotypes in the population); the evolution figure as
  raster and as vector; and a metrics file (per channel: note density, share of time sounding,
  pitch-class histogram, pitch entropy and interval distribution; the score of each fitness
  criterion for the best genotype of generation 0 and for the final best genotype).
- **FR-022**: When audio rendering is unavailable, the run MUST still write every other file and
  MUST report that the audio was skipped.
- **FR-023**: A documented command MUST copy a chosen run to a named sample folder with every run
  file and an empty listening-notes file.

#### Deliverables

- **FR-024**: The README MUST give installation steps, the exact command of every sample (input,
  tune, seed, configuration), the list of samples with what varied between them, the source and
  license of each input, the AI usage statement and a pipeline diagram in Mermaid.
- **FR-025**: The repository MUST contain at least three curated samples that differ in seed or
  hyperparameters, and they MUST include arrangements of both "Ievan Polkka" and "Korobeiniki".
- **FR-026**: The abstract MUST use the ISMIR template with at most three pages of content. It MUST
  describe the stylistic constraint, the representation and every GA element (genotype, initial
  population, fitness and its justification, selection, crossover, mutation and stopping
  criterion), include the evolution figure, report what varied between the pieces, discuss
  limitations, and cite at least four references, three of them on genetic algorithms applied to
  music.

#### Experiments for the abstract

- **FR-029**: A documented command MUST run the experiments of the Results section on one input
  and write a table and a figure: five seeds (pairwise Hamming distance between final plans), a
  random-search baseline with the same number of fitness evaluations as the GA, and an ablation
  that sets one criterion weight to 0 at a time. Priority: after FR-021 to FR-026.

#### Optional and deferred

- **FR-027** (optional): A command MUST render a video of a sample, with one glowing step line per
  channel revealed in sync with the sample's audio. Work on it starts only after FR-021 to FR-026
  are met.
- **FR-028**: The plan MUST record, as constitution deviations, the items deferred past the
  deadline: the marimo walkthrough notebook, `docs/glossary.md` and `docs/explanation.md`.

### Key Entities

- **Lead sheet**: title, reference number, key, meter (4/4), tempo, and the ordered bars of the
  performed order. Each bar has its melody notes (pitch, onset and duration in beats), its chord
  segments (chord symbol, onset, duration), its part label, its section role and its phrase index.
- **Arrangement plan (genotype)**: four integer genes per bar (P2 texture, TR texture, NO pattern,
  P1 octave shift).
- **Arrangement (phenotype)**: four channels of notes (pitch, onset, duration, loudness) made by
  the realizers from the plan and the lead sheet.
- **Fitness report**: the score of each criterion and the weighted total.
- **Run configuration**: the seed, the GA parameters, the fitness weights, the phrase length, the
  role map and the tempo override, saved with the input hash, the code commit and the date.
- **Evolution log**: the best and the mean fitness of each generation.
- **Run folder and sample**: the files of one run. A sample is a curated copy with listening notes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: One command turns a 32-bar lead sheet into a complete run folder (symbolic piece,
  audio, figures, logs and record) in under 2 minutes on the student's laptop.
- **SC-002**: 100% of exported pieces pass every NES rule of FR-011.
- **SC-003**: Two runs with the same input, configuration and seed give identical notes in 100% of
  the checks.
- **SC-004**: Five seeds on the same input and configuration give at least three different
  arrangement plans.
- **SC-005**: Raising the contrast weight from 0 to 3, with everything else fixed, changes the plan
  and increases the chorus-minus-verse density difference.
- **SC-006**: In every run with elitism, the best fitness never decreases between generations, and
  the final best fitness is higher than the best fitness of the initial population.
- **SC-007**: The repository holds at least three curated samples, covering both "Ievan Polkka" and
  "Korobeiniki", and each one is rebuilt with identical notes from its README command.
- **SC-008**: The abstract has at most three pages of content, includes the evolution figure and
  cites at least four references, three of them on genetic algorithms applied to music.
- **SC-009**: The repository is public and the submission is sent before 2026-10-11 23:59.

## Assumptions

- "Ievan Polkka" (`data/leadsheets/ievan_polkka.abc`): the melody and the bass harmony come from
  the flutetunes.com transcription (tune 341), which follows the melody of Loituma's recording.
  The lead sheet is transposed from D minor to E-flat minor, the key of the Loituma recording. It
  is rebarred to 4/4, with chord symbols Ebm, Bbm and Bbm7 taken from the bass line, and the form
  A B A' is played twice (24 bars at 110 BPM). The melody is traditional and in the public
  domain. The lyrics and Loituma's arrangement are not used. The README credits the source.
- "Korobeiniki" (`data/leadsheets/korobeiniki.abc`): the Russian folk melody as heard in the Tetris
  theme, in A minor with the chords Am, E, Dm and C, form A A B A (32 bars at 150 BPM), written for
  this project.
- The student accepts the copyright exposure of the Tetris-specific material for academic use.
- Only 4/4 is supported. Other meters are out of scope for this deadline.
- The audio approximates the NES timbres with a General MIDI sound set. Exact chip emulation is
  out of scope.
- The fitness is heuristic, based on music-theory rules. No learned model and no human rating is
  used.
- The default tempo is 140 BPM when the lead sheet has none, and the configuration can override it.
- The abstract is written in English, as the constitution requires.
- Deferred past the deadline: the marimo walkthrough notebook, the glossary and the explanation
  document (FR-028).
