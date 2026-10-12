"""Executable specification of the texture realizers.

Each realizer turns one gene value of one bar into concrete notes for one NES channel. The bars
below are built by hand so that every expected pitch can be checked with a pencil.
"""

import json
from functools import partial
from pathlib import Path

import pytest

from arrangement.model import (
    DRUM_VELOCITY,
    HIHAT,
    KICK,
    PITCH_RANGES,
    SNARE,
    VELOCITY_ECHO,
    VELOCITY_P1,
    VELOCITY_P2,
    VELOCITY_TR,
    ChannelNote,
)
from arrangement.textures import realize_no, realize_p1, realize_p2, realize_tr
from ga.genome import NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES
from leadsheet.abc_reader import read_lead_sheet
from leadsheet.meter import parse_meter
from leadsheet.model import Bar, ChordSegment, MelodyNote

C_WHOLE_BAR = ChordSegment("C", 0, (0, 4, 7), 0.0, 4.0)
G_WHOLE_BAR = ChordSegment("G", 7, (7, 11, 2), 0.0, 4.0)
C_FIRST_HALF = ChordSegment("C", 0, (0, 4, 7), 0.0, 2.0)
G_SECOND_HALF = ChordSegment("G", 7, (7, 11, 2), 2.0, 2.0)


def make_bar(chords, melody=()):
    """A verse bar with the given chord segments and (pitch, onset, duration) melody notes."""
    return Bar(
        index=0,
        melody=tuple(MelodyNote(*note) for note in melody),
        chords=tuple(chords),
        label="A",
        role="verse",
        phrase=0,
        phrase_end=False,
    )


def p2(bar, texture):
    return realize_p2(bar, P2_TEXTURES.index(texture))


def tr(bar, texture, next_bar=None):
    return realize_tr(bar, TR_TEXTURES.index(texture), next_bar)


def pitches(notes):
    return [note.pitch for note in notes]


def onsets(notes):
    return [note.onset for note in notes]


# --- P1: the melody --------------------------------------------------------------------------

MELODY = ((60, 0.0, 1.0), (62, 1.0, 1.0), (64, 2.0, 2.0))


@pytest.mark.parametrize("octave_gene", [0, 1, 2])
def test_p1_plays_the_melody_rhythm_shifted_by_the_octave_gene(octave_gene):
    shift = P1_OCTAVES[octave_gene]
    bar = make_bar([C_WHOLE_BAR], MELODY)

    assert realize_p1(bar, octave_gene) == (
        ChannelNote(60 + shift, 0.0, 1.0, VELOCITY_P1),
        ChannelNote(62 + shift, 1.0, 1.0, VELOCITY_P1),
        ChannelNote(64 + shift, 2.0, 2.0, VELOCITY_P1),
    )


def test_p1_folds_notes_pushed_above_the_pulse_range_back_down_by_octaves():
    bar = make_bar([C_WHOLE_BAR], [(100, 0.0, 2.0), (52, 2.0, 2.0)])

    assert pitches(realize_p1(bar, P1_OCTAVES.index(12))) == [100, 64]


def test_p1_folds_notes_pushed_below_the_pulse_range_back_up_by_octaves():
    bar = make_bar([C_WHOLE_BAR], [(40, 0.0, 2.0), (64, 2.0, 2.0)])

    assert pitches(realize_p1(bar, P1_OCTAVES.index(-12))) == [40, 52]


# --- P2: the harmony texture -----------------------------------------------------------------


def test_p2_hold_sustains_the_root_of_each_chord_segment():
    bar = make_bar([C_FIRST_HALF, G_SECOND_HALF])

    assert p2(bar, "hold") == (
        ChannelNote(48, 0.0, 2.0, VELOCITY_P2),
        ChannelNote(55, 2.0, 2.0, VELOCITY_P2),
    )


@pytest.mark.parametrize(("root", "expected_pitch"), [(0, 48), (7, 55), (9, 57), (11, 59)])
def test_p2_places_every_chord_root_between_48_and_59(root, expected_pitch):
    bar = make_bar([ChordSegment("X", root, (root,), 0.0, 4.0)])

    assert pitches(p2(bar, "hold")) == [expected_pitch]


def test_p2_arp16_over_c_major_cycles_48_52_55_on_every_sixteenth_note():
    notes = p2(make_bar([C_WHOLE_BAR]), "arp16")

    assert len(notes) == 16
    assert pitches(notes) == [48, 52, 55] * 5 + [48]
    assert onsets(notes) == [0.25 * step for step in range(16)]
    assert all(note.duration == 0.25 and note.velocity == VELOCITY_P2 for note in notes)


def test_p2_arpeggio_restarts_from_the_root_at_a_chord_change():
    notes = p2(make_bar([C_FIRST_HALF, G_SECOND_HALF]), "arp16")

    assert pitches(notes) == [48, 52, 55, 48, 52, 55, 48, 52, 55, 59, 62, 55, 59, 62, 55, 59]


def test_p2_arpeggio_includes_the_seventh_when_the_chord_has_one():
    c7 = ChordSegment("C7", 0, (0, 4, 7, 10), 0.0, 4.0)

    assert pitches(p2(make_bar([c7]), "arp16"))[:8] == [48, 52, 55, 58, 48, 52, 55, 58]


def test_p2_arpeggio_clips_the_last_note_of_a_segment_at_the_segment_end():
    short_c = ChordSegment("C", 0, (0, 4, 7), 0.0, 0.375)
    long_g = ChordSegment("G", 7, (7, 11, 2), 0.375, 3.625)
    notes = p2(make_bar([short_c, long_g]), "arp16")

    assert notes[:3] == (
        ChannelNote(48, 0.0, 0.25, VELOCITY_P2),
        ChannelNote(52, 0.25, 0.125, VELOCITY_P2),
        ChannelNote(55, 0.375, 0.25, VELOCITY_P2),
    )
    assert len(notes) == 2 + 15
    assert notes[-1] == ChannelNote(62, 3.875, 0.125, VELOCITY_P2)


def test_p2_arp32_plays_32_notes_one_every_thirty_second_note():
    notes = p2(make_bar([C_WHOLE_BAR]), "arp32")

    assert len(notes) == 32
    assert pitches(notes) == ([48, 52, 55] * 11)[:32]
    assert onsets(notes) == [0.125 * step for step in range(32)]


def test_p2_echo_repeats_the_melody_an_eighth_later_softer_and_cut_at_the_bar_end():
    melody = [(60, 0.0, 1.0), (64, 1.0, 1.0), (67, 2.0, 1.75), (72, 3.75, 0.25)]

    assert p2(make_bar([C_WHOLE_BAR], melody), "echo") == (
        ChannelNote(60, 0.5, 1.0, VELOCITY_ECHO),
        ChannelNote(64, 1.5, 1.0, VELOCITY_ECHO),
        ChannelNote(67, 2.5, 1.5, VELOCITY_ECHO),
    )


def test_p2_third_plays_the_highest_chord_tone_at_least_3_semitones_below_each_melody_note():
    # E4 over C -> C4, G4 -> E4, C5 -> G4; D5 over G -> B4. Beat 4 is a melody rest.
    melody = [(64, 0.0, 1.0), (67, 1.0, 0.5), (72, 1.5, 0.5), (74, 2.0, 1.0)]

    assert p2(make_bar([C_FIRST_HALF, G_SECOND_HALF], melody), "third") == (
        ChannelNote(60, 0.0, 1.0, VELOCITY_P2),
        ChannelNote(64, 1.0, 0.5, VELOCITY_P2),
        ChannelNote(67, 1.5, 0.5, VELOCITY_P2),
        ChannelNote(71, 2.0, 1.0, VELOCITY_P2),
    )


def test_p2_folds_notes_below_the_pulse_range_up_by_octaves():
    # Under a low melody, the third (G1 = 31) and the echo (F#1 = 30) fall below 33.
    low_bar = make_bar([C_WHOLE_BAR], [(35, 0.0, 1.0), (30, 1.0, 1.0)])

    assert pitches(p2(low_bar, "third"))[0] == 43
    assert pitches(p2(low_bar, "echo"))[1] == 42


# --- TR: the bass texture --------------------------------------------------------------------


def test_tr_root_sustains_the_root_of_each_chord_segment_between_28_and_39():
    bar = make_bar([C_FIRST_HALF, G_SECOND_HALF])

    assert tr(bar, "root") == (
        ChannelNote(36, 0.0, 2.0, VELOCITY_TR),
        ChannelNote(31, 2.0, 2.0, VELOCITY_TR),
    )


def test_tr_octave_pump_alternates_the_root_and_its_upper_octave_on_eighth_notes():
    notes = tr(make_bar([C_FIRST_HALF, G_SECOND_HALF]), "octave_pump")

    assert pitches(notes) == [36, 48, 36, 48, 31, 43, 31, 43]
    assert onsets(notes) == [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]
    assert all(note.duration == 0.5 for note in notes)


def test_tr_root_fifth_plays_root_fifth_root_fifth_on_quarter_notes():
    notes = tr(make_bar([C_WHOLE_BAR]), "root_fifth")

    assert pitches(notes) == [36, 43, 36, 43]
    assert onsets(notes) == [0.0, 1.0, 2.0, 3.0]
    assert all(note.duration == 1.0 for note in notes)


def test_tr_root_fifth_follows_the_chord_in_effect_on_each_beat():
    assert pitches(tr(make_bar([C_FIRST_HALF, G_SECOND_HALF]), "root_fifth")) == [36, 43, 31, 38]


def test_tr_root_fifth_uses_a_perfect_fifth_when_the_chord_has_no_fifth():
    bare_root = ChordSegment("C", 0, (0,), 0.0, 4.0)

    assert pitches(tr(make_bar([bare_root]), "root_fifth")) == [36, 43, 36, 43]


def test_tr_walking_approaches_the_next_bar_root_from_one_semitone_below():
    # The next bar's G root sits at 31 in the bass register, so the approach note is 30.
    notes = tr(make_bar([C_WHOLE_BAR]), "walking", next_bar=make_bar([G_WHOLE_BAR]))

    assert notes == (
        ChannelNote(36, 0.0, 1.0, VELOCITY_TR),
        ChannelNote(40, 1.0, 1.0, VELOCITY_TR),
        ChannelNote(43, 2.0, 1.0, VELOCITY_TR),
        ChannelNote(30, 3.0, 1.0, VELOCITY_TR),
    )


def test_tr_walking_plays_the_fifth_again_in_the_last_bar():
    assert pitches(tr(make_bar([C_WHOLE_BAR]), "walking", next_bar=None)) == [36, 40, 43, 43]


def test_tr_walking_follows_the_chord_in_effect_on_each_beat():
    bar = make_bar([C_FIRST_HALF, G_SECOND_HALF])

    assert pitches(tr(bar, "walking", next_bar=None)) == [36, 40, 38, 38]


# --- NO: the drum pattern --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("pattern", "expected_hits"),
    [
        ("none", []),
        ("half_time", [(0, KICK), (4, HIHAT), (8, SNARE), (12, HIHAT)]),
        (
            "eighth_beat",
            [
                (0, KICK), (2, HIHAT), (4, SNARE), (6, HIHAT),
                (8, KICK), (10, HIHAT), (12, SNARE), (14, HIHAT),
            ],
        ),
        (
            "sixteenth_beat",
            [
                (0, KICK), (1, HIHAT), (2, HIHAT), (3, HIHAT),
                (4, SNARE), (5, HIHAT), (6, HIHAT), (7, HIHAT),
                (8, KICK), (9, HIHAT), (10, HIHAT), (11, KICK),
                (12, SNARE), (13, HIHAT), (14, HIHAT), (15, HIHAT),
            ],
        ),
        (
            "fill",
            [
                (0, KICK), (2, HIHAT), (4, SNARE), (6, HIHAT),
                (8, KICK), (10, HIHAT), (12, SNARE), (13, SNARE), (14, SNARE), (15, SNARE),
            ],
        ),
    ],
)  # fmt: skip
def test_no_pattern_hits_exactly_its_sixteenth_steps_with_kick_over_snare_over_hihat(
    pattern, expected_hits
):
    notes = realize_no(NO_PATTERNS.index(pattern))

    assert [(round(note.onset / 0.25), note.pitch) for note in notes] == expected_hits


def test_no_hits_last_one_sixteenth_step_at_the_velocity_of_their_drum():
    for note in realize_no(NO_PATTERNS.index("sixteenth_beat")):
        assert note.duration == 0.25
        assert note.velocity == DRUM_VELOCITY[note.pitch]


# --- Every texture: one note at a time, inside the bar, inside the channel range -------------

# Two chords that change off the beat, a seventh chord, a rest and melody notes near both range
# edges: a bar meant to push every realizer to its limits.
BUSY_BAR = make_bar(
    [ChordSegment("C7", 0, (0, 4, 7, 10), 0.0, 1.5), ChordSegment("Am", 9, (9, 0, 4), 1.5, 2.5)],
    [(103, 0.0, 0.5), (34, 0.5, 0.75), (76, 1.5, 1.0), (69, 3.0, 0.75)],
)
NEXT_BAR = make_bar([ChordSegment("Ebm", 3, (3, 6, 10), 0.0, 4.0)])

REALIZATIONS = (
    [
        pytest.param("P1", partial(realize_p1, BUSY_BAR, gene), id=f"P1-octave{octave:+d}")
        for gene, octave in enumerate(P1_OCTAVES)
    ]
    + [
        pytest.param("P2", partial(realize_p2, BUSY_BAR, gene), id=f"P2-{name}")
        for gene, name in enumerate(P2_TEXTURES)
    ]
    + [
        pytest.param("TR", partial(realize_tr, BUSY_BAR, gene, next_bar), id=f"TR-{name}-{when}")
        for gene, name in enumerate(TR_TEXTURES)
        for next_bar, when in ((NEXT_BAR, "inner"), (None, "last"))
    ]
    + [
        pytest.param("NO", partial(realize_no, gene), id=f"NO-{name}")
        for gene, name in enumerate(NO_PATTERNS)
    ]
)


@pytest.mark.parametrize(("channel", "realize"), REALIZATIONS)
def test_every_realizer_plays_one_note_at_a_time_inside_the_bar_and_the_channel_range(
    channel, realize
):
    notes = realize()

    for note, next_note in zip(notes, notes[1:], strict=False):
        assert note.onset + note.duration <= next_note.onset + 1e-9
    for note in notes:
        assert note.onset >= 0.0
        assert note.duration > 0.0
        assert note.onset + note.duration <= 4.0 + 1e-9
    if channel in PITCH_RANGES:
        low, high = PITCH_RANGES[channel]
        assert all(low <= note.pitch <= high for note in notes)


def test_the_triangle_always_plays_at_the_same_velocity():
    for texture in TR_TEXTURES:
        assert {note.velocity for note in tr(BUSY_BAR, texture, NEXT_BAR)} == {VELOCITY_TR}


# --- meters other than 4/4 (spec 003, research R3) ------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
WALTZ = parse_meter("3/4")
C_WALTZ_BAR = ChordSegment("C", 0, (0, 4, 7), 0.0, 3.0)


def meter_bar(meter, chords, melody=()):
    """A verse bar in `meter` with the given chord segments and (pitch, onset, duration) notes."""
    return Bar(
        0, tuple(MelodyNote(*n) for n in melody), tuple(chords), "A", "verse", 0, False, meter
    )


def hits(notes):
    """(onset, drum) of every noise hit, the way a drummer reads a pattern."""
    return [(note.onset, note.pitch) for note in notes]


def as_lists(notes):
    return [[note.pitch, note.onset, note.duration, note.velocity] for note in notes]


def test_every_four_four_realization_is_the_same_as_before_meters_existed():
    lead_sheet = read_lead_sheet(ROOT / "data" / "leadsheets" / "korobeiniki.abc")
    fixture = json.loads(
        (ROOT / "arranger/tests/fixtures/realizations/korobeiniki.json").read_text()
    )
    bars = lead_sheet.bars
    for index, (bar, expected) in enumerate(zip(bars, fixture["bars"], strict=True)):
        next_bar = bars[index + 1] if index + 1 < len(bars) else None
        for gene in range(len(P1_OCTAVES)):
            assert as_lists(realize_p1(bar, gene)) == expected["p1"][gene]
        for gene in range(len(P2_TEXTURES)):
            assert as_lists(realize_p2(bar, gene)) == expected["p2"][gene]
        for gene in range(len(TR_TEXTURES)):
            assert as_lists(realize_tr(bar, gene, next_bar)) == expected["tr"][gene]
    four_four_drums = fixture.get("no") or fixture["bars"][0]["no"]
    for gene in range(len(NO_PATTERNS)):
        assert as_lists(realize_no(gene)) == four_four_drums[gene]


def test_in_three_four_root_fifth_plays_oom_pah_pah():
    notes = realize_tr(meter_bar(WALTZ, [C_WALTZ_BAR]), TR_TEXTURES.index("root_fifth"), None)

    assert [(n.pitch, n.onset, n.duration) for n in notes] == [(36, 0, 1), (43, 1, 1), (43, 2, 1)]


def test_in_three_four_the_walking_bass_plays_root_third_and_the_approach():
    g_bar = meter_bar(WALTZ, [ChordSegment("G", 7, (7, 11, 2), 0.0, 3.0)])

    notes = realize_tr(meter_bar(WALTZ, [C_WALTZ_BAR]), TR_TEXTURES.index("walking"), g_bar)

    assert [(n.pitch, n.onset, n.duration) for n in notes] == [(36, 0, 1), (40, 1, 1), (30, 2, 1)]


def test_in_three_four_the_octave_pump_plays_six_eighths():
    notes = realize_tr(meter_bar(WALTZ, [C_WALTZ_BAR]), TR_TEXTURES.index("octave_pump"), None)

    assert [(n.pitch, n.onset) for n in notes] == [
        (36, 0.0),
        (48, 0.5),
        (36, 1.0),
        (48, 1.5),
        (36, 2.0),
        (48, 2.5),
    ]


def test_in_three_four_the_eighth_beat_is_a_waltz():
    notes = realize_no(NO_PATTERNS.index("eighth_beat"), WALTZ)

    assert hits(notes) == [
        (0.0, KICK),
        (0.5, HIHAT),
        (1.0, SNARE),
        (1.5, HIHAT),
        (2.0, SNARE),
        (2.5, HIHAT),
    ]


def test_in_three_four_the_fill_rolls_the_snare_on_the_last_beat():
    notes = realize_no(NO_PATTERNS.index("fill"), WALTZ)

    assert hits(notes) == [
        (0.0, KICK),
        (0.5, HIHAT),
        (1.0, SNARE),
        (1.5, HIHAT),
        (2.0, SNARE),
        (2.25, SNARE),
        (2.5, SNARE),
        (2.75, SNARE),
    ]


def test_in_three_four_half_time_has_no_snare_and_sixteenth_beat_adds_a_pickup_kick():
    half = realize_no(NO_PATTERNS.index("half_time"), WALTZ)
    sixteenth = realize_no(NO_PATTERNS.index("sixteenth_beat"), WALTZ)

    assert hits(half) == [(0.0, KICK), (1.0, HIHAT), (2.0, HIHAT)]
    assert [n.onset for n in sixteenth if n.pitch == KICK] == [0.0, 0.75]
    assert [n.onset for n in sixteenth if n.pitch == SNARE] == [1.0, 2.0]
    assert len(sixteenth) == 12  # a hit on every sixteenth step


def test_every_drum_hit_keeps_its_velocity_in_any_meter():
    for gene in range(len(NO_PATTERNS)):
        for note in realize_no(gene, WALTZ):
            assert note.velocity == DRUM_VELOCITY[note.pitch]
            assert note.duration == 0.25


def test_in_three_four_the_echo_is_cut_at_the_bar_end():
    bar = meter_bar(WALTZ, [C_WALTZ_BAR], melody=[(72, 0.0, 2.0), (74, 2.0, 1.0)])

    notes = realize_p2(bar, P2_TEXTURES.index("echo"))

    assert [(n.pitch, n.onset, n.duration) for n in notes] == [(72, 0.5, 2.0), (74, 2.5, 0.5)]
    assert all(n.velocity == VELOCITY_ECHO for n in notes)


def test_in_two_four_the_eighth_beat_kicks_on_one_and_snares_on_two():
    notes = realize_no(NO_PATTERNS.index("eighth_beat"), parse_meter("2/4"))

    assert hits(notes) == [(0.0, KICK), (0.5, HIHAT), (1.0, SNARE), (1.5, HIHAT)]


def test_in_cut_time_half_time_is_a_kick_and_a_hi_hat_on_the_half_notes():
    notes = realize_no(NO_PATTERNS.index("half_time"), parse_meter("2/2"))

    assert hits(notes) == [(0.0, KICK), (2.0, HIHAT)]


def test_in_cut_time_root_fifth_plays_half_notes():
    bar = meter_bar(parse_meter("2/2"), [C_WHOLE_BAR])

    notes = realize_tr(bar, TR_TEXTURES.index("root_fifth"), None)

    assert [(n.pitch, n.onset, n.duration, n.velocity) for n in notes] == [
        (36, 0.0, 2.0, VELOCITY_TR),
        (43, 2.0, 2.0, VELOCITY_TR),
    ]


# --- compound meters (spec 003, US2) --------------------------------------------------------

JIG = parse_meter("6/8")
C_JIG_BAR = ChordSegment("C", 0, (0, 4, 7), 0.0, 3.0)


def test_in_six_eight_root_fifth_plays_two_dotted_quarters():
    notes = realize_tr(meter_bar(JIG, [C_JIG_BAR]), TR_TEXTURES.index("root_fifth"), None)

    assert [(n.pitch, n.onset, n.duration) for n in notes] == [(36, 0.0, 1.5), (43, 1.5, 1.5)]


def test_in_six_eight_the_eighth_beat_kicks_on_eighth_one_and_snares_on_eighth_four():
    notes = realize_no(NO_PATTERNS.index("eighth_beat"), JIG)

    assert hits(notes) == [
        (0.0, KICK),
        (0.5, HIHAT),
        (1.0, HIHAT),
        (1.5, SNARE),
        (2.0, HIHAT),
        (2.5, HIHAT),
    ]


def test_in_six_eight_the_walking_bass_plays_the_root_and_the_approach():
    g_bar = meter_bar(JIG, [ChordSegment("G", 7, (7, 11, 2), 0.0, 3.0)])

    notes = realize_tr(meter_bar(JIG, [C_JIG_BAR]), TR_TEXTURES.index("walking"), g_bar)

    assert [(n.pitch, n.onset, n.duration) for n in notes] == [(36, 0.0, 1.5), (30, 1.5, 1.5)]


def test_in_twelve_eight_the_octave_pump_plays_twelve_eighths():
    bar = meter_bar(parse_meter("12/8"), [ChordSegment("C", 0, (0, 4, 7), 0.0, 6.0)])

    notes = realize_tr(bar, TR_TEXTURES.index("octave_pump"), None)

    assert len(notes) == 12
    assert [n.pitch for n in notes[:4]] == [36, 48, 36, 48]


def test_in_nine_eight_the_fill_rolls_on_the_last_dotted_quarter():
    notes = realize_no(NO_PATTERNS.index("fill"), parse_meter("9/8"))

    assert [n.onset for n in notes if n.pitch == SNARE] == [1.5, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25]
    assert [n.onset for n in notes if n.pitch == KICK] == [0.0]


def test_arpeggios_keep_their_subdivisions_in_compound_meters():
    notes = realize_p2(meter_bar(JIG, [C_JIG_BAR]), P2_TEXTURES.index("arp16"))

    assert len(notes) == 12 and all(n.duration == 0.25 for n in notes)


# --- irregular meters (spec 003, US4) -------------------------------------------------------

FIVE = parse_meter("5/4")
SEVEN = parse_meter("7/8")


def test_in_five_four_the_kick_marks_the_three_plus_two_grouping():
    eighth = realize_no(NO_PATTERNS.index("eighth_beat"), FIVE)
    half = realize_no(NO_PATTERNS.index("half_time"), FIVE)

    assert [n.onset for n in eighth if n.pitch == KICK] == [0.0, 3.0]
    assert [n.onset for n in eighth if n.pitch == SNARE] == [1.0, 2.0, 4.0]
    assert [n.onset for n in half if n.pitch == SNARE] == [3.0]


def test_in_seven_eight_the_bass_moves_on_each_group_of_two_two_and_three_eighths():
    bar = meter_bar(SEVEN, [ChordSegment("D", 2, (2, 6, 9), 0.0, 3.5)])

    root_fifth = realize_tr(bar, TR_TEXTURES.index("root_fifth"), None)
    walking = realize_tr(bar, TR_TEXTURES.index("walking"), None)

    assert [(n.pitch, n.onset, n.duration) for n in root_fifth] == [
        (38, 0.0, 1.0),
        (45, 1.0, 1.0),
        (45, 2.0, 1.5),
    ]
    assert [(n.onset, n.duration) for n in walking] == [(0.0, 1.0), (1.0, 1.0), (2.0, 1.5)]
    assert [n.pitch for n in walking] == [38, 42, 45]  # root, third, the fifth to end the piece
