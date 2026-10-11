# Quickstart: validate the GA Chiptune Arranger

## Prerequisites

```bash
uv sync
```

```bash
sudo apt install fluidsynth fluid-soundfont-gm ffmpeg
```

## 1. Tests (method core and end-to-end path)

```bash
uv run pytest
```

Expected: every test passes, including the doctests in `src/`.

## 2. One arrangement per song (User Story 1)

```bash
uv run src/main.py arrange data/leadsheets/ievan_polkka.abc --seed 1
```

```bash
uv run src/main.py arrange data/leadsheets/korobeiniki.abc --seed 1
```

Expected: each command prints a run folder under `outputs/` that holds the files listed in
[contracts/cli.md](contracts/cli.md). Running the same command twice gives a `piece.mid` with
identical notes (SC-003).

## 3. Evolution (User Story 2)

Open `evolution.png` in a run folder. The best curve never goes down (SC-006). `metrics.json`
lists the seven criteria.

## 4. Variations (User Story 3)

```bash
for s in 1 2 3 4 5; do uv run src/main.py arrange data/leadsheets/korobeiniki.abc --seed $s --no-audio; done
```

Expected: at least 3 different genomes among the 5 `metrics.json` files (SC-004).

```bash
uv run src/main.py arrange data/leadsheets/korobeiniki.abc --seed 1 --set weights.contrast=0 --no-audio
```

```bash
uv run src/main.py arrange data/leadsheets/korobeiniki.abc --seed 1 --set weights.contrast=3 --no-audio
```

Expected: the two genomes differ, and the chorus-minus-verse density difference is larger with
weight 3 (SC-005).

## 5. Curate a sample

```bash
uv run src/main.py sample outputs/<run-id> ievan-polkka-s1
```

Expected: `samples/ievan-polkka-s1/` holds every run file plus `notes.md`, and the vector figures
appear in `paper/figures/`. Rerunning the README command of the sample gives identical notes
(SC-007).
