"""Render the MIDI file to MP3 for listening, at a loudness shared by every rendering.

The audio is made only from the generated MIDI file, never edited by hand (constitution): FluidSynth
plays the file with a General MIDI soundfont into a WAV file, and ffmpeg compresses it to MP3. When
a program or the soundfont is missing, the run goes on without audio and says so.

Each sample has three renderings that a listener compares by ear, one after the other: the input
played plainly (`input.mp3`), the arrangement with General MIDI instruments (`piece.mp3`) and with
chip sounds (`piece-chip.mp3`). Their raw levels differed by up to 20 dB, because a lone melody has
far less energy than four channels, and the ear judges a louder version as better. So every MP3
is brought to the same perceived loudness before encoding, with the EBU R128 standard:

- Loudness is measured in LUFS (loudness units relative to full scale): the signal is weighted
  like the ear's sensitivity across frequencies (K-weighting), its power is averaged over 400 ms
  blocks, and silent blocks are left out, so pauses do not lower the result.
- ffmpeg's `loudnorm` filter runs twice. The first pass measures the file; the second applies one
  constant gain that moves it to -16 LUFS (a common level for music heard online). One gain for
  the whole file keeps the dynamics of the music intact. If that gain would push the true peak
  (the peak between samples, which an MP3 decoder can reproduce) over -1.5 dBTP, ffmpeg switches
  to its dynamic mode, which turns the gain down only around the loudest moments.
- Every MP3 is stereo. A player copies a mono file to both speakers at full level, which sounds
  3 dB louder than the mono measurement says; two identical channels are measured as they play.

Reference: ITU-R BS.1770-4 (loudness and true-peak measurement) and EBU R 128 (normalization).
"""

import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_SOUNDFONT = Path("/usr/share/sounds/sf2/FluidR3_GM.sf2")

# FluidSynth output gain: 0.25 keeps the four channels below clipping (peaks near -3 dBFS).
FLUIDSYNTH_GAIN = "0.25"

TARGET_LUFS = -16.0
# -1.5 dBTP leaves room for the small overshoot that MP3 encoding adds to the peaks.
TRUE_PEAK_DBTP = -1.5
# loudnorm uses one constant gain only when the measured loudness range fits its range target,
# so the target is set to the measured range (within ffmpeg's 1-20 LU limits).
MIN_LOUDNESS_RANGE, MAX_LOUDNESS_RANGE = 7.0, 20.0
# Below this level (the absolute gate of BS.1770) a file counts as silent and is left as it is.
SILENCE_LUFS = -70.0


def _cut_filters(start_seconds: float | None, end_seconds: float | None) -> list[str]:
    """Filters that cut the excerpt; they run before loudnorm, so only the excerpt is measured."""
    if start_seconds is None or end_seconds is None:
        return []
    return [f"atrim=start={start_seconds:.3f}:end={end_seconds:.3f}", "asetpts=PTS-STARTPTS"]


def measure_loudness(
    audio_path: Path | str,
    start_seconds: float | None = None,
    end_seconds: float | None = None,
) -> dict[str, float]:
    """Measure an audio file (or its excerpt) as two-channel sound, with ffmpeg's `loudnorm`.

    Returns loudnorm's first-pass values: `input_i` (integrated loudness, LUFS), `input_tp`
    (true peak, dBTP), `input_lra` (loudness range, LU) and `input_thresh` (gate, LUFS).
    """
    analysis = [
        *_cut_filters(start_seconds, end_seconds),
        "aformat=channel_layouts=stereo",
        f"loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK_DBTP}:print_format=json",
    ]
    command = ["ffmpeg", "-hide_banner", "-nostats", "-i", str(audio_path)]
    command += ["-af", ",".join(analysis), "-f", "null", "-"]
    report = subprocess.run(command, check=True, capture_output=True, text=True).stderr
    # loudnorm prints its measurement as the last JSON object of ffmpeg's log.
    values = json.loads(report[report.rindex("{") :])
    keys = ("input_i", "input_tp", "input_lra", "input_thresh")
    return {key: float(values[key]) for key in keys}


def normalize_loudness(
    audio_path: Path | str,
    mp3_path: Path | str,
    target_lufs: float = TARGET_LUFS,
    start_seconds: float | None = None,
    end_seconds: float | None = None,
) -> None:
    """Encode `audio_path` (or its excerpt) to a stereo MP3 at `target_lufs`, peaks at -1.5 dBTP.

    Pass 1 measures the excerpt; pass 2 feeds the measurement back to loudnorm, which then applies
    one linear gain (see the module docstring for when it must fall back to its dynamic mode).
    Normalizing the WAV before encoding avoids a second lossy encoding. Silence is encoded as it is.
    """
    measured = measure_loudness(audio_path, start_seconds, end_seconds)
    filters = [*_cut_filters(start_seconds, end_seconds), "aformat=channel_layouts=stereo"]
    if math.isfinite(measured["input_i"]) and measured["input_i"] > SILENCE_LUFS:
        loudness_range = min(max(measured["input_lra"], MIN_LOUDNESS_RANGE), MAX_LOUDNESS_RANGE)
        filters.append(
            f"loudnorm=I={target_lufs}:TP={TRUE_PEAK_DBTP}:LRA={loudness_range}"
            f":measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
            f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
            ":linear=true"
        )
    # loudnorm always outputs 192 kHz (it upsamples to find true peaks); go back to CD rate.
    filters.append("aresample=44100")
    encode = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(audio_path), "-af", ",".join(filters)]
    subprocess.run([*encode, "-codec:a", "libmp3lame", "-qscale:a", "4", str(mp3_path)], check=True)


def render_mp3(
    mid_path: Path | str,
    mp3_path: Path | str,
    soundfont: Path | str = DEFAULT_SOUNDFONT,
    start_seconds: float | None = None,
    end_seconds: float | None = None,
) -> bool:
    """Render `mid_path` to `mp3_path`; return False (with a notice) when audio is unavailable.

    `start_seconds` and `end_seconds` cut the rendered audio to an excerpt; the excerpt is cut
    first and then brought to the shared loudness, so the rest of the song does not count.
    """
    mid_path, mp3_path, soundfont = Path(mid_path), Path(mp3_path), Path(soundfont)
    missing = [name for name in ("fluidsynth", "ffmpeg") if shutil.which(name) is None]
    if not soundfont.exists():
        missing.append(f"soundfont {soundfont}")
    if missing:
        print(f"audio skipped: missing {', '.join(missing)}", file=sys.stderr)
        return False
    wav_path = mp3_path.with_suffix(".wav")
    synth = ["fluidsynth", "-ni", "-q", "-g", FLUIDSYNTH_GAIN, "-r", "44100", "-F", str(wav_path)]
    subprocess.run([*synth, str(soundfont), str(mid_path)], check=True, capture_output=True)
    try:
        normalize_loudness(wav_path, mp3_path, start_seconds=start_seconds, end_seconds=end_seconds)
    finally:
        wav_path.unlink(missing_ok=True)
    return True
