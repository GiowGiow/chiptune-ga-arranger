"""Play the generated MIDI file with NES chip sounds instead of General MIDI instruments.

The NES sound chip (the 2A03 audio processing unit) makes music with a few very simple tone
generators. Each channel of the arrangement belongs to one of them (Donahue et al., 2018, p. 3):

- P1 and P2 are pulse waves: a square wave whose high part lasts only a fraction of each cycle,
  the duty cycle (12.5%, 25% or 50%; 75% sounds like 25%). A narrower pulse sounds thinner and
  more nasal, so P1 (25%) and P2 (12.5%) stay apart. Pulse loudness is a 4-bit volume: 15
  levels plus silence.
- TR is a triangle wave drawn as a 32-step staircase with only 16 levels, which gives the bass
  its slightly buzzy edge. It has no volume control: it is on or off, so its loudness is fixed.
- NO is a noise generator. A 15-bit linear feedback shift register (LFSR) shifts one bit per
  clock tick and feeds back the XOR of two of its bits, which gives a long pseudo-random stream
  of bits. The clock rate (set by a "period") makes the noise darker or brighter, and a "short
  mode" makes the stream repeat after 93 ticks, which sounds metallic. The arranger's drum
  notes (kick, snare, hi-hat) each choose one noise setting and a short decay.

These are the basic waveforms seen in the course (square/pulse, triangle and noise, lecture A04
on audio representation), here in the coarse form the chip produces. Like `export.audio`, the
audio is made only from the generated MIDI file: tracks are found by name (P1, P2, TR, NO), each
note is synthesized with numpy, the channels are mixed with fixed gains and the mix is scaled to
peak at -3 dBFS. ffmpeg then compresses it to MP3.

Reference: C. Donahue, H. H. Mao and J. McAuley, "The NES Music Database: a multi-instrumental
dataset with expressive performance attributes", ISMIR 2018 (channel roles, 4 duty cycles, 15
volume levels for pulse and noise, no volume for the triangle).
"""

import functools
import math
import shutil
import subprocess
import sys
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pretty_midi

from arrangement.model import HIHAT, KICK, SNARE

SAMPLE_RATE = 44100

# NTSC NES CPU clock; the noise register ticks once every `period` CPU cycles.
CPU_CLOCK_HZ = 1_789_773
NOISE_PERIODS = (4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068)

PULSE_DUTY = {"P1": 0.25, "P2": 0.125}

# Channel gains follow the linear approximation of the chip's mixer (NESdev wiki, "APU Mixer"):
# 0.00752 per pulse volume step, 0.00851 per triangle step and 0.00494 per noise step.
CHANNEL_GAINS = {"P1": 1.0, "P2": 1.0, "TR": 0.00851 / 0.00752, "NO": 0.00494 / 0.00752}

PEAK_LEVEL = 10 ** (-3 / 20)  # -3 dBFS, the same headroom as the General MIDI render
FADE_SECONDS = 0.002  # a 2 ms ramp at each note edge removes the click of a sudden jump

# The 32-step triangle sequence of the chip: 15, 14, ..., 0, 0, 1, ..., 15.
TRIANGLE_STEPS = np.concatenate([np.arange(15, -1, -1), np.arange(16)])


@dataclass(frozen=True)
class DrumSound:
    """How the noise channel plays one General MIDI drum note.

    Attributes:
        period: noise period in CPU cycles (one of `NOISE_PERIODS`; longer is darker).
        short_mode: True for the metallic 93-step noise.
        decay_seconds: length of the hit; its envelope falls by 40 dB over this time.
    """

    period: int
    short_mode: bool
    decay_seconds: float


DRUM_SOUNDS = {
    KICK: DrumSound(period=NOISE_PERIODS[13], short_mode=False, decay_seconds=0.120),
    SNARE: DrumSound(period=NOISE_PERIODS[8], short_mode=False, decay_seconds=0.150),
    HIHAT: DrumSound(period=NOISE_PERIODS[1], short_mode=True, decay_seconds=0.040),
}


def velocity_to_volume(velocity: int) -> int:
    """Map a MIDI velocity (1-127) to the chip's 4-bit volume (1-15; 0 would be silence).

    >>> [velocity_to_volume(velocity) for velocity in (127, 100, 60, 1)]
    [15, 12, 7, 1]
    """
    return max(1, round(velocity * 15 / 127))


def _cycle_phase(frequency: float, n_samples: int, sample_rate: int) -> np.ndarray:
    """Position inside the current cycle, in [0, 1), for each sample."""
    return np.mod(np.arange(n_samples) * (frequency / sample_rate), 1.0)


def pulse_wave(
    frequency: float, n_samples: int, duty: float, sample_rate: int = SAMPLE_RATE
) -> np.ndarray:
    """A pulse wave: +1 for the first `duty` share of each cycle, -1 for the rest.

    >>> pulse_wave(44100 / 8, 8, 0.25, 44100)
    array([ 1.,  1., -1., -1., -1., -1., -1., -1.])
    """
    return np.where(_cycle_phase(frequency, n_samples, sample_rate) < duty, 1.0, -1.0)


def triangle_wave(frequency: float, n_samples: int, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """The chip's triangle: the 32-step, 16-level sequence 15..0, 0..15 scaled to [-1, 1].

    >>> triangle_wave(44100 / 32, 32, 44100)[[0, 8, 15, 16, 31]]
    array([ 1.        , -0.06666667, -1.        , -1.        ,  1.        ])
    """
    step = (_cycle_phase(frequency, n_samples, sample_rate) * len(TRIANGLE_STEPS)).astype(int)
    return TRIANGLE_STEPS[step] / 7.5 - 1.0


@functools.cache
def _lfsr_cycle(short_mode: bool) -> np.ndarray:
    """Output bit (bit 0) of the noise register at every tick of one full cycle, from state 1.

    The register update is invertible, so it always comes back to its start state; one cycle
    is enough to produce noise of any length. Long mode: 32,767 ticks; short mode: 93 ticks.

    >>> len(_lfsr_cycle(False)), len(_lfsr_cycle(True))
    (32767, 93)
    """
    tap = 6 if short_mode else 1
    register = 1
    output_bits = []
    while True:
        output_bits.append(register & 1)
        feedback = (register & 1) ^ ((register >> tap) & 1)
        register = (register >> 1) | (feedback << 14)
        if register == 1:
            return np.array(output_bits, dtype=np.int8)


def noise_wave(
    n_samples: int, period: int, short_mode: bool, sample_rate: int = SAMPLE_RATE
) -> np.ndarray:
    """Noise from the chip's 15-bit LFSR ticking at CPU_CLOCK_HZ / period, as +1/-1 samples.

    Each sample holds the register output at that moment (+1 when bit 0 is 0, since the chip
    mutes the channel when bit 0 is 1). The register always starts at 1, so it is deterministic.

    >>> noise = noise_wave(1000, 16, False, 44100)
    >>> sorted(set(noise.tolist())), bool(np.array_equal(noise, noise_wave(1000, 16, False, 44100)))
    ([-1.0, 1.0], True)
    """
    output_bits = _lfsr_cycle(short_mode)
    ticks_per_sample = CPU_CLOCK_HZ / period / sample_rate
    tick = (np.arange(n_samples) * ticks_per_sample).astype(np.int64) % len(output_bits)
    return 1.0 - 2.0 * output_bits[tick]


def _fade_edges(tone: np.ndarray, fade_samples: int) -> np.ndarray:
    """Ramp the first and last `fade_samples` of a note from and to silence."""
    fade = min(fade_samples, len(tone) // 2)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, endpoint=False)
        tone[:fade] *= ramp
        tone[-fade:] *= ramp[::-1]
    return tone


def _sounding_seconds(channel: str, note: pretty_midi.Note, next_onset: float) -> float:
    """How long a note sounds: its MIDI length, or for a drum hit its decay, cut by the next hit."""
    if channel != "NO":
        return note.end - note.start
    drum = DRUM_SOUNDS.get(note.pitch)
    if drum is None:  # a drum note without a chip sound stays silent
        return 0.0
    # There is one noise channel, so a new hit cuts the previous one, as on the chip.
    return min(drum.decay_seconds, next_onset - note.start)


def _note_tone(
    channel: str, note: pretty_midi.Note, n_samples: int, sample_rate: int
) -> np.ndarray:
    """The waveform of one note of `channel`, with its envelope, volume and edge fades."""
    frequency = pretty_midi.note_number_to_hz(note.pitch)
    envelope: np.ndarray | float = 1.0
    if channel == "NO":
        drum = DRUM_SOUNDS[note.pitch]
        waveform = noise_wave(n_samples, drum.period, drum.short_mode, sample_rate)
        # Exponential decay that is 40 dB down (1%) after the drum's decay time.
        envelope = 0.01 ** (np.arange(n_samples) / (drum.decay_seconds * sample_rate))
    elif channel == "TR":
        waveform = triangle_wave(frequency, n_samples, sample_rate)
    else:
        waveform = pulse_wave(frequency, n_samples, PULSE_DUTY[channel], sample_rate)
    # The triangle has no volume control, so it ignores the velocity.
    volume = 1.0 if channel == "TR" else velocity_to_volume(note.velocity) / 15
    # The console's output filter blocks constant offsets; a 12.5% pulse (and the short noise)
    # would otherwise sit far from zero, waste headroom and thump at every note.
    tone = (waveform - waveform.mean()) * envelope * volume
    return _fade_edges(tone, round(FADE_SECONDS * sample_rate))


def synthesize(midi: pretty_midi.PrettyMIDI, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Synthesize the P1, P2, TR and NO tracks of `midi` with chip waveforms (mono, float).

    Tracks with other names are ignored. Pulse and noise loudness follow the note velocity on
    the 4-bit volume scale; the triangle is always at full level. The mix peaks at -3 dBFS, and
    a silent piece stays all zeros.
    """
    longest_hit = max(drum.decay_seconds for drum in DRUM_SOUNDS.values())
    mix = np.zeros(math.ceil((midi.get_end_time() + longest_hit) * sample_rate))
    for track in midi.instruments:
        if track.name not in CHANNEL_GAINS:
            continue
        # At equal onsets the lowest note comes last and survives the cut, so a kick wins over
        # a snare and a snare over a hi-hat, the same priority the arranger uses.
        notes = sorted(track.notes, key=lambda note: (note.start, -note.pitch))
        next_onsets = [note.start for note in notes[1:]] + [math.inf]
        for note, next_onset in zip(notes, next_onsets, strict=True):
            first_sample = round(note.start * sample_rate)
            end = note.start + _sounding_seconds(track.name, note, next_onset)
            n_samples = round(end * sample_rate) - first_sample
            if n_samples <= 0:
                continue
            tone = _note_tone(track.name, note, n_samples, sample_rate)
            segment = mix[first_sample : first_sample + n_samples]
            segment += CHANNEL_GAINS[track.name] * tone[: len(segment)]
    peak = np.max(np.abs(mix), initial=0.0)
    return mix * (PEAK_LEVEL / peak) if peak > 0 else mix


def write_wav(samples: np.ndarray, path: Path | str, sample_rate: int = SAMPLE_RATE) -> None:
    """Write float samples in [-1, 1] to a 16-bit mono WAV file."""
    pcm = np.round(np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())


def render_chip_mp3(
    mid_path: Path | str, mp3_path: Path | str, sample_rate: int = SAMPLE_RATE
) -> bool:
    """Render `mid_path` with chip sounds to `mp3_path`.

    Returns False, with a notice on stderr, when ffmpeg is missing.
    """
    mid_path, mp3_path = Path(mid_path), Path(mp3_path)
    if shutil.which("ffmpeg") is None:
        print("audio skipped: missing ffmpeg", file=sys.stderr)
        return False
    samples = synthesize(pretty_midi.PrettyMIDI(str(mid_path)), sample_rate)
    wav_path = mp3_path.with_suffix(".wav")
    write_wav(samples, wav_path, sample_rate)
    try:
        encode = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path)]
        subprocess.run(
            [*encode, "-codec:a", "libmp3lame", "-qscale:a", "4", str(mp3_path)], check=True
        )
    finally:
        wav_path.unlink(missing_ok=True)
    return True
