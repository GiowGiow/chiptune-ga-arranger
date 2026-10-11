"""Texture realizers: from one gene value to the notes of one channel in one bar.

An arrangement plan only says *which* texture each channel plays in each bar ("P2 arpeggiates in
sixteenths", "TR walks"). A realizer is the arranger's craft that turns such a choice into
concrete notes, reading the bar's melody and chords from the lead sheet:

- P1 plays the melody, possibly one octave up or down.
- P2 adds a harmony texture: a held root, a fast arpeggio (the chip-music way of sounding a whole
  chord on a channel that plays one note at a time), an echo of the melody, or a line under it.
- TR plays a bass line: held roots, an octave "pump", root-fifth, or a walking line.
- NO plays a drum pattern on a grid of sixteen sixteenth-note steps.

Every NES channel plays one note at a time, so every realizer returns a monophonic line: notes
sorted by onset that never overlap and stay inside the bar [0, 4]. Onsets are in beats from the
bar start. Realizers are pure functions, so the same bar and gene always give the same notes.
"""

import math
from dataclasses import replace

from arrangement.model import (
    DRUM_VELOCITY,
    HIHAT,
    KICK,
    P2_ROOT_LOW,
    PITCH_RANGES,
    SNARE,
    TR_ROOT_LOW,
    VELOCITY_ECHO,
    VELOCITY_P1,
    VELOCITY_P2,
    VELOCITY_TR,
    ChannelNote,
)
from ga.genome import NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES
from leadsheet.model import Bar, ChordSegment

BEATS_PER_BAR = 4.0

# Note lengths in beats (a beat is a quarter note).
QUARTER, EIGHTH, SIXTEENTH, THIRTY_SECOND = 1.0, 0.5, 0.25, 0.125

# Interval sizes in semitones.
OCTAVE = 12
PERFECT_FIFTH = 7
MAJOR_THIRD = 4
MINOR_THIRD = 3


# --- Pitch helpers ---------------------------------------------------------------------------


def _place_in_register(pitch_class: int, low: int) -> int:
    """The only pitch with this pitch class in the octave [low, low + 11]."""
    return low + (pitch_class - low) % OCTAVE


def _fold_into_range(pitch: int, low: int, high: int) -> int:
    """Move a pitch by whole octaves until it lies in [low, high]; its pitch class is kept."""
    while pitch < low:
        pitch += OCTAVE
    while pitch > high:
        pitch -= OCTAVE
    return pitch


def _chord_tone_above(root_pitch: int, chord: ChordSegment, position: int, fallback: int) -> int:
    """The chord tone at `position` (1 = third, 2 = fifth) in the octave just above the root.

    A chord written with fewer tones (for example a bare root) gets the `fallback` interval.
    """
    if position < len(chord.tones):
        return root_pitch + (chord.tones[position] - chord.root) % OCTAVE
    return root_pitch + fallback


# --- P1: the melody --------------------------------------------------------------------------


def realize_p1(bar: Bar, octave_gene: int) -> tuple[ChannelNote, ...]:
    """Play the bar's melody on P1, shifted by the octave the gene selects.

    Notes that the shift pushes out of the pulse range fold back by whole octaves, so the melody
    keeps its rhythm and its pitch classes.

    >>> from leadsheet.model import ChordSegment, MelodyNote
    >>> c = ChordSegment("C", 0, (0, 4, 7), 0.0, 4.0)
    >>> melody = (MelodyNote(60, 0.0, 2.0), MelodyNote(100, 2.0, 2.0))
    >>> bar = Bar(0, melody, (c,), "A", "verse", 0, False)
    >>> [note.pitch for note in realize_p1(bar, octave_gene=1)]  # up 12: 112 folds back to 100
    [72, 100]
    """
    low, high = PITCH_RANGES["P1"]
    shift = P1_OCTAVES[octave_gene]
    return tuple(
        ChannelNote(
            _fold_into_range(note.pitch + shift, low, high), note.onset, note.duration, VELOCITY_P1
        )
        for note in bar.melody
    )


# --- P2: the harmony texture -----------------------------------------------------------------


def _p2_hold(bar: Bar) -> list[ChannelNote]:
    return [
        ChannelNote(
            _place_in_register(chord.root, P2_ROOT_LOW), chord.onset, chord.duration, VELOCITY_P2
        )
        for chord in bar.chords
    ]


def _arpeggio_cycle(chord: ChordSegment) -> list[int]:
    """The chord tones stacked upward from the root, inside one octave: C-E-G is 48, 52, 55."""
    root_pitch = _place_in_register(chord.root, P2_ROOT_LOW)
    return [root_pitch] + [root_pitch + (tone - chord.root) % OCTAVE for tone in chord.tones[1:]]


def _p2_arpeggio(bar: Bar, step: float) -> list[ChannelNote]:
    notes = []
    for chord in bar.chords:
        cycle = _arpeggio_cycle(chord)
        chord_end = chord.onset + chord.duration
        # The small tolerance keeps float noise from adding a zero-length note at the chord end.
        for note_index in range(math.ceil(chord.duration / step - 1e-9)):
            onset = chord.onset + note_index * step
            duration = min(step, chord_end - onset)
            pitch = cycle[note_index % len(cycle)]
            notes.append(ChannelNote(pitch, onset, duration, VELOCITY_P2))
    return notes


def _p2_echo(bar: Bar) -> list[ChannelNote]:
    notes = []
    for note in bar.melody:
        onset = note.onset + EIGHTH
        if onset >= BEATS_PER_BAR:
            continue  # the echo of the bar's last eighth would fall into the next bar
        duration = min(note.duration, BEATS_PER_BAR - onset)
        notes.append(ChannelNote(note.pitch, onset, duration, VELOCITY_ECHO))
    return notes


def _p2_third(bar: Bar) -> list[ChannelNote]:
    notes = []
    for note in bar.melody:
        chord = bar.chord_at(note.onset)
        # Start a minor third below the melody, so the two voices never clash on a semitone or a
        # whole tone, and walk down to the first chord tone.
        pitch = note.pitch - MINOR_THIRD
        while pitch % OCTAVE not in chord.tones:
            pitch -= 1
        notes.append(ChannelNote(pitch, note.onset, note.duration, VELOCITY_P2))
    return notes


def realize_p2(bar: Bar, texture_gene: int) -> tuple[ChannelNote, ...]:
    """Play the P2 harmony texture the gene selects (an index into `P2_TEXTURES`).

    - hold: the chord root (placed in 48-59), sustained for each chord segment;
    - arp16 / arp32: the chord tones cycled upward from the root, one per sixteenth / thirty-second
      note, restarting at each chord change;
    - echo: the written melody one eighth note later, softer, cut at the bar end;
    - third: under each melody note, the highest chord tone at least 3 semitones below it.

    Every note is then folded by octaves into the pulse range.

    >>> from leadsheet.model import ChordSegment
    >>> c = ChordSegment("C", 0, (0, 4, 7), 0.0, 2.0)
    >>> g = ChordSegment("G", 7, (7, 11, 2), 2.0, 2.0)
    >>> bar = Bar(0, (), (c, g), "A", "verse", 0, False)
    >>> [(note.pitch, note.onset) for note in realize_p2(bar, P2_TEXTURES.index("hold"))]
    [(48, 0.0), (55, 2.0)]
    >>> [note.pitch for note in realize_p2(bar, P2_TEXTURES.index("arp16"))][:4]
    [48, 52, 55, 48]
    """
    texture = P2_TEXTURES[texture_gene]
    if texture == "hold":
        notes = _p2_hold(bar)
    elif texture == "arp16":
        notes = _p2_arpeggio(bar, SIXTEENTH)
    elif texture == "arp32":
        notes = _p2_arpeggio(bar, THIRTY_SECOND)
    elif texture == "echo":
        notes = _p2_echo(bar)
    else:  # "third"
        notes = _p2_third(bar)
    low, high = PITCH_RANGES["P2"]
    return tuple(replace(note, pitch=_fold_into_range(note.pitch, low, high)) for note in notes)


# --- TR: the bass texture --------------------------------------------------------------------


def _bass_root(chord: ChordSegment) -> int:
    return _place_in_register(chord.root, TR_ROOT_LOW)


def _bass_third(chord: ChordSegment) -> int:
    return _chord_tone_above(_bass_root(chord), chord, 1, fallback=MAJOR_THIRD)


def _bass_fifth(chord: ChordSegment) -> int:
    return _chord_tone_above(_bass_root(chord), chord, 2, fallback=PERFECT_FIFTH)


def _quarter_notes(pitches: list[int]) -> list[ChannelNote]:
    return [
        ChannelNote(pitch, beat * QUARTER, QUARTER, VELOCITY_TR)
        for beat, pitch in enumerate(pitches)
    ]


def _tr_root(bar: Bar) -> list[ChannelNote]:
    return [
        ChannelNote(_bass_root(chord), chord.onset, chord.duration, VELOCITY_TR)
        for chord in bar.chords
    ]


def _tr_octave_pump(bar: Bar) -> list[ChannelNote]:
    notes = []
    for eighth in range(8):
        onset = eighth * EIGHTH
        # Even eighths play the root and odd eighths jump an octave up: the bouncing NES bass.
        pitch = _bass_root(bar.chord_at(onset)) + (OCTAVE if eighth % 2 else 0)
        notes.append(ChannelNote(pitch, onset, EIGHTH, VELOCITY_TR))
    return notes


def _tr_root_fifth(bar: Bar) -> list[ChannelNote]:
    chords = [bar.chord_at(beat * QUARTER) for beat in range(4)]
    return _quarter_notes(
        [
            _bass_root(chords[0]),
            _bass_fifth(chords[1]),
            _bass_root(chords[2]),
            _bass_fifth(chords[3]),
        ]
    )


def _tr_walking(bar: Bar, next_bar: Bar | None) -> list[ChannelNote]:
    chords = [bar.chord_at(beat * QUARTER) for beat in range(4)]
    # Beat 4 is a chromatic approach: one semitone below the root that the next bar starts on.
    # The last bar of the piece has no next root to lead to, so it repeats the fifth.
    approach = _bass_fifth(chords[3]) if next_bar is None else _bass_root(next_bar.chords[0]) - 1
    return _quarter_notes(
        [_bass_root(chords[0]), _bass_third(chords[1]), _bass_fifth(chords[2]), approach]
    )


def realize_tr(bar: Bar, texture_gene: int, next_bar: Bar | None) -> tuple[ChannelNote, ...]:
    """Play the TR bass texture the gene selects (an index into `TR_TEXTURES`).

    Roots are placed in the bass register 28-39, and each note uses the chord in effect at its
    onset. The triangle has no volume control, so every note has the same velocity.

    - root: the root, sustained for each chord segment;
    - octave_pump: eighth notes alternating the root and the root one octave up;
    - root_fifth: quarter notes root, fifth, root, fifth;
    - walking: quarter notes root, third, fifth, then one semitone below the root of `next_bar`
      (the fifth again when `next_bar` is None, at the end of the piece).

    >>> from leadsheet.model import ChordSegment
    >>> c = ChordSegment("C", 0, (0, 4, 7), 0.0, 4.0)
    >>> g = ChordSegment("G", 7, (7, 11, 2), 0.0, 4.0)
    >>> c_bar = Bar(0, (), (c,), "A", "verse", 0, False)
    >>> g_bar = Bar(1, (), (g,), "A", "verse", 0, False)
    >>> [note.pitch for note in realize_tr(c_bar, TR_TEXTURES.index("walking"), g_bar)]
    [36, 40, 43, 30]
    """
    texture = TR_TEXTURES[texture_gene]
    if texture == "root":
        notes = _tr_root(bar)
    elif texture == "octave_pump":
        notes = _tr_octave_pump(bar)
    elif texture == "root_fifth":
        notes = _tr_root_fifth(bar)
    else:  # "walking"
        notes = _tr_walking(bar, next_bar)
    return tuple(notes)


# --- NO: the drum pattern --------------------------------------------------------------------

STEPS_PER_BAR = 16
EVERY_BEAT = range(0, STEPS_PER_BAR, 4)
EVERY_EIGHTH = range(0, STEPS_PER_BAR, 2)
EVERY_SIXTEENTH = range(STEPS_PER_BAR)

# The sixteenth-note steps of each drum in each pattern, written as a drummer thinks of them
# ("hi-hat on every eighth"). Where drums share a step, `_DRUM_PRIORITY` decides who plays.
_DRUM_STEPS: dict[str, dict[int, tuple[int, ...] | range]] = {
    "none": {},
    "half_time": {KICK: (0,), SNARE: (8,), HIHAT: EVERY_BEAT},
    "eighth_beat": {KICK: (0, 8), SNARE: (4, 12), HIHAT: EVERY_EIGHTH},
    "sixteenth_beat": {KICK: (0, 8, 11), SNARE: (4, 12), HIHAT: EVERY_SIXTEENTH},
    # The eighth beat for three beats, then a snare roll on the fourth beat leads into the next bar.
    "fill": {KICK: (0, 8), SNARE: (4, 12, 13, 14, 15), HIHAT: range(0, 12, 2)},
}

# The noise channel sounds one hit at a time: the kick wins over the snare, the snare over the
# hi-hat, as a drummer would drop the hi-hat to play the accented drum.
_DRUM_PRIORITY = (KICK, SNARE, HIHAT)


def realize_no(pattern_gene: int) -> tuple[ChannelNote, ...]:
    """Play the NO drum pattern the gene selects (an index into `NO_PATTERNS`).

    The bar is a grid of 16 sixteenth-note steps; each hit lasts one step.

    - none: silence;
    - half_time: kick on beat 1, snare on beat 3, hi-hat on beats 2 and 4;
    - eighth_beat: kick on beats 1 and 3, snare on 2 and 4, hi-hat on the off-beat eighths;
    - sixteenth_beat: kick on beats 1 and 3 and the last sixteenth of beat 3, snare on 2 and 4,
      hi-hat on every other sixteenth;
    - fill: the eighth beat for three beats, then four snare sixteenths.

    >>> [(note.onset, note.pitch) for note in realize_no(NO_PATTERNS.index("half_time"))]
    [(0.0, 36), (1.0, 42), (2.0, 38), (3.0, 42)]
    """
    drum_steps = _DRUM_STEPS[NO_PATTERNS[pattern_gene]]
    notes = []
    for step in range(STEPS_PER_BAR):
        drums_on_step = [drum for drum in _DRUM_PRIORITY if step in drum_steps.get(drum, ())]
        if drums_on_step:
            drum = drums_on_step[0]
            notes.append(ChannelNote(drum, step * SIXTEENTH, SIXTEENTH, DRUM_VELOCITY[drum]))
    return tuple(notes)
