import itertools

import numpy as np
import pytest

from arrangement.assemble import assemble
from ga.fitness import criterion_scores
from ga.genome import NO_PATTERNS, P2_TEXTURES, TR, TR_TEXTURES, random_population
from ga.tables import build_tables
from leadsheet.abc_reader import read_lead_sheet
from leadsheet.model import Bar, ChordSegment, LeadSheet, MelodyNote

C = ChordSegment("C", 0, (0, 4, 7), 0.0, 4.0)
C_HALF = ChordSegment("C", 0, (0, 4, 7), 0.0, 2.0)
G_HALF = ChordSegment("G", 7, (7, 11, 2), 2.0, 2.0)
E_FLAT = ChordSegment("Eb", 3, (3, 7, 10), 0.0, 4.0)
B_FLAT = ChordSegment("Bb", 10, (10, 2, 5), 0.0, 4.0)

ROOT, OCTAVE_PUMP, ROOT_FIFTH, WALKING = (
    TR_TEXTURES.index(name) for name in ("root", "octave_pump", "root_fifth", "walking")
)


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
    assert tables.bass_inner.shape == tables.bass_inner_leaps.shape == (2, 4)
    assert tables.bass_across.shape == (1, 4, 4)


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


def test_bass_across_scores_the_leap_between_bars():
    tables = build_tables(two_bar_lead_sheet())
    # Bar 0 ends on C (36) and bar 1 starts on C (36): no leap.
    assert tables.bass_across[0, ROOT, ROOT] == 1.0
    # The octave pump of bar 0 ends its line on the root C (36), not on the upper C (48).
    assert tables.bass_across[0, OCTAVE_PUMP, ROOT] == 1.0
    assert ((tables.bass_across >= 0) & (tables.bass_across <= 1)).all()


def test_bass_inner_scores_the_leaps_of_the_line_inside_each_bar():
    tables = build_tables(two_bar_lead_sheet())
    # Bar 0 holds one C: a single note, no leap to score.
    assert np.isnan(tables.bass_inner[0, ROOT])
    assert tables.bass_inner_leaps[0, ROOT] == 0
    # Bar 1 holds C (36) then G (31): one leap of a fourth down, which scores 1.
    assert tables.bass_inner[1, ROOT] == 1.0
    assert tables.bass_inner_leaps[1, ROOT] == 1
    # Root-fifth on C plays C G C G (36 43 36 43): three leaps of 7 semitones, each (12 - 7) / 7.
    assert tables.bass_inner[0, ROOT_FIFTH] == pytest.approx(5 / 7)
    assert tables.bass_inner_leaps[0, ROOT_FIFTH] == 3
    # The pump's line is its four roots on the beats, C C C C: three leaps of 0.
    assert tables.bass_inner[0, OCTAVE_PUMP] == 1.0
    assert tables.bass_inner_leaps[0, OCTAVE_PUMP] == 3


def whole_bar_chords(*chords: ChordSegment) -> LeadSheet:
    """One bar per chord, without melody, all in one verse phrase."""
    bars = tuple(
        Bar(index, (), (chord,), "A", "verse", 0, index == len(chords) - 1)
        for index, chord in enumerate(chords)
    )
    return LeadSheet("chords", "c major", 120.0, bars)


def bass_smoothness(lead_sheet: LeadSheet, tr_textures: list[int]) -> float:
    plan = np.zeros((1, len(tr_textures), 4), dtype=int)
    plan[0, :, TR] = tr_textures
    return float(criterion_scores(build_tables(lead_sheet), plan)["bass_smoothness"][0])


def test_bass_smoothness_penalizes_the_leap_inside_a_walking_bar():
    # Walking on Eb plays Eb (39), G (43), Bb (46), then A (33), one semitone below the next
    # root Bb (34). The drop of 13 semitones inside the bar scores 0; the other leaps score 1.
    score = bass_smoothness(whole_bar_chords(E_FLAT, B_FLAT), [WALKING, ROOT])

    assert score == pytest.approx(3 / 4)


def test_the_octave_pump_is_not_penalized_for_its_own_octave():
    # The upper Cs (48) ornament the line C C C C | C C C C, which never leaps.
    assert bass_smoothness(whole_bar_chords(C, C), [OCTAVE_PUMP, OCTAVE_PUMP]) == 1.0


def test_bar_facts_come_from_the_lead_sheet():
    tables = build_tables(two_bar_lead_sheet())
    assert tables.single_chord.tolist() == [True, False]
    assert tables.is_chorus.tolist() == [False, True]
    assert tables.phrase_end.tolist() == [False, True]
    assert np.array_equal(tables.phrase, [0, 0])


# --- the tables against the notes -------------------------------------------------------------


def notes_of_bar(notes, bar: int) -> list[tuple[int, float, float]]:
    """(pitch, onset, duration) of the notes that start in `bar`, onsets from the bar start."""
    start = 4.0 * bar
    return [(n.pitch, n.onset - start, n.duration) for n in notes if start <= n.onset < start + 4]


def activity(bar_notes) -> float:
    return min(1.0, len(bar_notes) / 16)


def sounding(bar_notes, step: int) -> int | None:
    """The pitch sounding at the start of sixteenth step `step`, or None."""
    for pitch, onset, duration in bar_notes:
        if onset <= step * 0.25 + 1e-9 < onset + duration:
            return pitch
    return None


def leap_score(leap: int) -> float:
    return min(1.0, max(0.0, (12 - leap) / 7))


def slow_scores(lead_sheet: LeadSheet, genome: np.ndarray) -> dict[str, float]:
    """Four criteria computed directly from the notes of the assembled arrangement."""
    channels = assemble(lead_sheet, genome).channels
    bars = range(len(lead_sheet.bars))
    p1, p2, tr, no = (
        [notes_of_bar(channels[c], b) for b in bars] for c in ("P1", "P2", "TR", "NO")
    )

    complementarity = np.mean([1 - abs(activity(p2[b]) - (1 - activity(p1[b]))) for b in bars])

    both = p2_below = 0
    for b in bars:
        for step in range(16):
            melody, harmony = sounding(p1[b], step), sounding(p2[b], step)
            if melody is not None and harmony is not None:
                both += 1
                p2_below += harmony < melody
    register = p2_below / both if both else 1.0

    density = np.array([(activity(p2[b]) + activity(tr[b]) + activity(no[b])) / 3 for b in bars])
    chorus = np.array([bar.role == "chorus" for bar in lead_sheet.bars])
    contrast = min(1.0, max(0.0, 0.5 + density[chorus].mean() - density[~chorus].mean()))

    # The bass line of the whole piece; the pump adds only its roots (every other note).
    line = []
    for b in bars:
        pitches = [pitch for pitch, _, _ in tr[b]]
        line += pitches[::2] if genome[b, TR] == OCTAVE_PUMP else pitches
    bass_smoothness = np.mean([leap_score(abs(a - b)) for a, b in itertools.pairwise(line)])

    return {
        "complementarity": complementarity,
        "register": register,
        "contrast": contrast,
        "bass_smoothness": bass_smoothness,
    }


@pytest.mark.parametrize("tune", ["ievan_polkka", "korobeiniki"])
def test_score_tables_match_the_arranged_notes(tune):
    lead_sheet = read_lead_sheet(f"data/leadsheets/{tune}.abc")
    population = random_population(np.random.default_rng(0), 20, len(lead_sheet.bars))

    fast = criterion_scores(build_tables(lead_sheet), population)

    for plan, genome in enumerate(population):
        for name, slow in slow_scores(lead_sheet, genome).items():
            assert fast[name][plan] == pytest.approx(slow, abs=1e-9), (name, plan)
