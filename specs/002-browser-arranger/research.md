# Research: Browser Arranger

The spec carries no NEEDS CLARIFICATION after the student's answers of 2026-10-12. This document
records the technical decisions of the plan. Measurements were made on the student's laptop
(Node 22.23, Linux).

## R1. Language and types

- **Decision**: plain JavaScript ES2022 modules, with `// @ts-check` and JSDoc types on every
  export, and no build step. Browsers load the files as committed, and Node runs the same files
  in tests.
- **Rationale**: the constitution asks for no build step when feasible (Web App Constraints)
  and for typed, documented exports (principle IV). JSDoc types give editor checking, as Pyright
  does for the Python code, without a compile stage.
- **Alternatives considered**:
  - TypeScript with esbuild or `tsc`. Rejected: it needs a build, and the committed output would
    be a second copy of the code.
  - Node's type stripping. Rejected: browsers cannot run `.ts` files.

## R2. Test runner

- **Decision**: Node's built-in `node:test` with `node:assert/strict`, run as `node --test` in
  `arranger/`. There is no npm dependency. Fixtures are read with `fs`.
- **Rationale**: it has zero dependencies, which follows principle VII and the pinned-dependency
  rule. It supports ESM, `describe`/`test` names and skips (`t.skip()` when `data/raw/` lacks a
  MIDI file), which lets test names read as behavior.
- **Alternatives considered**:
  - Vitest or Jest. Rejected: a large dependency tree for features the suite does not need.
  - A browser test runner (Playwright). Rejected: the core is pure and needs no browser.
    Quickstart covers the UI by hand.

## R3. ABC parser

- **Probe (2026-10-12)**: abcjs 6.7.1 (MIT) was installed in a scratch folder and run in Node
  on `korobeiniki.abc`, `ievan_polkka.abc`, `mulher_de_fases.abc` and test tunes with every
  feature listed below.
  - `ABCJS.parseOnly(text)` works without a DOM and returns one tune per `X:`.
  - Notes are elements with:
    - `duration`, a fraction of a whole note that already includes `L:` and broken rhythm but
      not tuplets (the first note of a tuplet carries `tripletMultiplier`, the last carries
      `endTriplet`);
    - `pitches[].pitch`, a diatonic staff step, not MIDI;
    - `chord[{name, position}]`, where `position: "default"` means a chord symbol;
    - `startTie` and `endTie`, and `gracenotes`.
  - Bars carry `type` (`bar_left_repeat`, `bar_right_repeat`, `bar_dbl_repeat`, …) and
    `startEnding` (`"1"`, `"2"`, `"1,3"`).
  - `P:` lines in the body become `{el_type: "part", title}` elements.
  - `tune.setUpAudio({chordsOff: true})` works in Node. As a side effect it writes
    `midiPitches` onto every note element, with the key signature, the in-bar accidentals and
    inline key changes applied.
  - The bundle `dist/abcjs-basic-min.js` is 512 KB, or 149 KB gzipped. It is UMD: a classic
    `<script>` sets `globalThis.ABCJS`, and `createRequire` loads it in Node tests. An ES-module
    `import` of it fails.
- **Decision**: vendor `abcjs-basic-min.js` 6.7.1 with its LICENSE in `arranger/vendor/abcjs/`.
  - The page loads it with a classic `<script>` only when an ABC text is read, so the first load
    stays light (SC-001).
  - `core/abc-reader.js` stays pure. It receives the `ABCJS` object as a parameter: the page
    passes `globalThis.ABCJS`, and the tests pass the copy loaded with `createRequire`.
  - The reader does its own reduction to bars:
    1. Parse `"%%freegchord true\n" + text`. Without the directive, abcjs rewrites chord names
       in Unicode (`F#` → `F♯`).
    2. Call `setUpAudio({chordsOff: true})` only to fill `midiPitches`.
    3. Walk `lines[*].staff[0].voices[0]`, the first voice. Bars can span source lines.
    4. Convert durations to integer ticks (480 per quarter), with the tuplet multiplier carried
       from `startTriplet` to `endTriplet`, so 2/3 adds no float noise.
    5. Merge ties: a tie continuation has empty `midiPitches` and takes the previous pitch.
    6. Take the top note of a chord `[CEG]` as the melody. Grace notes take no time, as in
       spec 001.
    7. Expand repeats and endings from the bar markers.
    8. Read `Q:` from the text when it has decimals, because abcjs truncates the tempo to an
       integer (`Q:1/4=132.500055` gives 132).
    9. Find a pickup from the length of the first bar. Join 2/4 bars in pairs (R11).
  - The repeat expansion is tested against abcjs's own `setUpAudio` note sequence.
  - The chord names it reads go through `core/chords.js`, which follows music21's
    `ChordSymbol` for the qualities in `chords.json`.
- **Rationale**: the primary input is "an arbitrary ABC file" (US1). Real tunes use what a small
  hand-written parser would have to get right: modes and `K:none`, accidental carry and inline
  `K:`, every repeat and ending variant, tuplets, broken rhythm, ties, decorations, grace notes,
  several tunes in one file. abcjs handles all of them on the probe. Its cost is one pinned,
  vendored file, loaded on demand.
- **Alternatives considered**:
  - A hand-written parser ported from `abc_reader.py`. Rejected: the Python reader relies on
    music21 for exactly the hard parts above.
  - abcjs's repeat-expanded `setUpAudio` tracks as the only source. Rejected: they drop chord
    names and part labels, turn trills into 32nd notes and give grace notes half the main note's
    time.
- **Known limits**:
  - A key change inside a repeated section keeps the pitches of its last pass (abcjs behavior).
  - Chord symbols on spacer rests `x` are read from the parse, not from the audio sequence.
  - Both limits are documented in the reader's header comment.

## R4. MIDI file reading and writing

- **Decision**: our own small standard-MIDI-file reader and writer in `core/midi-file.js`.
  - The reader copies pretty_midi's semantics:
    - an instrument per (program, channel, track) key, in creation order; a note belongs to
      the program in effect when it ends, and the provisional "straggler" instruments of
      pretty_midi `_load_instruments` collect only control changes and pitch bends, so they
      never hold notes and never appear in the list (found while porting, 2026-10-12);
    - a note-off (or a note-on at velocity 0) closes every open note of that channel and pitch
      except the zero-length ones;
    - times in seconds come from the tempo map;
    - `timeToTick` and `resolution` behave as in pretty_midi.
  - The writer emits format 1 at 480 ticks per quarter note.
- **Rationale**: `data/sources.json` and the CLI config name the melody by pretty_midi's
  instrument index (`melody_track`). SC-006 (reduction parity) needs the same instrument list
  and the same note times. The format is small: header, track chunks, variable-length numbers,
  running status, meta events. The parser is about 250 lines and is tested against the
  `midi-songs` fixtures, which hold pretty_midi's instrument summaries.
- **Alternatives considered**: `@tonejs/midi`. Rejected:
  - it groups notes by track, not by (program, channel, track), so its indices would differ from
    pretty_midi's;
  - it adds a dependency that the reduction would still have to adapt.

## R5. Seeded random generator

- **Decision**: `createRandom(seed)` returns a generator object.
  - Its state is sfc32 (four 32-bit words). splitmix32 fills the state from the integer seed,
    then 12 outputs are discarded to warm it up.
  - Methods:
    - `uint32()`;
    - `float()`, which returns `uint32 / 2^32` in [0, 1);
    - `integer(low, high)`, unbiased by rejection;
    - `pickWeighted(cumulative, total)`, a binary search over a cumulative array.
  - Every function that draws takes it as its first parameter, as Python passes `rng`.
  - Seeds are integers from 0 to 2^32 − 1.
- **Rationale**: FR-028 frees the app from numpy's PCG64 stream. sfc32 passes the PractRand
  battery, runs on 32-bit integer operations (`| 0`, `>>>`, `Math.imul`) and gives the same
  stream in every JavaScript engine. A test pins the first outputs for seed 1.
- **Alternatives considered**:
  - A port of numpy's PCG64 plus `Generator.integers`/`choice`. Rejected: parity with the CLI is
    not required, and those algorithms need 128-bit arithmetic.
  - mulberry32. Rejected: weaker statistically.
  - xoshiro128\*\*. Equivalent; sfc32 is shorter to explain.

## R6. GA execution, pace and stop

- **Measured**: a throwaway prototype of the fitness and GA loop used flat typed arrays:
  - population `Uint8Array(m × n × 4)`;
  - tables as typed arrays;
  - roulette by cumulative sum and binary search;
  - stable elite sort.

  Results (population 60):
  - 32 bars: 1,905 generations in 215 ms, 113 µs per generation;
  - 56 bars: 2,491 generations in 578 ms, 232 µs per generation.

  The CLI takes 9.5 s and 12.4 s for the same work.
- **Decision**:
  - `evolve` in `core/evolution.js` is a generator function that yields after each
    generation, so the caller decides when to pause.
  - `worker.js` runs it in a module worker, in slices of at most 8 ms, and posts `progress` at
    most every 50 ms.
  - `pace: "watch"` (the default) waits so that generation g is not reached before g / 400
    seconds. A whole run then lasts a few seconds and the visitor sees it evolve:
    Korobeiniki takes about 4.8 s and Amor I Love You about 6.2 s, which meets SC-002.
  - `pace: "full"` never waits.
  - Stop is checked between slices.
- **Rationale**: the spec wants the run drawn live while it happens (FR-014). A run that ends
  in 0.2 s would show only its last frame. Throttling the real run, rather than replaying a
  finished log, keeps "live" literally true, and Stop then acts on a run in progress. Pauses fall
  between generations and never touch the random stream, so the pace cannot change the result
  (worker contract, Guarantees).
- **Alternatives considered**:
  - Main-thread slices with `requestIdleCallback`. Rejected: they compete with drawing and
    audio (FR-015).
  - Finish at full speed and replay the log. Rejected: Stop would be meaningless, and the
    display would not be live.

## R7. Audio rendering and A/B playback

- **Decision**: render whole PCM buffers with pure functions, then play them with Web Audio.
  - `audio/chip-synth.js` ports `src/export/chip_audio.py` with the same constants:
    - pulse duty cycles 25% (P1) and 12.5% (P2), with 4-bit volume from velocity;
    - a 32-step triangle;
    - 15-bit LFSR noise with long and short modes and the drum table;
    - mixer gains from the NESdev linear approximation;
    - 2 ms edge fades;
    - a -3 dBFS peak.
  - `audio/plain-synth.js` makes the input audible:
    - for a lead sheet, the melody as a soft triangle and the chords as a quiet held three-note
      pad;
    - for a MIDI song, every pitched track of the excerpt with a simple tone (triangle below
      MIDI 48, softened square above), and the drums as short noise bursts.
  - `audio/loudness.js` matches the two renders. It takes the gated RMS over 400 ms blocks with
    an absolute gate at -70 dBFS, then gains each render to the same level with a peak ceiling
    at -1 dBFS.
  - Both buffers are rendered on the beat timeline at the run's tempo, so beat b is at the same
    second in both.
  - `audio/player.js` starts both `AudioBufferSourceNode`s together and switches A/B with two
    gain nodes and a 10 ms ramp. A seek restarts both at the new offset.
  - Rendering happens at the `AudioContext` sample rate (44.1 or 48 kHz).
- **Rationale**: the listening page showed that the comparison works only if the position is
  kept (US3). Two sources started at the same time stay sample-aligned, unlike swapping media
  elements. Pure renderers can be tested in Node:
  - the duty-cycle share of high samples;
  - the triangle's 16 levels;
  - the LFSR periods 32,767 and 93;
  - equal loudness after matching.

  Rendering 60 s of four channels is a few million samples, which takes tens of milliseconds.
- **Alternatives considered**:
  - An `AudioWorklet` synth running live. Rejected: more moving parts, and seeking and A/B are
    harder.
  - `OscillatorNode` pulse waves through `PeriodicWave`. Rejected: no LFSR noise, and the
    duty-cycle shape is approximate.
  - Full EBU R128 with K-weighting. Rejected as more than the comparison needs. Documented as a
    difference from the CLI's -16 LUFS normalization.

## R8. Catalog index and search

Survey of the site (2026-10-12):
- **Index pages**: 27 pages, `mpb_0-9.html` and `mpb_a.html` … `mpb_z.html`, with 3,671 song
  links in total. A row is `<a href="mpb_m/<slug>.html" class="BB"><b>TITLE</b></a> &nbsp;Composers`.
  A medley joins its titles with `&bull;`.
- **Song pages**: the page `<title>` is "TITLE - Performer - MIDI e Letra da Música…". MIDI
  links are `href="som/<slug>.mid"`, relative to the letter folder.
- **Access**: responses carry no `Access-Control-Allow-Origin`, so a browser on another origin
  cannot read them. robots.txt is the host's placeholder page, not a robots file. The pages say
  "All Rights Reserved".

**Decision**:
- `src/catalog/pages.py` parses index rows and song pages with `html.parser`. It is pure and
  tested on synthetic HTML in the same structure.
- `src/catalog/crawl.py` fetches with `urllib`:
  - 1 request per second;
  - the project User-Agent;
  - a resumable page cache in `data/raw/catalog/`.
- The crawl writes `arranger/data/catalog.json` with metadata and links only.
- In the app, `core/catalog.js` builds, for each entry, one search key from title, composers and
  performer. The key is normalized: NFD, combining marks removed, lowercase, spaces collapsed.
- A search is a substring match ranked by:
  1. title prefix;
  2. title substring;
  3. composer or performer;
  4. alphabetical.

  The search shows at most 50 results. 3,700 entries take well under 10 ms.
- The picked entry shows two steps (FR-031):
  1. "Open the MIDI on the catalog site": a link with `target="_blank"` and `rel="noopener"`.
  2. "Drop the saved file here".

  A dropped file whose name matches the entry's MIDI file name takes the entry's credit.

**Rationale**:
- The decision follows the student's choice for FR-031: no relay.
- The crawl happens once and offline, so visitors never touch the catalog site except by their
  own click.
- Metadata and links follow the constitution's catalog rule.

**Alternatives considered**:
- Crawling the 27 index pages only. Rejected: the performer is only on song pages, and the
  student asked to search by artist.
- Building the index in the browser at run time. Rejected: CORS blocks it.

## R9. Deployment and the app version

- **Decision**: add `.github/workflows/pages.yml`.
  - Job `test`, on every push and pull request: Node 22, `node --test` in `arranger/`.
  - Job `deploy`, on `main` only, after `test`:
    - write `arranger/version.json` with `github.sha` and the time;
    - `actions/upload-pages-artifact` with the repository root;
    - `actions/deploy-pages`.
  - The Pages source changes from "Deploy from a branch" to "GitHub Actions". This is a
    one-time repository setting that the student switches at merge time (quickstart step 7).
  - Until then, the branch is previewed locally.
- **Rationale**: FR-027 needs the app version as a git commit inside the downloaded
  `config.json`. A static file cannot know its own commit, and asking the GitHub API at run time
  would break the privacy rule (the app fetches only its own files). Writing one JSON file at
  deploy time is a deployment step, not a build: the committed tree still serves as it is, with
  `"dev"` as the version (Web App Constraints, Build).
- **Alternatives considered**:
  - A version string bumped by hand. Rejected: it goes stale.
  - A `post-commit` hook. Rejected: it cannot write the commit into the commit it belongs to.

## R10. Offline use

- **Decision**: `arranger/sw.js` is a service worker with scope `arranger/`.
  - On install, it precaches the app shell: `index.html`, `style.css`, `version.json`,
    `src/**`, `vendor/**`, `../configs/default.json` and the 8 examples in
    `../data/leadsheets/`.
  - It serves cache-first.
  - It caches `data/catalog.json` the first time the panel opens.
  - The cache name holds the commit from `version.json`, so a deploy replaces it. Old caches are
    deleted on `activate`.
- **Rationale**: FR-035 and SC-001 (repeat visit in 3 s). A service worker intercepts every
  request of the pages it controls, including `../` URLs on the same origin.
- **Alternatives considered**: the HTTP cache alone. Rejected: it does not guarantee offline use.

## R11. Input handling details

- **Melody track suggestion** for MIDI. Each non-drum track gets the score
  `notes × (1 − polyphony)`, with two adjustments:
  - ×1.5 when its name matches `/voc|voz|melod|lead|canto|vocal|melody/i`;
  - ×0.2 when its mean pitch is below 55 or above 84.

  The highest score wins. A test checks it on the 5 public MIDI songs and accepts the recorded
  track as the first or second suggestion. The visitor confirms the choice in every case
  (FR-005).
- **Meters**:
  - 4/4 is read as is.
  - 2/4 is joined in pairs of bars. A pickup counts in the pair. An odd last bar is padded with
    a rest.
  - Any other meter is refused with a message that names it.
  - For a MIDI file, the beat grid is already in quarter notes, so 2/4 only changes the
    accepted time-signature list.
- **Length**:
  - The whole song is selected by default.
  - Above 256 bars the app selects the first 256 and refuses a longer range (changed on
    2026-10-12 from 64 by default and 128 at most, at the student's request).
- **Several tunes in one ABC file**: the app lists them by `T:` and reads the one picked.
- **Without part labels**: one section "A". Contrast then shows "not applicable" (NaN in
  Python, `null` in JSON).

## R12. Settings hash and the CLI's run record

- **Decision**:
  - The run id hash is the first 8 hex characters of the SHA-256 of the canonical settings JSON
    (sorted keys, `JSON.stringify` numbers), computed with Web Crypto.
  - It is not the CLI's hash, because Python writes `1.0` where JavaScript writes `1`. The
    About text says so.
  - `load_config` in Python skips the run-record keys, so the app's `config.json` reruns in the
    CLI (contracts/cli.md).
- **Rationale**: FR-012 and FR-025. A small CLI change, with a test, avoids two kinds of
  settings file.
- **Alternatives considered**: download a config without the run keys plus a separate
  `run.json`. Rejected: two files to keep together, and the CLI already writes one record with
  both.
