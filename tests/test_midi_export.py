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


# --- meters (spec 003, research R11) ---------------------------------------------------------


def signatures(midi):
    return [(ts.numerator, ts.denominator, ts.time) for ts in midi.time_signature_changes]


def test_an_all_four_four_arrangement_declares_one_four_four_time_signature():
    assert signatures(arrangement_to_midi(small_arrangement())) == [(4, 4, 0.0)]


def test_the_midi_file_declares_the_first_meter_and_each_change():
    from dataclasses import replace

    from leadsheet.meter import parse_meter

    meters = tuple(parse_meter(text) for text in ("3/4", "3/4", "2/4", "4/4", "4/4"))
    arrangement = replace(small_arrangement(), meters=meters)

    # At 120 BPM a beat lasts 0.5 s: the 2/4 bar starts on beat 6 (3 s), 4/4 on beat 8 (4 s).
    assert signatures(arrangement_to_midi(arrangement)) == [(3, 4, 0.0), (2, 4, 3.0), (4, 4, 4.0)]


def test_a_sample_reruns_to_the_same_midi_bytes(tmp_path):
    import json
    from pathlib import Path

    import numpy as np

    from arrangement.assemble import assemble
    from leadsheet.abc_reader import read_lead_sheet

    root = Path(__file__).resolve().parent.parent
    sample = root / "samples" / "korobeiniki-s1"
    plan = np.array(json.loads((sample / "metrics.json").read_text())["genome"])
    lead_sheet = read_lead_sheet(root / "data" / "leadsheets" / "korobeiniki.abc")

    write_midi(assemble(lead_sheet, plan), tmp_path / "piece.mid")

    assert (tmp_path / "piece.mid").read_bytes() == (sample / "piece.mid").read_bytes()
