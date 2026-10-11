# CLI Contract: `src/main.py`

Run every command with `uv run src/main.py <command> ...`.

## `arrange`

```bash
uv run src/main.py arrange LEADSHEET.abc --seed INT [--config FILE.json] [--set KEY=VALUE ...] \
    [--out DIR] [--no-audio] [--soundfont PATH]
```

| Option | Required | Default | Meaning |
|---|---|---|---|
| `LEADSHEET.abc` | yes | — | ABC lead sheet; the first tune is used |
| `--seed` | yes | — | integer seed of the run's only random generator |
| `--config` | no | `configs/default.json` | JSON hyperparameters |
| `--set` | no | — | repeatable override with a dotted key and a JSON value, e.g. `--set weights.contrast=3` |
| `--out` | no | `outputs` | parent folder of the run folder |
| `--no-audio` | no | off | skip FluidSynth and ffmpeg (used by tests) |
| `--soundfont` | no | `/usr/share/sounds/sf2/FluidR3_GM.sf2` | GM soundfont |

On success, the command writes `DIR/<run-id>/` (run id: `<stem>-s<seed>-<config-hash8>`) with the
files below, prints the folder path, the best fitness and the stop reason, and exits with 0.

| File | Content |
|---|---|
| `piece.mid` | 4 tracks named `P1`, `P2`, `TR`, `NO` (GM programs 80, 80, 38 and the drum channel) |
| `piece.mp3` | audio from `piece.mid` (absent, with a printed notice, when audio is off or unavailable) |
| `pianoroll.png` | one step line per pitched channel and NO hits in a band |
| `evolution.csv` | the columns `generation,best,mean,diversity` |
| `evolution.png`, `evolution.pdf` | best and mean fitness per generation |
| `metrics.json` | per channel: `note_count`, `density`, `sounding_fraction`, `pitch_class_histogram`, `pitch_entropy`, `interval_histogram`; `criteria_final` and `criteria_initial_best` (the score of each criterion); `genome` (list of 4-integer lists) |
| `config.json` | see data-model.md, "Run configuration" |

Errors exit with 1 and print `error: <message>`. They cover an invalid lead sheet (meter, repeat
signs, incomplete bar, missing or unknown chord), an invalid override key or value, and an
arrangement that breaks NES rules (each violation is listed). A missing `--seed` is an argparse
usage error with exit code 2.

## `sample`

```bash
uv run src/main.py sample RUN_DIR NAME [--samples DIR] [--figures DIR]
```

This copies every file of `RUN_DIR` to `samples/NAME/`, creates `samples/NAME/notes.md` (a
listening-notes template) when it is missing, and copies `evolution.pdf` to
`paper/figures/NAME-evolution.pdf` and a vector piano roll to
`paper/figures/NAME-pianoroll.pdf`. It exits with 0.

## `experiment` (FR-029)

```bash
uv run src/main.py experiment LEADSHEET.abc --seed INT [--config FILE.json] [--set KEY=VALUE ...] [--out DIR]
```

This runs, without audio, the GA with seeds `INT` to `INT+4`, a random-search baseline with the
same number of fitness evaluations, and one run per criterion with that criterion's weight set to
0. It writes `DIR/experiment-<stem>-s<seed>/` with `results.csv`, `results.md` (the table for the
abstract) and `seeds.pdf` (the evolution curves of the five seeds), and prints the table.

## `video` (optional, User Story 4)

```bash
uv run src/main.py video SAMPLE_DIR [--fps 30]
```

This writes `SAMPLE_DIR/piece.mp4`: one glowing step line per channel on a dark background,
revealed in sync with `piece.mp3`.
