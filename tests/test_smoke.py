import music21
import pretty_midi


def test_music21_reads_back_the_note_that_pretty_midi_wrote(tmp_path):
    """pretty_midi writes a MIDI file that music21 reads back."""
    midi = pretty_midi.PrettyMIDI()
    piano = pretty_midi.Instrument(program=0)
    piano.notes.append(pretty_midi.Note(velocity=100, pitch=60, start=0.0, end=0.5))
    midi.instruments.append(piano)
    path = tmp_path / "c4.mid"
    midi.write(str(path))

    score = music21.converter.parse(path)

    assert [note.pitch.midi for note in score.flatten().notes] == [60]
