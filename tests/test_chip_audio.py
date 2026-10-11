import shutil
import time
import wave

import numpy as np
import pretty_midi
import pytest

from export import chip_audio
from export.chip_audio import (
    noise_wave,
    pulse_wave,
    render_chip_mp3,
    synthesize,
    triangle_wave,
    write_wav,
)

SAMPLE_RATE = 44100
PEAK_AT_MINUS_3_DBFS = 10 ** (-3 / 20)


def nes_midi(seconds: float = 1.0, step: float = 0.25) -> pretty_midi.PrettyMIDI:
    """A MIDI object shaped like `export.midi` output: tracks P1, P2, TR and a drum track NO."""
    midi = pretty_midi.PrettyMIDI(initial_tempo=120.0)
    tracks = {
        "P1": pretty_midi.Instrument(program=80, name="P1"),
        "P2": pretty_midi.Instrument(program=80, name="P2"),
        "TR": pretty_midi.Instrument(program=38, name="TR"),
        "NO": pretty_midi.Instrument(program=0, is_drum=True, name="NO"),
    }
    drum_pattern = (36, 42, 38, 42)
    for index, start in enumerate(np.arange(0.0, seconds, step)):
        end = start + step
        tracks["P1"].notes.append(pretty_midi.Note(100, 72 + index % 12, start, end))
        tracks["P2"].notes.append(pretty_midi.Note(80, 60 + index % 7, start, end))
        tracks["TR"].notes.append(pretty_midi.Note(90, 36 + index % 5, start, end))
        drum = drum_pattern[index % len(drum_pattern)]
        tracks["NO"].notes.append(pretty_midi.Note(90, drum, start, start + step / 2))
    midi.instruments.extend(tracks.values())
    return midi


@pytest.mark.parametrize("duty", [0.125, 0.25, 0.5])
def test_pulse_wave_is_high_for_the_duty_share_of_each_cycle(duty):
    wave_samples = pulse_wave(440.0, SAMPLE_RATE, duty, SAMPLE_RATE)
    assert len(wave_samples) == SAMPLE_RATE
    assert set(np.unique(wave_samples)) == {-1.0, 1.0}
    assert abs(np.mean(wave_samples == 1.0) - duty) < 0.01


def test_triangle_wave_has_only_16_levels_and_spans_minus_one_to_one():
    wave_samples = triangle_wave(110.0, SAMPLE_RATE, SAMPLE_RATE)
    assert len(wave_samples) == SAMPLE_RATE
    assert len(np.unique(wave_samples)) <= 16
    assert wave_samples.min() == -1.0 and wave_samples.max() == 1.0


def test_noise_wave_is_deterministic_and_uses_both_output_values():
    first = noise_wave(4410, 202, False, SAMPLE_RATE)
    second = noise_wave(4410, 202, False, SAMPLE_RATE)
    assert len(first) == 4410
    assert np.array_equal(first, second)
    assert set(np.unique(first)) == {-1.0, 1.0}


def test_noise_short_mode_sounds_different_from_long_mode():
    long_mode = noise_wave(4410, 202, False, SAMPLE_RATE)
    short_mode = noise_wave(4410, 202, True, SAMPLE_RATE)
    assert not np.array_equal(long_mode, short_mode)


def test_synthesized_piece_covers_the_whole_midi_and_peaks_at_minus_3_dbfs():
    midi = nes_midi()
    audio = synthesize(midi, SAMPLE_RATE)
    assert audio.ndim == 1
    assert len(audio) >= midi.get_end_time() * SAMPLE_RATE
    assert abs(np.max(np.abs(audio)) - PEAK_AT_MINUS_3_DBFS) < 0.001


def test_synthesis_is_deterministic():
    assert np.array_equal(synthesize(nes_midi()), synthesize(nes_midi()))


def test_every_nes_channel_contributes_to_the_mix():
    full_mix = synthesize(nes_midi())
    for channel in ("P1", "P2", "TR", "NO"):
        midi = nes_midi()
        midi.instruments = [track for track in midi.instruments if track.name != channel]
        mix_without_channel = synthesize(midi)
        shared = min(len(full_mix), len(mix_without_channel))
        assert not np.array_equal(full_mix[:shared], mix_without_channel[:shared]), channel


def test_noise_channel_plays_one_hit_at_a_time_and_the_kick_wins_a_tie():
    def drum_midi(*pitches: int) -> pretty_midi.PrettyMIDI:
        midi = pretty_midi.PrettyMIDI()
        noise = pretty_midi.Instrument(program=0, is_drum=True, name="NO")
        noise.notes.extend(pretty_midi.Note(100, pitch, 0.0, 0.1) for pitch in pitches)
        midi.instruments.append(noise)
        return midi

    kick_alone = synthesize(drum_midi(36))
    assert np.array_equal(synthesize(drum_midi(42, 36)), kick_alone)
    assert np.array_equal(synthesize(drum_midi(36, 38, 42)), kick_alone)


def test_tracks_with_unknown_names_are_ignored_and_silence_stays_zero():
    midi = pretty_midi.PrettyMIDI()
    piano = pretty_midi.Instrument(program=0, name="Piano")
    piano.notes.append(pretty_midi.Note(100, 60, 0.0, 1.0))
    midi.instruments.append(piano)
    audio = synthesize(midi, SAMPLE_RATE)
    assert len(audio) >= SAMPLE_RATE
    assert np.all(np.isfinite(audio))
    assert not np.any(audio)


def test_wav_file_is_16_bit_mono(tmp_path):
    path = tmp_path / "piece.wav"
    write_wav(np.array([0.0, 0.5, -0.5, 1.0]), path, SAMPLE_RATE)
    with wave.open(str(path), "rb") as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, SAMPLE_RATE)
        frames = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
    assert frames.tolist() == [0, 16384, -16384, 32767]


def test_a_minute_of_four_channel_music_is_synthesized_in_under_ten_seconds():
    # 16th notes at 120 BPM on four channels: 1,920 notes in 60 s.
    midi = nes_midi(seconds=60.0, step=0.125)
    assert sum(len(track.notes) for track in midi.instruments) >= 1900
    started = time.perf_counter()
    audio = synthesize(midi, SAMPLE_RATE)
    assert time.perf_counter() - started < 10.0
    assert len(audio) >= 60 * SAMPLE_RATE


def test_missing_ffmpeg_skips_chip_audio_with_a_notice(tmp_path, capsys, monkeypatch):
    mid = tmp_path / "piece.mid"
    nes_midi().write(str(mid))
    monkeypatch.setattr(chip_audio.shutil, "which", lambda name: None)
    assert render_chip_mp3(mid, tmp_path / "piece_chip.mp3") is False
    assert not (tmp_path / "piece_chip.mp3").exists()
    assert "audio skipped: missing ffmpeg" in capsys.readouterr().err


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_chip_audio_is_rendered_from_the_midi_file_and_the_wav_is_removed(tmp_path):
    mid = tmp_path / "piece.mid"
    nes_midi().write(str(mid))
    assert render_chip_mp3(mid, tmp_path / "piece_chip.mp3") is True
    assert (tmp_path / "piece_chip.mp3").stat().st_size > 0
    assert not list(tmp_path.glob("*.wav"))
