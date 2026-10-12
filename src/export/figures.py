"""Figures that let a reader see what the arranger did.

The piano roll draws each pitched NES channel as one step line (pitch over time), which works
because every channel plays one note at a time; rests break the line. The noise channel has no
pitch, so its drum hits appear as markers in a separate band. The evolution figure shows how the
best and mean fitness, and the diversity of the population, change over the generations. All
figures use the colorblind-safe `tableau-colorblind10` palette.
"""

import math
from collections.abc import Sequence
from itertools import accumulate
from pathlib import Path

import matplotlib.style
from matplotlib.figure import Figure

from arrangement.model import HIHAT, KICK, SNARE, Arrangement, ChannelNote

PITCHED_CHANNELS = ("P1", "P2", "TR")
CHANNEL_LABELS = {"P1": "P1 melody (pulse)", "P2": "P2 harmony (pulse)", "TR": "TR bass (triangle)"}
DRUM_ROWS = {KICK: (0, "kick"), SNARE: (1, "snare"), HIHAT: (2, "hi-hat")}


def step_line(notes: Sequence[ChannelNote]) -> tuple[list[float], list[float]]:
    """Return x, y points for a `steps-post` line of a monophonic channel, with NaN at rests.

    >>> notes = [ChannelNote(60, 0.0, 1.0, 90), ChannelNote(62, 2.0, 1.0, 90)]
    >>> step_line(notes)
    ([0.0, 1.0, 2.0, 3.0], [60, nan, 62, 62])
    """
    xs: list[float] = []
    ys: list[float] = []
    previous_end = None
    for note in sorted(notes, key=lambda n: n.onset):
        if previous_end is not None and note.onset > previous_end + 1e-9:
            xs.append(previous_end)
            ys.append(float("nan"))
        xs.append(note.onset)
        ys.append(note.pitch)
        previous_end = note.onset + note.duration
    if previous_end is not None:
        xs.append(previous_end)
        ys.append(ys[-1])
    return xs, ys


def bar_lines(arrangement: Arrangement, total_beats: float) -> list[float]:
    """The beats where bars start (and the last one ends), from the meters of the arrangement.

    An arrangement without meters is 4/4 throughout.

    >>> bar_lines(Arrangement("t", 120.0, (), {}), total_beats=8.0)
    [0.0, 4.0, 8.0]
    """
    lengths = [meter.bar_beats for meter in arrangement.meters]
    if not lengths:
        lengths = [4.0] * max(1, math.ceil(total_beats / 4.0 - 1e-9))
    return [0.0, *accumulate(lengths)]


def plot_pianoroll(arrangement: Arrangement, path: Path | str) -> None:
    """Save a piano roll of the arrangement (PNG or PDF, chosen by the file suffix)."""
    total_beats = max(
        (n.onset + n.duration for notes in arrangement.channels.values() for n in notes),
        default=4.0,
    )
    with matplotlib.style.context("tableau-colorblind10"):
        figure = Figure(figsize=(12, 5), layout="constrained")
        pitch_axes, drum_axes = figure.subplots(
            2, 1, sharex=True, gridspec_kw={"height_ratios": [4, 1]}
        )
        for channel in PITCHED_CHANNELS:
            xs, ys = step_line(arrangement.channels.get(channel, ()))
            pitch_axes.plot(xs, ys, drawstyle="steps-post", label=CHANNEL_LABELS[channel], lw=1.4)
        for hit in arrangement.channels.get("NO", ()):
            row, _ = DRUM_ROWS.get(hit.pitch, (2, "other"))
            drum_axes.plot(hit.onset, row, marker="|", markersize=9, color="0.25")
        for axes in (pitch_axes, drum_axes):
            for bar_start in bar_lines(arrangement, total_beats):
                axes.axvline(bar_start, color="0.85", lw=0.6, zorder=0)
        pitch_axes.set_ylabel("MIDI pitch")
        pitch_axes.legend(loc="upper right", fontsize=8)
        pitch_axes.set_title(
            f"{arrangement.title}: one line per NES channel (one note at a time); "
            "NO drum hits below; grey lines mark bars"
        )
        drum_axes.set_yticks([row for row, _ in DRUM_ROWS.values()])
        drum_axes.set_yticklabels([label for _, label in DRUM_ROWS.values()])
        drum_axes.set_ylim(-0.7, 2.7)
        drum_axes.set_xlabel("beats")
        drum_axes.set_xlim(0, total_beats)
        figure.savefig(path)


def plot_evolution(log: Sequence, path: Path | str) -> None:
    """Save the fitness curves (best, mean) and the population diversity per generation.

    `log` holds one record per generation with the attributes generation, best, mean and
    diversity (the share of distinct genotypes in the population).
    """
    generations = [entry.generation for entry in log]
    # The figure is drawn at the width of one column of the two-column abstract (3.4 inches), so
    # that its 8-point text stays 8 points when LaTeX places it; the PNG gets a higher dpi instead.
    style = {"font.size": 8, "axes.titlesize": 8, "legend.fontsize": 7}
    with matplotlib.style.context("tableau-colorblind10"), matplotlib.rc_context(style):
        figure = Figure(figsize=(3.4, 2.2), layout="constrained")
        fitness_axes, diversity_axes = figure.subplots(
            2, 1, sharex=True, gridspec_kw={"height_ratios": [3, 1]}
        )
        fitness_axes.plot(generations, [entry.best for entry in log], label="best fitness")
        fitness_axes.plot(generations, [entry.mean for entry in log], label="mean fitness")
        fitness_axes.set_ylabel("fitness (0-1)")
        fitness_axes.legend(loc="lower right")
        fitness_axes.set_title("Fitness per generation (best never drops: elitism)")
        diversity_axes.plot(generations, [entry.diversity for entry in log], color="0.35")
        diversity_axes.set_ylabel("distinct\ngenotypes")
        diversity_axes.set_ylim(0, 1.05)
        diversity_axes.set_xlabel("generation")
        figure.savefig(path, dpi=200)


def plot_seed_curves(seed_logs: Sequence, random_best: float, path: Path | str) -> None:
    """Save the best-fitness curves of several seeds and the best random-search fitness."""
    with matplotlib.style.context("tableau-colorblind10"):
        figure = Figure(figsize=(7, 3.5), layout="constrained")
        axes = figure.subplots()
        for seed, log in seed_logs:
            axes.plot([e.generation for e in log], [e.best for e in log], label=f"GA seed {seed}")
        axes.axhline(random_best, color="0.3", ls="--", label="random search (same evaluations)")
        axes.set_xlabel("generation")
        axes.set_ylabel("best fitness")
        axes.set_title("Best fitness per seed; dashed line: random search with as many evaluations")
        axes.legend(fontsize=7, loc="lower right")
        figure.savefig(path)
