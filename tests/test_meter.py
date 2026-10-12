"""A meter tells how long a bar is, where its beats fall and which beats are strong."""

import pytest

from leadsheet.meter import (
    FOUR_FOUR,
    SUPPORTED_METERS,
    Meter,
    bar_starts,
    beat_onsets,
    groups,
    parse_meter,
    strong_onsets,
    total_beats,
)
from leadsheet.model import Bar


@pytest.mark.parametrize(
    ("text", "bar_beats", "beats", "strong", "steps"),
    [
        ("2/2", 4.0, (2.0, 2.0), (0,), 16),
        ("2/4", 2.0, (1.0, 1.0), (0,), 8),
        ("3/4", 3.0, (1.0, 1.0, 1.0), (0,), 12),
        ("4/4", 4.0, (1.0, 1.0, 1.0, 1.0), (0, 2), 16),
        ("6/8", 3.0, (1.5, 1.5), (0,), 12),
        ("9/8", 4.5, (1.5, 1.5, 1.5), (0,), 18),
        ("12/8", 6.0, (1.5, 1.5, 1.5, 1.5), (0, 2), 24),
        ("5/4", 5.0, (1.0, 1.0, 1.0, 1.0, 1.0), (0, 3), 20),
        ("7/8", 3.5, (1.0, 1.0, 1.5), (0,), 14),
    ],
)
def test_each_supported_meter_has_its_bar_length_beats_and_strong_beats(
    text, bar_beats, beats, strong, steps
):
    meter = parse_meter(text)

    assert (meter.bar_beats, meter.beats, meter.strong, meter.steps) == (
        bar_beats,
        beats,
        strong,
        steps,
    )
    assert sum(meter.beats) == meter.bar_beats
    assert str(meter) == text


def test_the_supported_meters_are_the_nine_of_the_spec():
    assert [str(meter) for meter in SUPPORTED_METERS] == [
        "2/2",
        "2/4",
        "3/4",
        "4/4",
        "6/8",
        "9/8",
        "12/8",
        "5/4",
        "7/8",
    ]


def test_common_time_is_four_four_and_cut_time_is_two_two():
    assert parse_meter("C") == FOUR_FOUR == Meter(4, 4)
    assert parse_meter("C|") == Meter(2, 2)


def test_spaces_around_the_meter_are_ignored():
    assert parse_meter(" 3/4 ") == Meter(3, 4)


@pytest.mark.parametrize("text", ["11/16", "3/8", "4", "none"])
def test_an_unsupported_meter_is_refused_naming_the_meter_and_the_bar(text):
    with pytest.raises(ValueError) as error:
        parse_meter(text, bar_number=5)

    assert str(error.value) == (
        f"bar 5: the meter {text} is not supported; supported meters: "
        "2/2, 2/4, 3/4, 4/4, 6/8, 9/8, 12/8, 5/4, 7/8"
    )


def test_without_a_bar_number_the_message_names_only_the_meter():
    with pytest.raises(ValueError, match=r"^the meter 11/16 is not supported"):
        parse_meter("11/16")


def test_constructing_an_unsupported_meter_directly_is_refused():
    with pytest.raises(ValueError, match="the meter 11/16 is not supported"):
        Meter(11, 16)


def test_beat_and_strong_onsets_are_running_sums_of_the_beats():
    assert beat_onsets(FOUR_FOUR) == (0.0, 1.0, 2.0, 3.0)
    assert strong_onsets(FOUR_FOUR) == (0.0, 2.0)
    seven = parse_meter("7/8")
    assert beat_onsets(seven) == (0.0, 1.0, 2.0)
    assert strong_onsets(seven) == (0.0,)
    assert strong_onsets(parse_meter("12/8")) == (0.0, 3.0)


def test_groups_run_from_one_strong_beat_to_the_next():
    assert groups(FOUR_FOUR) == ((0.0, 2.0), (2.0, 2.0))
    assert groups(parse_meter("5/4")) == ((0.0, 3.0), (3.0, 2.0))
    assert groups(parse_meter("3/4")) == ((0.0, 3.0),)
    assert groups(parse_meter("12/8")) == ((0.0, 3.0), (3.0, 3.0))


def test_bar_starts_add_up_the_lengths_of_the_bars_before():
    bars = [
        Bar(0, (), (), "A", "verse", 0, False, meter=FOUR_FOUR),
        Bar(1, (), (), "A", "verse", 0, False, meter=parse_meter("2/4")),
        Bar(2, (), (), "A", "verse", 0, True, meter=parse_meter("3/4")),
    ]

    assert bar_starts(bars) == [0.0, 4.0, 6.0]
    assert total_beats(bars) == 9.0


def test_a_bar_built_without_a_meter_is_four_four():
    assert Bar(0, (), (), "A", "verse", 0, False).meter == FOUR_FOUR
