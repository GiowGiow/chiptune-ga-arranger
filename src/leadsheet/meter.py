"""Meters: how long a bar is, where its beats fall and which beats are strong.

A meter (time signature) such as 3/4 says that a bar holds three quarter notes. The listener
does not hear the bar as an even row of notes but as a few *beats*, the pulse a foot taps, and
some beats are *strong*: beat 1 always, and in 4/4 also beat 3. Every texture of the arranger
leans on that pulse: the bass plays the root on a strong beat, the drums kick on strong beats and
hit the snare on weak ones.

The meters fall into three families:

- **Simple** meters (2/2, 2/4, 3/4, 4/4) count beats of the denominator note: 3/4 has three
  quarter-note beats.
- **Compound** meters (6/8, 9/8, 12/8) group their eighth notes in threes, so a beat is a dotted
  quarter: 6/8 has two beats of 1.5 quarters each, and a jig is felt "in two".
- **Irregular** meters group unequal beats: 5/4 is felt 3 + 2 (strong beats 1 and 4), and 7/8 is
  felt as eighths grouped 2 + 2 + 3, so its three beats last 1, 1 and 1.5 quarters.

A meter's strong beats are the first beat of each group: a quadruple meter (4/4, 12/8) groups
its four beats 2 + 2, a duple or triple meter is one group. All lengths are in quarter-note
beats, the unit of the whole method, so a 6/8 bar lasts 3.0 and a 7/8 bar 3.5.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import accumulate
from typing import Protocol

# (beat lengths in quarter notes, indices of the strong beats) of every supported meter.
_STRUCTURE: dict[tuple[int, int], tuple[tuple[float, ...], tuple[int, ...]]] = {
    (2, 2): ((2.0, 2.0), (0,)),
    (2, 4): ((1.0, 1.0), (0,)),
    (3, 4): ((1.0, 1.0, 1.0), (0,)),
    (4, 4): ((1.0, 1.0, 1.0, 1.0), (0, 2)),
    (6, 8): ((1.5, 1.5), (0,)),
    (9, 8): ((1.5, 1.5, 1.5), (0,)),
    (12, 8): ((1.5, 1.5, 1.5, 1.5), (0, 2)),
    (5, 4): ((1.0, 1.0, 1.0, 1.0, 1.0), (0, 3)),
    (7, 8): ((1.0, 1.0, 1.5), (0,)),
}

# Names that ABC writes for two meters: "C" (common time) and "C|" (cut time).
_SYMBOLS = {"C": (4, 4), "C|": (2, 2)}


def _unsupported(text: str, bar_number: int | None) -> ValueError:
    supported = ", ".join(f"{n}/{d}" for n, d in _STRUCTURE)
    where = f"bar {bar_number}: " if bar_number is not None else ""
    return ValueError(f"{where}the meter {text} is not supported; supported meters: {supported}")


@dataclass(frozen=True)
class Meter:
    """A supported time signature, with its beats and strong beats.

    Attributes:
        numerator: beats (or eighths, in compound and 7/8 meters) per bar, as written.
        denominator: the note value of the numerator: 2, 4 or 8.

    >>> waltz = Meter(3, 4)
    >>> waltz.bar_beats, waltz.beats, waltz.strong, waltz.steps
    (3.0, (1.0, 1.0, 1.0), (0,), 12)
    >>> Meter(6, 8).beats  # two dotted-quarter beats
    (1.5, 1.5)
    """

    numerator: int
    denominator: int

    def __post_init__(self) -> None:
        if (self.numerator, self.denominator) not in _STRUCTURE:
            raise _unsupported(f"{self.numerator}/{self.denominator}", None)

    @property
    def bar_beats(self) -> float:
        """The bar length in quarter notes: numerator × 4 / denominator."""
        return self.numerator * 4 / self.denominator

    @property
    def beats(self) -> tuple[float, ...]:
        """The length of each beat in quarter notes; they add up to `bar_beats`."""
        return _STRUCTURE[(self.numerator, self.denominator)][0]

    @property
    def strong(self) -> tuple[int, ...]:
        """Indices into `beats` of the strong beats; beat 0 is always strong."""
        return _STRUCTURE[(self.numerator, self.denominator)][1]

    @property
    def steps(self) -> int:
        """Sixteenth-note steps in one bar, the grid of the drums and of the score tables."""
        return round(4 * self.bar_beats)

    def __str__(self) -> str:
        return f"{self.numerator}/{self.denominator}"


FOUR_FOUR = Meter(4, 4)

SUPPORTED_METERS = tuple(Meter(n, d) for n, d in _STRUCTURE)


def parse_meter(text: str, bar_number: int | None = None) -> Meter:
    """Read a meter as ABC or a time signature writes it: "3/4", "6/8", "C" or "C|".

    Args:
        text: the meter text.
        bar_number: the bar (counted from 1) where the meter appears, named in the error.

    Raises:
        ValueError: for a meter outside the nine supported ones.

    >>> parse_meter("C|")
    Meter(numerator=2, denominator=2)
    >>> parse_meter("11/16", bar_number=3)  # doctest: +ELLIPSIS
    Traceback (most recent call last):
    ...
    ValueError: bar 3: the meter 11/16 is not supported; supported meters: 2/2, 2/4, ..., 7/8
    """
    cleaned = text.strip()
    if cleaned in _SYMBOLS:
        return Meter(*_SYMBOLS[cleaned])
    numerator, slash, denominator = cleaned.partition("/")
    if slash and numerator.isdigit() and denominator.isdigit():
        key = (int(numerator), int(denominator))
        if key in _STRUCTURE:
            return Meter(*key)
    raise _unsupported(cleaned, bar_number)


def beat_onsets(meter: Meter) -> tuple[float, ...]:
    """The onset of each beat, in quarter notes from the bar start.

    >>> beat_onsets(Meter(7, 8))
    (0.0, 1.0, 2.0)
    """
    return (0.0, *accumulate(meter.beats[:-1]))


def strong_onsets(meter: Meter) -> tuple[float, ...]:
    """The onsets of the strong beats.

    >>> strong_onsets(FOUR_FOUR), strong_onsets(Meter(5, 4))
    ((0.0, 2.0), (0.0, 3.0))
    """
    onsets = beat_onsets(meter)
    return tuple(onsets[index] for index in meter.strong)


def groups(meter: Meter) -> tuple[tuple[float, float], ...]:
    """The (onset, length) spans from each strong beat to the next one or to the bar end.

    These are the stretches over which the MIDI reader decides one chord: half bars in 4/4,
    3 + 2 beats in 5/4, the whole bar in 3/4.

    >>> groups(FOUR_FOUR)
    ((0.0, 2.0), (2.0, 2.0))
    >>> groups(Meter(3, 4))
    ((0.0, 3.0),)
    """
    starts = strong_onsets(meter)
    ends = (*starts[1:], meter.bar_beats)
    return tuple((start, end - start) for start, end in zip(starts, ends, strict=True))


class _HasMeter(Protocol):
    @property
    def meter(self) -> Meter: ...


def bar_starts(bars: Sequence[_HasMeter]) -> list[float]:
    """The onset of each bar, in quarter notes from the start of the piece.

    >>> class B:  # anything with a meter, such as a lead-sheet Bar
    ...     def __init__(self, text): self.meter = parse_meter(text)
    >>> bar_starts([B("4/4"), B("2/4"), B("3/4")])
    [0.0, 4.0, 6.0]
    """
    return [0.0, *accumulate(bar.meter.bar_beats for bar in bars[:-1])] if bars else []


def total_beats(bars: Sequence[_HasMeter]) -> float:
    """The length of the piece in quarter notes: the sum of its bar lengths.

    >>> class B:
    ...     def __init__(self, text): self.meter = parse_meter(text)
    >>> total_beats([B("6/8"), B("6/8")])
    6.0
    """
    return float(sum(bar.meter.bar_beats for bar in bars))
