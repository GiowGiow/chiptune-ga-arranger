# TP1 – Algorithmic Music Composition

DCC831 – Generative AI for Music (UFMG, 2026/2)

## Method

<!-- Generative grammar, genetic algorithm or Markov chain. Chosen stylistic constraint. -->

## Layout

- `src/`: generator source code (entry point: `src/main.py`)
- `tests/`: tests (pytest)
- `samples/`: curated generated pieces (MIDI, audio, piano roll and config)
- `outputs/`: every generation run, one folder per run (not versioned)
- `paper/`: abstract in the official ISMIR 2026 LaTeX template, from
  [ismir/paper_templates@2026v1](https://github.com/ismir/paper_templates/tree/2026v1/2026/latex)
- `.specify/`: [Spec Kit](https://github.com/github/spec-kit) files; the project rules are in
  `.specify/memory/constitution.md`

To build the abstract:

```bash
cd paper && latexmk -pdf ISMIR2026_template.tex
```

## Installation

The project uses [uv](https://docs.astral.sh/uv/) and Python 3.12.

```bash
uv sync
uv run src/main.py
```

Without uv, use `requirements.txt`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python src/main.py
```

To render the generated MIDI files to audio, install FluidSynth, a General MIDI soundfont and
ffmpeg. On Debian/Ubuntu:

```bash
sudo apt install fluidsynth fluid-soundfont-gm ffmpeg
```

## Development

```bash
uv sync
uv run pre-commit install
uv run pytest
```

pre-commit runs ruff (lint and format) and file checks on every commit. When `pyproject.toml`
or `uv.lock` changes, it updates `uv.lock` and regenerates `requirements.txt`. If a hook
changes files, the commit stops: stage the changes and commit again. Tests, including the
docstring examples in `src/`, run before every push.

To add a dependency, run `uv add <package>` (or `uv add --dev <package>`).

## Reproducing the results

<!-- Commands that generate the MIDI files and render the audio, with seeds and hyperparameters. -->

## Generated pieces

<!-- List of the audio files and the configuration of each one. -->

## AI usage

<!-- AI tools used and for what purpose (required by the assignment). -->

## License

The code and documentation in this repository are released under the
[GNU General Public License v3.0 or later](LICENSE).
The ISMIR template files in `paper/` (style, bibliography style and example files) come from
[ismir/paper_templates](https://github.com/ismir/paper_templates) and keep their original terms.
