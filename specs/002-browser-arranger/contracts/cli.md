# Contract: CLI Changes

## New: `uv run src/main.py catalog`

Builds `arranger/data/catalog.json` from the MPB MIDI catalog.

```text
usage: main.py catalog [-h] [--out OUT] [--cache CACHE] [--delay SECONDS] [--letters LETTERS]

options:
  --out OUT          output file (default: arranger/data/catalog.json)
  --cache CACHE      folder for downloaded pages, to resume (default: data/raw/catalog/)
  --delay SECONDS    pause between requests (default: 1.0; values below 1.0 are refused)
  --letters LETTERS  only these index pages, e.g. "0-9,a,m" (default: all 27)
```

Behavior:
- It reads the 27 index pages, then every song page.
- It waits `--delay` seconds between requests and sends the project's User-Agent (the one in
  `src/leadsheet/sources.py`). A page already in the cache is not fetched again, so an
  interrupted crawl resumes where it stopped.
- It prints progress every 100 pages. At the end it prints the number of entries, the number of
  entries dropped (no MIDI link) and the number of pages that failed. A failed page is skipped
  and reported.
- The cache lives in `data/raw/`, which is gitignored. The cached pages are never committed.

## New: `uv run src/main.py fixtures`

Writes the parity fixtures of [files.md](files.md) into `arranger/tests/fixtures/` (default
`--out`).

```text
usage: main.py fixtures [-h] [--out OUT] [--samples SAMPLES] [--sources SOURCES]
```

Behavior:
- It needs no network.
- MIDI-song fixtures are written only for songs whose file is in `data/raw/`, with a notice for
  each missing one. Run `uv run src/main.py fetch` first to get them all.
- It reruns the GA of each sample from its `config.json` and seed to recover the plan, and checks
  that the rerun gives the sample's recorded `best_fitness`.

## Changed: `load_config`

`load_config(path)` accepts a run record (the CLI's own `config.json`, or the app's download):
- It ignores the run keys at the top level: `seed`, `input_path`, `input_sha256`, `git_commit`,
  `git_dirty`, `created`, `run_id`, `best_fitness`, `stop_reason`, `generations`, `audio`, `app`.
- It merges every other key as before; an unknown key is still an error.
- The seed stays an explicit `--seed` argument (constitution, principle I).

```bash
uv run src/main.py arrange song.mid --config song-s1-3fa2c901.config.json --seed 1
```
