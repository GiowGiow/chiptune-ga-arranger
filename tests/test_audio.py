import shutil
import subprocess
from pathlib import Path

import pytest
from test_midi_export import small_arrangement

from export.audio import DEFAULT_SOUNDFONT, measure_loudness, normalize_loudness, render_mp3
from export.midi import write_midi

FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None
needs_ffmpeg = pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg is not installed")


def tone_wav(path: Path, volume_db: float, seconds: float = 6.0, channels: int = 1) -> Path:
    """Write a 440 Hz sine tone at `volume_db` (relative to a full-scale sine) to a WAV file."""
    tone = f"sine=frequency=440:sample_rate=44100:duration={seconds}"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", tone,
         "-af", f"volume={8 * 10 ** (volume_db / 20):.6f}", "-ac", str(channels), str(path)],
        check=True,
    )  # fmt: skip
    return path


def channel_count(path: Path) -> int:
    probe = ["ffprobe", "-v", "error", "-show_entries", "stream=channels", "-of", "csv=p=0"]
    return int(subprocess.run([*probe, str(path)], capture_output=True, text=True).stdout)


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


@needs_ffmpeg
@pytest.mark.parametrize("volume_db", [-40.0, -1.0])
def test_quiet_and_loud_tones_end_at_minus_16_lufs_below_the_peak_ceiling(tmp_path, volume_db):
    source = tone_wav(tmp_path / "tone.wav", volume_db)
    normalize_loudness(source, tmp_path / "tone.mp3")
    loudness = measure_loudness(tmp_path / "tone.mp3")
    assert abs(loudness["input_i"] - (-16.0)) <= 1.0
    assert loudness["input_tp"] <= -1.0


@needs_ffmpeg
def test_a_mono_source_becomes_two_identical_channels_so_every_player_hears_the_target(tmp_path):
    # Players copy a mono file to both speakers, 3 dB louder than its mono measurement says.
    normalize_loudness(tone_wav(tmp_path / "mono.wav", -20.0), tmp_path / "mono.mp3")
    normalize_loudness(tone_wav(tmp_path / "st.wav", -20.0, channels=2), tmp_path / "st.mp3")
    assert channel_count(tmp_path / "mono.mp3") == 2
    mono, stereo = measure_loudness(tmp_path / "mono.mp3"), measure_loudness(tmp_path / "st.mp3")
    assert abs(mono["input_i"] - stereo["input_i"]) <= 0.5


@needs_ffmpeg
def test_an_excerpt_is_cut_first_and_then_brought_to_the_target(tmp_path):
    loud, quiet = tone_wav(tmp_path / "loud.wav", -1.0), tone_wav(tmp_path / "quiet.wav", -40.0)
    both = tmp_path / "both.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(loud), "-i", str(quiet),
         "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1", str(both)],
        check=True,
    )  # fmt: skip
    normalize_loudness(both, tmp_path / "quiet-half.mp3", start_seconds=6.0, end_seconds=12.0)
    loudness = measure_loudness(tmp_path / "quiet-half.mp3")
    assert abs(loudness["input_i"] - (-16.0)) <= 1.0


@needs_ffmpeg
def test_silence_is_encoded_as_it_is_since_it_has_no_loudness_to_match(tmp_path):
    silence = tone_wav(tmp_path / "silence.wav", -200.0)
    normalize_loudness(silence, tmp_path / "silence.mp3")
    assert (tmp_path / "silence.mp3").stat().st_size > 0


@pytest.mark.skipif(
    not AUDIO_TOOLS_AVAILABLE, reason="fluidsynth, ffmpeg or the GM soundfont is not installed"
)
def test_general_midi_and_chip_renders_of_one_piece_play_equally_loud(tmp_path):
    from export.chip_audio import render_chip_mp3

    mid = tmp_path / "piece.mid"
    write_midi(small_arrangement(), mid)
    render_mp3(mid, tmp_path / "piece.mp3")
    render_chip_mp3(mid, tmp_path / "piece-chip.mp3")
    general_midi = measure_loudness(tmp_path / "piece.mp3")
    chip = measure_loudness(tmp_path / "piece-chip.mp3")
    assert abs(general_midi["input_i"] - chip["input_i"]) <= 1.0
    assert max(general_midi["input_tp"], chip["input_tp"]) <= -1.0
