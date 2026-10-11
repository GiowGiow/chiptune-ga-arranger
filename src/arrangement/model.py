"""Data types and chip constants for an NES arrangement.

The NES sound chip (2A03) has four channels that each play one note at a time:

- P1 and P2: pulse (square) waves. P1 carries the melody, P2 a harmony texture.
- TR: a triangle wave, used for the bass. It has no volume control, so its loudness is fixed.
- NO: a noise generator, used for percussion (kick, snare and hi-hat sounds).

The pitch ranges follow the hardware limits reported for the NES Music Database (pulse 32-108,
triangle 21-108, Donahue et al., 2018); the pulse range starts one semitone higher to stay safe.
"""

from dataclasses import dataclass

CHANNELS = ("P1", "P2", "TR", "NO")

# Inclusive MIDI pitch ranges of the pitched channels (NO has no pitch range).
PITCH_RANGES = {"P1": (33, 108), "P2": (33, 108), "TR": (21, 108)}

# Lowest MIDI pitch of the octave where each texture places the chord root: P2 roots fall in
# 48-59 (C3-B3), below both melodies; TR roots fall in 28-39 (E1-D#2), a bass register.
P2_ROOT_LOW = 48
TR_ROOT_LOW = 28

# MIDI velocities (loudness). The echo texture plays at 60% of the melody's loudness.
VELOCITY_P1 = 100
VELOCITY_P2 = 80
VELOCITY_ECHO = 60
VELOCITY_TR = 90

# General MIDI percussion notes and velocities used for the noise channel.
KICK, SNARE, HIHAT = 36, 38, 42
DRUM_VELOCITY = {KICK: 100, SNARE: 90, HIHAT: 60}


@dataclass(frozen=True)
class ChannelNote:
    """One note of one channel.

    Realizers return onsets relative to the bar start; an `Arrangement` stores onsets in beats
    from the start of the piece.

    Attributes:
        pitch: MIDI pitch (for NO, a General MIDI percussion note).
        onset: start in beats.
        duration: length in beats (> 0).
        velocity: MIDI velocity (1-127).
    """

    pitch: int
    onset: float
    duration: float
    velocity: int


@dataclass(frozen=True)
class Arrangement:
    """A finished four-channel arrangement of a lead sheet.

    Attributes:
        title: tune title.
        tempo_bpm: tempo in quarter notes per minute.
        genome: the arrangement plan, one (P2, TR, NO, P1-octave) gene tuple per bar.
        channels: notes per channel name ("P1", "P2", "TR", "NO"), with onsets from the piece start.
    """

    title: str
    tempo_bpm: float
    genome: tuple[tuple[int, int, int, int], ...]
    channels: dict[str, tuple[ChannelNote, ...]]
