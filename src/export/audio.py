"""Render the MIDI file to MP3 for listening.

The audio is made only from the generated MIDI file, never edited by hand (constitution): FluidSynth
plays the file with a General MIDI soundfont into a WAV file, and ffmpeg compresses it to MP3. When
a program or the soundfont is missing, the run goes on without audio and says so.
"""

import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_SOUNDFONT = Path("/usr/share/sounds/sf2/FluidR3_GM.sf2")

# FluidSynth output gain: 0.25 keeps the four channels below clipping (peaks near -3 dBFS).
FLUIDSYNTH_GAIN = "0.25"


def render_mp3(
    mid_path: Path | str, mp3_path: Path | str, soundfont: Path | str = DEFAULT_SOUNDFONT
) -> bool:
    """Render `mid_path` to `mp3_path`; return False (with a notice) when audio is unavailable."""
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
    encode = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path)]
    subprocess.run([*encode, "-codec:a", "libmp3lame", "-qscale:a", "4", str(mp3_path)], check=True)
    wav_path.unlink()
    return True
