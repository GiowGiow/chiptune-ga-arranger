import shutil
from pathlib import Path

import pytest
from test_midi_export import small_arrangement

from export.audio import DEFAULT_SOUNDFONT, render_mp3
from export.midi import write_midi


def test_missing_soundfont_skips_audio_with_a_notice(tmp_path, capsys):
    mid = tmp_path / "piece.mid"
    write_midi(small_arrangement(), mid)
    ok = render_mp3(mid, tmp_path / "piece.mp3", soundfont=tmp_path / "missing.sf2")
    assert ok is False
    assert not (tmp_path / "piece.mp3").exists()
    assert "audio skipped" in capsys.readouterr().err


AUDIO_TOOLS_AVAILABLE = bool(
    shutil.which("fluidsynth") and shutil.which("ffmpeg") and Path(DEFAULT_SOUNDFONT).exists()
)


@pytest.mark.skipif(
    not AUDIO_TOOLS_AVAILABLE, reason="fluidsynth, ffmpeg or the GM soundfont is not installed"
)
def test_audio_is_rendered_from_the_midi_file_only(tmp_path):
    mid = tmp_path / "piece.mid"
    write_midi(small_arrangement(), mid)
    assert render_mp3(mid, tmp_path / "piece.mp3") is True
    assert (tmp_path / "piece.mp3").stat().st_size > 0
    assert not (tmp_path / "piece.wav").exists()


@pytest.mark.skipif(
    not AUDIO_TOOLS_AVAILABLE, reason="fluidsynth, ffmpeg or the GM soundfont is not installed"
)
def test_audio_can_be_cut_to_an_excerpt(tmp_path):
    import subprocess

    mid = tmp_path / "piece.mid"
    write_midi(small_arrangement(), mid)
    assert render_mp3(mid, tmp_path / "cut.mp3", start_seconds=0.2, end_seconds=0.7) is True
    probe = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"]
    duration = float(
        subprocess.run([*probe, str(tmp_path / "cut.mp3")], capture_output=True, text=True).stdout
    )
    assert abs(duration - 0.5) < 0.1
