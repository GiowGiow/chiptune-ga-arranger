"""Chord symbols as pitch classes, and pitch classes placed in a register.

A chord symbol such as "Am" or "Bbm7" names a root and a chord quality. The arranger needs the
chord tones: the root, the third, the fifth and, for seventh chords, the seventh. It handles them
as pitch classes, numbers from 0 (C) to 11 (B) that ignore the octave, because the same chord can
be played in any register. To play a tone, a channel picks one octave: `place_in_register` turns a
pitch class into the one MIDI pitch of that class inside a 12-semitone window.
"""

from music21 import common, harmony
from music21.exceptions21 import Music21Exception


def chord_tones(symbol: str) -> tuple[int, tuple[int, ...]]:
    """Return the root pitch class and the chord tones of a chord symbol.

    The tones are ordered root, third, fifth and then the seventh when the chord has one. A
    lowercase "b" right after a note letter means flat, as in lead sheets ("Eb", "Bbm7").

    Args:
        symbol: chord symbol, for example "C", "Am", "Ebm", "Bbm7" or "F#7".

    Returns:
        (root, tones): the root pitch class and the tuple of chord-tone pitch classes.

    Raises:
        ValueError: when music21 does not recognize the chord symbol.

    >>> chord_tones("Am")
    (9, (9, 0, 4))
    >>> chord_tones("Bbm7")
    (10, (10, 1, 5, 8))
    """
    # music21 writes flats as "-" (E-m); this is the same conversion its ABC reader applies.
    figure = common.cleanedFlatNotation(symbol)
    try:
        chord_symbol = harmony.ChordSymbol(figure)
        root = chord_symbol.root()
    except (ValueError, Music21Exception) as error:
        raise ValueError(f"unknown chord symbol {symbol!r}") from error

    ordered = (root, chord_symbol.third, chord_symbol.fifth, chord_symbol.seventh)
    tones = tuple(pitch.pitchClass for pitch in ordered if pitch is not None)
    return root.pitchClass, tones


def place_in_register(pitch_class: int, low: int) -> int:
    """Return the only MIDI pitch with this pitch class in the range [low, low + 11].

    Args:
        pitch_class: pitch class from 0 (C) to 11 (B).
        low: lowest MIDI pitch of the register.

    Returns:
        A MIDI pitch `p` with `p % 12 == pitch_class` and `low <= p <= low + 11`.

    >>> place_in_register(0, low=48)  # C3, the bottom of the register
    48
    >>> place_in_register(1, low=50)  # the register starts on D3, so C# lands on C#4
    61
    """
    return low + (pitch_class - low) % 12
