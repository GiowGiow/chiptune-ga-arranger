"""Executable specification of the NES rules checked before export.

The lead sheet has two bars: C for the whole first bar, then F and Am for half a bar each. Every
test starts from a valid arrangement and breaks exactly one rule, so it expects exactly one
message, naming the channel and the bar (counted from 1).
"""

from arrangement.model import KICK, SNARE, Arrangement, ChannelNote
from arrangement.validation import find_violations
from ga.genome import P2_TEXTURES
from leadsheet.model import Bar, ChordSegment, LeadSheet

C = ChordSegment("C", 0, (0, 4, 7), 0.0, 4.0)
F = ChordSegment("F", 5, (5, 9, 0), 0.0, 2.0)
AM = ChordSegment("Am", 9, (9, 0, 4), 2.0, 2.0)

LEAD_SHEET = LeadSheet(
    title="Test tune",
    key="C major",
    tempo_bpm=120.0,
    bars=(
        Bar(0, (), (C,), "A", "verse", 0, False),
        Bar(1, (), (F, AM), "A", "verse", 0, True),
    ),
)

HOLD = P2_TEXTURES.index("hold")
ECHO = P2_TEXTURES.index("echo")


def notes(*pitch_onset_duration):
    """Channel notes from (pitch, absolute onset, duration) triples."""
    return tuple(
        ChannelNote(pitch, onset, duration, 80) for pitch, onset, duration in pitch_onset_duration
    )


VALID_CHANNELS = {
    "P1": notes((60, 0, 2), (64, 2, 2), (65, 4, 2), (69, 6, 2)),
    "P2": notes((48, 0, 4), (53, 4, 2), (57, 6, 2)),
    "TR": notes((36, 0, 2), (43, 2, 2), (29, 4, 2), (33, 6, 2)),
    "NO": notes((KICK, 0, 0.25), (SNARE, 2, 0.25), (KICK, 4, 0.25), (SNARE, 6, 0.25)),
}


def make_arrangement(p2_textures=(HOLD, HOLD), **channels):
    """The valid arrangement, with the given P2 genes and some channels replaced."""
    genome = tuple((p2_texture, 0, 0, 0) for p2_texture in p2_textures)
    return Arrangement("Test tune", 120.0, genome, {**VALID_CHANNELS, **channels})


def test_a_valid_arrangement_has_no_violations():
    assert find_violations(make_arrangement(), LEAD_SHEET) == []


def test_two_overlapping_notes_in_one_channel_are_reported():
    melody = notes((60, 0, 2.5), (64, 2, 2), (65, 4, 2), (69, 6, 2))

    assert find_violations(make_arrangement(P1=melody), LEAD_SHEET) == [
        "P1 bar 1: the note at beat 1 overlaps the next note"
    ]


def test_a_pulse_note_below_midi_33_is_reported():
    melody = notes((60, 0, 2), (64, 2, 2), (32, 4, 2), (69, 6, 2))

    assert find_violations(make_arrangement(P1=melody), LEAD_SHEET) == [
        "P1 bar 2: pitch 32 at beat 1 is outside the range 33-108"
    ]


def test_a_triangle_note_above_midi_108_is_reported():
    bass = notes((36, 0, 1), (109, 1, 1), (43, 2, 2), (29, 4, 2), (33, 6, 2))

    assert find_violations(make_arrangement(TR=bass), LEAD_SHEET) == [
        "TR bar 1: pitch 109 at beat 2 is outside the range 21-108"
    ]


def test_a_bass_note_on_beat_3_outside_the_chord_in_effect_is_reported():
    # F is the chord of beats 1-2 of bar 2, but on beat 3 the chord is Am.
    bass = notes((36, 0, 2), (43, 2, 2), (29, 4, 2), (29, 6, 2))

    assert find_violations(make_arrangement(TR=bass), LEAD_SHEET) == [
        "TR bar 2: pitch 29 at beat 3 is not a chord tone of Am"
    ]


def test_bass_passing_notes_on_beats_2_and_4_are_allowed():
    walking_bass = notes((36, 0, 1), (38, 1, 1), (43, 2, 1), (28, 3, 1), (29, 4, 2), (33, 6, 2))

    assert find_violations(make_arrangement(TR=walking_bass), LEAD_SHEET) == []


def test_a_harmony_note_on_beat_1_outside_the_chord_is_reported_in_a_hold_bar():
    harmony = notes((50, 0, 4), (53, 4, 2), (57, 6, 2))

    assert find_violations(make_arrangement(P2=harmony), LEAD_SHEET) == [
        "P2 bar 1: pitch 50 at beat 1 is not a chord tone of C"
    ]


def test_a_harmony_note_on_beat_1_outside_the_chord_is_allowed_in_an_echo_bar():
    # The echo replays the melody, which may hold a passing tone on any beat.
    harmony = notes((50, 0, 4), (53, 4, 2), (57, 6, 2))

    arrangement = make_arrangement(p2_textures=(ECHO, HOLD), P2=harmony)

    assert find_violations(arrangement, LEAD_SHEET) == []


def test_a_note_that_crosses_its_bar_end_is_reported():
    melody = notes((60, 0, 2), (64, 2, 2.5), (69, 6, 2))

    assert find_violations(make_arrangement(P1=melody), LEAD_SHEET) == [
        "P1 bar 1: the note at beat 3 crosses the bar end"
    ]


def test_a_note_before_the_start_of_the_piece_is_reported():
    drums = notes((KICK, -0.25, 0.25), (SNARE, 2, 0.25), (KICK, 4, 0.25))

    assert find_violations(make_arrangement(NO=drums), LEAD_SHEET) == [
        "NO bar 1: the note at onset -0.25 starts before the piece"
    ]


def test_every_broken_rule_gets_its_own_message():
    bass = notes((36, 0, 2), (109, 2, 3), (29, 4, 2), (33, 6, 2))

    assert find_violations(make_arrangement(TR=bass), LEAD_SHEET) == [
        "TR bar 1: the note at beat 3 overlaps the next note",
        "TR bar 1: pitch 109 at beat 3 is outside the range 21-108",
        "TR bar 1: pitch 109 at beat 3 is not a chord tone of C",
        "TR bar 1: the note at beat 3 crosses the bar end",
    ]
