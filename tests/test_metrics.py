import math

import pytest
from test_midi_export import small_arrangement

from analysis.metrics import arrangement_metrics, channel_metrics
from arrangement.model import ChannelNote


def notes(*pitches_and_onsets):
    return [ChannelNote(p, o, 1.0, 90) for p, o in pitches_and_onsets]


def test_density_and_sounding_fraction_follow_the_notes():
    m = channel_metrics(notes((60, 0.0), (62, 1.0)), total_beats=8.0)
    assert m["note_count"] == 2
    assert m["density"] == 0.25
    assert m["sounding_fraction"] == 0.25


def test_pitch_class_histogram_sums_to_one_and_entropy_is_in_bits():
    m = channel_metrics(notes((60, 0.0), (72, 1.0), (67, 2.0), (55, 3.0)), total_beats=4.0)
    histogram = m["pitch_class_histogram"]
    assert len(histogram) == 12 and math.isclose(sum(histogram), 1.0)
    assert histogram[0] == 0.5 and histogram[7] == 0.5
    assert m["pitch_entropy"] == pytest.approx(1.0)


def test_interval_histogram_counts_semitone_steps_between_consecutive_notes():
    m = channel_metrics(notes((60, 0.0), (62, 1.0), (60, 2.0)), total_beats=4.0)
    assert m["interval_histogram"] == {"2": 1, "-2": 1}


def test_an_unpitched_channel_has_no_pitch_statistics():
    m = channel_metrics(notes((36, 0.0), (38, 1.0)), total_beats=4.0, pitched=False)
    assert m["pitch_class_histogram"] == [0.0] * 12
    assert m["pitch_entropy"] == 0.0
    assert m["interval_histogram"] == {}


def test_empty_channel_gives_zeros():
    m = channel_metrics([], total_beats=4.0)
    assert m["note_count"] == 0 and m["density"] == 0.0 and m["pitch_entropy"] == 0.0


def test_arrangement_metrics_cover_the_four_channels():
    metrics = arrangement_metrics(small_arrangement(), total_beats=4.0)
    assert set(metrics) == {"P1", "P2", "TR", "NO"}
    assert metrics["NO"]["pitch_class_histogram"] == [0.0] * 12
