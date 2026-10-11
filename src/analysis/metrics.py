"""Simple objective metrics of a generated piece, channel by channel.

These numbers make the effect of a seed or a hyperparameter visible without listening:

- note density: notes per beat;
- sounding fraction: share of the time in which the channel plays a note (for comparison, NES
  game music keeps P1 sounding 86% of the time, P2 84%, TR 70% and NO 39%; Donahue et al., 2018);
- pitch-class histogram: how often each of the 12 pitch classes (C, C#, ..., B) is used;
- pitch entropy: Shannon entropy of that histogram in bits (0 = one pitch class, log2(12) = 3.58
  = all equally used);
- interval distribution: how many times each melodic step, in semitones, occurs between
  consecutive notes.
"""

import math
from collections import Counter
from collections.abc import Sequence

from arrangement.model import CHANNELS, Arrangement, ChannelNote


def channel_metrics(
    notes: Sequence[ChannelNote], total_beats: float, pitched: bool = True
) -> dict[str, object]:
    """Return the metrics of one channel over a piece of `total_beats` beats.

    >>> notes = [ChannelNote(60, 0.0, 1.0, 90), ChannelNote(67, 1.0, 1.0, 90)]
    >>> m = channel_metrics(notes, total_beats=4.0)
    >>> m["density"], m["sounding_fraction"], m["pitch_entropy"]
    (0.5, 0.5, 1.0)
    """
    ordered = sorted(notes, key=lambda n: n.onset)
    histogram = [0.0] * 12
    entropy = 0.0
    intervals: dict[str, int] = {}
    if pitched and ordered:
        counts = Counter(note.pitch % 12 for note in ordered)
        histogram = [counts[pc] / len(ordered) for pc in range(12)]
        entropy = -sum(p * math.log2(p) for p in histogram if p > 0)
        steps = Counter(b.pitch - a.pitch for a, b in zip(ordered, ordered[1:], strict=False))
        intervals = {str(step): count for step, count in sorted(steps.items())}
    return {
        "note_count": len(ordered),
        "density": len(ordered) / total_beats,
        "sounding_fraction": _sounding_time(ordered) / total_beats,
        "pitch_class_histogram": histogram,
        "pitch_entropy": entropy,
        "interval_histogram": intervals,
    }


def arrangement_metrics(arrangement: Arrangement, total_beats: float) -> dict[str, dict]:
    """Return `channel_metrics` for the four channels (NO counts as unpitched)."""
    return {
        channel: channel_metrics(
            arrangement.channels.get(channel, ()), total_beats, pitched=(channel != "NO")
        )
        for channel in CHANNELS
    }


def _sounding_time(ordered: Sequence[ChannelNote]) -> float:
    # Merge overlapping notes so that a time span is counted once.
    total, covered_until = 0.0, float("-inf")
    for note in ordered:
        start = max(note.onset, covered_until)
        end = note.onset + note.duration
        if end > start:
            total += end - start
            covered_until = end
    return total
