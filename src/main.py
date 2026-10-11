"""Command-line entry point of the NES chiptune arranger (DCC831 TP1).

The arranger reads a lead sheet (melody, chords and part labels in ABC notation) and arranges it
for the four channels of the NES sound chip. A genetic algorithm searches for the best arrangement
plan: which texture each channel plays in each bar. Examples:

    uv run src/main.py arrange data/leadsheets/korobeiniki.abc --seed 1
    uv run src/main.py arrange data/leadsheets/ievan_polkka.abc --seed 2 --set weights.contrast=3
    uv run src/main.py sample outputs/<run-id> korobeiniki-s1

Every hyperparameter comes from `configs/default.json`, an optional `--config` file and `--set`
overrides; every run needs an explicit `--seed` (constitution, principle I).
"""

import argparse
import shutil
import sys
from pathlib import Path

import numpy as np

from arrangement.assemble import assemble
from arrangement.validation import find_violations
from config import load_config
from export.audio import DEFAULT_SOUNDFONT, render_mp3
from export.chip_audio import render_chip_mp3
from export.experiments import run_experiments
from export.figures import plot_evolution, plot_pianoroll
from export.input_preview import excerpt_seconds, lead_sheet_to_midi
from export.midi import write_midi
from export.run_folder import (
    make_run_id,
    write_config_json,
    write_evolution_csv,
    write_metrics_json,
)
from export.video import render_video
from ga.evolution import GAParams, evolve
from ga.fitness import criterion_scores
from ga.tables import build_tables
from leadsheet.abc_reader import read_lead_sheet
from leadsheet.midi_reader import read_lead_sheet_midi
from leadsheet.model import LeadSheet

MIDI_SUFFIXES = (".mid", ".midi")

NOTES_TEMPLATE = """# Listening notes: {name}

Run `{run_id}`. The command that rebuilds it is in the README; its configuration is in
`config.json`.

- What to listen for:
- What works:
- What does not work:
"""


def build_parser() -> argparse.ArgumentParser:
    """Return the parser of the `arrange` and `sample` commands."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)

    arrange = commands.add_parser("arrange", help="arrange a lead sheet for the NES channels")
    arrange.add_argument("leadsheet", type=Path, help="ABC lead sheet or MIDI song")
    arrange.add_argument("--seed", type=int, required=True, help="seed of the random generator")
    arrange.add_argument("--config", type=Path, help="JSON file with hyperparameters")
    arrange.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="override one hyperparameter, e.g. weights.contrast=3 (repeatable)",
    )
    arrange.add_argument("--out", type=Path, default=Path("outputs"), help="parent folder")
    arrange.add_argument("--no-audio", action="store_true", help="skip FluidSynth and ffmpeg")
    arrange.add_argument("--soundfont", type=Path, default=DEFAULT_SOUNDFONT)
    arrange.add_argument(
        "--renderer",
        choices=("gm", "chip", "both"),
        default="both",
        help="General MIDI soundfont (piece.mp3), NES chip synthesizer (piece-chip.mp3) or both",
    )
    arrange.set_defaults(handler=run_arrange)

    sample = commands.add_parser("sample", help="copy a run to the curated samples")
    sample.add_argument("run_dir", type=Path, help="run folder under outputs/")
    sample.add_argument("name", help="sample name, e.g. korobeiniki-s1")
    sample.add_argument("--samples", type=Path, default=Path("samples"))
    sample.add_argument("--figures", type=Path, default=Path("paper/figures"))
    sample.set_defaults(handler=run_sample)

    video = commands.add_parser("video", help="render a Bach Vision Test style video of a run")
    video.add_argument("run_dir", type=Path, help="run or sample folder with piece.mid")
    video.add_argument("--fps", type=int, default=30)
    video.set_defaults(handler=run_video)

    experiment = commands.add_parser("experiment", help="seeds, random search and ablation")
    experiment.add_argument("leadsheet", type=Path, help="ABC lead sheet or MIDI song")
    experiment.add_argument("--seed", type=int, required=True, help="first of five seeds")
    experiment.add_argument("--config", type=Path, help="JSON file with hyperparameters")
    experiment.add_argument("--set", action="append", default=[], metavar="KEY=VALUE")
    experiment.add_argument("--out", type=Path, default=Path("outputs"), help="parent folder")
    experiment.set_defaults(handler=run_experiment)
    return parser


def load_lead_sheet(path: Path, config: dict) -> LeadSheet:
    """Read an ABC lead sheet, or reduce a multi-track MIDI song to a lead sheet."""
    common = {"phrase_length": config["phrase_length"], "role_map": config["role_map"]}
    if path.suffix.lower() in MIDI_SUFFIXES:
        midi = config["midi"]
        if midi["melody_track"] is None:
            raise ValueError("a MIDI input needs --set midi.melody_track=<track index>")
        return read_lead_sheet_midi(
            path,
            melody_track=midi["melody_track"],
            bars=tuple(midi["bars"]) if midi["bars"] else None,
            sections=[(int(bar), str(label)) for bar, label in midi["sections"] or []],
            tempo_override=config["tempo_bpm"],
            grid=midi["grid"],
            **common,
        )
    return read_lead_sheet(path, tempo_override=config["tempo_bpm"], **common)


def write_input_audio(
    args: argparse.Namespace, config: dict, lead_sheet: LeadSheet, folder: Path
) -> None:
    """Write the input made audible: `input.mp3` (and `input.mid` for an ABC lead sheet)."""
    if args.leadsheet.suffix.lower() in MIDI_SUFFIXES:
        bars = config["midi"]["bars"]
        start, end = excerpt_seconds(
            args.leadsheet, lead_sheet.source_grid, tuple(bars) if bars else None
        )
        if not args.no_audio:
            render_mp3(args.leadsheet, folder / "input.mp3", args.soundfont, start, end)
        return
    lead_sheet_to_midi(lead_sheet).write(str(folder / "input.mid"))
    if not args.no_audio:
        render_mp3(folder / "input.mid", folder / "input.mp3", args.soundfont)


def run_arrange(args: argparse.Namespace) -> Path:
    """Evolve an arrangement plan, validate it and write the run folder; return the folder."""
    config = load_config(args.config, args.set)
    lead_sheet = load_lead_sheet(args.leadsheet, config)
    rng = np.random.default_rng(args.seed)
    tables = build_tables(lead_sheet)
    params = GAParams(
        population_size=config["population_size"],
        max_generations=config["max_generations"],
        stagnation_window=config["stagnation_window"],
        mutation_rate=config["mutation_rate"],
        elite_count=config["elite_count"],
    )
    result = evolve(rng, tables, len(lead_sheet.bars), params, config["weights"])
    arrangement = assemble(lead_sheet, result.best_genome)
    violations = find_violations(arrangement, lead_sheet)
    if violations:
        raise ValueError("the arrangement breaks NES rules:\n" + "\n".join(violations))

    folder = args.out / make_run_id(args.leadsheet, args.seed, config)
    folder.mkdir(parents=True, exist_ok=True)
    write_midi(arrangement, folder / "piece.mid")
    write_input_audio(args, config, lead_sheet, folder)
    audio = False
    if not args.no_audio:
        if args.renderer in ("gm", "both"):
            audio = render_mp3(folder / "piece.mid", folder / "piece.mp3", args.soundfont)
        if args.renderer in ("chip", "both"):
            audio = render_chip_mp3(folder / "piece.mid", folder / "piece-chip.mp3") or audio
    for suffix in ("png", "pdf"):
        plot_pianoroll(arrangement, folder / f"pianoroll.{suffix}")
        plot_evolution(result.log, folder / f"evolution.{suffix}")
    write_evolution_csv(folder, result.log)
    write_metrics_json(
        folder,
        arrangement,
        total_beats=4.0 * len(lead_sheet.bars),
        criteria_initial_best=_scores_of(tables, result.initial_best_genome),
        criteria_final=_scores_of(tables, result.best_genome),
    )
    generations = len(result.log) - 1
    write_config_json(
        folder,
        config,
        args.seed,
        args.leadsheet,
        extra={
            "best_fitness": float(result.best_fitness),
            "stop_reason": result.stop_reason,
            "generations": generations,
            "audio": audio,
        },
    )
    print(folder)
    print(
        f"best fitness {result.best_fitness:.4f} ({result.stop_reason}, {generations} generations)"
    )
    return folder


def run_experiment(args: argparse.Namespace) -> Path:
    """Run the experiments of the Results section (FR-029) on one lead sheet."""
    config = load_config(args.config, args.set)
    lead_sheet = load_lead_sheet(args.leadsheet, config)
    return run_experiments(lead_sheet, config, args.seed, args.out, args.leadsheet.stem)


def run_video(args: argparse.Namespace) -> Path:
    """Render `piece.mp4` with the chip audio when it exists, else the General MIDI audio."""
    audio = args.run_dir / "piece-chip.mp3"
    if not audio.exists():
        audio = args.run_dir / "piece.mp3"
    target = args.run_dir / "piece.mp4"
    if not render_video(args.run_dir / "piece.mid", audio, target, fps=args.fps):
        raise ValueError(f"no video written for {args.run_dir}")
    print(target)
    return target


def run_sample(args: argparse.Namespace) -> Path:
    """Copy a run folder to `samples/<name>/` and its vector figures to the paper."""
    target = args.samples / args.name
    target.mkdir(parents=True, exist_ok=True)
    for path in args.run_dir.iterdir():
        if path.is_file():
            shutil.copy2(path, target / path.name)
    notes = target / "notes.md"
    if not notes.exists():
        notes.write_text(NOTES_TEMPLATE.format(name=args.name, run_id=args.run_dir.name))
    args.figures.mkdir(parents=True, exist_ok=True)
    for figure in ("evolution", "pianoroll"):
        shutil.copy2(args.run_dir / f"{figure}.pdf", args.figures / f"{args.name}-{figure}.pdf")
    print(target)
    return target


def _scores_of(tables, genome: np.ndarray) -> dict[str, float]:
    scores = criterion_scores(tables, genome[np.newaxis])
    return {name: float(values[0]) for name, values in scores.items()}


def main(argv: list[str] | None = None) -> int:
    """Run one command; return the exit code (0 on success, 1 on a reported error)."""
    args = build_parser().parse_args(argv)
    try:
        args.handler(args)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
