"""Chord symbols become pitch classes, and pitch classes become playable MIDI pitches."""

import pytest

from leadsheet.chords import chord_tones, place_in_register


@pytest.mark.parametrize(
    ("symbol", "expected"),
    [
        ("C", (0, (0, 4, 7))),
        ("E", (4, (4, 8, 11))),
        ("Am", (9, (9, 0, 4))),
        ("Dm", (2, (2, 5, 9))),
        ("Ebm", (3, (3, 6, 10))),
        ("Bbm7", (10, (10, 1, 5, 8))),
        ("F#7", (6, (6, 10, 1, 4))),
    ],
)
def test_chord_tones_lists_root_third_fifth_and_seventh_as_pitch_classes(symbol, expected):
    assert chord_tones(symbol) == expected


def test_a_lowercase_b_after_the_root_letter_means_flat():
    root, _ = chord_tones("Bb")

    assert root == 10


@pytest.mark.parametrize("symbol", ["Xyz", "", "NC"])
def test_an_unknown_chord_symbol_is_rejected(symbol):
    with pytest.raises(ValueError, match="chord symbol"):
        chord_tones(symbol)


@pytest.mark.parametrize(
    ("pitch_class", "low", "expected"),
    [
        (0, 48, 48),  # C at the bottom of the register
        (11, 48, 59),  # B at the top of the register
        (7, 50, 55),  # G above a register that starts on D
        (1, 50, 61),  # C# wraps into the next octave
    ],
)
def test_place_in_register_returns_the_pitch_with_that_class_in_the_octave_above_low(
    pitch_class, low, expected
):
    assert place_in_register(pitch_class, low) == expected


@pytest.mark.parametrize("pitch_class", range(12))
def test_place_in_register_always_lands_inside_the_twelve_semitones_from_low(pitch_class):
    pitch = place_in_register(pitch_class, low=28)

    assert 28 <= pitch <= 39
    assert pitch % 12 == pitch_class
