import shutil
import subprocess
import wave

import numpy as np
import pretty_midi
import pytest

from export.video import (
    build_scene,
    channel_paths,
    frame_at,
    render_video,
    sounding_pitch,
    visible_until,
)

FFMPEG_AVAILABLE = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def tiny_midi() -> pretty_midi.PrettyMIDI:
    """A 3-second piece: P1 has a rest from 1.0 s to 1.5 s, the other channels play throughout."""
    midi = pretty_midi.PrettyMIDI(initial_tempo=120.0)
    tracks = {
        "P1": [(72, 0.0, 1.0), (74, 1.5, 3.0)],
        "P2": [(64, 0.0, 3.0)],
        "TR": [(48, 0.0, 0.5), (43, 0.5, 3.0)],
        "NO": [(36, 0.0, 0.1), (38, 1.0, 1.1), (42, 2.0, 2.1)],
    }
    for name, notes in tracks.items():
        track = pretty_midi.Instrument(program=0, is_drum=(name == "NO"), name=name)
        for pitch, start, end in notes:
            track.notes.append(pretty_midi.Note(100, pitch, start, end))
        midi.instruments.append(track)
    return midi


def write_silent_wav(path, seconds: float, rate: int = 8000) -> None:
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b"\x00\x00" * int(seconds * rate))


def test_channel_paths_trace_each_pitched_track_in_seconds_with_nan_at_rests():
    paths = channel_paths(tiny_midi())
    assert set(paths) == {"P1", "P2", "TR"}
    x, y = paths["P1"]
    np.testing.assert_allclose(x, [0.0, 1.0, 1.5, 3.0])
    assert y[0] == 72 and np.isnan(y[1]) and y[2] == 74 and y[3] == 74
    x, y = paths["TR"]
    np.testing.assert_allclose(x, [0.0, 0.5, 3.0])
    np.testing.assert_allclose(y, [48, 43, 43])


def test_visible_until_hides_the_notes_after_time_t_and_draws_the_current_note_up_to_t():
    x, y = channel_paths(tiny_midi())["P1"]
    shown_x, shown_y = visible_until(x, y, 2.0)
    assert shown_x.max() == 2.0
    # The note that sounds at 2.0 s (pitch 74) is drawn up to the playhead, not to its end.
    assert shown_y[-1] == 74
    shown_x, _ = visible_until(x, y, 0.5)
    np.testing.assert_allclose(shown_x, [0.0, 0.5])
    assert len(visible_until(x, y, -1.0)[0]) == 0
    # After the last note the path ends where the note ends.
    assert visible_until(x, y, 5.0)[0].max() == 3.0


def test_visible_until_keeps_the_note_that_enters_the_window_from_the_left():
    x, y = channel_paths(tiny_midi())["P1"]
    shown_x, shown_y = visible_until(x, y, 2.5, start=2.0)
    # The note starting at 1.5 s is still sounding at the left edge (2.0 s), so it stays drawn.
    np.testing.assert_allclose(shown_x, [1.5, 2.5])
    np.testing.assert_allclose(shown_y, [74, 74])


def test_sounding_pitch_is_nan_during_a_rest_and_after_the_last_note():
    x, y = channel_paths(tiny_midi())["P1"]
    assert sounding_pitch(x, y, 0.5) == 72
    assert np.isnan(sounding_pitch(x, y, 1.2))
    assert sounding_pitch(x, y, 2.9) == 74
    assert np.isnan(sounding_pitch(x, y, 3.5))
    assert np.isnan(sounding_pitch(x, y, -0.1))


def test_frame_is_an_rgb_image_of_the_requested_size_on_a_dark_background():
    scene = build_scene(tiny_midi(), width=320, height=180, window_seconds=4.0)
    frame = frame_at(scene, 2.0)
    assert frame.shape == (180, 320, 3)
    assert frame.dtype == np.uint8
    for corner in (frame[0, 0], frame[-1, -1]):
        assert corner.max() < 40


def test_frame_reveals_more_of_the_piece_as_time_advances():
    scene = build_scene(tiny_midi(), width=320, height=180, window_seconds=4.0)

    def lit_pixels(frame: np.ndarray) -> int:
        return int((frame.max(axis=2) > 80).sum())

    assert lit_pixels(frame_at(scene, 0.2)) < lit_pixels(frame_at(scene, 2.5))


def test_missing_ffmpeg_skips_the_video_with_a_notice(tmp_path, monkeypatch, capsys):
    mid = tmp_path / "piece.mid"
    tiny_midi().write(str(mid))
    monkeypatch.setattr("export.video.shutil.which", lambda name: None)
    ok = render_video(mid, tmp_path / "piece.wav", tmp_path / "piece.mp4")
    assert ok is False
    assert not (tmp_path / "piece.mp4").exists()
    assert "video skipped: missing ffmpeg" in capsys.readouterr().err


@pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg or ffprobe is not installed")
def test_video_lasts_as_long_as_the_piece_plus_one_second(tmp_path):
    mid, audio, mp4 = tmp_path / "piece.mid", tmp_path / "piece.wav", tmp_path / "piece.mp4"
    tiny_midi().write(str(mid))
    # The audio is longer than the video, so `-shortest` keeps the video length (3 s + 1 s).
    write_silent_wav(audio, seconds=6.0)
    assert render_video(mid, audio, mp4, fps=10, width=160, height=90) is True
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp4)],
        check=True,
        capture_output=True,
        text=True,
    )
    assert abs(float(probe.stdout) - 4.0) < 1.5
