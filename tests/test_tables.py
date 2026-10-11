import numpy as np

from ga.genome import NO_PATTERNS, P2_TEXTURES, TR_TEXTURES
from ga.tables import build_tables
from leadsheet.model import Bar, ChordSegment, LeadSheet, MelodyNote

C = ChordSegment("C", 0, (0, 4, 7), 0.0, 4.0)
C_HALF = ChordSegment("C", 0, (0, 4, 7), 0.0, 2.0)
G_HALF = ChordSegment("G", 7, (7, 11, 2), 2.0, 2.0)


def two_bar_lead_sheet() -> LeadSheet:
    quarters = tuple(MelodyNote(72, float(beat), 1.0) for beat in range(4))
    whole = (MelodyNote(74, 0.0, 4.0),)
    verse = Bar(0, quarters, (C,), "A", "verse", 0, False)
    chorus = Bar(1, whole, (C_HALF, G_HALF), "B", "chorus", 0, True)
    return LeadSheet("two bars", "c major", 120.0, (verse, chorus))


def test_tables_have_one_entry_per_bar_and_gene_value():
    tables = build_tables(two_bar_lead_sheet())
    assert tables.act_p1.shape == (2, 3)
    assert tables.act_p2.shape == (2, 5)
    assert tables.act_tr.shape == (2, 4)
    assert tables.act_no.shape == (5,)
    assert tables.reg_both.shape == tables.reg_ok.shape == (2, 3, 5)
    assert tables.bass_smooth.shape == (1, 4, 4)


def test_activity_counts_onsets_per_bar_over_sixteen():
    tables = build_tables(two_bar_lead_sheet())
    assert tables.act_p1[0, 0] == 4 / 16
    assert tables.act_p1[1, 0] == 1 / 16
    for texture in ("arp16", "arp32"):
        assert (tables.act_p2[:, P2_TEXTURES.index(texture)] == 1.0).all()
    assert tables.act_no[NO_PATTERNS.index("none")] == 0.0
    assert tables.act_no[NO_PATTERNS.index("sixteenth_beat")] == 1.0
    assert tables.act_tr[0, TR_TEXTURES.index("octave_pump")] == 8 / 16


def test_register_counts_sixteenth_steps_where_p2_sounds_below_p1():
    tables = build_tables(two_bar_lead_sheet())
    hold = P2_TEXTURES.index("hold")
    # The melody (C5 = 72) and the held root (C3 = 48) sound on all 16 steps of bar 0.
    assert tables.reg_both[0, 0, hold] == 16
    assert tables.reg_ok[0, 0, hold] == 16
    # One octave down the melody is C4 = 60, still above the root.
    assert tables.reg_ok[0, 2, hold] == 16


def test_bass_smoothness_scores_the_leap_between_bars():
    tables = build_tables(two_bar_lead_sheet())
    root = TR_TEXTURES.index("root")
    # Bar 0 ends on C (36) and bar 1 starts on C (36): no leap.
    assert tables.bass_smooth[0, root, root] == 1.0
    assert ((tables.bass_smooth >= 0) & (tables.bass_smooth <= 1)).all()


def test_bar_facts_come_from_the_lead_sheet():
    tables = build_tables(two_bar_lead_sheet())
    assert tables.single_chord.tolist() == [True, False]
    assert tables.is_chorus.tolist() == [False, True]
    assert tables.phrase_end.tolist() == [False, True]
    assert np.array_equal(tables.phrase, [0, 0])
