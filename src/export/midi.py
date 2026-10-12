"""Write an arrangement to a MIDI file.

This is the only place where beats become seconds (seconds = beats x 60 / tempo). Each NES
channel becomes one MIDI track named after it. General MIDI has no chip sounds, so the tracks use
the closest General MIDI timbres: program 80 (Lead 1, square wave) for the two pulse channels,
program 38 (Synth Bass 1) for the triangle bass, and the drum channel for the noise percussion.
The file declares the meter of the first bar and each change of meter, so a notation program
draws the same bar lines as the arranger.
"""

from itertools import accumulate
from pathlib import Path

import pretty_midi

from arrangement.model import CHANNELS, Arrangement
from leadsheet.meter import FOUR_FOUR

GM_PROGRAMS = {"P1": 80, "P2": 80, "TR": 38, "NO": 0}


def arrangement_to_midi(arrangement: Arrangement) -> pretty_midi.PrettyMIDI:
    """Build a 4-track MIDI object (P1, P2, TR, NO) from an arrangement.

    >>> from arrangement.model import ChannelNote
    >>> notes = {"P1": (ChannelNote(72, 1.0, 1.0, 100),), "P2": (), "TR": (), "NO": ()}
    >>> midi = arrangement_to_midi(Arrangement("demo", 120.0, ((0, 0, 0, 0),), notes))
    >>> [i.name for i in midi.instruments], midi.instruments[0].notes[0].start
    (['P1', 'P2', 'TR', 'NO'], 0.5)
    """
    seconds_per_beat = 60.0 / arrangement.tempo_bpm
    midi = pretty_midi.PrettyMIDI(initial_tempo=arrangement.tempo_bpm)
    midi.time_signature_changes += _time_signatures(arrangement, seconds_per_beat)
    for channel in CHANNELS:
        track = pretty_midi.Instrument(
            program=GM_PROGRAMS[channel], is_drum=(channel == "NO"), name=channel
        )
        for note in arrangement.channels.get(channel, ()):
            start = note.onset * seconds_per_beat
            end = (note.onset + note.duration) * seconds_per_beat
            track.notes.append(pretty_midi.Note(note.velocity, note.pitch, start, end))
        midi.instruments.append(track)
    return midi


def write_midi(arrangement: Arrangement, path: Path | str) -> None:
    """Write the arrangement to a standard MIDI file at `path`."""
    arrangement_to_midi(arrangement).write(str(path))


def _time_signatures(
    arrangement: Arrangement, seconds_per_beat: float
) -> list[pretty_midi.TimeSignature]:
    """One time signature at the start and one at each bar whose meter differs from the last.

    An arrangement without meters (built by hand) is 4/4 throughout.
    """
    meters = arrangement.meters or (FOUR_FOUR,)
    starts = [0.0, *accumulate(meter.bar_beats for meter in meters[:-1])]
    changes = []
    for index, (meter, start) in enumerate(zip(meters, starts, strict=True)):
        if index == 0 or meter != meters[index - 1]:
            seconds = start * seconds_per_beat
            changes.append(pretty_midi.TimeSignature(meter.numerator, meter.denominator, seconds))
    return changes
