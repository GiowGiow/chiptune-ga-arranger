# Feature Specification: Browser Arranger

**Feature Branch**: `002-browser-arranger`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Browser arranger on GitHub Pages (spec 002, post-deadline work on a
branch other than main; main stays the submitted state d0c98d9 / tag v1.0-submission until the
student merges). A static web app, served by GitHub Pages next to the existing listen/ page, that
runs the TP1 genetic-algorithm NES arranger entirely in the visitor's browser. Inputs, in order of
priority: (1, primary) the visitor uploads an arbitrary MIDI or ABC file; (2) the visitor searches
the MPB MIDI catalog at https://www.beakauffmann.com/mpb_0-9.html (and its other letter pages) by
song title or artist and loads a song from it. The app reduces the input to a lead sheet (melody,
chords, parts) as the Python pipeline does, then runs the GA with configurable hyperparameters,
with defaults equal to configs/default.json. It must be fast: the first arrangement of a typical
song appears within seconds, and the page stays responsive while the GA runs. While the GA runs,
the page animates the evolution live: best and mean fitness per generation, the generation
counter, the stagnation counter against its window, and the current best plan per bar. When done,
the visitor plays the result with the NES chip synth and can compare it with the original input
(A/B, same position), sees the channel visualization in the four channel colors of listen/, and
downloads the generated MIDI and the config and seed that reproduce it. Same seed and settings
give the same arrangement. Out of scope: server-side code, accounts, storing user uploads."

## Context

TP1 (spec `001-ga-chiptune-arranger`) is a command-line program. It reads a lead sheet (ABC) or a
multi-track MIDI song, reduces it to melody, chords and parts, and runs a genetic algorithm (GA)
that picks, bar by bar, four genes: the P2 harmony texture, the TR bass texture, the NO drum
pattern and the P1 octave. Deterministic realizers turn the genes into a four-channel NES piece
(two pulse channels, triangle, noise). The submitted work is on `main` at `d0c98d9`, tagged
`v1.0-submission`, and its listening page plays 10 pre-rendered samples.

This feature brings the arranger to the browser so that anyone can arrange their own song without
installing anything, watch the GA work, and hear the result. It is post-deadline work: it lives on
the branch `002-browser-arranger`, and the public site and `main` stay at the submitted state
until the student merges.

The reference timing is the command-line program on the student's laptop, audio rendering
excluded: Korobeiniki (32 bars, default settings) takes 9.5 seconds and 1,886 generations; Mulher
de Fases (32 bars, 4000/400 limits) 7.2 seconds and 1,227 generations; Amor I Love You (56 bars,
the longest sample, 4000/400 limits) 12.4 seconds and 2,935 generations.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Arrange my own file and hear it as an NES piece (Priority: P1)

A visitor opens the app, drops a MIDI or ABC file, sees what the app understood of it (title,
tempo, bar count, melody, chords, parts), presses Arrange, watches the GA evolve the arrangement
live, hears the result played by the NES chip synthesizer, and downloads the MIDI.

**Why this priority**: it is the primary input route the student asked for and the smallest
slice that delivers the whole idea: any song in, NES piece out, without installing anything.

**Independent Test**: open the app with no prior visit, drop `data/leadsheets/korobeiniki.abc`
(and, separately, a MIDI song from `data/raw/`), press Arrange with the default settings, and
check that the evolution display moves while the GA runs, that the finished piece plays, and that
the downloaded MIDI opens in a MIDI editor with four tracks named P1, P2, TR and NO.

**Acceptance Scenarios**:

1. **Given** the app is open, **When** the visitor drops a valid 4/4 ABC lead sheet with chord
   symbols, **Then** the app shows the tune's title, tempo, bar count, part labels and the chord
   of every bar before any GA run.
2. **Given** the app is open, **When** the visitor drops a multi-track MIDI file, **Then** the app
   lists its tracks (name, instrument, note count, pitch range), preselects the most likely melody
   track, and lets the visitor change it before arranging.
3. **Given** a lead sheet is loaded, **When** the visitor presses Arrange, **Then** within 1
   second the evolution display starts and shows, updated live: the best and mean fitness per
   generation as a curve, the generation counter against the maximum, the stagnation counter
   against its window, and the current best plan as a grid of 4 genes per bar.
4. **Given** a run is going, **When** the visitor presses Stop, **Then** the run ends within half
   a second and the best arrangement found so far becomes the result.
5. **Given** a run has finished, **When** the visitor presses Play, **Then** the arrangement plays
   with the NES chip sound (two pulse channels, triangle, noise) and a playhead moves.
6. **Given** a run has finished, **When** the visitor presses Download, **Then** the browser saves
   the arrangement as a four-track MIDI file and a settings file that records the seed, every
   hyperparameter, the input's fingerprint and the app version.
7. **Given** the visitor has no file at hand, **When** they pick one of the bundled examples (the
   committed lead sheets of the 10 samples), **Then** it loads as if they had dropped it.

---

### User Story 2 - Tune the settings and reproduce a run (Priority: P2)

The visitor opens the settings panel, changes the seed, the population size, the mutation rate,
the number of elite plans, the phrase length, the stopping limits or the weight of any fitness
criterion, and arranges again. Each setting has a short explanation of what it changes in the
music. The same input, seed and settings always give the same arrangement.

**Why this priority**: the GA's behavior is the subject of TP1, and the hyperparameters are what a
reader wants to play with after hearing one result. Reproducibility is a constitution principle.

**Independent Test**: arrange Ievan Polkka with seed 1, note the plan; reload the page, arrange
again with seed 1 and see the same plan; set fidelity to 0 and see the melody move between
octaves, as in the `ievan-polkka-s1-fidelity0` sample.

**Acceptance Scenarios**:

1. **Given** the app has just opened, **When** the visitor opens the settings, **Then** every
   value equals the command-line defaults (`configs/default.json`), with the seed set to 1.
2. **Given** a settings value is outside its valid range (for example a population of 1, a
   mutation rate above 1, more elite plans than the population, or all weights at 0), **When**
   the visitor tries to arrange, **Then** the app names the setting and its valid range and does
   not start the run.
3. **Given** a finished run, **When** the visitor arranges again with the same input, seed and
   settings, **Then** the arrangement is identical note for note.
4. **Given** a settings file downloaded from the app, **When** the visitor loads it back, **Then**
   every setting and the seed are restored.
5. **Given** several runs in one visit, **When** the visitor opens the run list, **Then** the last
   5 runs are listed with their changed settings and best fitness, and any of them can be played
   again.

---

### User Story 3 - Compare with the original and see the channels (Priority: P2)

After a run, the visitor switches between the original input and the arrangement while the music
plays, at the same position, as on the listening page. A visualization in the four channel colors
of the listening page (P1 blue, P2 orange, TR gray, NO light orange) draws each channel as a line
revealed with the playhead; for the original, the melody is drawn in the P1 color.

**Why this priority**: hearing the change from the original is how a listener judges the
arrangement; the listening page already established this A/B pattern and the channel colors.

**Independent Test**: arrange Mulher de Fases, start playback, switch to the original and back
three times, and check that the position never jumps and that the drawing matches what plays.

**Acceptance Scenarios**:

1. **Given** a finished run and playback at bar 9, **When** the visitor switches to the original,
   **Then** playback continues from bar 9 with the original sound, without restarting.
2. **Given** playback of either version, **When** the visitor drags the seek bar, **Then** sound
   and drawing move to the same position.
3. **Given** a finished run, **When** the visitor looks at the plan grid, **Then** each bar shows
   its four genes with their names (for example "arp16", "octave pump", "8th beat", "+12"), and the
   part labels are marked above the grid.

---

### User Story 4 - Find a song in the MPB MIDI catalog (Priority: P3)

The visitor types part of a song title, a composer or a performer, sees matching songs from
Beatriz Kauffmann's MPB MIDI catalog (3,671 songs over 27 index pages), picks one, and loads
it into the app as if they had uploaded it.

**Why this priority**: it is the secondary input route. It widens the choice of songs, but it
depends on a third-party site, and the file reaches the app through the visitor's own download.

**Independent Test**: search "fases", pick "Mulher de Fases" (Digão e Rodolfo, performed by
Raimundos), load it, choose the melody track recorded in `data/sources.json`, and arrange.

**Acceptance Scenarios**:

1. **Given** the catalog search box, **When** the visitor types at least 2 characters, **Then**
   matching songs appear with title, composers and performer, and the search ignores accents and
   letter case ("voce" finds "Você").
2. **Given** a search result, **When** the visitor picks it, **Then** the app opens the song's
   MIDI link on the catalog site, tells the visitor to drop the saved file into the app, and, once
   the file is dropped, credits the catalog and links the song's page (FR-031).
3. **Given** the catalog site does not answer, **When** the visitor picks a song, **Then** the app
   says so and offers the song's page link, and the rest of the app keeps working.

---

### Edge Cases

- A file that is neither MIDI nor ABC, an empty file, or a damaged MIDI file: the app says it cannot
  read the file and keeps the previous input.
- An ABC file with several tunes: the app lists them and arranges the one the visitor picks.
- An ABC tune with repeat signs: the app plays the repeats out into plain bars (FR-004).
- An ABC tune that starts with a pickup: the app fills the first bar with a rest before the pickup
  so that every bar is complete (FR-004).
- An ABC tune without chord symbols or with an unknown chord: the app names the problem and the bar
  and does not arrange.
- A meter other than 4/4: 2/4 is read as 4/4 by joining pairs of bars (common in samba and other
  MPB files); other meters are refused with a message that names the meter.
- A MIDI file that opens with a lead-in in another meter, such as a 3/4 count-in before a 4/4 song:
  the lead-in is skipped, and bars count from the first 4/4 (or 2/4) bar (FR-004). A change to
  another meter inside the music is refused with a message that names the meter, its bar and its
  time.
- An ABC tune with several voices: the first voice is the melody.
- A MIDI file with only drums, or with no track that can carry a melody: the app says so.
- A song longer than 256 bars: the app selects the first 256 bars, says so, and lets the visitor
  choose another range. Shorter songs are selected whole by default (changed on 2026-10-12 from
  the first 64 bars, at the student's request).
- A song without part labels: every bar belongs to one part, and the contrast criterion, which
  compares parts, is shown as "not applicable" instead of a number.
- The visitor changes a setting during a run: the change applies to the next run, and the panel
  says so.
- The visitor drops a new file during a run: the run stops and the new input loads.
- The browser tab goes to the background during a run: the run goes on, and the display catches up
  when the tab returns.
- A phone browser that blocks sound until the first tap: the first Play tap starts the sound.

## Requirements *(mandatory)*

### Functional Requirements

#### Input

- **FR-001**: The app MUST accept a file by drag and drop and by a file picker, for standard MIDI
  files (format 0 and 1) and ABC files.
- **FR-002**: For an ABC file, the app MUST read melody, chord symbols, meter, key, tempo and part
  labels (`P:`) with the same rules as the command-line reader (spec 001, FR-001 to FR-005), except
  for the extensions in FR-004.
- **FR-003**: For a MIDI file, the app MUST reduce the song to a lead sheet as the command-line
  reader does: one melody track made monophonic, onsets on a sixteenth-note grid, one chord per
  half bar detected from the other tracks, and a beat grid estimated when the file's own grid does
  not fit its drums.
- **FR-004**: The app MUST play out ABC repeat signs (including first and second endings) into
  plain bars, fill a pickup bar with a leading rest, and read 2/4 as 4/4 by joining pairs of bars.
  For a MIDI file read on its own grid, a lead-in in another meter before the first 4/4 (or 2/4)
  bar (a count-in) is skipped and bars count from that bar, as the command-line reader does; a
  meter change inside the music is refused.
- **FR-005**: For a MIDI file, the app MUST list the tracks, preselect a melody track, and let the
  visitor change the melody track, the bar range and the part labels before arranging.
- **FR-006**: The app MUST show the lead sheet it will arrange (bars, chords, parts, melody range)
  before the first run, so that the visitor can check what it understood.
- **FR-007**: The app MUST bundle the committed lead sheets in `data/leadsheets/` as one-click
  examples, with the MIDI-song settings recorded in `data/sources.json`.

#### Settings

- **FR-008**: The app MUST expose every hyperparameter of the command-line config: seed,
  population size, maximum generations, stagnation window, mutation rate, elite count, phrase
  length, tempo override and the seven fitness weights (complementarity, register, coherence,
  contrast, bass smoothness, idiom, fidelity).
- **FR-009**: Default values MUST equal `configs/default.json` at the commit the app is built
  from, and the seed MUST default to 1.
- **FR-010**: The app MUST validate settings before a run and name the setting and its valid
  range when a value is invalid: population size at least 2, elite count from 0 to the population
  size minus 1, mutation rate from 0 to 1, maximum generations, stagnation window and phrase
  length at least 1, and weights finite and at least 0 with at least one above 0 (the rule of the
  command-line config loader).
- **FR-011**: Each setting MUST carry a one- or two-sentence explanation of its musical effect,
  consistent with the README section "Hyperparameters and what the samples change".
- **FR-012**: The visitor MUST be able to download the settings as a file that the command-line
  program accepts with `--config`, and load such a file back into the app.

#### Run and live evolution

- **FR-013**: The app MUST run the same GA as the command line: 4 genes per bar, random initial
  population, roulette selection with windowing, elitism, one-point crossover at bar boundaries,
  per-gene mutation, and stopping at the maximum generations or after the stagnation window.
- **FR-014**: The app MUST draw the evolution live while the GA runs: best and mean fitness per
  generation, the generation counter and its maximum, the stagnation counter and its window, and
  the current best plan as a grid of 4 genes per bar in the channel colors. A pace control
  offers "watch" (the default, slow enough to follow the generations) and "full speed"; the pace
  never changes the result.
- **FR-015**: The page MUST stay responsive during a run: scrolling, opening panels and pressing
  Stop work without waiting for the run.
- **FR-016**: The visitor MUST be able to stop a run at any time and keep the best plan found so
  far as the result, with the stop reason shown ("stopped by visitor", "stagnation" or "maximum
  generations").
- **FR-017**: After a run, the app MUST show the best fitness and the score of each criterion,
  with "not applicable" for criteria that do not apply to the song.
- **FR-018**: The app MUST check the finished arrangement with the NES rules of spec 001 (one note
  at a time per channel, pitch ranges, complete bars) and report any violation instead of playing
  a broken piece.
- **FR-019**: The app MUST keep the last 5 runs of the visit, each with its settings, plan, fitness
  curve and arrangement, so that the visitor can play and compare them.

#### Listening, visualization and downloads

- **FR-020**: The app MUST play the arrangement with an NES chip sound: two pulse channels, a
  triangle and a noise channel, with the same channel roles as the command-line chip renderer.
- **FR-021**: The app MUST make the original input audible: for an ABC lead sheet, the melody and
  chords played plainly; for a MIDI song, the selected excerpt with all its tracks.
- **FR-022**: The visitor MUST be able to switch between original and arrangement during playback
  without losing the position, and to seek in either.
- **FR-023**: The app MUST draw the playing version as one line per channel revealed with the
  playhead, in the listening page's channel colors, with the melody of the original in the P1
  color.
- **FR-024**: The visitor MUST be able to download the arrangement as a four-track MIDI file
  (tracks P1, P2, TR, NO), the settings file of FR-012, and the lead sheet as ABC, so that the
  command-line program can rerun the arrangement from a MIDI-song input.
- **FR-025**: The app MUST label every download with the input name, the seed and a short hash of
  the settings, as the command line names its run folders.

#### Reproducibility

- **FR-026**: The same input, seed and settings MUST give the same arrangement note for note,
  across reloads, browsers and devices.
- **FR-027**: The settings file MUST record the seed, every hyperparameter, the input's SHA-256,
  the app version (git commit) and the creation date, like the command line's `config.json`.
- **FR-028**: The app MUST implement the same algorithm, settings and fitness criteria as the
  command line, but it does not need to give the same arrangement as the command line for the same
  seed: the app has its own random generator, and its runs are reproducible inside the app
  (FR-026). The app's About text MUST say so. To keep the two implementations honest, the app MUST
  give the same fitness and criterion scores as the command line to any given plan (SC-010), and
  the same lead sheet from the same MIDI song and settings (SC-006).

#### Catalog

- **FR-029**: The app MUST offer a search over a list of the catalog's songs with title,
  composers, performer, song page and MIDI link, built ahead of time from the catalog's 27 index
  pages and song pages, and committed with the app. The list holds metadata and links only, never
  MIDI files.
- **FR-030**: The search MUST match any part of title, composer or performer, ignoring accents and
  letter case, and show results while the visitor types.
- **FR-031**: The catalog site does not let other sites read its files from a browser, so a
  picked song reaches the app in two steps: the app opens the song's MIDI link on the catalog site,
  where the browser saves the file, and the visitor drops the saved file into the app. The app MUST
  show these two steps next to the picked song, and MUST match the dropped file to the picked
  entry (by name), so that the credit and the song page link of FR-032 follow it. The app uses no
  relay or proxy service.
- **FR-032**: The app MUST credit Beatriz Kauffmann's Web Site and link the song's page wherever a
  catalog song is shown or arranged.

#### Privacy, delivery and access

- **FR-033**: Files the visitor uploads MUST stay on the visitor's device: the app sends no file
  content and no settings to any server.
- **FR-034**: The app MUST be a static page on the project's GitHub Pages site, linked from the
  listening page and the README, with no server-side code and no account.
- **FR-035**: After the first visit, the app MUST work with the network off, except for the
  catalog route.
- **FR-036**: The app MUST work at phone width (375 px) without horizontal scrolling, and every
  control MUST be reachable and usable by keyboard.
- **FR-037**: The app MUST follow the listening page's visual language: dark background, the four
  channel colors, Inter for text and JetBrains Mono for numbers and genes.

### Key Entities

- **Input song**: the file the visitor gave or picked: name, kind (ABC or MIDI), SHA-256, and for
  MIDI the track list.
- **Lead sheet**: the reduction the GA works on: bars of 4 beats, each with melody notes, one or
  two chords and a part label; plus title, key and tempo. Same meaning as in spec 001.
- **Settings**: seed and hyperparameters; the same keys as the command line's config file.
- **Run**: one GA execution: settings, per-generation best and mean fitness, stagnation history,
  best plan, stop reason, criterion scores and duration.
- **Plan**: 4 genes per bar (P2 texture, TR texture, NO pattern, P1 octave).
- **Arrangement**: the four-channel piece realized from the plan, as notes with pitch, start and
  duration in beats.
- **Catalog entry**: title, composers, performer, index letter, song page link and MIDI link.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a mid-range laptop with a 20 Mbit/s connection, a first-time visitor can drop a
  file 10 seconds after opening the app; on later visits, 3 seconds.
- **SC-002**: On a mid-range laptop, the GA finishes Korobeiniki (32 bars, default settings) in
  at most 15 seconds and Amor I Love You (56 bars, its recorded 4000/400 limits) in at most 25
  seconds, about twice the command line's time (see Context).
- **SC-003**: During a run, the evolution display updates at least 10 times per second, and a
  press of Stop takes effect within 0.5 seconds.
- **SC-004**: All 10 inputs of the committed samples arrange in the app with their recorded
  settings, and every result passes the NES rule check.
- **SC-005**: The same input, seed and settings give identical MIDI in 10 repeated runs, in the
  latest Chrome, Firefox and Safari.
- **SC-006**: For each of the 5 public MIDI songs in `data/sources.json`, the lead sheet the app
  reduces with the recorded settings matches the committed ABC lead sheet bar for bar (melody and
  chords).
- **SC-007**: A catalog search shows results within 0.3 seconds of the last keystroke, and every
  catalog song in a sample of 20 can be found by its title, its first composer and its performer.
- **SC-008**: A network log of a whole session (upload, arrange, play, download) shows no request
  that carries the visitor's file or settings.
- **SC-009**: Three classmates who have not seen the app each go from opening it to downloading an
  arrangement of their own file in under 3 minutes, without help.
- **SC-010**: For each of the 10 committed samples, the app scores the sample's plan with the same
  fitness and criterion values as the command line, to 6 decimal places.

## Assumptions

- Visitors use a recent desktop or phone browser (the last two versions of Chrome, Firefox, Safari
  and Edge). Older browsers are not supported.
- The app supports the same musical inputs as the command line (4/4, one melody, chord symbols,
  and for MIDI files a count-in in another meter before the 4/4 music), widened only by FR-004;
  chord inference for ABC tunes without chord symbols is out of scope.
- The whole song is selected by default, up to 256 bars, the hard limit. Longer songs need a range.
- The original MIDI is made audible with simple built-in instrument sounds, not a General MIDI
  soundfont; the General MIDI rendering stays on the listening page.
- The catalog list is a snapshot. It is rebuilt by a documented command with polite crawling (one
  request per second, about 3,700 pages), and song pages that disappear later show an error on
  pick.
- The listening page and its 10 samples stay as they are; the app is a new page next to them.
- The command line stays the reference implementation for the abstract and the samples; a seed
  in the app and the same seed in the command line give different, equally valid arrangements.
- Development happens on the branch `002-browser-arranger`. `main`, the tag `v1.0-submission` and
  the published site stay at the submitted state until the student reviews and merges.

## Dependencies and Constraints

- Constitution 1.3.0 (amended 2026-10-12 for this feature) allows the browser implementation
  of the reader, the GA and the synthesizer (FR-028): its section "Web App Constraints" and
  principles I, II and IV set the seeded generator, the parity tests against the command line,
  the test-first and learnable-code rules for web code, and the no-server, privacy and
  dependency rules.
- The constitution keeps third-party MIDI files out of git, so the app never hosts catalog MIDI
  files (FR-029).
- The catalog site states "All Rights Reserved"; the app uses only its public links and metadata,
  credits it, and does not copy its files.
- Principles I, II, IV and V still apply: tests first, docstrings with worked examples, a visual
  for each core concept, and figures in the colorblind-safe palette.
