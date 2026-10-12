# Contract: Files

## Downloads (FR-024, FR-025, FR-027)

Every download is named with the run id `<input stem>-s<seed>-<8 hex>`.

### `<run id>.mid`

- A standard MIDI file, format 1, 480 ticks per quarter note.
- Track 0 holds the tempo (`tempoBpm`) and the 4/4 time signature. Then come four tracks, named
  `P1`, `P2`, `TR` and `NO`:

| Track | MIDI channel | Program (General MIDI) |
|---|---|---|
| P1 | 0 | 80 (square lead) |
| P2 | 1 | 80 (square lead) |
| TR | 2 | 38 (synth bass) |
| NO | 9 (drums) | 0 |

These match `src/export/midi.py`. The CLI's `pretty_midi` reads the file back with the same
instrument names and notes (checked by a pytest that reads a fixture written by the JavaScript
writer).

### `<run id>.config.json`

The CLI's run record: every key of `configs/default.json`, then the run keys.

```json
{
  "population_size": 60, "max_generations": 3000, "stagnation_window": 300,
  "mutation_rate": 0.01, "elite_count": 2, "phrase_length": 4, "tempo_bpm": null,
  "role_map": {}, "weights": { "complementarity": 1.0, "...": "..." },
  "midi": { "melody_track": 6, "bars": [8, 40], "sections": [[0, "A"], [8, "Chorus"]], "grid": "auto" },
  "seed": 1,
  "input_path": "mulher-de-fases.mid",
  "input_sha256": "fc5611b1…",
  "git_commit": "2b6671b…",
  "git_dirty": false,
  "created": "2026-10-12T15:04:05Z",
  "run_id": "mulher-de-fases-s1-3fa2c901",
  "best_fitness": 0.896,
  "stop_reason": "stagnation",
  "generations": 1227,
  "audio": false,
  "app": { "name": "chiptune-ga-arranger web", "pace": "watch", "catalog_page": "https://www.beakauffmann.com/mpb_m/mulher-de-fases.html" }
}
```

- `git_commit` comes from `version.json`. It is `"dev"` when the app is served locally.
- `app.catalog_page` is present only for a catalog song.
- `uv run src/main.py arrange <input> --config <run id>.config.json --seed <seed>` accepts this
  file (contracts/cli.md). It reruns the same algorithm with the same settings. The CLI's own
  random generator gives a different arrangement (FR-028).

### `<run id>.abc`

- The lead sheet the run used, written like `src/leadsheet/abc_writer.py`: `K:none` for a MIDI
  song, one chord symbol per segment, and `P:` lines at the section starts.
- For the committed lead sheets, the body is byte-for-byte the Python writer's output (fixture
  test).

## `arranger/version.json`

```json
{ "commit": "dev", "date": null }
```

The Pages workflow replaces it at deploy time with `{"commit": "<github.sha>", "date": "<ISO
time>"}`. The committed file always says `"dev"`.

## `arranger/data/catalog.json`

```json
{
  "source": "Beatriz Kauffmann's Web Site",
  "home": "https://www.beakauffmann.com/",
  "note": "Metadata and links only. The MIDI files stay on the catalog site (All Rights Reserved).",
  "retrieved": "2026-10-12",
  "entries": [
    { "t": "Mulher de Fases", "c": "Digão e Rodolfo", "p": "Raimundos",
      "u": "https://www.beakauffmann.com/mpb_m/mulher-de-fases.html",
      "m": ["https://www.beakauffmann.com/mpb_m/som/mulher-de-fases.mid"] }
  ]
}
```

- Entries are sorted by title, ignoring accents and letter case.
- Text is in the site's own spelling, with HTML entities decoded to UTF-8.

## Parity fixtures: `arranger/tests/fixtures/`

The fixtures are written by `uv run src/main.py fixtures` from the Python reference, and they are
committed. Inside them:
- NaN is written as `null`;
- the field names are Python's;
- arrays keep their numpy shape as nested lists.

| File | Content | Used by |
|---|---|---|
| `chords.json` | `{symbol: [root, [tones]]}` for every symbol of the committed lead sheets plus the common qualities (maj7, dim, dim7, m7b5, aug, sus2, sus4, 6, m6, 9, add9) | `chords.test.js` |
| `leadsheets/<id>.json` | Python lead sheet of each committed ABC lead sheet (8) | `abc-reader.test.js` |
| `realizations/<id>.json` | notes of every (bar, channel, gene value) for `korobeiniki` and `mulher_de_fases` | `textures.test.js` |
| `tables/<id>.json` | `ScoreTables` of each committed lead sheet | `tables.test.js` |
| `plans/<sample>.json` | for each of the 10 samples: lead sheet id, settings, best plan (rerun from the sample's `config.json`), criterion scores and fitness | `fitness.test.js` (SC-010) |
| `midi-songs/<id>.json` | for the 5 public MIDI songs: the pretty_midi instrument summary (index, name, program, is_drum, note count, first and last note) and the reduced lead sheet with the settings of `data/sources.json` | `midi-file.test.js`, `midi-song.test.js` (SC-006); skipped when `data/raw/` lacks the file |
| `abc/<id>.abc` | Python `abc_writer` output for each MIDI-song lead sheet | `abc-writer.test.js` |
