import music21
import pretty_midi

from arrangement.model import Arrangement, ChannelNote
from export.midi import arrangement_to_midi, write_midi


def small_arrangement() -> Arrangement:
    melody = (ChannelNote(76, 0.0, 1.0, 100), ChannelNote(71, 1.0, 0.5, 100))
    return Arrangement(
        title="test",
        tempo_bpm=120.0,
        genome=((0, 0, 0, 0),),
        channels={
            "P1": melody,
            "P2": (ChannelNote(57, 0.0, 2.0, 80),),
            "TR": (ChannelNote(33, 0.0, 4.0, 90),),
            "NO": (ChannelNote(36, 0.0, 0.25, 100), ChannelNote(38, 1.0, 0.25, 90)),
        },
    )


def test_midi_has_one_named_instrument_per_nes_channel():
    midi = arrangement_to_midi(small_arrangement())
    names = [inst.name for inst in midi.instruments]
    assert names == ["P1", "P2", "TR", "NO"]
    programs = {inst.name: inst.program for inst in midi.instruments}
    assert programs["P1"] == 80 and programs["P2"] == 80 and programs["TR"] == 38
    assert [inst.is_drum for inst in midi.instruments] == [False, False, False, True]


def test_beats_become_seconds_only_at_export():
    midi = arrangement_to_midi(small_arrangement())
    p1 = midi.instruments[0].notes
    # At 120 BPM a beat lasts 0.5 s.
    assert (p1[1].start, p1[1].end) == (0.5, 0.75)


def test_music21_reads_back_the_melody_written_to_the_file(tmp_path):
    path = tmp_path / "piece.mid"
    write_midi(small_arrangement(), path)
    assert pretty_midi.PrettyMIDI(str(path)).instruments[0].name == "P1"
    score = music21.converter.parse(path)
    melody_part = next(p for p in score.parts if p.partName == "P1")
    assert [n.pitch.midi for n in melody_part.flatten().notes] == [76, 71]
