"""Behavior of the fitness criteria and of their weighted mean, on hand-built score tables.

Every test builds a tiny `ScoreTables` (2 to 4 bars) whose numbers make the expected score easy
to compute by hand. A plan is written as one row [p2, tr, no, oct] per bar.
"""

import json
from pathlib import Path

import numpy as np
import pytest

from ga.fitness import CRITERIA, criterion_scores, fitness
from ga.tables import ScoreTables


def make_tables(n_bars: int, **fields: object) -> ScoreTables:
    """Neutral tables for n_bars bars: silent channels, no overlap, one bass note per bar and
    smooth leaps between bars, one verse phrase.

    Keyword arguments replace single fields.
    """
    neutral = {
        "act_p1": np.zeros((n_bars, 3)),
        "act_p2": np.zeros((n_bars, 5)),
        "act_tr": np.zeros((n_bars, 4)),
        "act_no": np.zeros((n_bars, 5)),
        "reg_both": np.zeros((n_bars, 3, 5)),
        "reg_ok": np.zeros((n_bars, 3, 5)),
        "bass_inner": np.full((n_bars, 4), np.nan),
        "bass_inner_leaps": np.zeros((n_bars, 4), dtype=int),
        "bass_across": np.ones((max(n_bars - 1, 0), 4, 4)),
        "single_chord": np.zeros(n_bars, dtype=bool),
        "phrase_end": np.zeros(n_bars, dtype=bool),
        "phrase": np.zeros(n_bars, dtype=int),
        "is_chorus": np.zeros(n_bars, dtype=bool),
    }
    neutral.update(
        {name: np.asarray(value) for name, value in fields.items()}  # lists -> arrays
    )
    return ScoreTables(**neutral)


def plans(*bars_of_each_plan: list[list[int]]) -> np.ndarray:
    """Stack plans (lists of [p2, tr, no, oct] rows) into a population array."""
    return np.array(bars_of_each_plan)


def score(tables: ScoreTables, population: np.ndarray, criterion: str) -> np.ndarray:
    return criterion_scores(tables, population)[criterion]


# --- the score dictionary ---------------------------------------------------------------------


def test_criterion_scores_gives_one_score_per_plan_for_every_criterion():
    tables = make_tables(2)
    population = plans([[0, 0, 0, 0], [0, 0, 0, 0]], [[1, 1, 1, 1], [2, 2, 2, 2]])

    scores = criterion_scores(tables, population)

    assert tuple(scores) == CRITERIA
    assert all(values.shape == (2,) for values in scores.values())


# --- C1 complementarity -----------------------------------------------------------------------


def test_complementarity_rewards_a_calm_p2_under_a_busy_melody_and_the_reverse():
    tables = make_tables(
        2,
        act_p1=[[1.0, 0.5, 0.0], [0.25, 0.5, 0.0]],
        act_p2=[[0.0, 1.0, 1.0, 0.5, 0.5], [0.0, 1.0, 1.0, 0.5, 0.5]],
    )
    population = plans(
        # Bar 0: busy melody (1.0) under hold (0.0): 1 - |0 - 0| = 1.
        # Bar 1: melody 0.25 under arp16 (1.0): 1 - |1 - 0.75| = 0.75.
        [[0, 0, 0, 0], [1, 0, 0, 0]],
        # Bar 0: busy melody under arp32: 1 - |1 - 0| = 0.
        # Bar 1: melody one octave up (0.5) under hold: 1 - |0 - 0.5| = 0.5.
        [[2, 0, 0, 0], [0, 0, 0, 1]],
    )

    np.testing.assert_allclose(score(tables, population, "complementarity"), [0.875, 0.25])


# --- C2 register ------------------------------------------------------------------------------


def test_register_is_the_share_of_shared_steps_where_p2_sounds_below_p1():
    reg_both = np.zeros((2, 3, 5))
    reg_ok = np.zeros((2, 3, 5))
    reg_both[0, 0, 1], reg_ok[0, 0, 1] = 8, 6  # bar 0, melody as written, arp16
    reg_both[1, 2, 3], reg_ok[1, 2, 3] = 4, 1  # bar 1, melody an octave down, echo
    tables = make_tables(2, reg_both=reg_both, reg_ok=reg_ok)
    population = plans([[1, 0, 0, 0], [3, 0, 0, 2]])

    # The counts are pooled over bars: (6 + 1) / (8 + 4).
    np.testing.assert_allclose(score(tables, population, "register"), [7 / 12])


def test_register_is_one_when_p1_and_p2_never_sound_together():
    reg_both = np.zeros((2, 3, 5))
    reg_both[0, 0, 1] = 8
    tables = make_tables(2, reg_both=reg_both, reg_ok=np.zeros((2, 3, 5)))
    population = plans([[0, 0, 0, 0], [0, 0, 0, 0]])  # hold never overlaps here

    np.testing.assert_allclose(score(tables, population, "register"), [1.0])


# --- C3 coherence -----------------------------------------------------------------------------


def test_coherence_is_one_when_bars_inside_a_phrase_keep_the_same_choices():
    tables = make_tables(3, phrase=[0, 0, 0])
    population = plans([[1, 2, 3, 0]] * 3)

    np.testing.assert_allclose(score(tables, population, "coherence"), [1.0])


def test_coherence_counts_a_change_of_p2_tr_or_octave_as_a_break():
    tables = make_tables(3, phrase=[0, 0, 0])
    population = plans(
        [[1, 2, 3, 0], [4, 2, 3, 0], [4, 2, 3, 0]],  # P2 changes once in two pairs
        [[1, 2, 3, 0], [1, 0, 3, 0], [1, 2, 3, 0]],  # TR changes in both pairs
        [[1, 2, 3, 0], [1, 2, 3, 0], [1, 2, 3, 1]],  # octave changes once
    )

    np.testing.assert_allclose(score(tables, population, "coherence"), [0.5, 0.0, 0.5])


def test_coherence_lets_a_fill_end_a_phrase_after_any_drum_pattern():
    tables = make_tables(3, phrase=[0, 0, 0], phrase_end=[False, False, True])
    population = plans(
        [[0, 0, 2, 0], [0, 0, 2, 0], [0, 0, 4, 0]],  # eighth -> eighth -> fill: both pairs fit
        [[0, 0, 2, 0], [0, 0, 1, 0], [0, 0, 4, 0]],  # eighth -> half breaks the first pair
    )

    np.testing.assert_allclose(score(tables, population, "coherence"), [1.0, 0.5])


def test_a_fill_inside_a_phrase_does_not_hide_a_change_of_groove():
    tables = make_tables(4, phrase=[0, 0, 0, 0], phrase_end=[False, False, False, True])
    eighth, half, fill = [0, 0, 2, 0], [0, 0, 1, 0], [0, 0, 4, 0]
    population = plans(
        [eighth, fill, half, half],  # the fill sits mid-phrase: only half -> half fits
        [eighth, eighth, half, half],  # one change of groove in three pairs
    )

    np.testing.assert_allclose(score(tables, population, "coherence"), [1 / 3, 2 / 3])


def test_coherence_ignores_pairs_that_cross_a_phrase_boundary():
    tables = make_tables(4, phrase=[0, 0, 1, 1])
    # Each phrase is internally constant, but the phrases differ in every gene.
    population = plans([[0, 0, 0, 0], [0, 0, 0, 0], [3, 3, 3, 2], [3, 3, 3, 2]])

    np.testing.assert_allclose(score(tables, population, "coherence"), [1.0])


def test_coherence_does_not_apply_when_no_phrase_has_two_bars():
    tables = make_tables(2, phrase=[0, 1])
    population = plans([[0, 0, 0, 0], [3, 3, 3, 2]])

    assert np.isnan(score(tables, population, "coherence")).all()


# --- C4 contrast ------------------------------------------------------------------------------


def contrast_tables() -> ScoreTables:
    """Two verse bars, then two chorus bars, with the same activity tables in every bar."""
    return make_tables(
        4,
        act_p2=[[0.0, 1.0, 1.0, 0.5, 0.5]] * 4,
        act_tr=[[0.0, 1.0, 0.5, 0.75]] * 4,
        act_no=[[0.0, 0.25, 0.5, 1.0, 0.75]] * 4,
        is_chorus=[False, False, True, True],
    )


def test_contrast_rewards_a_chorus_denser_than_the_verse():
    verse = [0, 0, 1, 0]  # density (0 + 0 + 0.25) / 3 = 1/12
    chorus = [3, 2, 2, 0]  # density (0.5 + 0.5 + 0.5) / 3 = 1/2
    population = plans([verse, verse, chorus, chorus])

    np.testing.assert_allclose(
        score(contrast_tables(), population, "contrast"), [0.5 + 0.5 - 1 / 12]
    )


def test_contrast_is_clipped_to_the_range_zero_to_one():
    sparse = [0, 0, 0, 0]  # density 0
    dense = [1, 1, 3, 0]  # density 1
    population = plans([sparse, sparse, dense, dense], [dense, dense, sparse, sparse])

    np.testing.assert_allclose(score(contrast_tables(), population, "contrast"), [1.0, 0.0])


@pytest.mark.parametrize("is_chorus", [[False, False], [True, True]])
def test_contrast_does_not_apply_without_both_verse_and_chorus(is_chorus):
    tables = make_tables(2, is_chorus=is_chorus)

    assert np.isnan(score(tables, plans([[0, 0, 0, 0], [1, 1, 1, 0]]), "contrast")).all()


# --- C5 bass smoothness -----------------------------------------------------------------------


def test_bass_smoothness_is_the_mean_leap_score_between_consecutive_bars():
    leap_scores = np.zeros((2, 4, 4))
    leap_scores[0, 1, 2] = 0.75  # bar 0 octave_pump -> bar 1 root_fifth
    leap_scores[1, 2, 3] = 0.25  # bar 1 root_fifth -> bar 2 walking
    tables = make_tables(3, bass_across=leap_scores)
    population = plans([[0, 1, 0, 0], [0, 2, 0, 0], [0, 3, 0, 0]])

    np.testing.assert_allclose(score(tables, population, "bass_smoothness"), [0.5])


def test_bass_smoothness_pools_the_leaps_inside_and_across_bars():
    inner = np.full((2, 4), np.nan)
    leaps = np.zeros((2, 4), dtype=int)
    inner[0, 3], leaps[0, 3] = 0.5, 3  # bar 0 walking: 3 leaps with mean score 0.5
    across = np.zeros((1, 4, 4))
    across[0, 3, 0] = 1.0  # bar 0 walking -> bar 1 root
    tables = make_tables(2, bass_inner=inner, bass_inner_leaps=leaps, bass_across=across)
    population = plans([[0, 3, 0, 0], [0, 0, 0, 0]])  # bar 1 root: one note, no inner leap

    # Every leap counts once: (3 * 0.5 + 1) / 4, not the mean of the bar means.
    np.testing.assert_allclose(score(tables, population, "bass_smoothness"), [2.5 / 4])


def test_bass_smoothness_does_not_apply_when_the_bass_never_leaps():
    tables = make_tables(1)  # one bar of a single held root

    assert np.isnan(score(tables, plans([[0, 0, 0, 0]]), "bass_smoothness")).all()


# --- C6 idiom ---------------------------------------------------------------------------------


def test_idiom_pools_arpeggios_on_single_chord_bars_and_fills_at_phrase_ends():
    tables = make_tables(
        4, single_chord=[True, True, False, False], phrase_end=[False, True, False, True]
    )
    # Single-chord bars 0 and 1: arp16 then hold, so 1 of 2 use an arpeggio.
    # Fills on bars 0, 1, 3 against phrase ends on bars 1, 3: bars 1, 2, 3 match.
    population = plans([[1, 0, 4, 0], [0, 0, 4, 0], [2, 0, 0, 0], [0, 0, 4, 0]])

    np.testing.assert_allclose(score(tables, population, "idiom"), [(1 + 3) / (2 + 4)])


def test_idiom_weighs_every_bar_decision_equally():
    tables = make_tables(
        4, single_chord=[True, False, False, False], phrase_end=[False, True, False, True]
    )
    # One single-chord bar with an arpeggio (1 of 1), and fills on bars 0 and 3 that match the
    # phrase ends in 2 of the 4 bars: three good decisions out of five. A mean of the two shares
    # would let the one arpeggio weigh as much as the four drum decisions: (1 + 0.5) / 2 = 0.75.
    population = plans([[1, 0, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 4, 0]])

    np.testing.assert_allclose(score(tables, population, "idiom"), [3 / 5])


def test_idiom_uses_only_the_fill_share_when_no_bar_has_a_single_chord():
    tables = make_tables(4, phrase_end=[False, True, False, True])
    population = plans([[1, 0, 4, 0], [0, 0, 4, 0], [2, 0, 0, 0], [0, 0, 4, 0]])

    np.testing.assert_allclose(score(tables, population, "idiom"), [0.75])


# --- C7 fidelity ------------------------------------------------------------------------------


def test_fidelity_is_the_share_of_bars_with_the_melody_at_its_written_octave():
    tables = make_tables(4)
    population = plans([[0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 2]])

    np.testing.assert_allclose(score(tables, population, "fidelity"), [0.5])


# --- weighted mean ----------------------------------------------------------------------------


def only(**weights: float) -> dict[str, float]:
    """A weight for every criterion: the given ones, 0 for the others."""
    return {name: weights.get(name, 0.0) for name in CRITERIA}


def test_fitness_is_the_weighted_mean_of_the_criteria():
    leap_scores = np.zeros((1, 4, 4))
    leap_scores[0, 0, 0] = 1.0
    tables = make_tables(2, bass_across=leap_scores)
    population = plans([[0, 0, 0, 0], [0, 0, 0, 1]])  # fidelity 0.5, bass_smoothness 1

    weighted = fitness(tables, population, only(fidelity=3.0, bass_smoothness=1.0))

    np.testing.assert_allclose(weighted, [(3 * 0.5 + 1 * 1.0) / 4])


def test_fitness_leaves_criteria_that_do_not_apply_out_of_the_mean():
    tables = make_tables(2)  # no chorus, so contrast does not apply
    population = plans([[0, 0, 0, 0], [0, 0, 0, 1]])

    weighted = fitness(tables, population, only(contrast=5.0, fidelity=1.0))

    np.testing.assert_allclose(weighted, [0.5])


def test_fitness_is_zero_when_all_weights_are_zero():
    tables = make_tables(2)

    weighted = fitness(tables, plans([[0, 0, 0, 0], [0, 0, 0, 0]]), only())

    np.testing.assert_array_equal(weighted, [0.0])


def test_fitness_is_zero_when_only_criteria_that_do_not_apply_have_weight():
    tables = make_tables(2)

    weighted = fitness(tables, plans([[0, 0, 0, 0], [0, 0, 0, 0]]), only(contrast=1.0))

    np.testing.assert_array_equal(weighted, [0.0])


def test_fitness_of_a_population_equals_the_fitness_of_each_plan_alone():
    generator = np.random.default_rng(0)
    tables = make_tables(
        4,
        act_p1=generator.random((4, 3)),
        act_p2=generator.random((4, 5)),
        act_tr=generator.random((4, 4)),
        act_no=generator.random((4, 5)),
        reg_both=np.full((4, 3, 5), 16.0),
        reg_ok=generator.integers(0, 17, (4, 3, 5)).astype(float),
        bass_across=generator.random((3, 4, 4)),
        bass_inner=generator.random((4, 4)),
        bass_inner_leaps=generator.integers(1, 8, (4, 4)),
        single_chord=[True, False, True, False],
        phrase_end=[False, True, False, True],
        phrase=[0, 0, 1, 1],
        is_chorus=[False, False, True, True],
    )
    population = np.stack([generator.integers(0, (5, 4, 5, 3), (4, 4)) for _ in range(6)])
    weights = dict.fromkeys(CRITERIA, 1.0)

    together = fitness(tables, population, weights)
    alone = [fitness(tables, plan[np.newaxis], weights)[0] for plan in population]

    np.testing.assert_allclose(together, alone)
    assert ((together >= 0) & (together <= 1)).all()


ROOT = Path(__file__).resolve().parent.parent
LEADSHEETS = ROOT / "data" / "leadsheets"
PLAN_FIXTURES = sorted((ROOT / "arranger" / "tests" / "fixtures" / "plans").glob("*.json"))


@pytest.mark.parametrize("path", PLAN_FIXTURES, ids=[path.stem for path in PLAN_FIXTURES])
def test_every_committed_plan_keeps_its_scores_and_fitness(path):
    # Spec 003 FR-017: per-bar grids and drum activity leave every 4/4 score unchanged.
    from ga.tables import build_tables
    from leadsheet.abc_reader import read_lead_sheet

    fixture = json.loads(path.read_text())
    # The meter test tunes (plans/meters-*.json) live with the tests, the samples' in data/.
    folder = ROOT / "tests" / "data" / "meters" if path.stem.startswith("meters-") else LEADSHEETS
    lead_sheet = read_lead_sheet(folder / f"{fixture['leadsheet']}.abc")
    tables = build_tables(lead_sheet)
    plan = np.array([fixture["best_plan"]])

    scores = criterion_scores(tables, plan)
    value = fitness(tables, plan, fixture["settings"]["weights"])[0]

    for name, expected in fixture["scores"].items():
        if expected is None:
            assert np.isnan(scores[name][0])
        else:
            assert scores[name][0] == pytest.approx(expected, abs=1e-15)
    assert value == pytest.approx(fixture["fitness"], abs=1e-15)
