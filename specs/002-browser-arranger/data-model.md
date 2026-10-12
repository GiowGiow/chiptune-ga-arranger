# Data Model: Browser Arranger

Units follow constitution principle III:
- pitches are MIDI numbers 0–127;
- times in the core are quarter-note beats;
- seconds appear only in `audio/`, `midi-file.js` and `midi-export.js`.

The names match the Python modules, so `Bar.phrase_end` is `phrase_end` in Python and
`phraseEnd` in JavaScript. JSON fixtures use the Python names.

## Input song

The file the visitor gave, before reduction.

| Field | Type | Rule |
|---|---|---|
| `name` | string | file name as given; the run id uses its stem |
| `kind` | `"abc"` \| `"midi"` | decided by content: a MIDI file starts with `MThd`, anything else is read as ABC text |
| `sha256` | hex string (64) | SHA-256 of the file bytes (Web Crypto) |
| `bytes` | Uint8Array | kept in memory only; never sent anywhere (FR-033) |
| `catalogEntry` | Catalog entry \| null | set when the dropped file name matches the picked catalog entry (FR-031) |

### Reading an ABC file

The reader returns either a list of tunes or an error that names the problem and, when it can,
the bar:

- `tunes: [{ index, title }]`, one per `X:` header;
- `{ error, bar? }` when the file cannot be read.

### Reading a MIDI file

- `tracks: [Track]`, in pretty_midi order (see research R4). The track index is the
  `melody_track` of the CLI config.
- `Track` holds `{ index, name, program, isDrum, noteCount, lowest, highest, meanPitch,
  polyphony }`, where `polyphony` is the share of notes that overlap another note.
- `suggestedMelodyTrack`: an index into `tracks` (research R11).
- `barCount`: the number of bars that hold notes on the beat grid.
- `timeSignature`: `"4/4"` or `"2/4"`. Any other meter is an error that names the meter.

## Lead sheet

The same entity as spec 001, `src/leadsheet/model.py`.

| Field | Type | Rule |
|---|---|---|
| `title` | string | ABC `T:` or the MIDI file stem |
| `key` | string | music21-style name, `""` for none or for MIDI |
| `tempoBpm` | number > 0 | ABC `Q:` in quarter notes per minute, the MIDI grid tempo, or the override; default 140 |
| `bars` | Bar[] | 1 to 128 bars, in performed order (repeats played out) |
| `sourceGrid` | `[bpm, downbeatSeconds]` \| null | MIDI only |

**Bar**: `{ index, melody: MelodyNote[], chords: ChordSegment[], label, role, phrase, phraseEnd }`

- `melody` is monophonic and sorted by onset, with `0 ≤ onset < 4` and `onset + duration ≤ 4`.
- `chords` cover [0, 4) without gaps; there are 1 to 4 segments per bar.
- `role` is `"verse"` or `"chorus"`. It comes from `label` by `section_role` (B or a label that
  contains "chorus" means chorus), unless `role_map` overrides it.
- `phrase` and `phraseEnd` come from `phrase_marks(sections, phrase_length)`.

**MelodyNote**: `{ pitch, onset, duration }`, with `duration > 0`.

**ChordSegment**: `{ symbol, root, tones, onset, duration }`

- `tones` lists pitch classes in the order root, third, fifth and seventh.
- `chordTones(symbol)` gives `root` and `tones`. It matches music21 for the chord qualities in
  fixture `chords.json` (research R3).

## Settings

These are the keys of `configs/default.json`. The defaults are read at run time from
`../configs/default.json`.

| Key | Type | Valid range (FR-010) |
|---|---|---|
| `seed` | integer | 0 to 4,294,967,295; default 1 |
| `population_size` | integer | ≥ 2 |
| `max_generations` | integer | ≥ 1 |
| `stagnation_window` | integer | ≥ 1 |
| `mutation_rate` | number | 0 to 1 |
| `elite_count` | integer | 0 to `population_size − 1` |
| `phrase_length` | integer | ≥ 1 |
| `tempo_bpm` | number \| null | null, or 20 to 400 |
| `role_map` | `{label: "verse" \| "chorus"}` | labels of the lead sheet |
| `weights.<criterion>` (7 criteria) | number | finite, ≥ 0; at least one > 0 |
| `midi.melody_track` | integer \| null | an index of a non-drum track; required for MIDI input |
| `midi.bars` | `[first, end]` \| null | `0 ≤ first < end ≤ barCount` and `end − first ≤ 128` |
| `midi.sections` | `[[bar, label], …]` \| null | bars inside the excerpt; strictly increasing |
| `midi.grid` | `"auto"` \| `"file"` \| `[bpm, downbeat]` | as in the CLI |

The app's own preferences are not settings and never enter `config.json`:
- `pace`: `"watch"` or `"full"`;
- `audioOnly`.

## Run

One GA execution. The app keeps the last 5 runs of a visit (FR-019).

| Field | Type | Meaning |
|---|---|---|
| `runId` | string | `<input stem>-s<seed>-<8 hex>`; the hex is the first 8 characters of the SHA-256 of the canonical settings JSON (FR-025) |
| `settings` | Settings | frozen copy |
| `leadSheet` | Lead sheet | the reduction this run used |
| `log` | Generation stats[] | one entry per generation |
| `bestPlan` | Plan | best plan seen in any generation |
| `initialBestPlan` | Plan | best plan of generation 0 |
| `bestFitness` | number | in [0, 1] |
| `scores` | `{criterion: number \| null}` | `null` when the criterion is not applicable (shown as "not applicable") |
| `stopReason` | `"stagnation"` \| `"max_generations"` \| `"stopped"` | `"stopped"` when the visitor pressed Stop |
| `durationMs` | number | wall-clock time of the evolution |
| `arrangement` | Arrangement | realized from `bestPlan` and validated |
| `violations` | string[] | NES rule violations; it must be empty before playback (FR-018) |

**Generation stats**: `{ generation, best, mean, diversity, stagnation }`, where `stagnation`
counts the generations without improvement and is compared with `stagnation_window`.

### Run state

```text
idle ──Arrange──▶ evolving ──(stagnation | max_generations)──▶ realized ──▶ ready
                    │                                             │
                    └──Stop──▶ realized (stopReason "stopped")     └──violations──▶ failed
evolving ──new file dropped──▶ cancelled (the run is discarded and is not kept)
```

## Plan

A `Uint8Array` of length `n_bars × 4`, in row-major order. Bar `b` holds the four genes at
indices `4b … 4b+3`:

| Gene | Index | Values |
|---|---|---|
| P2 texture | 0 | `hold`, `arp16`, `arp32`, `echo`, `third` |
| TR texture | 1 | `root`, `octave_pump`, `root_fifth`, `walking` |
| NO pattern | 2 | `none`, `half_time`, `eighth_beat`, `sixteenth_beat`, `fill` |
| P1 octave | 3 | `0`, `+12`, `−12` |

A population is one `Uint8Array` of `m × n_bars × 4`, so the GA never allocates per plan.

## Score tables

These are the same arrays as `ScoreTables` in `src/ga/tables.py`. They are flattened into
`Float64Array`, `Int32Array` and `Uint8Array`, with the Python shapes listed in the
`tables.js` header. In the fixtures, NaN is written as `null`.

## Arrangement

`{ title, tempoBpm, plan, channels: { P1, P2, TR, NO } }`

- Each channel is a list of `{ pitch, onset, duration, velocity }`, with `onset` in beats from
  the start of the piece.
- The rules are those of spec 001:
  - one note at a time per channel;
  - P1 and P2 within 33–108, TR within 21–108;
  - complete bars;
  - chord tones on strong beats, except in the echo texture.

## Catalog entry

`arranger/data/catalog.json` stores each entry with short keys.

| Field | Key | Rule |
|---|---|---|
| title | `t` | as on the index page, with HTML entities decoded; a medley joins its titles with " • " |
| composers | `c` | as on the index page; may be empty |
| performer | `p` | from the song page `<title>` ("TITLE - Performer - MIDI e Letra…"); may be empty |
| page | `u` | absolute URL of the song page |
| MIDI links | `m` | absolute URLs of the `.mid` links on the song page (1 or more) |

Rules:
- An entry without a MIDI link is dropped.
- The search key is computed when the catalog loads: title, composers and performer, lowercase,
  with accents removed (research R8).

## Fixture files

Written by `uv run src/main.py fixtures` into `arranger/tests/fixtures/`. The format is in
[contracts/files.md](contracts/files.md).
