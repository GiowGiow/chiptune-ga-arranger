import shutil
import subprocess

import numpy as np
import pretty_midi
import pytest
from test_video import write_silent_wav

from export.input_video import (
    MELODY_COLOR,
    build_input_scene,
    excerpt_notes,
    input_frame_at,
    note_layers,
    render_input_video,
)

FFMPEG_AVAILABLE = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
FLUTE, GUITAR, BASS, PIANO = 73, 24, 33, 0


def band_midi(extra_tracks: int = 0) -> pretty_midi.PrettyMIDI:
    """A 4-second song: guitar chords (track 0), a flute melody (track 1), drums (track 2).

    `extra_tracks` adds pianos with 1, 2, 3, ... notes each, so they rank by activity.
    """
    midi = pretty_midi.PrettyMIDI(initial_tempo=120.0)
    guitar = pretty_midi.Instrument(GUITAR, name="Song title")
    for start in (0.0, 2.0):
        for pitch in (60, 64, 67):
            guitar.notes.append(pretty_midi.Note(80, pitch, start, start + 2.0))
    flute = pretty_midi.Instrument(FLUTE, name="Song title")
    for index, pitch in enumerate((72, 74, 76, 77)):
        flute.notes.append(pretty_midi.Note(100, pitch, float(index), index + 1.0))
    drums = pretty_midi.Instrument(0, is_drum=True, name="Song title")
    for index, pitch in enumerate((36, 42, 38, 42)):
        drums.notes.append(pretty_midi.Note(100, pitch, float(index), index + 0.1))
    midi.instruments += [guitar, flute, drums]
    for count in range(1, extra_tracks + 1):
        piano = pretty_midi.Instrument(PIANO, name=f"piano {count}")
        piano.notes += [pretty_midi.Note(70, 48 + n, n * 0.5, n * 0.5 + 0.4) for n in range(count)]
        midi.instruments.append(piano)
    return midi


def test_excerpt_notes_shift_time_to_the_start_of_the_audio_and_cut_at_its_end():
    # Rows are (start, end, pitch) in seconds of the original file.
    notes = np.array([[1.0, 2.0, 60], [9.5, 10.5, 62], [11.0, 13.0, 64], [12.5, 14.0, 65]])
    shown = excerpt_notes(notes, start=10.0, end=12.0)
    # The note that sounds across the start enters at 0; the one past the end is cut at 2 s; the
    # notes wholly outside the excerpt are gone.
    np.testing.assert_allclose(shown, [[0.0, 0.5, 62], [1.0, 2.0, 64]])


def test_note_layers_put_the_melody_first_in_the_melody_color_and_leave_out_the_drums():
    layers, drum_hits = note_layers(band_midi(), melody_tracks=1, start=0.0, end=4.0)
    assert [layer.label for layer in layers] == ["Melody (Flute)", "Acoustic Guitar (nylon)"]
    assert layers[0].is_melody and layers[0].color == MELODY_COLOR
    assert not layers[1].is_melody and layers[1].color != MELODY_COLOR
    np.testing.assert_allclose(layers[0].notes[:, 2], [72, 74, 76, 77])
    assert len(layers[1].notes) == 6
    np.testing.assert_allclose(drum_hits[:, 0], [0.0, 1.0, 2.0, 3.0])


def test_note_layers_keep_the_most_active_tracks_and_merge_the_rest_as_other():
    # Melody, guitar (6 notes) and pianos with 1 to 6 notes: 8 pitched tracks in all.
    layers, _ = note_layers(band_midi(extra_tracks=6), melody_tracks=1, start=0.0, end=4.0,
                            max_tracks=4)  # fmt: skip
    labels = [layer.label for layer in layers]
    # The melody always stays; then the busiest tracks; repeated instrument names get numbers.
    assert labels == [
        "Melody (Flute)",
        "Acoustic Guitar (nylon)",
        "Acoustic Grand Piano 1",
        "Acoustic Grand Piano 2",
        "other",
    ]
    # The 6-note piano is kept; the pianos with 1 to 4 notes are merged into "other".
    assert len(layers[2].notes) == 6 and len(layers[3].notes) == 5
    assert len(layers[4].notes) == 1 + 2 + 3 + 4


def test_input_frame_has_the_requested_size_and_lights_up_as_the_song_plays():
    scene = build_input_scene(band_midi(), melody_tracks=1, start=0.0, end=4.0, width=320,
                              height=180, window_seconds=4.0)  # fmt: skip
    first, later = input_frame_at(scene, 0.1), input_frame_at(scene, 3.5)
    assert first.shape == (180, 320, 3) and first.dtype == np.uint8
    assert first[0, 0].max() < 40

    def lit_pixels(frame: np.ndarray) -> int:
        return int((frame.max(axis=2) > 80).sum())

    assert lit_pixels(first) < lit_pixels(later)


def test_missing_ffmpeg_skips_the_input_video_with_a_notice(tmp_path, monkeypatch, capsys):
    mid = tmp_path / "song.mid"
    band_midi().write(str(mid))
    monkeypatch.setattr("export.video.shutil.which", lambda name: None)
    assert render_input_video(mid, tmp_path / "input.wav", tmp_path / "input.mp4", 1) is False
    assert not (tmp_path / "input.mp4").exists()
    assert "video skipped: missing ffmpeg" in capsys.readouterr().err


@pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg or ffprobe is not installed")
def test_input_video_of_an_excerpt_lasts_as_long_as_its_audio(tmp_path):
    mid, audio, mp4 = tmp_path / "song.mid", tmp_path / "input.wav", tmp_path / "input.mp4"
    band_midi().write(str(mid))
    # The audio is the excerpt from 1 s to 3 s of the song, as input.mp3 is for a MIDI song.
    write_silent_wav(audio, seconds=2.0)
    ok = render_input_video(mid, audio, mp4, melody_tracks=1, start_seconds=1.0,
                            end_seconds=3.0, fps=10, width=160, height=90)  # fmt: skip
    assert ok is True
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height:format=duration", "-of", "default=nw=1", str(mp4)],
        check=True, capture_output=True, text=True,
    )  # fmt: skip
    fields = dict(line.split("=") for line in probe.stdout.split())
    assert (fields["width"], fields["height"]) == ("160", "90")
    assert abs(float(fields["duration"]) - 2.0) < 0.5


@pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg or ffprobe is not installed")
def test_video_command_with_input_writes_input_mp4_for_an_abc_sample(tmp_path):
    import json

    from main import main

    # An ABC sample keeps its input played plainly in input.mid, with the melody on track 0.
    (tmp_path / "config.json").write_text(json.dumps({"input_path": "data/leadsheets/x.abc"}))
    midi = band_midi()
    midi.instruments = [midi.instruments[1], midi.instruments[0]]
    midi.write(str(tmp_path / "input.mid"))
    write_silent_wav(tmp_path / "input.wav", seconds=5.0)
    (tmp_path / "input.wav").rename(tmp_path / "input.mp3")  # ffmpeg reads it by content
    assert main(["video", str(tmp_path), "--input", "--fps", "5"]) == 0
    assert (tmp_path / "input.mp4").stat().st_size > 0
    assert not (tmp_path / "piece.mp4").exists()
