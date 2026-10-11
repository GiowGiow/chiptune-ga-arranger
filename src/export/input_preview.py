"""The input, made audible, for side-by-side comparison with the 8-bit arrangement.

For an ABC lead sheet, the input is played plainly: the melody on a piano, each chord as a block
and its root in the bass, written as MIDI. For a MIDI song, the input is the original file itself,
rendered whole and cut to the same bars, so that its volumes, pitch bends and effects stay as the
author set them. Both use the same General MIDI soundfont, so the reader can hear what the
genetic algorithm started from.
"""

from pathlib import Path

import pretty_midi

from leadsheet.model import LeadSheet

PIANO, ACOUSTIC_BASS = 0, 32


def lead_sheet_to_midi(lead_sheet: LeadSheet) -> pretty_midi.PrettyMIDI:
    """Play a lead sheet plainly: melody, block chords (from C4) and the root in the bass (C2)."""
    seconds_per_beat = 60.0 / lead_sheet.tempo_bpm
    midi = pretty_midi.PrettyMIDI(initial_tempo=lead_sheet.tempo_bpm)
    melody = pretty_midi.Instrument(PIANO, name="melody")
    chords = pretty_midi.Instrument(PIANO, name="chords")
    bass = pretty_midi.Instrument(ACOUSTIC_BASS, name="bass")
    for bar in lead_sheet.bars:
        bar_start = bar.index * lead_sheet.beats_per_bar
        for note in bar.melody:
            start = (bar_start + note.onset) * seconds_per_beat
            end = (bar_start + note.onset + note.duration) * seconds_per_beat
            melody.notes.append(pretty_midi.Note(100, note.pitch, start, end))
        for segment in bar.chords:
            start = (bar_start + segment.onset) * seconds_per_beat
            end = (bar_start + segment.onset + segment.duration) * seconds_per_beat
            for tone in segment.tones[:3]:
                chords.notes.append(pretty_midi.Note(60, 60 + tone, start, end))
            bass.notes.append(pretty_midi.Note(80, 36 + segment.root, start, end))
    midi.instruments += [melody, chords, bass]
    return midi


def excerpt_seconds(
    path: Path | str, source_grid: tuple[float, float], bars: tuple[int, int] | None
) -> tuple[float, float]:
    """Return the start and end, in seconds, of a bar excerpt of a MIDI recording.

    `source_grid` is the (tempo, first downbeat) grid on which the song was read; a grid with
    downbeat 0.0 is the file's own tick grid. Without `bars`, the whole file is used.
    """
    source = pretty_midi.PrettyMIDI(str(path))
    if bars is None:
        return 0.0, source.get_end_time()
    bpm, downbeat = source_grid
    if downbeat == 0.0 and bpm == float(source.get_tempo_changes()[1][0]):
        start = source.tick_to_time(bars[0] * 4 * source.resolution)
        end = source.tick_to_time(bars[1] * 4 * source.resolution)
        return start, end
    seconds_per_bar = 4 * 60.0 / bpm
    return downbeat + bars[0] * seconds_per_bar, downbeat + bars[1] * seconds_per_bar
