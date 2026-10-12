import pytest
from test_midi_reader import write_count_in_song, write_song

from export.input_preview import excerpt_seconds, lead_sheet_to_midi
from leadsheet.abc_reader import read_lead_sheet


def test_lead_sheet_preview_plays_melody_chords_and_root_bass():
    lead_sheet = read_lead_sheet("data/leadsheets/korobeiniki.abc")
    midi = lead_sheet_to_midi(lead_sheet)
    names = [i.name for i in midi.instruments]
    assert names == ["melody", "chords", "bass"]
    melody = midi.instruments[0].notes
    assert melody[0].pitch == 76 and melody[0].start == 0.0
    # The first chord, E major, sounds as a block of three notes.
    assert sorted(n.pitch % 12 for n in midi.instruments[1].notes if n.start == 0.0) == [4, 8, 11]


def test_excerpt_times_follow_the_grid_of_the_recording(tmp_path):
    path = write_song(tmp_path / "song.mid")  # 120 BPM, on the file grid
    assert excerpt_seconds(path, (120.0, 0.0), (1, 3)) == (2.0, 6.0)
    # A recording read on an estimated grid: 100 BPM, first downbeat at 0.5 s.
    assert excerpt_seconds(path, (100.0, 0.5), (1, 2)) == (2.9, 5.3)


def test_excerpt_times_count_bars_from_the_first_bar_of_the_time_signature_map(tmp_path):
    path = write_count_in_song(tmp_path / "song.mid")  # 120 BPM: two 3/4 bars, 4/4 from 3 s on
    assert excerpt_seconds(path, (120.0, 0.0), (0, 2)) == pytest.approx((0.0, 3.0))
    assert excerpt_seconds(path, (120.0, 0.0), (3, 4)) == pytest.approx((5.0, 7.0))
    # The default excerpt starts on the first bar with a pitched note: the pickup's 3/4 bar.
    assert excerpt_seconds(path, (120.0, 0.0), None)[0] == pytest.approx(1.5)
    drums_only = write_count_in_song(tmp_path / "drums.mid", pickup=False)
    assert excerpt_seconds(drums_only, (120.0, 0.0), None)[0] == pytest.approx(3.0)
    # An estimated grid has its own downbeat: the count-in does not move it.
    assert excerpt_seconds(path, (100.0, 0.5), (1, 2)) == (2.9, 5.3)
